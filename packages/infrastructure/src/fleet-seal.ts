import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/**
 * Seals the keys of a controller's sites (ADR 0077) with AES-256-GCM under a key kept outside
 * the database, in `ARKVORY_FLEET_KEY_FILE`. A database dump or backup alone reveals no site key.
 * The site id is bound as additional data: a sealed key moved to another row does not open.
 */
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
