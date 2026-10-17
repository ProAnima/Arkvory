# signing

Проверка подписей и подписанных пакетов модулей ([ADR 0078](../../docs/adr/0078-open-core-modules-and-licenses.md), этап O1; уровни доверия — [ADR 0082](../../docs/adr/0082-custom-plugins.md)). Пакет Node.js (`node:crypto`, `node:fs`, `node:zlib`), без сторонних библиотек; из пакетов репозитория использует только `extension-api` — тот же разбор манифеста, что у встроенных модулей.

- **minisign** (Ed25519, BLAKE2b-512 prehash и устаревший `Ed`): `verifyMinisign`, `signMinisign` (только инструменты и тесты), разбор `.pub`, отпечаток ключа. Подпись релизов `apps/deploy` проверяется этой же функцией; ключи релизов остаются в `apps/deploy/src/release-keys.ts`.
- **Классы ключей**: `release`, `module`, `license`, `operator`. `keyRing` запрещает один id и один открытый ключ в двух местах (id ключа minisign не подписан); `verifyClassified` требует класс, алгоритм `ED` (устаревший `Ed` — только у релизов) и назначение `file:<имя>` в доверенном комментарии. Встроенные `moduleKeys` и `licenseKeys` пусты, пока владелец не создаст ключи (`node scripts/module-signing.mjs keygen module|license`); до этого любой пакет модуля отклоняется (`unknown_key`).
- **Список доверия оператора** `config/plugin-trust.json` (ADR 0082, п. 3): `parsePluginTrust`, шаблоны `op-…`, срок ключа.
- **Список отзыва** `module-revocations.json`: конверт `{format, payload, signature}`, подпись ключом модулей, `acceptRevocations` не принимает меньший номер.
- **Пакет модуля** `.tgz`: потоковое чтение ustar с пределами до чтения данных, отказ от ссылок, устройств, расширенных заголовков, путей вне пакета, дублей и имён, совпадающих без учёта регистра, нативных дополнений; порядок проверки — подпись → манифест → файлы → совместимость. `inspectModulePackage` ничего не пишет, `extractModulePackage` распаковывает с повторной сверкой, `verifyInstalledModule` повторяет проверку установленного каталога перед использованием.

Коды отказов — `SIGNING_PROBLEMS`; сообщение называет код и проверенный id или путь, но не исходный текст.
