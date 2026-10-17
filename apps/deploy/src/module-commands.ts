import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { SigningError, revocationOf, verifyInstalledModule } from '@proanima/arkvory-signing';
import type { PackageHost, RevocationList } from '@proanima/arkvory-signing';
import { refreshNodeKit } from './cluster-node.js';
import { exclusive } from './operation-lock.js';
import { defaultModuleContext, packageHost, readStoredRevocations } from './module-host.js';
import type { ModuleCommandContext } from './module-host.js';
import {
  applyRevocations,
  installModule,
  installation,
  pinModule,
  removeModule,
} from './module-install.js';
import { moduleLayout, readModuleSet } from './module-store.js';
import { checkJournal } from './operations.js';
import type { InstalledModule } from './module-store.js';
import { trustAdd, trustList, trustRemove } from './module-trust.js';

interface CommandSpec {
  readonly positional: number;
  readonly flags: readonly string[];
  readonly values: readonly string[];
}

/** Every `arkvory module …` command, its positional arguments and options. */
const SPECS: Readonly<Record<string, CommandSpec>> = {
  install: { positional: 1, flags: ['yes', 'downgrade'], values: [] },
  list: { positional: 0, flags: [], values: [] },
  remove: { positional: 1, flags: [], values: [] },
  pin: { positional: 2, flags: ['unpin'], values: [] },
  revocations: { positional: 1, flags: [], values: [] },
  'trust add': {
    positional: 1,
    flags: ['allow-in-process', 'yes'],
    values: ['label', 'plugins', 'expires'],
  },
  'trust list': { positional: 0, flags: [], values: [] },
  'trust remove': { positional: 1, flags: [], values: [] },
};

interface Parsed {
  readonly command: string;
  readonly root: string;
  readonly positional: readonly string[];
  readonly options: ReadonlyMap<string, string>;
}

function parse(args: readonly string[]): Parsed {
  const command = args[0] === 'trust' ? `trust ${args[1] ?? ''}` : (args[0] ?? '');
  const spec = SPECS[command];
  if (spec === undefined)
    throw new Error('Unknown module command; "arkvory help" lists the module commands');
  const positional: string[] = [];
  const options = new Map<string, string>();
  const rest = args.slice(command.split(' ').length);
  for (let index = 0; index < rest.length; index++) {
    const token = rest[index] ?? '';
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const name = token.slice(2);
    if (options.has(name)) throw new Error(`Duplicate --${name}`);
    if (spec.flags.includes(name)) options.set(name, 'true');
    else if (name === 'root' || spec.values.includes(name)) {
      const value = rest[++index];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing --${name} value`);
      options.set(name, value);
    } else throw new Error(`Unknown option --${name} for module ${command}`);
  }
  // `pin <id> --unpin` takes one argument, `pin <id> <version>` two.
  const expected = command === 'pin' && options.has('unpin') ? 1 : spec.positional;
  if (positional.length !== expected)
    throw new Error(`module ${command} takes ${String(expected)} argument(s)`);
  const raw = options.get('root');
  if (!raw) throw new Error('Specify --root (absolute installation directory)');
  const root = resolve(raw);
  if (/[\r\n\0"%$`]/.test(root)) throw new Error('Unsupported installation path');
  return { command, root, positional, options };
}

async function archiveDigest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    if (!Buffer.isBuffer(chunk)) throw new Error('Invalid archive stream');
    hash.update(chunk);
  }
  return hash.digest('hex');
}

/** The state of one installed module as the loader would find it before importing it. */
async function moduleState(
  root: string,
  module: InstalledModule,
  host: PackageHost,
  revocations: RevocationList | null,
): Promise<string> {
  const layout = moduleLayout(root);
  try {
    const signed = await verifyInstalledModule(layout.unpacked(module.id, module.version), host);
    if (
      signed.manifest.module.id !== module.id ||
      signed.manifest.module.version !== module.version
    )
      return 'refused: package_changed';
    if ((await archiveDigest(layout.archive(module.id, module.version))) !== module.sha256)
      return 'refused: package_changed';
  } catch (error) {
    if (error instanceof SigningError) return `refused: ${error.code}`;
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return 'refused: module_unavailable';
    throw error;
  }
  const revoked = revocationOf(revocations, module.id, module.version);
  if (revoked === null) return 'ok';
  return `revoked (${revoked.reason})${revoked.readOnly ? ', read path only' : ''}`;
}

/** `arkvory module list`: every installed package verified again, as at a process start. */
async function listModules(root: string, context: ModuleCommandContext): Promise<void> {
  const state = await installation(root);
  const host = await packageHost(root, state, context);
  const set = await readModuleSet(root);
  const revocations = await readStoredRevocations(root, host.keys);
  if (!set.modules.length) context.print('No modules are installed.');
  for (const module of set.modules) {
    const status = await moduleState(root, module, host, revocations);
    context.print(
      `${module.id} ${module.version}  ${status}  data ${module.dataClass}  key ${module.keyId}${module.pinned ? '  pinned' : ''}  sha256 ${module.sha256}`,
    );
  }
  for (const kept of set.retained)
    context.print(`kept until the next change: ${kept.id} ${kept.version}`);
  context.print(
    revocations === null
      ? 'Revocation list: none'
      : `Revocation list: ${String(revocations.sequence)} of ${revocations.issuedAt}`,
  );
}

async function run(parsed: Parsed, context: ModuleCommandContext): Promise<void> {
  const { command, root, positional, options } = parsed;
  const first = positional[0] ?? '';
  // Every change waits for `recover` after an interrupted deployment step, as updates do.
  await checkJournal(root);
  switch (command) {
    case 'install':
      return installModule(
        root,
        first,
        { yes: options.has('yes'), downgrade: options.has('downgrade') },
        context,
      );
    case 'remove':
      return removeModule(root, first, context);
    case 'pin':
      return pinModule(root, first, options.has('unpin') ? null : (positional[1] ?? null), context);
    case 'revocations':
      return applyRevocations(root, first, context);
    case 'trust add':
      return trustAdd(
        root,
        await installation(root),
        {
          key: first,
          label: options.get('label'),
          plugins: options.get('plugins'),
          allowInProcess: options.has('allow-in-process'),
          expires: options.get('expires'),
          yes: options.has('yes'),
        },
        context,
      );
    case 'trust remove':
      return trustRemove(root, await installation(root), first, context);
    default:
      throw new Error(`Unknown module command ${command}`);
  }
}

/**
 * `arkvory module …` on the host (ADR 0078 section 4, ADR 0082 section 3). Reading commands
 * take no lock; every change runs under the installation lock like the other deployment
 * operations, then refreshes the kit of a cluster node.
 */
export async function moduleCommand(
  args: readonly string[],
  context: ModuleCommandContext = defaultModuleContext,
): Promise<void> {
  const parsed = parse(args);
  if (parsed.command === 'list') return listModules(parsed.root, context);
  if (parsed.command === 'trust list') return trustList(parsed.root, context);
  await exclusive(
    parsed.root,
    async () => {
      await run(parsed, context);
      await refreshNodeKit(parsed.root);
    },
    120_000,
    `module-${parsed.command.replace(' ', '-')}`,
  );
}
