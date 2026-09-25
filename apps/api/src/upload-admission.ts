import type { FastifyRequest } from 'fastify';
import { DepotError } from '@proanima/depot-domain';
import type { AdmissionQueue } from '@proanima/depot-infrastructure';
import type { RequestContext } from './request-context.js';

export function createUploadAdmission(
  uploadGate: Pick<AdmissionQueue, 'acquire'>,
  context: Pick<RequestContext, 'principal' | 'requestSignal'>,
  available: () => boolean,
) {
  const { principal } = context;
  const modifying = async <T>(request: FastifyRequest, action: () => Promise<T>): Promise<T> => {
    const abort = new AbortController();
    const cancel = () => {
      abort.abort();
    };
    request.raw.once('aborted', cancel);
    let release: (() => void) | undefined;
    try {
      const requestSignal = context.requestSignal(request);
      release = await uploadGate.acquire(
        principal(request).id,
        requestSignal ? AbortSignal.any([abort.signal, requestSignal]) : abort.signal,
      );
      if (!available()) throw new DepotError('unavailable', 'Gateway ownership lost');
      return await action();
    } finally {
      release?.();
      request.raw.removeListener('aborted', cancel);
    }
  };

  return modifying;
}
