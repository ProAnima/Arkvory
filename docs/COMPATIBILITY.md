# Совместимость ProGet

Реализован первый **поднабор чтения**, проверенный локальными fixture-тестами, не на работающем ProGet. Проверки Hub/CI/upack/pgutil на стенде отложены по указанию владельца.

| Запрос                                                                              | Сейчас                                                                |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| GET/HEAD `/upack/{feed}/download/{group}/{name}/{version}`                          | Исходный зарегистрированный UPack, группа может быть пустой/составной |
| GET/HEAD `/upack/{feed}/download/{group}/{name}?latest`                             | Самая старшая SemVer-версия, включая prerelease                       |
| GET/HEAD `/api/packages/{feed}/download?group=…&name=…&version=…`                   | Исходный UPack для однозначной версии; пустая группа по умолчанию     |
| GET/HEAD `/endpoints/{feed}/content/{path}`                                         | Текущий asset pointer → неизменяемые bytes                            |
| X-ApiKey; Basic `api:KEY`; Bearer                                                   | Ключи Depot, scope репозитория                                        |
| Range/If-Range/If-None-Match                                                        | Тот же потоковый транспорт, что native API                            |
| `contentOnly`, ZIP/TGZ transformations                                              | Отклоняются 400                                                       |
| Query-string keys, пользовательский Basic, anonymous                                | Не поддерживаются                                                     |
| Legacy push/import/delete, packages/versions, assets dir/metadata                   | Не реализованы                                                        |
| Common Packages API кроме UPack download, virtual packages, package file extraction | Не реализованы                                                        |

Feed соответствует native repository (нижний регистр, до 64 символов). Имя/group/version UPack ищутся без учёта регистра. Native ошибки пока используются и для адаптера; точное соответствие error body/status ProGet ещё не подтверждено. Поэтому текущая версия **не является полной заменой ProGet**. Нельзя переключать общий production hostname на этот набор маршрутов.

Exact и latest download выбирают один ID из каталога по group/name, без лимита в 1000 версий и без загрузки списка в память. Контракт маршрутов и выбор prerelease не меняются; прогон на реальных клиентах по-прежнему необходим.

Common Packages download принимает только `group`, `name` и `version`; `name` и `version` обязательны, `group` по умолчанию пустая. Другие идентификаторы, включая `purl`, пока получают 400. Маршрут использует тот же ACL и потоковую выдачу, что остальные downloads. Форма URL сверена с [официальным описанием Download Package](https://docs.inedo.com/docs/proget/api/packages/download); фактический клиент и сервер ProGet пока не проверены. Известное отличие: отсутствующий или неизвестный ключ получает native 401, тогда как документация Common Packages указывает 403. Это ограничение адаптера, а не подтверждённая совместимость ошибок. Решение о границе поднабора: [ADR 0010](adr/0010-common-package-download.md).

Исходные контракты: [Universal Feed](https://docs.inedo.com/docs/proget/api/universal-feed), [legacy download в официальном архиве Inedo](https://github.com/Inedo/inedo-docs/blob/6dc089e74c549fdc1f5f880afcdce565a5f5ab24/Content/proget/reference-api/universal-feed/download.md), [Asset download](https://docs.inedo.com/docs/proget/api/assets/files/download). Документы задают формы адресов; неоднозначную latest/prerelease-политику нужно сверить с выбранной сборкой и клиентами.

До cutover заполнить матрицу: клиент/версия → фактические endpoints → auth → запрос/ответ без секретов → overwrite/missing/range/retry → воспроизводимый тест. Сначала завершить запись и каталог legacy API, затем проверять перенастройку только base URL. Не переносить native 202/job-контракт в обычный legacy GET.
