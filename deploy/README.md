# Развёртывание

Первый профиль — один API-процесс, одна отдельная PostgreSQL и локальный каталог содержимого. [compose.dev.yml](compose.dev.yml) поднимает только PostgreSQL для разработки; API запускается через `npm start` после build/migrate. Пароль генерирует `npm run init:local`.

Инструкции и ограничения: [CORE_RUNBOOK](../docs/CORE_RUNBOOK.md). Это не HA и не готовый промышленный deployment. Будущие профили добавят TLS/proxy, управляемую остановку, роли БД, наблюдаемость, backup/restore и проверенную отказоустойчивую топологию.
