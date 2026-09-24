# ADR 0021: Discovery логических репозиториев из текущих прав

Статус: accepted. Дата: 2026-09-24.

## Контекст

После постраничного файлового каталога интеграторам нужен список доступных repository IDs и их возможностей. `/auth/me` отражает legacy grants, а managed keys используют отдельные точные actions. Глобальная сущность repository с настройками и lifecycle в текущем storage отсутствует; любой допустимый ID выступает логической областью каталога.

## Решение

Добавить GET/HEAD списка и карточки репозитория. Карточка — projection доступной области из текущего Principal: id, поддерживаемые форматы upack/assets и собственные permissions. Счётчики и чужие настройки отсутствуют. Пустая, но явно разрешённая область видна, чужая существующая — нет. Это не реестр созданных feeds.

Добавить `repository.read` как отдельное exact repository action. Для managed identity discovery требует его в пересечении account/key policies; data actions и admin grants его не подразумевают. Все прежние use cases сохраняют собственные authorize checks. Для legacy identities список повторяет собственные непустые scopes; прежний `/auth/permissions` не расширяет frozen mapping новым именем. Group access=write и file-key write сохраняют прежнее различие.

Application выполняет чистое объединение/фильтрацию разрешённых карточек перед LIMIT и keyset after; domain задаёт action и инварианты bindings. Явный coarse mapping вынесен из transport в application и агрегирует grants за линейный проход. RepositoryStore и новая таблица не нужны до появления реально сохраняемых настроек. Auth adapters уже предоставляют authoritative bounded context на каждый запрос. Contracts и SDK не импортируют Principal.

## Последствия

API даёт ограниченный directory и карточки без глобального сканирования storage или N+1 SQL. Права после cursor меняются немедленно для нового запроса; страницам не обещается snapshot. Прямой доступ к скрытой/неизвестной области — одинаковый 404. Discovery не предоставляет bytes, создание репозитория или право обходить reader restriction.

Миграция БД не требуется, схема 11 сохраняется. Сначала обновляются runtime/SDK, потом выдаётся новое имя permission: старый parser не обязан понимать расширенный enum. Downgrade с новой policy требует явной подготовки; прежние ключи автоматически не меняются. OpenAPI document 0.6.0 описывает 101 операцию, включая четыре новые GET/HEAD, и отдельную repository-discovery access metadata.

Полный persistent registry с display names/configuration, selectors и upload intent отложен. Альтернатива выводить список из существующих artifacts отклонена: она скрыла бы пустые разрешённые области, требовала бы глобальной выборки и смешала бы наличие данных с правами клиента.

## Проверки

Пагинация и filtering до LIMIT, merge bindings только одного repo, отсутствие admin/data escalation, preservation legacy mapping, 10 000 grants, HTTP/SDK/schema/HEAD, policy/revoke/expiry/rotation, пользовательские группы и reader. Эксплуатационный контракт: [REPOSITORY_DISCOVERY](../REPOSITORY_DISCOVERY.md).
