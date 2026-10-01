import { items, record, text } from './wire-values.js';

export const credentialKindNames = [
  'session',
  'personal-token',
  'service-key',
  'file-key',
] as const;
export type CredentialKindName = (typeof credentialKindNames)[number];
export const securityOutcomes = ['success', 'failure', 'denied'] as const;
export type SecurityOutcomeName = (typeof securityOutcomes)[number];

export interface SecurityAuditEntryResponse {
  id: string;
  occurredAt: string;
  actor: string | null;
  credential: CredentialKindName | null;
  clientIp: string | null;
  action: string;
  target: string | null;
  outcome: SecurityOutcomeName;
  code: string | null;
  details: Readonly<Record<string, string | number | boolean | null>>;
}
export interface SecurityAuditPageResponse {
  items: readonly SecurityAuditEntryResponse[];
  next: string | null;
}

const nullable = (schema: object) => ({ ...schema, nullable: true });
const entrySchema = {
  type: 'object',
  required: [
    'id',
    'occurredAt',
    'actor',
    'credential',
    'clientIp',
    'action',
    'target',
    'outcome',
    'code',
    'details',
  ],
  properties: {
    id: { type: 'string', pattern: '^[1-9][0-9]{0,17}$' },
    occurredAt: { type: 'string', format: 'date-time' },
    actor: nullable({ type: 'string' }),
    credential: nullable({ type: 'string', enum: credentialKindNames }),
    clientIp: nullable({ type: 'string' }),
    action: { type: 'string' },
    target: nullable({ type: 'string' }),
    outcome: { type: 'string', enum: securityOutcomes },
    code: nullable({ type: 'string' }),
    details: { type: 'object', additionalProperties: true },
  },
};
export const securityAuditPaths = {
  '/api/v1/security/audit': {
    get: {
      summary: 'Append-only identity and credential journal, newest first; administrator only',
      description:
        'Login, registration, account, group, grant, password and personal token events with actor, credential kind, target, outcome and client address. Throttled requests are not journaled.',
      parameters: [
        {
          name: 'after',
          in: 'query',
          required: false,
          schema: { type: 'string', pattern: '^[1-9][0-9]{0,17}$' },
        },
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 100 },
        },
      ],
      responses: {
        200: {
          description: 'Success',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['items', 'next'],
                properties: {
                  items: { type: 'array', maxItems: 100, items: entrySchema },
                  next: nullable({ type: 'string' }),
                },
              },
            },
          },
        },
        default: { description: 'Error with code, message and requestId' },
      },
    },
  },
};

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}
function detailValues(value: unknown): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(record(value))) {
    if (
      item !== null &&
      typeof item !== 'string' &&
      typeof item !== 'number' &&
      typeof item !== 'boolean'
    )
      throw new Error('Invalid audit detail');
    result[key] = item;
  }
  return result;
}
export function readSecurityAuditPage(value: unknown): SecurityAuditPageResponse {
  const page = record(value);
  return {
    next: nullableText(page['next']),
    items: items(page['items']).map((value) => {
      const row = record(value);
      const credential = row['credential'];
      const outcome = securityOutcomes.find((name) => name === row['outcome']);
      if (!outcome) throw new Error('Invalid audit outcome');
      const kind =
        credential === null || credential === undefined
          ? null
          : credentialKindNames.find((name) => name === credential);
      if (kind === undefined) throw new Error('Invalid audit credential');
      return {
        id: text(row['id']),
        occurredAt: text(row['occurredAt']),
        actor: nullableText(row['actor']),
        credential: kind,
        clientIp: nullableText(row['clientIp']),
        action: text(row['action']),
        target: nullableText(row['target']),
        outcome,
        code: nullableText(row['code']),
        details: detailValues(row['details']),
      };
    }),
  };
}
export function readAuthOptions(value: unknown): { selfRegistration: boolean } {
  const row = record(value);
  if (typeof row['selfRegistration'] !== 'boolean') throw new Error('Invalid sign-in options');
  return { selfRegistration: row['selfRegistration'] };
}
