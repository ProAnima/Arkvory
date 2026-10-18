import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The Windows scripts run elevated; gate deployment-services executes them on Windows. These
// checks keep their order and their shared code consistent on every OS.
const read = (path) => readFile(path, 'utf8');
const region = (text) => {
  const start = text.indexOf('# region code-directories');
  const end = text.indexOf('# endregion code-directories');
  assert.ok(start >= 0 && end > start, 'code-directories region');
  return text.slice(start, end);
};
/** Every text occurs, each after the previous one. */
function inOrder(text, parts) {
  let from = 0;
  for (const part of parts) {
    const index = text.indexOf(part, from);
    assert.ok(index >= 0, `missing or out of order: ${part}`);
    from = index + part.length;
  }
}

test('install.ps1 and protect-windows.ps1 share one copy of the code-directory rules', async () => {
  const install = await read('deploy/install.ps1');
  const protect = await read('deploy/protect-windows.ps1');
  assert.equal(region(install), region(protect));
  inOrder(region(protect), [
    "$codeDirectories = @('runtime', 'releases', 'config', 'modules')",
    'function Protect-CodeDirectory',
    'Assert-NotLink $directory',
    'if (Test-CodeDirectory $directory $readers) { return }',
    'Assert-NoLinkBelow $directory',
    '& takeown.exe /F $directory /A /R',
    '$acl.SetAccessRuleProtection($true, $false)',
    '[IO.Directory]::SetAccessControl($directory, $acl)',
    '/reset /T /C /Q',
    'Assert-NoLinkBelow $directory',
  ]);
});

test('install.ps1 runs Node.js only after the runtime passed verification', async () => {
  const install = await read('deploy/install.ps1');
  inOrder(install, [
    "foreach ($name in @('runtime', 'releases')) { Assert-NotLink (Join-Path $Root $name) }",
    '& takeown.exe /F $Root /A',
    '& icacls.exe $Root /inheritance:r',
    "Protect-CodeDirectory $path @('S-1-5-19')",
    "$nodeSha256 = 'BA4E6D110E8C1592A1ECD390F6B05F3DA124B13871A5BE62B341A07A853C6C32'",
    'return (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash -eq $nodeSha256',
    '$node = Join-Path $current',
    'if (-not (Test-NodeRuntime $current)) {',
    "-ne '158F7685B44DE51F6C0DF1D153526CBCD3E1BC739A8DFC607721CEF75DE9E541'",
    "$fresh = Join-Path $runtime ('fresh-'",
    'if (-not (Test-NodeRuntime (Join-Path $fresh $nodeName))) { throw',
    'Move-Item -LiteralPath $current -Destination $aside',
    'Move-Item -LiteralPath (Join-Path $fresh $nodeName) -Destination $current',
    "if (-not (Test-NodeRuntime $current)) { throw 'Node.js runtime verification failed' }",
    '& $node $setup install',
  ]);
  assert.equal(install.match(/& \$node /g)?.length, 1, 'Node.js starts once, at the end');
  // The archive pin matches the native packaging pin.
  assert.match(
    await read('scripts/native-dependencies.mjs'),
    /158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541/,
  );
});

test('install, repair and native Setup protect the root before code from it runs', async () => {
  const protect = await read('deploy/protect-windows.ps1');
  inOrder(protect, [
    "throw 'The ProAnima directory must not be a link'",
    'Assert-NotLink $Root',
    'foreach ($name in $codeDirectories) { Assert-NotLink (Join-Path $Root $name) }',
    '& takeown.exe /F $Root /A',
    "if ($name -eq 'runtime' -and (Test-Path -LiteralPath (Join-Path $Root 'database'))) { $readers += 'S-1-5-20' }",
    'Protect-CodeDirectory $path $readers',
    "'config/bootstrap-token.txt','config/postgres.env','github-token.txt','bootstrap.owner'",
    'Assert-NotLink $path',
    '& takeown.exe /F $path /A',
    "& icacls.exe $path /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F'",
  ]);
  inOrder(await read('deploy/register-windows.ps1'), [
    'if (-not $ServicesOnly) {',
    "& (Join-Path $PSScriptRoot 'protect-windows.ps1') -Root $Root",
    'Get-CimInstance Win32_Service',
  ]);
  inOrder(await read('deploy/native/prepare.ps1'), [
    "if ($fresh) { $protect.Create = @('runtime') }",
    "& (Join-Path $PSScriptRoot 'protect-windows.ps1') @protect",
    "[IO.File]::Delete((Join-Path $Root 'bootstrap.owner'))",
    'Copy-Item -LiteralPath $shipped',
    'is not part of the shipped runtime',
  ]);
  assert.match(
    await read('scripts/package-native.mjs'),
    /copyFile\('deploy\/protect-windows\.ps1', join\(payload, 'protect-windows\.ps1'\)\)/,
  );
  // database-windows.ps1 still grants NetworkService the runtime it reads.
  assert.match(
    await read('deploy/database-windows.ps1'),
    /icacls\.exe \(Join-Path \$Root 'runtime'\) \/grant:r '\*S-1-5-20:\(OI\)\(CI\)RX' \/T/,
  );
});
