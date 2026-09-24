import { DepotError, requireRepository } from '@proanima/depot-domain';
import type { Principal, ServiceAction } from '@proanima/depot-domain';
import { effectivePermissions } from './effective-permissions.js';

export interface RepositoryCard {
  id: string;
  formats: readonly ['upack', 'assets'];
  permissions: readonly ServiceAction[];
}
export interface RepositoryPage {
  items: readonly RepositoryCard[];
  next: string | null;
}
function visible(principal: Principal): readonly RepositoryCard[] {
  const repositories = new Map<string, Set<ServiceAction>>();
  for (const binding of effectivePermissions(principal)) {
    const permissions = repositories.get(binding.resource.id) ?? new Set<ServiceAction>();
    for (const action of binding.actions) permissions.add(action);
    repositories.set(binding.resource.id, permissions);
  }
  const cards: RepositoryCard[] = [];
  for (const [id, permissions] of repositories) {
    if (principal.managed && !permissions.has('repository.read')) continue;
    if (!principal.managed) permissions.add('repository.read');
    cards.push({
      id: requireRepository(id),
      formats: ['upack', 'assets'],
      permissions: [...permissions].sort(),
    });
  }
  return cards.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function listRepositories(principal: Principal, limit = 50, after?: string): RepositoryPage {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new DepotError('invalid_input', 'Repository page limit must be between 1 and 100');
  if (after !== undefined) requireRepository(after);
  const candidates = visible(principal).filter((card) => after === undefined || card.id > after);
  const items = candidates.slice(0, limit);
  return { items, next: candidates.length > limit ? (items.at(-1)?.id ?? null) : null };
}
export function repositoryCard(principal: Principal, id: string): RepositoryCard {
  requireRepository(id);
  const card = visible(principal).find((item) => item.id === id);
  if (!card) throw new DepotError('not_found', 'Repository not found');
  return card;
}
