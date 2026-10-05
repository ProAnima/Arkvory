---
title: TypeScript SDK
---

# TypeScript SDK

TypeScript SDK — клиентская библиотека, которую используют консоль и `arkvoryctl`. Она оборачивает REST API `/api/v1`. Библиотека проверяет каждый ответ во время выполнения, загружает файлы по частям, продолжает прерванные передачи и проверяет скачанное по SHA-256. Она использует только стандартные веб-API (`fetch`, потоки, Web Crypto), поэтому работает и в Node.js, и в браузерах.

## Как получить SDK {#get-the-sdk}

SDK — это пакет рабочей области `@proanima/arkvory-sdk` в папке `packages/sdk` репозитория исходного кода `ProAnima/Arkvory`. Он **не опубликован в реестре npm**. Он зависит от пакета рабочей области `@proanima/arkvory-contracts`.

- Чтобы использовать SDK, соберите репозиторий исходного кода (`npm ci`, затем `npm run build`) и пишите свой инструмент внутри этой рабочей области, как это делают скрипты самого репозитория.
- Из другого языка или из проекта, который не может использовать рабочую область, вызывайте [REST API](../api/index) напрямую с заголовком `Authorization: Bearer <ключ>`.

Исходный код доступен по лицензии Arkvory. Использовать и изменять его внутри своей организации можно. Распространять копии нельзя.

## Создание клиента {#create-a-client}

```typescript
import { ArkvoryClient } from '@proanima/arkvory-sdk';

const client = new ArkvoryClient('https://arkvory.example/', () => process.env.ARKVORY_KEY ?? '', {
  requestTimeoutMs: 60_000,
  attemptTimeoutMs: 120_000,
  maxRetries: 20,
});
const releases = client.inRepository('releases');
```

- **Базовый URL.** Нужен HTTPS. Обычный HTTP разрешён только для `localhost`, `127.0.0.1` и `[::1]`. URL не должен содержать пользователя, пароль, запрос или фрагмент. Он может содержать префикс пути. Перенаправления считаются ошибками.
- **Функция получения токена.** SDK вызывает её для каждого запроса и никогда не кэширует результат. Ключи можно ротировать, не создавая новый клиент.
- **`inRepository(id)`** возвращает клиент, привязанный к одному репозиторию. Это удобство, а не граница безопасности.

| Параметр           | По умолчанию | Значение                                                                                                                              |
| ------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `signal`           | нет          | Отменяет все запросы этого клиента                                                                                                    |
| `requestTimeoutMs` | нет          | Срок запроса, у которого нет собственного сигнала (от 1 до 3600000)                                                                   |
| `maxAttempts`      | 5            | Число попыток одного запроса передачи, включая первую (от 1 до 10)                                                                    |
| `maxRetries`       | 20           | Повторы, общие для одной операции загрузки или скачивания (от 0 до 100)                                                               |
| `attemptTimeoutMs` | 120000       | Предел одной попытки передачи (от 1 до 1800000)                                                                                       |
| `baseDelayMs`      | 500          | Первая задержка перед повтором (от 1 до 60000)                                                                                        |
| `maxDelayMs`       | 60000        | Самая длинная задержка, включая `Retry-After`                                                                                         |
| `onRequest`        | нет          | Вызывается один раз на каждый HTTP-запрос с методом, путём, статусом, длительностью и ID запроса. Никогда не получает учётные данные. |

Автоматические повторы применяются только к передачам: `create`, шагам внутри `resume` и `downloadVerified`. Они повторяют запросы при сбоях сети и ответах HTTP 408, 429, 502, 503 и 504 с экспоненциальной задержкой и никогда не раньше, чем указано в `Retry-After`. Остальные вызовы выполняются один раз. Изменения, защищённые ревизией, автоматически не повторяются.

## Типовые задачи {#common-tasks}

### Обзор и списки {#discover-and-list}

```typescript
const permissions = await client.permissions();
const repositories = await client.repositories({ limit: 50 });
const page = await releases.artifacts.list();
const found = await releases.artifacts.search({ q: 'build-42', label: 'staging' });
for (const item of found.items) console.log(item.id, item.name, item.size);
const artifact = await releases.artifacts.get('00000000-0000-4000-8000-000000000001');
```

Страницы возвращают `next`. Передайте это значение как `after`, чтобы прочитать следующую страницу.

### Загрузка большого файла с продолжением (Node.js) {#upload-a-large-file-with-resume-node-js}

```typescript
import { openAsBlob } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const file = await openAsBlob('./build/Game.zip'); // не читается в память
const hash = createHash('sha256');
for await (const chunk of file.stream()) hash.update(chunk);

const key = randomUUID(); // сохраните его вместе с состоянием задания до первого запроса
const session = await releases.uploads.create(key, {
  name: 'Game.zip',
  size: String(file.size),
  sha256: hash.digest('hex'),
  labels: ['test'],
  metadata: { commit: 'abc123' },
});
const uploaded = await releases.uploads.resume(session.id, file, {
  onProgress: (bytes) => console.log(`${bytes} of ${file.size} bytes`),
});
await releases.assets.assign('builds/game/1.4/Game.zip', uploaded.id, 0); // 0: путь новый
```

- Тот же ключ идемпотентности с тем же описанием возвращает ту же сессию, поэтому потерянный ответ не создаёт вторую загрузку.
- `resume` читает части, которые уже есть на сервере, сверяет их хеши с вашим файлом и отправляет только недостающие части. После сбоя вызовите `resume` снова с сохранённым ID сессии.
- Размер части выбирает сервер: 8 МиБ, больше — только для файлов, которым нужно более 10 000 частей. SDK держит в памяти одну часть за раз.
- Файлы размером от 16 ГиБ завершает обработчик (worker) сервера. `resume` ждёт его.
- `assets.assign(path, artifactId, expectedRevision)` завершается конфликтом, если у пути другая ревизия. Сначала прочитайте путь через `assets.get(path)`.

### Скачивание с проверкой {#download-with-verification}

```typescript
import { createWriteStream } from 'node:fs';
import { rename } from 'node:fs/promises';
import { Writable } from 'node:stream';

const stream = await releases.artifacts.downloadVerified(uploaded.id);
await stream.pipeTo(Writable.toWeb(createWriteStream('./Game.zip.part')));
await rename('./Game.zip.part', './Game.zip'); // только после успешного pipeTo
```

SDK читает содержимое диапазонами по 8 МиБ и проверяет размер, `Content-Range` и `ETag` каждого диапазона. SHA-256 всего файла проверяется до того, как будет отдан последний блок. Если проверка не пройдена, поток завершается ошибкой `ArkvoryIntegrityError`. Никогда не разворачивайте данные прямо из потока: пишите во временный файл и используйте его только после успешного завершения потока.

Чтобы продолжить после перезапуска, передайте уже сохранённые байты как `prefix`. Тогда поток содержит только остаток:

```typescript
const prefix = await openAsBlob('./Game.zip.part');
const rest = await releases.artifacts.downloadVerified(uploaded.id, { prefix });
await rest.pipeTo(Writable.toWeb(createWriteStream('./Game.zip.part', { flags: 'a' })));
```

Для одного диапазона байтов без проверки `releases.artifacts.download(id, { start: 0, end: 1023 })` возвращает необработанный `Response` (статус 206).

### Обычные файлы по пути {#raw-files-by-path}

```typescript
const body = new Blob([JSON.stringify({ level: 3 })]);
const result = await client.raw.putRawFile('releases', 'config/settings.json', body, {
  createOnly: true, // необязательно: отказать, если путь уже существует
});
console.log(result.revision, result.created); // created равно false, если такие байты уже были
const response = await client.raw.downloadRawFile('releases', 'config/settings.json');
```

Параметр `sha256` (64 шестнадцатеричные цифры) позволяет серверу записать байты за один проход и отклонить несовпадение. `releases.assets.put(path, blob, options)` и `releases.assets.download(path, range)` — те же вызовы. Каждая загрузка — один запрос, поэтому используйте их для небольших и средних файлов. См. [Обычные файлы](./raw-files).

### Пакеты, продвижение и ссылки {#packages-promotion-and-links}

```typescript
await releases.packages.register(uploaded.id); // архив UPack
const selected = await releases.packages.resolve({ name: 'app', range: '^1.4', stage: 'release' });
await releases.promotions.promote(selected.artifactId, {
  target: 'prod',
  mode: 'copy',
  stages: ['release'],
});
const link = await releases.artifacts.link(selected.artifactId, { ttlSeconds: 900 });
```

URL ссылки — это секрет, который даёт читать один артефакт до момента `expiresAt`. Досрочно отозвать его нельзя.

### Резервные копии {#backups}

```typescript
const status = await client.backup.status();
const job = await client.backup.run(); // поставлено в очередь для агента резервного копирования
const points = await client.backup.points({ limit: 20 });
```

Вызовы резервного копирования требуют сессии администратора или файлового ключа владельца. Ключи сервисов и персональные токены получают 403.

## Ошибки {#errors}

```typescript
import {
  ArkvoryClientError,
  ArkvoryHttpError,
  ArkvoryIntegrityError,
  ArkvoryNetworkError,
} from '@proanima/arkvory-sdk';

try {
  await releases.artifacts.get(id);
} catch (error) {
  if (error instanceof ArkvoryHttpError) {
    console.error(error.status, error.code, error.reason, error.requestId, error.retryAfterSeconds);
  } else if (error instanceof ArkvoryClientError) {
    console.error(error.code);
  }
}
```

| Класс                   | Значение                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ArkvoryHttpError`      | Сервер ответил ошибкой. Поля: `status`, `code`, `reason`, `details`, `requestId`, `retryAfterMs`, `retryAfterSeconds`, `serverMessage`. `code` равен `http_error`, если ответил прокси-сервер не в формате Arkvory. |
| `ArkvoryNetworkError`   | Не удалось подключиться или истекло время ожидания после всех повторов                                                                                                                                              |
| `ArkvoryIntegrityError` | Скачанные байты не совпадают с артефактом                                                                                                                                                                           |
| `ArkvoryClientError`    | Локальный сбой с полем `code`: `invalid_argument`, `insecure_url`, `invalid_response`, `response_too_large`, `size_mismatch`, `file_changed`, `upload_cancelled`, `completion_failed`                               |

Ориентируйтесь на `code` и `reason`, а не на текст сообщения. Неизвестные коды обрабатывайте по статусу HTTP. `Error.message` никогда не содержит текст сервера. См. [Ошибки](../api/errors).

## Браузер и Node.js {#browser-and-node-js}

- **Браузер и другой origin.** Администратор должен указать точный origin вашей страницы в `ARKVORY_CORS_ORIGINS` на сервере. SDK отправляет ключ в заголовке `Authorization` и никогда не отправляет cookie.
- **Ключи в браузере.** Храните ключ только в памяти. Не помещайте его в URL, `localStorage`, журналы или исходный код страницы. Пользователь может войти через `client.login(name, password)` и получить токен сессии.
- **Файлы в Node.js.** Используйте `openAsBlob` из `node:fs`, чтобы передать файл, не читая его в память.
- **Очередь скачиваний.** `DownloadQueue` и `checkpointedDownload` дают ограниченную очередь с паузой, продолжением и отменой. Адаптер хранилища предоставляете вы.

## Ограничения {#limits}

- Ответы JSON ограничены 2 МиБ (страницы пакетов — 8 МиБ, списки артефактов — 24 МиБ). Более крупные ответы завершаются ошибкой `response_too_large`.
- Размеры — это десятичные строки, поэтому значения больше 2^53 сохраняют полную точность.

## Связанные страницы {#related-pages}

- [Командная строка (arkvoryctl)](./cli)
- [Передачи](../use/transfers)
- [Обзор API](../api/index) и [Аутентификация](../api/authentication)
- [Обычные файлы](./raw-files)
