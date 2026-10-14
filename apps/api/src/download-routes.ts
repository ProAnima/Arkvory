import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type {
  ArtifactCatalog,
  PackageResolver,
  StorageService,
} from '@proanima/arkvory-application';
import type {
  BandwidthGovernor,
  DiagnosticLogger,
  PostgresContentPins,
} from '@proanima/arkvory-infrastructure';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { RequestContext } from './request-context.js';
import { downloadStream } from './download-stream.js';
import { matchesEtag, parseRange } from './range.js';
import { sendFailure } from './http-errors.js';
import type { ContentAdmission, DownloadAdmission } from './download-admission.js';

interface ContentServices {
  service: Pick<StorageService, 'download'>;
  admit: DownloadAdmission;
  downloadBandwidth: Pick<BandwidthGovernor, 'stream'>;
  diagnostics: Pick<DiagnosticLogger, 'write'>;
  principal: RequestContext['principal'];
  signal: RequestContext['signal'];
  pins: Pick<PostgresContentPins, 'acquire'>;
}
export function createContentSender(dependencies: ContentServices) {
  const { service, admit, downloadBandwidth, diagnostics, principal, signal, pins } = dependencies;
  const sendContent = async (
    request: FastifyRequest,
    reply: FastifyReply,
    repository: string,
    id: string,
  ) => {
    // Admission comes after authorization and metadata: refused, 304 and HEAD take no place.
    let admission: ContentAdmission | undefined;
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
      if (range.kind === 'unsatisfiable') {
        // The JSON envelope replaces the staged file representation headers (ADR 0051).
        reply.removeHeader('Content-Type').removeHeader('Content-Disposition');
        reply.header('Content-Range', `bytes */${String(size)}`);
        return await sendFailure(request, reply, {
          code: 'invalid_input',
          reason: 'range_not_satisfiable',
          message: 'Requested range is not satisfiable',
        });
      }
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
      const admitted = await admit(
        request,
        reply,
        principal(request),
        id,
        size,
        range.kind === 'partial'
          ? { start: range.start, end: range.end, open: openEnded(request.headers.range) }
          : { start: 0, end: size - 1, open: true },
        signal(request, reply),
      );
      admission = admitted;
      const metered = meteredContent(
        result.read(range.kind === 'partial' ? range : undefined),
        admitted,
        reply,
      );
      const stream = downloadStream(
        protectedContent(
          downloadBandwidth.stream(
            protectedContent(metered, pin.check),
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
      admission?.end({ finished: false });
      throw error;
    } finally {
      if (!streaming) await pin?.release();
    }
  };

  return sendContent;
}
/** `bytes=X-`: from X to the end without naming it, as a resuming tool asks (ADR 0076). */
function openEnded(value: string | undefined) {
  return value !== undefined && /^bytes=[0-9]+-$/.test(value);
}

/**
 * Reports read bytes to the admission and ends it when the response closes: `finished` only when
 * the whole range was read and handed to the socket, so an aborted range never counts as
 * delivered. The session decides from its delivered ranges whether the download is complete.
 */
function meteredContent(
  source: AsyncIterable<Uint8Array>,
  admission: ContentAdmission,
  reply: FastifyReply,
) {
  let drained = false;
  let finished = false;
  reply.raw.once('finish', () => (finished = true));
  reply.raw.once('close', () => {
    admission.end({ finished: drained && finished });
  });
  return (async function* () {
    for await (const chunk of source) {
      admission.progress(chunk.byteLength);
      yield chunk;
    }
    drained = true;
  })();
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
  lookup: {
    resolver: Pick<PackageResolver, 'resolve'>;
    browse: Pick<ArtifactCatalog, 'resolveAssetContent'>;
  },
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
  app.route<{ Params: { repository: string }; Querystring: unknown }>({
    method: ['GET', 'HEAD'],
    url: base + '/packages/content',
    handler: async (request, reply) => {
      const { repository } = request.params;
      const found = await lookup.resolver.resolve(
        principal(request),
        repository,
        request.query,
        'content.read',
      );
      reply.header('X-Arkvory-Artifact-Id', found.artifactId);
      reply.header('X-Arkvory-Package-Version', found.version);
      return sendContent(request, reply, repository, found.artifactId);
    },
  });
  app.route<{ Params: { repository: string }; Querystring: unknown }>({
    method: ['GET', 'HEAD'],
    url: base + '/asset/content',
    handler: async (request, reply) => {
      const { repository } = request.params;
      const q = request.query;
      if (
        typeof q !== 'object' ||
        q === null ||
        Object.keys(q).some((key) => key !== 'path') ||
        !('path' in q) ||
        typeof q.path !== 'string'
      )
        throw new ArkvoryError('invalid_input', 'path is the only file query option');
      const entry = await lookup.browse.resolveAssetContent(principal(request), repository, q.path);
      return sendContent(request, reply, repository, entry.artifactId);
    },
  });
}
