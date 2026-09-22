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
  required: ['status', 'writable', 'transfers'],
  properties: {
    status: { type: 'string', enum: ['ready'] },
    writable: { type: 'boolean' },
    transfers: {
      type: 'object',
      additionalProperties: false,
      required: ['uploads', 'downloads'],
      properties: { uploads: direction, downloads: direction },
    },
  },
} as const;
