# web

Автономный web UI.

Рабочая RU/EN консоль через SDK: каталог, правки, загрузка частями, потоковый hash в Web Worker. Собирается esbuild, выдаётся API по /console/. См. [runbook](../../docs/LIFECYCLE_AND_CATALOG.md).

Консоль можно разместить отдельно, сохранив её файлы под `/console/`: в `index.html` укажите `<meta name="depot-api-base-url" content="https://depot.example.com/">`, на API разрешите точный origin сайта через `DEPOT_CORS_ORIGINS`. Пустое значение meta использует origin текущей страницы. [Порядок развёртывания и ограничения](../../docs/EXTERNAL_UI.md).

Светлая/тёмная/системная темы, отдельные экраны и переключение языка без перезагрузки. Токены оформления — `tokens.css`, компоненты — `style.css`, словари — `src/messages.ts`. Подробные правила и расширение: [DESIGN_SYSTEM](../../docs/DESIGN_SYSTEM.md).

Разрешённые зависимости и правила: [ARCHITECTURE.md](../../docs/ARCHITECTURE.md). Общие инструкции: [AGENTS.md](../../AGENTS.md).

Публичный вход — src/index.ts. Импорт внутренних файлов другого workspace запрещён. Реальные зависимости объявляются в package.json при появлении импорта.
Вход по имени/паролю выдаёт сессию в памяти вкладки; ключи и токены не сохраняются в localStorage. Пользователь может сменить свой пароль, после чего консоль удаляет отозванный токен. После авторизации консоль предлагает доступные для чтения репозитории из `/api/v1/auth/me`; имя также можно ввести вручную. Экран «Пакеты» сортирует, группирует и переключает страницы зарегистрированных UPack; административный экран создаёт пользователей и группы с repository grants. [ADR 0011](../../docs/adr/0011-users-groups-and-package-browser.md), [ADR 0012](../../docs/adr/0012-account-password-change.md), [ADR 0013](../../docs/adr/0013-package-cursor-pagination.md).
