// Architecture scaffold. Public exports are added with the first use case.
export * from './artifact.js';
export * from './lifecycle.js';
export * from './object-size.js';
export * from './promotion.js';
export * from './version-range.js';
export * from './credentials.js';
export * from './identity.js';
export * from './login-backoff.js';
export * from './service-access.js';

export * from './service-policy.js';
export * from './service-delegation.js';

export * from './attachments.js';

export * from './retention.js';

export * from './storage-policy.js';
export * from './cleanup.js';
export * from './storage-routing.js';
export * from './backup.js';
export * from './backup-manifest.js';
export {
  errorCodes,
  errorReasons,
  detailProblems,
  MAX_ERROR_DETAILS,
  isErrorReason,
  fieldError,
  withField,
  nestedFields,
} from './errors.js';
export type {
  ErrorReason,
  ErrorReasonOf,
  ErrorDetail,
  DetailProblem,
  ErrorExtra,
} from './errors.js';
