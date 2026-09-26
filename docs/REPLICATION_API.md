# API управления репликацией — проект

Статус: **planned**. Ни один маршрут ниже пока не зарегистрирован и не включается в текущую OpenAPI как работающий. [Протокол](REPLICATION.md) определяет инварианты, [UX](REPLICATION_UX.md) — пользовательские сценарии. UI и внешние приложения используют один и тот же API через SDK; endpoint в браузере не получает привилегий installer/SSH.

## Ответственность и доступ

| Область                   | Потребитель                       | Граница                                                                                |
| ------------------------- | --------------------------------- | -------------------------------------------------------------------------------------- |
| `/api/v1/replication/*`   | Web, CLI, CI/CD, удалённые панели | Типизированные команды, статусы, preview, аудит; никогда shell/произвольный путь       |
| Внутренний node protocol  | Replication worker и gateway      | Отдельный listener, mTLS, cluster/node/generation binding; не включён в публичный CORS |
| Локальный installer agent | Установка/repair/trust            | OS-службы, каталоги, секреты, сертификаты; не запускается service key общего API       |
| HA provider control       | Локальный доверенный agent        | Проверенный fencing и promote; отсутствует в mirror v1                                 |

В первом выпуске управление топологией доступно только глобальному administrator. Обычный repository key не получает список хостов, адреса, диски или replication credentials. Repository projection может показать только число подтверждённых копий конкретного доступного artifact, без topology leak. Проект granular permissions: `replication.read`, `replication.manage`, `replication.trust.manage`, отдельно `cluster.cutover`. Они добавляются в contracts/domain/OpenAPI/SDK/UI одновременно с реализацией, без выдачи «по наследству» через content.write.

Node identity не является пользовательским сервисным ключом. Даже технический node с read-data scope не меняет users/grants/retention/settings. Replication admin управляет переносом данных и потому является привилегированной ролью: разрешение добавлять target подразумевает доверие к получателю этих данных. Делегирование ограничивается явным ceiling и перечнем репозиториев; до отдельного внедрения делегированного профиля его нет.

## Публичные маршруты

| Метод и путь                                          | Назначение                                                            | Результат                                                         |
| ----------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| GET/HEAD `/api/v1/replication/capabilities`           | Реализованные профили, версии, лимиты, поддержка delivery/cutover     | 200; capability false не становится доступной кнопкой             |
| GET/HEAD `/api/v1/replication/nodes`                  | Страница узлов, роли и свежесть                                       | 200, cursor, limit 1–100; disabled/retired явно различаются       |
| GET/HEAD `/api/v1/replication/nodes/{nodeId}`         | Состояние, policyRevision, counters, blocker codes                    | 200; без секретов и физических путей                              |
| POST `/api/v1/replication/enrollments`                | Создать bound одноразовое приглашение                                 | 201; secret только в первом ответе, Idempotency-Key обязателен    |
| GET/HEAD `/api/v1/replication/enrollments/{id}`       | Результат обмена и fingerprints                                       | 200; потерянный secret не возвращается при replay                 |
| POST `/api/v1/replication/enrollments/{id}/revoke`    | Отозвать незавершённое приглашение                                    | 202 + operation; не удаляет присоединённый volume                 |
| PATCH `/api/v1/replication/nodes/{nodeId}/policy`     | Область данных, расписание, бюджеты, thresholds                       | CAS `expectedRevision`, 200; расширение scope требует нового seed |
| POST `/api/v1/replication/nodes/{nodeId}/previews`    | План connect/reseed/retire/purge/cutover                              | 200 с previewId, expiry, revision, последствиями и blockers       |
| POST `/api/v1/replication/nodes/{nodeId}/commands`    | start/pause/resume/retry/verify/drain/retire; purge отдельно разрешён | 202, operationId; Idempotency-Key и expectedRevision              |
| GET/HEAD `/api/v1/replication/operations/{id}`        | Исполнение команды и последствия                                      | 200, status, phase, progress, errors, observedAt                  |
| POST `/api/v1/replication/operations/{id}/cancel`     | Отмена там, где ещё возможна                                          | 202; запрещена в необратимой commit/cutover фазе                  |
| GET/HEAD `/api/v1/replication/nodes/{nodeId}/objects` | Пагинация failed/pending/verified/quarantined                         | Без полного inventory в JSON; ограниченный фильтр                 |
| GET/HEAD `/api/v1/replication/events`                 | Операционный аудит и диагностика                                      | Cursor; scoped filters до LIMIT; redacted errors                  |

Название `commands` не означает произвольный RPC: закрытый discriminated union проверяется runtime-схемой, неизвестный action отклоняется. В mirror v1 нет action promote. Capability cutover появится только вместе с provider-specific plan/execute и испытанными safety conditions. Недоступная функция не отвечает успешным placeholder.

## Wire-модель

Обязательные идентификаторы: `clusterId`, `sourceInstanceId`, `nodeId`, `volumeId`, `generation`, `policyRevision`. `generation`, counters, offsets, bytes и journal cursors кодируются десятичными строками с ограниченной длиной; ID/размер не приводятся к JS Number без проверки. Время — UTC ISO 8601; интервалы и лимиты — с явными единицами. Null означает «неизвестно», а не ноль. Сервер не вычисляет фактическую потерю данных из одного времени heartbeat.

Состояния разделены:

- `lifecycle`: enrolling, active, draining, retired.
- `syncState`: seeding, catching_up, caught_up, paused, reseed_required, quarantined.
- `connectivity`: online, offline, unknown; отдельно freshness/observedAt.
- `delivery`: available, restricted, unavailable с machine-readable reasons.
- `writeDurability`: local, two_copies, blocked, unknown; в mirror-профиле неизменно local.
- Операция: queued, running, retrying, cancelling, cancelled, succeeded, failed, interrupted. Interrupted требует reconcile до повтора опасного шага.

`caught_up` относится к зафиксированному cursor H и времени наблюдения, а не к вечной синхронности. `confirmedCopies` конкретного объекта учитывает только подходящий receipt и доступный volume; display counts не являются основанием для GC/cutover.

Пример planned command:

```json
{
  "action": "pause",
  "expectedRevision": "12",
  "reason": "maintenance"
}
```

На один node конфликтующие операции сериализуются. Идемпотентность привязана к caller/node/action/body hash; тот же ключ с другим телом даёт conflict. После потери ответа UI получает прежний operationId. Persisted operation содержит progress, версии предусловий и receipt внешнего результата; перезагрузка страницы не теряет принятую команду.

Destructive commands используют одноразовый previewId, привязанный к actor/node/generation/revision и полному плану. Сервер повторно проверяет условия непосредственно перед шагом. Просроченный или изменившийся preview → 409 + новый preview; клиент не может снять blocker через `force: true`.

## Внутренний протокол

Внутренние операции: handshake/capabilities, acquire bounded tasks, protected object metadata, Range content, acknowledge receipt, progress heartbeat, tombstone/drain receipt, authorize/renew read grant. Отдельная спецификация версионируется вместе с workers; этот документ не закрепляет будущие URL как публичную совместимость.

Каждый запрос содержит node/generation и correlation ID. Передача target → primary не приносит произвольный SQL cursor или путь к файлу: подтверждается конкретное ранее выданное задание. ACK проверяет expected artifact/hash/size/volume/task generation и повторяется безопасно. Поздний ACK retired generation получает conflict; duplicate ACK текущей возвращает исходный receipt. Heartbeat не является durable ACK.

Пределы по умолчанию для первого измеряемого профиля: 100 задач на страницу, 256 KiB metadata body, 8 MiB data chunk, 2 активных файла на node, не более одной параллельной операции enrollment/reseed/retire на node. TTL token/lease не удаляет задания и pins. Ошибки retryable имеют Retry-After; повторы bounded с jitter. После исчерпания попыток — failed с явным retry/reconcile, без бесконечного tight loop.

## Ошибки и наблюдение

Используются действующие HTTP envelope и requestId: 401/403, 404 без утечки чужого scope, 409 для CAS/generation/preview, 422 для checksum, 503 для временной недоступности, 507 для ёмкости. Протокольные причины переводятся в стабильные typed `blockers`, а не разбираются UI из английского сообщения.

Примеры blockers: authority_unavailable, target_unreachable, insufficient_space, source_pins_limit, checksum_mismatch, certificate_expired, incompatible_protocol, reseed_required, fencing_unconfigured, fencing_unconfirmed, candidate_behind, operation_unresolved. Обязательные предупреждения остаются видимыми; подробности и requestId раскрываются по запросу.

Начальный UI polling — один запрос состояния выбранного node раз в 5 секунд; вкладка в фоне приостанавливает polling, повтор с backoff до 60 секунд. Нет опроса всех 4 ТБ объектов. Ответы имеют observedAt/revision; network error не заменяет предыдущее состояние успешным нулём. SSE не добавляется до появления отдельного устойчивого event/reconnect протокола.

## Приёмка API

Контрактный guard охватывает новые GET/HEAD и mutations, schemas/SDK совпадают, secrets отсутствуют в get/list/errors/audit. Проверяются IDOR, репозиторные границы, отзыв ключей, lost response, duplicate command/ACK, ABA поколения, CAS во время preview, неизвестный peer protocol, SSRF/DNS/redirect, stale grant и bounded payload. Запуск через общие quick/integration/browser/security gates; новые suites обязательны в verify/release.
