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

**TLS до PostgreSQL.** Для БД на другом хосте добавьте параметры в `ARKVORY_DATABASE_URL`: `?sslmode=verify-full` (сертификат сервера проверяется по системным CA) или `?sslmode=verify-full&sslrootcert=/путь/ca.pem` для собственного CA; `require`, `verify-ca` и `prefer` драйвер `pg` сейчас трактует как `verify-full`. Без `sslmode` или с `disable`/`allow` каталог, хеши и параметры передаются открытым текстом. Для не-loopback адреса API и worker при запуске пишут `database.plaintext_exposed`; URL и пароль в запись не попадают. Поведение проверено на PostgreSQL 18.4 с `ssl=on`: без `sslmode` — `ssl = false`; `verify-full` без доверия к CA — отказ; с `sslrootcert` — `ssl = true`.

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
   - Задайте `ARKVORY_TLS_CERT_FILE` и `ARKVORY_TLS_KEY_FILE`, а затем `ARKVORY_HOST` с внешним адресом. На нативной установке это делает `arkvory configure --tls-cert … --tls-key … --listen-host …` с перезапуском, проверкой готовности и откатом при сбое; `--tls-off` выключает HTTPS.
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

Основные коды. Процесс: `api.listening`, `api.ownership_lost`, `drain.started` (`drainWindowMs`, `activeRequests`, `signal`), `drain.settled`/`drain.timeout`/`api.stopped` (`durationMs`), `drain.expedited`, `api.stop_timeout`, `startup.failed`, `process.unhandled` (`origin`; после записи процесс выходит с кодом 1 и перезапускается супервизором), `process.stalled` (`stalledSeconds`; главный поток не отвечал, сторож завершил процесс для перезапуска, [ADR 0067](adr/0067-self-healing-services.md)), `process.watchdog_failed` (сторож не запустился, служба работает без него). Миграция: `migrate.started/completed/failed` (`fromSchema`, `toSchema`). Worker: `worker.started/stopping/stopped/ownership_lost/unavailable`, `completion.started` (debug), `completion.completed|failed|lease_lost`, `completion.attempts_exhausted`, `completion.heartbeat_failed`. Обслуживание: `cleanup.unavailable`, `maintenance.unavailable`, `diagnostics.persist_failed`, `gc.*`, `scrub.verification_failed`, `scrub.completed` (`checked`, `failed`).

Корреляция. Сервер генерирует UUID `X-Request-Id` и возвращает его в каждом ответе и ошибке. Входящий `X-Request-Id` (одно значение, 8–128 символов `[A-Za-z0-9._:-]`) сохраняется только от адреса из `ARKVORY_TRUSTED_PROXIES`. Доверенный proxy обязан перезаписывать заголовок, иначе через него пройдёт ID, выбранный клиентом; на nginx: `proxy_set_header X-Request-Id $request_id;` ([пример](../deploy/nginx.conf.example)). Тот же ID попадает в `http.access`, HTTP-диагностику, `arkvory_jobs.request_id` (запрос, который поставил или повторно поставил задачу), все строки worker этой задачи, `arkvory_audit.request_id` и `arkvory_security_audit.request_id`. Публичные списки аудита это поле не возвращают. Поиск от запроса к задаче и аудиту:

```sql
SELECT id, status, error_code FROM arkvory_jobs WHERE request_id = '<requestId>';
SELECT sequence, action, artifact_id FROM arkvory_audit WHERE request_id = '<requestId>';
SELECT id, action, outcome FROM arkvory_security_audit WHERE request_id = '<requestId>';
```

В журнале worker ищите `completion.*` с тем же `requestId` или `jobId`. `traceId` берётся из корректного `traceparent` любого клиента и служит только для поиска в системе трассировки.

Метрики: `GET /health/metrics` с любым действующим ключом или сессией (как `/health/ready`; без credential — 401), Prometheus text 0.0.4, вне бюджета запросов, работает во время drain. Пример `scrape_config`: `metrics_path: /health/metrics`, `authorization: { credentials_file: /etc/prometheus/arkvory.token }`; используйте отдельный сервисный ключ без прав на репозитории. Метрики: `arkvory_http_requests_total` и `arkvory_http_request_duration_seconds` (метки `method`, `route` — шаблон, `status_class`), `arkvory_http_request_bytes_total`/`arkvory_http_response_bytes_total`, `arkvory_http_requests_in_flight`, `arkvory_transfer_active`/`arkvory_transfer_queue_depth`/`arkvory_transfer_admission_failures_total` (`direction`), `arkvory_completion_jobs` (`state=queued|running`, из БД, кеш 5 с), `arkvory_completion_oldest_queued_seconds`, `arkvory_diagnostic_records_total` (`outcome`), `arkvory_metrics_collection_failures_total` (`collector`: сбой сбора метрик из БД), `arkvory_backup_last_success_timestamp_seconds`, `arkvory_backup_agent_last_seen_timestamp_seconds`, `arkvory_backup_warnings` (`code`), `arkvory_mirror_last_sync_timestamp_seconds`, `arkvory_mirror_last_check_timestamp_seconds`, `arkvory_mirror_failing` (`repository`, `mode`), `arkvory_webhook_failing` и `arkvory_webhook_last_success_timestamp_seconds` (`subscription`, `repository`), `arkvory_build_info`, `arkvory_process_start_time_seconds`, `arkvory_process_resident_memory_bytes`, при встроенном HTTPS — `arkvory_tls_certificate_expiry_timestamp_seconds`. p95/p99 считаются в Prometheus, например `histogram_quantile(0.99, sum by (le, route) (rate(arkvory_http_request_duration_seconds_bucket[5m])))`. Значения принадлежат процессу и сбрасываются при перезапуске; у worker нет HTTP-порта, исходы задач видны по строкам `completion.*`.

Готовые правила алертов: [deploy/monitoring/arkvory-alerts.yml](../deploy/monitoring/arkvory-alerts.yml). В них:

- недоступность API и доля ответов 5xx;
- p99 запросов каталога и управления (передача файлов исключена);
- ожидание задач завершения больше 10 минут;
- отказы и тайм-ауты допуска передач;
- потерянные строки журнала и сбои сбора метрик из БД;
- окончание срока встроенного сертификата;
- зеркала: нет синхронизации больше часа (`ArkvoryMirrorStale`) и повторяющиеся ошибки (`ArkvoryMirrorFailing`), по метрикам `arkvory_mirror_last_sync_timestamp_seconds`, `arkvory_mirror_last_check_timestamp_seconds` и `arkvory_mirror_failing` с метками `repository` и `mode`.

Правила подключаются через `rule_files:`, а scrape job должен называться `arkvory`. Пороги стартовые, их нужно уточнить по измеренному трафику. `tests/monitoring-rules.test.mjs` проверяет, что каждое правило ссылается только на реально выдаваемые метрики. Место на томе хранилища и PostgreSQL контролируйте node_exporter и postgres_exporter.

Deploy CLI печатает строки `<ISO-8601> INFO|WARN|ERROR <текст>` с одним редактором секретов. Планировщик обновлений Windows пишет вывод в `logs/updater.log` установки (ротация 20 MiB × 5); на Linux вывод `arkvory-update.service` собирает journald.

## Пользователи и группы

После миграции 6 администратор входит в консоль с ключом, у которого `administrator: true`, или создаёт другого администратора. В существующем `data/service-keys.json` это поле нужно добавить вручную для одного доверенного ключа и перезапустить API; старые ключи без поля продолжают обычную работу. Доступ к репозиторию по административному признаку сам по себе не выдаётся.

Администратор создаёт учётную запись и группу, добавляет пользователя в группу, затем выдаёт группе `read` или `write` для нужного репозитория. `write` включает чтение; разные права в разных репозиториях не смешиваются. Администратор может отключить аккаунт или сменить пароль с отзывом всех его сессий. Пользователь входит в консоли по имени и паролю. Жёсткой блокировки учётной записи нет: вход ограничен корзиной на адрес клиента (10 попыток, пополнение 1 за 15 с; отказ — 429 `rate_limited` с `Retry-After`) и накапливаемым долгом ошибок самой учётной записи, который убывает на 1 за 6 с; выше 20 единиц долга попытки задерживаются с удвоением от 1 до 120 с, даже верный пароль ждёт ([ADR 0049](adr/0049-token-and-account-security.md)). Logout удаляет сессию, срок сессии — 12 часов. Пароли, исходные токены и хеши не возвращаются в списках API. Нужен HTTPS за пределами loopback. Точный контракт в [ADR 0011](adr/0011-users-groups-and-package-browser.md) и OpenAPI.

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
7. Если пропало соединение владения standalone, новые запросы блокируются, API пишет `api.ownership_lost`, завершается с кодом 1, и супервизор поднимает его заново ([ADR 0067](adr/0067-self-healing-services.md)). Не запускайте второй API на той же БД и не копируйте storage-id в другое пустое хранилище.

Прерывание PUT не подтверждает частично принятые bytes. Сессия и логический резерв сохраняются. Завершённые артефакты доступны после перезапуска. Метки ETag основаны на проверенном хеше; непрерывного background scrub пока нет.

## Остановка, обновление и drain

SIGTERM/SIGINT переводит API в режим drain: `/health/status` и `/health/ready` сразу отвечают 503 (`draining`), новые запросы и ожидающие в очереди передачи получают 503 `busy`, `Retry-After: 2` и `Connection: close`. Уже начатые загрузки и скачивания продолжаются до `ARKVORY_DRAIN_TIMEOUT_MS`; затем фоновые задачи останавливаются, оставшиеся соединения закрываются, процесс завершается. Второй сигнал пропускает остаток окна. Жёсткий срок выхода — окно drain + 120 секунд. Systemd (`TimeoutStopSec`), WinSW (`stoptimeout`) и compose (`stop_grace_period`) дают 120 секунд, поэтому окно больше ~90 секунд требует увеличить и их. Потеря владения хранилищем завершает процесс без drain. Балансировщик должен опрашивать `/health/status` чаще окна drain, чтобы успеть снять узел.

Добавлены offline GC и scrub: остановить API/worker, отключить их автоматический запуск, затем `npm run gc` или `npm run scrub`. Политика TTL/grace, освобождение резервов и ограничения описаны в [runbook 0.2](LIFECYCLE_AND_CATALOG.md).

## Резервные копии (B1)

Операторский CLI `arkvory-backup` (`apps/backup`) делает согласованную копию работающего экземпляра во встроенный файловый vault на отдельном диске или смонтированном NAS, проверяет её и восстанавливает в **пустую** БД и **пустой** каталог хранения. API и worker не останавливаются. Решение и протокол: [ADR 0054](adr/0054-built-in-backup-vault.md), [BACKUP_RECOVERY](BACKUP_RECOVERY.md). Это не PITR и не HA: точка содержит опубликованное состояние на момент T; незавершённые загрузки не восстанавливаются.

**Шифрование и обязанности оператора.** Vault по умолчанию шифруется ([ADR 0070](adr/0070-encrypted-backup-vault.md)): содержимое файлов, каталог и описания точек — AES-256-GCM по 1 МиБ с проверкой подлинности, ключ файла привязан к vault, виду и имени файла, поэтому подмена, усечение и перестановка файлов обнаруживаются. Видны только имена и размеры файлов и число точек. Vault без шифрования (`vault init <dir> --no-encryption`) хранит каталог, хеши паролей и все опубликованные файлы открытым текстом: его размещайте только на зашифрованном томе (LUKS, BitLocker, шифрование NAS) с доступом лишь для учётной записи службы и администратора резервирования; том нужен и зашифрованному vault как вторая линия защиты. Linux: `chown arkvory:arkvory /mnt/backup/arkvory && chmod 700 /mnt/backup/arkvory` (CLI создаёт каталоги 0700 и файлы 0600). Windows: режимы POSIX не действуют, ограничьте ACL: службы Arkvory работают от `NT AUTHORITY\LOCAL SERVICE`, например `icacls D:\Backup\Arkvory /inheritance:r /grant:r "*S-1-5-19:(OI)(CI)M" "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F"`. В установке это делает `arkvory configure --backup-vault` (раздел B2 ниже). Тот же физический диск, что и storage, не защищает от отказа диска.

**Подготовка.** Все процессы (API, readers, worker, maintenance) обновлены до схемы релиза (`SCHEMA_VERSION` релиза, сейчас 33; B1 появилось в схеме 25, агент B2 — в 26; `npm run migrate`): процесс без маркера протокола backup даёт `upgrade_required`. Команды читают ту же конфигурацию, что API и worker: `ARKVORY_DATABASE_URL`, `ARKVORY_DATA_DIR`, `ARKVORY_STORAGE_RESERVE_BYTES`, `ARKVORY_LOG_LEVEL`. Дополнительно (ограниченные значения): `ARKVORY_BACKUP_LEASE_SECONDS` (60, 2–3600), `ARKVORY_BACKUP_SNAPSHOT_SECONDS` (1800, 60–86400 — предел барьера, snapshot и экспорта таблиц), `ARKVORY_BACKUP_BARRIER_SECONDS` (30, 1–600 — ожидание уже начатых удалений). В установленном релизе: `node releases/<version>/apps/backup/dist/main.js …` от имени учётной записи службы с её файлом окружения.

```sh
# один раз; каталог новый или пустой; kit и ключ агента — новые файлы вне vault и хранилища
npm run backup -- vault init /mnt/backup/arkvory --kit-file /root/arkvory-recovery-kit.txt --agent-key-file /root/arkvory-agent.key
npm run backup -- vault init /mnt/backup/plain --no-encryption     # vault без шифрования: выбор явный
npm run backup -- capture --vault /mnt/backup/arkvory --key-file /root/arkvory-agent.key --idempotency-key nightly-2026-10-02
npm run backup -- list --vault /mnt/backup/arkvory --key-file /root/arkvory-agent.key
npm run backup -- verify --vault /mnt/backup/arkvory --key-file ...                 # хеши файлов и наличие blob
npm run backup -- verify --vault /mnt/backup/arkvory --key-file ... --point <id> --deep   # читает каждый blob
```

`vault init` создаёт `vault.json`; для зашифрованного vault — ещё ключи в `keys/`, файл ключа агента (`AK1-…`, одна строка, `--agent-key-file`) и **recovery kit** (`--kit-file`, текстовый файл с `RK1-…`): оба файла новые, вне vault и хранилища, права 0600, и `vault init` открывает vault каждым из них, прежде чем сообщить об успехе; при любой ошибке vault и файлы удаляются. **Kit храните вне сервера** (менеджер паролей, сейф): без него и без ключа агента vault не прочитать, а у держателя kit и копии vault есть всё содержимое. Ключ задаётся `--key-file` или `ARKVORY_BACKUP_VAULT_KEY_FILE` (файл службы или kit; в аргументах и журналах ключа нет). Слоты: `vault key list|verify|add-recovery|rotate-agent|remove` (последний слот и последний recovery-слот не удаляются; удаление слота не перешифровывает точки). Без ключа команды дают `vault_key_missing`, с неверным — `vault_key_invalid` (оба: код выхода 3). Без `vault.json` `capture` ничего не пишет (`vault_missing`): так отключённый NAS не превращается в запись на локальный диск под точкой монтирования. Vault внутри `ARKVORY_DATA_DIR` (или наоборот, в том числе через symlink/junction) отклоняется (`unsafe_path`). Повтор `capture` с тем же `--idempotency-key` возвращает ту же точку или продолжает тот же job новой попыткой (до 5); без ключа каждый запуск — новый job. Одновременно идёт одна копия на БД; во время копии `npm run gc`/`scrub` получают отказ (`busy`), online GC откладывает только закреплённые файлы. Не запускайте миграции во время копии: DDL ждёт окончания экспорта таблиц. Если процесс копии умер, его pins и барьер остаются до истечения lease; следующий `capture` (любой ключ) снимает их через fencing.

**Пробное восстановление в чистую цель.** Создайте пустую БД (`CREATE DATABASE arkvory_restore OWNER arkvory;`) и выберите несуществующий или пустой каталог хранения на другом томе. Строку подключения передавайте через окружение, а не аргументом (виден в списке процессов):

```sh
export ARKVORY_RESTORE_DATABASE_URL=postgresql://arkvory@db.example/arkvory_restore
npm run backup -- restore --vault /mnt/backup/arkvory --point <id> --storage /srv/arkvory-restore
npm run backup -- restore --vault /mnt/backup/arkvory --point <id> --storage /srv/arkvory-restore --yes --report /root/restore-report.json
```

Без `--yes` выполняется только проверка: точка, хеши, версия схемы, пустота цели; ничего не пишется. С `--yes`: blob копируются с проверкой SHA-256, БД мигрируется до схемы копии, таблицы загружаются одной транзакцией, применяется нормализация, затем оставшиеся миграции. Непустая цель — `target_not_empty`; при сбое удалите и создайте цель заново. Затем запустите отдельный экземпляр API с `ARKVORY_DATABASE_URL` новой БД, `ARKVORY_DATA_DIR` нового каталога и своим `ARKVORY_KEYS_FILE` и проверьте `/health/ready`, каталог, скачивания и права. Production-адрес на цель не переключайте: это отдельное решение после проверки.

После восстановления (нормализация 1): незавершённые загрузки отменены, их задачи завершены `failed/conflict`, незавершённые продвижения удалены; сессии не перенесены; персональные токены отозваны; сервисные ключи `revoked` — выпустите новые; политики физической очистки и retention выключены — включите осознанно. Пользователи, группы и права сохранены вместе с паролями на момент T (пароль, изменённый после T, снова действует: сбросьте пароли по своей политике). Отчёт (`--report`, строка `backup.restore.completed`) содержит только ID и счётчики.

**Журнал и коды выхода.** Каждая строка stdout — JSON (`component: backup`): `backup.phase` (`barrier → pins → tables → blobs → manifest → commit → done`), `backup.capture.completed`, `backup.point`, `backup.verify.point`/`backup.verify.problem`, `backup.restore.phase`/`planned`/`completed`, при ошибке `backup.failed` с `errorCode` и одной подсказкой в stderr. Пути, URL и секреты не пишутся.

| Код | Значение                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------- |
| 0   | Успех; для restore без `--yes` — пройденная проверка                                                                 |
| 1   | Сбой выполнения (БД/диск недоступны, lease или snapshot потеряны, vault/цель заполнены); точки не повреждены         |
| 2   | Неверные аргументы или переменные окружения                                                                          |
| 3   | Отказ проверки безопасности: нет `vault.json`, пересечение каталогов, непустая цель, схема, старый writer, нет точки |
| 4   | Нарушена целостность: хеш, отсутствующий blob, подменённый manifest; vault не изменять до разбора                    |
| 5   | Занято: идёт другая копия или offline maintenance, удаление не завершилось за время барьера; повторить позже         |

## Резервные копии без участия оператора (B2)

Агент `arkvory-backup agent` (`npm run backup -- agent`; в установленном релизе `node releases/<version>/apps/backup/dist/main.js agent`) делает копии по расписанию и по запросам API, проверяет их и применяет retention. API и консоль только ставят задания и читают состояние из БД; путь vault знает только агент. Решение: [ADR 0056](adr/0056-unattended-backups.md). Обязанности по защите vault — как в B1 выше.

**Окружение агента.** Те же `ARKVORY_DATABASE_URL`, `ARKVORY_DATA_DIR`, `ARKVORY_STORAGE_RESERVE_BYTES`, `ARKVORY_LOG_LEVEL` и таймауты B1. Дополнительно:

| Переменная                        | Значение                                                                                                                                                                                                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_BACKUP_VAULT`            | Каталог, созданный `vault init`. Без неё агент работает, сообщает `vault_not_configured`, задания — ошибка                                                                                                                                                                                            |
| `ARKVORY_BACKUP_VAULT_KEY_FILE`   | Файл ключа агента (`AK1-…`) зашифрованного vault; агент читает его при открытии vault и держит мастер-ключ только в памяти. Нет файла или ключ неверный — vault недоступен: heartbeat `vaultAvailable=false`, `lastError` `vault_key_missing`/`vault_key_invalid`, предупреждение `vault_unavailable` |
| `ARKVORY_BACKUP_BYTES_PER_SECOND` | Ограничение полосы копирования, не меньше 65536; без значения — без ограничения                                                                                                                                                                                                                       |
| `ARKVORY_BACKUP_POLL_SECONDS`     | Пауза между проверками очереди и расписания, 15 (1–3600)                                                                                                                                                                                                                                              |
| `ARKVORY_BACKUP_LEASE_SECONDS`    | Lease агента и копии, 60 (2–3600); heartbeat каждую треть, не реже 30 с                                                                                                                                                                                                                               |

**Служба и vault в установке.** Установщики регистрируют агента третьей службой рядом с API и worker ([ADR 0057](adr/0057-backup-agent-service.md)): systemd `arkvory-backup`, Windows `Arkvorybackup`, сервис Compose `backup`. Автозапуск, восстановление после падения (через 10 с), остановка перед переключением релиза и запуск после API и worker выполняются так же, как у worker. Сбой агента не отменяет установку или обновление: установщик ждёт его heartbeat около 90 с и при отсутствии печатает WARN. Без vault агент работает и сообщает `vault_not_configured`. Vault подключает одна команда (от root или администратора, для Compose — от владельца установки):

```sh
sudo arkvory configure --root /opt/proanima-arkvory --backup-vault /mnt/backup/arkvory --vault-key-file /root/arkvory-agent.key
sudo arkvory configure --root /opt/proanima-arkvory --backup-vault /mnt/backup/plain --init-vault --vault-no-encryption
sudo arkvory configure --root /opt/proanima-arkvory --backup-vault-off
```

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
& "$root\runtime\node.exe" "$root\manage.mjs" configure --root $root --backup-vault D:\Backup\Arkvory --vault-key-file C:\Private\arkvory-agent.key
```

Порядок работы `configure --backup-vault`:

1. Проверяет каталог до любых изменений: абсолютный путь, каталог существует и доступен для записи, после разрешения symlink, junction и 8.3 он вне корня установки и `ARKVORY_DATA_DIR` и не содержит их. На systemd vault не может лежать в /home, /root, /run/user, /tmp, /var/tmp: sandbox службы их не показывает.
2. Зашифрованный vault (по умолчанию) создан заранее `arkvory-backup vault init`; `--vault-key-file` передаёт ключ агента (`AK1-…`; recovery-ключ `RK1-…` команда отвергает: он не должен лежать на сервере). `--init-vault` создаёт `vault.json` только в пустом каталоге и только вместе с `--vault-no-encryption`: vault не становится открытым по умолчанию. Существующий vault не инициализируется повторно. Без `vault.json` и без флага команда отказывает: так отключённый том NAS не принимается за пустой vault.
3. Выдаёт доступ учётной записи службы (таблица ниже), копирует ключ агента в `config/backup/vault.key` (root:arkvory 0640, Compose — владелец uid 1000, 0600, и bind-mount только в контейнер `backup`), записывает `ARKVORY_BACKUP_VAULT` и `ARKVORY_BACKUP_VAULT_KEY_FILE` в `config/runtime.json` и перезапускает только агента. Верность ключа подтверждает сам агент: heartbeat «vault доступен» возможен только после расшифровки; иначе команда возвращает прежние `runtime.json`, ключ и доступ.
4. Ждёт до 150 с, пока heartbeat агента не сообщит именно этот vault (ID из `vault.json`) доступным. Для проверки нужен `config/bootstrap-token.txt` с правом `backup.read`.
5. При любой ошибке возвращает прежние `runtime.json` и доступ и перезапускает агента.

`--backup-vault-off` убирает vault и файл ключа агента у агента, не трогая сам каталог и его права. Перезапуск прерывает идущую копию (`interrupted`), задание повторяется.

| Установка     | Учётная запись службы                                              | Что делает configure                                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux systemd | `arkvory`                                                          | `chown -R arkvory:arkvory`, 0700; drop-in `/etc/systemd/system/arkvory-backup.service.d/arkvory-vault.conf` с `ReadWritePaths`. Остальная ФС, включая storage, для агента только читается |
| Windows       | `NT AUTHORITY\LOCAL SERVICE` (S-1-5-19), та же, что у API и worker | `icacls /inheritance:r`: SYSTEM и Administrators — F, LocalService — M, наследование для новых файлов                                                                                     |
| Compose       | uid 1000 контейнера                                                | bind mount из `config/compose.vault.yml` в `/srv/arkvory-vault`, владелец 1000; на Windows-хосте ACL: SYSTEM, Administrators и пользователь Docker Desktop                                |

**Vault на NAS (Linux).** Проверено стендом `deployment-nas` (SMB 3 через `cifs` и NFS 4): копия, структурная и глубокая проверка, отказ при неверном монтировании.

- **SMB.** Монтируйте от имени службы, иначе файлы будут принадлежать root, и агент не сможет писать. Тогда `configure` откажет и вернёт прежнюю конфигурацию. Пример: `mount -t cifs //nas/arkvory /mnt/backup/arkvory -o credentials=/etc/arkvory/smb.credentials,uid=$(id -u arkvory),gid=$(id -g arkvory),file_mode=0600,dir_mode=0700,vers=3.1.1`. Файл с учётными данными должен иметь права 0600.
- **NFS.** Сопоставление владельцев должно оставлять файлы службе `arkvory`: `no_root_squash` на экспорте либо один и тот же uid на сервере.
- **Монтирование при загрузке.** Запись в `/etc/fstab` с `_netdev` (для SMB ещё `nofail`, если NAS может быть недоступен). При обрыве NAS агент сообщает `vault_unavailable`. Пустую папку на месте отвалившегося монтирования он не примет за vault: идентификатор хранится в `vault.json`.
- **Свободное место.** Vault держит запас 1 ГиБ. Копия на почти полную сетевую папку завершается `vault_full`, а не повреждённой точкой.

На Windows vault размещают на локальном или iSCSI томе: LocalService не входит в общие папки SMB, UNC-пути отклоняются. Том NAS монтируйте до старта службы; если он смонтирован позже, перезапустите агента. Ручные команды Compose с настроенным vault включают `-f config/compose.vault.yml`, иначе `up` пересоздаст контейнер без vault (агент сообщит `vault_unavailable`). Обновление с 0.2.x, выполненное кодом старой версии (`manage.mjs update`/`upgrade`, планировщик), службу агента не регистрирует: после него выполните `arkvory updates-connect --root <root>`. Пакеты deb, rpm и exe регистрируют её сами.

Диагностика: `systemctl status arkvory-backup`, `journalctl -u arkvory-backup`; Windows — `Get-Service Arkvorybackup`, журналы `<root>/logs/arkvory-backup.*.log`; Compose — `logs backup`. Установка из исходников запускает `npm run backup -- agent` под supervisor оператора с тем же окружением, что у API, и с правом записи в vault.

Второй экземпляр безопасен: он ждёт в standby (`backup.agent.standby`) и берёт lease после остановки первого или истечения его lease. SIGTERM/SIGINT прерывают текущую фазу (копия — `interrupted`, pins освобождаются), задание возвращается в очередь, lease освобождается, код выхода 0. Потерянный lease (`backup.agent.lease_lost`) останавливает работу и возвращает агента в standby.

**Расписание и задания.** План один: `enabled`, `hour:minute` и явный IANA-пояс (`Europe/Moscow`, `UTC`); после миграции 26 он выключен (02:00 UTC, retention 7/4/6). Включение и изменение — `PUT /api/v1/backup/plan` с `expectedRevision` (409 `revision_mismatch` — перечитать план). Несуществующее местное время (перевод часов вперёд) выполняется в момент перехода, повторяющееся — один раз, при первом наступлении. После простоя агента выполняется одна догоняющая копия; слоты до изменения расписания не догоняются. Копия сейчас — `arkvoryctl backup run` или `POST /api/v1/backup/runs`; каждая копия запускает структурную проверку новой точки и retention отдельными заданиями, глубокая проверка новейшей точки — раз в 7 дней. Задание, прерванное остановкой или конкуренцией (`busy`), повторяется до 5 раз. Состояние — `arkvoryctl backup status|jobs|points`.

**Retention.** Сохраняются новейшие точки последних N местных дней, недель ISO и месяцев пояса плана (по умолчанию 7/4/6, группы объединяются), закреплённые (`arkvoryctl backup pin <id>`, снятие `--off`) и новейшая точка; минимум одна точка остаётся всегда. Точки с ошибкой проверки и точки другого источника в том же vault не удаляются. `GET /api/v1/backup/retention/preview` показывает решение до применения. Apply сначала отмечает точку в каталоге, затем удаляет `COMMITTED` и её каталог, затем prune удаляет blob, которых нет ни в одной оставшейся точке, и остатки попыток. Повреждённая точка в vault (каталог без `COMMITTED` или неверный manifest) останавливает prune с `invalid_manifest`: оставьте vault как есть, выясните причину, затем уберите повреждённый каталог вручную. Retention и prune не идут одновременно с копией или проверкой агента (блокировка 18471/21); `verify` CLI без подключения к БД блокировку не берёт — не запускайте его во время retention.

**Предупреждения** (`GET /api/v1/backup/status`, `arkvoryctl backup status`; при critical CLI выходит с кодом 9):

| Код                    | Уровень  | Действие                                                                    |
| ---------------------- | -------- | --------------------------------------------------------------------------- |
| `vault_not_configured` | warning  | Задать `ARKVORY_BACKUP_VAULT` агенту и перезапустить службу                 |
| `agent_offline`        | critical | Нет heartbeat 2 минуты или агент остановлен: запустить службу               |
| `schedule_disabled`    | warning  | Включить план, если копии нужны по расписанию                               |
| `no_backup_yet`        | warning  | Выполнить первую копию                                                      |
| `backup_stale`         | critical | T новейшей точки старше 26 ч при включённом плане: смотреть `jobs` и журнал |
| `last_run_failed`      | warning  | Последняя завершённая копия неуспешна: `errorCode` в `backup jobs`          |
| `vault_unavailable`    | critical | Том vault не смонтирован, нет `vault.json` или в vault нельзя записать      |
| `vault_low_space`      | warning  | Меньше 10% или меньше двух «новых байт» последней точки: освободить место   |
| `verify_failed`        | critical | Точка не прошла проверку: vault не менять, разобрать причину                |
| `never_deep_verified`  | warning  | Нет глубокой проверки 8 дней: проверить работу агента                       |

**Журнал агента** (`component: backup`): `backup.agent.started|standby|lease_acquired|lease_lost|stopped|failed`, `backup.request.started|done|failed|requeued` (`jobId`, `kind`, `errorCode`), `backup.schedule.due`, `backup.phase`, `backup.retention.applied` (`forgotten`, `blobs`, `freedBytes`), `backup.catalog.reconciled`. Путей, URL и секретов нет.

**Метрики и оповещения.** `GET /health/metrics` API (данные из БД, кэш 5 с): `arkvory_backup_last_success_timestamp_seconds` (T новейшей точки), `arkvory_backup_agent_last_seen_timestamp_seconds`, `arkvory_backup_warnings{code}` (1 — активно). Правила `ArkvoryBackupStale`, `ArkvoryBackupAgentOffline`, `ArkvoryBackupWarning` — в [deploy/monitoring/arkvory-alerts.yml](../deploy/monitoring/arkvory-alerts.yml).

## Webhooks

Решение — [ADR 0069](adr/0069-webhooks-over-change-feed.md). Worker доставляет события ленты изменений репозитория (`GET R/changes`) получателю POST-запросом; опрос ленты остаётся поддерживаемым способом.

**Настройка.** Файл `ARKVORY_WEBHOOKS_FILE` (абсолютный путь) читает worker при запуске; неверный файл останавливает запуск (`worker.unavailable`). Формат: `{"webhooks": [{"id": "ci", "repository": "releases", "url": "https://ci.example.com/hooks/arkvory", "secretFile": "/opt/proanima-arkvory/config/webhooks/ci.secret", "nextSecretFile": "...", "actions": ["artifact.publish"]}]}`. До 16 подписок; `nextSecretFile` и `actions` необязательны. Секрет — не короче 16 байт, отдельный файл с правами учётной записи службы (как ключ зеркала), содержимое в журнал не попадает. Обычный путь — `arkvory configure --root <root> --webhook <id> --webhook-repository <repo> --webhook-url <url> --webhook-secret-file <file>` (необязательно `--webhook-next-secret-file`, `--webhook-actions`, `--webhook-allow-private`, `--webhook-ca-file`) или `--webhook-detach <id>`: команда проверяет ввод, копирует секрет в `config/webhooks`, пишет файл подписок и переменные в `config/runtime.json`, для Compose монтирует каталог в worker, перезапускает службы и при сбое возвращает прежнее состояние. Удалённая подписка забывается при запуске worker. Файл можно написать и вручную.

| Переменная                       | Значение                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_WEBHOOKS_FILE`          | JSON-файл подписок; без него вебхуков нет                                                                                          |
| `ARKVORY_WEBHOOKS_ALLOW_PRIVATE` | CIDR через запятую (до 32), которые разрешены как получатели помимо публичных адресов, например `10.20.0.0/16`; по умолчанию пусто |
| `ARKVORY_WEBHOOKS_CA_FILE`       | PEM с дополнительными УЦ для получателей; проверка сертификата не отключается                                                      |

**Поведение.** Новая подписка получает только события после создания (первый шаг записывает `head`). События идут по одному в порядке ленты; курсор сдвигается только после ответа 2xx (at-least-once; повтор имеет тот же `id = <repository>:<sequence>`). Неудача: пауза 12 с, удвоение до 1 часа; недоступный получатель не задерживает загрузки и другие подписки. Заголовки: `X-Arkvory-Delivery`, `X-Arkvory-Event`, `X-Arkvory-Timestamp`, `X-Arkvory-Signature: sha256=<HMAC-SHA256(secret, "<timestamp>.<body>")>`; при ротации (`nextSecretFile`) подписей две. Тело — `{id, repository, sequence, action, artifactId, detail}`. Таймаут 10 с, 3xx — неудача, ответ читается до 4 KiB. SSRF: loopback, private, link-local, metadata и зарезервированные адреса запрещены (HTTP — только для loopback-имён), соединение идёт на проверенный IP.

**Диагностика.** Строки `webhook.started`, `webhook.step_failed` (`subscription`, `errorCode`: `blocked`, `timeout`, `network`, `tls`, `redirect`, `http_4xx`, `http_5xx`, `secret`; `attempts`), `webhook.recovered`; метрики `arkvory_webhook_failing`, `arkvory_webhook_last_success_timestamp_seconds`; оповещение `ArkvoryWebhookFailing`. Таблица `arkvory_webhook_state` входит в резервную копию.

## Зеркала репозиториев

Зеркало — отдельная установка Arkvory, в которой один или несколько репозиториев объявлены зеркалами репозиториев другой установки (главной). Решение: [ADR 0058](adr/0058-pull-mirrors.md). Worker зеркала сам забирает изменения с главного по HTTPS ключом только для чтения и копирует:

- опубликованные артефакты с их байтами и теми же ID;
- аннотации (метки, метаданные, коллекции);
- регистрацию UPack, стадии и текущие пути файлов;
- удаления;
- индексы реестров рядом с артефактами: образы контейнеров (`oci.*`), объекты Git LFS (`lfs.object`) и версии/теги npm-пакетов (`npm.*`) — после засева зеркало проходит ленту с начала и до головы засева применяет к своему индексу только эти записи ([ADR 0063](adr/0063-oci-registry.md), [ADR 0065](adr/0065-git-lfs.md), [ADR 0066](adr/0066-npm-registry-for-unity.md)); блокировки LFS не переносятся.

Скачивание по ID, по пакету (версия, диапазон, стадия) и по пути файла на зеркале отвечает так же, как на главном на момент синхронизации, и продолжает работать, когда главный недоступен. Записывать в зеркальный репозиторий клиенты не могут: загрузки, аннотации, пути, стадии, удаление и продвижение в него получают 409 с причиной `mirror_read_only`. Остальные репозитории той же установки работают как обычно.

**На главном.** Нужна версия с возможностью `mirrorFeed` (`GET /api/v1/capabilities`). Создайте сервисный аккаунт и ключ только для чтения нужного репозитория: `artifact.list`, `artifact.read`, `content.read`, `annotation.read`, `asset.read`, `package.read`. Ключ записи зеркалу не нужен. Лента изменений — `GET /api/v1/repositories/{r}/changes` ([API_MAP](API_MAP.md)).

**На зеркале.** Используйте новый пустой репозиторий: зеркало приводит его к главному, но не удаляет то, чего на главном никогда не было. В установке зеркало подключает одна команда (от root или администратора, для Compose — от владельца установки):

```sh
sudo arkvory configure --root /opt/proanima-arkvory --mirror releases   --mirror-upstream https://arkvory.example --mirror-token-file /root/mirror-releases.key
sudo arkvory configure --root /opt/proanima-arkvory --mirror-detach releases
```

Порядок работы команды:

1. Проверяет главный с этим ключом до любых изменений: `GET /api/v1/capabilities` должен сообщать `mirrorFeed`, а `GET …/changes?limit=1` для исходного репозитория (`--mirror-source`, по умолчанию то же имя) — отвечать 200.
2. Копирует ключ в `config/mirrors/<repository>.token` и записывает `config/mirrors/mirrors.json` и `ARKVORY_MIRRORS_FILE`. Права файлов как у `runtime.json`: `root:arkvory` 0640 для systemd, наследуемые ACL на Windows. Для Compose файлы видны пользователю контейнера, каталог установки остаётся закрытым, а монтирование в API и worker добавляет `config/compose.mirrors.yml`.
3. Перезапускает API и worker и ждёт готовности; при ошибке возвращает прежние файлы.

Повторный вызов с новым `--mirror-token-file` заменяет ключ. Другой источник для того же репозитория команда отклоняет: сначала нужно отсоединить зеркало. Установка из исходников использует тот же файл `ARKVORY_MIRRORS_FILE`; его читают и API, и worker:

```json
{
  "mirrors": [
    {
      "repository": "releases",
      "upstream": "https://arkvory.example",
      "sourceRepository": "releases",
      "tokenFile": "/etc/arkvory/mirror-releases.token"
    }
  ]
}
```

- `upstream` — только origin HTTPS, без пути и учётных данных; HTTP допускается лишь для этого хоста (тесты, локальный TLS-proxy).
- Файл ключа доступен только учётной записи службы. Worker перечитывает его после каждой ошибки, поэтому новый ключ подхватывается без перезапуска.
- Корпоративный или самоподписанный сертификат главного: `--mirror-ca-file /path/ca.pem` вместе с `--mirror`. Сертификаты из файла проверяются (читаются и не просрочены) и сохраняются в `config/mirrors/ca.pem`. Worker и проверка установщика доверяют им наравне со стандартными (`ARKVORY_MIRRORS_CA_FILE` в runtime.json), так что это работает в любом режиме установки. Файл общий для всех зеркал установки: новый `--mirror-ca-file` его заменяет, отсоединение последнего зеркала удаляет. Проверка TLS не отключается.
- После изменения файла перезапустите API и worker.

**Синхронизация** идёт в worker, отдельной службы нет:

1. Первое заполнение: worker запоминает голову ленты, затем постранично проходит артефакты, пакеты и пути.
2. Затем worker следует ленте: проверка раз в 10 с, курсор сохраняется после каждого применённого события.
3. Файлы копируются частями с проверкой SHA-256 части и всего файла; после обрыва копирование продолжается с первой отсутствующей части. Временная часть лежит в `<ARKVORY_DATA_DIR>/mirror-staging`, размер — одна часть.
4. После ошибки шаг повторяется с паузой от 2 с до 5 минут. Журнал (`component: mirror`): `mirror.started`, `mirror.step_failed` (с `errorCode` и `attempts`), `mirror.recovered`, `mirror.stopped`.

**Состояние** — `GET /api/v1/repositories/{r}/mirror` (SDK `repositoryMirror`, право `repository.read`):

- `phase`: `pending`, `seeding` или `following`;
- `caughtUp`: курсор совпадает с последней увиденной головой ленты;
- `syncedAt`, `checkedAt` — время;
- `errorCode`: `mirror_mismatch` (тот же ID с другим SHA-256 — файл не перезаписывается, нужен разбор), `mirror_source_changed` (репозиторий уже держит копию другого источника: зеркальте новый источник в новый репозиторий), `mirror_source_behind` (главный восстановлен или переустановлен: идёт повторный засев, код снимается после догоняния), `mirror_upload_cancelled` (выпуски до 0.4: копию удалили здесь; теперь такая копия пропускается), `mirror_delete_blocked`, `mirror_failed` или код ошибки главного;
- `copiedArtifacts` и `copiedBytes`.

Для обычного репозитория маршрут отвечает 404. Консоль показывает над каталогом значок «Зеркало». Его цвет зависит от состояния, а источник и время синхронизации видны в подсказке. Кнопок записи в зеркале консоль не показывает, потому что обнаружение операций не предлагает изменений зеркального репозитория.

**Ограничения:**

- Не копируются ссылки удержания (references), вложения (attachments), журналы аудита, политики хранения и история путей до первой синхронизации. Образы контейнеров копируются в режиме зеркала, но не в режиме импорта.
- Политики хранения в зеркальном репозитории не выполняются (последний результат — `conflict`).
- Номера ревизий аннотаций и путей на зеркале свои.
- Пользователи, ключи и права зеркала свои: отзыв ключа на главном на зеркало не действует.
- Зеркало не является резервной копией установки.

**Импорт по стадии (dev → prod).** С `--mirror-stages release` репозиторий на prod становится не зеркалом, а обычным репозиторием, который забирает с dev версии, получившие стадию `release`; применяются только события `stage.add` настроенных стадий, а индексы реестров (образы, объекты LFS, npm) в этом режиме не переносятся. Версия переносится один раз: тот же ID и байты, аннотации, регистрация UPack и стадия. Дальше она принадлежит prod:

- очистка, снятие стадии и удаление на dev её не затрагивают;
- версия, удалённая на prod, повторно не приходит;
- загрузки и своя политика хранения на prod работают как обычно.

Консоль показывает значок «Импорт» с источником и стадиями в подсказке. Смена стадий тем же `configure` запускает новое первое заполнение. Для ключа dev нужны те же права только для чтения, что и для зеркала.

**Переход на зеркало при потере главного:** `arkvory configure --mirror-detach <repository>` (или удалите запись из `ARKVORY_MIRRORS_FILE` и перезапустите API и worker). Репозиторий станет обычным и доступным для записи, ID и данные сохранятся; потеряны изменения, которые зеркало ещё не забрало. Обратного присоединения нет: такой репозиторий нельзя снова сделать зеркалом.

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

Перед обновлением остановить writer, readers и worker, сделать согласованный backup, выполнить `npm run migrate`, запустить новый код (схема — поле `schema` в `arkvory-release.json` релиза). Standalone остаётся настройкой по умолчанию. Роль reader, общий storage, slots/rates, lease expiry, маршрутизация и offline-смена policy описаны в [READ_GATEWAYS](READ_GATEWAYS.md). Установщики регистрируют службами только `api`, `worker` и `backup`; reader-шлюз оператор запускает сам, например `node releases/<версия>/apps/api/dist/main.js` с собственным окружением (`ARKVORY_ROLE=reader`, `ARKVORY_GATEWAY_SLOT`, свой `ARKVORY_PORT`). Launcher установленных служб (`runRole`) накладывает `config/runtime.json` поверх окружения процесса, поэтому ключи, заданные там (в том числе `ARKVORY_PORT`), нельзя переопределить переменными unit-файла: отдельный порт у процесса, запускаемого через launcher, так не получить. Не подключайте произвольный сетевой share или асинхронную копию: конкретный backend сначала должен пройти проверку публикации и согласованного чтения.

Readiness и startup проверяют завершение миграций 8 (индексы), 9 (сервисные аккаунты/ключи), 10 (делегирование) и 11 (индекс страниц assets). Индексная миграция использует отдельный advisory lock 18471/9 и не занимает блокировку резервирования upload 18471/2. Лимит 128 HTTP-запросов применяется до поиска пользовательской сессии в БД. Все HTTP-операции с паролями (вход, создание, административный сброс и собственная смена) делят допуск: 2 активных, 16 ожидающих, ожидание до 1 секунды. В БД сериализованы добавления identity-записей: максимум 1000 пользователей, 100 групп, 10 000 memberships и 10 000 grants; повтор существующей связи и изменение её прав допускаются на границе лимита.

Перед использованием вложений выполните `npm run migrate`: новые API-процессы требуют миграцию 12. Она добавляет таблицы ревизий и ссылок, не переписывая blobs/annotations. На старых узлах capability `buildAttachments` отсутствует. Сначала миграция, затем обновление API/SDK/UI. [Контракт](BUILD_DETAILS.md).
