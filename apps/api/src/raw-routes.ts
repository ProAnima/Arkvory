import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { ArtifactCatalog, RawFiles } from '@proanima/arkvory-application';
import type { BandwidthGovernor, DiagnosticLogger } from '@proanima/arkvory-infrastructure';
import type { RequestContext } from './request-context.js';
import type { createContentSender } from './download-routes.js';
import type { resolveUploadTimeouts } from './upload-policy.js';
import { UploadReceiver } from './upload-lifetime.js';

interface Raw {
  readonly raw: RawFiles;
  readonly browse: Pick<ArtifactCatalog, 'resolveAssetContent'>;
  readonly principal: RequestContext['principal'];
  readonly signal: RequestContext['signal'];
  readonly modifying: <T>(request: FastifyRequest, action: () => Promise<T>) => Promise<T>;
  readonly sendContent: ReturnType<typeof createContentSender>;
  readonly bandwidth: Pick<BandwidthGovernor, 'stream'>;
  readonly policy: ReturnType<typeof resolveUploadTimeouts>;
  readonly diagnostics: Pick<DiagnosticLogger, 'write'>;
}
type Params = { repository: string; '*': string };
const route = '/api/v1/repositories/:repository/raw/*';

/** Content-Length, X-Checksum-Sha256 and If-None-Match of a raw PUT; malformed values refuse. */
function uploadOf(request: FastifyRequest) {
  const length = request.headers['content-length'];
  const checksum = request.headers['x-checksum-sha256'];
  const match = request.headers['if-none-match'];
  if (length !== undefined && !/^(0|[1-9][0-9]{0,15})$/.test(length))
    throw new ArkvoryError('invalid_input', 'Invalid Content-Length');
  if (
    checksum !== undefined &&
    (typeof checksum !== 'string' || !/^[a-fA-F0-9]{64}$/.test(checksum))
  )
    throw new ArkvoryError('invalid_input', 'X-Checksum-Sha256 must be 64 hex digits');
  if (match !== undefined && match !== '*')
    throw new ArkvoryError('invalid_input', 'If-None-Match accepts only "*" here');
  return {
    size: length === undefined ? null : Number(length),
    sha256: checksum === undefined ? null : checksum.toLowerCase(),
    createOnly: match === '*',
  };
}

/**
 * Raw files by path (ADR 0064): PUT stores the body as the path's new revision, GET and HEAD
 * read the current one with Range and ETag. In its own scope, because the body of any media type
 * is a stream here (curl -T sends none, PowerShell its own), unlike the JSON routes.
 */
export function registerRawRoutes(app: FastifyInstance, s: Raw) {
  const report = (request: FastifyRequest, code: 'upload.input_timeout' | 'upload.deadline') => {
    s.diagnostics.write({
      level: 'warning',
      component: 'http',
      code,
      requestId: request.id,
      route: request.routeOptions.url ?? 'unknown',
      method: request.method,
    });
  };
  const receiver = new UploadReceiver(s.policy, s.bandwidth, report);
  const put = async (request: FastifyRequest<{ Params: Params }>, reply: FastifyReply) => {
    const { repository } = request.params;
    const path = request.params['*'];
    const upload = uploadOf(request);
    if (!(request.body instanceof Readable)) request.body = Readable.from([]);
    const principal = s.principal(request);
    let result;
    try {
      result = await s.modifying(request, () =>
        receiver.receive(request, reply, principal.id, s.signal(request, reply), (source, signal) =>
          s.raw.put(principal, repository, path, source, upload, signal),
        ),
      );
    } catch (error) {
      reply.header('Connection', 'close');
      throw error;
    }
    // The path held these bytes: the body was not read, so the connection cannot be reused.
    if (!result.consumed) reply.header('Connection', 'close');
    return reply.code(result.created ? 201 : 200).send({
      path: result.path,
      revision: result.revision,
      created: result.created,
      artifact: { ...result.artifact, size: String(result.artifact.size) },
    });
  };
  const get = async (request: FastifyRequest<{ Params: Params }>, reply: FastifyReply) => {
    const { repository } = request.params;
    const entry = await s.browse.resolveAssetContent(
      s.principal(request),
      repository,
      request.params['*'],
    );
    reply.header('X-Arkvory-Artifact-Id', entry.artifactId);
    return s.sendContent(request, reply, repository, entry.artifactId);
  };
  void app.register((scope, _options, done) => {
    // Every media type is the file's bytes here: a JSON file is stored, not parsed.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (_request, payload, parsed) => {
      parsed(null, payload);
    });
    scope.route<{ Params: Params }>({ method: 'PUT', url: route, handler: put });
    scope.route<{ Params: Params }>({ method: ['GET', 'HEAD'], url: route, handler: get });
    done();
  });
}
