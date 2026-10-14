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
const classCounts = {
  type: 'object',
  additionalProperties: false,
  required: ['interactive', 'release', 'bulk', 'background'],
  properties: { interactive: count, release: count, bulk: count, background: count },
} as const;
/** The download queue's effective settings: what the environment configured. */
const queueSettings = {
  type: 'object',
  additionalProperties: false,
  required: [
    'strategy',
    'sessions',
    'reserve',
    'perPrincipal',
    'weights',
    'sessionMinBytes',
    'idleSeconds',
    'agingMinutes',
    'preempt',
    'rangesPerSession',
    'queueLimit',
    'queuePerPrincipal',
    'holdSeconds',
  ],
  properties: {
    strategy: { type: 'string', enum: ['ordered', 'smallest-first', 'shared'] },
    sessions: count,
    reserve: count,
    perPrincipal: count,
    weights: classCounts,
    sessionMinBytes: count,
    idleSeconds: count,
    agingMinutes: count,
    preempt: { type: 'boolean' },
    rangesPerSession: count,
    queueLimit: count,
    queuePerPrincipal: count,
    holdSeconds: count,
  },
} as const;
/** Download sessions of ADR 0076: aggregates only, no session ids or principals. */
const sessions = {
  type: 'object',
  additionalProperties: false,
  required: ['active', 'waiting', 'oldestWaitSeconds', 'bytesPerSecond', 'settings'],
  properties: {
    active: count,
    waiting: classCounts,
    oldestWaitSeconds: count,
    bytesPerSecond: count,
    resumable: count,
    held: count,
    tickMilliseconds: { type: 'number', minimum: 0 },
    admitted: count,
    queued: count,
    completed: count,
    noShows: count,
    released: count,
    yielded: count,
    refused: count,
    settings: queueSettings,
  },
} as const;
const direction = {
  type: 'object',
  additionalProperties: false,
  required: ['admission', 'bandwidth'],
  properties: { admission, bandwidth, sessions },
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
        // The node that serves, the profile and every DRBD peer, for the console's cluster view.
        node: { type: 'string', maxLength: 63 },
        profile: { type: 'string', enum: ['ha-2', 'ha-3'] },
        peers: {
          type: 'array',
          maxItems: 16,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'connected', 'disk', 'complete', 'witness'],
            properties: {
              name: { type: 'string', maxLength: 63 },
              connected: { type: 'boolean' },
              disk: { type: 'string', maxLength: 24 },
              complete: { type: 'boolean' },
              witness: { type: 'boolean' },
            },
          },
        },
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
