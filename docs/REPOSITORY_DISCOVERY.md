# Доступные репозитории и карточки

Веб-интерфейс репозиториев и сервисного доступа: [WEB_ADMINISTRATION](WEB_ADMINISTRATION.md).

Реализовано 2026-09-24. OpenAPI 3.0.3 / документ **0.8.0**, 108 операций с HEAD. Текущая схема БД — **12**; сам discovery не добавляет таблиц. [ADR 0021](adr/0021-repository-discovery.md).

## Что представляет карточка

Репозиторий в текущем Arkvory — логическая область с точным ID, используемая в grants и storage/catalog API. Отдельного глобального реестра с display name, настройками репозитория и lifecycle пока нет. Новый API показывает доступные клиенту области из его актуальных прав, включая ещё пустые. Публикация первого файла не является условием появления карточки; наличие чужих bytes не раскрывает репозиторий.

Карточка: `{id, formats: ["upack","assets"], permissions: [...]}`. Formats описывает поддерживаемые движком виды каталога, а permissions — права **этого клиента**, без чужих policies, владельцев или ключей. Не возвращаются физические пути, URLs backend, учётные данные, объёмы, counts и сведения о других клиентах. Имя/описание репозитория, его создание, удаление и конфигурация не имитируются временными полями.

## Контракт API

| Метод                                   | Результат и параметры                                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| GET `/api/v1/repositories`              | `{items:[card], next:string\|null}`; `limit` 1–100, по умолчанию 50; `after` — исключающая граница по ID |
| GET `/api/v1/repositories/{repository}` | Одна доступная карточка; скрытая/неизвестная область — одинаковый 404                                    |
| HEAD обоих путей                        | Те же проверки и status/headers, без тела                                                                |

Порядок ID — ASCII по возрастанию, с учётом действующего формата `[a-z0-9][a-z0-9_-]{0,63}`. Права фильтруются и одинаковые ID объединяются **до LIMIT**. Дубли bindings дают объединение actions только для того же repository; они не создают декартово произведение ресурсов/прав. Пустой список — 200 с `next:null`. Список не содержит глобального count.

`after` равен последнему ID страницы, если остались записи, и не является токеном доступа. Для продолжения не требуется, чтобы граничная запись всё ещё была доступна. Размер страницы можно менять. Между страницами нет snapshot: новые grants до boundary видны при следующем обходе, отозванные не удерживаются старым cursor. Неизвестные query fields, повторные параметры, невалидные ID/limit — 400. Обе операции Bearer, private/no-store, работают на writer и reader. Capabilities содержит `features.repositoryDiscovery:true`.

## Права и совместимость

Managed key требует **`repository.read`** в пересечении account policy и key bindings для этой области. Это 19-е repository permission: 18 существующих data actions сохраняются. Новое право позволяет открыть только карточку/список. Оно не даёт чтение bytes, packages/assets, публикацию, изменение repository или service administration. Content-only ключ сохраняет чтение известного объекта, даже если репозиторий отсутствует в discovery. Bootstrap/administrator и административное делегирование не предоставляют глобальный просмотр автоматически.

Для file keys и пользовательских сессий возвращаются только собственные непустые coarse grants, уже доступные через `/auth/me`. В карточке `repository.read` обозначает разрешённое discovery этой области. Legacy `/auth/permissions` сохраняет прежние 18 actions и не получает новое имя автоматически, что важно для старого SDK. Empty grants перекрывают старые repositories, как и в существующем authorize; полномочия разных репозиториев не смешиваются.

Сохраняется прежнее различие: file key может иметь только `write` без `read`; пользовательский group access=`write` разрешается текущим identity adapter в read+write. Discovery отражает эти реальные права. Сервер по-прежнему авторизует каждую data operation отдельно. Permissions не заменяют gateway role, состояние upload, ownership и квоты: reader может показать разрешённую публикацию, но сам возвращает 405 на запись.

Каждый новый HTTP-запрос повторно разрешает credentials и актуальные group/account policies. Revoke/disable/expiry — 401 на входе; снятие `repository.read` убирает карточку из списка и даёт 404 на прямом запросе. Начатое чтение может завершиться по уже полученному authorization context; консольное discovery не является барьером для отзыва in-flight stream.

Перед выдачей нового action обновить все API/readers/worker и SDK потребителя до версии с `repository.read`. Старый runtime/SDK отвергает неизвестные permissions; нельзя включать новую policy посреди неподготовленного смешанного deployment. Уже выданные bindings не расширяются и не переписываются. Для rollback сначала удалить новое действие из account/key/delegation policies либо отозвать затронутые credentials по отдельному плану; восстановление старого backup не должно воскресить отозванные ключи.

## SDK и выдача

```typescript
import { ArkvoryClient } from '@proanima/arkvory-sdk';

const client = new ArkvoryClient(arkvoryUrl, () => serviceSecret);
const page = await client.repositories({ limit: 50 }, signal);
for (const card of page.items) {
  showRepository(card.id, card.formats, card.permissions);
}
if (page.next) {
  const following = await client.repositories({ after: page.next, limit: 50 }, signal);
}
const selected = await client.repository('releases', signal);
```

Для managed клиента bootstrap/допущенный делегат добавляет `{resource:{kind:"repository",id:"releases"},actions:["repository.read"]}` в policy аккаунта и выпускает или ротирует ключ с этим action. У делегата новый action должен явно входить в его ceiling; наличие других data actions не заменяет его. Account policy сама по себе не расширяет старый key binding.

SDK проверяет ID, formats, известные/неповторяющиеся permissions, размер/порядок страницы и next. Ответ не более 100 карточек, JSON ограничен прежними 2 MiB. AbortSignal поддерживается; автоматического полного обхода и скрытых retries нет.

## Архитектура и границы

Domain содержит имя `repository.read` и прежние правила пересечения/подмножества. Application `repositories` формирует карточки из Principal; `effective-permissions` хранит явное прежнее соответствие coarse/data actions, вынесенное из HTTP handler. Mapping учитывает grants за линейный проход, без многократного сканирования всех memberships на каждый action.

Источник прав остаётся существующим authentication adapter PostgreSQL/file configuration. Новых таблиц, кеша и фиктивного RepositoryStore нет: карточки не требуют дополнительного I/O. Источник ограничен: до 64 managed bindings, до 10 000 текущих пользовательских grants; legacy key file ограничен 1 MiB. Формирование списка зависит от прав клиента, а не от размера всего blob/catalog storage. Фильтрация/объединение выполняются до пагинации над этим уже ограниченным authorization context. Глобальный SQL inventory не читается.

Contracts задаёт независимые DTO/parser/OpenAPI; API routes разбирают transport; SDK использует только публичный wire contract. UI выбора репозитория в существующей консоли пока сохраняет свой `/auth/me` путь. Persisted registry, настройки, namespace selectors и upload intent остаются отдельными инкрементами.

Проверки: `tests/repositories.test.mjs` и `tests/integration/repositories.test.mjs` — coarse mapping, managed opt-in, same-resource union, 10 000 grants, пагинация, wire validation, HTTP/SDK/HEAD, policy/expiry/revoke/rotation, group grants и reader. Наличие данных не раскрывает чужую область, а discovery-only key не проходит data/admin endpoints.

Локальная проверка 2026-09-24: Windows, Node.js 24.13.0, PostgreSQL 18.4. Прошли `npm run check`, сборка и 67 модульных тестов, полный последовательный прогон 81 PostgreSQL integration test. Репликация двух серверов этим прогоном не проверялась.
