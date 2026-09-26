import type { DepotClient } from '@proanima/depot-sdk';

export async function readableRepositories(client: DepotClient): Promise<readonly string[]> {
  const readable: string[] = [];
  let after: string | undefined;
  let count = 0;
  do {
    const page = await client.repositories({ limit: 100, ...(after ? { after } : {}) });
    count += page.items.length;
    if (count > 10000 || (page.next && after && page.next <= after))
      throw new Error('Invalid repository pagination');
    for (const card of page.items)
      if (card.permissions.includes('artifact.list')) readable.push(card.id);
    after = page.next ?? undefined;
  } while (after);
  return readable.sort((left, right) => left.localeCompare(right));
}
