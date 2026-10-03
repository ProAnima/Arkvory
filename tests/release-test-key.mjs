import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { releasePublicKey } from '../apps/deploy/dist/release-signature.js';

/** A throwaway release key: the real private key never leaves the release workstation. */
export function testKey() {
  const pem = generateKeyPairSync('ed25519')
    .privateKey.export({ format: 'pem', type: 'pkcs8' })
    .toString();
  const id = randomBytes(8).toString('hex');
  return { pem, id, trusted: [{ id, publicKey: releasePublicKey(pem) }] };
}
