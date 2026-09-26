# 0037 — Согласованные копии и независимое восстановление

Дата: 2026-09-26. Статус: **proposed**, до B0 spike и приёмки протокола. Владелец: Ian Panaev.

## Проблема

Online GC может уничтожить blob, ещё необходимый копии БД. Снимок файловой системы сам по себе не задаёт один snapshot PostgreSQL. Работающий writer продолжает публикации, а перенос 4 ТБ занимает часы. Исходный API и его БД могут быть утрачены именно в момент, когда необходим restore. UI не должен выдавать наличие backup-файла за проверенную восстанавливаемость.

## Предлагаемое решение

Согласованная точка T: PostgreSQL exported snapshot для dump/inventory, короткий durable barrier допуска unlink, постоянные pins всего набора T, затем копирование immutable blobs вне SQL snapshot. GC и offline repair должны соблюдать единый backup protocol. Expiry lease не освобождает pins без fencing/reconciliation. Версионированный manifest хранится в backup vault и позволяет найти/проверить точку без source DB.

Предлагается mature engine restic для encrypted/deduplicated vault за узким адаптером; Arkvory отвечает за согласованность, доступ, жизненный цикл и UX. Не обещать WORM у каждого S3 backend или byte-exact resume движка. Engine/version/license/provenance и backend compatibility проверяются в B0.

Исполнение отделяется от HTTP и transfer worker в локальный supervised backup agent. Новый composition root добавляется вместе с первым use case и allowlist; приложение deploy устанавливает его, но не импортирует другие apps. Web/CLI используют SDK. Public API получает типизированные команды и opaque secret refs, не shell, произвольные paths или plaintext credentials в ответах.

Restore сначала выполняется в новую изолированную цель, с проверкой содержимого и нормализацией ephemeral jobs, ownership, credentials и расписаний. Production cutover отделён от готовности восстановленного экземпляра. При потере source используется локальная recovery-точка входа, адрес vault и отдельно сохранённый recovery key.

## Границы

Первый переносимый профиль не является PostgreSQL PITR. Он сохраняет опубликованные данные на T; незавершённые transfers требуют повторного запуска. Бэкап не заменяет replication/fencing, а restore не гарантирует нулевой простой. Прежние отозванные после T credentials не активируются автоматически. Смена схемы требует отдельного совместимого restore transformer и регрессий.

Состояния UI «завершена», «байты проверены» и «пробное восстановление прошло» раздельны. Возраст вычисляется от T, а не от окончания копирования. Неудачный backup и переполнение не удаляют последнюю завершённую точку.

## Альтернативы

- Копировать working PGDATA и storage root: нет гарантии согласованности; отклонено.
- Остановить все службы на время 4 ТБ: может быть аварийной ручной процедурой, но не штатным UX.
- Удерживать одну SQL snapshot-транзакцию все часы передачи: неоправданный MVCC pressure; snapshot закрывается после capture.
- Положиться только на grace GC: зависит от длительности backup и не защищает от ручной очистки.
- Собственный encrypted chunk store: слишком большой криптографический/операционный объём для текущей задачи без подтверждённой необходимости.

Полный протокол, отказы, API и этапы: [BACKUP_RECOVERY](../BACKUP_RECOVERY.md). Интерфейс: [BACKUP_UX](../BACKUP_UX.md). Код backup/restore этим ADR не объявляется реализованным.
