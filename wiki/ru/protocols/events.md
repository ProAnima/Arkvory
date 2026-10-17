---
title: 'События'
description: 'Следите за всеми изменениями установки по одному курсору: CloudEvents, права, срок хранения и пересинхронизация.'
---

# События

Лента событий сообщает внешней системе, что изменилось во всей установке: публикации, удаления, пути файлов, регистрации пакетов, аннотации, вложения, стадии, продвижения, образы контейнеров, npm и Git LFS. Это один упорядоченный поток по всем репозиториям, которые вам доступны для чтения, в формате [CloudEvents 1.0](https://cloudevents.io). Читайте её командой `arkvoryctl events tail`, через [TypeScript SDK](./sdk) или `GET /api/v1/events`.

Событие — подсказка, что что-то изменилось. Текущее состояние читайте обычным API, а события обрабатывайте так, чтобы повтор ничего не ломал.

## Чтение ленты {#read}

```bash
arkvoryctl events tail --cursor-file ./arkvory.cursor
```

Команда выводит по событию в строке в формате JSON и после каждого события сохраняет позицию в `--cursor-file`. Запустите её снова — она продолжит с того места, где остановилась. С `--follow` она ждёт новых событий до Ctrl+C. `--types artifact.*,stage.added` оставляет названные типы или префиксы, `--repository releases` — один репозиторий, `--after <id>` начинает после указанного события.

В TypeScript `follow` читает страницу за страницей и вызывает `save` после каждого обработанного события:

```ts
for await (const event of client.events.follow({ after: saved, save: (cursor) => store(cursor) })) {
  await handle(event);
}
```

По HTTP:

```bash
curl -H "Authorization: Bearer $ARKVORY_TOKEN" \
  "https://arkvory.example.com/api/v1/events?limit=100&types=artifact.*"
```

Ответ содержит `items`, `next`, `head`, `oldest` и `epoch`. Передайте `next` как `after` в следующем запросе. Без `after` лента начинается с самого старого события, которое хранит сервер. Запрос возвращает до `limit` событий (1–500, по умолчанию 100). См. [listEvents](../api/reference/events#listEvents).

## Событие {#event}

```json
{
  "specversion": "1.0",
  "id": "0f7d8e3c-1d2b-4a5c-9e8f-0a1b2c3d4e5f:42",
  "source": "/arkvory/studio/repositories/releases",
  "type": "arkvory.artifact.published.v1",
  "subject": "9a7b6c5d-4e3f-4a1b-8c2d-1e0f9a8b7c6d",
  "time": "2026-10-17T09:30:00.000Z",
  "datacontenttype": "application/json",
  "dataschema": "urn:arkvory:event:artifact.published:1",
  "partitionkey": "repository:releases",
  "arkvoryposition": "42",
  "arkvoryepoch": "0f7d8e3c-1d2b-4a5c-9e8f-0a1b2c3d4e5f",
  "data": {
    "repository": "releases",
    "artifactId": "9a7b6c5d-4e3f-4a1b-8c2d-1e0f9a8b7c6d",
    "name": "game.upack",
    "size": "73400320",
    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "labels": ["ci"],
    "stages": []
  }
}
```

- `id` одинаков при каждом повторе события: дедуплицируйте по нему.
- `data` содержит идентификаторы и факты артефакта: имя, размер десятичной строкой, SHA-256, метки и стадии на момент события и пакет UPack. События файлов, стадий, образов, npm и Git LFS добавляют путь, стадию, образ с digest или тегом, пакет npm или id объекта.
- Значений метаданных, автора изменения, секретов и содержимого файлов в событии нет никогда. Если из-за меток `data` стало бы больше 8 КиБ, метки опускаются, а `truncated` равно `true`.
- `GET /api/v1/events/types` перечисляет все типы с JSON Schema их `data`.

| Группа         | Типы                                                                                |
| -------------- | ----------------------------------------------------------------------------------- |
| Артефакты      | `artifact.published`, `artifact.deleted`, `artifact.promoted`, `artifact.received`  |
| Файлы и пакеты | `asset.revision.created`, `asset.restored`, `package.registered`                    |
| Описания       | `annotation.updated`, `attachments.updated`, `stage.added`, `stage.removed`         |
| Образы         | `oci.manifest.pushed`, `oci.manifest.deleted`, `oci.tag.updated`, `oci.tag.deleted` |
| npm и Git LFS  | `npm.version.published`, `npm.tag.updated`, `npm.tag.deleted`, `lfs.object.stored`  |

## Порядок и права {#order}

- События одного репозитория идут в порядке фиксации изменений (`partitionkey`). Между репозиториями позиции показывают порядок, в котором события стали видны, а не причину и следствие.
- Позиции растут, но могут пропускать номера. Не рассчитывайте, что они идут подряд.
- Событие появляется в ленте примерно через полсекунды после изменения, когда worker присвоит ему номер. Пока worker остановлен, события ждут и не теряются.
- Вы видите события репозиториев, где у вашего ключа или учётной записи есть `artifact.list`, — то же право, что для [ленты изменений](../api/reference/artifacts#listCatalogChanges). Права проверяются при каждом запросе, поэтому отозванное право сразу скрывает события.
- `next` продвигается и за события, которые вам не видны, — не больше 5000 за запрос, — поэтому узкий ключ не стоит на месте. Он лишь сообщает, что на этих позициях у сервера были другие события.

## Срок хранения и восстановление {#retention}

Сервер хранит события 168 часов и не больше 5 000 000 штук (`ARKVORY_EVENTS_RETENTION_HOURS`, `ARKVORY_EVENTS_MAX_ROWS`, см. [Переменные окружения](../reference/environment)). Лента — окно, а не история: историю хранит журнал каталога. В резервные копии события не входят.

| Ответ                                  | Что произошло                                                                | Что делать                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `410`, `gone/events_cursor_expired`    | Ваш курсор старше `oldest`                                                   | Прочитайте текущее состояние через API и продолжите с `oldest`                 |
| `409`, `conflict/events_epoch_changed` | Сервер восстановлен из резервной копии, и позиции начали новую эпоху `epoch` | Прочитайте текущее состояние и продолжите без курсора или с новой головы ленты |

Оба ответа несут `events` с текущими `epoch`, `oldest` и `head`; курсор — `<epoch>:<position>`. `arkvoryctl events tail` завершается с кодом 6, а SDK выбрасывает ошибку с теми же полями.

## Вебхуки {#webhooks}

[Вебхуки](./webhooks) по-прежнему отправляют ленту изменений одного репозитория на HTTP-адрес. Лента событий их не заменяет.
