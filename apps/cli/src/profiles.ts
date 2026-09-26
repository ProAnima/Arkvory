import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { record, text } from '@proanima/arkvory-contracts';
import { CliError } from './errors.js';
import {
  exclusive,
  exists,
  privateDirectory,
  readJson,
  readSmall,
  saveJson,
} from './local-files.js';
import { option, validateCommand, word, numericOption } from './arguments.js';
import type { Arguments } from './arguments.js';

interface Profile {
  server: string;
  repository: string;
  tokenFile?: string;
}
interface Configuration {
  active: string;
  profiles: Record<string, Profile>;
}
function configPath() {
  return join(
    process.env['ARKVORY_CLI_HOME'] ?? join(homedir(), '.config', 'arkvory'),
    'profiles.json',
  );
}
export function serverUrl(value: string): string {
  try {
    // Reuse the SDK trust boundary: HTTPS, no URL credentials/query, no redirects.
    new ArkvoryClient(value, () => '');
    const url = new URL(value);
    return url.href.endsWith('/') ? url.href : url.href + '/';
  } catch {
    throw new CliError('invalid_server_url');
  }
}
function profileName(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)) throw new CliError('invalid_profile');
  return value;
}
export function repositoryName(value: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)) throw new CliError('invalid_repository');
  return value;
}
async function configuration(): Promise<Configuration> {
  if (!(await exists(configPath()))) return { active: '', profiles: {} };
  const row = record(await readJson(configPath()));
  if (row['format'] !== 1) throw new CliError('invalid_configuration');
  const profiles = Object.fromEntries(
    Object.entries(record(row['profiles'])).map(([name, value]) => {
      const p = record(value);
      return [
        profileName(name),
        {
          server: serverUrl(text(p['server'])),
          repository: repositoryName(text(p['repository'])),
          ...(p['tokenFile'] === undefined ? {} : { tokenFile: text(p['tokenFile']) }),
        },
      ];
    }),
  );
  return { active: text(row['active']), profiles };
}
export async function profiles(args: Arguments): Promise<unknown> {
  const operation = word(args, 1);
  validateCommand(
    args,
    operation === 'list' ? 2 : 3,
    operation === 'add' ? ['server', 'token-file'] : [],
  );
  await privateDirectory(dirname(configPath()));
  return exclusive(configPath(), async () => {
    const config = await configuration();
    if (operation === 'list') return config;
    const name = profileName(word(args, 2));
    if (operation === 'add') {
      if (Object.hasOwn(config.profiles, name)) throw new CliError('profile_exists', 6);
      const tokenFile = args.options.get('token-file');
      Object.defineProperty(config.profiles, name, {
        enumerable: true,
        configurable: true,
        value: {
          server: serverUrl(option(args, 'server')),
          repository: repositoryName(args.options.get('repository') ?? 'releases'),
          ...(tokenFile ? { tokenFile: resolve(tokenFile) } : {}),
        },
      });
      if (!config.active) config.active = name;
    } else if (operation === 'use' || operation === 'remove') {
      if (!Object.hasOwn(config.profiles, name)) throw new CliError('profile_not_found');
      if (operation === 'use') config.active = name;
      else {
        config.profiles = Object.fromEntries(
          Object.entries(config.profiles).filter(([key]) => key !== name),
        );
        if (config.active === name) config.active = '';
      }
    } else throw new CliError('unknown_command');
    await saveJson(configPath(), { format: 1, ...config });
    return { profile: name, active: config.active };
  });
}
export async function connection(args: Arguments, signal: AbortSignal) {
  const config = await configuration();
  const name = args.options.get('profile') ?? config.active;
  const profile = Object.hasOwn(config.profiles, name) ? config.profiles[name] : undefined;
  if (args.options.has('profile') && !profile) throw new CliError('profile_not_found');
  const override = process.env['ARKVORY_BASE_URL'];
  const server = serverUrl(override ?? profile?.server ?? 'http://127.0.0.1:8080');
  const repository = repositoryName(
    args.options.get('repository') ?? profile?.repository ?? 'releases',
  );
  // A CI endpoint override never borrows a saved profile's credential file.
  const tokenFile =
    process.env['ARKVORY_TOKEN_FILE'] ?? (override ? undefined : profile?.tokenFile);
  const token = (
    process.env['ARKVORY_TOKEN'] ?? (tokenFile ? await readSmall(tokenFile, 16384) : '')
  ).trim();
  if (!token || Array.from(token).some((character) => character.charCodeAt(0) < 32))
    throw new CliError('credential_required', 3);
  return {
    client: new ArkvoryClient(server, () => token, {
      signal,
      requestTimeoutMs: numericOption(args, 'timeout', 60000, 1, 3600000),
      attemptTimeoutMs: numericOption(args, 'attempt-timeout', 120000, 1, 1800000),
      maxRetries: numericOption(args, 'retries', 20, 0, 100),
    }),
    server,
    repository,
  };
}
