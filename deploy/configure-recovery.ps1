param([Parameter(Mandatory)][ValidatePattern('^[a-zA-Z][a-zA-Z0-9]{0,40}$')][string]$Name, [switch]$Delayed)
$ErrorActionPreference = 'Stop'
# SCM persists these settings independently of WinSW XML. Reapply them during repair too.
$mode = if ($Delayed) { 'delayed-auto' } else { 'auto' }
& sc.exe config $Name start= $mode | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Cannot configure automatic start for $Name" }
& sc.exe failure $Name reset= 3600 actions= restart/10000 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Cannot configure crash recovery for $Name" }
& sc.exe failureflag $Name 1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Cannot enable failure recovery for $Name" }
