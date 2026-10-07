# Управляемые сервисные ключи: запуск и эксплуатация

Веб-интерфейс репозиториев и сервисного доступа: [WEB_ADMINISTRATION](WEB_ADMINISTRATION.md).

Первый профиль реализован 2026-09-24 в миграции 9; на эту дату схема была **12**, сейчас — **34**. Machine identities, 24 permissions на точные репозитории, lifecycle, SDK и API/worker/reader enforcement дополнены [делегированным управлением](SERVICE_DELEGATION.md): семь admin actions, точные цели и ceiling. Selectors папок/групп, federation, transfer tickets и управление webhooks через API не включены (вебхуки задаёт оператор файлом, [ADR 0069](adr/0069-webhooks-over-change-feed.md)). Решения: [ADR 0017](adr/0017-managed-service-keys.md), [ADR 0019](adr/0019-scoped-service-administration.md).

## Обновление и bootstrap

Остановить writer, readers и worker, сделать согласованный backup БД и storage, обновить сборку, выполнить `npm run migrate`, затем запустить процессы одной версии. Readiness требует markers 8, 9, 10 и 11: package indexes, service accounts/keys, delegation и asset index соответственно. Смешанный runtime не поддерживается: старый activation не проверяет issuer. Ограничения отката: [обновление delegation](SERVICE_DELEGATION.md#транзакции-лимиты-и-обновление).

Для управления сервисными аккаунтами включить **`serviceAdministrator: true` у отдельного доверенного ключа в `ARKVORY_KEYS_FILE`** и согласованно перезапустить процессы. У существующих ключей этот флаг по умолчанию false; `administrator: true` продолжает управлять пользователями/группами и не даёт новых полномочий. `npm run init:local` для новой установки создаёт bootstrap key с обоими флагами. Не перезапускайте init поверх существующих секретов. Bootstrap не предназначен для CI или приложений-потребителей; в доверенной веб-консоли он используется для начальной настройки. Для повседневного управления выдавайте отдельный делегированный ключ оператора.

Bootstrap может назначать любые реализованные repo permissions, создавать аккаунты и выдавать grants конкретным managed keys. Делегат управляет только назначенными чужими аккаунтами и в пределах actions/ceiling. Пользовательские сессии и обычный administrator новых полномочий не получают; HTTP API изменения bootstrap флага нет. Подробные правила и отсутствие каскадного отзыва активных ключей: [SERVICE_DELEGATION](SERVICE_DELEGATION.md).

Старые file keys сохраняют read/write и ownership. **Автоматического импорта их hash/owner в managed account нет**: новый service account получает новый `service:<uuid>`. Уже начатые старым принципалом uploads надо закончить старым ключом или создать заново. Ротация внутри одного managed account сохраняет owner. Префикс `arkvory_` зарезервирован для managed credentials; он никогда не попадает в file fallback, в том числе после revoke. Если старый вручную выбранный secret использовал такой префикс, замените его до обновления.

## Контракт управления

Все методы ниже используют Bearer и `Cache-Control: private, no-store`. Названия аккаунтов/ключей: 3–64 ASCII символа из букв, цифр, `_`, `.`, `-`. Идентификаторы UUID, policy — `bindings`, revision — целое. Неизвестные поля запросов и permissions отклоняются.

| Метод       | Путь относительно `/api/v1`            | Результат                                                                           |
| ----------- | -------------------------------------- | ----------------------------------------------------------------------------------- |
| GET / POST  | `/service-accounts`                    | Cursor-page / 201 account с name и bindings                                         |
| GET / PATCH | `/service-accounts/{id}`               | Account / CAS `{expectedRevision,enabled}`                                          |
| GET / PUT   | `/service-accounts/{id}/policy`        | Account с policy / CAS `{expectedRevision,bindings}`                                |
| GET / POST  | `/service-accounts/{id}/keys`          | Cursor-page metadata / выдача pending key                                           |
| GET         | `/api-keys/{id}`                       | Metadata без hash/secret                                                            |
| POST        | `/api-keys/{id}/rotate`                | Новый pending key того же аккаунта, только прежние права или их подмножество        |
| POST        | `/api-keys/{id}/revoke`                | 204, повтор идемпотентен, отзыв необратим                                           |
| GET         | `/service-accounts/{id}/audit?after=…` | До 100 событий, следующий after — sequence последнего полученного события           |
| POST        | `/auth/activate-key`                   | 204; этот единственный маршрут принимает pending credential самого клиента          |
| GET         | `/auth/permissions`                    | Собственный effective набор bindings, profile, credentialId и serviceAdministration |
| GET         | `/capabilities`                        | Реальные features, gatewayRole, лимиты протокола; не разрешение на операцию         |

Создание аккаунтов требует bootstrap; остальные административные маршруты допускают bootstrap либо соответствующее действие делегата на точную цель. Активация требует secret выдаваемого ключа. Permissions/capabilities доступны любой действующей identity. Lists используют 50 записей и `next`; `after` — UUID, отсутствие next означает завершение обхода. Список не является snapshot. CAS конфликт — 409, без потери чужих изменений. `PATCH` пока меняет только enabled, не имя.

Выдача и ротация принимают `Idempotency-Key` и `{name,bindings,expiresAt?}`. Первый ответ — `201 {key,secret}`. Повтор того же запроса — `200 {key}` **без secret**, другое тело — 409. При утрате секрета отозвать key по ID и повторить выдачу с новым Idempotency-Key. Идемпотентность ограничена account + issuing principal + ключ запроса; ротация также входит в fingerprint. Никакой raw secret не сохраняется ради повторной выдачи.

Токен: `arkvory_<uuid>.<32 случайных байта base64url>`, в БД только SHA-256 полного credential. `pending` действует для активации 15 минут. `expiresAt` — UTC: по умолчанию 90 дней от времени БД, максимум 365 дней; `notBefore` и отложенная активация пока не поддерживаются. Metadata state хранит pending/active/revoked; истечение определяется по timestamp на каждом запросе, без обязательного cleanup worker.

Активация повторяется безопасно, но не продлевает срок. Активация rotated key сокращает оставшийся срок старого до не более 24 часов; явный revoke после проверки нового ключа предпочтителен. Если новый ответ утрачен и pending key не активирован, старый срок не меняется. Не выключайте старый key до завершения инициированных им jobs или их явной переавторизации. Disable аккаунта блокирует все его ключи; enable возвращает доступ ещё не истёкшим и не отозванным ключам.

## Пример SDK

```typescript
import { ArkvoryClient } from '@proanima/arkvory-sdk';

// Секреты передаются из вашего secret store, не из исходного кода.
const operator = new ArkvoryClient(arkvoryUrl, () => bootstrapSecret);
const bindings = [
  {
    resource: { kind: 'repository', id: 'releases' },
    actions: [
      'upload.create',
      'upload.read',
      'upload.write',
      'upload.complete',
      'upload.cancel',
      'job.read',
      'artifact.read',
      'package.publish',
    ],
  },
] as const;
const account = await operator.createServiceAccount('ci-prod', bindings);
const issued = await operator.issueServiceKey(account.id, issuanceRequestId, {
  name: 'pipeline-2026',
  bindings,
});
if (!issued.secret) {
  // Ответ выдачи уже был получен/утрачен. Не пытаться использовать metadata как secret.
  throw new Error('Recover issuance by revoking this key and issuing a new one');
}
await secretStore.save(issued.secret);
const client = new ArkvoryClient(arkvoryUrl, () => issued.secret ?? '');
await client.activateServiceKey();
const permissions = await client.permissions();
```

SDK также предоставляет serviceAccounts/serviceAccount/servicePolicy/updateServiceAccount/setServicePolicy/serviceKeys/serviceKey/rotateServiceKey/revokeServiceKey/serviceAudit/capabilities. Новые control calls принимают AbortSignal и не делают скрытых mutation retries. Идемпотентный replay выдачи не восстанавливает secret. TypeScript SDK использует portable fetch; другие языки могут использовать ту же OpenAPI 3.0.3.

## Права и защита публикации

Реализованные actions: `repository.read`, `artifact.read`, `artifact.list`, `content.read`, `upload.create`, `upload.read`, `upload.write`, `upload.complete`, `upload.cancel`, `job.read`, `package.read`, `package.publish`, `asset.read`, `asset.write`, `asset.restore`, `annotation.read`, `annotation.write`, `reference.write`, `audit.read`, а также `artifact.delete`, `artifact.promote`, `storage.read`, `storage.manage`, `diagnostics.read` — всего 24. Их привязка к методам — в [карте API](API_MAP.md). Права `artifact.delete`, `storage.read`, `storage.manage` и `diagnostics.read` не имеют legacy-эквивалента: они никогда не выдаются парольным сессиям, персональным токенам, файловым ключам и ключу восстановления, только управляемым сервисным ключам (`artifact.promote` прежним принципалам даёт сочетание read и write). Остальные имена из целевой модели, включая system.observe, отклоняются. Семь administration actions, включая credential.manage, принимаются только отдельным delegation API, не в repository bindings. Wildcards и path selectors не поддерживаются.

Эффективные права = пересечение account policy и key bindings по одной паре action/repository. Пустая policy запрещает data operations. Ключ не получает общий read/write; resolve для `packages/content` и `asset/content` требует content.read, а не право перечислять пакеты или файлы. Whole-file PUT требует upload.write **и** upload.complete; запись части — только upload.write. Метаданные и pointer mutations требуют указанных в карте дополнительных прав на источник. Ownership uploads/jobs/references остаётся отдельной проверкой.

Каждый новый managed request читает authoritative PostgreSQL. Положительного auth cache и fallback к локальному hash для dpk нет. Reader видит изменения/revoke на следующем запросе без перезапуска; при недоступности authority новый запрос не проходит. Уже начатый download не обрывается исключительно из-за revoke.

Перед фиксацией parts/publication, annotations, UPack registration, asset pointer/restore, references и enqueue короткая SQL-транзакция берёт shared row locks account/key и проверяет их актуальные permissions/expiry. Revoke, disable и policy update конфликтуют с этими locks: либо публикация зафиксирована раньше отзыва, либо stale mutation отклоняется. Lock не удерживается во время сетевой передачи/сборки blob. При отказе bytes могут остаться в staging/blob, но available запись не появляется; восстановление/GC используют прежний lifecycle.

Completion job хранит initiating key ID, worker заново разрешает именно его, сверяет owner и повторно проверяет publication authority. Отзыв ключа останавливает queued publication, даже если у аккаунта есть другой активный ключ. Новый ключ того же аккаунта может явно вызвать complete-async для того же upload: queued/failed job переавторизуется с сохранением ID; running job даёт 503/busy до завершения/истечения lease. Completed job не публикуется повторно. Parts сохраняют stable owner при rotation.

## Лимиты и аудит

- До 1000 service accounts, 3 неистёкших active + 2 неистёкших pending ключей на аккаунт; проверки сериализованы в БД.
- До 10 000 записей ключей суммарно, включая revoked/expired metadata и idempotency receipts. Автоматическое архивирование/удаление пока не реализовано; достижение cap закрывает выдачу новых ключей (507), но не revoke существующих. Нужен отдельный поддерживаемый archival инкремент перед исчерпанием.
- До 64 bindings, каждое с известными actions; control body ≤64 KiB. Accounts/keys pages до 50, JSON SDK до 2 MiB. Собственные permissions и package pages допускают до 8 MiB.
- Один бюджет и admission owner на service account, независимо от числа ключей. Governor хранит не более 3000 principals: до 1000 file owners, 1000 users и 1000 service accounts.
- Service audit атомарен с изменением; хранит actor/action/accountId/keyId/occurredAt, не secret/hash. Сохраняются последние **100 000 событий глобально**, более старые удаляются при mutations. Это ограниченная операционная история, не бессрочный compliance archive или гарантированный event replay; долговременный экспорт пока внешний.

Существующий пользовательский auth сохраняет прежние права; readiness проверяет текущую схему. `/auth/me` возвращает для managed identity ID без coarse grants; подробные permissions находятся в новом endpoint. Сервисными аккаунтами можно управлять через API/SDK и [веб-консоль](WEB_ADMINISTRATION.md). Полную tenant isolation и HA эта реализация не объявляет.

## Проверки

`tests/service-access.test.mjs`: пересечение bindings без смешивания repo/action, запрет fallback на read/write, явный bootstrap, совпадение domain/wire action catalogs.

`tests/integration/service-access.test.mjs`: one-time issuance и replay, pending/expiry, concurrency caps, Publisher vs Downloader через artifact/package/asset content, Range и HEAD, чужие uploads, policy CAS/disable, rotation/resume, revoke между записью bytes и commit, stale annotation, реальный worker с переавторизацией, независимый reader, paging и отсутствие file fallback. Отдельно сохранены прежние интеграционные проверки и миграция исторических данных. Стенд двух реплицируемых серверов остаётся отложенным.

Локальный прогон 2026-09-24: `node --env-file=.cache/test-db.env tests/large-transfer.mjs --multipart --verified --traffic --managed` прошёл на Windows, Node 24.13.0, PostgreSQL и Local filesystem. Передано 5 368 709 120 bytes с managed key, kill/restart посреди upload, restart после публикации, прерыванием download и проверенной Range-докачкой. Итоговый SHA-256: `b23228f170c6e7ab93aeee2c5711299da5d561470be1c6842ef063f17bfed415`. Upload 169 078 ms, download 128 448 ms; peak RSS server 151 990 272 bytes (~145 MiB), client 168 595 456 bytes (~161 MiB). Лимиты gateway 64 MiB/s, principal 48 MiB/s, одна одновременная передача. Это результат конкретного локального теста, не SLA или подтверждение репликации/HA.

Repository discovery добавляет явный `repository.read`: [контракт и порядок обновления runtime/SDK](REPOSITORY_DISCOVERY.md). Старые bindings не расширяются; перед назначением нового имени необходимо обновить его parser у всех потребителей. Схема БД остаётся 11.
