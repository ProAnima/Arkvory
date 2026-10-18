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
if test -f /opt/proanima-arkvory/installation.json; then echo installed; else echo new; fi`),
        )
      : await ssh.exec(
          powershell(`$ErrorActionPreference='Stop'
$p=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { exit 1 }
'exe'
if (Test-Path -LiteralPath 'C:/ProgramData/ProAnima/Arkvory/installation.json') { 'installed' } else { 'new' }`),
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
  ({ deb: 'Arkvory-amd64.deb', rpm: 'Arkvory-x86_64.rpm', exe: 'Arkvory-Setup-x64.exe' })[
    target.packaging
  ];
const stagePrefix = (target: RemoteTarget) =>
  target.platform === 'linux' ? '/var/tmp/arkvory-remote-' : 'C:/ProgramData/ArkvoryRemote-';
/** A stage directory that makeRemoteStage named, or a target error. */
function checkedStage(target: RemoteTarget, directory: string): string {
  const prefix = stagePrefix(target);
  if (!directory.startsWith(prefix) || !/^[a-f0-9-]{36}$/.test(directory.slice(prefix.length)))
    throw new RemoteError('target');
  return directory;
}
/** The copy of the uploaded Windows installer that installCommand verifies and runs. */
const verifiedInstaller = (directory: string, target: RemoteTarget) =>
  directory + '/verified-' + nativeAsset(target);
const administrators = `[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')`;
/**
 * PowerShell: $stage is a directory, not a link, owned by Administrators, with a protected DACL
 * of SYSTEM and Administrators only. Anything else stops the script.
 */
const protectedStage = `$item=Get-Item -LiteralPath $stage -Force
if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Remote stage is not a directory' }
$acl=[IO.Directory]::GetAccessControl($stage)
if (-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne 'S-1-5-32-544') { throw 'Remote stage is not protected' }
foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) { if ($rule.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544')) { throw 'Remote stage is not protected' } }`;
/**
 * Linux: a new 0700 directory (mkdir fails if it exists). Windows: the directory is created with
 * its owner and protected DACL in the same call, so non-administrators can never write it; an
 * existing path stops, and a directory someone else created in between fails the check.
 */
export async function makeRemoteStage(
  ssh: RemoteCommands,
  target: RemoteTarget,
  id: string = randomUUID(),
): Promise<string> {
  const path = checkedStage(target, stagePrefix(target) + id);
  if (target.platform === 'linux') {
    await ssh.exec(`umask 077; mkdir ${sh(path)}`);
    return path;
  }
  await ssh.exec(
    powershell(`$ErrorActionPreference='Stop'
$stage=${ps(path)}
if (Test-Path -LiteralPath $stage) { throw 'Remote stage exists' }
$sd=[Security.AccessControl.DirectorySecurity]::new()
$sd.SetOwner(${administrators})
$sd.SetAccessRuleProtection($true,$false)
foreach ($sid in @('S-1-5-18','S-1-5-32-544')) { $sd.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow')) }
[IO.Directory]::CreateDirectory($stage,$sd) | Out-Null
${protectedStage}`),
  );
  return path;
}
/**
 * Windows: the uploaded installer is copied into a new file of the protected stage, hashed there
 * and run from there while this script holds it open for reading only; the copy is removed on
 * every path (removeRemoteStage removes what an interrupted connection leaves).
 */
export function installCommand(target: RemoteTarget, path: string, hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new RemoteError('checksum');
  if (target.platform === 'linux')
    return linuxRootCommand(`set -eu
printf '%s  %s\n' ${sh(hash)} ${sh(path)} | sha256sum --check --status
${target.packaging === 'deb' ? 'apt-get update >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y' : 'dnf install -y'} ${sh(path)} >/dev/null`);
  const directory = checkedStage(target, path.slice(0, path.lastIndexOf('/')));
  if (path !== directory + '/' + nativeAsset(target)) throw new RemoteError('target');
  return powershell(`$ErrorActionPreference='Stop'
$stage=${ps(directory)}
${protectedStage}
$verified=${ps(verifiedInstaller(directory, target))}
$code=3
try {
$source=[IO.File]::Open(${ps(path)},'Open','Read','Read')
try { $copy=[IO.File]::Open($verified,'CreateNew','ReadWrite','None'); try { $source.CopyTo($copy) } finally { $copy.Dispose() } } finally { $source.Dispose() }
$held=[IO.File]::Open($verified,'Open','Read','Read')
try {
$digest=-join ([Security.Cryptography.SHA256]::Create().ComputeHash($held) | ForEach-Object { $_.ToString('x2') })
if ($digest -eq ${ps(hash)}) {
$p=Start-Process -FilePath $verified -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -WindowStyle Hidden -Wait -PassThru
$code=$p.ExitCode
}
} finally { $held.Dispose() }
} finally { if (Test-Path -LiteralPath $verified) { try { Remove-Item -LiteralPath $verified -Force } catch { } } }
exit $code`);
}
export function remoteNode(platform: RemotePlatform, code: string) {
  const script = `eval(Buffer.from('${Buffer.from(code).toString('base64')}','base64').toString())`;
  return platform === 'linux'
    ? linuxRootCommand(`/opt/proanima-arkvory/runtime/node -e ${sh(script)}`)
    : powershell(
        `& 'C:/ProgramData/ProAnima/Arkvory/runtime/node.exe' -e ${ps(script)}; exit $LASTEXITCODE`,
      );
}
export async function removeRemoteStage(
  ssh: RemoteCommands,
  target: RemoteTarget,
  directory: string,
) {
  checkedStage(target, directory);
  const file = directory + '/' + nativeAsset(target);
  // Delete only our installer (and its verified copy) and then the empty directory; never
  // recursively delete remote content.
  await ssh.exec(
    target.platform === 'linux'
      ? `rm -f -- ${sh(file)} && rmdir -- ${sh(directory)}`
      : powershell(
          `$ErrorActionPreference='Stop'; foreach ($file in @(${ps(file)},${ps(verifiedInstaller(directory, target))})) { if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force } }; [IO.Directory]::Delete(${ps(directory)},$false)`,
        ),
    '',
    10000,
  );
}
function linuxRootCommand(command: string) {
  return `if [ "$(id -u)" = 0 ]; then sh -c ${sh(command)}; else sudo -n sh -c ${sh(command)}; fi`;
}
