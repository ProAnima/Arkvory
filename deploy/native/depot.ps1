$ErrorActionPreference = 'Stop'
$root = Join-Path $env:ProgramData 'ProAnima/Depot'
if ($args.Count -eq 0 -or $args[0] -in @('help','--help','-h')) {
  & (Join-Path $root 'runtime/node.exe') (Join-Path $PSScriptRoot 'depot-setup.mjs') help
} else {
  & (Join-Path $root 'runtime/node.exe') (Join-Path $root 'manage.mjs') @args
}
exit $LASTEXITCODE
