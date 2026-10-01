# Продвижение артефактов и разрешение версий

Решение: [ADR 0047](adr/0047-artifact-promotion.md). Схема БД 22.

Сборка идёт от CI к production двумя совместимыми способами.

- **Стадии** — управляемые метки артефакта (`qa`, `staging`, `release`, `prod`). Их может быть несколько, до 16. Меняются только через promotion API, каждое изменение попадает в журнал.
- **Репозитории-этапы** — артефакт переходит между репозиториями (`dev` → `staging` → `prod`) без повторной передачи байтов, в режиме `copy` или `move`.

Свободные метки (`labels`) остаются тегами и не заменяют стадии: их меняет любой с правом `annotation.write`, истории у них нет.

## Права

| Действие                                      | Managed-ключ                                                            | File key, пользователь или группа  |
| --------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------- |
| Список стадий, история артефакта              | `artifact.read`                                                         | `read`                             |
| Журнал репозитория, артефакты со стадией      | `artifact.list`                                                         | `read`                             |
| Добавить или снять стадию                     | `artifact.promote` + `artifact.read`                                    | `read` + `write`                   |
| Promote `copy`                                | в источнике `artifact.read` + `content.read`, в цели `artifact.promote` | `read` в источнике, `write` в цели |
| Promote `move`                                | дополнительно `artifact.promote` в источнике                            | `write` в обоих                    |
| `packages/resolve`                            | `package.read`                                                          | `read`                             |
| `packages/content` (скачать выбранную версию) | `content.read`                                                          | `read`                             |

Ключу агента развёртывания достаточно `content.read`: он скачивает «последнюю версию в `release`», не получая доступа к каталогу.

## Стадии

```sh
curl -X PUT -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"comment":"smoke passed"}' \
  "$ARKVORY/api/v1/repositories/dev/artifacts/$ID/stages/qa"
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  "$ARKVORY/api/v1/repositories/dev/artifacts/$ID/stages/qa"
```

- Имя стадии: `^[a-z0-9][a-z0-9_.-]{0,31}$`.
- Повторное добавление не меняет время и комментарий. Снятие отсутствующей стадии возвращает 204.
- Артефакт со стадией защищён от retention: блокер `promotion_stage`.
- `GET R/artifacts/{id}/stages` — текущие стадии.
- `GET R/stages?stage=release` — все артефакты со стадией, страницы по 100.
- `GET R/artifacts/{id}/promotions` и `GET R/promotions?after=N` — журнал в порядке возрастания `sequence`. CI/CD опрашивает его с сохранённым курсором.

## Перенос между репозиториями

```sh
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"target":"prod","mode":"copy","stages":["release"],"comment":"CAB-142"}' \
  "$ARKVORY/api/v1/repositories/staging/artifacts/$ID/promote"
```

Что происходит при переносе:

- Байты не передаются заново: локальное хранилище создаёт жёсткую ссылку на неизменяемый blob.
- Копия получает метки, metadata, коллекции и идентичность UPack источника, а также указанные стадии.
- Ответ `201` возвращает новую копию. Повтор отвечает `200` с той же копией.
- Если в цели уже есть та же версия пакета с тем же SHA-256, возвращается существующий артефакт; с другим SHA-256 — `409`.
- `move` логически удаляет источник в той же транзакции, что и публикация копии. Стадии источника переходят в копию. Если у источника есть блокеры удаления (внешние ссылки, история файлов, вложения), весь перенос отклоняется с `409` и ничего не публикуется.
- Квота и `ARKVORY_CAPACITY_BYTES` учитывают копию как обычную загрузку. Физически байты общие до удаления последней ссылки.
- Прерванный перенос оставляет pending-резерв с обычным сроком жизни. Повтор тем же пользователем продолжает его, иначе резерв удаляет очистка.
- Вложения (`attachments`) и привязки путей файлов не переносятся.

## Разрешение версии

`GET R/packages/resolve` возвращает версию, artifact ID, SHA-256, размер и стадии. `GET|HEAD R/packages/content` сразу отдаёт байты выбранной версии и заголовки `X-Arkvory-Artifact-Id` и `X-Arkvory-Package-Version`.

| Параметр     | Значение                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `name`       | обязательное имя пакета; `group` — группа, по умолчанию корневая                                                               |
| `version`    | точная версия (без учёта регистра)                                                                                             |
| `range`      | SemVer-диапазон: `1.2.3`, `^1.2`, `~1.2.3`, `1.x`, `>=1.0.0 <2.0.0`, `1.0.0 - 1.4.0`, `^1 \|\| ^3`                             |
| `stage`      | только версии с этой стадией                                                                                                   |
| `prerelease` | `true` включает prerelease-версии; без него они выбираются только при точной версии или диапазоне с тем же `major.minor.patch` |
| `order`      | `version` (по умолчанию) — старшая подходящая SemVer; `promoted` — последняя продвинутая, требует `stage`                      |

`order=promoted` делает откат обычной операцией: снимите стадию с неудачной версии или продвиньте прежнюю ещё раз. Повторное добавление существующей стадии время не обновляет, поэтому для отката стадию сначала снимают.

URL по имени разрешается на каждом запросе. Для продолжения скачивания передавайте `If-Range` с полученным ETag или скачивайте по `artifactId` из `resolve`.

```sh
curl -fL -H "Authorization: Bearer $DEPLOY_TOKEN" -o app.upack \
  "$ARKVORY/api/v1/repositories/prod/packages/content?name=app&range=%5E1.4&stage=release"
```

## CLI

```sh
arkvoryctl promote $ID --repository staging --to prod --stage release --comment CAB-142
arkvoryctl promote $ID --repository staging --to prod --move
arkvoryctl stages add $ID qa --repository dev --comment "smoke passed"
arkvoryctl stages artifacts --repository prod --stage release
arkvoryctl packages resolve app --repository prod --range ^1.4 --stage release --json
arkvoryctl packages download app ./app.upack --repository prod --stage release --order promoted
arkvoryctl promotions journal --repository prod --after 120 --json
```

`packages download` сначала разрешает версию, затем скачивает её по artifact ID с проверкой SHA-256 и продолжением после обрыва.

## Консоль

Карточка артефакта показывает размер, время загрузки и SHA-256, стадии с кнопками снятия, форму добавления стадии, форму продвижения (только в репозитории, где у пользователя есть `artifact.promote`) и историю. Перенос требует подтверждения. В списке пакетов колонка «Стадии» заполняется одним запросом `GET R/stages?ids=…` на страницу.

## SDK

```ts
const prod = client.inRepository('prod');
await client
  .inRepository('staging')
  .promotions.promote(id, { target: 'prod', stages: ['release'] });
const current = await prod.packages.resolve({ name: 'app', range: '^1.4', stage: 'release' });
await prod.stages.add(current.artifactId, 'canary');
const { items, next } = await prod.promotions.journal({ after: cursor });
```
