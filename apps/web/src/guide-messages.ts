export const guideEnglish = {
  welcomePartial:
    'The owner account exists. Sign in and finish repository permissions in Access groups; account creation must not be repeated.',
  onboarding: 'Welcome to Depot',
  onboardingSubtitle: 'A clear path from installation to your first delivery.',
  help: 'API & CLI',
  helpSubtitle: 'Discover permitted operations and connect your tools.',
  welcomeLead: 'Your storage. Ready for work.',
  welcomeBody:
    'The installer prepares the service and database. Finish access setup, publish a small file, then connect your integrations.',
  welcomeAccess: '01 · Sign in',
  welcomeAccessBody:
    'On Windows, use the owner account you created in Setup. For a headless installation, create an owner using the private recovery key on the server.',
  welcomeSignIn: 'Open sign in',
  welcomeOwner: 'Create the first owner',
  welcomeRecovery: 'Recovery key',
  welcomeName: 'Owner name · 3–64 Latin letters, digits, dot, dash or underscore',
  welcomePassword: 'Password · at least 12 characters',
  welcomeCreate: 'Create owner',
  welcomeCreated: 'Owner created. Sign in with your new password. Keep the recovery key offline.',
  welcomePublish: '02 · Publish a file',
  welcomePublishBody:
    'Start with a small file in releases. Add labels and metadata; UPack builds can also carry manifests and attachments.',
  welcomePublishAction: 'Open uploads',
  welcomeConnect: '03 · Connect your tools',
  welcomeConnectBody:
    'Give each integration its own service account and only the repository actions it needs. Use the API catalogue to see current permissions.',
  welcomeOperate: '04 · Prepare production',
  welcomeOperateBody:
    'Before remote access: configure HTTPS, backups and disk alerts. Updates are opt-in. Local storage is a single-server profile.',
  helpLoad: 'Load permitted API operations',
  helpSearch: 'Search method, path or operation',
  helpHint:
    'Sign in first. The catalogue reflects your current key and repository; the server checks authorization again for each request.',
  helpEmpty: 'No matching operations.',
  helpLoaded: 'Loaded {count} operations.',
  helpRetry: 'Retry policy',
  helpActions: 'Required actions',
  helpCli: 'Server lifecycle CLI',
  helpCliBody:
    'Run from an elevated terminal on the server. These commands manage deployment; integrations use the HTTP API and SDK. Replace ROOT with the installation directory.',
  helpRecipes: 'Integration checklist',
  helpRecipesBody:
    'Read capabilities → discover repositories → create upload with an idempotency key → resume parts → complete → poll readiness → download using Range and ETag. Never blindly retry a non-idempotent write.',
};
export const guideRussian: Record<keyof typeof guideEnglish, string> = {
  welcomePartial:
    'Владелец создан. Войдите и завершите выдачу прав в группах доступа; повторно создавать владельца не нужно.',
  onboarding: 'Добро пожаловать в Depot',
  onboardingSubtitle: 'От установки до первой раздачи — по понятным шагам.',
  help: 'API и CLI',
  helpSubtitle: 'Доступные операции и подключение ваших инструментов.',
  welcomeLead: 'Ваше хранилище. Готово к работе.',
  welcomeBody:
    'Установщик подготовит сервис и базу. Настройте доступ, опубликуйте небольшой файл и подключите интеграции.',
  welcomeAccess: '01 · Войдите',
  welcomeAccessBody:
    'В Windows используйте владельца, созданного в установщике. После серверной установки создайте владельца с помощью закрытого ключа восстановления на сервере.',
  welcomeSignIn: 'Открыть вход',
  welcomeOwner: 'Создать первого владельца',
  welcomeRecovery: 'Ключ восстановления',
  welcomeName: 'Имя · 3–64 латинских символа, цифры, точка, дефис или подчёркивание',
  welcomePassword: 'Пароль · не менее 12 символов',
  welcomeCreate: 'Создать владельца',
  welcomeCreated: 'Владелец создан. Войдите с новым паролем. Храните ключ восстановления вне сети.',
  welcomePublish: '02 · Опубликуйте файл',
  welcomePublishBody:
    'Начните с небольшого файла в releases. Добавьте метки и метаданные; сборки UPack также поддерживают манифесты и вложения.',
  welcomePublishAction: 'Открыть загрузки',
  welcomeConnect: '03 · Подключите инструменты',
  welcomeConnectBody:
    'Выдайте каждой интеграции отдельную сервисную учётную запись и только нужные права. Каталог API показывает доступные операции.',
  welcomeOperate: '04 · Подготовьте эксплуатацию',
  welcomeOperateBody:
    'Перед удалённым доступом настройте HTTPS, резервные копии и предупреждения о месте. Автообновления включаются отдельно. Локальное хранилище рассчитано на один сервер.',
  helpLoad: 'Загрузить доступные операции API',
  helpSearch: 'Поиск по методу, пути или операции',
  helpHint:
    'Сначала войдите. Каталог учитывает текущий ключ и репозиторий; сервер повторно проверяет права при каждом запросе.',
  helpEmpty: 'Подходящих операций нет.',
  helpLoaded: 'Загружено операций: {count}.',
  helpRetry: 'Политика повторов',
  helpActions: 'Необходимые права',
  helpCli: 'CLI обслуживания сервера',
  helpCliBody:
    'Запускайте в терминале администратора на сервере. Эти команды управляют развёртыванием; интеграции используют HTTP API и SDK. Вместо ROOT укажите папку установки.',
  helpRecipes: 'Порядок интеграции',
  helpRecipesBody:
    'Прочитать capabilities → получить репозитории → создать upload с ключом идемпотентности → передать части с resume → завершить → дождаться готовности → скачать с Range и ETag. Не повторяйте неидемпотентную запись вслепую.',
};
