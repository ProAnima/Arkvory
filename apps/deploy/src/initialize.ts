import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Installation } from './model.js';
import { runtimeEnvironment } from './runtime.js';
import { jsonFile } from './files.js';

export async function initialize(
  root: string,
  state: Installation,
  input: string | undefined,
): Promise<void> {
  const token = randomBytes(32).toString('hex');
  const password = randomBytes(32).toString('hex');
  const container = state.mode === 'compose';
  const supplied = input ? runtimeEnvironment(await jsonFile(input)) : {};
  if (!container && !supplied['DEPOT_DATABASE_URL'])
    throw new Error('Native installation requires --config with DEPOT_DATABASE_URL');
  for (const name of ['config', 'data', 'logs', 'service'])
    await mkdir(join(root, name), { mode: 0o700 });
  const config = {
    DEPOT_HOST: container ? '0.0.0.0' : '127.0.0.1',
    DEPOT_PORT: '8080',
    DEPOT_CAPACITY_BYTES: String(10 * 1024 ** 4),
    ...supplied,
    ...(container
      ? {
          DEPOT_DATABASE_URL: `postgresql://depot:${password}@database:5432/depot`,
          DEPOT_HOST: '0.0.0.0',
          DEPOT_PORT: '8080',
        }
      : {}),
    DEPOT_DATA_DIR: container ? '/var/lib/depot' : join(root, 'data'),
    DEPOT_KEYS_FILE: container ? '/run/depot/keys.json' : join(root, 'config/keys.json'),
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
      ],
      null,
      2,
    ),
    { flag: 'wx', mode: 0o600 },
  );
  await writeFile(join(root, 'config/bootstrap-token.txt'), token, { flag: 'wx', mode: 0o600 });
  await writeFile(
    join(root, 'config/postgres.env'),
    `POSTGRES_USER=depot\nPOSTGRES_DB=depot\nPOSTGRES_PASSWORD=${password}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  await writeFile(
    join(root, 'config/compose.env'),
    `DEPOT_IMAGE=proanima-depot:${state.current.version}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  // Bind-mounted runtime files are readable inside an unprivileged container. Host config directory stays private.
  if (container)
    for (const name of ['runtime.json', 'keys.json'])
      await chmod(join(root, 'config', name), 0o644);
}
