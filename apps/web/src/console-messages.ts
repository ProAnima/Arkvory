// Sign-in, deep links, confirmations and composed data lines. Technical literals and brand
// names also live here so that markup and controllers never carry untranslated text.
export const consoleEnglish = {
  productName: 'ProAnima Arkvory',
  productShortName: 'Arkvory',
  studioName: 'PROANIMA STUDIO',
  copyright: '© Ian Panaev · ProAnimaStudio',
  languageCodeRu: 'RU',
  languageCodeEn: 'EN',
  languageRussian: 'Русский',
  languageEnglish: 'English',
  themeCurrent: 'Appearance: {value}',
  repositoryHint: 'After sign-in, the first repository available to you is selected.',
  keySignIn: 'Connect with a service or automation key',
  signInFailed: 'Wrong username or password.',
  currentPasswordWrong: 'The current password is wrong.',
  sessionExpired: 'Your session has expired. Sign in again to continue.',
  errorSignInRequired: 'Sign in or connect with a service key to continue.',
  idempotencyHint:
    'Prevents a retried upload from creating a second copy. It is sent as the Idempotency-Key of the request that creates the upload.',
  idempotencyHelpLabel: 'About duplicate protection',
  assetPathExample: 'releases/current.upack',
  stageExample: 'release',
  storageUsageUnlimited:
    'Published {published} · unfinished uploads {pending} · awaiting cleanup {retired} · in use {total} · no quota',
  storageQuotaInvalid: 'Enter the quota in GiB, for example 50 or 0.5.',
  storagePreviewItem: '{name} · {id} · {size}',
  attachmentVersion: 'Version {revision}',
  storageEventCode: '· {level} · {code}',
  packageGroupHeading: '{group} / {name}',
  catalogSizeLabel: 'Size',
  catalogPublishedLabel: 'Published',
  grantRepository: '{repository}:',
  delegationGrantLine: '{target}: {actions}',
  keyBindingLine: '{repository}: {actions}',
  serviceAuditLine: '{action} · {actor} · {key}',
  updateHourOption: '{hour}:00 UTC',
  helpOperationTitle: '{method} {path}',
  helpOperationIdentity: '{id} · {surface} · {visibility}',
  helpHintConnected: 'You are connected. Load the API operations your access allows.',
  helpRemoteCliExample:
    'arkvoryctl --help\narkvoryctl profile add production --server https://arkvory.example --token-file /private/arkvory.key\narkvoryctl doctor\narkvoryctl packages publish build.upack --label test\narkvoryctl download ARTIFACT_ID ./build.upack',
  helpCliExample:
    'arkvory help\narkvory status --root ROOT\narkvory update --root ROOT\narkvory configure --root ROOT --disable-updates\narkvory configure --root ROOT --pin --version 1.2.3',
  helpRecipesExample:
    'GET /api/v1/capabilities\nGET /api/v1/repositories\nGET /api/v1/operations?repository=releases',
  serviceEmptyOwner:
    'No service accounts yet. The owner key from the server file is meant for setup, not automation: create a service account below, then issue a key for it.',
  serviceEmptyDelegated:
    'No service accounts are assigned to you yet. Ask the server owner to delegate one.',
  serviceAuditEmpty: 'No activity recorded yet.',
  repositoryEmpty: 'No repositories are available to this account or key.',
  routeUnknown: 'This link does not match a console section. The artifact list is shown instead.',
  routeUnavailable:
    'This section is not available to the current account or key. The artifact list is shown instead.',
  routeArtifactMissing: 'The linked artifact was not found or is not available to you.',
  routeSignIn: 'Sign in to open the linked page.',
  confirmCancel: 'Cancel',
  confirmDisableUser:
    'Disable {name}? Active sessions end immediately and personal tokens stop working until the account is enabled again.',
  confirmRemoveMember:
    'Remove {user} from {group}? They lose the repository access granted through this group.',
  confirmRemoveGrant:
    'Remove access of {group} to {repository}? Group members lose this access immediately.',
};
export const consoleRussian: Record<keyof typeof consoleEnglish, string> = {
  productName: 'ProAnima Arkvory',
  productShortName: 'Arkvory',
  studioName: 'PROANIMA STUDIO',
  copyright: '© Ian Panaev · ProAnimaStudio',
  languageCodeRu: 'RU',
  languageCodeEn: 'EN',
  languageRussian: 'Русский',
  languageEnglish: 'English',
  themeCurrent: 'Оформление: {value}',
  repositoryHint: 'После входа выбирается первый доступный вам репозиторий.',
  keySignIn: 'Подключиться ключом сервиса или автоматизации',
  signInFailed: 'Неверное имя пользователя или пароль.',
  currentPasswordWrong: 'Текущий пароль указан неверно.',
  sessionExpired: 'Сеанс истёк. Войдите снова, чтобы продолжить.',
  errorSignInRequired: 'Войдите или подключитесь ключом сервиса, чтобы продолжить.',
  idempotencyHint:
    'Не даёт повторной попытке создать вторую копию загрузки. Передаётся как Idempotency-Key запроса, который создаёт загрузку.',
  idempotencyHelpLabel: 'О защите от повторов',
  assetPathExample: 'releases/current.upack',
  stageExample: 'release',
  storageUsageUnlimited:
    'Опубликовано {published} · незавершённые загрузки {pending} · ожидают очистки {retired} · занято {total} · без квоты',
  storageQuotaInvalid: 'Укажите квоту в ГиБ, например 50 или 0,5.',
  storagePreviewItem: '{name} · {id} · {size}',
  attachmentVersion: 'Версия {revision}',
  storageEventCode: '· {level} · {code}',
  packageGroupHeading: '{group} / {name}',
  catalogSizeLabel: 'Размер',
  catalogPublishedLabel: 'Опубликован',
  grantRepository: '{repository}:',
  delegationGrantLine: '{target}: {actions}',
  keyBindingLine: '{repository}: {actions}',
  serviceAuditLine: '{action} · {actor} · {key}',
  updateHourOption: '{hour}:00 UTC',
  helpOperationTitle: '{method} {path}',
  helpOperationIdentity: '{id} · {surface} · {visibility}',
  helpHintConnected: 'Подключение активно. Загрузите операции API, разрешённые вашим доступом.',
  helpRemoteCliExample:
    'arkvoryctl --help\narkvoryctl profile add production --server https://arkvory.example --token-file /private/arkvory.key\narkvoryctl doctor\narkvoryctl packages publish build.upack --label test\narkvoryctl download ARTIFACT_ID ./build.upack',
  helpCliExample:
    'arkvory help\narkvory status --root ROOT\narkvory update --root ROOT\narkvory configure --root ROOT --disable-updates\narkvory configure --root ROOT --pin --version 1.2.3',
  helpRecipesExample:
    'GET /api/v1/capabilities\nGET /api/v1/repositories\nGET /api/v1/operations?repository=releases',
  serviceEmptyOwner:
    'Сервисных учётных записей пока нет. Ключ владельца из файла сервера предназначен для настройки, а не для автоматизации: создайте сервисную учётную запись ниже и выпустите для неё ключ.',
  serviceEmptyDelegated:
    'Вам пока не назначены сервисные учётные записи. Попросите владельца сервера делегировать учётную запись.',
  serviceAuditEmpty: 'Действий пока нет.',
  repositoryEmpty: 'Этой учётной записи или ключу не доступен ни один репозиторий.',
  routeUnknown: 'Ссылка не соответствует разделу консоли. Показан список артефактов.',
  routeUnavailable:
    'Этот раздел недоступен текущей учётной записи или ключу. Показан список артефактов.',
  routeArtifactMissing: 'Артефакт по ссылке не найден или недоступен вам.',
  routeSignIn: 'Войдите, чтобы открыть страницу по ссылке.',
  confirmCancel: 'Отмена',
  confirmDisableUser:
    'Отключить {name}? Активные сеансы завершатся сразу, а персональные токены перестанут работать, пока учётную запись снова не включат.',
  confirmRemoveMember:
    'Убрать {user} из группы {group}? Пользователь потеряет доступ, выданный через эту группу.',
  confirmRemoveGrant:
    'Убрать доступ группы {group} к репозиторию {repository}? Участники группы сразу потеряют этот доступ.',
};
