# Проверки в CI

Репозиторий размещается в GitHub: [ProAnima/Depot](https://github.com/ProAnima/Depot). Workflow [.github/workflows/check.yml](../.github/workflows/check.yml) запускает проверки каркаса на `ubuntu-latest` и `windows-latest` при push в main, pull request и ручном запуске.

Actions закреплены по commit SHA; workflow имеет только `contents: read`, не сохраняет checkout credentials и не выполняет deploy. Установка в CI отключает lifecycle scripts зависимостей. Последовательность:

```sh
npm ci --ignore-scripts
npm run check
```

Окружение: Node.js 24 LTS с актуальными исправлениями, npm 11. Lock-файл обязателен; его рассогласование с manifests должно завершать установку ошибкой. Кешировать допустимо npm cache по версии Node и lock-файлу, а не случайный node_modules от другой среды.

Проверки каркаса: формат, typecheck всех workspaces, type-aware lint и dependency graph. Эти шаги не выполняют продуктовые тесты. Первый рабочий сценарий должен добавить отдельные обязательные unit/contract/integration jobs без `passWithNoTests`.

По мере реализации нужны: сборка deployable JS из чистого checkout, smoke test артефакта, PostgreSQL/blob-store integration, проверки схем/OpenAPI/SDK и совместимости ProGet. Нагрузочные/отказные тесты выполняются на выделенном стенде с сохранённой конфигурацией и результатами.

Runtime-секреты предоставляются только нужным jobs. Для проверки pull request не нужны ключи рабочего ProGet или производственного storage. Автоматический deploy и публикация пакетов в этом каркасе не настроены.
