import { z } from 'zod';
import type { CallToolResult, McpServer, ServerContext } from '@modelcontextprotocol/server';
import { errorResult } from './output.js';

/** Inputs of every tool are strict: an unknown field is refused, not ignored. */
export const repositoryInput = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
  .optional()
  .describe('Repository name; the profile repository when omitted.');
export const idInput = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  .describe('Artifact ID (UUID). Refer to artifacts by ID, not by name.');
export const afterInput = z
  .string()
  .min(1)
  .max(8192)
  .optional()
  .describe('Cursor: `next` of the previous result with the same other arguments.');
export const limitInput = z.int().min(1).max(100).optional().describe('Items per page, 1–100.');

/** A page of data items; `truncated` is true when fewer items came than were asked for. */
export function pageOutput(item: z.ZodType, extra: Record<string, z.ZodType> = {}) {
  return z.looseObject({
    items: z.array(item).max(100),
    next: z.string().nullable(),
    truncated: z.boolean(),
    ...extra,
  });
}

export interface ToolCall {
  readonly signal: AbortSignal;
  /** Transfer progress; sent to the client at most twice a second when it asked for it. */
  readonly progress: (done: number, total: number) => void;
}
export interface ToolDefinition<I extends z.ZodType> {
  readonly title: string;
  readonly description: string;
  readonly input: I;
  readonly output: z.ZodType;
  /** MCP hints. They inform the client; the boundary is which tools exist at all. */
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint?: boolean;
    readonly idempotentHint?: boolean;
  };
}

function progressOf(context: ServerContext): ToolCall['progress'] {
  const token = context.mcpReq._meta?.progressToken;
  if (token === undefined) return () => undefined;
  let last = 0;
  return (done, total) => {
    const now = Date.now();
    if (now - last < 500 && done < total) return;
    last = now;
    // A lost progress notification changes nothing about the transfer.
    context.mcpReq
      .notify({
        method: 'notifications/progress',
        params: { progressToken: token, progress: done, total },
      })
      .catch(() => undefined);
  };
}

/**
 * Registers one tool. Every failure becomes a coded error result (ADR 0051 codes, request ID);
 * nothing of an exception message, stack, local path or URL reaches the client.
 */
export function defineTool<I extends z.ZodType>(
  server: McpServer,
  name: string,
  definition: ToolDefinition<I>,
  handler: (input: z.infer<I>, call: ToolCall) => Promise<CallToolResult>,
): void {
  server.registerTool<z.ZodType, z.ZodType>(
    name,
    {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.input,
      outputSchema: definition.output,
      annotations: { ...definition.annotations, openWorldHint: false },
    },
    // The SDK validated the arguments with the same schema; parsing again yields them typed.
    async (input: unknown, context: ServerContext) => {
      const signal = context.mcpReq.signal;
      try {
        const parsed = await definition.input.parseAsync(input);
        return await handler(parsed, { signal, progress: progressOf(context) });
      } catch (error) {
        return errorResult(error, signal);
      }
    },
  );
}
