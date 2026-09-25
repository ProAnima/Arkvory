param([ValidateSet('windows','compose')][string]$Mode = 'windows', [switch]$Elevated)
$ErrorActionPreference = 'Stop'
$powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$ru = [Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName -eq 'ru'
function Say([string]$english, [string]$russian) { if ($ru) { $russian } else { $english } }
try {
    $bundle = [IO.Path]::GetFullPath($PSScriptRoot)
    $admin = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        if ($Elevated) { throw 'Administrator rights were not granted' }
        # Only fixed mode values cross UAC; paths are quoted as PowerShell -File arguments.
        $arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Mode ' + $Mode + ' -Elevated'
        $child = Start-Process $powershell -Verb RunAs -ArgumentList $arguments -Wait -PassThru
        exit $child.ExitCode
    }
    Write-Host (Say 'ProAnima Depot setup' 'Установка ProAnima Depot')
    if ($Mode -eq 'compose') {
        $containerOS = & docker info --format '{{.OSType}}'
        if ($LASTEXITCODE -ne 0 -or $containerOS -ne 'linux') { throw (Say 'Start Docker with Linux containers, then launch setup again.' 'Запустите Docker с Linux-контейнерами и повторите установку.') }
        & docker compose version | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Docker Compose v2 is required' }
    }
    $root = Join-Path $env:ProgramData 'ProAnima/Depot'
    $manifest = Get-Content -LiteralPath (Join-Path $bundle 'depot-release.json') -Raw | ConvertFrom-Json
    if ((Get-FileHash (Join-Path $bundle 'depot-setup.mjs') -Algorithm SHA256).Hash -ne $manifest.setupSha256) { throw 'Installer checksum mismatch' }
    if (Test-Path -LiteralPath (Join-Path $root 'installation.json')) {
        $state = Get-Content -LiteralPath (Join-Path $root 'installation.json') -Raw | ConvertFrom-Json
        if ($state.mode -ne $Mode) { throw 'Existing installation uses another mode; do not mix native and Docker installations.' }
        Write-Host (Say 'Updating the existing installation. Data and configuration are preserved.' 'Обновление установленного Depot. Данные и настройки сохраняются.')
        & (Join-Path $root 'runtime/node-v24.21.0-win-x64/node.exe') (Join-Path $root 'manage.mjs') update --root $root --artifact $bundle
        if ($LASTEXITCODE -ne 0) { throw 'Update failed; inspect the installation journal before recovery.' }
    } else {
        & $powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $bundle 'install.ps1') -Root $root -Mode $Mode -Artifact $bundle
        if ($LASTEXITCODE -ne 0) { throw 'Installation failed. Keep the installation directory and inspect the error above.' }
    }
    Write-Host (Say 'Ready: http://127.0.0.1:8080' 'Готово: http://127.0.0.1:8080') -ForegroundColor Green
    Write-Host (Say "Initial key: $root\config\bootstrap-token.txt (keep private)." "Первичный ключ: $root\config\bootstrap-token.txt (храните в секрете).")
    Write-Host (Say 'Automatic updates are opt-in; see START-HERE.md.' 'Автообновление включается отдельно; см. START-HERE.md.')
    Read-Host (Say 'Press Enter to close' 'Нажмите Enter для закрытия') | Out-Null
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    Read-Host (Say 'Setup did not complete. Press Enter to close' 'Установка не завершена. Нажмите Enter для закрытия') | Out-Null
    exit 1
}
