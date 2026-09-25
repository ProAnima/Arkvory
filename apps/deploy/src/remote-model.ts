import { isIP } from 'node:net';

export type RemotePlatform = 'linux' | 'windows';
export interface RemoteInput {
  host: string;
  port: number;
  username: string;
  password: string;
  privateKey: string;
  passphrase: string;
  platform: RemotePlatform;
  githubToken: string;
}
export interface RemoteOwner {
  owner: string;
  ownerPassword: string;
}
export interface RemoteTarget {
  platform: RemotePlatform;
  packaging: 'deb' | 'rpm' | 'exe';
  installed: boolean;
}
export class RemoteError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export function remoteInput(form: URLSearchParams): RemoteInput {
  const value = (key: string, max = 256) => {
    const v = form.get(key) ?? '';
    if (form.getAll(key).length > 1 || v.length > max || v.includes('\0'))
      throw new RemoteError('input');
    return v;
  };
  const host = value('host').trim(),
    port = Number(value('port')),
    username = value('username');
  const password = value('password', 1024),
    privateKey = value('privateKey', 32768);
  const platform = value('platform');
  if (
    (!isIP(host) && !/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host)) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !/^[a-zA-Z0-9_.@\\-]{1,128}$/.test(username) ||
    (platform !== 'linux' && platform !== 'windows') ||
    (!password && !privateKey)
  )
    throw new RemoteError('input');
  const githubToken = value('githubToken', 512);
  if (!/^[a-zA-Z0-9_-]*$/.test(githubToken)) throw new RemoteError('input');
  return {
    host,
    port,
    username,
    password,
    privateKey,
    passphrase: value('passphrase', 1024),
    platform,
    githubToken,
  };
}
export function remoteOwner(form: URLSearchParams): RemoteOwner {
  const owner = form.get('owner') ?? '',
    ownerPassword = form.get('ownerPassword') ?? '';
  if (
    form.getAll('owner').length !== 1 ||
    form.getAll('ownerPassword').length !== 1 ||
    !/^[a-zA-Z0-9_.-]{3,64}$/.test(owner) ||
    ownerPassword.length < 12 ||
    ownerPassword.length > 128 ||
    ownerPassword.includes('\0')
  )
    throw new RemoteError('owner');
  return { owner, ownerPassword };
}
export const shellQuote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export const powershellQuote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
export function powershell(script: string) {
  return (
    'powershell.exe -NoProfile -NonInteractive -EncodedCommand ' +
    Buffer.from(script, 'utf16le').toString('base64')
  );
}
