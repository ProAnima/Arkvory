param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$Node)
$ErrorActionPreference = 'Stop'
$directory = Join-Path $Root 'database'
$wrapper = Join-Path $Root 'runtime/WinSW-x64.exe'
if ((Get-FileHash -LiteralPath $wrapper -Algorithm SHA256).Hash -ne '05B82D46AD331CC16BDC00DE5C6332C1EF818DF8CEEFCD49C726553209B3A0DA') { throw 'WinSW checksum mismatch' }
# NetworkService owns the database; the API's LocalService identity has no access to it.
& icacls.exe $Root /grant:r '*S-1-5-20:(RX)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot grant database traversal' }
# Protect the directory boundary; children inherit these grants. Recursive inheritance removal
# would strip the grants again from files after applying them to their parent.
& icacls.exe $directory /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-20:(OI)(CI)M' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot protect database directory' }
foreach ($path in @((Join-Path $Root 'runtime'), (Join-Path $Root 'launcher.mjs'))) {
  & icacls.exe $path /grant:r '*S-1-5-20:(RX)' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Cannot grant database runtime access' }
}
& icacls.exe (Join-Path $Root 'runtime') /grant:r '*S-1-5-20:(OI)(CI)RX' /T | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot grant database binary access' }
$exe = Join-Path $directory 'depot-database.exe'
$existing = Get-CimInstance Win32_Service -Filter "Name='Depotdatabase'"
if ($existing -and $existing.PathName.Trim('"') -ne $exe) { throw 'Another installation owns Depotdatabase' }
if (-not $existing) {
  Copy-Item -LiteralPath $wrapper -Destination $exe
  function Xml([string]$value) { [Security.SecurityElement]::Escape($value) }
  $settings = Get-Content -LiteralPath (Join-Path $directory 'settings.json') -Raw | ConvertFrom-Json
  $xml = @"
<service>
  <id>Depotdatabase</id><name>ProAnima Depot database</name>
  <description>Dedicated PostgreSQL database for ProAnima Depot.</description>
  <executable>$(Xml $Node)</executable>
  <startarguments>&quot;$(Xml (Join-Path $Root 'launcher.mjs'))&quot; &quot;$(Xml $Root)&quot; database</startarguments>
  <workingdirectory>$(Xml $directory)</workingdirectory>
  <serviceaccount><domain>NT AUTHORITY</domain><user>NetworkService</user></serviceaccount>
  <startmode>Automatic</startmode><onfailure action="restart" delay="10 sec"/>
  <stopexecutable>$(Xml (Join-Path $settings.bin 'pg_ctl.exe'))</stopexecutable>
  <stoparguments>-D &quot;$(Xml (Join-Path $directory 'cluster'))&quot; stop -m fast -w -t 90</stoparguments>
  <stoptimeout>120 sec</stoptimeout>
  <logpath>$(Xml $directory)</logpath>
  <log mode="roll-by-size"><sizeThreshold>20480</sizeThreshold><keepFiles>5</keepFiles></log>
</service>
"@
  [IO.File]::WriteAllText((Join-Path $directory 'depot-database.xml'), $xml)
  & $exe install
  if ($LASTEXITCODE -ne 0) { throw 'Cannot register database service' }
}
if ((Get-Service Depotdatabase).Status -ne 'Running') {
  & $exe start
  if ($LASTEXITCODE -ne 0) { throw 'Cannot start database service' }
}
