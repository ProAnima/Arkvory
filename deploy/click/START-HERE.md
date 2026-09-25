# ProAnima Depot

## Русский

Распакуйте **весь** комплект в отдельную папку. Не запускайте файлы внутри окна архива.

- Windows: двойной щелчок **Setup-Windows.cmd**, подтвердите UAC. Для Docker — **Setup-Docker.cmd**.
- Linux desktop: откройте **Setup-Linux.desktop** или **Setup-Docker.desktop**. Если рабочая среда требует, разрешите запуск доверенного файла через его свойства. Введите пароль sudo в терминале.
- Linux без графического интерфейса: `bash setup.sh systemd` или `bash setup.sh compose` из папки комплекта.

Windows — x64; Linux — x64/arm64, glibc, для нативной службы systemd. Linux требует Bash, sudo, curl, Python 3, tar/xz, sha256sum. Для Docker заранее установите и запустите Docker Engine + Compose v2 (на Windows — Linux containers). Установщик не меняет гипервизор и настройки ОС.

Нативная установка запросит URL вашей PostgreSQL; Docker включает свою БД и генерирует пароль. Node.js и WinSW скачиваются с проверкой SHA-256: нужен интернет. Сам Depot находится в комплекте, токен GitHub для первоначальной установки не требуется. Это не полностью автономный offline-установщик.

После успешного завершения откройте http://127.0.0.1:8080. Путь к первичному ключу будет показан без самого секрета. Для удалённого доступа настройте HTTPS. Повторный запуск из нового комплекта обновляет существующую установку с сохранением данных; смена схемы БД требует отдельного обслуживания и backup. При сбое не удаляйте каталог установки.

Автообновление по умолчанию отключено. В приватном репозитории для него отдельно нужен токен чтения GitHub. Порядок настройки: https://github.com/ProAnima/Depot/blob/main/deploy/README.md.

## English

Extract the **entire** bundle into a dedicated directory. Do not run files from inside an archive viewer.

- Windows: double-click **Setup-Windows.cmd**, accept UAC. For Docker use **Setup-Docker.cmd**.
- Linux desktop: open **Setup-Linux.desktop** or **Setup-Docker.desktop**. Your desktop may require marking the downloaded launcher as trusted/executable. Enter your sudo password in the terminal.
- Headless Linux: run `bash setup.sh systemd` or `bash setup.sh compose` from the bundle directory.

Windows x64; Linux x64/arm64 with glibc and systemd for native services. Linux requires Bash, sudo, curl, Python 3, tar/xz and sha256sum. Docker requires a running Docker Engine and Compose v2 (Linux containers on Windows). Setup does not change your hypervisor or operating system settings.

Native setup asks for your PostgreSQL URL; Docker includes its database with a generated password. Node.js and WinSW are downloaded and checked with SHA-256, so internet access is required. Depot is included in the bundle: initial installation needs no GitHub token. This is not a fully offline installer.

After success open http://127.0.0.1:8080. Setup displays the initial key's file location, never its value. Configure HTTPS for remote access. Launching a newer bundle updates the existing installation and preserves data; schema changes require maintenance and backup. Keep the installation directory after any failure.

Automatic updates are disabled by default. A private repository requires a separate GitHub read token for updates. See https://github.com/ProAnima/Depot/blob/main/deploy/README.md.
