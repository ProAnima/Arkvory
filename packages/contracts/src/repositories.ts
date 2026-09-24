import { record, text, items } from './wire-values.js';
import { servicePermissionNames } from './service-api.js';

const repositoryPattern = '^[a-z0-9][a-z0-9_-]{0,63}$';
function repositoryId(value: unknown): string {
  const id = text(value);
  if (!new RegExp(repositoryPattern).test(id)) throw new Error('Invalid repository ID');
  return id;
}
export function readRepositoryCard(value: unknown) {
  const r = record(value),
    formats = items(r['formats']),
    raw = items(r['permissions']);
  if (formats.length !== 2 || formats[0] !== 'upack' || formats[1] !== 'assets')
    throw new Error('Invalid repository formats');
  if (raw.length < 1 || raw.length > servicePermissionNames.length)
    throw new Error('Invalid repository permissions');
  const permissions = raw.map((value) => {
    const known = servicePermissionNames.find((name) => name === value);
    if (!known) throw new Error('Unknown repository permission');
    return known;
  });
  if (!permissions.includes('repository.read') || new Set(permissions).size !== permissions.length)
    throw new Error('Invalid repository discovery permission');
  return { id: repositoryId(r['id']), formats: ['upack', 'assets'] as const, permissions };
}
export function readRepositoryPage(value: unknown, limit = 100) {
  const r = record(value),
    entries = items(r['items']);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || entries.length > limit)
    throw new Error('Invalid repository page size');
  const cards = entries.map(readRepositoryCard);
  const next = r['next'] === null ? null : repositoryId(r['next']);
  if (next !== null && (cards.length !== limit || next !== cards.at(-1)?.id))
    throw new Error('Invalid repository cursor');
  for (const [index, card] of cards.entries()) {
    const previous = cards[index - 1];
    if (previous && previous.id >= card.id) throw new Error('Invalid repository order');
  }
  return { items: cards, next };
}
const id = { type: 'string', pattern: repositoryPattern };
const card = {
  type: 'object',
  required: ['id', 'formats', 'permissions'],
  properties: {
    id,
    formats: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      uniqueItems: true,
      items: { type: 'string', enum: ['upack', 'assets'] },
    },
    permissions: {
      type: 'array',
      minItems: 1,
      maxItems: servicePermissionNames.length,
      uniqueItems: true,
      items: { type: 'string', enum: servicePermissionNames },
    },
  },
};
const response = (schema: object) => ({
  '200': {
    description:
      'Accessible logical repository scope; no content counts or deployment configuration.',
    content: { 'application/json': { schema } },
  },
});
export const repositoryPaths = {
  '/api/v1/repositories': {
    get: {
      summary: 'List own discoverable logical repository scopes; ACL filtering before page limit.',
      parameters: [
        {
          name: 'after',
          in: 'query',
          schema: id,
          description:
            'Exclusive repository ID boundary; authorization is rechecked on every page.',
        },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        },
      ],
      responses: response({
        type: 'object',
        required: ['items', 'next'],
        properties: {
          items: { type: 'array', maxItems: 100, items: card },
          next: { ...id, nullable: true },
        },
      }),
    },
  },
  '/api/v1/repositories/{repository}': {
    parameters: [{ name: 'repository', in: 'path', required: true, schema: id }],
    get: {
      summary:
        'Own repository card. Invisible scopes return 404. Discovery grants no byte or administrative access.',
      responses: response(card),
    },
  },
};
