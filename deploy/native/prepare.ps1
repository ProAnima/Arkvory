param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$Payload)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Root | Out-Null
& icacls.exe $Root /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot secure data root' }
# Existing installations keep their runtime and database major. Updates use the journalled updater.
if (-not (Test-Path -LiteralPath (Join-Path $Root 'installation.json'))) {
  Copy-Item -LiteralPath (Join-Path $Payload 'runtime') -Destination $Root -Recurse -Force
}
$vc = Start-Process -FilePath (Join-Path $Payload 'vc_redist.x64.exe') -ArgumentList '/install','/quiet','/norestart' -WindowStyle Hidden -Wait -PassThru
if ($vc.ExitCode -notin @(0,1638,3010)) { throw 'Microsoft runtime installation failed' }
if ($vc.ExitCode -eq 3010) { exit 3010 }
