# Запуск и использование первого ядра

Рабочий standalone backend: TypeScript → Node.js, Fastify, PostgreSQL, локальные неизменяемые файлы. Это версия для разработки и испытаний; границы гарантий описаны в [ADR 0004](adr/0004-native-standalone-core.md).

## Быстрый старт

Node.js 24, npm 11 и PostgreSQL 18. Локальный compose требует работающий Docker. Из корня проекта:

```sh
npm ci
npm run build
npm run init:local
docker compose --env-file .env -f deploy/compose.dev.yml up -d --wait
npm run migrate
npm start
```

`init:local` создаёт случайные пароли, `.env`, `data/service-keys.json` с хешем ключа и `data/local-token.txt` с самим ключом. Локальный ключ получает `administrator: true` для первого создания пользователей и групп. Повторный запуск не перезаписывает файлы. Все эти данные исключены из Git. На Windows доступ к ним задаётся ACL каталога пользователя; POSIX mode не заменяет Windows ACL.

Можно использовать существующую отдельную PostgreSQL: укажите `ARKVORY_DATABASE_URL` в `.env` вместо запуска compose. Migrate запускается явно и повторяется безопасно. Миграции схемы 1–7 транзакционные; миграция 8 строит шесть индексов каталога через `CREATE INDEX CONCURRENTLY` вне транзакции и продолжает после прерывания. Запланируйте место под индексы, WAL и временные файлы, затем дождитесь завершения команды перед запуском нового кода. Для production позже потребуется разделить роль миграций и runtime-role с минимальными правами. [Замер и решение](adr/0014-online-package-page-indexes.md).

API слушает `127.0.0.1:8080`. В другом терминале:

```sh
npm run upload -- ./example.upack releases
```

Скрипт вычисляет SHA-256 потоково, резервирует сессию и отправляет файл. Печатает ID загрузки и URL содержимого, без ключа. `releases` — пример repository scope локального ключа. Это логическая область каталога; административного API репозиториев пока нет.

## Конфигурация

| Переменная                               | Назначение                                                                                                                                                                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_DATABASE_URL`                   | Отдельная PostgreSQL БД для одного Arkvory                                                                                                                                                                                                          |
| `ARKVORY_DATA_DIR`                       | Локальный каталог staging/blobs/storage-id, не сетевой share                                                                                                                                                                                        |
| `ARKVORY_KEYS_FILE`                      | JSON-массив сервисных ключей: `id`, `sha256`, `repositories`, `permissions`, необязательный `administrator`                                                                                                                                         |
| `ARKVORY_HOST`, `ARKVORY_PORT`           | Bind; по умолчанию loopback и 8080                                                                                                                                                                                                                  |
| `ARKVORY_CORS_ORIGINS`                   | Необязательный список точных origins внешнего браузерного UI через запятую; по умолчанию пустой                                                                                                                                                     |
| `ARKVORY_CAPACITY_BYTES`                 | Лимит логических резервов; по умолчанию 10 TiB, не обещание доступного диска                                                                                                                                                                        |
| `ARKVORY_MAX_UPLOADS`                    | Параллельные PUT/complete/cancel; по умолчанию 2                                                                                                                                                                                                    |
| `ARKVORY_MAX_DOWNLOADS`                  | Параллельные GET/HEAD bytes; по умолчанию 16                                                                                                                                                                                                        |
| `ARKVORY_MAX_REQUESTS`                   | Одновременные аутентифицированные запросы процесса, включая ожидающие в очереди передачи; по умолчанию 128, должно быть больше `ARKVORY_MAX_UPLOADS + ARKVORY_MAX_DOWNLOADS`. Без явного значения при больших лимитах передач берётся их сумма + 64 |
| `ARKVORY_DATABASE_POOL_SIZE`             | Пул запросов API к PostgreSQL, 4–200, по умолчанию 10. До трёх соединений постоянно заняты сессией владения, lease чтения и закреплениями                                                                                                           |
| `ARKVORY_STORAGE_RESERVE_BYTES`          | Свободное место тома, которое не отдаётся под загрузки; по умолчанию 1 GiB (1073741824), `0` отключает резерв. Читают API и worker                                                                                                                  |
| `ARKVORY_ACCESS_LOG`                     | `true`/`false`, по умолчанию `true`: JSON-строка access log на каждый запрос в stdout                                                                                                                                                               |
| `ARKVORY_DRAIN_TIMEOUT_MS`               | Окно graceful drain после SIGTERM/SIGINT, 0–3600000, по умолчанию 30000                                                                                                                                                                             |
| `ARKVORY_LOG_LEVEL`                      | `debug`/`info`/`warning`/`error`, по умолчанию `info`: минимальный уровень JSON-журнала API и worker; другое значение — ошибка запуска                                                                                                              |
| `ARKVORY_TRUSTED_PROXIES`                | IP/CIDR reverse proxy через запятую (до 32): только от них берутся `X-Forwarded-For` для `clientIp` и входящий `X-Request-Id`                                                                                                                       |
| `ARKVORY_TLS_CERT_FILE`                  | PEM-сертификат (лист и при необходимости цепочка) встроенного HTTPS; задаётся вместе с ключом                                                                                                                                                       |
| `ARKVORY_TLS_KEY_FILE`                   | PEM-ключ без пароля для `ARKVORY_TLS_CERT_FILE`; права только у учётной записи службы                                                                                                                                                               |
| `ARKVORY_TLS_MIN_VERSION`                | `TLSv1.2` (по умолчанию) или `TLSv1.3`                                                                                                                                                                                                              |
| `ARKVORY_TLS_RELOAD_SECONDS`             | Интервал проверки обновлённых файлов сертификата, 30–86400 с (по умолчанию 300); `0` — только при запуске                                                                                                                                           |
| `ARKVORY_TOKEN_FILE`, `ARKVORY_BASE_URL` | Только локальный upload CLI                                                                                                                                                                                                                         |

HTTPS для доступа с другой машины настраивается одним из двух способов.

1. **Встроенный TLS.**
   - Задайте `ARKVORY_TLS_CERT_FILE` и `ARKVORY_TLS_KEY_FILE`, а затем `ARKVORY_HOST` с внешним адресом.
   - Сертификат и ключ проверяются при запуске: файлы должны читаться, ключ должен подходить к сертификату, срок действия не должен истечь. Иначе запуск завершается ошибкой, а не переходит на HTTP.
   - Обновлённые файлы (ACME, корпоративный УЦ) подхватываются без перезапуска: новые соединения получают новый сертификат, открытые сохраняют старый. Неудачное обновление оставляет рабочий сертификат и пишет `tls.reload_failed`.
   - За 14 дней до окончания срока раз в сутки пишется `tls.expiring`. Метрика `arkvory_tls_certificate_expiry_timestamp_seconds` пригодна для алерта.
   - Ответы получают `Strict-Transport-Security`. Клиентские сертификаты (mTLS) не поддерживаются.
2. **Доверенный reverse proxy** ([nginx.conf.example](../deploy/nginx.conf.example)). Proxy терминирует TLS; укажите его в `ARKVORY_TRUSTED_PROXIES` и закройте backend-порт от остальных адресов. Proxy должен передавать потоки без буферизации всего тела.

API без TLS на не-loopback адресе без доверенного proxy пишет при запуске предупреждение `http.plaintext_exposed`. Не отправляйте ключи через открытый HTTP между машинами. CORS по умолчанию не открыт.

Для UI на другом origin задайте `ARKVORY_CORS_ORIGINS=https://ui.example.com` и перезапустите API. Допустимо до 16 точных origins без пути, query и wildcard; HTTP разрешён только для loopback. Разрешение origin не выдаёт прав: каждый запрос по-прежнему требует Bearer и серверную проверку доступа к репозиторию. Preflight `OPTIONS` для native API и `/health/ready` проходит до проверки Bearer; разрешённые методы и заголовки ограничены. Подробная настройка и пример клиента: [EXTERNAL_UI](EXTERNAL_UI.md).

Подключение к БД ограничено 5 секундами, SQL statement — 10 секундами, ожидание ответа клиентом — 15 секундами. Размер пула API задаёт `ARKVORY_DATABASE_POOL_SIZE`; при расчёте `max_connections` PostgreSQL учитывайте пул API, пул блокировок записи (`ARKVORY_MAX_UPLOADS`), пул worker (5) и шлюзы чтения. Если rollback не удался, соединение удаляется из пула. Эти лимиты не ограничивают длительность byte stream: SQL-транзакция на время передачи не удерживается.

На все native API маршруты кроме `/health/live`, `/health/status` и `/api/v1/auth/login` нужен `Authorization: Bearer <service-key-or-session>`. `/health/ready` проверяет БД и каталог; поле `writable` показывает наличие свободного резерва. Недостаток места не отключает чтение. Для балансировщика используйте публичный `GET /health/status`: 200 `{"status":"ready"}` либо 503 `{"status":"unavailable"|"draining"}` без подробностей; проверка БД кешируется на 1 секунду. Оба health-маршрута не занимают бюджет `ARKVORY_MAX_REQUESTS`, поэтому нагрузка передач не выводит узел из балансировщика.

Отказ запуска API и worker печатается одной JSON-строкой в stdout (`startup.failed` у API, `worker.unavailable` у worker) и короткой подсказкой в stderr. Запись содержит `reason` и, когда известны, `errorName`, `errno`, `sqlstate`. `reason` содержит только тексты собственной проверки конфигурации (имя переменной, не значение), код ArkvoryError или обобщённую причину (`dependency unavailable`, `database authentication failed`, `database schema is missing; run migrations`); URL, пароли и длинные токены вырезаются. Пример: `{"timestamp":"…","level":"error","service":"api","version":"1.4.2","pid":4120,"hostname":"node-a","component":"process","code":"startup.failed","reason":"Invalid ARKVORY_PORT"}`.

Access log (`ARKVORY_ACCESS_LOG=true`, уровень `info`) пишет в stdout на каждый завершённый или прерванный ответ запись `http.access`: `requestId`, `traceId` (если пришёл корректный W3C `traceparent`), `method`, `route` (шаблон маршрута, без query string), `status`, `durationMs`, `bytesSent` и `bytesReceived` (байты сокета вместе с заголовками), `principal` (ID, если запрос аутентифицирован), `clientIp`, `completed`. `clientIp` — адрес TCP-соединения; если peer входит в `ARKVORY_TRUSTED_PROXIES`, берётся ближайший недоверенный адрес из `X-Forwarded-For`, иначе за reverse proxy это адрес proxy. Заголовки и query string не пишутся. Успешные `/health/live` и `/health/status` не логируются. Публичные ошибки содержат `code`, `message`, `requestId`. Аудит изменений каталога описан в [runbook 0.2](LIFECYCLE_AND_CATALOG.md), журнал identity — в [IDENTITY](IDENTITY.md).

## Журналы, метрики и корреляция

Решение и ограничения: [ADR 0052](adr/0052-structured-observability.md). API, worker, `migrate`, GC и scrub пишут в stdout по одной JSON-строке на событие. Первые поля всегда: `timestamp`, `level` (`debug|info|warning|error`), `service` (`api|worker|migrate|gc|scrub`), `version` (из `release.json` установленного релиза, в checkout — `dev`), `pid`, `hostname`, `component` (`api|http|storage|worker|maintenance|migrate|process|diagnostics`), `code`. Остальные поля — из закрытого списка: идентификаторы (`requestId`, `traceId`, `jobId`, `uploadId`, `artifactId`, `repository`, `principal`), числа (`status`, `durationMs`, `attempts`, `generation`, `fromSchema`, `toSchema`, `dropped`, …) и коды причины (`errorCode`, `errorName`, `errno`, `sqlstate`); единственный свободный текст `reason` редактируется. Тексты исключений, URL, заголовки и секреты не пишутся.

Минимальный уровень задаёт `ARKVORY_LOG_LEVEL`; фильтр работает до сериализации, `warning`/`error` скрывают и access log. Журнал никогда не блокирует передачу: при заполненном stdout записи отбрасываются и учитываются, после освобождения пишется `diagnostics.dropped` с полем `dropped`. Поля длиннее 256 символов обрезаются (`truncated`), запись длиннее 4096 символов заменяется `diagnostics.oversized` с `recordCode` и `requestId`. Эти записи не фильтруются уровнем. Сбор журнала выполняет супервизор: journald, WinSW (`logs/`, 20 MiB × 5), `docker compose logs`.

Основные коды. Процесс: `api.listening`, `api.ownership_lost`, `drain.started` (`drainWindowMs`, `activeRequests`, `signal`), `drain.settled`/`drain.timeout`/`api.stopped` (`durationMs`), `drain.expedited`, `api.stop_timeout`, `startup.failed`, `process.unhandled` (`origin`; после записи процесс выходит с кодом 1 и перезапускается супервизором). Миграция: `migrate.started/completed/failed` (`fromSchema`, `toSchema`). Worker: `worker.started/stopping/stopped/ownership_lost/unavailable`, `completion.started` (debug), `completion.completed|failed|lease_lost`, `completion.attempts_exhausted`, `completion.heartbeat_failed`. Обслуживание: `cleanup.unavailable`, `maintenance.unavailable`, `diagnostics.persist_failed`, `gc.*`, `scrub.verification_failed`, `scrub.completed` (`checked`, `failed`).

Корреляция. Сервер генерирует UUID `X-Request-Id` и возвращает его в каждом ответе и ошибке. Входящий `X-Request-Id` (одно значение, 8–128 символов `[A-Za-z0-9._:-]`) сохраняется только от адреса из `ARKVORY_TRUSTED_PROXIES`. Доверенный proxy обязан перезаписывать заголовок, иначе через него пройдёт ID, выбранный клиентом; на nginx: `proxy_set_header X-Request-Id $request_id;` ([пример](../deploy/nginx.conf.example)). Тот же ID попадает в `http.access`, HTTP-диагностику, `arkvory_jobs.request_id` (запрос, который поставил или повторно поставил задачу), все строки worker этой задачи, `arkvory_audit.request_id` и `arkvory_security_audit.request_id`. Публичные списки аудита это поле не возвращают. Поиск от запроса к задаче и аудиту:

```sql
SELECT id, status, error_code FROM arkvory_jobs WHERE request_id = '<requestId>';
SELECT sequence, action, artifact_id FROM arkvory_audit WHERE request_id = '<requestId>';
SELECT id, action, outcome FROM arkvory_security_audit WHERE request_id = '<requestId>';
```

В журнале worker ищите `completion.*` с тем же `requestId` или `jobId`. `traceId` берётся из корректного `traceparent` любого клиента и служит только для поиска в системе трассировки.

Метрики: `GET /health/metrics` с любым действующим ключом или сессией (как `/health/ready`; без credential — 401), Prometheus text 0.0.4, вне бюджета запросов, работает во время drain. Пример `scrape_config`: `metrics_path: /health/metrics`, `authorization: { credentials_file: /etc/prometheus/arkvory.token }`; используйте отдельный сервисный ключ без прав на репозитории. Метрики: `arkvory_http_requests_total` и `arkvory_http_request_duration_seconds` (метки `method`, `route` — шаблон, `status_class`), `arkvory_http_request_bytes_total`/`arkvory_http_response_bytes_total`, `arkvory_http_requests_in_flight`, `arkvory_transfer_active`/`arkvory_transfer_queue_depth`/`arkvory_transfer_admission_failures_total` (`direction`), `arkvory_completion_jobs` (`state=queued|running`, из БД, кеш 5 с), `arkvory_completion_oldest_queued_seconds`, `arkvory_diagnostic_records_total` (`outcome`), `arkvory_build_info`, `arkvory_process_start_time_seconds`, `arkvory_process_resident_memory_bytes`, при встроенном HTTPS — `arkvory_tls_certificate_expiry_timestamp_seconds`. p95/p99 считаются в Prometheus, например `histogram_quantile(0.99, sum by (le, route) (rate(arkvory_http_request_duration_seconds_bucket[5m])))`. Значения принадлежат процессу и сбрасываются при перезапуске; у worker нет HTTP-порта, исходы задач видны по строкам `completion.*`.

Готовые правила алертов: [deploy/monitoring/arkvory-alerts.yml](../deploy/monitoring/arkvory-alerts.yml). В них:

- недоступность API и доля ответов 5xx;
- p99 запросов каталога и управления (передача файлов исключена);
- ожидание задач завершения больше 10 минут;
- отказы и тайм-ауты допуска передач;
- потерянные строки журнала и сбои сбора метрик из БД;
- окончание срока встроенного сертификата.

Правила подключаются через `rule_files:`, а scrape job должен называться `arkvory`. Пороги стартовые, их нужно уточнить по измеренному трафику. `tests/monitoring-rules.test.mjs` проверяет, что каждое правило ссылается только на реально выдаваемые метрики. Место на томе хранилища и PostgreSQL контролируйте node_exporter и postgres_exporter.

Deploy CLI печатает строки `<ISO-8601> INFO|WARN|ERROR <текст>` с одним редактором секретов. Планировщик обновлений Windows пишет вывод в `logs/updater.log` установки (ротация 20 MiB × 5); на Linux вывод `arkvory-update.service` собирает journald.

## Пользователи и группы

После миграции 6 администратор входит в консоль с ключом, у которого `administrator: true`, или создаёт другого администратора. В существующем `data/service-keys.json` это поле нужно добавить вручную для одного доверенного ключа и перезапустить API; старые ключи без поля продолжают обычную работу. Доступ к репозиторию по административному признаку сам по себе не выдаётся.

Администратор создаёт учётную запись и группу, добавляет пользователя в группу, затем выдаёт группе `read` или `write` для нужного репозитория. `write` включает чтение; разные права в разных репозиториях не смешиваются. Администратор может отключить аккаунт или сменить пароль с отзывом всех его сессий. Пользователь входит в консоли по имени и паролю. После пяти неверных попыток вход блокируется на 15 минут; logout удаляет сессию, срок сессии — 12 часов. Пароли, исходные токены и хеши не возвращаются в списках API. Нужен HTTPS за пределами loopback. Точный контракт в [ADR 0011](adr/0011-users-groups-and-package-browser.md) и OpenAPI.

Экран «Пакеты» показывает зарегистрированные UPack с фильтрами группы/имени, сортировкой по группе, имени или SemVer-версии, группировкой по группе либо пакету и переключением курсорных страниц. Нативный API возвращает 50 версий по умолчанию, максимум 100 на страницу. `packages/content` ищет точную или старшую SemVer-версию одним запросом без загрузки полного списка. Изменение доступа вступает в силу для следующего запроса, но уже открытый download не обрывается автоматически.

## Контракт первого API

Актуальная OpenAPI: авторизованный `GET /api/v1/openapi.json`. Схемы запросов/ответов лежат в `packages/contracts/src/native.ts` и используются HTTP-сервером.

Общий префикс: `/api/v1/repositories/{repository}`.

| Метод и путь                          | Поведение                                                                |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `POST /uploads`                       | Резервирование; `Idempotency-Key` обязателен, ответ 201                  |
| `GET /uploads/{id}`                   | Состояние собственной сессии; требуется write                            |
| `PUT /uploads/{id}/content`           | `application/octet-stream`, передача всего файла и публикация            |
| `POST /uploads/{id}/complete`         | Повтор завершения или восстановление сохранённого blob после сбоя commit |
| `DELETE /uploads/{id}`                | Отмена pending, без удаления published и без освобождения резерва        |
| `GET /artifacts`                      | Только available; `limit` 1–100, `after` — UUID предыдущей страницы      |
| `GET /artifacts/{id}`                 | Неизменяемый descriptor                                                  |
| `GET`, `HEAD /artifacts/{id}/content` | Bytes/заголовки, Range, ETag, If-Range, If-None-Match                    |

Пример JSON резервирования:

```json
{
  "name": "example.upack",
  "size": "123456",
  "sha256": "<64 lowercase hexadecimal characters>",
  "labels": ["release", "linux"],
  "metadata": { "version": "1.0.0", "platform": "linux-x64" }
}
```

SHA-256 и размер должны соответствовать исходным байтам. Фиксированного предела размера нет: верхняя граница — `ARKVORY_MAX_OBJECT_BYTES` (по умолчанию предел multipart-раскладки 10 000 × 1 GiB ≈ 10 TiB), фактически — квоты и свободное место. До 32 уникализируемых labels и 32 плоских строковых metadata-полей по 1024 символа; размер JSON до 64 KiB. Descriptor неизменяем; редактируемые аннотации хранятся отдельно. Файловое имя не является путём, идентичностью пакета или UPack-версией.

Ключ идемпотентности действует внутри repository + principal. Повтор с теми же нормализованными полями возвращает ту же сессию; другое содержимое descriptor — 409. Для ротации credential с сохранением владельца сессий сохраняйте `id` principal, меняйте хеш ключа и перезапускайте сервер.

## Поведение при сбоях

1. Если ответ PUT потерян, прочитайте `GET uploads/{id}`. `available` означает завершённую публикацию.
2. Если сессия pending, попробуйте `POST complete`: сервер проверит уже сохранённый финальный blob. При отсутствии финального blob вернётся 503; повторите PUT с байта 0 в той же сессии.
3. При несовпадении размера/хеша — 422, сессия остаётся pending. Исправленный файл можно передать повторно. Descriptor нельзя менять под тем же ключом.
4. При занятости сессии/лимита — 503 с Retry-After. Повторяйте ограниченно, с backoff. HTTP-очередь ограничена и находится в памяти; очередь фонового complete хранится в БД.
5. При исчерпании логической ёмкости/свободного места — 507. Передача резервирует место в памяти процесса; также проверяется свободный резерв `ARKVORY_STORAGE_RESERVE_BYTES` (по умолчанию 1 GiB). Внешний процесс всё ещё может заполнить диск; `ENOSPC`/`EDQUOT` при записи также дают 507 `capacity_exceeded`.
6. Потеря соединения с PostgreSQL (SQLSTATE класса 08, 57P01–57P03, 53300, statement timeout, `ECONNREFUSED`/`ECONNRESET`) — 503 `unavailable` с Retry-After. Непредвиденная ошибка сервера — 500 `internal` без Retry-After: SDK её не повторяет, оператор ищет строку с тем же `requestId`, `errorName`, `errno`/`sqlstate` в журнале.
7. Если пропало соединение владения standalone, новые запросы блокируются до перезапуска. Не запускайте второй API на той же БД и не копируйте storage-id в другое пустое хранилище.

Прерывание PUT не подтверждает частично принятые bytes. Сессия и логический резерв сохраняются. Завершённые артефакты доступны после перезапуска. Метки ETag основаны на проверенном хеше; непрерывного background scrub пока нет.

## Остановка, обновление и drain

SIGTERM/SIGINT переводит API в режим drain: `/health/status` и `/health/ready` сразу отвечают 503 (`draining`), новые запросы и ожидающие в очереди передачи получают 503 `busy`, `Retry-After: 2` и `Connection: close`. Уже начатые загрузки и скачивания продолжаются до `ARKVORY_DRAIN_TIMEOUT_MS`; затем фоновые задачи останавливаются, оставшиеся соединения закрываются, процесс завершается. Второй сигнал пропускает остаток окна. Жёсткий срок выхода — окно drain + 120 секунд. Systemd (`TimeoutStopSec`), WinSW (`stoptimeout`) и compose (`stop_grace_period`) дают 120 секунд, поэтому окно больше ~90 секунд требует увеличить и их. Потеря владения хранилищем завершает процесс без drain. Балансировщик должен опрашивать `/health/status` чаще окна drain, чтобы успеть снять узел.

Добавлены offline GC и scrub: остановить API/worker, отключить их автоматический запуск, затем `npm run gc` или `npm run scrub`. Политика TTL/grace, освобождение резервов и ограничения описаны в [runbook 0.2](LIFECYCLE_AND_CATALOG.md).

## Проверки

```sh
npm run check
npm test
```

Интеграционные тесты требуют `ARKVORY_TEST_DATABASE_URL` на отдельную тестовую БД. Создают уникальную schema и удаляют только её; пользователь БД должен иметь право CREATE SCHEMA. Отсутствие URL — ошибка, не пропуск теста.

```sh
npm run test:integration
npm run test:large
```

Large test передаёт 5 GiB по настоящему HTTP в отдельный Node-процесс, убивает его после публикации, запускает заново, проверяет Range, полный размер и SHA-256 и ограничивает пик RSS сервера 384 MiB. Нужны не менее 6 GiB свободного места в системном temp и доступная PostgreSQL. Результат — `test-results/large-transfer.json`. Запускать последовательно с другими интеграционными тестами: standalone-lock привязан к БД.

CI выполняет статические и локальные blob-тесты на Linux/Windows, PostgreSQL integration на Linux. Большой тест доступен через ручной workflow_dispatch с `large_transfers=true`.

## Расширение 0.2

[Части/resume, worker, очереди, каталог, UPack, SDK и консоль](LIFECYCLE_AND_CATALOG.md). [Импорт и миграция](MIGRATION.md), [два сервера](TWO_NODE_PLAN.md). Распределённая сеть, replication/failover и production cutover остаются открытыми.

## Дополнительные шлюзы чтения

Текущий код требует схему 8: перед обновлением остановить writer/readers/worker, сделать согласованный backup, выполнить `npm run migrate`, запустить новый код. Standalone остаётся настройкой по умолчанию. Роль reader, общий storage, slots/rates, lease expiry, маршрутизация и offline-смена policy описаны в [READ_GATEWAYS](READ_GATEWAYS.md). Не подключайте произвольный сетевой share или асинхронную копию: конкретный backend сначала должен пройти проверку публикации и согласованного чтения.

Readiness и startup проверяют завершение миграций 8 (индексы), 9 (сервисные аккаунты/ключи), 10 (делегирование) и 11 (индекс страниц assets). Индексная миграция использует отдельный advisory lock 18471/9 и не занимает блокировку резервирования upload 18471/2. Лимит 128 HTTP-запросов применяется до поиска пользовательской сессии в БД. Все HTTP-операции с паролями (вход, создание, административный сброс и собственная смена) делят допуск: 2 активных, 16 ожидающих, ожидание до 1 секунды. В БД сериализованы добавления identity-записей: максимум 1000 пользователей, 100 групп, 10 000 memberships и 10 000 grants; повтор существующей связи и изменение её прав допускаются на границе лимита.

Перед использованием вложений выполните `npm run migrate`: новые API-процессы требуют миграцию 12. Она добавляет таблицы ревизий и ссылок, не переписывая blobs/annotations. На старых узлах capability `buildAttachments` отсутствует. Сначала миграция, затем обновление API/SDK/UI. [Контракт](BUILD_DETAILS.md).
