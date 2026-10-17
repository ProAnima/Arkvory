import { createHash, randomUUID } from 'node:crypto';
import { link, open, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { ArkvoryIntegrityError, newDownloadId } from '@proanima/arkvory-sdk';
import { CliError } from '../errors.js';
import { syncDirectory } from '../local-files.js';
import type { ToolContext } from './context.js';
import { objectResult } from './output.js';
import { downloadTarget, refusePrivate, unmoved } from './paths.js';
import { defineTool, idInput, repositoryInput } from './tool.js';
import type { ToolCall } from './tool.js';

const decimal = /^(0|[1-9][0-9]{0,18})$/;

interface DownloadInput {
  readonly repository?: string | undefined;
  readonly id: string;
  readonly path: string;
  readonly overwrite?: boolean | undefined;
  readonly maxBytes?: string | undefined;
}

/** Writes the whole stream to `file`, hashing the bytes it writes. */
async function store(
  stream: ReadableStream<Uint8Array>,
  file: Awaited<ReturnType<typeof open>>,
  total: number,
  call: ToolCall,
) {
  const hash = createHash('sha256');
  const reader = stream.getReader();
  let offset = 0;
  try {
    for (;;) {
      call.signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      let written = 0;
      while (written < chunk.value.length) {
        const result = await file.write(chunk.value, written, chunk.value.length - written);
        if (result.bytesWritten === 0) throw new CliError('disk_write_failed', 7);
        written += result.bytesWritten;
      }
      hash.update(chunk.value);
      offset += chunk.value.length;
      call.progress(offset, total);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  await file.sync();
  return { size: offset, sha256: hash.digest('hex') };
}

/** Where the download may write, refusing an existing target unless replacing was asked for. */
async function place(ctx: ToolContext, input: DownloadInput) {
  const target = await downloadTarget(ctx.root, input.path);
  // The real directory and the name: the file, or the link it replaces, never one of these.
  refusePrivate(ctx.privatePaths, target.path);
  if (target.exists && input.overwrite !== true) throw new CliError('destination_exists', 6);
  return target;
}

/**
 * Verified download into the root. Bytes go to a new temporary file beside the target; the SDK
 * checks every range and the final SHA-256, and the tool checks size and SHA-256 of what it
 * wrote once more. Only then the file takes the target name in one step: rename when replacing
 * was asked for, otherwise a hard link that refuses an existing name. On any failure the
 * temporary file is removed and the target is untouched. The place is checked before the
 * metadata request, again right before the file opens, then once it is open and before it takes
 * the target name, so a directory swapped for a link meanwhile never receives the bytes.
 */
export async function downloadToRoot(ctx: ToolContext, input: DownloadInput, call: ToolCall) {
  const repository = input.repository ?? ctx.repository;
  await place(ctx, input);
  const artifact = await ctx.client.artifact(
    repository,
    input.id,
    AbortSignal.any([call.signal, AbortSignal.timeout(ctx.requestTimeoutMs)]),
  );
  const { size, sha256 } = artifact.descriptor;
  if (input.maxBytes !== undefined && BigInt(size) > BigInt(input.maxBytes))
    throw new CliError('max_bytes_exceeded');
  const target = await place(ctx, input);
  const directory = dirname(target.path);
  // A fixed short name: the target's own name may already be near the file name length limit.
  const temporary = join(directory, `.arkvory-${randomUUID()}.part`);
  const file = await open(temporary, 'wx', 0o600);
  let closed = false;
  try {
    const opened = await file.stat({ bigint: true });
    await unmoved(directory, temporary, opened);
    const stream = await ctx.client.downloadVerified(repository, input.id, {
      signal: call.signal,
      downloadId: newDownloadId(),
    });
    const written = await store(stream, file, Number(size), call);
    await file.close();
    closed = true;
    if (String(written.size) !== size || written.sha256 !== sha256)
      throw new ArkvoryIntegrityError();
    call.signal.throwIfAborted();
    await unmoved(directory, temporary, opened);
    if (input.overwrite === true) await rename(temporary, target.path);
    else
      await link(temporary, target.path).catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
          throw new CliError('destination_exists', 6);
        throw error;
      });
    await syncDirectory(directory);
  } finally {
    if (!closed) await file.close().catch(() => undefined);
    // After rename the temporary name is gone; after link it is a second name of the target.
    await unlink(temporary).catch(() => undefined);
  }
  return { repository, id: input.id, path: target.shown, size, sha256 };
}

export function registerDownloadTool(server: McpServer, ctx: ToolContext) {
  defineTool(
    server,
    'arkvory_download',
    {
      title: 'Download an artifact',
      description:
        'Download one artifact into a file below the working root with SHA-256 verification. The file appears only when complete and verified; an existing file is replaced only with `overwrite: true`. Bytes are never returned.',
      input: z.strictObject({
        repository: repositoryInput,
        id: idInput,
        path: z.string().min(1).max(4096).describe('Target file, relative to the working root.'),
        overwrite: z.boolean().optional(),
        maxBytes: z
          .string()
          .regex(decimal)
          .optional()
          .describe('Refuse a larger artifact before any byte is transferred.'),
      }),
      output: z.looseObject({
        repository: z.string(),
        id: z.string(),
        path: z.string(),
        size: z.string(),
        sha256: z.string(),
        truncated: z.boolean(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (input, call) =>
      objectResult(ctx, await downloadToRoot(ctx, input, call), 'downloaded and verified'),
  );
}
