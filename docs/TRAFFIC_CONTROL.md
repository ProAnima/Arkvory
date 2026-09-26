# Сетевые квоты и очереди шлюза

В каждом процессе API реализован локальный исполнитель бюджета. Для каждой передачи действуют общий допуск, предел активных передач клиента и два ограничения payload-скорости: на всё направление и на клиента. Ключи с одинаковым id делят состояние между всеми репозиториями и соединениями. В standalone бюджет относится к одному процессу. Дополнительный профиль [READ_GATEWAYS](READ_GATEWAYS.md) распределяет фиксированные доли общего download-бюджета через конечные PostgreSQL leases; балансировщик запросов остаётся внешним. Решение: [ADR 0008](adr/0008-gateway-bandwidth-budgets.md).

## Настройка

| Переменная                                      | По умолчанию         | Значение                                   |
| ----------------------------------------------- | -------------------- | ------------------------------------------ |
| ARKVORY_MAX_UPLOADS                             | 2                    | Активные изменяющие upload-сценарии, 1..32 |
| ARKVORY_MAX_DOWNLOADS                           | 16                   | Активные downloads, 1..256                 |
| ARKVORY_MAX_UPLOADS_PER_PRINCIPAL               | 1                    | Не больше ARKVORY_MAX_UPLOADS              |
| ARKVORY_MAX_DOWNLOADS_PER_PRINCIPAL             | min(4, maxDownloads) | Не больше ARKVORY_MAX_DOWNLOADS            |
| ARKVORY_UPLOAD_BYTES_PER_SECOND                 | 0                    | Общая скорость приёма payload              |
| ARKVORY_DOWNLOAD_BYTES_PER_SECOND               | 0                    | Общая скорость выдачи payload              |
| ARKVORY_UPLOAD_BYTES_PER_SECOND_PER_PRINCIPAL   | 0                    | Приём от одного клиента суммарно           |
| ARKVORY_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL | 0                    | Выдача одному клиенту суммарно             |

Rate задаётся целым числом bytes/s: 0 отключает соответствующий ceiling, иначе допустимы 65 536..1 099 511 627 776. Ошибочная конфигурация отклоняется при старте. Пример ограничения шлюза 64 MiB/s и каждого клиента 16 MiB/s в каждом направлении:

```dotenv
ARKVORY_UPLOAD_BYTES_PER_SECOND=67108864
ARKVORY_DOWNLOAD_BYTES_PER_SECOND=67108864
ARKVORY_UPLOAD_BYTES_PER_SECOND_PER_PRINCIPAL=16777216
ARKVORY_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL=16777216
```

Это пример, а не рекомендуемая ёмкость вашей сети. Общая полоса загрузки и скачивания независима; если uplink/диск разделяются, выбирайте оба бюджета с учётом суммарной нагрузки и резерва replication/служебного трафика. Изменение конфигурации требует перезапуска. Старые установки без rate variables остаются без ограничения bytes/s; новый default активных передач одного принципала применяется после обновления.

Один ключ не обязан соответствовать одному физическому клиенту: если все CI используют один id, они делят квоту и предел активных операций. Для разных потребителей назначайте разные id; для ротации ключа сохраняйте id, чтобы не удвоить лимит.

## Гарантии и границы

Лимит общий для всех потоков направления и для всех ключей одного id. Burst каждого включённого bucket — min(floor(rate / 10), 1 MiB), квант до 64 KiB. С момента полного bucket выдача ограничена rate × elapsed + burst. Ожидание не загружает весь файл в память. Подтверждение upload, SHA-256 и durable publication остаются в серверном storage-сценарии.

Full upload и multipart делят upload bucket. Native, Range и legacy UPack/assets делят download bucket. HEAD, 304 и отклонённый Range не расходуют byte budget. Metadata/health не ограничиваются байтовой очередью; глобальный предел 128 HTTP-запросов остаётся. Completion/register/cancel используют существующий upload admission, но без расхода сетевых bytes на локальную сборку. Повторно переданные после обрыва байты расходуют квоту повторно.

Admission ждёт до 20 секунд, держит до 64 ожидающих запросов направления и до 8 ожидающих от клиента; перегрузка возвращает 503/Retry-After. Квота bytes может ожидать дольше допуска: действуют AbortSignal, HTTP timeout и предел активных потоков. Подбирайте SDK attemptTimeoutMs под 8 MiB и худшую долю клиента; при множестве конкурентов стандартных 120 секунд может не хватать. Для медленных каналов используйте multipart; full HTTP upload ограничен 30 минутами серверного request timeout.

Pacing ограничивает выдачу/чтение payload приложением. TCP/proxy буфер может принять данные заранее; заголовки, TLS overhead и retransmissions не считаются. Для ограничения реального интерфейса и защиты от входящего flood нужны настройки сети/ОС. Reverse proxy должен передавать request/response потоково: полная буферизация на proxy скрывает backpressure от клиента. Приложение не меняет чужие proxy-настройки.

Состояние процесса сбрасывается при рестарте. Отмена после выдачи разрешения не возвращает bytes в bucket. Когда клиент читает медленнее лимита, свободная полоса доступна другим. Чередование по принципалам относится к готовым квантам; это не гарантированная минимальная доля или приоритетный scheduler. Потеря standalone DB ownership прерывает выдачу новых квантов; сервис требуется перезапустить.

## Диагностика

Авторизованный GET `/health/ready` содержит `transfers.uploads` и `transfers.downloads`:

- `admission.active`, `waiting`, `capacity`, `perPrincipalCapacity`;
- `admission.rejected` — отказы заполненной очереди, `timedOut` — истёкшее ожидание, `cancelled` — отменённые ожидающие запросы;
- `bandwidth.bytesPerSecond`, `perPrincipalBytesPerSecond`, `burstBytes`, `perPrincipalBurstBytes` — параметры, 0 означает отключённый потолок;
- `bandwidth.waiting` — ожидающие кванты, `grantedBytes` — десятичная строка счётчика разрешённых payload bytes.

Агрегаты доступны любому валидному сервисному ключу, как прежний readiness. Нет ID принципалов, путей, токенов и названий файлов. Счётчики относятся к одному процессу и обнуляются при его перезапуске. `grantedBytes` — разрешения, включая повторы/отменённые операции, а не доставленные или подтверждённые байты.

## Проверки

Unit tests с виртуальным монотонным временем проверяют математический предел shared/per-principal buckets, burst, чередование, множество соединений, отсутствие обхода через маленькие кванты, отмену, закрытие, bounded queue и backpressure. HTTP/PostgreSQL тесты проверяют одновременные full/multipart uploads, разные ключи одного клиента, независимый клиент, Range/legacy, диагностику, отмену очереди и preClose с активной передачей.

Большой профиль: `npm run gate -- large-multipart`, отдельная тестовая БД и ≥11 GiB свободного места. Он включает реальные 5 GiB, рестарты API, обрыв download, контроль hash/RSS и квоты 64 MiB/s на шлюз, 48 MiB/s на принципала. Отчёт сохраняется в ignored `test-results/large-traffic.json`. Межсерверная координация и HA этим тестом не проверяются.

Размер ожидающей очереди и timeout теперь настраиваются через ARKVORY_TRANSFER_QUEUE_LIMIT, ARKVORY_TRANSFER_QUEUE_PER_PRINCIPAL, ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS. Defaults прежние: 64/8/20000. Readiness дополнен waitingCapacity/perPrincipalWaitingCapacity/timeoutMs. Это пределы шлюза, отдельные от [клиентской очереди скачиваний](DOWNLOAD_QUEUE.md).

После допуска upload действует отдельное время ожидания данных отправителя: `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS=30000`. Оно не учитывает паузы bandwidth governor и backend. `ARKVORY_UPLOAD_DEADLINE_MS=1800000` ограничивает всю принятую операцию PUT/complete, включая обработку и публикацию; это не лимит всей multipart-сессии. Оба значения — целые 1..1800000, idle ≤ deadline. До допуска продолжают действовать обычные HTTP/queue ограничения. [Решение](adr/0029-upload-lifetime-and-exact-reads.md).
