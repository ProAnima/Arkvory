import { Readable } from 'node:stream';
import type { FastifyRequest } from 'fastify';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { DiagnosticLogger } from '@proanima/arkvory-infrastructure';

export function downloadStream(
  source: AsyncIterable<Uint8Array>,
  request: FastifyRequest,
  signal: AbortSignal,
  diagnostics: Pick<DiagnosticLogger, 'write'>,
) {
  const stream = Readable.from(source, { objectMode: false, highWaterMark: 64 * 1024 });
  // After headers, a read failure cannot become JSON; record it before the pipeline closes HTTP.
  stream.once('error', (error: unknown) => {
    if (signal.aborted) return;
    diagnostics.write({
      level: 'error',
      component: 'http',
      code:
        error instanceof ArkvoryError && error.code === 'integrity_mismatch'
          ? 'download.integrity_mismatch'
          : 'download.read_failed',
      requestId: request.id,
      route: request.routeOptions.url ?? 'unknown',
      method: request.method,
    });
  });
  return stream;
}
