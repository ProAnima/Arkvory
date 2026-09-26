# ADR 0023: области API и каталог применимых операций

Статус: принято, 2026-09-25.

## Контекст

Интеграции, CI/CD и удалённый интерфейс используют общий native API. Действующие права детальны, но статическая OpenAPI не говорит, какие действия подходят текущему credential и шлюзу. SDK предоставляет большинство сценариев плоскими методами.

## Решение

Классифицировать весь контракт по независимым surface и visibility. Сохранить URL, operationId, существующие права и flat SDK. Добавить authenticated GET/HEAD `/api/v1/operations`, bounded pagination, repo/surface filters и явный advisory результат. Представления `openapi.json?surface=…` остаются полной документацией выбранной области, не ACL-фильтром.

Contracts владеет transport-схемами и классификацией registry. Application содержит чистую проекцию применимости по principal/actions/delegations и использует существующий authorizer; она не принимает HTTP paths и не разрешает рабочие запросы. API адаптирует metadata и свежий principal, читает собственные delegations и применяет gateway-role filter. Нет нового хранилища прав и нет permission cache.

SDK добавляет immutable responsibility namespaces, делегирующие существующему клиенту: `identity`, `administration`, `inRepository`. Они не фиксируют credential и не обходят общий транспорт/авторизацию.

Общая прежняя реализация запросов находится в конкретном `ArkvoryTransport`. Публичный `ArkvoryClient` сохраняет её методы и конструктор, добавляя фасады. Типы фасадов зависят от узких Pick транспортных методов, а не от публичного клиента: нет циклических runtime или type-only зависимостей. В транспорте не переопределяются сценарии ради facade.

## Гарантии и ограничения

Фильтрация до LIMIT; чужой repository context — 404; отсутствие repository не подразумевает все ресурсы. Reader исключает mutations. Отдельные admin actions, bootstrap и data permissions не наследуются друг от друга. Owner, объект, CAS, квоты и delegation target проверяются при настоящем вызове; conditions сообщают о дополнительных ограничениях. Видимость операции не является обещанием успешного действия.

Не вводятся распределённый scheduler, новый API gateway, SSO, tenant isolation или физическое разделение процессов. Подробности и следующие области: [API_SURFACES](../API_SURFACES.md). БД остаётся на миграции 11, документ OpenAPI — 0.7.0.
