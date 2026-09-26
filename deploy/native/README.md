# Нативные пакеты Arkvory

Сборка запускается через `npm run gate -- native-package`; нужны готовые build-зависимости проекта. Windows скачивает проверенный компилятор Inno Setup 6.7.3 (или использует `ARKVORY_ISCC`), Linux требует dpkg-deb/rpmbuild. Зависимости скачиваются только при сборке, SHA-256 закреплены в `scripts/native-dependencies.mjs`. Для выпуска используется runtime из `ARKVORY_RELEASE_ARTIFACT`, а не произвольная пересборка.

Выход: `test-results/native-candidate` либо `ARKVORY_NATIVE_ARTIFACT`:

- `Arkvory-Setup-x64.exe` — Windows, офлайн-комплект, RU/EN, создание владельца и браузерный onboarding.
- `Arkvory-amd64.deb` — пакет Debian/Ubuntu с Node.js внутри; PostgreSQL устанавливает менеджер пакетов.
- `Arkvory-x86_64.rpm` — пакет RPM с аналогичными зависимостями. Поддержка конкретного RPM-дистрибутива требует его установки на стенде.
- `native-win32.json` / `native-linux.json` — version/commit и SHA-256 нативных артефактов.

На Windows достаточно открыть EXE, подтвердить UAC и задать имя/пароль. После установки браузер откроет знакомство с Arkvory. На Linux откройте DEB/RPM в менеджере приложений либо выполните `sudo apt install ./Arkvory-amd64.deb` / `sudo dnf install ./Arkvory-x86_64.rpm`. Затем откройте Arkvory из меню приложений. На headless сервере подключите защищённый доступ к консоли. Recovery key: `/opt/proanima-arkvory/config/bootstrap-token.txt`, читать только администратору.

Для автоматизации Windows: `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /OWNERFILE="C:\secure\owner.json"`. JSON содержит `name` и `password`; файл заранее защищают ACL для SYSTEM/Administrators. Пароль не передают в командной строке. Без OWNERFILE тихая установка оставляет создание владельца через защищённый recovery key. Не запускайте инсталлятор одновременно с обновлением.

CLI Linux: `arkvory help`. Windows: `& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' help` из PowerShell. Для операций указывайте `--root` с папкой mutable state. Общие справочные команды показываются также в консоли, раздел «API и CLI».

Сбой: сначала проверяйте журнал Inno Setup и `database/arkvory-database*.log` (Windows) / `journalctl -u arkvory-database` (Linux). Файл `database/bootstrap-started` без `initialized` означает прерванное создание роли/БД: не удаляйте кластер и не повторяйте SQL вслепую. После проверки состояния завершайте установку командой `finish-install`. Внешняя БД поддерживается операторскими install.sh/install.ps1; нативный GUI использует управляемую базу.

Удаление сохраняет данные намеренно. Резервное копирование должно включать PostgreSQL и blobs, а не только директорию Program Files или пакет. Смена PostgreSQL major — отдельная миграция с резервной копией. Автообновления Arkvory не обновляют системные зависимости и runtime Node.

[Границы, безопасность и приёмка](../../docs/adr/0033-native-installers-and-guided-setup.md). До предоставления signing credentials артефакты не подписаны издателем Arkvory; это не готовый доверенный публичный релиз.
