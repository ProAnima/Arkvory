import { option, validateCommand, word } from '../arguments.js';
import type { Arguments } from '../arguments.js';
import { CliError } from '../errors.js';
import {
  applyRevocations,
  installModule,
  listModules,
  removeModule,
  setEnabled,
} from './module-commands.js';
import { clientHost, moduleLayout } from './module-store.js';
import type { PackageHost } from '@proanima/arkvory-signing';

/**
 * `arkvoryctl module install FILE [--yes] [--allow-stale-revocations] | list | enable ID
 * [--profile NAME] | disable ID [--profile NAME] | remove ID | revocations FILE` (ADR 0079,
 * 5.11): signed client modules of this user, in the CLI home. Nothing here contacts a server.
 */
export async function moduleCommand(
  args: Arguments,
  options: { readonly home?: string; readonly host?: PackageHost } = {},
): Promise<unknown> {
  const layout = moduleLayout(options.home);
  const host = options.host ?? clientHost();
  const operation = word(args, 1);
  switch (operation) {
    case 'install':
      validateCommand(args, 3, ['yes', 'allow-stale-revocations']);
      return installModule(
        layout,
        word(args, 2),
        {
          yes: args.options.has('yes'),
          allowStale: args.options.has('allow-stale-revocations'),
        },
        host,
      );
    case 'list':
      validateCommand(args, 2);
      return listModules(layout, host);
    case 'enable':
    case 'disable':
      validateCommand(args, 3);
      return setEnabled(
        layout,
        word(args, 2),
        operation === 'enable',
        args.options.has('profile') ? option(args, 'profile') : undefined,
      );
    case 'remove':
      validateCommand(args, 3);
      return removeModule(layout, word(args, 2));
    case 'revocations':
      validateCommand(args, 3);
      return applyRevocations(layout, word(args, 2), host);
  }
  throw new CliError('unknown_command');
}
