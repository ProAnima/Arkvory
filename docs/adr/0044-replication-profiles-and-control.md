# ADR 0044: переносимые зеркала и отдельный HA-профиль

Статус: **proposed**. Дата: 2026-09-26. Runtime этим документом не добавлен.

## Причина

Существующий reader требует общий согласованный root и primary PostgreSQL. Два независимых диска, копирование storage-id и heartbeat не выполняют запрос владельца на репликацию. Одновременно продукт ориентирован на Windows/Linux, а конкретная инфраструктура HA и политика подтверждения ещё не выбраны.

## Предлагаемое решение

Первый переносимый профиль — асинхронное зеркало опубликованных immutable artifacts. Собственные node/volume identities, bounded copy/resume, durable receipts, ordered outbox и pins, защищающие данные от обоих GC. Каталог и ACL остаются на primary; read gateway получает ограниченные свежие grants. Mirror не становится writer и не считается самостоятельной резервной копией установки.

Control API обслуживает web/CLI/интеграции одинаково. Privileged installer и future fencing provider отделены от public API; node protocol — mTLS с ограниченными capabilities. UI различает состояние сети, копирования, раздачи и допустимость cutover; недоступный backend не заменяется заглушкой.

Синхронный HA — отдельный профиль на проверенной инфраструктуре. Для Linux рассматривается replicated volume + внешний fencing; PostgreSQL и bytes/parts участвуют в едином подтверждении. Нет собственного leader election, multi-master или автоматического повышения app mirror. Принятие конкретного HA-профиля требует выбора ОС/backend/fencing и испытаний.

## Последствия

Появятся новые миграции outbox/pins/receipts и отдельная supervised worker role; они реализуются только вместе с завершёнными сценариями. Global journal commit ordering может стать точкой сериализации и измеряется. GC учитывает durable obligations и backlog pressure. Независимые зеркала нельзя подключить через действующий reader flag. Доступность чтения первого профиля зависит от authority primary; для автономного чтения понадобится отдельное решение о каталоге и отзыве прав.

## Отклонённые сокращения

Копирование живых PGDATA/blob каталогов, повышение узла по тайм-ауту, удаление pins по TTL, `max(BIGSERIAL)` как commit cursor, перенос администратора/root key в зеркало, возврат «готово» по heartbeat и обещание RPO=0 только на основании SHA-256.

## Приёмка

[REPLICATION](../REPLICATION.md) задаёт R1–R6 и отказные сценарии; [API](../REPLICATION_API.md) и [UX](../REPLICATION_UX.md) фиксируют границы управления. До реализации и локальной/стендовой приёмки не менять README status на implemented. Ответы владельца о первом режиме и ОС могут изменить порядок этапов, но не отменяют fencing/ACK/GC инварианты.
