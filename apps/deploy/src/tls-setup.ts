import { X509Certificate, createPrivateKey } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { replaceText } from './files.js';
import { localApiHost } from './local-api.js';
import type { Installation, Release } from './model.js';
import { runtimeEnvironment } from './runtime.js';

export interface TlsChange {
  readonly certificateFile?: string;
  readonly keyFile?: string;
  readonly host?: string;
  readonly disable?: boolean;
}
/** The service operations configure needs; Services implements them, tests substitute them. */
export interface ServiceControl {
  stop(): Promise<void>;
  start(release: Release): Promise<void>;
  healthy(): Promise<void>;
}

const maxPem = 1024 * 1024;

async function pem(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error('TLS files must be given as absolute paths');
  const info = await stat(path);
  if (!info.isFile() || info.size > maxPem)
    throw new Error('TLS files must be PEM files up to 1 MiB');
  return readFile(path, 'utf8');
}

/**
 * The same checks the API repeats at startup, run before anything changes, so a wrong file is
 * reported here instead of as a failed restart. Returns the certificate expiry.
 */
export async function validateTlsFiles(certificateFile: string, keyFile: string, now: number) {
  const [cert, key] = await Promise.all([pem(certificateFile), pem(keyFile)]);
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(cert);
  } catch {
    throw new Error('The TLS certificate is not valid PEM');
  }
  let privateKey;
  try {
    privateKey = createPrivateKey(key);
  } catch {
    throw new Error('The TLS key is not an unencrypted PEM private key');
  }
  if (!certificate.checkPrivateKey(privateKey))
    throw new Error('The TLS certificate and key do not match');
  if (certificate.validToDate.getTime() <= now) throw new Error('The TLS certificate has expired');
  return certificate.validToDate;
}

function nextEnvironment(env: Record<string, string>, change: TlsChange): Record<string, string> {
  const next = { ...env };
  if (change.disable) {
    delete next['ARKVORY_TLS_CERT_FILE'];
    delete next['ARKVORY_TLS_KEY_FILE'];
  } else {
    if (!change.certificateFile || !change.keyFile)
      throw new Error('Use --tls-cert and --tls-key together, or --tls-off');
    next['ARKVORY_TLS_CERT_FILE'] = change.certificateFile;
    next['ARKVORY_TLS_KEY_FILE'] = change.keyFile;
  }
  if (change.host !== undefined) {
    localApiHost(change.host);
    next['ARKVORY_HOST'] = change.host;
  }
  return next;
}

/**
 * Switches built-in HTTPS on a native installation: validate, write runtime.json, restart and
 * require the readiness probe over the new transport. Any failure restores the previous
 * runtime.json and restarts with it, so a bad certificate never leaves the service down.
 * Paths are referenced, not copied: renewals written in place are reloaded by the API.
 */
export async function configureTls(
  root: string,
  state: Installation,
  change: TlsChange,
  services: ServiceControl,
  now = Date.now(),
): Promise<Date | null> {
  if (state.mode === 'compose')
    throw new Error('Built-in TLS is for native installations; use a reverse proxy with Compose');
  const path = join(root, 'config/runtime.json');
  const previous = await readFile(path, 'utf8');
  const next = nextEnvironment(runtimeEnvironment(JSON.parse(previous)), change);
  const expires =
    change.certificateFile && change.keyFile && !change.disable
      ? await validateTlsFiles(change.certificateFile, change.keyFile, now)
      : null;
  // Keeps the mode and the root:arkvory ownership: the service group reads it, nobody else does.
  await replaceText(path, JSON.stringify(next, null, 2) + '\n');
  try {
    await services.stop();
    await services.start(state.current);
    await services.healthy();
    return expires;
  } catch (error) {
    await replaceText(path, previous);
    await services.stop();
    await services.start(state.current);
    await services.healthy();
    throw new Error(
      `HTTPS was not enabled; the previous configuration is restored (${error instanceof Error ? error.message : 'restart failed'})`,
      { cause: error },
    );
  }
}
