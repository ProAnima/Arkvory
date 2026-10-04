# Пакеты Unity и npm

Каждый репозиторий Arkvory — npm-совместимый реестр по адресу `https://<host>/npm/<repository>/`. Unity Package Manager подключает его как scoped registry, `npm` публикует в него пакеты. Решение и границы — [ADR 0066](adr/0066-npm-registry-for-unity.md).

## Подключение в проекте Unity

`Packages/manifest.json` проекта:

```json
{
  "scopedRegistries": [
    {
      "name": "Arkvory",
      "url": "https://arkvory.example/npm/games/",
      "scopes": ["com.proanima"]
    }
  ],
  "dependencies": {
    "com.proanima.tools": "1.2.0"
  }
}
```

`scopes` — префиксы имён пакетов, которые Unity берёт из Arkvory; остальные пакеты по-прежнему идут из реестра Unity.

Ключ доступа хранится не в проекте, а в пользовательском `.upmconfig.toml` (Windows: `%USERPROFILE%\.upmconfig.toml`, macOS и Linux: `~/.upmconfig.toml`):

```toml
[npmAuth."https://arkvory.example/npm/games/"]
token = "<ключ Arkvory>"
alwaysAuth = true
```

Для разработчиков подходит персональный токен только для чтения, для сборочных агентов — сервисный ключ. Окно Package Manager → My Registries показывает пакеты реестра.

## Публикация

В каталоге пакета (рядом с его `package.json`) — `.npmrc`:

```ini
registry=https://arkvory.example/npm/games/
//arkvory.example/npm/games/:_authToken=${ARKVORY_TOKEN}
```

```bash
npm publish
```

```bash
npm publish --tag beta
```

```bash
npm dist-tag add com.proanima.tools@1.3.0 latest
```

- Версия неизменяема: исправление публикуется следующей версией.
- Повтор той же публикации после обрыва безопасен.
- Для публикации нужны права записи в репозиторий.
- Имена пакетов Unity — обратный домен в нижнем регистре (`com.company.package`); `@scope` Unity не поддерживает, а npm-клиенты — да.

## Что учесть

- Большие бинарные ассеты, которые часто меняются, удобнее держать в [Git LFS](GIT_LFS.md), а в пакетах — код и стабильные ресурсы.
- Установку можно направить на шлюз чтения или зеркало; публикация — только на основной шлюз.
- Удаления версий нет: проекты закрепляют версии, и удаление сломало бы их сборки.
