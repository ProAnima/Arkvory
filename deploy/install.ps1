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
New-Item -ItemType Directory -Path $Root -Force | Out-Null
if ($Root -eq [IO.Path]::GetPathRoot($Root)) { throw 'Use a dedicated installation directory' }
foreach ($entry in Get-ChildItem -LiteralPath $Root -Force) {
    if ($entry.Name -notmatch '^(runtime|releases|github-token\.txt|bootstrap\.[a-zA-Z0-9]+|download-[a-f0-9-]+\.zip)$') {
        throw 'Use a dedicated directory; an existing installation must be managed with manage.mjs'
    }
}
$grants = @('*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F')
if ($Mode -eq 'compose') { $grants += '*' + $identity.User.Value + ':(OI)(CI)F' }
& icacls.exe $Root /inheritance:r /grant:r @grants | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Use a dedicated installation directory you are allowed to protect' }
$work = Join-Path $Root ('bootstrap.' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
$node = Join-Path $Root 'runtime/node-v24.21.0-win-x64/node.exe'
if (-not (Test-Path -LiteralPath $node)) {
    if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'Native Windows installer currently supports x64' }
    $archive = Join-Path $work 'node.zip'
    # Three attempts with a pause for transient network failures; the checksum decides below.
    foreach ($attempt in 1..3) {
        try { Invoke-WebRequest 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip' -OutFile $archive -UseBasicParsing; break }
        catch { if ($attempt -eq 3) { throw }; Start-Sleep -Seconds (5 * $attempt) }
    }
    if ((Get-FileHash $archive -Algorithm SHA256).Hash -ne '158F7685B44DE51F6C0DF1D153526CBCD3E1BC739A8DFC607721CEF75DE9E541') { throw 'Node.js checksum mismatch' }
    $node = Join-Path $Root 'runtime/node-v24.21.0-win-x64/node.exe'
    # Antivirus scanning can briefly hold a freshly extracted node.exe; retry before failing clearly.
    foreach ($attempt in 1..3) {
        Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $Root 'runtime') -Force
        if (Test-Path -LiteralPath $node) { break }
        Start-Sleep -Seconds (2 * $attempt)
    }
    if (-not (Test-Path -LiteralPath $node)) { throw 'Node.js runtime is incomplete after extraction (node.exe missing); check antivirus quarantine' }
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
