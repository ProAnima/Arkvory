import { X509Certificate } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';

const block = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
const maxBytes = 1024 * 1024;
const maxCertificates = 64;

/**
 * Certificates that sources of this installation's mirrors present (a corporate or self-signed
 * CA), from a PEM file the operator names. Every block must parse and be valid now; the result
 * is the normalized bundle that is stored. TLS stays verified: these are added, never a bypass.
 */
export async function sourceCertificates(file: string, now = Date.now()): Promise<string> {
  if (!isAbsolute(file)) throw new Error('--mirror-ca-file must be an absolute path');
  const info = await stat(file);
  if (!info.isFile() || info.size > maxBytes)
    throw new Error('--mirror-ca-file is not a PEM certificate file');
  const blocks = (await readFile(file, 'utf8')).match(block) ?? [];
  if (blocks.length === 0 || blocks.length > maxCertificates)
    throw new Error(`--mirror-ca-file must hold 1 to ${String(maxCertificates)} certificates`);
  for (const pem of blocks) {
    let certificate: X509Certificate;
    try {
      certificate = new X509Certificate(pem);
    } catch {
      throw new Error('--mirror-ca-file holds a certificate that cannot be read');
    }
    if (Date.parse(certificate.validTo) <= now)
      throw new Error(`A certificate in --mirror-ca-file expired on ${certificate.validTo}`);
  }
  return blocks.join('\n') + '\n';
}

/**
 * The stored bundle with `added` appended; a certificate already stored is kept once. Mirrors of
 * one installation share the bundle, so attaching one never drops another source's authority.
 */
export function mergeCertificates(stored: string | null, added: string): string {
  const all = [...(stored?.match(block) ?? []), ...(added.match(block) ?? [])];
  const unique = [
    ...new Map(all.map((pem) => [new X509Certificate(pem).fingerprint256, pem])).values(),
  ];
  if (unique.length > maxCertificates)
    throw new Error(`Mirror sources may name at most ${String(maxCertificates)} certificates`);
  return unique.join('\n') + '\n';
}

/** This process trusts the bundle besides its default authorities (the probe of the source). */
export function trustSourceCertificates(bundle: string): void {
  setDefaultCACertificates([...getCACertificates('default'), ...(bundle.match(block) ?? [])]);
}
