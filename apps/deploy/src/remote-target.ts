import { randomUUID } from 'node:crypto';
import {
  RemoteError,
  powershell,
  powershellQuote as ps,
  shellQuote as sh,
} from './remote-model.js';
import type { RemotePlatform, RemoteTarget } from './remote-model.js';

export interface RemoteCommands {
  exec(command: string, input?: string, timeout?: number): Promise<string>;
}
export async function inspectTarget(
  ssh: RemoteCommands,
  platform: RemotePlatform,
): Promise<RemoteTarget> {
  const output =
    platform === 'linux'
      ? await ssh.exec(
          linuxRootCommand(`set -eu
test "$(id -u)" = 0
test "$(uname -m)" = x86_64
test -d /run/systemd/system
if command -v apt-get >/dev/null; then echo deb; elif command -v dnf >/dev/null; then echo rpm; else exit 1; fi
if test -f /opt/proanima-depot/installation.json; then echo installed; else echo new; fi`),
        )
      : await ssh.exec(
          powershell(`$ErrorActionPreference='Stop'
$p=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { exit 1 }
'exe'
if (Test-Path -LiteralPath 'C:/ProgramData/ProAnima/Depot/installation.json') { 'installed' } else { 'new' }`),
        );
  const [packaging, state, extra] = output.split(/\r?\n/);
  if (
    !['deb', 'rpm', 'exe'].includes(packaging ?? '') ||
    !['new', 'installed'].includes(state ?? '') ||
    extra !== undefined ||
    (packaging === 'exe') !== (platform === 'windows')
  )
    throw new RemoteError('target');
  if (packaging !== 'deb' && packaging !== 'rpm' && packaging !== 'exe')
    throw new RemoteError('target');
  return { platform, packaging, installed: state === 'installed' };
}
export const nativeAsset = (target: RemoteTarget) =>
  ({ deb: 'Depot-amd64.deb', rpm: 'Depot-x86_64.rpm', exe: 'Depot-Setup-x64.exe' })[
    target.packaging
  ];
export async function makeRemoteStage(ssh: RemoteCommands, target: RemoteTarget): Promise<string> {
  const id = randomUUID();
  if (target.platform === 'linux') {
    const path = '/var/tmp/depot-remote-' + id;
    await ssh.exec(`umask 077; mkdir ${sh(path)}`);
    return path;
  }
  const path = 'C:/ProgramData/DepotRemote-' + id;
  await ssh.exec(
    powershell(`$ErrorActionPreference='Stop'; New-Item -ItemType Directory -Path ${ps(path)} | Out-Null
& icacls.exe ${ps(path)} /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { exit 1 }`),
  );
  return path;
}
export function installCommand(target: RemoteTarget, path: string, hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new RemoteError('checksum');
  if (target.platform === 'linux')
    return linuxRootCommand(`set -eu
printf '%s  %s\n' ${sh(hash)} ${sh(path)} | sha256sum --check --status
${target.packaging === 'deb' ? 'apt-get update >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y' : 'dnf install -y'} ${sh(path)} >/dev/null`);
  return powershell(`$ErrorActionPreference='Stop'
if ((Get-FileHash -LiteralPath ${ps(path)} -Algorithm SHA256).Hash -ne ${ps(hash)}) { exit 1 }
$p=Start-Process -FilePath ${ps(path)} -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -WindowStyle Hidden -Wait -PassThru
exit $p.ExitCode`);
}
export function remoteNode(platform: RemotePlatform, code: string) {
  const script = `eval(Buffer.from('${Buffer.from(code).toString('base64')}','base64').toString())`;
  return platform === 'linux'
    ? linuxRootCommand(`/opt/proanima-depot/runtime/node -e ${sh(script)}`)
    : powershell(
        `& 'C:/ProgramData/ProAnima/Depot/runtime/node.exe' -e ${ps(script)}; exit $LASTEXITCODE`,
      );
}
export async function removeRemoteStage(
  ssh: RemoteCommands,
  target: RemoteTarget,
  directory: string,
) {
  const prefix =
    target.platform === 'linux' ? '/var/tmp/depot-remote-' : 'C:/ProgramData/DepotRemote-';
  if (!directory.startsWith(prefix) || !/^[a-f0-9-]{36}$/.test(directory.slice(prefix.length)))
    throw new RemoteError('target');
  const file = directory + '/' + nativeAsset(target);
  // Delete only our installer and then the empty directory; never recursively delete remote content.
  await ssh.exec(
    target.platform === 'linux'
      ? `rm -f -- ${sh(file)} && rmdir -- ${sh(directory)}`
      : powershell(
          `$ErrorActionPreference='Stop'; Remove-Item -LiteralPath ${ps(file)} -Force; [IO.Directory]::Delete(${ps(directory)},$false)`,
        ),
    '',
    10000,
  );
}
function linuxRootCommand(command: string) {
  return `if [ "$(id -u)" = 0 ]; then sh -c ${sh(command)}; else sudo -n sh -c ${sh(command)}; fi`;
}
