import './confine.js';
import { planRehome } from '@proanima/arkvory-application';
import { ArkvoryError } from '@proanima/arkvory-domain';
import {
  PostgresBlobMoves,
  PostgresCatalog,
  localStorageBackends,
  readLocalStorageSettings,
  startupReason,
  storageReserveBytes,
} from '@proanima/arkvory-infrastructure';

/**
 * `arkvory storage rehome` (ADR 0083, N2): plans moves of published blobs from one storage to
 * another, which the running worker then performs; `--status` only counts the moves by state.
 * Takes no storage ownership and stops no service: planning writes rows, nothing else.
 *
 *   rehome.js --from <storage> --to <storage> [--repository <name>] [--limit <n>]
 *   rehome.js --status
 */
const usage =
  'Usage: storage-rehome --from <storage> --to <storage> [--repository <r>] [--limit <n>] | --status';

function options(argv: readonly string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index] ?? '';
    if (name === '--status') {
      found.set('status', '');
      continue;
    }
    const value = argv[index + 1];
    if (!['--from', '--to', '--repository', '--limit'].includes(name) || value === undefined)
      throw new Error(usage);
    found.set(name.slice(2), value);
    index++;
  }
  return found;
}

function summary(counts: Readonly<Record<string, number | undefined>>): string {
  const states = ['planned', 'copied', 'switched', 'released', 'skipped', 'failed'];
  return states.map((state) => `${state}=${String(counts[state] ?? 0)}`).join(' ');
}

const databaseUrl = process.env['ARKVORY_DATABASE_URL'];
const root = process.env['ARKVORY_DATA_DIR'];
try {
  if (!databaseUrl || !root)
    throw new Error('ARKVORY_DATABASE_URL and ARKVORY_DATA_DIR are required');
  const given = options(process.argv.slice(2));
  const catalog = new PostgresCatalog(databaseUrl, 0, 1);
  try {
    await catalog.ready();
    const moves = new PostgresBlobMoves(catalog.pool);
    if (!given.has('status')) {
      const from = given.get('from');
      const to = given.get('to');
      if (from === undefined || to === undefined) throw new Error(usage);
      const limit = Number(given.get('limit') ?? '10000');
      // The configured storages, not opened: the worker checks the target again before copying.
      const backends = localStorageBackends(
        root,
        storageReserveBytes(process.env['ARKVORY_STORAGE_RESERVE_BYTES']),
        await readLocalStorageSettings(process.env['ARKVORY_MODULES_FILE'], root),
      );
      const repository = given.get('repository') ?? null;
      const planned = await planRehome(moves, backends, { from, to, repository, limit });
      process.stdout.write(`Planned ${String(planned)} moves from ${from} to ${to}\n`);
    }
    process.stdout.write(`Moves: ${summary(await moves.counts())}\n`);
  } finally {
    await catalog.close();
  }
} catch (error) {
  // Machine codes and redacted text only: never a connection string or a secret.
  const reason =
    error instanceof ArkvoryError
      ? `${error.code}${error.reason ? ` (${error.reason})` : ''}`
      : startupReason(error);
  process.stderr.write(`storage rehome: ${reason}\n`);
  process.exitCode = 1;
}
