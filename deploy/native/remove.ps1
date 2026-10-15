param([Parameter(Mandatory)][string]$Root)
$ErrorActionPreference = 'Stop'
$task = Get-ScheduledTask -TaskName 'ProAnimaArkvoryUpdate' -ErrorAction SilentlyContinue
if ($task) {
  $expected = '"' + (Join-Path $Root 'manage.mjs') + '" update --root "' + $Root + '" --scheduled'
  $monitor = '"' + (Join-Path $Root 'manage.mjs') + '" updates-poll --root "' + $Root + '"'
  if (($task.Actions.Arguments -ne $expected) -and ($task.Actions.Arguments -ne $monitor)) { throw 'Another installation owns the updater task' }
  Unregister-ScheduledTask -TaskName 'ProAnimaArkvoryUpdate' -Confirm:$false
}
foreach ($entry in @(@('Arkvorybackup','service/arkvory-backup.exe'),@('Arkvoryworker','service/arkvory-worker.exe'),@('Arkvoryapi','service/arkvory-api.exe'),@('Arkvorydatabase','database/arkvory-database.exe'))) {
  $service = Get-CimInstance Win32_Service -Filter "Name='$($entry[0])'"
  $exe = Join-Path $Root $entry[1]
  if ($service) {
    if ($service.PathName.Trim('"') -ne $exe) { throw 'Refusing to remove another installation service' }
    if ($service.State -ne 'Stopped') { & $exe stopwait; if ($LASTEXITCODE -ne 0) { throw 'Service stop failed' } }
    & $exe uninstall
    if ($LASTEXITCODE -ne 0) { throw 'Service removal failed' }
  }
}
# Release only the port exclusion Arkvory added (database/port-exclusion), after the database stopped.
# A failure leaves the marker and does not block uninstall; reinstalling over the kept tree reuses it.
$marker = Join-Path $Root 'database/port-exclusion'
if (Test-Path -LiteralPath $marker) {
  $port = 0
  if (-not [int]::TryParse((Get-Content -LiteralPath $marker -Raw).Trim(), [ref]$port) -or $port -lt 1024 -or $port -gt 65535) {
    Write-Warning 'Invalid database port exclusion marker; no exclusion removed'
  } else {
    & netsh.exe int ipv4 delete excludedportrange protocol=tcp startport=$port numberofports=1 store=persistent | Out-Null
    if ($LASTEXITCODE -eq 0) { Remove-Item -LiteralPath $marker } else { Write-Warning "Cannot remove the exclusion of database port $port" }
  }
}
# Deliberately retain the complete ProgramData tree, including database, blobs and recovery credentials.
# The backup vault lives outside the root and is never touched.
