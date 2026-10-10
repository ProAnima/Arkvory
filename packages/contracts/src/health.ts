const count = { type: 'integer', minimum: 0 } as const;
const admission = {
  type: 'object',
  additionalProperties: false,
  required: [
    'active',
    'waiting',
    'capacity',
    'perPrincipalCapacity',
    'rejected',
    'timedOut',
    'cancelled',
  ],
  properties: {
    active: count,
    waiting: count,
    capacity: count,
    perPrincipalCapacity: count,
    waitingCapacity: count,
    perPrincipalWaitingCapacity: count,
    timeoutMs: count,
    rejected: count,
    timedOut: count,
    cancelled: count,
  },
} as const;
const bandwidth = {
  type: 'object',
  additionalProperties: false,
  required: [
    'bytesPerSecond',
    'perPrincipalBytesPerSecond',
    'burstBytes',
    'perPrincipalBurstBytes',
    'waiting',
    'grantedBytes',
  ],
  properties: {
    bytesPerSecond: count,
    perPrincipalBytesPerSecond: count,
    burstBytes: count,
    perPrincipalBurstBytes: count,
    waiting: count,
    grantedBytes: { type: 'string', pattern: '^(0|[1-9][0-9]*)$' },
  },
} as const;
const direction = {
  type: 'object',
  additionalProperties: false,
  required: ['admission', 'bandwidth'],
  properties: { admission, bandwidth },
} as const;
export const readinessSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'writable', 'transfers', 'role', 'sharedDownloads'],
  properties: {
    role: { type: 'string', enum: ['api', 'reader'] },
    sharedDownloads: {
      type: 'object',
      nullable: true,
      additionalProperties: false,
      required: ['slot', 'slots', 'active', 'leaseSeconds'],
      properties: { slot: count, slots: count, active: { type: 'boolean' }, leaseSeconds: count },
    },
    status: { type: 'string', enum: ['ready'] },
    writable: { type: 'boolean' },
    // HA cluster (ADR 0072): complete copies of the volume; absent on a standalone server.
    replication: {
      type: 'object',
      nullable: true,
      additionalProperties: false,
      required: ['copies', 'required', 'singleCopyUntil'],
      properties: {
        copies: { type: 'integer', minimum: 0, maximum: 16 },
        required: { type: 'integer', minimum: 1, maximum: 16 },
        singleCopyUntil: { type: 'string', format: 'date-time', nullable: true },
      },
    },
    transfers: {
      type: 'object',
      additionalProperties: false,
      required: ['uploads', 'downloads'],
      properties: { uploads: direction, downloads: direction },
    },
  },
} as const;
/** Public load-balancer status: 200 only for ready; no counters, roles or reasons. */
export const healthStatusSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: { status: { type: 'string', enum: ['ready', 'unavailable', 'draining'] } },
} as const;
