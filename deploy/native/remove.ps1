param([Parameter(Mandatory)][string]$Root)
$ErrorActionPreference = 'Stop'
$task = Get-ScheduledTask -TaskName 'ProAnimaDepotUpdate' -ErrorAction SilentlyContinue
if ($task) {
  $expected = '"' + (Join-Path $Root 'manage.mjs') + '" update --root "' + $Root + '" --scheduled'
  if ($task.Actions.Arguments -ne $expected) { throw 'Another installation owns the updater task' }
  Unregister-ScheduledTask -TaskName 'ProAnimaDepotUpdate' -Confirm:$false
}
foreach ($entry in @(@('Depotworker','service/depot-worker.exe'),@('Depotapi','service/depot-api.exe'),@('Depotdatabase','database/depot-database.exe'))) {
  $service = Get-CimInstance Win32_Service -Filter "Name='$($entry[0])'"
  $exe = Join-Path $Root $entry[1]
  if ($service) {
    if ($service.PathName.Trim('"') -ne $exe) { throw 'Refusing to remove another installation service' }
    if ($service.State -ne 'Stopped') { & $exe stopwait; if ($LASTEXITCODE -ne 0) { throw 'Service stop failed' } }
    & $exe uninstall
    if ($LASTEXITCODE -ne 0) { throw 'Service removal failed' }
  }
}
# Deliberately retain the complete ProgramData tree, including database, blobs and recovery credentials.
