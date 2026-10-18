param([Parameter(Mandatory)][string]$Root, [ValidateSet('runtime')][string[]]$Create = @())
# Install and repair (register-windows.ps1) and native Setup before it runs code from the root
# (native/prepare.ps1) leave the root, its code directories and the installer credentials with
# Administrators (ADR 0031, addendum 2026-10-18). The data tree below the root is not walked.
# -Create: code directories created here, so they are protected before anything is put in them.
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)

# region code-directories: identical in deploy/protect-windows.ps1 and deploy/install.ps1 (tests/windows-installation.test.mjs).
$codeDirectories = @('runtime', 'releases', 'config', 'modules')
$administratorSids = @('S-1-5-18', 'S-1-5-32-544')
# The attributes of the entry itself, a link included (also a dangling one); $null when absent.
function Get-EntryAttributes([string]$path) {
    try { return [IO.File]::GetAttributes($path) }
    catch [IO.FileNotFoundException], [IO.DirectoryNotFoundException] { return $null }
}
function Assert-NotLink([string]$path) {
    $attributes = Get-EntryAttributes $path
    if ($null -ne $attributes -and ($attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "Installation stopped: $path is a link (junction or symbolic link). Replace it with a directory and run the installation again."
    }
}
# Walks without following links: a link anywhere below stops the installation.
function Assert-NoLinkBelow([string]$directory) {
    $pending = [Collections.Generic.Stack[IO.DirectoryInfo]]::new()
    $pending.Push([IO.DirectoryInfo]::new($directory))
    while ($pending.Count -gt 0) {
        $current = $pending.Pop()
        try { $entries = @($current.EnumerateFileSystemInfos()) }
        catch [UnauthorizedAccessException] { throw "Installation stopped: Administrators cannot list $($current.FullName). Give it to Administrators and run the installation again." }
        foreach ($entry in $entries) {
            if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Installation stopped: $($entry.FullName) is a link (junction or symbolic link). Installation code must not contain links."
            }
            if ($entry -is [IO.DirectoryInfo]) { $pending.Push($entry) }
        }
    }
}
# Owned by SYSTEM or Administrators, protected, and only they may change it; $readers may read.
function Test-CodeDirectory([string]$directory, [string[]]$readers) {
    $acl = [IO.Directory]::GetAccessControl($directory)
    if (-not $acl.AreAccessRulesProtected) { return $false }
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $administratorSids) { return $false }
    # ReadAndExecute and Synchronize, plus the generic read/execute bits of inherit-only entries.
    $all = [int64]4294967295
    $readOnly = [int64]0x001200A9 -bor [int64]2684354560
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        $sid = $rule.IdentityReference.Value
        if ($rule.AccessControlType -ne 'Allow' -or $sid -in $administratorSids) { continue }
        $rights = [int64][int]$rule.FileSystemRights -band $all
        if ($sid -notin $readers -or ($rights -band ($all -bxor $readOnly))) { return $false }
    }
    return $true
}
function Protect-CodeDirectory([string]$directory, [string[]]$readers) {
    Assert-NotLink $directory
    # Once protected and owned by Administrators, only they could add entries below it.
    if (Test-CodeDirectory $directory $readers) { return }
    # Otherwise entries below may belong to another account, and an owner may always rewrite a
    # DACL: the whole directory is taken over. Links are refused before and after the walk, so
    # takeown and icacls stay inside the directory.
    Assert-NoLinkBelow $directory
    & takeown.exe /F $directory /A /R | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Cannot take ownership of $directory" }
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $grants = @($administratorSids | ForEach-Object { , @($_, 'FullControl') }) + @($readers | ForEach-Object { , @($_, 'ReadAndExecute') })
    foreach ($grant in $grants) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($grant[0]), $grant[1], 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    }
    [IO.Directory]::SetAccessControl($directory, $acl)
    # Entries below keep only what they inherit from the protected directory.
    if (@([IO.Directory]::EnumerateFileSystemEntries($directory) | Select-Object -First 1).Count -gt 0) {
        & icacls.exe (Join-Path $directory '*') /reset /T /C /Q | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Cannot reset permissions below $directory" }
    }
    Assert-NoLinkBelow $directory
}
# endregion code-directories

# %ProgramData%\ProAnima above the default root inherits from ProgramData, where every user
# may create folders and owns what they create. Administrators take it over and only they
# write it. Protected children such as the root keep their own ACLs. Another parent is the
# operator's choice and stays as it is.
$vendor = Split-Path -Parent $Root
$defaultVendor = $env:ProgramData -and $vendor -ieq (Join-Path $env:ProgramData 'ProAnima')
# A link that a user put there would keep its target, which they own, open to them. Links are
# checked before anything below changes.
if ($defaultVendor) {
    $attributes = Get-EntryAttributes $vendor
    if ($null -ne $attributes -and ($attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'The ProAnima directory must not be a link' }
}
Assert-NotLink $Root
if ($Root -eq [IO.Path]::GetPathRoot($Root)) { throw 'Use a dedicated installation directory' }
New-Item -ItemType Directory -Force -Path $Root | Out-Null
foreach ($name in $codeDirectories) { Assert-NotLink (Join-Path $Root $name) }
# The owner of a directory may always rewrite its DACL: a root that another account created
# before Setup would stay theirs whatever the grants say. Administrators take the root itself.
& takeown.exe /F $Root /A | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot take ownership of the installation directory' }
# SIDs are independent of the Windows display language. Application identity cannot modify releases or updater credentials.
& icacls.exe $Root /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:(OI)(CI)RX' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot secure installation directory' }
if ($defaultVendor) {
    & takeown.exe /F $vendor /A | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot take ownership of the ProAnima directory' }
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($grant in @(@('S-1-5-18', 'FullControl'), @('S-1-5-32-544', 'FullControl'), @('S-1-5-32-545', 'ReadAndExecute'))) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($grant[0]), $grant[1], 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    }
    [IO.Directory]::SetAccessControl($vendor, $acl)
}
foreach ($name in $Create) { New-Item -ItemType Directory -Force -Path (Join-Path $Root $name) | Out-Null }
# The services (LocalService) read and run the code; the database service (NetworkService) runs
# PostgreSQL from runtime, as database-windows.ps1 grants.
foreach ($name in $codeDirectories) {
    $path = Join-Path $Root $name
    if (-not (Test-Path -LiteralPath $path -PathType Container)) { continue }
    $readers = @('S-1-5-19')
    if ($name -eq 'runtime' -and (Test-Path -LiteralPath (Join-Path $Root 'database'))) { $readers += 'S-1-5-20' }
    Protect-CodeDirectory $path $readers
}
# After the code directories: a reset of config gives its files the inherited grants again.
# github-token.txt and bootstrap.owner may exist in the root before Setup: their owner could
# rewrite the DACL again, so Administrators take each file first.
foreach ($name in @('config/bootstrap-token.txt','config/postgres.env','github-token.txt','bootstrap.owner')) {
    $path = Join-Path $Root $name
    # A link, even a dangling one, would pass what follows to its target.
    if ($null -ne (Get-EntryAttributes $path)) {
        Assert-NotLink $path
        & takeown.exe /F $path /A | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Cannot take ownership of credential file' }
        & icacls.exe $path /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Cannot secure credential file' }
    }
}
