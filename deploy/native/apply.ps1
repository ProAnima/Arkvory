param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$Payload, [string]$OwnerFile)
$ErrorActionPreference = 'Stop'
$arguments = @((Join-Path $Payload 'arkvory-setup.mjs'))
if (Test-Path -LiteralPath (Join-Path $Root 'installation.json')) {
  $arguments += @('apply-installer','--artifact',$Payload)
} else {
  $arguments += @('install','--mode','windows','--artifact',$Payload,'--database-bin',(Join-Path $Root 'runtime/postgres/bin'))
  if ($OwnerFile) { $arguments += @('--owner-file',$OwnerFile) }
}
$arguments += @('--root',$Root)
# The protected bootstrap.* path is allowed before initialize() creates config/logs.
$log = Join-Path $Root 'bootstrap.log'
$ErrorActionPreference = 'Continue'
& (Join-Path $Root 'runtime/node.exe') @arguments > $log 2>&1
$code = $LASTEXITCODE
exit $code
