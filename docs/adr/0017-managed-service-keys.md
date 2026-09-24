# ADR 0017: первый профиль управляемых сервисных ключей

Статус: accepted. Дата: 2026-09-24.

## Контекст

[ADR 0016](0016-service-access-and-api-evolution.md) задаёт широкую целевую модель. Нужен завершённый безопасный инкремент machine access, сохраняющий текущие file keys, чистые слои и publication fencing.

## Решение

Migration 9 добавляет стабильные сервисные аккаунты, hash-only credentials, audit и initiating credential в jobs. Ключи имеют pending activation, срок действия, идемпотентную выдачу без replay secret, ротацию и необратимый отзыв. Действуют 18 точных repository actions; account/key bindings пересекаются, coarse authorize для managed principal запрещён. Native, legacy и worker используют общие application rules.

Первое управление разрешено только явно назначенному file bootstrap `serviceAdministrator`, независимо от прежнего administrator. Делегируемые system/credential/policy actions пока не выдаются. Корневой оператор может назначать любые реализованные data permissions; новые ключи могут только сузить account policy, ротация — также права исходного key. Делегированное управление из ADR 0016 остаётся отдельным этапом.

На каждый новый request читается primary PostgreSQL. Короткая транзакция data mutation повторно проверяет policy/credential с shared row locks до commit; revoke/disable/policy update сериализуются с ней. Для bytes держится только прежний upload session lock, не identity row lock. Job исполняется по initiating credential; новый key может явно переавторизовать неработающее задание своего аккаунта.

Бюджет связан с аккаунтом, не key ID. Административные изменения сериализует отдельный lock 18471/12, чтобы count/insert, активация и retention не гонялись. Credentials ограничены 10 000 сохранённых записей, audit — последними 100 000 событиями; автоматическое архивирование ключей пока отсутствует. Эти пределы описаны оператору, не скрываются за бесконечной таблицей.

## Последствия

Новые requests требуют доступной authority; нет stale-cache fallback. Начатый download имеет прежнюю границу отзыва. Для существующих file identities не выполняется автоматический перенос ownership/секретов; новый managed account отдельный, а внутри него rotation сохраняет uploads/jobs/references. Reserved prefix dpk не обходит revoke через file fallback. Не включены folders/group selectors, HA, webhook, federation и UI управления ключами. Подробный [runbook](../SERVICE_KEYS.md) является текущим контрактом этого поднабора; остальная целевая модель остаётся proposed.

## Приёмка

Проверки прав/пересечения, concurrency, expiry/rotation, отказа stale publication, реального worker и reader входят в функциональные тесты. Старые сценарии native/legacy и миграции продолжают проверяться. Standalone/общий root не объявляется репликацией.
