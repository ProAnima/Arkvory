import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ArtifactCatalog, StorageService } from '@proanima/arkvory-application';
import type {
  AdmissionQueue,
  BandwidthGovernor,
  DiagnosticLogger,
  PostgresContentPins,
} from '@proanima/arkvory-infrastructure';
import { ArkvoryError } from '@proanima/arkvory-domain';
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
      // Metadata resolution can outlive cancellation or the session protecting this blob.
      signal(request, reply).throwIfAborted();
      pin.check();
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
        protectedContent(
          downloadBandwidth.stream(
            protectedContent(result.read(range.kind === 'partial' ? range : undefined), pin.check),
            principal(request).id,
            signal(request, reply),
          ),
          // Pacing may hold a chunk after its disk read; recheck before each emitted quantum.
          pin.check,
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
const packageQuery = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    group: { type: 'string', maxLength: 128 },
    name: { type: 'string', minLength: 1, maxLength: 128 },
    version: { type: 'string', minLength: 1, maxLength: 128 },
  },
} as const;
const assetQuery = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: { path: { type: 'string', minLength: 1, maxLength: 1024 } },
} as const;

export function registerDownloadRoutes(
  app: FastifyInstance,
  browse: Pick<ArtifactCatalog, 'resolvePackage' | 'resolveAssetContent'>,
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
  // Name-based reads resolve per request; clients resuming with Range must pin the returned ETag.
  app.route<{
    Params: { repository: string };
    Querystring: { group?: string; name: string; version?: string };
  }>({
    method: ['GET', 'HEAD'],
    url: base + '/packages/content',
    schema: { querystring: packageQuery },
    handler: async (request, reply) => {
      const { repository } = request.params;
      const { group = '', name, version } = request.query;
      const id = await browse.resolvePackage(principal(request), repository, group, name, version);
      if (!id) throw new ArkvoryError('not_found', 'Package not found');
      return sendContent(request, reply, repository, id);
    },
  });
  app.route<{ Params: { repository: string }; Querystring: { path: string } }>({
    method: ['GET', 'HEAD'],
    url: base + '/asset/content',
    schema: { querystring: assetQuery },
    handler: async (request, reply) => {
      const { repository } = request.params;
      const entry = await browse.resolveAssetContent(
        principal(request),
        repository,
        request.query.path,
      );
      return sendContent(request, reply, repository, entry.artifactId);
    },
  });
}
