import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { LfsError } from '@proanima/arkvory-domain';
import type { GitLfs, LfsLock } from '@proanima/arkvory-application';
import type { BandwidthGovernor, DiagnosticLogger } from '@proanima/arkvory-infrastructure';
import type { RequestContext } from './request-context.js';
import type { createContentSender } from './download-routes.js';
import type { resolveUploadTimeouts } from './upload-policy.js';
import { UploadReceiver } from './upload-lifetime.js';
import { lfsMediaType, registerLfsErrors } from './lfs-errors.js';

interface Lfs {
  readonly lfs: GitLfs;
  readonly principal: RequestContext['principal'];
  readonly signal: RequestContext['signal'];
  readonly context: Pick<RequestContext, 'recordError'>;
  readonly modifying: <T>(request: FastifyRequest, action: () => Promise<T>) => Promise<T>;
  readonly sendContent: ReturnType<typeof createContentSender>;
  readonly bandwidth: Pick<BandwidthGovernor, 'stream'>;
  readonly policy: ReturnType<typeof resolveUploadTimeouts>;
  readonly diagnostics: Pick<DiagnosticLogger, 'write'>;
}
type Repository = { repository: string };
type ObjectParams = Repository & { oid: string };
type Lock = Repository & { id: string };
const base = '/lfs/:repository';
/** Actions stay valid for an hour; git-lfs asks the batch again when they expire. */
const actionSeconds = 3600;

const wireLock = (lock: LfsLock) => ({
  id: lock.id,
  path: lock.path,
  locked_at: lock.lockedAt,
  owner: { name: lock.ownerName },
});
const json = (reply: FastifyReply, status: number, body: unknown) =>
  reply.code(status).header('Content-Type', lfsMediaType).send(body);

/**
 * Hrefs of the basic transfer on this server. The client's own Authorization goes back in the
 * action header: git-lfs then sends the object request with it, over the same TLS connection
 * it came from; nothing else learns the credential.
 */
function action(request: FastifyRequest<{ Params: Repository }>, oid: string) {
  const origin = `${request.protocol}://${request.host}`;
  const authorization = request.headers.authorization;
  return {
    href: `${origin}/lfs/${encodeURIComponent(request.params.repository)}/objects/${oid}`,
    ...(authorization ? { header: { Authorization: authorization } } : {}),
    expires_in: actionSeconds,
  };
}

function objectRoutes(scope: FastifyInstance, s: Lfs, receiver: UploadReceiver) {
  scope.post<{ Params: Repository }>(`${base}/objects/batch`, async (request, reply) => {
    const result = await s.lfs.batch(s.principal(request), request.params.repository, request.body);
    const objects = result.objects.map(({ oid, size, present }) => {
      if (result.operation === 'upload')
        return present
          ? { oid, size }
          : { oid, size, authenticated: true, actions: { upload: action(request, oid) } };
      return present
        ? { oid, size, authenticated: true, actions: { download: action(request, oid) } }
        : { oid, size, error: { code: 404, message: 'Object does not exist' } };
    });
    return json(reply, 200, { transfer: 'basic', hash_algo: 'sha256', objects });
  });
  scope.put<{ Params: ObjectParams }>(`${base}/objects/:oid`, async (request, reply) => {
    const length = request.headers['content-length'];
    if (length === undefined || !/^(0|[1-9][0-9]{0,15})$/.test(length))
      throw new LfsError(422, 'Content-Length is required');
    if (!(request.body instanceof Readable)) request.body = Readable.from([]);
    const principal = s.principal(request);
    const { repository, oid } = request.params;
    const object = { oid, size: Number(length) };
    const result = await s.modifying(request, () =>
      receiver.receive(request, reply, principal.id, s.signal(request, reply), (source, signal) =>
        s.lfs.upload(principal, repository, object, source, signal),
      ),
    );
    // Stored already: the body was not read, so this connection cannot carry another request.
    if (!result.consumed) reply.header('Connection', 'close');
    return reply.code(200).send();
  });
  scope.route<{ Params: ObjectParams }>({
    method: ['GET', 'HEAD'],
    url: `${base}/objects/:oid`,
    handler: async (request, reply) => {
      const { repository, oid } = request.params;
      const artifactId = await s.lfs.object(s.principal(request), repository, oid);
      return s.sendContent(request, reply, repository, artifactId);
    },
  });
}

function lockRoutes(scope: FastifyInstance, s: Lfs) {
  scope.post<{ Params: Repository }>(`${base}/locks`, async (request, reply) => {
    const { created, lock } = await s.lfs.lock(
      s.principal(request),
      request.params.repository,
      request.body,
    );
    return created
      ? json(reply, 201, { lock: wireLock(lock) })
      : json(reply, 409, {
          lock: wireLock(lock),
          message: 'already created lock',
          request_id: request.id,
        });
  });
  scope.get<{ Params: Repository; Querystring: Record<string, unknown> }>(
    `${base}/locks`,
    async (request, reply) => {
      const page = await s.lfs.listLocks(
        s.principal(request),
        request.params.repository,
        request.query,
      );
      return json(reply, 200, {
        locks: page.locks.map(wireLock),
        ...(page.next ? { next_cursor: page.next } : {}),
      });
    },
  );
  scope.post<{ Params: Repository }>(`${base}/locks/verify`, async (request, reply) => {
    const page = await s.lfs.verifyLocks(
      s.principal(request),
      request.params.repository,
      request.body,
    );
    return json(reply, 200, {
      ours: page.ours.map(wireLock),
      theirs: page.theirs.map(wireLock),
      ...(page.next ? { next_cursor: page.next } : {}),
    });
  });
  scope.post<{ Params: Lock }>(`${base}/locks/:id/unlock`, async (request, reply) => {
    const { repository, id } = request.params;
    const lock = await s.lfs.unlock(s.principal(request), repository, id, request.body);
    return json(reply, 200, { lock: wireLock(lock) });
  });
}

/**
 * Git LFS (ADR 0065) for a repository at `/lfs/<repository>`, the `lfs.url` of a git repository:
 * the batch API, the basic transfer and file locking, in their own scope with git-lfs media
 * types and error documents. The objects are artifacts; transfers share admission, bandwidth
 * and deadlines with every other upload and download.
 */
export function registerLfsRoutes(app: FastifyInstance, s: Lfs) {
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
  void app.register((scope, _options, done) => {
    registerLfsErrors(scope, s.context);
    scope.addContentTypeParser(
      lfsMediaType,
      { parseAs: 'string', bodyLimit: 1024 * 1024 },
      (_request, body, parsed) => {
        try {
          parsed(null, JSON.parse(String(body)));
        } catch {
          parsed(new LfsError(422, 'The request is not JSON'), undefined);
        }
      },
    );
    scope.addContentTypeParser('*', (_request, payload, parsed) => {
      parsed(null, payload);
    });
    objectRoutes(scope, s, receiver);
    lockRoutes(scope, s);
    done();
  });
}
