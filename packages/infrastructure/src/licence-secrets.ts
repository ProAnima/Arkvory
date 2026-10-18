import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { ActivationSecret, ActivationSecrets } from '@proanima/arkvory-application';

const ACTIVATION = /^act_[0-9A-HJKMNP-TV-Z]{26}$/;
const SECRET = /^[A-Za-z0-9_-]{16,128}$/;
const LIMIT = 4096;
/** No symbolic link is followed on POSIX; Windows has no O_NOFOLLOW (lstat checked above). */
const READ_FLAGS = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);

/** Thrown for a secret file that is not what this store writes; the message names no content. */
export class ActivationSecretError extends Error {
  override readonly name = 'ActivationSecretError';
  constructor(readonly code: 'secret_invalid' | 'secret_permissions' | 'activation_invalid') {
    super(`Activation secret refused: ${code}`);
  }
}

function fileOf(directory: string, activationId: string): string {
  if (!ACTIVATION.test(activationId)) throw new ActivationSecretError('activation_invalid');
  return join(directory, `${activationId}.secret`);
}

function parse(text: string, activationId: string): ActivationSecret {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ActivationSecretError('secret_invalid');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ActivationSecretError('secret_invalid');
  const record = Object.fromEntries(Object.entries(value));
  const { format, activationId: id, secret, seq } = record;
  if (
    format !== 1 ||
    id !== activationId ||
    typeof secret !== 'string' ||
    !SECRET.test(secret) ||
    typeof seq !== 'number' ||
    !Number.isSafeInteger(seq) ||
    seq < 1 ||
    Object.keys(record).length !== 4
  )
    throw new ActivationSecretError('secret_invalid');
  return { secret, seq };
}

/**
 * Activation secrets as files `config/licenses/<activationId>.secret` (ADR 0078, R2): outside
 * the database, the logs and every backup point. The directory belongs to the service account
 * with no access for others (`arkvory license activate` makes it 0700 on POSIX, an ACL of
 * SYSTEM, Administrators and LocalService on Windows); each file is written 0600 through a
 * temporary sibling and renamed, so a reader sees the old secret or the new one. A file that a
 * group or others may read is refused on POSIX rather than used.
 */
export function fileActivationSecrets(directory: string): ActivationSecrets {
  return {
    async read(activationId) {
      const path = fileOf(directory, activationId);
      let info;
      try {
        info = await lstat(path);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
        throw error;
      }
      if (!info.isFile() || info.size > LIMIT) throw new ActivationSecretError('secret_invalid');
      if (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
        throw new ActivationSecretError('secret_permissions');
      const file = await open(path, READ_FLAGS);
      try {
        return parse(await file.readFile('utf8'), activationId);
      } finally {
        await file.close();
      }
    },
    async write(activationId, secret) {
      if (!SECRET.test(secret.secret) || !Number.isSafeInteger(secret.seq) || secret.seq < 1)
        throw new ActivationSecretError('secret_invalid');
      const path = fileOf(directory, activationId);
      const temporary = join(directory, `.${activationId}.${randomUUID()}.tmp`);
      const owner = await stat(directory);
      const file = await open(temporary, 'wx', 0o600);
      try {
        // An administrator's command writes for the service account, which rotates the secret.
        if (process.platform !== 'win32' && process.getuid?.() === 0)
          await file.chown(owner.uid, owner.gid);
        const text = JSON.stringify({
          format: 1,
          activationId,
          secret: secret.secret,
          seq: secret.seq,
        });
        await file.writeFile(`${text}\n`, 'utf8');
        await file.sync();
      } catch (error) {
        await file.close().catch(() => undefined);
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
      await file.close();
      try {
        await rename(temporary, path);
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
      await syncDirectory(directory);
    },
    async remove(activationId) {
      await unlink(fileOf(directory, activationId)).catch((error: unknown) => {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      });
      await syncDirectory(directory);
    },
  };
}

/** The rename survives a crash only once its directory is on disk (not on Windows). */
async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
