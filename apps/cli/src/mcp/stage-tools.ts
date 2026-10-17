import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { ArkvoryIntegrityError } from '@proanima/arkvory-sdk';
import type { KeyActions, ToolContext } from './context.js';
import { objectResult } from './output.js';
import { defineTool, idInput, repositoryInput } from './tool.js';
import type { ToolCall } from './tool.js';
import { labelsInput, metadataInput, writeTarget } from './write-tools.js';

const stageInput = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_.-]{0,31}$/)
  .describe('Stage name, such as test, staging or release.');
const sha256Input = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .optional()
  .describe('Refuse unless the artifact has exactly this SHA-256 (from the upload result).');

function deadline(ctx: ToolContext, call: ToolCall): AbortSignal {
  return AbortSignal.any([call.signal, AbortSignal.timeout(ctx.requestTimeoutMs)]);
}

interface PromoteInput {
  readonly repository?: string | undefined;
  readonly id: string;
  readonly stage: string;
  readonly comment?: string | undefined;
  readonly sha256?: string | undefined;
}

/** Adds a stage; with `sha256`, only to the artifact holding exactly those bytes. */
export async function promote(ctx: ToolContext, input: PromoteInput, call: ToolCall) {
  const { repository } = writeTarget(ctx, input.repository);
  const signal = deadline(ctx, call);
  if (input.sha256 !== undefined) {
    const artifact = await ctx.client.artifact(repository, input.id, signal);
    if (artifact.descriptor.sha256 !== input.sha256) throw new ArkvoryIntegrityError();
  }
  const stage = await ctx.client.promotions.setStage(
    repository,
    input.id,
    input.stage,
    input.comment,
    signal,
  );
  return { repository, id: input.id, stage };
}

interface AnnotateInput {
  readonly repository?: string | undefined;
  readonly id: string;
  readonly expectedRevision: number;
  readonly labels?: readonly string[] | undefined;
  readonly metadata?: Record<string, string> | undefined;
}

/**
 * Replaces labels and/or metadata at the revision the caller last read. A field left out keeps
 * its value of that revision, collections are never touched; the server refuses the write with
 * `conflict` when the annotations changed since, so nothing read earlier is silently lost.
 */
export async function annotate(ctx: ToolContext, input: AnnotateInput, call: ToolCall) {
  const { repository } = writeTarget(ctx, input.repository);
  call.signal.throwIfAborted();
  const current = await ctx.client.annotations(repository, input.id);
  call.signal.throwIfAborted();
  const annotations = await ctx.client.annotate(repository, input.id, input.expectedRevision, {
    labels: [...(input.labels ?? current.labels)],
    metadata: input.metadata ?? current.metadata,
    collections: current.collections,
  });
  return { repository, id: input.id, annotations };
}

export function registerStageTools(server: McpServer, ctx: ToolContext, actions: KeyActions) {
  if (actions.has('artifact.promote')) {
    defineTool(
      server,
      'arkvory_promote',
      {
        title: 'Add a stage',
        description:
          'Mark an artifact with a stage such as staging or release; adding a stage it already has changes nothing. Pass `sha256` to promote only the verified bytes. Confirm with the user before writing.',
        input: z.strictObject({
          repository: repositoryInput,
          id: idInput,
          stage: stageInput,
          comment: z.string().max(1024).optional(),
          sha256: sha256Input,
        }),
        output: z.looseObject({ repository: z.string(), id: z.string(), truncated: z.boolean() }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      },
      async (input, call) => objectResult(ctx, await promote(ctx, input, call), 'stage added'),
    );
    defineTool(
      server,
      'arkvory_stage_remove',
      {
        title: 'Remove a stage',
        description:
          'Remove a stage from an artifact; clients that select versions by this stage stop seeing it. The artifact itself stays. Confirm with the user before writing.',
        input: z.strictObject({ repository: repositoryInput, id: idInput, stage: stageInput }),
        output: z.looseObject({ repository: z.string(), removed: z.string() }),
        // Removing a stage the artifact does not have is accepted and changes nothing.
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      },
      async (input, call) => {
        const { repository } = writeTarget(ctx, input.repository);
        await ctx.client.promotions.removeStage(
          repository,
          input.id,
          input.stage,
          deadline(ctx, call),
        );
        return objectResult(
          ctx,
          { repository, id: input.id, removed: input.stage },
          'stage removed',
        );
      },
    );
  }
  if (actions.has('annotation.read') && actions.has('annotation.write'))
    defineTool(
      server,
      'arkvory_annotate',
      {
        title: 'Set labels and metadata',
        description:
          'Replace the labels and/or metadata of an artifact. Read the current values and `revision` with arkvory_artifact first and pass that revision as `expectedRevision`; a field left out keeps its value. A concurrent change is refused with `conflict`. Confirm with the user before writing.',
        input: z.strictObject({
          repository: repositoryInput,
          id: idInput,
          expectedRevision: z.int().min(0).max(2147483647),
          labels: labelsInput.optional(),
          metadata: metadataInput.optional(),
        }),
        output: z.looseObject({ repository: z.string(), id: z.string(), truncated: z.boolean() }),
        // Replaces values; repeating the call at the same revision is refused, not applied twice.
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      },
      async (input, call) =>
        objectResult(ctx, await annotate(ctx, input, call), 'annotations replaced'),
    );
}
