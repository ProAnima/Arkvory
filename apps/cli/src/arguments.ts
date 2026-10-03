import { CliError } from './errors.js';

export interface Arguments {
  readonly words: readonly string[];
  readonly options: ReadonlyMap<string, string>;
  readonly json: boolean;
  readonly language: 'en' | 'ru';
}
const flags = new Set(['json', 'help', 'version', 'move', 'prerelease', 'verbose', 'off']);
const values = new Set([
  'lang',
  'profile',
  'repository',
  'server',
  'token-file',
  'after',
  'query',
  'label',
  'collection',
  'metadata-key',
  'metadata-value',
  'group',
  'name',
  'file',
  'revision',
  'state',
  'timeout',
  'attempt-timeout',
  'retries',
  'to',
  'stage',
  'comment',
  'exact',
  'range',
  'order',
  'ttl',
]);
export function parseArguments(argv: readonly string[]): Arguments {
  const options = new Map<string, string>(),
    words: string[] = [];
  let literal = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === undefined) break;
    if (argument === '--') {
      literal = true;
      continue;
    }
    if (literal || !argument.startsWith('-')) {
      words.push(argument);
      continue;
    }
    const option = argument === '-h' ? 'help' : argument.slice(2);
    if (!argument.startsWith('--') && argument !== '-h') throw new CliError('unknown_option');
    if (options.has(option)) throw new CliError('duplicate_option');
    if (flags.has(option)) options.set(option, 'true');
    else if (values.has(option)) {
      const value = argv[++index];
      if (
        value === undefined ||
        (value === '' && option !== 'metadata-value') ||
        value.startsWith('--')
      )
        throw new CliError('missing_option_value');
      options.set(option, value);
    } else throw new CliError('unknown_option');
  }
  const language = options.get('lang') ?? (process.env['LANG']?.startsWith('ru') ? 'ru' : 'en');
  if (language !== 'en' && language !== 'ru') throw new CliError('invalid_language');
  return { words, options, json: options.has('json'), language };
}
export function option(args: Arguments, name: string): string {
  const value = args.options.get(name);
  if (!value) throw new CliError('missing_' + name.replaceAll('-', '_'));
  return value;
}
export function word(args: Arguments, index: number): string {
  const value = args.words[index];
  if (!value) throw new CliError('missing_argument');
  return value;
}
export function revision(args: Arguments): number {
  const value = option(args, 'revision');
  if (!/^(0|[1-9][0-9]*)$/.test(value) || Number(value) > 2147483647)
    throw new CliError('invalid_revision');
  return Number(value);
}
export function validateCommand(args: Arguments, words: number, allowed: readonly string[] = []) {
  if (args.words.length !== words) throw new CliError('unexpected_argument');
  for (const key of args.options.keys()) {
    if (
      ![
        'json',
        'lang',
        'profile',
        'repository',
        'timeout',
        'attempt-timeout',
        'retries',
        'verbose',
        ...allowed,
      ].includes(key)
    )
      throw new CliError('option_not_supported');
  }
}
export function numericOption(
  args: Arguments,
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  const value = args.options.get(key);
  if (value === undefined) return fallback;
  if (
    !/^(0|[1-9][0-9]*)$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < min ||
    Number(value) > max
  )
    throw new CliError('invalid_' + key.replaceAll('-', '_'));
  return Number(value);
}
