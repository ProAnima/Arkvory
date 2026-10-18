/**
 * Inclusive byte range of one blob: `start` to `end`, both safe integers, `start <= end`. Sizes
 * and offsets are `number` checked with `Number.isSafeInteger` at the boundary (ADR 0083, 1).
 */
export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

/** What the core knows of the bytes of a blob and checks itself: exact size and SHA-256. */
export interface BlobDescriptor {
  readonly size: number;
  /** Lowercase hex SHA-256 of the whole content. */
  readonly sha256: string;
}

/** One accepted part of a multipart upload, as the core recorded it. */
export interface PartRef {
  /** Zero-based position of the part in the object. */
  readonly index: number;
  readonly size: number;
  readonly sha256: string;
}

/** A bounded page request: an opaque cursor of the previous page, or null for the first one. */
export interface PageRequest {
  readonly after: string | null;
  /** 1 to the limit of the service; a larger value is refused with `invalid_input`. */
  readonly limit: number;
}

/** One page; `next` is an opaque cursor, null after the last page. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly next: string | null;
}

/**
 * Machine codes of the contract (ADR 0051 and ADR 0083, section 1) that host services and
 * module implementations of the core's ports use; a module never forwards stacks or paths.
 */
export const SERVICE_ERROR_CODES = [
  'invalid_input',
  'conflict',
  'integrity_mismatch',
  'unavailable',
  'busy',
  'read_only',
  'capacity_exceeded',
  'module_quota_exceeded',
  'rate_limited',
  'capability_unavailable',
  'capability_invalid',
] as const;
export type ServiceErrorCode = (typeof SERVICE_ERROR_CODES)[number];

/**
 * A refusal of a host service, or of a module implementing a port of the core. The message is
 * for logs only and names neither secrets nor paths; callers branch on `code`.
 */
export class ModuleServiceError extends Error {
  override readonly name = 'ModuleServiceError';
  constructor(
    readonly code: ServiceErrorCode,
    message: string = code,
  ) {
    super(message);
  }
}
