import type { ArkvoryClient } from '@proanima/arkvory-sdk';

/** The server owns the size policy; checking first avoids hashing a file it will refuse. */
export async function exceedsServerLimit(client: ArkvoryClient, size: number): Promise<boolean> {
  return size > Number((await client.capabilities()).limits.maxObjectBytes);
}
