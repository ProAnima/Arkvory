param([Parameter(Mandatory)][string]$Vault, [switch]$EngineUser)
$ErrorActionPreference = 'Stop'
# Opens a backup vault directory for the agent (ADR 0057). The vault holds catalogue exports,
# password hashes and content, so inherited access (for example Users on a data drive) is
# removed. SIDs are independent of the Windows display language. Native services run as
# LocalService (S-1-5-19); Compose reads bind mounts with the Docker Desktop user's token.
if (-not [IO.Path]::IsPathRooted($Vault) -or $Vault.StartsWith('\\')) { throw 'The vault must be a local absolute path' }
if (-not (Test-Path -LiteralPath $Vault -PathType Container)) { throw 'The vault must be an existing directory' }
$grants = @('*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F')
if ($EngineUser) { $grants += '*' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value + ':(OI)(CI)F' }
else { $grants += '*S-1-5-19:(OI)(CI)M' }
& icacls.exe $Vault /inheritance:r /grant:r @grants | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot restrict the backup vault directory' }
