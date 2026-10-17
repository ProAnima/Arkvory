import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { CliError } from '../errors.js';
import { putToPath } from '../path-transfer.js';
import { publishPackage } from '../publish-package.js';
import { upload } from '../upload.js';
import { startingOver } from './checkpoints.js';
import type { KeyActions, ToolContext, WriteOptions } from './context.js';
import { objectResult } from './output.js';
import { openSource, searchedDigest } from './source.js';
import type { LocalSource } from './source.js';
import { defineTool, repositoryInput } from './tool.js';
import type { ToolCall } from './tool.js';

const label = /^[\p{L}\p{N}_.:-]{1,64}$/u;
// The Unicode class is checked by refine, not exported as a pattern (see arkvory_search).
export const labelsInput = z
  .array(
    z
      .string()
      .min(1)
      .max(64)
      .refine((value) => label.test(value), 'Invalid label'),
  )
  .max(32);
export const metadataInput = z
  .record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/), z.string().max(1024))
  .refine((value) => Object.keys(value).length <= 32, 'At most 32 metadata fields');
const sourceInput = z
  .string()
  .min(1)
  .max(4096)
  .describe('Local file to send, relative to the working root.');
// A new revision or a new artifact: nothing is replaced, a repeat is not a no-op.
const publishing = { readOnlyHint: false, destructiveHint: false, idempotentHint: false } as const;

/**
 * The repository a write names, refused before any request when `--write-repositories` does
 * not list it (`repository_not_allowed`). The server checks the key's rights afterwards anyway.
 */
export function writeTarget(ctx: ToolContext, requested: string | undefined) {
  const write = ctx.write;
  if (!write) throw new CliError('write_not_enabled');
  const repository = requested ?? ctx.repository;
  if (write.repositories && !write.repositories.has(repository))
    throw new CliError('repository_not_allowed', 3);
  return { write, repository };
}

interface SourceInput {
  readonly repository?: string | undefined;
  readonly file: string;
  readonly labels?: readonly string[] | undefined;
  readonly metadata?: Record<string, string> | undefined;
}

/**
 * Everything `upload()` needs for one source. The checkpoint lives in the CLI home, named by
 * the server, repository, real path and the descriptor (size, SHA-256, labels, metadata): a
 * repeated call after a lost answer finds it and resumes or returns the same artifact through
 * the same idempotency key, while a changed file or other labels start a new one instead of
 * failing on a checkpoint that no longer matches.
 */
async function prepared(
  ctx: ToolContext,
  write: WriteOptions,
  repository: string,
  source: LocalSource,
  input: SourceInput,
  call: ToolCall,
) {
  const sha256 = await searchedDigest(source.blob, ctx.secrets, call.signal);
  const values = { labels: input.labels ?? [], metadata: input.metadata ?? {} };
  const key = createHash('sha256')
    .update(
      JSON.stringify([write.server, repository, source.path, source.blob.size, sha256, values]),
    )
    .digest('hex');
  return {
    client: ctx.client,
    server: write.server,
    repository,
    path: source.path,
    state: join(write.checkpoints, `${key}.json`),
    blob: source.blob,
    sha256,
    values,
    signal: call.signal,
    progress: call.progress,
    requestTimeoutMs: ctx.requestTimeoutMs,
  };
}

async function withSource<T>(ctx: ToolContext, file: string, use: (s: LocalSource) => Promise<T>) {
  const source = await openSource(ctx.root, file);
  try {
    return await use(source);
  } finally {
    await source.handle.close();
  }
}

/** The receipt without the checkpoint's local path, which lies outside the root. */
function receipt(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'checkpoint'));
}

export async function uploadFromRoot(
  ctx: ToolContext,
  input: SourceInput & { readonly repositoryPath?: string | undefined },
  call: ToolCall,
) {
  const { write, repository } = writeTarget(ctx, input.repository);
  return withSource(ctx, input.file, async (source) => {
    const common = await prepared(ctx, write, repository, source, input, call);
    const file = { file: source.shown, size: String(source.blob.size), sha256: common.sha256 };
    if (input.repositoryPath === undefined) {
      const uploaded = await startingOver(common.state, () => upload(common));
      return { repository, ...file, artifact: receipt(uploaded) };
    }
    const path = input.repositoryPath;
    const placed = await startingOver(common.state, () =>
      putToPath({ ...common, assetPath: path }),
    );
    return { repository, ...file, ...placed };
  });
}

export async function publishFromRoot(ctx: ToolContext, input: SourceInput, call: ToolCall) {
  const { write, repository } = writeTarget(ctx, input.repository);
  return withSource(ctx, input.file, async (source) => {
    const common = await prepared(ctx, write, repository, source, input, call);
    const published = await startingOver(common.state, () => publishPackage(common));
    return {
      repository,
      file: source.shown,
      size: String(source.blob.size),
      sha256: common.sha256,
      artifactId: published.artifactId,
      package: published.package,
    };
  });
}

const sourceFields = {
  repository: repositoryInput,
  file: sourceInput,
  labels: labelsInput.optional(),
  metadata: metadataInput.optional(),
};
const sent = { file: z.string(), size: z.string(), sha256: z.string(), truncated: z.boolean() };

// Every action one resumable upload takes: create, status, parts and completion.
const uploading = ['upload.create', 'upload.read', 'upload.write', 'upload.complete'];

export function registerUploadTools(server: McpServer, ctx: ToolContext, actions: KeyActions) {
  if (!uploading.every((action) => actions.has(action))) return;
  defineTool(
    server,
    'arkvory_upload',
    {
      title: 'Upload a file',
      description:
        'Upload one file below the working root as a new artifact, or with `repositoryPath` as the next revision of that file path (the previous revision stays). Resumable: repeat the same call after a failure. The result names the verified SHA-256. Confirm with the user before writing.',
      input: z.strictObject({
        ...sourceFields,
        repositoryPath: z
          .string()
          .min(1)
          .max(1024)
          .optional()
          .describe('File path in the repository, such as builds/game/1.0/Game.zip.'),
      }),
      output: z.looseObject({ repository: z.string(), ...sent }),
      annotations: publishing,
    },
    async (input, call) => {
      const done = await uploadFromRoot(ctx, input, call);
      const summary =
        'created' in done && !done.created
          ? 'the path already holds these bytes; nothing uploaded'
          : 'uploaded and verified';
      return objectResult(ctx, done, summary);
    },
  );
  if (!actions.has('package.publish')) return;
  defineTool(
    server,
    'arkvory_publish_package',
    {
      title: 'Publish a UPack package',
      description:
        'Upload a .upack file below the working root and register it as a package version. Resumable: repeat the same call after a failure; when only registration failed, the error names the stored artifactId. Confirm with the user before writing.',
      input: z.strictObject(sourceFields),
      output: z.looseObject({ repository: z.string(), artifactId: z.string(), ...sent }),
      annotations: publishing,
    },
    async (input, call) =>
      objectResult(ctx, await publishFromRoot(ctx, input, call), 'published and registered'),
  );
}
