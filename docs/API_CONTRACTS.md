# Контракты API

Документ задаёт целевые правила API. Реализованные native сценарии и ограничения: [CORE_RUNBOOK](CORE_RUNBOOK.md), [LIFECYCLE_AND_CATALOG](LIFECYCLE_AND_CATALOG.md). OpenAPI доступна по `/api/v1/openapi.json`; схемы и проверка ответов SDK находятся в contracts. Распределённые transfers, schemas, events/webhooks и administration остаются запланированными.

## Собственный API

Версия `/api/v1`; области: repositories, packages/versions, assets/revisions, schemas/labels/collections, uploads, transfers, references, events/webhooks/audit, administration.

- Runtime-схемы — источник wire-контрактов; OpenAPI и SDK согласуются с ними проверками.
- Пагинация курсором, стабильные ID, UTC, фильтры с лимитами сложности.
- Машинный код ошибки + request ID; без stack trace, секретов и физических путей в публичном ответе.
- Идемпотентность изменяющих операций с областью ключа и обнаружением конфликтов тела.
- Optimistic concurrency для редактируемых metadata и asset pointers.
- `unknown` до валидации; проверка ответа интеграции также обязательна.
- Полные 64-битные значения в JSON кодируются десятичными строками по явно описанной схеме; не передавать bigint напрямую в JSON.stringify.

## Байтовые передачи

GET/HEAD, Content-Length, сильный ETag, Range/If-Range, 206/416, сохранение исходных байтов. Токен закреплён за blob и допуском. Redirect к другому hostname допустим только при подтверждённой совместимости клиента и доступности сети.

Нативная очередь: создать задачу → получить состояние/URL polling или SSE → получить допуск → передать байты. Готовность задания и успешная публикация — разные состояния. Пауза download означает закрытие запроса и последующее продолжение клиентом, а не перенос TCP-соединения.

Multipart-сессия сохраняет состояние вне памяти процесса; принятая часть повторяется безопасно. Завершение проверяет полное покрытие, размер и хеш. SDK принимает AbortSignal, ограничивает повторы и не повторяет небезопасную запись без ключа идемпотентности.

## ProGet

Поверхности: `/api/packages/{feed}/...`, `/upack/{feed}/...`, `/endpoints/{directory}/...` и необходимые методы управления. Точную матрицу строим по реальным версиям Hub, CI/CD и остальных клиентов.

Сохраняем формы JSON, коды/заголовки, группы, регистр, latest/prerelease, авторизацию, правила overwrite и multipart Assets. Не заменяем существующий синхронный download на `202 + job`.

При перегрузке возможны ограниченное ожидание и Retry-After, но поддержку повторов проверяем для каждого клиента. Клиент без retry требует запаса ресурсов/выделенной полосы либо изменения клиента.

## Внешние приложения

Клиенты на любом поддерживаемом языке используют HTTP/OpenAPI. Для TypeScript предоставляется версионированный SDK. Прямой доступ к БД, внутренним файловым путям и shared runtime internals запрещён. Внешние ссылки на версии защищают используемые компоненты от очистки.

Webhooks подписываются, могут дублироваться и повторяются через outbox. Event ID обеспечивает дедупликацию; API позволяет восстановить состояние при пропущенных событиях.

## Эталонные источники

- [ProGet Packages API](https://docs.inedo.com/docs/proget/api/packages)
- [Universal Feed API](https://docs.inedo.com/docs/proget/api/universal-feed)
- [Asset Directories API](https://docs.inedo.com/docs/proget/api/assets)
- [Multipart Assets](https://docs.inedo.com/docs/proget/api/assets/files/upload/multipart)
- [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html)
