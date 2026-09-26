import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Installation } from './model.js';
import { runtimeEnvironment } from './runtime.js';
import { jsonFile } from './files.js';
import { configureDatabase } from './managed-database.js';

export async function initialize(
  root: string,
  state: Installation,
  input: string | undefined,
  databaseBin?: string,
): Promise<void> {
  const token = randomBytes(32).toString('hex');
  const healthToken = randomBytes(32).toString('hex');
  const password = randomBytes(32).toString('hex');
  const container = state.mode === 'compose';
  const supplied = input ? runtimeEnvironment(await jsonFile(input)) : {};
  if (databaseBin) {
    if (container || supplied['ARKVORY_DATABASE_URL'])
      throw new Error('Managed database cannot replace an external database');
    supplied['ARKVORY_DATABASE_URL'] = await configureDatabase(root, databaseBin);
  }
  if (!container && !supplied['ARKVORY_DATABASE_URL'])
    throw new Error('Native installation requires --config with ARKVORY_DATABASE_URL');
  for (const name of ['config', 'data', 'logs', 'service'])
    await mkdir(join(root, name), { mode: 0o700 });
  const config = {
    ARKVORY_HOST: container ? '0.0.0.0' : '127.0.0.1',
    ARKVORY_PORT: '8080',
    ARKVORY_CAPACITY_BYTES: String(10 * 1024 ** 4),
    ...supplied,
    ...(container
      ? {
          ARKVORY_DATABASE_URL: `postgresql://arkvory:${password}@database:5432/arkvory`,
          ARKVORY_HOST: '0.0.0.0',
          ARKVORY_PORT: '8080',
        }
      : {}),
    ARKVORY_DATA_DIR: container ? '/var/lib/arkvory' : join(root, 'data'),
    ARKVORY_KEYS_FILE: container ? '/run/arkvory/keys.json' : join(root, 'config/keys.json'),
  };
  await writeFile(join(root, 'config/runtime.json'), JSON.stringify(config, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
  await writeFile(
    join(root, 'config/keys.json'),
    JSON.stringify(
      [
        {
          id: 'bootstrap-owner',
          sha256: createHash('sha256').update(token).digest('hex'),
          repositories: ['releases'],
          permissions: ['read', 'write'],
          administrator: true,
          serviceAdministrator: true,
        },
        {
          id: 'deployment-health',
          sha256: createHash('sha256').update(healthToken).digest('hex'),
          repositories: [],
          permissions: [],
        },
      ],
      null,
      2,
    ),
    { flag: 'wx', mode: 0o600 },
  );
  await writeFile(join(root, 'config/bootstrap-token.txt'), token, { flag: 'wx', mode: 0o600 });
  await writeFile(join(root, 'config/health-token.txt'), healthToken, { flag: 'wx', mode: 0o600 });
  await writeFile(
    join(root, 'config/postgres.env'),
    `POSTGRES_USER=arkvory\nPOSTGRES_DB=arkvory\nPOSTGRES_PASSWORD=${password}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  await writeFile(
    join(root, 'config/compose.env'),
    `ARKVORY_IMAGE=proanima-arkvory:${state.current.version}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  // Bind-mounted runtime files are readable inside an unprivileged container. Host config directory stays private.
  if (container)
    for (const name of ['runtime.json', 'keys.json', 'health-token.txt'])
      await chmod(join(root, 'config', name), 0o644);
}
