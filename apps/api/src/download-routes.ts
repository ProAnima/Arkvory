import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { StorageService } from '@proanima/depot-application';
import type {
  AdmissionQueue,
  BandwidthGovernor,
  DiagnosticLogger,
  PostgresContentPins,
} from '@proanima/depot-infrastructure';
import type { ProGetDownloads } from '@proanima/depot-proget-compat';
import type { RequestContext } from './request-context.js';
import { downloadStream } from './download-stream.js';
import { matchesEtag, parseRange } from './range.js';

interface ContentServices {
  service: Pick<StorageService, 'download'>;
  downloadGate: Pick<AdmissionQueue, 'acquire'>;
  downloadBandwidth: Pick<BandwidthGovernor, 'stream'>;
  diagnostics: Pick<DiagnosticLogger, 'write'>;
  principal: RequestContext['principal'];
  signal: RequestContext['signal'];
  pins: Pick<PostgresContentPins, 'acquire'>;
}
export function createContentSender(dependencies: ContentServices) {
  const { service, downloadGate, downloadBandwidth, diagnostics, principal, signal, pins } =
    dependencies;
  const sendContent = async (
    request: FastifyRequest,
    reply: FastifyReply,
    repository: string,
    id: string,
  ) => {
    const releaseSlot = await downloadGate.acquire(principal(request).id, signal(request, reply));
    let released = false;
    const release = (): void => {
      if (!released) {
        releaseSlot();
        released = true;
      }
    };
    reply.raw.once('close', release);
    let pin: Awaited<ReturnType<PostgresContentPins['acquire']>> | undefined;
    let streaming = false;
    try {
      pin = await pins.acquire(id);
      signal(request, reply).throwIfAborted();
      const result = await service.download(principal(request), repository, id);
      const { size, sha256, name } = result.upload.descriptor;
      const etag = `"sha256:${sha256}"`;
      reply
        .header('ETag', etag)
        .header('Accept-Ranges', 'bytes')
        .header('Content-Type', 'application/octet-stream')
        .header(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(Buffer.from(name).toString('utf8')).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
        );
      if (matchesEtag(request.headers['if-none-match'], etag)) return await reply.code(304).send();
      const range =
        request.method === 'HEAD' ||
        (request.headers['if-range'] !== undefined && request.headers['if-range'] !== etag)
          ? ({ kind: 'full' } as const)
          : parseRange(request.headers.range, size);
      if (range.kind === 'unsatisfiable')
        return await reply
          .code(416)
          .header('Content-Range', `bytes */${String(size)}`)
          .header('Content-Length', '0')
          .send();
      if (range.kind === 'partial')
        reply
          .code(206)
          .header(
            'Content-Range',
            `bytes ${String(range.start)}-${String(range.end)}/${String(size)}`,
          )
          .header('Content-Length', String(range.end - range.start + 1));
      else reply.header('Content-Length', String(size));
      if (request.method === 'HEAD') return await reply.send();
      const stream = downloadStream(
        downloadBandwidth.stream(
          protectedContent(result.read(range.kind === 'partial' ? range : undefined), pin.check),
          principal(request).id,
          signal(request, reply),
        ),
        request,
        signal(request, reply),
        diagnostics,
      );
      const held = pin;
      const closeSource = () => stream.destroy();
      reply.raw.once('close', closeSource);
      stream.once('close', () => {
        reply.raw.removeListener('close', closeSource);
        void held.release();
      });
      streaming = true;
      return await reply.send(stream);
    } catch (error) {
      release();
      throw error;
    } finally {
      if (!streaming) await pin?.release();
    }
  };

  return sendContent;
}
async function* protectedContent(source: AsyncIterable<Uint8Array>, check: () => void) {
  check();
  for await (const chunk of source) {
    check();
    yield chunk;
  }
  check();
}
export function registerDownloadRoutes(
  app: FastifyInstance,
  legacy: Pick<ProGetDownloads, 'common' | 'universal' | 'asset'>,
  principal: RequestContext['principal'],
  sendContent: ReturnType<typeof createContentSender>,
) {
  type Params = { repository: string; id: string };
  const base = '/api/v1/repositories/:repository';
  app.route<{ Params: Params }>({
    method: ['GET', 'HEAD'],
    url: base + '/artifacts/:id/content',
    handler: (request, reply) =>
      sendContent(request, reply, request.params.repository, request.params.id),
  });

  app.route<{ Params: { repository: string }; Querystring: unknown }>({
    method: ['GET', 'HEAD'],
    url: '/api/packages/:repository/download',
    handler: async (request, reply) =>
      sendContent(
        request,
        reply,
        request.params.repository,
        await legacy.common(principal(request), request.params.repository, request.query),
      ),
  });
  app.route<{ Params: { repository: string; '*': string }; Querystring: unknown }>({
    method: ['GET', 'HEAD'],
    url: '/upack/:repository/download/*',
    handler: async (request, reply) =>
      sendContent(
        request,
        reply,
        request.params.repository,
        await legacy.universal(
          principal(request),
          request.params.repository,
          request.params['*'],
          request.query,
        ),
      ),
  });
  app.route<{ Params: { repository: string; '*': string } }>({
    method: ['GET', 'HEAD'],
    url: '/endpoints/:repository/content/*',
    handler: async (request, reply) =>
      sendContent(
        request,
        reply,
        request.params.repository,
        await legacy.asset(principal(request), request.params.repository, request.params['*']),
      ),
  });
}
