param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$Payload)
$ErrorActionPreference = 'Stop'
$fresh = -not (Test-Path -LiteralPath (Join-Path $Root 'installation.json'))
# apply.ps1 runs Node.js from the root next: the root, its code directories and the credential
# files belong to Administrators before that, and links there stop Setup (ADR 0031). A new
# installation gets a protected runtime directory before the runtime is copied into it.
$protect = @{ Root = $Root }
if ($fresh) { $protect.Create = @('runtime') }
& (Join-Path $PSScriptRoot 'protect-windows.ps1') @protect
# Existing installations keep their runtime and database major. Updates use the journalled updater.
if ($fresh) {
  $shipped = Join-Path $Payload 'runtime'
  $runtime = Join-Path $Root 'runtime'
  Copy-Item -LiteralPath $shipped -Destination $Root -Recurse -Force
  # A new installation runs exactly the runtime Setup ships: Windows loads libraries from the
  # directory of an executable first, so nothing else may remain beside it.
  $expected = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($entry in Get-ChildItem -LiteralPath $shipped -Recurse -Force) { [void]$expected.Add($entry.FullName.Substring($shipped.Length)) }
  foreach ($entry in Get-ChildItem -LiteralPath $runtime -Recurse -Force) {
    if (-not $expected.Contains($entry.FullName.Substring($runtime.Length))) { throw "Setup stopped: $($entry.FullName) is not part of the shipped runtime. Remove $runtime and run Setup again." }
  }
}
$vc = Start-Process -FilePath (Join-Path $Payload 'vc_redist.x64.exe') -ArgumentList '/install','/quiet','/norestart' -WindowStyle Hidden -Wait -PassThru
if ($vc.ExitCode -notin @(0,1638,3010)) { throw 'Microsoft runtime installation failed' }
if ($vc.ExitCode -eq 3010) { exit 3010 }
