import { execFile } from 'node:child_process';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Why the loader does not trust a path of the module directory (ADR 0078, 3.3). */
export type ModuleAccessProblem =
  'access_link' | 'access_special' | 'access_unsafe' | 'access_too_many' | 'access_unverified';

export class ModuleAccessError extends Error {
  override readonly name = 'ModuleAccessError';
  constructor(
    readonly code: ModuleAccessProblem,
    options?: ErrorOptions,
  ) {
    super(`Module directory check failed: ${code}`, options);
  }
}

/** Entries of one package tree the walk visits at most: the package limit of 8192 entries. */
const MAX_TREE_ENTRIES = 8193;

/**
 * Every path of a package tree, the root first, without following links. A link, a junction or
 * a device anywhere under it is refused: the loader imports only what it verified, and a link
 * could point the import outside the verified tree after the check.
 */
export async function packageTree(root: string): Promise<string[]> {
  const found: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const path = pending.pop() ?? root;
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new ModuleAccessError('access_link');
    if (!info.isDirectory() && !info.isFile()) throw new ModuleAccessError('access_special');
    found.push(path);
    if (found.length > MAX_TREE_ENTRIES) throw new ModuleAccessError('access_too_many');
    if (info.isDirectory()) for (const name of await readdir(path)) pending.push(join(path, name));
  }
  return found;
}

/**
 * POSIX: an entry is safe when neither its group nor others may write it and it belongs to root
 * or to the owner of the installation root. The service account normally owns neither, so a
 * compromised service cannot plant code that it and the other processes load at their next
 * start; the host administrator installs packages (ADR 0078, 3.3).
 */
async function unsafePosix(
  paths: readonly string[],
  installation: string,
): Promise<Map<string, string>> {
  const owner = (await lstat(installation)).uid;
  const trusted = new Set([0, owner]);
  const unsafe = new Map<string, string>();
  for (const path of paths) {
    const info = await lstat(path);
    if ((info.mode & 0o022) !== 0 || !trusted.has(info.uid))
      unsafe.set(
        path,
        `mode ${(info.mode & 0o7777).toString(8)} uid ${String(info.uid)}; root uid ${String(owner)}`,
      );
  }
  return unsafe;
}

/** Rights that change what an entry holds or who may change it (FileSystemRights). */
const WRITE_RIGHTS = [
  0x2, // WriteData / CreateFiles
  0x4, // AppendData / CreateDirectories
  0x10, // WriteExtendedAttributes
  0x40, // DeleteSubdirectoriesAndFiles
  0x100, // WriteAttributes
  0x10000, // Delete
  0x40000, // ChangePermissions
  0x80000, // TakeOwnership
  0x10000000, // GenericAll
  0x40000000, // GenericWrite
].reduce((mask, right) => mask | right, 0);

/** SYSTEM, Administrators and TrustedInstaller: the host administrator on Windows. */
const ADMINISTRATORS = [
  'S-1-5-18',
  'S-1-5-32-544',
  'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464',
];
/** CREATOR OWNER and CREATOR GROUP only shape inherited entries; they grant nothing here. */
const INHERITANCE_ONLY = ['S-1-3-0', 'S-1-3-1'];

/**
 * Reads owner and access rules as SIDs, so the result does not depend on the display language,
 * and the SID of the account running the check. Paths arrive on standard input as JSON with
 * every non-ASCII character escaped, and the answer is UTF-8 JSON in input order, so no path is
 * quoted into the script or read back from it.
 * Commands come only from the modules of this PowerShell: autoloading would search the module
 * path first in Documents of the service profile, which every LocalService service may write,
 * and a module planted there could answer Get-Acl with "SYSTEM only" for every path.
 */
const ACL_SCRIPT = `
$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
Import-Module -Name ($PSHOME + '\\Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1')
Import-Module -Name ($PSHOME + '\\Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1')
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$sid = [System.Security.Principal.SecurityIdentifier]
$paths = [Console]::In.ReadToEnd() | ConvertFrom-Json
$result = foreach ($path in $paths) {
  $acl = Get-Acl -LiteralPath $path
  $rules = foreach ($rule in $acl.GetAccessRules($true, $true, $sid)) {
    [pscustomobject]@{
      sid = $rule.IdentityReference.Value
      rights = [int64]$rule.FileSystemRights.value__
      allow = ($rule.AccessControlType -eq 'Allow')
      inheritOnly = (($rule.PropagationFlags -band 2) -ne 0)
    }
  }
  [pscustomobject]@{ owner = $acl.GetOwner($sid).Value; rules = @($rules) }
}
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
ConvertTo-Json -InputObject ([pscustomobject]@{ user = $user; entries = @($result) }) -Depth 5 -Compress
`;

/** Owner and access rules of one path, as SIDs (Windows). */
export interface AclEntry {
  readonly owner: string;
  readonly rules: readonly {
    readonly sid: string;
    readonly rights: number;
    readonly allow: boolean;
    readonly inheritOnly: boolean;
  }[];
}

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;

function aclRule(rule: unknown): AclEntry['rules'][number] {
  const sid = field(rule, 'sid');
  const rights = field(rule, 'rights');
  const allow = field(rule, 'allow');
  const inheritOnly = field(rule, 'inheritOnly');
  if (
    typeof sid !== 'string' ||
    typeof rights !== 'number' ||
    !Number.isSafeInteger(rights) ||
    typeof allow !== 'boolean' ||
    typeof inheritOnly !== 'boolean'
  )
    throw new Error('Unexpected ACL rule');
  return { sid, rights, allow, inheritOnly };
}

/** The answer of the script, read as untrusted input like any other process output. */
function aclEntries(output: string, count: number): { user: string; entries: AclEntry[] } {
  const parsed: unknown = JSON.parse(output);
  const user = field(parsed, 'user');
  const entries = field(parsed, 'entries');
  if (typeof user !== 'string' || !Array.isArray(entries) || entries.length !== count)
    throw new Error('Unexpected ACL answer');
  return { user, entries: entries.map(aclEntry) };
}

function aclEntry(item: unknown): AclEntry {
  const owner = field(item, 'owner');
  const rules = field(item, 'rules');
  if (typeof owner !== 'string' || !Array.isArray(rules)) throw new Error('Unexpected ACL entry');
  return { owner, rules: rules.map(aclRule) };
}

const escaped = (text: string) =>
  text.replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

function readAcls(paths: readonly string[]): Promise<{ user: string; entries: AclEntry[] }> {
  // SystemRoot comes from the service environment, which only the administrator sets.
  const home = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell');
  const script = Buffer.from(ACL_SCRIPT, 'utf16le').toString('base64');
  // Neither the module path of PowerShell 7 nor the per-user one: the system modules only.
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'),
    ),
    PSModulePath: join(home, 'v1.0', 'Modules'),
  };
  return new Promise((resolve, reject) => {
    const child = execFile(
      join(home, 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', script],
      { env, timeout: 60_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error) reject(new Error('ACL check failed', { cause: error }));
        else
          try {
            resolve(aclEntries(stdout, paths.length));
          } catch (failure) {
            reject(failure instanceof Error ? failure : new Error('Unexpected ACL answer'));
          }
      },
    );
    child.stdin?.end(escaped(JSON.stringify(paths)));
  });
}

/**
 * Windows: an entry is safe when its owner and every principal an access rule lets write,
 * delete or change its permissions are the host administrators (SYSTEM, Administrators,
 * TrustedInstaller) or the owner of the installation root. The service account (LocalService)
 * reads the modules but never writes them. Deny rules only take rights away and are ignored; an
 * inherit-only rule and CREATOR OWNER or CREATOR GROUP only shape children and grant nothing on
 * the entry. Another account is untrusted even when it is an administrator: a SID says nothing
 * about group membership, so a rule for one administrator's own SID makes the entry unsafe.
 */
export function aclProblem(root: AclEntry, entry: AclEntry): string | null {
  const trusted = new Set([...ADMINISTRATORS, root.owner]);
  if (!trusted.has(entry.owner)) return `owner ${entry.owner}; root owner ${root.owner}`;
  const writer = entry.rules.find(
    (rule) =>
      rule.allow &&
      !rule.inheritOnly &&
      (rule.rights & WRITE_RIGHTS) !== 0 &&
      !INHERITANCE_ONLY.includes(rule.sid) &&
      !trusted.has(rule.sid),
  );
  if (writer === undefined) return null;
  const rights = (writer.rights >>> 0).toString(16);
  return `rule ${writer.sid} rights 0x${rights}; owner ${entry.owner}; root owner ${root.owner}`;
}

/** Whether `aclProblem` finds a reason. */
export const unsafeAcl = (root: AclEntry, entry: AclEntry) => aclProblem(root, entry) !== null;

async function unsafeWindows(
  paths: readonly string[],
  installation: string,
): Promise<Map<string, string>> {
  const [root, ...entries] = (await readAcls([installation, ...paths])).entries;
  if (root === undefined) throw new Error('Unexpected ACL answer');
  const unsafe = new Map<string, string>();
  entries.forEach((entry, index) => {
    const path = paths[index];
    const problem = aclProblem(root, entry);
    if (path !== undefined && problem !== null) unsafe.set(path, problem);
  });
  return unsafe;
}

/**
 * The paths among `paths` that someone other than the host administrator may change, each with
 * the reason (mode and owner, or the SID, rights and owners of the rule) for the diagnostic
 * detail of a refusal; it names accounts and stays out of logs and metrics. The check runs
 * before any byte of a package is read: once it passes, nothing between the verification of
 * the files and their import can be changed by anyone the core does not trust. A check that
 * cannot run (no PowerShell, a timeout) is `access_unverified`: no module is loaded then.
 */
export async function unsafeEntries(
  paths: readonly string[],
  /** The installation root, whose owner is trusted beside root or the administrators. */
  installation: string,
  platform: NodeJS.Platform = process.platform,
): Promise<ReadonlyMap<string, string>> {
  if (paths.length === 0) return new Map();
  if (platform !== 'win32') return unsafePosix(paths, installation);
  try {
    return await unsafeWindows(paths, installation);
  } catch (error) {
    throw new ModuleAccessError('access_unverified', { cause: error });
  }
}

/**
 * The paths among `paths` that someone other than the account running this process (or root,
 * or the Windows host administrators — SYSTEM, Administrators, TrustedInstaller) may change,
 * each with the reason. For files a user keeps for themselves, such as the client modules of
 * `arkvoryctl` (ADR 0079, 5.11): on POSIX the owner must be this user and neither group nor
 * others may write; on Windows the owner and every principal a rule lets write, delete or change
 * permissions must be this account or the administrators, by the rules of `aclProblem`. A check
 * that cannot run is `access_unverified`.
 */
export async function unsafeForUser(
  paths: readonly string[],
  platform: NodeJS.Platform = process.platform,
): Promise<ReadonlyMap<string, string>> {
  if (paths.length === 0) return new Map();
  if (platform !== 'win32') {
    const uid = process.getuid?.();
    const unsafe = new Map<string, string>();
    for (const path of paths) {
      const info = await lstat(path);
      if ((info.mode & 0o022) !== 0 || (uid !== undefined && info.uid !== uid && info.uid !== 0))
        unsafe.set(path, `mode ${(info.mode & 0o7777).toString(8)} uid ${String(info.uid)}`);
    }
    return unsafe;
  }
  let answer;
  try {
    answer = await readAcls(paths);
  } catch (error) {
    throw new ModuleAccessError('access_unverified', { cause: error });
  }
  const self: AclEntry = { owner: answer.user, rules: [] };
  const unsafe = new Map<string, string>();
  answer.entries.forEach((entry, index) => {
    const path = paths[index];
    const problem = aclProblem(self, entry);
    if (path !== undefined && problem !== null) unsafe.set(path, problem);
  });
  return unsafe;
}
