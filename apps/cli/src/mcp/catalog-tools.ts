import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { UploadResponse } from '@proanima/arkvory-contracts';
import type { KeyActions, ToolContext } from './context.js';
import { listResult, objectResult } from './output.js';
import {
  afterInput,
  defineTool,
  idInput,
  limitInput,
  pageOutput,
  repositoryInput,
} from './tool.js';
import type { ToolCall } from './tool.js';

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;
const text = z.string();
const strings = z.array(z.string());
const searchItem = z.looseObject({
  id: text,
  name: text,
  size: text,
  publishedAt: text.nullable(),
  labels: strings,
  stages: strings,
});
const artifactItem = z.looseObject({
  id: text,
  name: text,
  size: text,
  sha256: text,
  labels: strings,
  metadata: z.record(z.string(), z.string()),
});

function deadline(ctx: ToolContext, call: ToolCall): AbortSignal {
  return AbortSignal.any([call.signal, AbortSignal.timeout(ctx.requestTimeoutMs)]);
}
function artifactView(artifact: UploadResponse) {
  const { name, size, sha256, labels, metadata } = artifact.descriptor;
  return {
    id: artifact.id,
    repository: artifact.repository,
    status: artifact.status,
    createdAt: artifact.createdAt,
    name,
    size,
    sha256,
    labels,
    metadata,
  };
}

export function registerDiscoveryTools(server: McpServer, ctx: ToolContext, actions: KeyActions) {
  defineTool(
    server,
    'arkvory_repositories',
    {
      title: 'Repositories',
      description: 'Repositories this key can see, with the key’s permissions in each.',
      input: z.strictObject({ after: afterInput, limit: limitInput }),
      output: pageOutput(z.looseObject({ id: text, permissions: strings })),
      annotations: readOnly,
    },
    async (input, call) =>
      listResult(ctx, {
        limit: input.limit ?? 100,
        noun: 'repositories',
        fetch: (limit) =>
          ctx.client.repositories(
            { limit, ...(input.after === undefined ? {} : { after: input.after }) },
            deadline(ctx, call),
          ),
        cursorOf: (card) => card.id,
      }),
  );
  if (!actions.has('artifact.list')) return;
  registerSearchTool(server, ctx);
  registerListTools(server, ctx);
}

function registerSearchTool(server: McpServer, ctx: ToolContext) {
  defineTool(
    server,
    'arkvory_search',
    {
      title: 'Search artifacts',
      description:
        'Search published artifacts in every repository this key can list, newest first. `query` matches names and metadata values (case-insensitive substring); all given filters must match.',
      input: z.strictObject({
        query: z.string().max(240).optional(),
        repositories: z
          .array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/))
          .max(100)
          .optional(),
        labels: z
          .array(z.string().regex(/^[\p{L}\p{N}_.:-]{1,64}$/u))
          .max(8)
          .optional(),
        stage: z
          .string()
          .regex(/^[a-z0-9][a-z0-9_.-]{0,31}$/)
          .optional(),
        after: afterInput,
        limit: limitInput,
      }),
      output: pageOutput(searchItem.extend({ repository: text })),
      annotations: readOnly,
    },
    async (input, call) =>
      listResult(ctx, {
        limit: input.limit ?? 50,
        noun: 'artifacts',
        fetch: (limit) =>
          ctx.client.searchAll(
            {
              limit,
              ...(input.query === undefined ? {} : { q: input.query }),
              ...(input.repositories === undefined ? {} : { repositories: input.repositories }),
              ...(input.labels === undefined ? {} : { labels: input.labels }),
              ...(input.stage === undefined ? {} : { stage: input.stage }),
              ...(input.after === undefined ? {} : { after: input.after }),
            },
            deadline(ctx, call),
          ),
      }),
  );
}

function registerListTools(server: McpServer, ctx: ToolContext) {
  defineTool(
    server,
    'arkvory_artifacts',
    {
      title: 'Artifacts of a repository',
      description: 'Published artifacts of one repository in ID order, 50 per page.',
      input: z.strictObject({ repository: repositoryInput, after: afterInput }),
      output: pageOutput(artifactItem),
      annotations: readOnly,
    },
    async (input) =>
      listResult(ctx, {
        limit: 50,
        noun: 'artifacts',
        fetch: async () => {
          const page = await ctx.client.list(input.repository ?? ctx.repository, input.after);
          return { items: page.items.map(artifactView), next: page.next };
        },
        cursorOf: (item) => item.id,
      }),
  );
  defineTool(
    server,
    'arkvory_history',
    {
      title: 'Repository changes',
      description:
        'The ordered change feed of one repository: publications, stages, annotations and file paths. Start with no cursor; `head` is the newest sequence.',
      input: z.strictObject({ repository: repositoryInput, after: afterInput, limit: limitInput }),
      output: pageOutput(z.looseObject({ sequence: text, action: text, artifactId: text }), {
        head: text,
      }),
      annotations: readOnly,
    },
    async (input, call) =>
      listResult(ctx, {
        limit: input.limit ?? 100,
        noun: 'changes',
        fetch: async (limit) => {
          const page = await ctx.client.catalogChanges(input.repository ?? ctx.repository, {
            after: input.after ?? '0',
            limit,
            signal: deadline(ctx, call),
          });
          return { items: page.items, next: page.next, extra: { head: page.head } };
        },
        cursorOf: (change) => change.sequence,
      }),
  );
}

export function registerArtifactTools(server: McpServer, ctx: ToolContext, actions: KeyActions) {
  if (actions.has('artifact.read'))
    defineTool(
      server,
      'arkvory_artifact',
      {
        title: 'Artifact details',
        description:
          'One artifact: descriptor (name, size, sha256, labels, metadata), current stages, and, when the key may read them, annotations and build attachments.',
        input: z.strictObject({ repository: repositoryInput, id: idInput }),
        output: z.looseObject({ artifact: artifactItem, truncated: z.boolean() }),
        annotations: readOnly,
      },
      async (input, call) => {
        const repository = input.repository ?? ctx.repository;
        const signal = deadline(ctx, call);
        const artifact = await ctx.client.artifact(repository, input.id, signal);
        const section = async (allowed: boolean, read: () => Promise<unknown>) =>
          allowed ? read().catch(() => ({ unavailable: true })) : { forbidden: true };
        const [stages, annotations, attachments] = await Promise.all([
          section(true, () => ctx.client.promotions.stages(repository, input.id, signal)),
          section(actions.has('annotation.read'), () =>
            ctx.client.annotations(repository, input.id),
          ),
          section(actions.has('annotation.read'), () =>
            ctx.client.attachments(repository, input.id, signal),
          ),
        ]);
        return objectResult(
          ctx,
          { artifact: artifactView(artifact), stages, annotations, attachments },
          'artifact',
        );
      },
    );
  if (actions.has('package.read')) registerPackageTool(server, ctx);
  if (actions.has('asset.read')) registerFileTool(server, ctx);
}

function registerPackageTool(server: McpServer, ctx: ToolContext) {
  const resolve = z.strictObject({
    name: z.string().min(1).max(214),
    group: z.string().max(214).optional(),
    version: z.string().max(128).optional(),
    range: z.string().max(256).optional(),
    stage: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_.-]{0,31}$/)
      .optional(),
    prerelease: z.boolean().optional(),
  });
  defineTool(
    server,
    'arkvory_packages',
    {
      title: 'UPack packages',
      description:
        'Registered UPack versions of a repository (group, name, version, artifact ID); with `resolve`, the one version a name, range and stage select.',
      input: z.strictObject({
        repository: repositoryInput,
        group: z.string().max(214).optional(),
        name: z.string().max(214).optional(),
        after: afterInput,
        limit: limitInput,
        resolve: resolve.optional(),
      }),
      output: z.looseObject({ truncated: z.boolean() }),
      annotations: readOnly,
    },
    async (input, call) => {
      const repository = input.repository ?? ctx.repository;
      const wanted = input.resolve;
      if (wanted)
        return objectResult(
          ctx,
          {
            resolved: await ctx.client.promotions.resolve(
              repository,
              {
                name: wanted.name,
                ...(wanted.group === undefined ? {} : { group: wanted.group }),
                ...(wanted.version === undefined ? {} : { version: wanted.version }),
                ...(wanted.range === undefined ? {} : { range: wanted.range }),
                ...(wanted.stage === undefined ? {} : { stage: wanted.stage }),
                ...(wanted.prerelease === undefined ? {} : { prerelease: wanted.prerelease }),
              },
              deadline(ctx, call),
            ),
          },
          'resolved version',
        );
      return listResult(ctx, {
        limit: input.limit ?? 50,
        noun: 'package versions',
        fetch: async (limit) => {
          const page = await ctx.client.packages(repository, {
            limit,
            ...(input.group === undefined ? {} : { group: input.group }),
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.after === undefined ? {} : { after: input.after }),
          });
          const items = page.items.map(({ group, name, version, artifactId }) => ({
            group,
            name,
            version,
            artifactId,
          }));
          return { items, next: page.next };
        },
      });
    },
  );
}

function registerFileTool(server: McpServer, ctx: ToolContext) {
  defineTool(
    server,
    'arkvory_files',
    {
      title: 'Files by path',
      description:
        'Current files of a repository by path prefix; with `path`, the revision history of that path (newest first, 50 per page, continue with `before`).',
      input: z.strictObject({
        repository: repositoryInput,
        prefix: z.string().max(1024).optional(),
        after: afterInput,
        limit: limitInput,
        path: z.string().min(1).max(1024).optional(),
        before: z.int().min(1).optional(),
      }),
      output: pageOutput(z.looseObject({ path: text, revision: z.number(), artifactId: text })),
      annotations: readOnly,
    },
    async (input, call) => {
      const repository = input.repository ?? ctx.repository;
      const path = input.path;
      if (path !== undefined)
        return listResult(ctx, {
          limit: 50,
          noun: 'revisions',
          fetch: async () => {
            const page = await ctx.client.assetHistory(
              repository,
              path,
              input.before,
              deadline(ctx, call),
            );
            return { items: page.items, next: page.next === null ? null : String(page.next) };
          },
          cursorOf: (revision) => String(revision.revision),
        });
      return listResult(ctx, {
        limit: input.limit ?? 100,
        noun: 'files',
        fetch: (limit) =>
          ctx.client.assetPage(
            repository,
            {
              limit,
              ...(input.prefix === undefined ? {} : { prefix: input.prefix }),
              ...(input.after === undefined ? {} : { after: input.after }),
            },
            deadline(ctx, call),
          ),
      });
    },
  );
}
