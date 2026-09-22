import { randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

for (const destination of ['.env', 'data/service-keys.json', 'data/local-token.txt']) {
  try {
    await access(destination);
    throw new Error('Local configuration already exists; refusing to overwrite');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
await mkdir('data', { recursive: true });
const token = randomBytes(32).toString('hex');
const password = randomBytes(24).toString('hex');
await writeFile(
  'data/service-keys.json',
  JSON.stringify(
    [
      {
        id: 'local-owner',
        sha256: createHash('sha256').update(token).digest('hex'),
        repositories: ['releases'],
        permissions: ['read', 'write'],
      },
    ],
    null,
    2,
  ) + '\n',
  { flag: 'wx', mode: 0o600 },
);
await writeFile('data/local-token.txt', token, { flag: 'wx', mode: 0o600 });
const directory = resolve('data').replaceAll('\\', '/');
await writeFile(
  '.env',
  `DEPOT_POSTGRES_PASSWORD=${password}\nDEPOT_DATABASE_URL=postgresql://depot:${password}@127.0.0.1:55432/depot\nDEPOT_DATA_DIR="${directory}/storage"\nDEPOT_KEYS_FILE="${directory}/service-keys.json"\nDEPOT_TOKEN_FILE="${directory}/local-token.txt"\nDEPOT_BASE_URL=http://127.0.0.1:8080\nDEPOT_HOST=127.0.0.1\nDEPOT_PORT=8080\n`,
  { flag: 'wx', mode: 0o600 },
);
console.log(
  'Created .env and private files in data/. Start the database, migrate, then start Depot.',
);
