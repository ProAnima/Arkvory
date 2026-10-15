import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { link, open, readFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Seals the keys of a controller's sites (ADR 0077) with AES-256-GCM under a key kept outside
 * the database, in `ARKVORY_FLEET_KEY_FILE`. A database dump or backup alone reveals no site key.
 * The site id is bound as additional data: a sealed key moved to another row does not open.
 */
/** Makes a new directory entry durable; Windows has no directory handles to sync. */
async function syncDirectory(directory: string) {
  if (process.platform === 'win32') return;
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class FleetSeal {
  private constructor(private readonly key: Buffer) {}

  /** 64 hexadecimal characters or 32 bytes in base64; anything else stops the start. */
  static async fromFile(path: string): Promise<FleetSeal> {
    const text = (await readFile(path, 'utf8')).trim();
    const key = /^[0-9a-fA-F]{64}$/.test(text)
      ? Buffer.from(text, 'hex')
      : /^[A-Za-z0-9+/]{43}=$/.test(text)
        ? Buffer.from(text, 'base64')
        : undefined;
    if (key?.length !== 32)
      throw new Error('Invalid ARKVORY_FLEET_KEY_FILE: 32 bytes as hex or base64');
    return new FleetSeal(key);
  }

  /**
   * The key at `path`, made on first use: 32 random bytes as hex, mode 0600, created exclusively
   * so two processes starting at once keep one key. The default path is in the data directory:
   * on an HA cluster it moves with the data, and it is outside the database and its backups.
   */
  static async loadOrCreate(path: string): Promise<FleetSeal> {
    // Every later start only reads the key: a temporary file is made once, not on each start.
    try {
      return await FleetSeal.fromFile(path);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    // A complete, flushed temporary file linked to the name: a crash or a full disk never leaves
    // an empty key that would stop every later start, and a second process sees the whole key.
    const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(`${randomBytes(32).toString('hex')}\n`);
      await file.sync();
      await file.close();
      try {
        await link(temporary, path);
        await syncDirectory(dirname(path));
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      }
    } finally {
      await file.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
    }
    return FleetSeal.fromFile(path);
  }

  static fromKey(key: Buffer): FleetSeal {
    if (key.length !== 32) throw new Error('A fleet seal key has 32 bytes');
    return new FleetSeal(Buffer.from(key));
  }

  seal(siteId: string, secret: string): Buffer {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce).setAAD(Buffer.from(siteId));
    const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, body, cipher.getAuthTag()]);
  }

  open(siteId: string, sealed: Uint8Array): string {
    const box = Buffer.from(sealed);
    if (box.length < 29) throw new Error('Sealed fleet key is too short');
    const decipher = createDecipheriv('aes-256-gcm', this.key, box.subarray(0, 12)).setAAD(
      Buffer.from(siteId),
    );
    decipher.setAuthTag(box.subarray(box.length - 16));
    return Buffer.concat([
      decipher.update(box.subarray(12, box.length - 16)),
      decipher.final(),
    ]).toString('utf8');
  }
}
