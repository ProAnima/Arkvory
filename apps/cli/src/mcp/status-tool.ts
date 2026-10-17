import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { ArkvoryHttpError } from '@proanima/arkvory-sdk';
import type { ToolContext } from './context.js';
import { objectResult } from './output.js';
import { defineTool } from './tool.js';
import type { ToolCall } from './tool.js';

/**
 * One section of the status. A section the key may not read is `forbidden`, one this server
 * does not offer is `unavailable`; neither fails the whole tool.
 */
async function section(read: () => Promise<unknown>): Promise<unknown> {
  try {
    return { state: 'ok', value: await read() };
  } catch (error) {
    if (error instanceof ArkvoryHttpError) {
      if (error.status === 401 || error.status === 403) return { state: 'forbidden' };
      if (error.status === 404) return { state: 'unavailable' };
      return { state: 'error', code: error.code };
    }
    throw error;
  }
}

export async function readStatus(ctx: ToolContext, call: ToolCall) {
  const signal = AbortSignal.any([call.signal, AbortSignal.timeout(ctx.requestTimeoutMs)]);
  const [server, replication, mirrors, backup, fleet] = await Promise.all([
    section(() => ctx.client.capabilities(signal)),
    section(() => ctx.client.replication.state(signal)),
    section(() => ctx.client.mirrors(signal)),
    section(() => ctx.client.backup.status(signal)),
    section(() => ctx.client.fleet.overview(signal)),
  ]);
  return { server, replication, mirrors, backup, fleet };
}

export function registerStatusTool(server: McpServer, ctx: ToolContext) {
  const part = z.looseObject({ state: z.enum(['ok', 'forbidden', 'unavailable', 'error']) });
  defineTool(
    server,
    'arkvory_status',
    {
      title: 'Installation status',
      description:
        'API version, gateway role and limits; HA copies, mirrors, backups and the fleet overview where this key may read them. A section the key may not read is reported as forbidden.',
      input: z.strictObject({}),
      output: z.looseObject({
        server: part,
        replication: part,
        mirrors: part,
        backup: part,
        fleet: part,
        truncated: z.boolean(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (_input, call) => objectResult(ctx, await readStatus(ctx, call), 'status'),
  );
}
