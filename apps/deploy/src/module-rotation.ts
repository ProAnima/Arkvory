import { SigningError, readRevocations } from '@proanima/arkvory-signing';
import { inside, readOptional } from './files.js';
import { hostKeys, revocationsPath } from './module-host.js';
import type { ModuleCommandContext } from './module-host.js';
import { commandOutput } from './process.js';

/**
 * `arkvory module check-revocations`: whether this release's built-in module keys verify the
 * stored revocation list. The updater runs it from the staged release before switching to it
 * (`checkReleaseRevocationKeys`), so a release that dropped the key of the stored list is
 * refused instead of leaving a host whose list no command can read or replace.
 */
export async function checkRevocations(root: string, context: ModuleCommandContext): Promise<void> {
  const text = await readOptional(revocationsPath(root));
  if (text === null) {
    context.print('No revocation list is stored');
    return;
  }
  // Only module keys sign lists; the trust list of operator keys plays no part here.
  const keys = hostKeys(context, { format: 1, keys: [] });
  try {
    const list = readRevocations(text, keys);
    context.print(
      `Revocation list ${String(list.sequence)} is signed by trusted key ${list.keyId}`,
    );
  } catch (error) {
    if (
      error instanceof SigningError &&
      (error.code === 'unknown_key' || error.code === 'wrong_key_class')
    )
      throw new Error(
        `The stored module revocation list is signed by key ${error.subject ?? 'unknown'}, which this release does not trust`,
        { cause: error },
      );
    throw error;
  }
}

/**
 * Key rotation guard of the updater (ADR 0078, 3.2): the staged release `version` must verify
 * the stored revocation list with its own built-in keys. A release without the command (older
 * than module signing) is refused the same way, because it cannot read the list either. Hosts
 * without a stored list are not asked.
 */
export async function checkReleaseRevocationKeys(root: string, version: string): Promise<void> {
  if ((await readOptional(revocationsPath(root))) === null) return;
  const entry = inside(root, 'releases', version, 'apps', 'deploy', 'dist', 'main.js');
  try {
    await commandOutput(
      process.execPath,
      [entry, 'module', 'check-revocations', '--root', root],
      undefined,
      undefined,
      { timeoutMs: 60_000 },
    );
  } catch (error) {
    throw new Error(
      `Release ${version} does not trust the key of the stored module revocation list; store a list signed by a module key of that release first (arkvory module revocations, ADR 0078 key rotation)`,
      { cause: error },
    );
  }
}
