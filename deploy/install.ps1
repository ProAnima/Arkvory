param([string]$Root = 'C:\ProgramData\ProAnima\Arkvory', [string]$Version = '',
    [ValidateSet('windows','compose')][string]$Mode = 'windows',
    [ValidateSet('docker','podman')][string]$Engine = 'docker',
    [string]$Config = '', [string]$Artifact = '', [switch]$AutomaticUpdates, [switch]$Pin)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$admin = [Security.Principal.WindowsPrincipal]::new($identity)
# Native services need Administrator. Compose uses the installing user's container engine:
# Docker Desktop reads bind mounts with that user's token, so the root also grants that user.
if ($Mode -eq 'windows' -and -not $admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run installer as Administrator' }
$Root = [IO.Path]::GetFullPath($Root)
if ($Root -eq [IO.Path]::GetPathRoot($Root)) { throw 'Use a dedicated installation directory' }

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

Assert-NotLink $Root
New-Item -ItemType Directory -Path $Root -Force | Out-Null
foreach ($entry in Get-ChildItem -LiteralPath $Root -Force) {
    if ($entry.Name -notmatch '^(runtime|releases|github-token\.txt|bootstrap\.[a-zA-Z0-9]+|download-[a-f0-9-]+\.zip)$') {
        throw 'Use a dedicated directory; an existing installation must be managed with manage.mjs'
    }
}
foreach ($name in @('runtime', 'releases')) { Assert-NotLink (Join-Path $Root $name) }
if ($Mode -eq 'windows') {
    # The owner of a directory may always rewrite its DACL: Administrators take the root first.
    & takeown.exe /F $Root /A | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Use a dedicated installation directory you are allowed to protect' }
}
$grants = @('*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F')
if ($Mode -eq 'compose') { $grants += '*' + $identity.User.Value + ':(OI)(CI)F' }
& icacls.exe $Root /inheritance:r /grant:r @grants | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Use a dedicated installation directory you are allowed to protect' }
$runtime = Join-Path $Root 'runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
# Native services: the code directories belong to Administrators before Node.js runs from them;
# LocalService reads them (ADR 0031). Compose keeps the grants of the root (ADR 0050).
if ($Mode -eq 'windows') {
    foreach ($name in @('runtime', 'releases')) {
        $path = Join-Path $Root $name
        if (Test-Path -LiteralPath $path -PathType Container) { Protect-CodeDirectory $path @('S-1-5-19') }
    }
}
$work = Join-Path $Root ('bootstrap.' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
$nodeName = 'node-v24.21.0-win-x64'
# SHA-256 of node.exe in the pinned archive below (scripts/native-dependencies.mjs pins the same archive).
$nodeSha256 = 'BA4E6D110E8C1592A1ECD390F6B05F3DA124B13871A5BE62B341A07A853C6C32'
$nodeEntries = @('CHANGELOG.md', 'LICENSE', 'README.md', 'corepack', 'corepack.cmd', 'install_tools.bat', 'node.exe', 'node_modules', 'nodevars.bat', 'npm', 'npm.cmd', 'npm.ps1', 'npx', 'npx.cmd', 'npx.ps1')
# A runtime is used only when node.exe has the pinned hash and nothing but the archive's own
# entries sits beside it: Windows loads libraries from the directory of an executable first.
function Test-NodeRuntime([string]$directory) {
    $exe = Join-Path $directory 'node.exe'
    $attributes = @((Get-EntryAttributes $directory), (Get-EntryAttributes $exe))
    if ($null -eq $attributes[0] -or $null -eq $attributes[1]) { return $false }
    if (($attributes[0] -bor $attributes[1]) -band [IO.FileAttributes]::ReparsePoint) { return $false }
    if (-not ($attributes[0] -band [IO.FileAttributes]::Directory) -or ($attributes[1] -band [IO.FileAttributes]::Directory)) { return $false }
    foreach ($entry in [IO.DirectoryInfo]::new($directory).EnumerateFileSystemInfos()) { if ($entry.Name -notin $nodeEntries) { return $false } }
    return (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash -eq $nodeSha256
}
$current = Join-Path $runtime $nodeName
$node = Join-Path $current 'node.exe'
if (-not (Test-NodeRuntime $current)) {
    if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'Native Windows installer currently supports x64' }
    $archive = Join-Path $work 'node.zip'
    # Three attempts with a pause for transient network failures; the checksum decides below.
    foreach ($attempt in 1..3) {
        try { Invoke-WebRequest "https://nodejs.org/dist/v24.21.0/$nodeName.zip" -OutFile $archive -UseBasicParsing; break }
        catch { if ($attempt -eq 3) { throw }; Start-Sleep -Seconds (5 * $attempt) }
    }
    if ((Get-FileHash $archive -Algorithm SHA256).Hash -ne '158F7685B44DE51F6C0DF1D153526CBCD3E1BC739A8DFC607721CEF75DE9E541') { throw 'Node.js checksum mismatch' }
    # A fresh directory inside the protected runtime directory; the runtime is switched to it only
    # after verification. Antivirus scanning can briefly hold a freshly extracted node.exe.
    # fresh-* directories that an interrupted run left were never run and are removed first;
    # Directory.Delete removes links without following them.
    foreach ($stale in [IO.Directory]::GetDirectories($runtime, 'fresh-*')) { [IO.Directory]::Delete($stale, $true) }
    $fresh = Join-Path $runtime ('fresh-' + [guid]::NewGuid().ToString('N'))
    try {
        foreach ($attempt in 1..3) {
            Expand-Archive -LiteralPath $archive -DestinationPath $fresh -Force
            if (Test-NodeRuntime (Join-Path $fresh $nodeName)) { break }
            Start-Sleep -Seconds (2 * $attempt)
        }
        if (-not (Test-NodeRuntime (Join-Path $fresh $nodeName))) { throw 'Node.js runtime is incomplete after extraction (node.exe missing or altered); check antivirus quarantine' }
        if ($null -ne (Get-EntryAttributes $current)) {
            # Kept for inspection and never run.
            $aside = Join-Path $runtime ('unverified-' + [guid]::NewGuid().ToString('N'))
            Move-Item -LiteralPath $current -Destination $aside
            Write-Warning "The Node.js runtime in $current did not pass verification; it was moved to $aside and replaced"
        }
        Move-Item -LiteralPath (Join-Path $fresh $nodeName) -Destination $current
    } finally {
        # Empty after the switch; after a failure it holds the rejected extraction. A file that
        # antivirus still holds must not hide the error above; the next run removes the rest.
        try { if ($null -ne (Get-EntryAttributes $fresh)) { [IO.Directory]::Delete($fresh, $true) } }
        catch { Write-Warning "Cannot remove $fresh yet: $($_.Exception.Message)" }
    }
    if (-not (Test-NodeRuntime $current)) { throw 'Node.js runtime verification failed' }
}
if ($Version -and $Version -notmatch '^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$') { throw 'Invalid stable version' }
if ($Artifact) {
    $Artifact = [IO.Path]::GetFullPath($Artifact)
    $manifest = Get-Content -LiteralPath (Join-Path $Artifact 'arkvory-release.json') -Raw | ConvertFrom-Json
    if ($manifest.version -notmatch '^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$') { throw 'Invalid artifact version' }
    $setup = Join-Path $Artifact 'arkvory-setup.mjs'
    if ((Get-FileHash $setup -Algorithm SHA256).Hash -ne $manifest.setupSha256) { throw 'Installer checksum mismatch' }
} else {
# Use HttpClient with redirects disabled so a private GitHub token cannot leak to a CDN.
Add-Type -AssemblyName System.Net.Http
$handler = [Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$client = [Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromMinutes(2)
$client.MaxResponseContentBufferSize = 8MB
$tokenFile = Join-Path $Root 'github-token.txt'
$token = if (Test-Path -LiteralPath $tokenFile) { [IO.File]::ReadAllText($tokenFile).Trim() } else { '' }
if ($token -notmatch '^[A-Za-z0-9_-]{0,512}$') { throw 'Invalid GitHub token file' }
$base = 'https://api.github.com/repos/ProAnima/Arkvory/releases/'
function Get-Asset([string]$url, [bool]$binary = $false) {
    if (-not $url.StartsWith($base)) { throw 'Invalid asset origin' }
    for ($redirect = 0; $redirect -lt 6; $redirect++) {
        $uri = [uri]$url
        if ($uri.Scheme -ne 'https') { throw 'Unsafe redirect' }
        $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get,$uri)
        $request.Headers.Add('User-Agent','Arkvory-Installer')
        $request.Headers.Add('Accept',$(if ($binary) { 'application/octet-stream' } else { 'application/vnd.github+json' }))
        if ($token -and $uri.Host -eq 'api.github.com') { $request.Headers.Add('Authorization',"Bearer $token") }
        $response = $null
        foreach ($attempt in 1..3) {
            try { $response = $client.SendAsync($request).GetAwaiter().GetResult() }
            catch { if ($attempt -eq 3) { throw } }
            if ($response -and [int]$response.StatusCode -lt 500) { break }
            if ($attempt -eq 3) { break }
            if ($response) { $response.Dispose(); $response = $null }
            Start-Sleep -Seconds (5 * $attempt)
            # A request message is sent once; the retry sends a copy with the same headers.
            $copy = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get,$uri)
            foreach ($header in $request.Headers) { $copy.Headers.TryAddWithoutValidation($header.Key,$header.Value) | Out-Null }
            $request = $copy
        }
        if ([int]$response.StatusCode -in @(301,302,303,307,308)) { $url = $response.Headers.Location.AbsoluteUri; $response.Dispose(); continue }
        if (-not $response.IsSuccessStatusCode) { throw "Release download failed ($([int]$response.StatusCode))" }
        $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
        if ($bytes.Length -gt 8MB) { throw 'Bootstrap asset too large' }
        $response.Dispose()
        return ,$bytes
    }
    throw 'Too many redirects'
}
$endpoint = if ($Version) { 'tags/v' + $Version } else { 'latest' }
$release = [Text.Encoding]::UTF8.GetString((Get-Asset ($base + $endpoint))) | ConvertFrom-Json
if ($release.draft -or $release.prerelease) { throw 'Stable release required' }
$manifestUrl = ($release.assets | Where-Object name -eq 'arkvory-release.json').url
$manifest = [Text.Encoding]::UTF8.GetString((Get-Asset $manifestUrl $true)) | ConvertFrom-Json
if ($release.tag_name -ne ('v' + $manifest.version)) { throw 'Tag mismatch' }
$setup = Join-Path $work 'arkvory-setup.mjs'
[IO.File]::WriteAllBytes($setup,(Get-Asset (($release.assets | Where-Object name -eq 'arkvory-setup.mjs').url) $true))
if ((Get-FileHash $setup -Algorithm SHA256).Hash -ne $manifest.setupSha256) { throw 'Installer checksum mismatch' }
}
$options = @('--mode', $Mode, '--engine', $Engine)
if ($Artifact) { $options += @('--artifact', $Artifact) }
if ($Version) { $options += @('--version', $Version) }
if ($AutomaticUpdates) { $options += '--automatic' }
if ($Pin) { $options += '--pin' }
if ($Mode -eq 'windows' -and -not $Config) {
    $secret = Read-Host 'PostgreSQL connection URL' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try {
        $Config = Join-Path $work 'native.json'
        $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        [IO.File]::WriteAllText($Config, (@{ ARKVORY_DATABASE_URL = $value } | ConvertTo-Json))
    } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $value = $null; $secret.Dispose() }
}
if ($Config) { $options += @('--config', $Config) }
& $node $setup install --root $Root @options
exit $LASTEXITCODE
