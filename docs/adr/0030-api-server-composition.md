# ADR 0030 — Завершение декомпозиции сборки API

Статус: принято. Дата: 2026-09-25.

## Причина

После выделения upload-маршрутов server.ts всё ещё содержал 649 строк кода, createServer — 598. Авторизация, диагностика, фоновые задачи, очередь, раздача и владение БД изменялись в одной функции. Исключения ARCH-016/017 сохраняли этот долг, а ошибка настройки HTTP после захвата БД могла оставить открытые pools и диагностические listeners.

## Разделение ответственности

| Модуль                                            | Обязанность                                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| server                                            | Порядок сборки, связывание компонентов, общий rollback при ошибке                            |
| api-runtime                                       | Владение каталогом, blob-store и download lease; startup, остановка и идемпотентное закрытие |
| api-services                                      | Создание application-сценариев и их адаптеров; без HTTP-обработчиков                         |
| api-routes                                        | Явное связывание сценариев с регистраторами; без SQL, авторизации и бизнес-логики            |
| http-server                                       | Параметры Fastify и потоковый octet-stream parser                                            |
| request-context                                   | Состояние запроса, Principal, AbortSignal, request admission и код ошибки                    |
| request-security / http-errors                    | Аутентификация и reader boundary; перевод ошибок в HTTP                                      |
| transfer-controls / upload-admission              | Сборка bounded admission/bandwidth и освобождение допуска mutations                          |
| artifact-routes / download-routes / health-routes | Каталог артефактов, общий sender содержимого и live/ready                                    |
| response-diagnostics / background-tasks           | Bounded очередь событий, безопасные логи, timers и завершение фоновой работы                 |

Upload/session/completion сохраняют отдельные модули из ADR 0029. Пакеты и направление зависимостей не меняются. Все новые модули относятся к HTTP/composition слою apps/api. Application/domain не получают Fastify, process.env или timers. В регистраторах используются узкие типизированные зависимости. Полная композиция доступна только функциям связывания, не передаётся каждому обработчику и не является глобальным service locator.

## Порядок и инварианты

1. Проверка политики upload и локальных ресурсных лимитов, создание runtime и HTTP-сервера.
2. Инициализация blob-store, проверка схемы БД, storage ownership, запуск reader/writer lease.
3. Сборка сценариев и request context. Contract guard регистрируется до маршрутов и до фоновых onReady задач.
4. CORS, diagnostics, request admission перед асинхронной аутентификацией, live authority и reader restrictions, обработка ошибок, маршруты.
5. Readiness/listen остаются в прежнем Fastify lifecycle; контрактный guard выполняется до запуска фоновых timers. Возврат Fastify thenable ожидается внутри try, чтобы ошибка загрузки plugins также попала в rollback.
6. PreClose сначала закрывает admission/governors и lease, затем дожидается maintenance и текущей записи диагностики, выполняет один последний bounded batch. БД остаётся доступной фоновым операциям до onClose.
7. OnClose освобождает ownership и pools. Повторное закрытие из startup rollback/onClose возвращает один Promise; pool.end не вызывается повторно.

Ошибки регистрации после старта runtime также проходят cleanup. Сохранены request cancellation, безопасные request IDs, private/no-store, точные repository ACL, pending-key activation, reader 405, GET/HEAD содержимого, Range/ETag/304/416, byte/admission limits и upload deadline. Схема БД, 123 API operationId и SDK-контракты не меняются.

ARKVORY_WEB_DIR теперь читается только loadConfig и передаётся как ServerConfig.webDirectory. Программный createServer использует явное поле либо apps/web/public; скрытого чтения глобального окружения в сервере нет. CLI сохраняет прежнюю настройку окружения.

## Проверка и границы

ARCH-016/017 удалены: server.ts — 84 строки кода, createServer — 67 (AST, без пустых строк и комментариев). Новые модули укладываются в общие 500/300/100; остаются 24 других ранее зафиксированных исключения. Декомпозиция PostgreSQL-адаптеров и крупных feature registrars — отдельные пункты аудита.

Новые PostgreSQL/HTTP-регрессии проверяют ошибку сборки после ownership, ошибку частичного startup, отсутствие потерянных stdout listeners, повторное закрытие/запуск и явную конфигурацию консоли. Прежние тесты защищают весь route inventory, auth/reader, диагностику, shutdown, отмену и восстановление передач. Приёмка проходит через quick/release и CI, включая 5 GiB; фактические результаты фиксируются в CORE_VALIDATION. Новых гарантий HA это решение не даёт.
