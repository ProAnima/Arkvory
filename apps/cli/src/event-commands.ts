import { once } from 'node:events';
import type { CloudEventResponse } from '@proanima/arkvory-contracts';
import { record } from '@proanima/arkvory-contracts';
import { validateCommand, word, numericOption } from './arguments.js';
import type { Arguments } from './arguments.js';
import type { connection } from './profiles.js';
import { CliError } from './errors.js';
import { exists, readJson, saveJson } from './local-files.js';

type Connected = Awaited<ReturnType<typeof connection>>;
const cursorPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(0|[1-9][0-9]{0,18})$/;

/** One CloudEvent per line on stdout, waiting for the pipe instead of buffering without bound. */
async function writeLine(event: CloudEventResponse): Promise<void> {
  if (!process.stdout.write(JSON.stringify(event) + '\n')) await once(process.stdout, 'drain');
}

/** The cursor to start from: --after, else the cursor file, else the oldest retained event. */
async function startCursor(args: Arguments, file: string | undefined): Promise<string | undefined> {
  const after =
    args.options.get('after') ??
    (file && (await exists(file)) ? cursorOf(await readJson(file)) : undefined);
  if (after !== undefined && !cursorPattern.test(after)) throw new CliError('invalid_after');
  return after;
}
function cursorOf(value: unknown): string {
  const cursor = record(value)['cursor'];
  if (typeof cursor !== 'string') throw new CliError('invalid_local_file');
  return cursor;
}

/**
 * `events tail` (ADR 0080): prints the installation's events as JSON lines and keeps the
 * cursor in --cursor-file (written atomically after every event), so a repeated command goes
 * on where the last one stopped. Without --follow it ends at the newest event; with it, it
 * waits for new ones until Ctrl+C. An expired cursor or a restored server ends it with the
 * server's error; the window it reports tells where to start again.
 */
export async function eventsCommand(
  args: Arguments,
  { client }: Connected,
  signal: AbortSignal,
): Promise<undefined> {
  validateCommand(args, 2, ['after', 'types', 'follow', 'cursor-file', 'limit']);
  if (word(args, 1) !== 'tail') throw new CliError('unknown_command');
  const file = args.options.get('cursor-file');
  const types = args.options.get('types')?.split(',');
  const repository = args.options.get('repository');
  const limit = numericOption(args, 'limit', 100, 1, 500);
  const save = async (cursor: string) => {
    if (file) await saveJson(file, { cursor });
  };
  const options = {
    limit,
    ...(types ? { types } : {}),
    ...(repository ? { repository } : {}),
  };
  let after = await startCursor(args, file);
  if (args.options.has('follow')) {
    for await (const event of client.events.follow({
      ...options,
      ...(after ? { after } : {}),
      signal,
      save,
    }))
      await writeLine(event);
    return undefined;
  }
  for (;;) {
    const page = await client.events.list({ ...options, ...(after ? { after } : {}) }, signal);
    for (const event of page.items) {
      await writeLine(event);
      await save(event.id);
    }
    if (page.next !== page.items.at(-1)?.id) await save(page.next);
    after = page.next;
    if (page.items.length < limit) return undefined;
  }
}
