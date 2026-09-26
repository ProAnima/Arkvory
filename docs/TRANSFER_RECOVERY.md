# Возобновление сетевых передач

Для конечных клиентов доступен [arkvoryctl](CLI.md): самостоятельная установка, сохранение upload idempotency/checkpoints, продолжение download и проверка SHA-256. Приведённые ниже SDK-примеры и прежний `npm run upload` остаются доступны для интеграций.

Реализованный профиль: standalone API + portable TypeScript SDK. Дополнительно работают [read gateways с фиксированными общими квотами](READ_GATEWAYS.md); два физических сервера и replication/fencing остаются отдельным этапом. Решение: [ADR 0007](adr/0007-client-transfer-recovery.md).

## Ограниченные повторы

```ts
const client = new ArkvoryClient(baseUrl, () => token, {
  maxAttempts: 5, // включая первую попытку одного запроса, диапазон 1..10
  maxRetries: 20, // общий бюджет повторов create/resume/downloadVerified, 0..100
  attemptTimeoutMs: 120_000, // запрос + чтение ответа, 1..1_800_000
  baseDelayMs: 500, // 1..60_000
  maxDelayMs: 60_000, // baseDelayMs..60_000, включает Retry-After
});
```

Показаны значения по умолчанию. Backoff растёт экспоненциально с jitter; Retry-After поддерживает секунды и HTTP-date. Повторяются транспортные сбои и HTTP 408/429/502/503/504. Ошибки прав, конфликты, повреждение содержимого/контракта и прочие HTTP-ошибки завершают операцию. Если Retry-After превышает maxDelayMs, клиент отдаёт ошибку вместо нарушения срока сервера. Внешний AbortSignal завершает запрос или ожидание; отмена не расходует новые попытки.

Общий бюджет не сбрасывается на каждом диапазоне. После исчерпания частичная загрузка остаётся на сервере, клиент может явно начать новый `resume`. Фиксированное окно каждой попытки также останавливает зависшие ответы; на очень медленном канале увеличьте attemptTimeoutMs. Синхронному complete отведено 30 минут на попытку для сборки больших файлов; proxy тоже должен допускать это ожидание. Для фонового завершения доступны complete-async/worker. Общий deadline операции задаётся внешним AbortSignal, SDK не навязывает лимит времени всему файлу.

Автоповторы включены у `create`, внутренних шагов `resume`, `downloadVerified`. Самостоятельные низкоуровневые `status`, `parts`, `complete`, `download` и каталоговые операции выполняют один вызов. Изменения metadata/assets с CAS автоматически не повторяются.

## Upload

```ts
const upload = await client.create(repository, persistentKey, descriptor, signal);
await client.resume(repository, upload.id, file, {
  signal,
  onProgress: (confirmedBytes) => updateProgress(confirmedBytes),
  onRetry: ({ attempt, delayMs }) => reportRetry(attempt, delayMs),
});
```

Сохраняйте ID сессии и исходный файл. `resume` заново читает список принятых частей и сверяет их хеши с выбранным файлом. Повтор одной части безопасен; прогресс учитывает подтверждённые байты один раз. SHA-256 всего файла проверяется сервером при публикации. Повтор complete после потери успешного ответа возвращает опубликованный объект. Отмена сетевого вызова не равна DELETE сессии.

CLI после `npm run build`:

```powershell
npm run upload -- C:\packages\large.upack releases
npm run upload -- C:\packages\large.upack releases <saved-upload-id>
```

CLI использует multipart SDK, выводит ID, поддерживает Ctrl+C и проверяет хеш выбранного файла даже при уже опубликованной сессии. Токен передаётся через ARKVORY_TOKEN_FILE или ARKVORY_TOKEN; адрес через ARKVORY_BASE_URL. Чтобы восстановить резервирование после полной потери ответа, задайте ARKVORY_IDEMPOTENCY_KEY равным выведенному ключу. Повтор ключа с другим descriptor запрещён. Истёкшую/отменённую сессию заменяют новой с новым ключом.

Сервер разделяет ожидание отправителя (`ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`, 30 секунд) и общий срок принятого PUT/complete (`ARKVORY_UPLOAD_DEADLINE_MS`, 30 минут). Паузы записи и ограничения скорости не расходуют idle-бюджет. После timeout клиент сверяет статус и повторяет безопасный шаг; сессия автоматически не удаляется. Короткое чтение blob/Range прерывает ответ, поэтому скачивание нельзя считать успешным до проверки длины и SHA-256. [Гарантии, диагностика и ограничения](adr/0029-upload-lifetime-and-exact-reads.md).

## Verified download

```ts
const stream = await client.downloadVerified(repository, artifactId, { signal });
await stream.pipeTo(stagingWritable, { signal });
// Только успешный pipeTo разрешает commit/переименование локального файла.
```

Web-консоль уже использует этот путь. Размер, диапазон, ETag и отсутствие преобразования содержимого проверяются до выдачи блока; SHA-256 всего файла — перед успешным завершением. Нельзя передавать поток непосредственно в необратимый deployment: используйте временный файл и commit после проверки. `ArkvoryIntegrityError` означает отказ проверки, `ArkvoryNetworkError` — сетевой сбой/тайм-аут после исчерпания повторов. ArkvoryHttpError сохраняет status/code/requestId и retryAfterMs; ответы proxy и секреты не отражаются в сообщениях.

Чтобы продолжить после перезапуска своего клиента, передайте сохранённый префикс:

```ts
const suffix = await client.downloadVerified(repository, artifactId, {
  prefix: immutableSavedPrefixBlob,
  signal,
});
await suffix.pipeTo(stagingWritableAtPrefixEnd, { signal });
```

Поток содержит **только суффикс**. SDK хеширует prefix заново и сверяет итог с SHA-256 artifact. Prefix должен быть неизменяемым снимком начала файла; sink должен начинать запись ровно с prefix.size. Долговечность локального checkpoint, отсутствие параллельной записи и атомарный commit обеспечиваются клиентом. При неверном сохранённом начале операция завершится ошибкой проверки целого файла, частично записанный target нельзя публиковать. Встроенного дискового журнала скачивания и browser resume после закрытия вкладки пока нет.

## Проверка

`tests/sdk-transfer.test.mjs`: реальные локальные HTTP-сокеты, разрыв внутри блока, восстановление новым клиентом с prefix, неверные ETag/Range/размер/encoding/hash, отмена, stalled body, Retry-After и общий бюджет. `tests/integration/transfer-recovery.test.mjs`: fault proxy перед настоящими API/PostgreSQL/local storage, потеря ответа после create/part/complete, разрыв отправки, отсутствие дубликатов и пустой файл.

Большой профиль: `npm run gate -- large-multipart`, требует ARKVORY_TEST_DATABASE_URL и отдельную тестовую БД. Передаёт 5 GiB, убивает API на середине multipart и после публикации, рвёт download socket и проверяет SHA-256/RSS клиента и сервера. Не запускайте одновременно другие интеграционные тесты на этой БД.

Консоль использует [DownloadQueue и приватные OPFS checkpoints](DOWNLOAD_QUEUE.md) для паузы и продолжения скачиваний в пределах вкладки. Закрытие/reload сбрасывает очередь; CLI-адаптер постоянного download journal по-прежнему не реализован.
