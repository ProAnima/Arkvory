import type { FastifyRequest } from 'fastify';
import type { BandwidthGovernor, DiagnosticLogger } from '@proanima/arkvory-infrastructure';
import type { RequestContext } from './request-context.js';
import type { createContentSender } from './download-routes.js';
import type { resolveUploadTimeouts } from './upload-policy.js';

/** What every protocol's transfers share: admission, bandwidth, deadlines and downloads. */
export interface ProtocolTransfers {
  readonly principal: RequestContext['principal'];
  readonly signal: RequestContext['signal'];
  readonly context: Pick<RequestContext, 'recordError'>;
  readonly modifying: <T>(request: FastifyRequest, action: () => Promise<T>) => Promise<T>;
  readonly sendContent: ReturnType<typeof createContentSender>;
  readonly bandwidth: Pick<BandwidthGovernor, 'stream'>;
  readonly policy: ReturnType<typeof resolveUploadTimeouts>;
  readonly diagnostics: Pick<DiagnosticLogger, 'write'>;
}
