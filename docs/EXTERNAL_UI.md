# UI на отдельном сервере

Arkvory предоставляет версионированный native HTTP API `/api/v1`, OpenAPI по авторизованному `GET /api/v1/openapi.json` и TypeScript SDK. Стороннему UI нужны только HTTPS-доступ к API и Bearer-токен с подходящими правами. База данных, каталог blobs и серверные модули ему не нужны.

## Настройка API

1. Опубликуйте Arkvory за доверенным TLS reverse proxy. Закройте прямой доступ из сети к backend-порту. Для больших файлов отключите буферизацию всего тела и настройте достаточные тайм-ауты передачи.
2. В окружении API задайте точный origin внешнего сайта, например `ARKVORY_CORS_ORIGINS=https://ui.example.com`. Для нескольких сайтов перечислите origins через запятую. После изменения перезапустите API.
3. Разрешаются до 16 точных HTTPS origins. Путь, query, wildcard и credentials в origin недопустимы. HTTP разрешён только для `localhost`, `127.0.0.1` и `[::1]` при локальной разработке. Схема, host и порт должны совпадать с адресом страницы в браузере.
4. Выдайте UI отдельный сервисный ключ с минимальными `repositories` и `permissions` (`read` либо `write`) либо используйте вход пользователя и права его групп. Административный доступ выдаётся отдельно. Хеши сервисных ключей хранятся в `ARKVORY_KEYS_FILE`; исходный ключ передаётся только доверенному клиенту. Формат ключей и процедура ротации: [основной runbook](CORE_RUNBOOK.md).

CORS действует на `/api/v1/*` и `/health/ready`. Он разрешает браузеру читать ответы только с перечисленных origins, но сам по себе не аутентифицирует запрос и не заменяет ACL. Preflight `OPTIONS` не требует Bearer; обычные запросы требуют Bearer, кроме входа по паролю. SDK передаёт токен заголовком `Authorization` и не отправляет cookies.

## Размещение встроенной консоли отдельно

После `npm run build` опубликуйте содержимое `apps/web/public/` по пути `/console/` на сервере UI. В опубликованном `index.html` задайте адрес API в meta:

```html
<meta name="arkvory-api-base-url" content="https://arkvory.example.com/" />
```

При пустом `content` консоль использует origin страницы. Сохраните путь `/console/`: HTML, стили, скрипты и hash worker используют его. При собственной Content Security Policy разрешите `connect-src` к origin Arkvory и запуск локального worker. Сервер UI должен выдавать HTTPS и корректные MIME-типы для `.js` и `.css`.

Консоль принимает сервисный ключ либо сессию после входа пользователя. Токен остаётся в памяти вкладки; обновление страницы требует повторного входа. Не помещайте токен в URL, исходники сайта, публичную конфигурацию, localStorage, логи или аналитику. Если сторонний UI использует серверную сессию, держите долгоживущий сервисный ключ только на его сервере и передавайте Arkvory запросы от него там же.

## Свой UI через SDK

При сборке UI вместе с workspace Arkvory браузерный TypeScript-клиент можно создать так. Пакет SDK пока имеет `private: true` и не опубликован отдельно; независимый проект может использовать HTTP/OpenAPI без импорта внутренних модулей Arkvory.

```ts
import { ArkvoryClient } from '@proanima/arkvory-sdk';

let token = ''; // Секрет приходит из доверенного входа и хранится только в памяти вкладки.
const arkvory = new ArkvoryClient('https://arkvory.example.com/', () => token);
const page = await arkvory.packages('releases', {
  sort: 'name',
  direction: 'asc',
  groupBy: 'package',
  limit: 50,
});
if (page.next) {
  const following = await arkvory.packages('releases', {
    sort: 'name',
    direction: 'asc',
    groupBy: 'package',
    limit: 50,
    after: page.next,
  });
  // Отобразите следующую страницу.
}
```

Для пользовательского входа вызовите `arkvory.login(name, password)`, сохраните возвращённый токен в памяти и очистите его при выходе. Для серверного клиента можно использовать обычный HTTP-клиент на любом языке: `Authorization: Bearer <token>`, JSON по OpenAPI и потоковую передачу байтов. Ограничения повторов, Range и безопасной записи скачанных файлов описаны в [TRANSFER_RECOVERY](TRANSFER_RECOVERY.md).

`arkvory.me()` возвращает эффективные `grants` текущего токена. Используйте их для списка доступных репозиториев, но проверяйте ответы каждой операции: права пользователя могут быть отозваны после получения списка.

## Проверка подключения

Из origin UI браузер отправит preflight с `Origin`, `Access-Control-Request-Method` и `Access-Control-Request-Headers`. Сервер должен ответить `204` с тем же origin в `Access-Control-Allow-Origin`. Затем проверьте `GET /api/v1/auth/me` с Bearer и чтение одного разрешённого репозитория. `403` для неразрешённого origin означает ошибку настройки CORS; `401` или `403` с разрешённым origin означает проблему токена или прав. Для разбора ошибки используйте `X-Request-Id`.

Публичный контракт CORS, методов и заголовков: [API_CONTRACTS](API_CONTRACTS.md). Стадия продукта и границы отказоустойчивости: [README](../README.ru.md).

Логическое удаление и retention preview/apply реализованы в [ARTIFACT_RETENTION](ARTIFACT_RETENTION.md): managed-only artifact.delete, CAS аннотаций, пины истории и receipts. OpenAPI 0.10.0, 123 операций, миграции 13/14. Реестр репозиториев, SDK distribution, identity delegation/SSO, online GC и глобальное управление очередями остаются отдельными этапами.

Встроенная консоль выбирает доступные репозитории через repository discovery с пагинацией и artifact.list; managed key требует repository.read для показа области. Это не преобразование granular permissions в старые read/write grants.

Настройки last-N retention и квот, предупреждения и журнал диагностики доступны через API/SDK/консоль: [STORAGE_POLICIES](STORAGE_POLICIES.md).
