export const updateEnglish = {
  updates: 'Updates',
  updateAvailable: 'Arkvory {version} is available',
  updateOpen: 'View update',
  updateCurrent: 'Installed version',
  updateLatest: 'Latest stable release',
  updateChecked: 'Last check',
  updateCheck: 'Check now',
  updateInstall: 'Install update',
  updateSettings: 'Automatic updates',
  updateAutomatic: 'Install compatible stable releases automatically',
  updateHour: 'Maintenance hour (UTC)',
  updateSave: 'Save settings',
  updateStatistics: 'Send anonymous statistics to ProAnimaStudio',
  updateHub:
    'Channel: {channel}. Versions are approved in the ProAnimaStudio hub; GitHub is used only when the hub cannot be reached. Statistics: a random installation id, version, system and installed updates — no names, addresses or content. Without statistics a version arrives only when it is rolled out to everyone.',
  updatePolicyHelp:
    'Checks run every 6 hours, even when automatic installation is off. Automatic installation runs once per day during the selected UTC hour. A release that changes the database schema installs only after the server has captured and verified a fresh backup.',
  updateUnavailable:
    'The host updater is not connected. Ask the server administrator to connect it using updates-connect.',
  updateStale:
    'The host updater has stopped reporting. Check the scheduler and installation lock on the server.',
  updateIdle: 'Updater is ready',
  updateChecking: 'Checking stable releases…',
  updateWorking:
    'Installing the release. The service may briefly disconnect; this page will reconnect.',
  updatePending: 'Request accepted. Waiting for the host updater (usually within one minute).',
  updateUnknown: 'Not checked yet',
  updatePinned:
    'Version is pinned. Remove the pin on the server before installing from the console.',
  updateMaintenance:
    'Installation refused: a release that changes the database schema needs a fresh verified backup. Connect a backup vault and complete the first backup, then check again, or upgrade manually on the server.',
  updateMigration:
    'This release changes the database schema. The server captures and verifies a backup before installing, so installation takes longer.',
  updateCheckFailed:
    'Release check failed. The displayed release may be outdated. Check GitHub access and credentials on the server.',
  updateFailed: 'Update failed. Inspect the installation journal and service logs before retrying.',
  updateRecovery:
    'Manual recovery is required. Inspect processes, installation lock and journal on the server.',
  updateConflict: 'Settings changed while the request was waiting. Refresh and submit again.',
  updateConfirm: 'Install Arkvory {version}?',
  updateConfirmHelp:
    'Active transfers may be interrupted and need to resume. The installer verifies the release, backs up first when the database schema changes, and attempts rollback if startup fails. Schedule this action during a maintenance window.',
  updateCancel: 'Cancel',
  updateConfirmButton: 'Install this release',
  updateConnection:
    'Cannot contact Arkvory. Retrying automatically; do not submit another installation request.',
};
export const updateRussian: Record<keyof typeof updateEnglish, string> = {
  updates: 'Обновления',
  updateAvailable: 'Доступен Arkvory {version}',
  updateOpen: 'Посмотреть обновление',
  updateCurrent: 'Установленная версия',
  updateLatest: 'Последний стабильный релиз',
  updateChecked: 'Последняя проверка',
  updateCheck: 'Проверить сейчас',
  updateInstall: 'Установить обновление',
  updateSettings: 'Автообновление',
  updateAutomatic: 'Автоматически устанавливать совместимые стабильные релизы',
  updateHour: 'Час обслуживания (UTC)',
  updateSave: 'Сохранить настройки',
  updateStatistics: 'Отправлять анонимную статистику в ProAnimaStudio',
  updateHub:
    'Канал: {channel}. Версии одобряются в хабе ProAnimaStudio; GitHub используется, только если хаб недоступен. Статистика: случайный идентификатор установки, версия, система и установленные обновления — без имён, адресов и содержимого. Без статистики версия приходит, только когда её раскатывают на всех.',
  updatePolicyHelp:
    'Проверка выполняется каждые 6 часов, даже если автоустановка выключена. Автоустановка запускается один раз в сутки в выбранный час UTC. Релиз, меняющий схему БД, устанавливается только после того, как сервер сделает и проверит свежую резервную копию.',
  updateUnavailable:
    'Механизм обновлений на сервере не подключён. Администратор сервера может подключить его командой updates-connect.',
  updateStale:
    'Планировщик обновлений перестал отвечать. Проверьте его работу и блокировку установки на сервере.',
  updateIdle: 'Механизм обновлений готов',
  updateChecking: 'Проверяем стабильные релизы…',
  updateWorking:
    'Устанавливаем релиз. Связь может ненадолго прерваться; страница подключится снова.',
  updatePending: 'Запрос принят. Ожидаем планировщик сервера — обычно до одной минуты.',
  updateUnknown: 'Проверка ещё не выполнялась',
  updatePinned: 'Версия закреплена. Перед установкой из консоли снимите закрепление на сервере.',
  updateMaintenance:
    'Установка отклонена: для релиза, меняющего схему БД, нужна свежая проверенная резервная копия. Подключите хранилище копий и дождитесь первой копии, затем проверьте снова — или обновите вручную на сервере.',
  updateMigration:
    'Релиз меняет схему БД. Перед установкой сервер сделает и проверит резервную копию, поэтому установка займёт больше времени.',
  updateCheckFailed:
    'Не удалось проверить релизы. Показанная версия может быть устаревшей. Проверьте доступ к GitHub и учётные данные на сервере.',
  updateFailed:
    'Обновление завершилось ошибкой. Перед повтором проверьте журнал установки и логи служб.',
  updateRecovery:
    'Нужно ручное восстановление. Проверьте процессы, блокировку установки и журнал на сервере.',
  updateConflict:
    'Настройки изменились, пока запрос ожидал выполнения. Обновите сведения и повторите действие.',
  updateConfirm: 'Установить Arkvory {version}?',
  updateConfirmHelp:
    'Активные передачи могут прерваться и потребовать продолжения. Установщик проверит релиз, при смене схемы БД сначала сделает резервную копию и попытается выполнить откат при ошибке запуска. Выполняйте действие в окно обслуживания.',
  updateCancel: 'Отмена',
  updateConfirmButton: 'Установить этот релиз',
  updateConnection:
    'Нет связи с Arkvory. Подключение повторяется автоматически; не отправляйте запрос установки повторно.',
};
