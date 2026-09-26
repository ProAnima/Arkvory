param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$Node)
$ErrorActionPreference = 'Stop'
$taskName = 'ProAnimaArkvoryUpdate'
$arguments = '"' + (Join-Path $Root 'manage.mjs') + '" updates-poll --root "' + $Root + '"'
$legacyArguments = '"' + (Join-Path $Root 'manage.mjs') + '" update --root "' + $Root + '" --scheduled'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and ($existing.Actions.Arguments -ne $arguments) -and ($existing.Actions.Arguments -ne $legacyArguments)) { throw 'Another installation owns the updater task' }
$action = New-ScheduledTaskAction -Execute $Node -Argument $arguments -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -User SYSTEM -RunLevel Highest -Force | Out-Null
