# sdk

Публичный HTTP-клиент хранилища.

Рабочий portable fetch SDK с runtime validation, multipart/resume и потоковым download. HTTPS кроме loopback. См. [runbook](../../docs/LIFECYCLE_AND_CATALOG.md).

`create` и `resume` восстанавливают временные сетевые сбои с ограниченными повторами. `downloadVerified` возвращает поток с проверкой диапазонов и полного SHA-256, умеет продолжить с сохранённого Blob prefix. Политика попыток, AbortSignal, требования к commit клиента и примеры: [TRANSFER_RECOVERY](../../docs/TRANSFER_RECOVERY.md). Низкоуровневый `download` сохраняет прежний контракт Response; каталоговые CAS не повторяются автоматически.

Разрешённые зависимости и правила: [ARCHITECTURE.md](../../docs/ARCHITECTURE.md). Общие инструкции: [AGENTS.md](../../AGENTS.md).

Публичный вход — src/index.ts. Импорт внутренних файлов другого workspace запрещён. Реальные зависимости объявляются в package.json при появлении импорта.
SDK поддерживает вход/выход и смену собственного пароля пользователя, управление учётными записями и группами через Bearer, а также курсорные страницы UPack с сортировкой и группировкой. [Контракт](../../docs/API_CONTRACTS.md).

`me()` валидирует и возвращает эффективные права текущего токена по репозиториям. Их можно показывать в UI, но каждую операцию сервер авторизует заново.

Для браузерного приложения на другом origin используйте `DepotClient` с HTTPS адресом Depot, передавайте Bearer через функцию токена и настройте `DEPOT_CORS_ORIGINS` на сервере. [Пример и требования к хранению токена](../../docs/EXTERNAL_UI.md).

Страницы пакетов допускают JSON до 8 MiB для 100 манифестов до 64 KiB с метаданными страницы; остальные JSON-ответы сохраняют предел 2 MiB. `packages(repository, { group: "" })` выбирает только корневую группу; отсутствие group означает все группы. Пустой фильтр в консоли по-прежнему означает все группы.

DepotClient предоставляет capabilities/permissions, service accounts/policy, выдачу/активацию/ротацию/отзыв ключей и service audit. Ответ выдачи содержит secret только при первом успешном запросе; replay возвращает metadata. Control calls принимают AbortSignal без скрытого повтора mutations. [Контракт и эксплуатация](../../docs/SERVICE_KEYS.md).

serviceDelegations/setServiceDelegation/removeServiceDelegation и servicePolicy реализуют [делегированное управление](../../docs/SERVICE_DELEGATION.md). permissions возвращает credentialId, discovery — delegatedServiceAdministration. CAS/tombstone и one-time secret не допускают скрытого mutation retry.

`assetPage(repository, {prefix, after, limit}, signal?)` возвращает ограниченные items/next. Клиент сам обрабатывает страницу и сохраняет checkpoint; SDK не накапливает весь каталог и не делает скрытых повторов. [Пример](../../docs/ASSET_PAGINATION.md).

`repositories({after,limit}, signal?)` и `repository(id, signal?)` возвращают валидированные карточки id/formats/permissions. Обновить SDK до выдачи managed permission repository.read: старые parsers неизвестное имя отклоняют. [Контракт](../../docs/REPOSITORY_DISCOVERY.md).

DownloadQueue и checkpointedDownload дают bounded очередь скачиваний с паузой, продолжением, отменой и приватным DownloadStorage. [API и требования к адаптеру](../../docs/DOWNLOAD_QUEUE.md).
SDK имеет совместимые namespaces: `client.identity`, `client.administration.{users,groups,services,credentials}` и `client.inRepository(id).{artifacts,annotations,uploads,packages,assets}`. `client.operations(query, signal)` читает строгую bounded страницу применимых операций; это advisory-данные, не разрешение на произвольный объект. Прежний `client.repository(id)` по-прежнему возвращает карточку; flat API не изменён. [Примеры и матрица методов](../../docs/API_SURFACES.md).

`client.inRepository(id).attachments.{get,replace,history}` и flat `attachments/replaceAttachments/attachmentHistory` принимают AbortSignal. CAS не повторяется автоматически, bytes используют прежние transfers. [Пример CI](../../docs/BUILD_DETAILS.md).

client.inRepository(id).artifacts.inspectDeletion/delete и retention.preview/apply принимают AbortSignal и проверяют ответы runtime-парсерами. Flat методы: inspectDeletion, deleteArtifact, previewRetention, applyRetention. Mutations не повторяются скрыто; UI должен проверять outcome каждой строки. [Контракт и ограничения](../../docs/ARTIFACT_RETENTION.md).

`client.inRepository(id).storage.{policy,configure,usage,preview,run,events}` поддерживает AbortSignal и runtime-проверку ответов. `configure(expectedRevision, policy)` заменяет настройки; `run(expectedRevision)` выполняет одну порцию. Flat методы: storagePolicy, setStoragePolicy, storageUsage, previewStoragePolicy, runStoragePolicy, storageEvents. [Пример и безопасность](../../docs/STORAGE_POLICIES.md).
