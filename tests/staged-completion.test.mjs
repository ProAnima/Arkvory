import { mkdtemp, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stagedCompletionContract } from '../packages/extension-testkit/dist/index.js';
import { removeTestDirectory } from './helpers.mjs';
import { DirectoryBackend } from './contracts/directory-backend.mjs';

// The test storage of ADR 0083, N1 passes the contract every storage that composes from its
// accepted parts must pass; the core's side is tested on PostgreSQL (staged-completion).
stagedCompletionContract('directory-backend', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-staged-'));
  t.after(() => removeTestDirectory(root));
  const store = new DirectoryBackend(root);
  await store.initialize();
  const cancellation = { throwIfAborted() {} };
  return {
    completion: store.staged(),
    putPart: (id, part, bytes) =>
      store.putPart(
        id,
        part,
        (async function* () {
          yield bytes;
        })(),
        cancellation,
      ),
    async corruptPart(id, part) {
      const handle = await open(
        join(root, 'parts', id, `${String(part.index)}-${part.sha256}`),
        'r+',
      );
      try {
        const byte = Buffer.alloc(1);
        await handle.read(byte, 0, 1, 0);
        byte[0] ^= 0xff;
        await handle.write(byte, 0, 1, 0);
      } finally {
        await handle.close();
      }
    },
    async published(id, size) {
      try {
        await store.exists(id, size);
      } catch {
        return null;
      }
      const chunks = [];
      for await (const chunk of store.read(id, size)) chunks.push(chunk);
      return new Uint8Array(Buffer.concat(chunks));
    },
    reopen: () => new DirectoryBackend(root).staged(),
    readOnly: () => new DirectoryBackend(root).staged(true),
  };
});
