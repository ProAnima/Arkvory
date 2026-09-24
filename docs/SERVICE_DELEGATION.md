# Делегированное управление сервисными аккаунтами

Реализованный профиль, 2026-09-24: делегирование добавлено миграцией **10**; текущая схема **11**, OpenAPI 3.0.3 / документ **0.6.0**. Дополняет [жизненный цикл ключей](SERVICE_KEYS.md); решение — [ADR 0019](adr/0019-scoped-service-administration.md). Это управление заранее созданными сервисными аккаунтами, без рекурсивного делегирования, wildcard selectors и управления пользователями/группами.

## Полномочия оператора

Bootstrap с локальным `serviceAdministrator: true` создаёт операторский аккаунт, выпускает его ключ и после активации назначает делегирование. Каждая запись связывает **конкретный key ID** с **конкретным target account ID**, набором административных действий и `ceiling` — пределом допустимых repository bindings.

| Действие                 | Разрешённая операция над назначенным аккаунтом |
| ------------------------ | ---------------------------------------------- |
| `service-account.read`   | Карточка и включение в cursor-list аккаунтов   |
| `service-account.manage` | CAS изменения enabled                          |
| `policy.read`            | Получение policy через отдельный endpoint      |
| `policy.manage`          | CAS замены policy                              |
| `credential.read`        | Список и metadata ключей                       |
| `credential.manage`      | Выдача, ротация и отзыв ключей                 |
| `service-audit.read`     | Чтение ограниченной истории service audit      |

Эти семь действий не входят в 18 data permissions и не принимаются в repository bindings. Manage не подразумевает read: можно разрешить выпуск ключей без перечисления ключей/аккаунтов. Карточка и список аккаунтов уже содержат policy; `policy.read` позволяет получить её отдельным маршрутом, но не скрывает её от обладателя `service-account.read`. Metadata ключей также включает их bindings, без secret/hash.

Оператору не требуется собственный доступ к bytes в пределах ceiling: bootstrap явно поручает ему администрирование. Это не даёт операторскому ключу data permissions. Однако право выпуска позволяет оператору получить новый секрет целевого аккаунта в пределах ceiling; назначайте его как полноценное доверие к этим данным. Управление своим аккаунтом запрещено. Только bootstrap создаёт аккаунты и назначает/меняет/снимает делегирование.

Операторский ключ должен быть active, неистёкшим, принадлежать enabled аккаунту и быть выпущен bootstrap. Ключ, выпущенный делегатом, нельзя сделать операторским. Аккаунт не может одновременно быть целью включённого делегирования и держателем включённых делегирований через любой свой ключ. Это исключает цепочки и взаимное управление. Отозванный ключ с сохранёнными grants продолжает занимать эту роль: bootstrap должен явно снять записи перед изменением назначения аккаунта.

## Пределы изменений

- Новые bindings ключа должны входить одновременно в policy целевого аккаунта и ceiling. Пары action/repository проверяются вместе; права разных ресурсов не перемножаются.
- Для замены policy и enable/disable **вся текущая policy** должна входить в ceiling. Новая policy также должна входить в него. Нельзя косвенно изменить доступ вне своих полномочий даже сужающим запросом.
- Для revoke/rotate все сохранённые bindings исходного ключа должны входить в ceiling, независимо от текущего пересечения с account policy. Ротация дополнительно не расширяет исходные bindings.
- Срок выдаваемого ключа не превышает срок операторского credential. По умолчанию — минимум из 90 дней и оставшегося срока оператора; общий максимум 365 дней сохраняется.
- При активации pending key повторно проверяются issuer credential, его enabled account, актуальный grant, ceiling и policy получателя. При ротации повторно проверяются исходные bindings; срок нового ключа ограничивается текущим сроком issuer.
- Ротация оператора **не копирует** административные grants на новый ключ. Bootstrap отдельно назначает нужные цели, затем снимает старые grants и отзывает старый credential после завершения работ.

Отзыв/disable/expiry оператора или удаление grant блокирует будущие управляющие операции и активацию выданных им pending keys. **Уже активированные сервисные ключи остаются самостоятельными**: каскадного отзыва нет. Для прекращения их доступа bootstrap явно отзывает ключи или отключает целевой аккаунт. Уже начатая передача bytes сохраняет прежнюю семантику; отзыв не прерывает её автоматически.

## HTTP и обнаружение прав

Все пути ниже относительно `/api/v1`, Bearer, JSON до 64 KiB, `Cache-Control: private, no-store`. Reader допускает чтение, управляющие mutations возвращают 405/read_only. Существующие account/key endpoints теперь допускают bootstrap либо соответствующее делегированное действие; их формы ответов сохранены.

| Метод и путь                                    | Доступ и контракт                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| GET `/api-keys/{id}/delegations`                | Bootstrap либо сам владелец этого credential; `{items: [...]}`, включая выключенные записи, максимум 64 |
| PUT `/api-keys/{id}/delegations/{accountId}`    | Только bootstrap; `{expectedRevision,actions,ceiling}`; 200 grant                                       |
| DELETE `/api-keys/{id}/delegations/{accountId}` | Только bootstrap; JSON `{expectedRevision}`; 200 выключенная запись                                     |

Grant: `{keyId,targetAccountId,revision,enabled,actions,ceiling}`. Создание — `expectedRevision: 0`, изменение — текущая revision. DELETE оставляет tombstone: `enabled:false`, пустые actions/ceiling, revision увеличена. Для повторного включения PUT использует revision этой записи, а не 0. Потерянный ответ проверяется GET; слепой повтор старой revision возвращает 409. Удаление не является HTTP 204 или физическим удалением строки.

`capabilities.features.delegatedServiceAdministration` сообщает о наличии механизма. `/auth/permissions` дополнен `credentialId` (UUID managed key, иначе null). Поле `serviceAdministration` по-прежнему означает **локальный bootstrap**, поэтому false не исключает делегированных прав. Managed client получает credentialId, затем читает собственные delegations и учитывает enabled/actions/ceiling. Сервер проверяет всё заново при каждом действии; discovery не является разрешением на запись.

Accounts list фильтрует доступ по `service-account.read` в SQL **до LIMIT**, возвращая до 50 записей и next. При отсутствии этого права список пуст. Каждая страница проверяет актуальные права; весь обход не является snapshot. Доступ вне назначенной цели скрыт 404, отсутствие конкретного действия внутри назначенной цели — 403. Чужой список delegations — 403. Неверный/отозванный credential на HTTP-входе — 401; потеря полномочий уже аутентифицированной операции — 403 либо 404 для снятого grant. Не повторять эти ошибки автоматически.

## Пример SDK

```typescript
import { DepotClient } from '@proanima/depot-sdk';

// Секреты и issuanceRequestId приходят из secret store / durable workflow клиента.
const root = new DepotClient(depotUrl, () => bootstrapSecret);
const ceiling = [
  { resource: { kind: 'repository', id: 'releases' }, actions: ['content.read'] },
] as const;
const target = await root.createServiceAccount('release-consumer', ceiling);
const operatorAccount = await root.createServiceAccount('release-operator', []);
const issued = await root.issueServiceKey(operatorAccount.id, issuanceRequestId, {
  name: 'operator-2026',
  bindings: [],
});
if (!issued.secret) throw new Error('Recover issuance; metadata is not a secret');
const operator = new DepotClient(depotUrl, () => issued.secret ?? '');
await secretStore.save(issued.secret);
await operator.activateServiceKey();
const grant = await root.setServiceDelegation(
  issued.key.id,
  target.id,
  0,
  ['service-account.read', 'credential.read', 'credential.manage'],
  ceiling,
);
const targets = await operator.serviceAccounts();
const ownGrants = await operator.serviceDelegations(issued.key.id);
// Выпуск в target.id использует обычный issueServiceKey и отдельный Idempotency-Key.
// Отозвать управление; уже активированные ключи target остаются действующими.
await root.removeServiceDelegation(issued.key.id, target.id, grant.revision);
```

Также доступны `servicePolicy`, `setServicePolicy`, `updateServiceAccount`, `rotateServiceKey`, `revokeServiceKey`, `serviceAudit`. Управляющие вызовы принимают AbortSignal и не имеют скрытого mutation retry. Идемпотентная выдача повторно возвращает только metadata, после проверки текущего grant/ceiling.

## Транзакции, лимиты и обновление

Control mutations используют существующую короткую транзакционную advisory-блокировку 18471/12. Credential и grant проверяются **после** её получения. Изменение и audit атомарны: отказ записи audit откатывает grant/credential/policy. Конкурентный отзыв упорядочен с управляющей записью; устаревший Principal не сохраняет права. Потоки файлов этой блокировки не удерживают.

Чтения используют одну read-only repeatable-read транзакцию для проверки и получения данных, без общей control-блокировки. Начатое до отзыва чтение может завершиться по своему snapshot. Это не распределённый auth cache. Частые управляющие записи пока сериализуются; необходимость дальнейшего разделения locks определяется нагрузочными измерениями, не числом API-процессов.

Предел: 64 хранимых grant на key, 10 000 глобально, до 16 ceiling bindings и 7 действий на запись. Выключенные записи учитываются в cap для сохранения revision. Новый grant сверх cap — 507; существующую запись можно менять/снимать/включать. Автоматического архивирования нет. Service audit сохраняет прежний cap 100 000 событий; новые события `delegation.set`/`delegation.remove` содержат actor, target account и operator key ID, без secret/hash и полного grant body.

Обновление: остановить writer/readers/worker, сделать согласованный backup БД и storage, обновить сборку, выполнить `npm run migrate`, запустить одинаковую версию процессов. Миграция 10 добавляет таблицу grants и `issued_via_key_id`; прежние ключи имеют null issuer. Текущая readiness требует markers **8, 9, 10, 11**; миграция 11 добавляет [индекс файловых страниц](ASSET_PAGINATION.md). Схема additive, но смешанный runtime не поддерживается: старый код не проверяет issuer при pending activation. Откат к старой версии после включения делегирования требует отдельного плана: остановить все процессы, отозвать все выданные делегатами pending keys и административные grants, проверить активные credentials и сохранить уже сделанные отзывы. Простой restore старого backup может воскресить отозванные ключи и не является безопасным auth rollback.

Проверки: `tests/integration/delegation.test.mjs` — SDK/HTTP lifecycle, schema ответов, точные цели и actions, ceiling/expiry, запрет цепочек, tombstone/CAS, гонки caps, filtering до LIMIT, stale authority после ожидания lock, rollback при отказе audit, повторная проверка pending activation и отсутствие каскадного отзыва active keys. Стенд ProGet/двухсерверного HA остаётся отдельной отложенной приёмкой. UI администрирования, импорт legacy ownership, рекурсивные роли и namespace selectors здесь не реализованы.

Локальная приёмка 2026-09-24: `npm run check`, `npm test` (61 тест), полный последовательный PostgreSQL/HTTP прогон (69 тестов) прошли. Среда: Windows, Node 24.13.0, PostgreSQL 18.4. Новый прогон 5 GiB не выполнялся: путь bytes не изменён; прежний результат managed upload/resume зафиксирован в SERVICE_KEYS. Это проверка control API и регрессий, не промышленная HA-приёмка.
