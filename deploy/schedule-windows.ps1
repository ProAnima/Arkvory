param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$Node)
$ErrorActionPreference = 'Stop'
$taskName = 'ProAnimaDepotUpdate'
$arguments = '"' + (Join-Path $Root 'manage.mjs') + '" update --root "' + $Root + '" --scheduled'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and ($existing.Actions.Arguments -ne $arguments)) { throw 'Another installation owns the updater task' }
$action = New-ScheduledTaskAction -Execute $Node -Argument $arguments -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -Daily -At '03:00' -RandomDelay (New-TimeSpan -Minutes 30)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -User SYSTEM -RunLevel Highest -Force | Out-Null
