param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$Node, [ValidatePattern('^[a-zA-Z][a-zA-Z0-9]{0,40}$')][string]$Prefix = 'Depot')
$ErrorActionPreference = 'Stop'
$admin = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run installer as Administrator' }
# SIDs are independent of the Windows display language. Application identity cannot modify releases or updater credentials.
& icacls.exe $Root /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:(OI)(CI)RX' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot secure installation directory' }
foreach ($name in @('data','logs')) {
    & icacls.exe (Join-Path $Root $name) /grant:r '*S-1-5-19:(OI)(CI)M' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot grant runtime directory access' }
}
foreach ($name in @('config/bootstrap-token.txt','config/postgres.env','github-token.txt')) {
    $path = Join-Path $Root $name
    if (Test-Path -LiteralPath $path) {
        & icacls.exe $path /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Cannot secure credential file' }
    }
}
$wrapper = Join-Path $Root 'service/WinSW-x64.exe'
if (-not (Test-Path -LiteralPath $wrapper)) {
    Invoke-WebRequest 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe' -OutFile $wrapper -UseBasicParsing
}
if ((Get-FileHash $wrapper -Algorithm SHA256).Hash -ne '05B82D46AD331CC16BDC00DE5C6332C1EF818DF8CEEFCD49C726553209B3A0DA') { throw 'WinSW checksum mismatch' }
function Xml([string]$value) { [Security.SecurityElement]::Escape($value) }
foreach ($role in @('api','worker')) {
    $name = "$Prefix$role"
    $exe = Join-Path $Root "service/depot-$role.exe"
    $existing = Get-CimInstance Win32_Service -Filter "Name='$name'"
    if ($existing -and $existing.PathName.Trim('"') -ne $exe) { throw 'Another installation owns this service' }
    Copy-Item -LiteralPath $wrapper -Destination $exe -Force
    $xml = @"
<service>
  <id>$name</id><name>ProAnima Depot $role</name>
  <description>ProAnima Depot $role service with automatic crash recovery.</description>
  <executable>$(Xml $Node)</executable>
  <arguments>&quot;$(Xml (Join-Path $Root 'launcher.mjs'))&quot; &quot;$(Xml $Root)&quot; $role</arguments>
  <workingdirectory>$(Xml $Root)</workingdirectory>
  <serviceaccount><domain>NT AUTHORITY</domain><user>LocalService</user></serviceaccount>
  <startmode>Automatic</startmode><delayedAutoStart/>
  <stoptimeout>120 sec</stoptimeout>
  <onfailure action="restart" delay="10 sec"/><resetfailure>1 hour</resetfailure>
  <logpath>$(Xml (Join-Path $Root 'logs'))</logpath>
  <log mode="roll-by-size"><sizeThreshold>20480</sizeThreshold><keepFiles>5</keepFiles></log>
</service>
"@
    [IO.File]::WriteAllText((Join-Path $Root "service/depot-$role.xml"), $xml)
    if (-not $existing) { & $exe install; if ($LASTEXITCODE -ne 0) { throw 'Service installation failed' } }
}
