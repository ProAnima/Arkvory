$ErrorActionPreference = 'Stop'
$runtime = Join-Path $PSScriptRoot 'node.exe'
$wizard = Join-Path $PSScriptRoot 'arkvory-remote.mjs'
Start-Process -FilePath $runtime -ArgumentList ('"' + $wizard + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
