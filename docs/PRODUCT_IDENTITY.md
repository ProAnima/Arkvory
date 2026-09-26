# Идентичность Arkvory / Arkvory identity

Arkvory — самостоятельное хранилище ProAnimaStudio. Автор, правообладатель и держатель бренда — Ian Panaev лично. Лицензия проприетарная.

| Поверхность     | Имя                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| Репозиторий     | `ProAnima/Arkvory`                                                                                          |
| Клиент / SDK    | `arkvoryctl`, `@proanima/arkvory-sdk`, `ArkvoryClient`                                                      |
| Установка       | `arkvory`, `arkvory-setup.mjs`                                                                              |
| Конфигурация    | `ARKVORY_*`                                                                                                 |
| SQL             | таблицы, индексы, роли и тестовые схемы `arkvory_*`                                                         |
| Сервисные ключи | `arkvory_<uuid>.<secret>`                                                                                   |
| CLI             | `.config/arkvory/profiles.json`, `.arkvory-upload.json`, `.arkvory-download.json`, `.arkvory-part`          |
| Браузер         | `arkvory.ui.*`, OPFS `arkvory-download-staging-v1`, Web Locks `arkvory-download:*`                          |
| Windows         | службы `Arkvoryapi`, `Arkvoryworker`, `Arkvorydatabase`; данные `C:\ProgramData\ProAnima\Arkvory`           |
| Linux           | `arkvory-api`, `arkvory-worker`, `arkvory-database`, `arkvory-update.timer`; данные `/opt/proanima-arkvory` |
| Compose         | проект `proanima-arkvory`, volumes `proanima-arkvory_storage`, `proanima-arkvory_catalog`                   |
| Релизы          | `arkvory-release.json`, `arkvory-runtime.zip`, `Arkvory-Setup-x64.exe`, DEB/RPM и клиентские пакеты Arkvory |

Продукт ещё не используется в установках. Все компоненты используют единую идентичность Arkvory с чистой установкой: aliases окружения, поиск альтернативных профилей/checkpoints и автоматический перенос прежних данных отсутствуют. PostgreSQL-миграции создают схему Arkvory; тестовые окружения создаются заново. Сборочные кэши и история Git не являются частью поставляемого продукта.

Контракты `/api/v1`, Universal Feed и Assets, безопасность, проверка целостности и возобновление передач сохраняются. Совместимость с ProGet — отдельная продуктовая функция и не зависит от названия.

Фирменные материалы описаны в [branding](../branding/README.md), архитектурное решение — в [ADR 0040](adr/0040-arkvory-identity.md).

## English

Arkvory is a standalone ProAnimaStudio storage product. Ian Panaev personally owns the copyright and brand. The proprietary license applies.

The product is not deployed yet. All runtime settings, SQL objects, credentials, CLI profiles, browser storage, services and release assets use the Arkvory identity listed above. Fresh installations use this namespace directly; no alternate-name aliases, fallback files or conversion layer are provided. Build caches and Git history are outside the distributed product.

Native HTTP APIs, ProGet-compatible endpoints, integrity checks and resumable transfers remain supported. See the brand assets and architecture decision linked above.
