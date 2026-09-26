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
  updatePolicyHelp:
    'Checks run every 6 hours, even when automatic installation is off. Automatic installation runs once per day during the selected UTC hour. Schema changes require backed-up maintenance.',
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
    'This release changes the database schema. Use a backed-up maintenance upgrade on the server.',
  updateCheckFailed:
    'Release check failed. The displayed release may be outdated. Check GitHub access and credentials on the server.',
  updateFailed: 'Update failed. Inspect the installation journal and service logs before retrying.',
  updateRecovery:
    'Manual recovery is required. Inspect processes, installation lock and journal on the server.',
  updateConflict: 'Settings changed while the request was waiting. Refresh and submit again.',
  updateConfirm: 'Install Arkvory {version}?',
  updateConfirmHelp:
    'Active transfers may be interrupted and need to resume. The installer verifies the release and attempts rollback if startup fails. Schedule this action during a maintenance window.',
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
  updatePolicyHelp:
    'Проверка выполняется каждые 6 часов, даже если автоустановка выключена. Автоустановка запускается один раз в сутки в выбранный час UTC. Изменение схемы БД требует обслуживания с резервной копией.',
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
    'Релиз меняет схему БД. Выполните обновление в режиме обслуживания с резервной копией на сервере.',
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
    'Активные передачи могут прерваться и потребовать продолжения. Установщик проверит релиз и попытается выполнить откат при ошибке запуска. Выполняйте действие в окно обслуживания.',
  updateCancel: 'Отмена',
  updateConfirmButton: 'Установить этот релиз',
  updateConnection:
    'Нет связи с Arkvory. Подключение повторяется автоматически; не отправляйте запрос установки повторно.',
};
