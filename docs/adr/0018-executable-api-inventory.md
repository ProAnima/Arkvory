# ADR 0018: проверяемая инвентаризация API

Статус: accepted. Дата: 2026-09-24.

## Контекст

После managed service keys схема описывала 56 операций, но не legacy/liveness/spec endpoint и большинство автоматических HEAD. У прежних операций отсутствовали стабильные operationId и единое описание прав. Дальнейшее расширение создаёт риск расхождения runtime, документации и клиентов.

## Решение

В contracts хранится metadata каждой операции; composer связывает её с wire-схемами и формирует полную OpenAPI 3.0.3. operationId стабильны, permission names являются расширением `x-depot-authorization`, а не OAuth scopes. Авторизацию продолжают выполнять application и infrastructure; registry не становится вторым policy engine.

Fastify composition root собирает фактический inventory через onRoute и сверяет его с contracts в onReady. Проверка учитывает методы, path params, HEAD и legacy wildcards. Разрешены только точные исключения статической консоли. Новые маршруты обязаны обновлять контракт; готовность сервера при рассогласовании завершается ошибкой.

Сборка сохраняет идентичный `openapi.json`; fixture фиксирует стабильные IDs, CI проверяет инвентаризацию, JSON-схемы, HTTP auth boundaries, reader restrictions и реальные ответы. Ajv/ajv-formats явно закреплены как dev dependencies в уже используемых runtime деревом версиях. В продуктовый contracts не вводится зависимость на валидатор, Fastify или Node. Side-effect-free exports позволяют не включать спецификацию в браузерный SDK bundle.

## Последствия

Полное имя endpoint и transport contract становятся проверяемой частью изменения. Схема БД и исполняемые ACL/передачи не меняются. Ошибка контракта блокирует старт вместо незаметного появления недокументированной API-поверхности. Проверки не заменяют security review, все комбинации отказов или испытания реальных ProGet-клиентов. Подробный [контракт и сопровождение](../API_CONTRACT_GUARD.md).
