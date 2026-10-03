import { Readable } from 'node:stream';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { OciError, ociDigest } from '@proanima/arkvory-domain';
import type { OciPath } from '@proanima/arkvory-domain';
import type { OciRegistry } from '@proanima/arkvory-application';
import type { RequestContext } from './request-context.js';
import type { UploadReceiver } from './upload-lifetime.js';
import { withUploadDeadline } from './upload-lifetime.js';

export interface UploadServices {
  readonly registry: OciRegistry;
  readonly principal: RequestContext['principal'];
  readonly signal: RequestContext['signal'];
  readonly modifying: <T>(request: FastifyRequest, action: () => Promise<T>) => Promise<T>;
  readonly receiver: UploadReceiver;
  readonly deadlineMs: number;
  readonly onDeadline: (request: FastifyRequest) => void;
}
type Path = OciPath & { readonly route: { readonly kind: 'uploads' | 'upload' } };

const nameOf = (path: OciPath) => `${path.repository}/${path.image}`;
const uploadUrl = (path: OciPath, id: string) => `/v2/${nameOf(path)}/blobs/uploads/${id}`;
/** Inclusive end of the received bytes, as registries report it; empty uploads say 0-0. */
const rangeOf = (size: number) => `0-${String(Math.max(size - 1, 0))}`;

function queryValue(request: FastifyRequest, name: string): string | undefined {
  const query: unknown = request.query;
  if (!query || typeof query !== 'object' || !(name in query)) return undefined;
  const value: unknown = Reflect.get(query, name);
  return typeof value === 'string' ? value : undefined;
}
/** `Content-Range: <start>-<end>` of a chunk; its start must be the bytes received so far. */
function chunkOffset(request: FastifyRequest): number | undefined {
  const header = request.headers['content-range'];
  if (header === undefined) return undefined;
  const match = /^(?:bytes )?(\d{1,15})-(\d{1,15})$/.exec(header);
  if (!match?.[1]) throw new OciError('BLOB_UPLOAD_INVALID', 'Invalid Content-Range', 416);
  return Number(match[1]);
}
const hasBody = (request: FastifyRequest) => request.body instanceof Readable;

function accepted(reply: FastifyReply, path: OciPath, id: string, size: number) {
  return reply
    .code(202)
    .header('Location', uploadUrl(path, id))
    .header('Range', rangeOf(size))
    .header('Docker-Upload-UUID', id)
    .header('Content-Length', '0')
    .send();
}

/** Receives a chunk under the upload admission; unread bodies close the connection. */
async function appendBody(
  s: UploadServices,
  request: FastifyRequest,
  reply: FastifyReply,
  path: OciPath,
  id: string,
  offset: number | undefined,
): Promise<number> {
  const principal = s.principal(request);
  const target = { repository: path.repository, image: path.image, id };
  try {
    return await s.modifying(request, () =>
      s.receiver.receive(request, reply, principal.id, s.signal(request, reply), (source, signal) =>
        s.registry.append(principal, target, offset, source, signal),
      ),
    );
  } catch (error) {
    reply.header('Connection', 'close');
    throw error;
  }
}

/** Publishes the staged bytes as a blob; may copy gigabytes, so it runs under the deadline. */
async function finish(
  s: UploadServices,
  request: FastifyRequest,
  reply: FastifyReply,
  path: OciPath,
  id: string,
) {
  const digest = ociDigest(queryValue(request, 'digest') ?? '');
  if (hasBody(request)) await appendBody(s, request, reply, path, id, undefined);
  const target = { repository: path.repository, image: path.image, id };
  await s.modifying(request, () =>
    withUploadDeadline(
      request,
      reply,
      s.signal(request, reply),
      s.deadlineMs,
      (signal) => s.registry.finish(s.principal(request), target, digest, signal),
      () => {
        s.onDeadline(request);
      },
    ),
  );
  return reply
    .code(201)
    .header('Location', `/v2/${nameOf(path)}/blobs/${digest}`)
    .header('Docker-Content-Digest', digest)
    .header('Content-Length', '0')
    .send();
}

/** POST …/blobs/uploads/: a session, or a whole blob at once with `?digest=`. */
async function start(s: UploadServices, request: FastifyRequest, reply: FastifyReply, path: Path) {
  // A cross-repository mount is answered as a plain upload, which the specification allows.
  const principal = s.principal(request);
  const id = await s.modifying(request, () =>
    s.registry.startUpload(principal, path.repository, path.image),
  );
  if (queryValue(request, 'digest') !== undefined) return finish(s, request, reply, path, id);
  return accepted(reply, path, id, 0);
}

export async function handleUpload(
  s: UploadServices,
  request: FastifyRequest,
  reply: FastifyReply,
  path: Path,
) {
  if (path.route.kind === 'uploads') {
    if (request.method !== 'POST') throw new OciError('UNSUPPORTED', 'Method not allowed', 405);
    return start(s, request, reply, path);
  }
  const id = path.route.upload;
  const target = { repository: path.repository, image: path.image, id };
  switch (request.method) {
    case 'GET': {
      const state = await s.registry.upload(s.principal(request), target);
      return reply
        .code(204)
        .header('Location', uploadUrl(path, id))
        .header('Range', rangeOf(state.received))
        .header('Docker-Upload-UUID', id)
        .send();
    }
    case 'PATCH': {
      const offset = chunkOffset(request);
      const size = hasBody(request)
        ? await appendBody(s, request, reply, path, id, offset)
        : (await s.registry.upload(s.principal(request), target)).received;
      return accepted(reply, path, id, size);
    }
    case 'PUT':
      return finish(s, request, reply, path, id);
    case 'DELETE':
      await s.modifying(request, () => s.registry.cancel(s.principal(request), target));
      return reply.code(204).send();
    default:
      throw new OciError('UNSUPPORTED', 'Method not allowed', 405);
  }
}
