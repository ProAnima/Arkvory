import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  MAX_OCI_MANIFEST_BYTES,
  OciError,
  ociManifestTypes,
  parseOciPath,
} from '@proanima/arkvory-domain';
import type { OciPath } from '@proanima/arkvory-domain';
import type { BandwidthGovernor, DiagnosticLogger } from '@proanima/arkvory-infrastructure';
import type { RequestContext } from './request-context.js';
import type { createContentSender } from './download-routes.js';
import type { resolveUploadTimeouts } from './upload-policy.js';
import { UploadReceiver } from './upload-lifetime.js';
import { registerOciErrors, registryRoute, registryVersion } from './oci-errors.js';
import { handleUpload } from './oci-uploads.js';
import type { UploadServices } from './oci-uploads.js';

interface Registry extends Omit<UploadServices, 'receiver' | 'deadlineMs' | 'onDeadline'> {
  readonly context: Pick<RequestContext, 'recordError'>;
  readonly sendContent: ReturnType<typeof createContentSender>;
  readonly bandwidth: Pick<BandwidthGovernor, 'stream'>;
  readonly policy: ReturnType<typeof resolveUploadTimeouts>;
  readonly diagnostics: Pick<DiagnosticLogger, 'write'>;
  readonly role: 'api' | 'reader';
}
type Routed<K extends OciPath['route']['kind']> = OciPath & {
  readonly route: Extract<OciPath['route'], { kind: K }>;
};
const maxTags = 1000;
const notAllowed = () => new OciError('UNSUPPORTED', 'Method not allowed', 405);

function pageSize(request: FastifyRequest): { n: number; last: string | null } {
  const query: unknown = request.query;
  const read = (name: string) => {
    const value: unknown =
      query && typeof query === 'object' ? Reflect.get(query, name) : undefined;
    return typeof value === 'string' ? value : undefined;
  };
  const n = read('n');
  if (n !== undefined && !/^[1-9][0-9]{0,3}$/.test(n))
    throw new OciError('UNSUPPORTED', 'Invalid page size', 400);
  return { n: Math.min(Number(n ?? 100), maxTags), last: read('last') ?? null };
}

async function tags(s: Registry, request: FastifyRequest, reply: FastifyReply, path: OciPath) {
  if (request.method !== 'GET' && request.method !== 'HEAD') throw notAllowed();
  const { n, last } = pageSize(request);
  const name = `${path.repository}/${path.image}`;
  const page = await s.registry.tags(s.principal(request), path.repository, path.image, last, n);
  const end = page.at(-1);
  if (page.length === n && end !== undefined)
    reply.header(
      'Link',
      `</v2/${name}/tags/list?n=${String(n)}&last=${encodeURIComponent(end)}>; rel="next"`,
    );
  return reply.send({ name, tags: page });
}

async function manifest(
  s: Registry,
  request: FastifyRequest,
  reply: FastifyReply,
  path: Routed<'manifest'>,
) {
  const { repository, image } = path;
  const reference = path.route.reference;
  const principal = s.principal(request);
  if (request.method === 'GET' || request.method === 'HEAD') {
    const found = await s.registry.manifest(principal, repository, image, reference);
    const body = Buffer.concat(found.chunks);
    reply
      .header('Content-Type', found.mediaType)
      .header('Docker-Content-Digest', found.digest)
      .header('ETag', `"${found.digest}"`)
      .header('Content-Length', String(body.byteLength));
    return request.method === 'HEAD' ? reply.send() : reply.send(body);
  }
  if (request.method === 'DELETE') {
    await s.modifying(request, () =>
      s.registry.deleteManifest(principal, repository, image, reference),
    );
    return reply.code(202).send();
  }
  if (request.method !== 'PUT') throw notAllowed();
  const bytes = request.body;
  if (!Buffer.isBuffer(bytes))
    throw new OciError('MANIFEST_INVALID', 'Manifest needs a manifest media type', 415);
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const contentType = request.headers['content-type'];
  await s.modifying(request, () =>
    s.registry.putManifest(
      principal,
      { repository, image, reference },
      { bytes, text: bytes.toString('utf8'), contentType, digest },
      s.signal(request, reply),
    ),
  );
  return reply
    .code(201)
    .header('Location', `/v2/${repository}/${image}/manifests/${digest}`)
    .header('Docker-Content-Digest', digest)
    .header('Content-Length', '0')
    .send();
}

async function blob(s: Registry, request: FastifyRequest, reply: FastifyReply, path: OciPath) {
  if (path.route.kind !== 'blob') throw notAllowed();
  // Blobs leave the registry only with the manifests that stop referencing them (ADR 0063).
  if (request.method !== 'GET' && request.method !== 'HEAD') throw notAllowed();
  const digest = path.route.digest;
  const found = await s.registry.blob(s.principal(request), path.repository, digest);
  reply.header('Docker-Content-Digest', digest);
  return s.sendContent(request, reply, path.repository, found.artifactId);
}

function dispatch(s: Registry, services: UploadServices) {
  return async (request: FastifyRequest<{ Params: { '*': string } }>, reply: FastifyReply) => {
    const rest = request.params['*'];
    // The version check: authenticated callers learn that this is a registry.
    if (rest === '') {
      if (request.method !== 'GET' && request.method !== 'HEAD') throw notAllowed();
      return reply.send({});
    }
    const path = parseOciPath(rest);
    switch (path.route.kind) {
      case 'tags':
        return tags(s, request, reply, path);
      case 'manifest':
        return manifest(s, request, reply, { ...path, route: path.route });
      case 'uploads':
      case 'upload':
        return handleUpload(services, request, reply, { ...path, route: path.route });
      case 'blob':
        return blob(s, request, reply, path);
    }
  };
}

/**
 * The OCI Distribution API under /v2 (ADR 0063), in its own scope: manifests are parsed as
 * bounded buffers, blob bytes pass as streams of any media type, and every refusal uses the
 * registry's error envelope. A read gateway serves pulls only.
 */
export function registerOciRoutes(app: FastifyInstance, s: Registry) {
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
  const services: UploadServices = {
    ...s,
    receiver: new UploadReceiver(s.policy, s.bandwidth, report),
    deadlineMs: s.policy.uploadDeadlineMs,
    onDeadline: (request) => {
      report(request, 'upload.deadline');
    },
  };
  void app.register((scope, _options, done) => {
    registerOciErrors(scope, s.context);
    // Blob bodies stay streams whatever type a client declares; only manifests are parsed.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      [...ociManifestTypes],
      { parseAs: 'buffer', bodyLimit: MAX_OCI_MANIFEST_BYTES },
      (_request, body, parsed) => {
        parsed(null, body);
      },
    );
    scope.addContentTypeParser('*', (_request, payload, parsed) => {
      parsed(null, payload);
    });
    scope.addHook('onSend', (_request, reply, payload, sent) => {
      reply.header(...registryVersion);
      sent(null, payload);
    });
    const reads = ['GET', 'HEAD'];
    scope.route({
      method: s.role === 'reader' ? reads : [...reads, 'POST', 'PUT', 'PATCH', 'DELETE'],
      url: registryRoute,
      handler: dispatch(s, services),
    });
    done();
  });
}
