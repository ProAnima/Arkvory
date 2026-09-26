import { record, readAnnotations, readAttachmentRevision } from '@proanima/arkvory-contracts';
import { connection, profiles } from './profiles.js';
import { option, word, revision, validateCommand, numericOption } from './arguments.js';
import type { Arguments } from './arguments.js';
import type { RepositoryClient } from '@proanima/arkvory-sdk';
import { readJson } from './local-files.js';
import { upload } from './upload.js';
import { download } from './download.js';
import { CliError } from './errors.js';

export async function execute(
  args: Arguments,
  signal: AbortSignal,
  progress: (n: number, total: number) => void,
): Promise<unknown> {
  const command = word(args, 0);
  if (command === 'profile') return profiles(args);
  if (
    ![
      'doctor',
      'repositories',
      'operations',
      'list',
      'search',
      'inspect',
      'upload',
      'download',
      'uploads',
      'annotations',
      'attachments',
      'packages',
      'storage',
    ].includes(command)
  )
    throw new CliError('unknown_command');
  const connected = await connection(args, signal);
  const { client, server, repository } = connected;
  if (command === 'upload' || command === 'download')
    return transfer(args, connected, signal, progress);
  signal = AbortSignal.any([
    signal,
    AbortSignal.timeout(numericOption(args, 'timeout', 60000, 1, 3600000)),
  ]);
  const scoped = client.inRepository(repository);
  switch (command) {
    case 'doctor':
      validateCommand(args, 1);
      return {
        server,
        repository,
        capabilities: await client.capabilities(signal),
        permissions: await client.permissions(signal),
      };
    case 'repositories':
      validateCommand(args, 1, ['after']);
      return client.repositories(query(args, ['after']), signal);
    case 'operations':
      validateCommand(args, 1, ['after']);
      return client.operations({ ...query(args, ['after']), repository }, signal);
    case 'list':
      validateCommand(args, 1, ['after']);
      return scoped.artifacts.list(args.options.get('after'));
    case 'search':
      validateCommand(args, 1, ['query', 'label', 'collection', 'after']);
      return scoped.artifacts.search({
        ...query(args, ['label', 'collection', 'after']),
        ...(args.options.has('query') ? { q: option(args, 'query') } : {}),
      });
    case 'inspect':
      validateCommand(args, 2);
      return scoped.artifacts.get(word(args, 1), signal);
    case 'uploads':
      validateCommand(args, 3);
      if (word(args, 1) === 'status') return scoped.uploads.get(word(args, 2), signal);
      if (word(args, 1) === 'cancel') return scoped.uploads.cancel(word(args, 2));
      break;
    case 'annotations':
      return annotations(args, scoped);
    case 'attachments':
      return attachments(args, scoped, signal);
    case 'packages':
      validateCommand(
        args,
        word(args, 1) === 'list' ? 2 : 3,
        word(args, 1) === 'list' ? ['group', 'name', 'after'] : [],
      );
      if (word(args, 1) === 'list')
        return scoped.packages.list(query(args, ['group', 'name', 'after']));
      if (word(args, 1) === 'register') return scoped.packages.register(word(args, 2));
      break;
    case 'storage':
      validateCommand(args, 2);
      if (word(args, 1) === 'usage') return scoped.storage.usage(signal);
      if (word(args, 1) === 'policy') return scoped.storage.policy(signal);
      break;
  }
  throw new CliError('unknown_command');
}
function query(args: Arguments, names: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    names.flatMap((name) => {
      const value = args.options.get(name);
      return value === undefined ? [] : [[name, value]];
    }),
  );
}
function transfer(
  args: Arguments,
  connected: Awaited<ReturnType<typeof connection>>,
  signal: AbortSignal,
  progress: (n: number, total: number) => void,
) {
  const requestTimeoutMs = numericOption(args, 'timeout', 60000, 1, 3600000);
  if (word(args, 0) === 'download') {
    validateCommand(args, 3);
    return download({
      ...connected,
      id: word(args, 1),
      output: word(args, 2),
      signal,
      progress,
      requestTimeoutMs,
    });
  }
  validateCommand(args, 2, ['state', 'file', 'label']);
  return upload({
    ...connected,
    path: word(args, 1),
    signal,
    progress,
    requestTimeoutMs,
    ...(args.options.has('state') ? { state: option(args, 'state') } : {}),
    ...(args.options.has('file') ? { annotations: option(args, 'file') } : {}),
    ...(args.options.has('label') ? { label: option(args, 'label') } : {}),
  });
}
async function annotations(args: Arguments, scoped: RepositoryClient) {
  const operation = word(args, 1);
  validateCommand(args, 3, operation === 'set' ? ['file', 'revision'] : []);
  if (operation === 'get') return scoped.annotations.get(word(args, 2));
  if (operation !== 'set') throw new CliError('unknown_command');
  const value = readAnnotations({ ...record(await readJson(option(args, 'file'))), revision: 0 });
  return scoped.annotations.update(word(args, 2), revision(args), {
    labels: value.labels,
    metadata: value.metadata,
    collections: value.collections,
  });
}
async function attachments(args: Arguments, scoped: RepositoryClient, signal: AbortSignal) {
  const operation = word(args, 1);
  validateCommand(args, 3, operation === 'set' ? ['file', 'revision'] : []);
  const id = word(args, 2);
  if (operation === 'get') return scoped.attachments.get(id, signal);
  if (operation === 'history') return scoped.attachments.history(id, undefined, signal);
  if (operation !== 'set') throw new CliError('unknown_command');
  const items = readAttachmentRevision({
    items: await readJson(option(args, 'file')),
    revision: 1,
    actor: 'cli',
    createdAt: '2026-01-01T00:00:00Z',
  }).items;
  return scoped.attachments.replace(id, revision(args), items, signal);
}
