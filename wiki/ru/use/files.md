---
title: Файлы по пути
description: Хранение файла по пути с полной историей, восстановление прежних версий, метки, метаданные, коллекции и вложения.
---

# Файлы по пути

Файл по пути — это имя в репозитории, например `builds/game/1.4/GameSetup.exe`, которое указывает на один сохранённый файл. Когда вы кладёте по тому же пути новое содержимое, путь начинает указывать на новый файл. Старый остаётся, и к нему можно вернуться. Используйте путь, когда людям и скриптам нужен стабильный адрес для «текущего Setup.exe».

## Что такое путь {#what-it-is}

Каждый сохранённый файл — это неизменяемый **артефакт** с ID и SHA-256. Путь — это указатель на артефакт. Каждое изменение указателя — это **версия** пути, нумерация с 1. Версии никогда не удаляются и не редактируются.

Путь содержит от 1 до 1024 символов. Он состоит из сегментов, разделённых `/`. Сегмент не пустой, не равен `.` или `..` и не содержит управляющих символов. В пути не может быть `\` или `:`. Регистр букв имеет значение.

Путь и пакет — два взгляда на одни и те же артефакты: у архива UPack тоже может быть путь. См. [Пакеты UPack](./packages).

## Размещение файла по пути {#put}

Вам нужны действия `upload.create`, `upload.write` и `upload.complete`, а также `asset.read`, `asset.write` и `artifact.read`. На уровне групп это доступ на запись. См. [Права](./accounts#permissions).

### С arkvoryctl {#put-cli}

```bash
arkvoryctl put "./Build/Game Setup.exe" builds/game/1.4/GameSetup.exe
arkvoryctl put ./config.json config/settings.json --label test
arkvoryctl get builds/game/1.4/GameSetup.exe ./GameSetup.exe
```

`put` загружает файл по частям, с контрольной точкой рядом с исходным файлом, и делает его следующей версией пути. Команда выводит `path`, `revision`, `id` артефакта и `created`. Если по этому пути уже лежат те же байты, `put` ничего не загружает и выводит `created` со значением `false`: повторный шаг сборки ничего не стоит. Если кто-то изменил путь, пока вы загружали файл, `put` останавливается с ошибкой `revision_mismatch` (код выхода 6) и не затирает чужую работу. Прочитайте историю и решите, что делать. Если загрузка прервалась, запустите ту же команду снова. См. [Загрузки и скачивания](./transfers#resume).

`get` скачивает текущую версию с возможностью продолжения и проверкой SHA-256. Команд для списка путей и чтения истории нет. Для этого используйте консоль или API.

### Одним HTTP-запросом {#put-http}

Простой `PUT` сохраняет байты по пути одним запросом, как это делает `curl -T`:

```bash
curl -T ./GameSetup.exe -H "Authorization: Bearer $ARKVORY_KEY" \
  "$ARKVORY/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe"
```

В ответе есть `path`, `revision`, `created` и `artifact` с его `id`, `size` и `sha256`. Новая версия отвечает `201`. Те же байты ещё раз отвечают `200` с `created`, равным false. Два заголовка необязательны: `X-Checksum-Sha256` позволяет серверу проверить байты за один проход, а `If-None-Match: *` отклоняет запрос, если путь уже существует. Один запрос должен завершиться в течение 30 минут. Для больших файлов используйте `put`. См. [Обычные файлы](../protocols/raw-files).

### В консоли {#put-console}

1. Загрузите файл в разделе [[ui:upload]]. См. [Загрузки и скачивания](./transfers).
2. Откройте артефакт в разделе [[ui:catalog]] кнопкой [[ui:open]].
3. В блоке [[ui:assetTitle]] введите [[ui:assetPath]], например `releases/current.upack`.
4. Введите [[ui:currentRevision]]: `0` для нового пути или текущую версию, показанную в разделе [[ui:history]].
5. Нажмите [[ui:assign]].

Поле версии защищает от случая, когда двое одновременно меняют путь. Если указана не текущая версия, сервер отклоняет запрос с конфликтом. Загрузите историю заново и повторите.

### С API и SDK {#put-api}

`setAsset` направляет путь на уже загруженный артефакт. Параметр `expectedRevision` (ревизия) равен `0`, чтобы создать путь, и текущей версии пути — во всех остальных случаях.

```bash
curl -X PUT "$ARKVORY/api/v1/repositories/releases/asset" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"path":"builds/game/1.4/GameSetup.exe","artifactId":"3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11","expectedRevision":0}'
```

```typescript
const current = await releases.assets.get('builds/game/1.4/GameSetup.exe');
await releases.assets.assign('builds/game/1.4/GameSetup.exe', artifactId, current.revision);
```

Конфликт отвечает `409 revision_mismatch`. Не повторяйте запрос с угаданной версией. Если ответ потерян, прочитайте путь: если новый артефакт уже на месте, всё готово.

## Чтение пути {#read}

- `arkvoryctl get PATH OUTPUT` скачивает текущий файл.
- `GET /api/v1/repositories/<репозиторий>/raw/<путь>` и `GET /api/v1/repositories/<репозиторий>/asset/content?path=<путь>` возвращают байты. Обоим нужен `content.read`, оба поддерживают диапазоны и ETag.
- `getAsset` (`GET …/asset?path=`) возвращает указатель: `path`, `revision`, `artifactId`.
- `listAssetPage` (`GET …/assets/page?prefix=`) перечисляет указатели. На странице до 100 записей (по умолчанию 50) в порядке байтов пути в UTF-8. Префикс используется буквально и учитывает регистр. Передайте `next` как `after`. Более старый `listAssets` возвращает до 1000 записей и просит сузить префикс.

```typescript
const page = await releases.assets.list({ prefix: 'builds/game/', limit: 100 });
```

## Версии и история {#history}

В консоли откройте раздел [[ui:history]], введите путь в поле [[ui:assetPath]] и нажмите [[ui:historyLoad]]. В таблице есть столбцы [[ui:revision]], [[ui:date]] (время), [[ui:actor]] (автор) и, для восстановленных версий, [[ui:source]] — версия, из которой они получены. Сначала идут новые. Кнопка [[ui:historyMore]] загружает более старые по 50 за раз. Кнопка [[ui:open]] в строке открывает артефакт этой версии, откуда можно скачать его исходное содержимое.

В API `getAssetHistory` (`…/asset/history?path=&before=`) возвращает страницы, сначала новые, а `before` — последняя версия предыдущей страницы. `getAssetRevision` (`…/asset/revision?path=&revision=`) возвращает одну версию. У версий, записанных до того, как история стала фиксировать автора и время, эти поля пусты. Для чтения нужен `asset.read`.

## Восстановление прежней версии {#restore}

Восстановление заставляет путь указывать на артефакт более старой версии. Оно не копирует байты и не удаляет ни одну версию: восстановление — это новая, последняя версия, и в истории видно, откуда она взята.

В консоли загрузите историю и нажмите кнопку восстановления у нужной версии. Кнопка текущей версии отключена. Для восстановления нужны `asset.restore`, `asset.read` и `artifact.read`.

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/asset/restore" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"path":"builds/game/1.4/GameSetup.exe","sourceRevision":3,"expectedRevision":5}'
```

```typescript
await releases.assets.restore('builds/game/1.4/GameSetup.exe', 3, 5);
```

`expectedRevision` — последняя версия, которую вы видели. Если путь за это время изменился, сервер отвечает `409 revision_mismatch`; консоль показывает сообщение и просит перезагрузить историю. Восстановление не возвращает старые метки и метаданные: они остаются такими, какие есть сейчас.

## Метки, метаданные и коллекции {#labels}

У каждого артефакта есть три вида заметок. Их можно менять в любой момент. Сам файл не меняется никогда.

| Вид        | Пример                                         | Правила                                                                                                                   |
| ---------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Метки      | `test`, `staging`, `release`, `linux`          | До 32. Каждая — от 1 до 64 букв, цифр, `_`, `.`, `:` или `-`. Регистр имеет значение                                      |
| Метаданные | `build.number` = `42`, `git.commit` = `abc123` | До 32 текстовых полей. Ключ начинается с буквы и содержит до 64 букв, цифр, `_`, `.` или `-`. Значение — до 1024 символов |
| Коллекции  | `desktop`, `nightly`                           | До 32. Правила те же, что у меток. Они группируют артефакты независимо от версии или пути                                 |

Метки — свободный текст. Они не дают доступа и не перемещают файлов. Консоль предлагает [[ui:labelPresets]] (`nightly`, `test`, `staging`, `release`), но допустима любая метка, а `relase` не исправляется. Для одобрения, на которое опираются развёртывания, используйте стадию ([Стадии и продвижение](./promotion)).

**Консоль.** Откройте артефакт в разделе [[ui:metadata]]. Введите [[ui:labels]] и [[ui:collections]] через запятую. Чтобы добавить поле в блок [[ui:metadataFields]], нажмите [[ui:metadataAdd]] и заполните [[ui:metadataKey]] и [[ui:metadataValue]]. В поле [[ui:metadataJson]] те же данные редактируются как JSON. Нажмите [[ui:save]].

**arkvoryctl.** При загрузке `--label test` добавляет одну метку, а `--file metadata.json` задаёт `labels` и `metadata`:

```json
{ "labels": ["test"], "metadata": { "build.number": "42", "git.commit": "abc123" } }
```

Чтобы изменить существующий артефакт, прочитайте его, затем отправьте полное новое состояние с версией, которую вы прочитали:

```bash
arkvoryctl annotations get 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl annotations set 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --revision 3 --file annotations.json
```

В `annotations.json` должны быть все три ключа: `labels`, `metadata` и `collections`. Всё, что вы пропустите, станет пустым. Сохранение заменяет весь набор. Если кто-то сохранил раньше вас, сервер отвечает `409 revision_mismatch`: прочитайте заново и решите, что делать. SDK не повторяет такие сохранения.

```typescript
const current = await releases.annotations.get(id);
await releases.annotations.update(id, current.revision, {
  labels: [...current.labels, 'release'],
  metadata: current.metadata,
  collections: current.collections,
});
```

Для чтения нужен `annotation.read`, для записи — `annotation.write` вместе с `artifact.read`.

**Поиск.** В разделе [[ui:catalog]] введите текст в строке поиска и нажмите [[ui:search]]: текст сопоставляется с именем файла и значениями метаданных без учёта регистра. Поле [[ui:labelFilter]] показывает артефакты с одной меткой. Поле [[ui:metadataFilter]] сопоставляет ключ и значение точно, включая регистр. С `arkvoryctl`:

```bash
arkvoryctl search --query game --label release
arkvoryctl search --collection nightly
arkvoryctl search --metadata-key git.commit --metadata-value abc123
```

`--metadata-key` и `--metadata-value` указываются вместе. На странице до 100 результатов. Передайте `next` как `--after`. Фильтры объединяются условием AND.

## Вложения {#attachments}

Вложения привязывают к сборке другие файлы: манифест, SBOM, подпись, отчёт или любой файл. Вложение — это имя и ссылка на другой артефакт того же репозитория. Сборка и вложение остаются отдельными файлами.

| Правило        | Значение                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Виды           | `manifest`, `sbom`, `signature`, `report`, `file`                                                                              |
| На одну сборку | Не больше 32                                                                                                                   |
| Имя            | От 1 до 240 символов, уникально в пределах сборки (без учёта регистра), без `/`, `\`, управляющих символов и пробелов по краям |
| Описание       | До 512 символов, может быть пустым                                                                                             |
| Цель           | Опубликованный артефакт того же репозитория. Не сама сборка                                                                    |

Вид лишь говорит, для чего нужен файл. Arkvory не проверяет подпись, не читает SBOM и не запускает манифест.

В консоли откройте артефакт. В блоке [[ui:attachmentsTitle]] разверните форму [[ui:attachmentAdd]]. Выберите [[ui:attachmentSource]]: вариант [[ui:attachmentUpload]] отправляет новый файл и привязывает его, вариант [[ui:attachmentExisting]] привязывает уже опубликованный артефакт. Выберите [[ui:attachmentKind]]: [[ui:attachmentManifest]], [[ui:attachmentSbom]], [[ui:attachmentSignature]], [[ui:attachmentReport]] или [[ui:attachmentFile]]. Укажите [[ui:attachmentName]] и, если хотите, [[ui:attachmentDescription]]. Затем нажмите [[ui:attachmentAdd]]. Кнопка [[ui:attachmentUnlink]] убирает привязку и оставляет файл. Кнопка [[ui:attachmentReload]] перечитывает список. Если загрузка вложения прервалась, блок [[ui:attachmentRecovery]] показывает ID загрузки, с которым её можно продолжить.

Каждое изменение списка — это пронумерованная версия. Кнопка [[ui:attachmentHistory]] показывает прежние версии, а [[ui:attachmentRestore]] возвращает одну из них как новую версию.

В `arkvoryctl` файл содержит весь список в виде массива JSON:

```json
[
  {
    "name": "build.json",
    "kind": "manifest",
    "artifactId": "64b42380-902d-41cf-9151-10c12e4809dc",
    "description": "Build provenance from CI"
  }
]
```

```bash
arkvoryctl attachments get 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl attachments set 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --revision 0 --file attachments.json
arkvoryctl attachments history 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`--revision` — это номер, который вы прочитали командой `get`; у новой сборки он равен `0`. В API `replaceBuildAttachments` принимает `expectedRevision` и `items`; читают `getBuildAttachments` и `getBuildAttachmentHistory`. Чтобы скачать вложение, возьмите `artifactId` его привязки и скачайте обычным способом. Для чтения нужен `annotation.read`, для изменения — `annotation.write` вместе с `artifact.read`, а для загрузки файла вложения — действия загрузки.

Вложения и пути не переносятся при продвижении в другой репозиторий. См. [Стадии и продвижение](./promotion).

## Связанные страницы {#related-pages}

- [Обычные файлы](../protocols/raw-files)
- [Загрузки и скачивания](./transfers) и [Пакеты UPack](./packages)
- [Командная строка (arkvoryctl)](../protocols/cli)
- Справочник API: [Файлы по пути](../api/reference/files), [Артефакты и каталог](../api/reference/artifacts), [Вложения сборок](../api/reference/attachments)
