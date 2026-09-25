import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { StorageService, CompletionQueue } from '@proanima/depot-application';
import type { Principal } from '@proanima/depot-domain';
import { DepotError, PART_BYTES } from '@proanima/depot-domain';
import { descriptorSchema, uploadSchema } from '@proanima/depot-contracts';
import { wireUpload } from './upload-response.js';
import { UploadReceiver, withUploadDeadline } from './upload-lifetime.js';
import type { BandwidthGovernor, DiagnosticLogger } from '@proanima/depot-infrastructure';
import type { resolveUploadTimeouts } from './upload-policy.js';

interface Services {
  storage: StorageService;
  queue: CompletionQueue;
  principal: (request: FastifyRequest) => Principal;
  signal: (request: FastifyRequest, reply: FastifyReply) => AbortSignal;
  modifying: <T>(request: FastifyRequest, action: () => Promise<T>) => Promise<T>;
  bandwidth: Pick<BandwidthGovernor, 'stream'>;
  policy: ReturnType<typeof resolveUploadTimeouts>;
  diagnostics: Pick<DiagnosticLogger, 'write'>;
}
type Params = { repository: string; id: string; index: string };
const base = '/api/v1/repositories/:repository';
const response = { 200: uploadSchema };

export function registerUploadRoutes(app: FastifyInstance, services: Services) {
  registerSessions(app, services);
  registerContent(app, services);
}

function registerSessions(app: FastifyInstance, s: Services) {
  app.post<{ Params: Params; Body: unknown }>(
    `${base}/uploads`,
    {
      schema: { body: descriptorSchema, response: { 201: uploadSchema } },
    },
    async (request, reply) => {
      const key = request.headers['idempotency-key'];
      if (typeof key !== 'string')
        throw new DepotError('invalid_input', 'Idempotency-Key is required');
      const result = await s.storage.create(
        s.principal(request),
        request.params.repository,
        key,
        request.body,
      );
      return reply
        .code(201)
        .header(
          'Location',
          `${base.replace(':repository', request.params.repository)}/uploads/${result.id}`,
        )
        .send(wireUpload(result));
    },
  );
  app.get<{ Params: Params }>(`${base}/uploads/:id`, { schema: { response } }, async (request) =>
    wireUpload(
      await s.storage.status(s.principal(request), request.params.repository, request.params.id),
    ),
  );
  app.delete<{ Params: Params }>(`${base}/uploads/:id`, { schema: { response } }, async (request) =>
    s.modifying(request, async () =>
      wireUpload(
        await s.storage.cancel(s.principal(request), request.params.repository, request.params.id),
      ),
    ),
  );
  app.get<{ Params: Params }>(`${base}/uploads/:id/parts`, async (request) => ({
    partBytes: PART_BYTES,
    items: await s.storage.parts(
      s.principal(request),
      request.params.repository,
      request.params.id,
    ),
  }));
  app.post<{ Params: Params }>(`${base}/uploads/:id/complete-async`, async (request, reply) =>
    reply
      .code(202)
      .send(
        await s.queue.enqueue(s.principal(request), request.params.repository, request.params.id),
      ),
  );
  app.get<{ Params: { id: string } }>('/api/v1/jobs/:id', async (request) =>
    s.queue.get(s.principal(request), request.params.id),
  );
}

function registerContent(app: FastifyInstance, s: Services) {
  const report = (request: FastifyRequest, code: 'upload.input_timeout' | 'upload.deadline') => {
    s.diagnostics.write({
      level: 'warning',
      component: 'api',
      code,
      requestId: request.id,
      route: request.routeOptions.url ?? 'unknown',
      method: request.method,
    });
  };
  const receiver = new UploadReceiver(s.policy, s.bandwidth, report);
  const receive = async <T>(
    request: FastifyRequest,
    reply: FastifyReply,
    action: (source: AsyncIterable<Uint8Array>, signal: AbortSignal) => Promise<T>,
  ) => {
    try {
      return await s.modifying(request, () =>
        receiver.receive(request, reply, s.principal(request).id, s.signal(request, reply), action),
      );
    } catch (error) {
      // Admission can reject before the receiver starts; unread bodies must close in both cases.
      reply.header('Connection', 'close');
      throw error;
    }
  };
  app.put<{ Params: Params }>(
    `${base}/uploads/:id/content`,
    { schema: { response } },
    async (request, reply) =>
      wireUpload(
        await receive(request, reply, (source, signal) =>
          s.storage.upload(
            s.principal(request),
            request.params.repository,
            request.params.id,
            source,
            signal,
          ),
        ),
      ),
  );
  app.put<{ Params: Params }>(`${base}/uploads/:id/parts/:index`, async (request, reply) => {
    const hash = request.headers['x-content-sha256'];
    if (!/^\d{1,3}$/.test(request.params.index) || typeof hash !== 'string') {
      reply.header('Connection', 'close');
      throw new DepotError('invalid_input', 'Invalid part request');
    }
    await receive(request, reply, (source, signal) =>
      s.storage.uploadPart(
        s.principal(request),
        request.params.repository,
        request.params.id,
        Number(request.params.index),
        hash,
        source,
        signal,
      ),
    );
    return reply.code(204).send();
  });
  app.post<{ Params: Params }>(
    `${base}/uploads/:id/complete`,
    { schema: { response } },
    async (request, reply) =>
      s.modifying(request, async () =>
        wireUpload(
          await withUploadDeadline(
            request,
            reply,
            s.signal(request, reply),
            s.policy.uploadDeadlineMs,
            (signal) =>
              s.storage.complete(
                s.principal(request),
                request.params.repository,
                request.params.id,
                signal,
              ),
            () => {
              report(request, 'upload.deadline');
            },
          ),
        ),
      ),
  );
}
