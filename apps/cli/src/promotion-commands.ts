import type { PackageQuery, RepositoryClient } from '@proanima/arkvory-sdk';
import { option, validateCommand, word, numericOption } from './arguments.js';
import type { Arguments } from './arguments.js';
import type { connection } from './profiles.js';
import { download } from './download.js';
import { CliError } from './errors.js';

type Connected = Awaited<ReturnType<typeof connection>>;
// --version is the global client version flag, so an exact package version uses --exact.
const packageOptions = ['group', 'exact', 'range', 'stage', 'prerelease', 'order'];

export function isPromotionCommand(args: Arguments): boolean {
  const [command, sub] = args.words;
  return (
    command === 'promote' ||
    command === 'stages' ||
    command === 'promotions' ||
    (command === 'packages' && (sub === 'resolve' || sub === 'download'))
  );
}

function packageQuery(args: Arguments, name: string): PackageQuery {
  const order = args.options.get('order');
  if (order !== undefined && order !== 'version' && order !== 'promoted')
    throw new CliError('invalid_order');
  const pick = (key: string) => args.options.get(key);
  const group = pick('group'),
    version = pick('exact'),
    range = pick('range'),
    stage = pick('stage');
  return {
    name,
    ...(group === undefined ? {} : { group }),
    ...(version === undefined ? {} : { version }),
    ...(range === undefined ? {} : { range }),
    ...(stage === undefined ? {} : { stage }),
    ...(args.options.has('prerelease') ? { prerelease: true } : {}),
    ...(order === undefined ? {} : { order }),
  };
}
function stages(args: Arguments): string[] {
  const value = args.options.get('stage');
  return value === undefined ? [] : value.split(',').filter(Boolean);
}

export async function promotionCommand(
  args: Arguments,
  connected: Connected,
  signal: AbortSignal,
  progress: (n: number, total: number) => void,
): Promise<unknown> {
  const scoped: RepositoryClient = connected.client.inRepository(connected.repository);
  const [command, sub] = args.words;
  if (command === 'packages' && sub === 'download') {
    validateCommand(args, 4, packageOptions);
    const found = await scoped.packages.resolve(packageQuery(args, word(args, 2)), signal);
    const requestTimeoutMs = numericOption(args, 'timeout', 60000, 1, 3600000);
    const saved = await download({
      ...connected,
      id: found.artifactId,
      output: word(args, 3),
      signal,
      progress,
      requestTimeoutMs,
    });
    return { package: found, download: saved };
  }
  const bounded = AbortSignal.any([
    signal,
    AbortSignal.timeout(numericOption(args, 'timeout', 60000, 1, 3600000)),
  ]);
  if (command === 'packages') {
    validateCommand(args, 3, packageOptions);
    return scoped.packages.resolve(packageQuery(args, word(args, 2)), bounded);
  }
  if (command === 'promote') {
    validateCommand(args, 2, ['to', 'move', 'stage', 'comment']);
    const comment = args.options.get('comment');
    return scoped.promotions.promote(
      word(args, 1),
      {
        target: option(args, 'to'),
        mode: args.options.has('move') ? 'move' : 'copy',
        stages: stages(args),
        ...(comment === undefined ? {} : { comment }),
      },
      bounded,
    );
  }
  if (command === 'stages') return stageCommand(args, scoped, bounded);
  if (sub === 'history') {
    validateCommand(args, 3, ['after']);
    const after = args.options.get('after');
    return scoped.promotions.history(word(args, 2), after ? { after } : {}, bounded);
  }
  if (sub === 'journal') {
    validateCommand(args, 2, ['after']);
    const after = args.options.get('after');
    return scoped.promotions.journal(after ? { after } : {}, bounded);
  }
  throw new CliError('unknown_command');
}

async function stageCommand(args: Arguments, scoped: RepositoryClient, signal: AbortSignal) {
  const sub = word(args, 1);
  if (sub === 'list') {
    validateCommand(args, 3);
    return scoped.stages.list(word(args, 2), signal);
  }
  if (sub === 'add') {
    validateCommand(args, 4, ['comment']);
    return scoped.stages.add(word(args, 2), word(args, 3), args.options.get('comment'), signal);
  }
  if (sub === 'remove') {
    validateCommand(args, 4);
    await scoped.stages.remove(word(args, 2), word(args, 3), signal);
    return { removed: word(args, 3) };
  }
  if (sub === 'artifacts') {
    validateCommand(args, 2, ['stage', 'after']);
    const stage = args.options.get('stage'),
      after = args.options.get('after');
    return scoped.stages.artifacts(
      { ...(stage ? { stage } : {}), ...(after ? { after } : {}) },
      signal,
    );
  }
  throw new CliError('unknown_command');
}
