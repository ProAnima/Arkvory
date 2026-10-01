import type { ErrorCode, ErrorDetail, ErrorReason } from '@proanima/arkvory-domain';
import type { FailureCause } from '@proanima/arkvory-infrastructure';

/** A classified failure before it becomes the wire envelope (ADR 0051). */
export interface HttpFailure {
  readonly code: ErrorCode;
  readonly message: string;
  readonly reason?: ErrorReason;
  readonly details?: readonly ErrorDetail[];
  readonly retryAfterSeconds?: number;
  /** Present only for failures that did not originate as a deliberate ArkvoryError. */
  readonly cause?: FailureCause;
}
