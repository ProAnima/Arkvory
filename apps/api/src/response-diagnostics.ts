import type { FastifyRequest, FastifyReply } from 'fastify';
import type { DiagnosticLogger, PostgresStoragePolicy } from '@proanima/depot-infrastructure';
import type { RequestContext } from './request-context.js';

/** A bounded, best-effort queue; transfers never await database logging. */
export class ResponseDiagnostics {
  private readonly queue: {
    repository: string;
    level: 'warning' | 'error';
    code: string;
    details: Record<string, string | number>;
  }[] = [];
  private dropped = 0;
  constructor(
    private readonly writer: Pick<DiagnosticLogger, 'write' | 'close'>,
    private readonly store: Pick<PostgresStoragePolicy, 'recordEvent'>,
    private readonly context: Pick<RequestContext, 'errorCode' | 'peekPrincipal'>,
  ) {}
  record(request: FastifyRequest, reply: FastifyReply): void {
    if (reply.statusCode < 400) return;
    const level = reply.statusCode >= 500 ? 'error' : 'warning';
    const code = this.context.errorCode(request) ?? `http.${String(reply.statusCode)}`;
    const route = request.routeOptions.url ?? 'unmatched';
    const params: unknown = request.params;
    const repository =
      params &&
      typeof params === 'object' &&
      'repository' in params &&
      typeof params.repository === 'string' &&
      /^[a-z0-9][a-z0-9_-]{0,63}$/.test(params.repository)
        ? params.repository
        : undefined;
    this.writer.write({
      level,
      component: 'api',
      code,
      requestId: request.id,
      route,
      method: request.method,
      status: reply.statusCode,
    });
    // Unknown/unauthenticated repository names cannot poison another repository's event stream.
    const p = this.context.peekPrincipal(request);
    if (
      repository &&
      p?.managed?.bindings.some((b) => b.resource.id === repository && b.actions.length > 0)
    ) {
      if (this.queue.length < 128)
        this.queue.push({
          repository,
          level,
          code,
          details: {
            requestId: request.id,
            route,
            method: request.method,
            status: reply.statusCode,
          },
        });
      else this.dropped++;
    }
  }
  async flush() {
    for (let i = 0; i < 10; i++) {
      const event = this.queue.shift();
      if (!event) break;
      try {
        await this.store.recordEvent(event.repository, event.level, event.code, event.details);
      } catch {
        this.writer.write({
          level: 'error',
          component: 'storage',
          code: 'diagnostics.persist_failed',
        });
        break;
      }
    }
    if (this.dropped) {
      this.writer.write({
        level: 'warning',
        component: 'storage',
        code: `diagnostics.queue_dropped.${String(this.dropped)}`,
      });
      this.dropped = 0;
    }
  }

  close(): void {
    this.queue.length = 0;
    this.writer.close();
  }
}
