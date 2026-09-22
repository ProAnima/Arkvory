# 0005. Multipart, каталог, worker и offline обслуживание

Статус: accepted для standalone-профиля. Дата: 2026-09-22.

Контекст: продолжение больших загрузок, редактирование каталога, ограниченные очереди и возврат занятого места нужны до миграции и кластера.

Решение: части 8 MiB с неизменяемым хешем, PostgreSQL как журнал подтверждений, тот же upload advisory lock для частей/сборки/отмены. Финальная публикация только после полного SHA-256. Pending TTL 7 дней. Completion worker использует leases/generation и повторяемый complete. Локальные HTTP-очереди ограничены и чередуют клиентов; не являются распределённым scheduler.

Редактируемые annotations отделены от descriptor, CAS revision защищает правки. UPack identity неизменяема и не зависит от имени blob. Assets — ревизионные указатели. Аудит каталога фиксируется в транзакции; references принадлежат principal. ZIP читается без распаковки с ограничениями.

GC и scrub выполняются offline. API и worker держат shared maintenance barrier, maintenance — exclusive; worker дополнительно singleton. Оператор останавливает автоматический запуск служб на весь период, включая разрыв связи БД. GC удаляет bytes прежде освобождения reservation, сохраняет tombstones и available blobs. Online GC/retention неизвестных orphan-файлов не заявлены.

Следствия: дополнительный дисковый объём под части и сборку; окно простоя на обслуживание; один writer; нет claim о HA. SDK portable fetch + проверка ответов, UI через SDK, hash в Web Worker. Миграция 3 требует остановки старых processes при первом переходе на новый barrier. Подробности и пределы — [runbook 0.2](../LIFECYCLE_AND_CATALOG.md).
