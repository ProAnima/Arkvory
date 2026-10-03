// Error feedback by machine code and reason (ADR 0051, docs/CONSOLE_UX.md). Each message says
// what happened and what to do next; the request ID line below it carries the reference.
export const errorEnglish = {
  errorNetwork: 'Arkvory did not answer. Check your network connection and try again.',
  errorTimeout: 'The server took too long to answer, so the request was stopped. Try again.',
  errorGateway:
    'A proxy in front of Arkvory did not get an answer from it. Try again shortly or contact the administrator.',
  errorInternal: 'Unexpected server error. Report the request ID below to the administrator.',
  errorUnavailable: 'The service is temporarily unavailable. Try again shortly.',
  errorFeedbackDisabled:
    'Feedback is turned off on this server. Write to info@proanima.net instead.',
  errorHubUnreachable:
    'The server cannot reach ProAnimaStudio right now. Try again later or write to info@proanima.net.',
  errorFeedbackLimited: 'Too many messages from this server. Wait a few minutes and try again.',
  errorReadOnly:
    'This address only serves downloads. Make changes through the main Arkvory address.',
  errorRouteMissing:
    'This Arkvory server does not support the operation. Update the server or reload the console.',
  errorBodyTooLarge: 'The entered data is too large. Shorten the values and try again.',
  errorMediaType: 'The server did not accept the request format. Reload the console.',
  errorMalformed: 'The server could not read the request. Reload the console and try again.',
  errorFields: 'Check the highlighted fields.',
  errorRange: 'The requested part of the file is not available. Restart the download.',
  errorTooManyRequests: 'Too many requests. Wait a moment and try again.',
  errorRegistrationLimited: 'Too many sign-up attempts from this network. Wait and try again.',
  errorPasswordLimited: 'Too many wrong current passwords. Wait and try again.',
  sessionEnded:
    'Your session has ended: you signed out elsewhere, changed the password or access was revoked. Sign in again.',
  errorTokenExpired: 'This key or token has expired. Create a new one and connect again.',
  errorReadOnlyToken:
    'This token can only read. Use a read-write token or sign in with your password.',
  errorCredentialRevoked: 'The key used for this action was revoked or has expired.',
  errorSessionRequired: 'This action needs a password sign-in; keys and tokens cannot do it.',
  errorAdministratorRequired: 'Only an administrator can do this.',
  errorRegistrationDisabled: 'Self sign-up is turned off. Ask an administrator for an account.',
  errorOriginForbidden:
    'The server does not allow requests from this console address. Contact the administrator.',
  errorUploadExpired: 'The upload expired before it was finished. Start a new upload.',
  errorUploadState: 'This upload is already published or cancelled. Start a new upload.',
  errorRevisionMismatch:
    'Someone changed this item meanwhile. Reload it and apply your change again.',
  errorVersionExists: 'This package version already exists. Publish it under a new version.',
  errorPartsIncomplete: 'Some parts of the file have not arrived yet. Resume the upload.',
  errorIdempotency:
    'This upload key was already used for another file. Start a new upload to get a fresh key.',
  errorAlreadyExists: 'An item with this name already exists. Choose another name.',
  errorStageLimit: 'This artifact already has the maximum number of stages. Remove one first.',
  errorStorageQuota:
    'The repository quota is used up. Delete old builds or ask an administrator to raise it.',
  errorStorageFull: 'The server disk is full. Contact the administrator.',
  errorAccountLimit: 'The maximum number of accounts has been reached.',
  errorGroupLimit: 'The maximum number of groups has been reached.',
  errorMembershipLimit: 'The maximum number of group members has been reached.',
  errorGrantLimit: 'The maximum number of access rules has been reached.',
  errorKeyLimit: 'The key limit for this account has been reached. Revoke unused keys first.',
  errorTokenLimit: 'You already have the maximum of active tokens. Revoke unused tokens first.',
  errorDelegationLimit: 'The maximum number of delegations has been reached.',
  errorCatalogLimit: 'The storage catalog is full. Contact the administrator.',
  errorQueueFull: 'The processing queue is full. Try again later.',
  errorTransferLimit: 'Too many transfers are running right now. Try again later.',
  errorCompletionFailed:
    'The server could not finish this upload. Start a new upload or contact the administrator.',
  errorUnexpectedResponse:
    'The server sent an answer this console does not understand. Update the server or the console.',
  fieldRequired: 'Required.',
  fieldInvalid: 'Check this value.',
  fieldFormat: 'The format is not valid.',
  fieldLength: 'The length is outside the allowed range.',
  fieldRange: 'The value is outside the allowed range.',
  fieldType: 'This kind of value is not accepted.',
  fieldUnknown: 'The server does not accept this field.',
  requestIdLabel: 'Request ID',
  retryIn: 'Try again in {seconds} s.',
} as const;

export const errorRussian: Record<keyof typeof errorEnglish, string> = {
  errorNetwork: 'Arkvory не отвечает. Проверьте подключение к сети и повторите попытку.',
  errorTimeout: 'Сервер отвечал слишком долго, запрос остановлен. Повторите попытку.',
  errorGateway:
    'Прокси-сервер перед Arkvory не получил от него ответа. Повторите чуть позже или обратитесь к администратору.',
  errorInternal:
    'Непредвиденная ошибка сервера. Сообщите администратору идентификатор запроса ниже.',
  errorUnavailable: 'Сервис временно недоступен. Повторите чуть позже.',
  errorFeedbackDisabled: 'Обратная связь на этом сервере выключена. Напишите на info@proanima.net.',
  errorHubUnreachable:
    'Сервер сейчас не может связаться с ProAnimaStudio. Повторите позже или напишите на info@proanima.net.',
  errorFeedbackLimited: 'Слишком много сообщений с этого сервера. Подождите несколько минут.',
  errorReadOnly: 'Этот адрес только раздаёт файлы. Вносите изменения через основной адрес Arkvory.',
  errorRouteMissing:
    'Этот сервер Arkvory не поддерживает операцию. Обновите сервер или перезагрузите консоль.',
  errorBodyTooLarge: 'Введённые данные слишком велики. Сократите значения и повторите.',
  errorMediaType: 'Сервер не принял формат запроса. Перезагрузите консоль.',
  errorMalformed: 'Сервер не смог прочитать запрос. Перезагрузите консоль и повторите.',
  errorFields: 'Проверьте выделенные поля.',
  errorRange: 'Запрошенная часть файла недоступна. Начните скачивание заново.',
  errorTooManyRequests: 'Слишком много запросов. Подождите немного и повторите.',
  errorRegistrationLimited:
    'Слишком много попыток регистрации из этой сети. Подождите и повторите.',
  errorPasswordLimited: 'Слишком много неверных текущих паролей. Подождите и повторите.',
  sessionEnded:
    'Сеанс завершён: выполнен выход в другом месте, изменён пароль или отозван доступ. Войдите снова.',
  errorTokenExpired: 'Срок действия ключа или токена истёк. Создайте новый и подключитесь снова.',
  errorReadOnlyToken:
    'Этот токен разрешает только чтение. Используйте токен с записью или войдите по паролю.',
  errorCredentialRevoked: 'Ключ для этого действия отозван или его срок истёк.',
  errorSessionRequired: 'Для этого действия нужен вход по паролю; ключи и токены не подходят.',
  errorAdministratorRequired: 'Это может сделать только администратор.',
  errorRegistrationDisabled:
    'Самостоятельная регистрация выключена. Попросите администратора создать учётную запись.',
  errorOriginForbidden:
    'Сервер не принимает запросы с адреса этой консоли. Обратитесь к администратору.',
  errorUploadExpired: 'Срок загрузки истёк до её завершения. Начните новую загрузку.',
  errorUploadState: 'Эта загрузка уже опубликована или отменена. Начните новую загрузку.',
  errorRevisionMismatch: 'Объект успели изменить. Обновите его и внесите своё изменение снова.',
  errorVersionExists: 'Такая версия пакета уже есть. Опубликуйте пакет под новой версией.',
  errorPartsIncomplete: 'Не все части файла получены. Продолжите загрузку.',
  errorIdempotency:
    'Этот ключ загрузки уже использован для другого файла. Начните новую загрузку с новым ключом.',
  errorAlreadyExists: 'Объект с таким именем уже существует. Выберите другое имя.',
  errorStageLimit: 'У артефакта уже максимальное число стадий. Сначала удалите одну из них.',
  errorStorageQuota:
    'Квота репозитория исчерпана. Удалите старые сборки или попросите администратора увеличить квоту.',
  errorStorageFull: 'Диск сервера заполнен. Обратитесь к администратору.',
  errorAccountLimit: 'Достигнуто максимальное число учётных записей.',
  errorGroupLimit: 'Достигнуто максимальное число групп.',
  errorMembershipLimit: 'Достигнуто максимальное число участников групп.',
  errorGrantLimit: 'Достигнуто максимальное число правил доступа.',
  errorKeyLimit: 'Достигнут лимит ключей этой учётной записи. Сначала отзовите ненужные.',
  errorTokenLimit: 'У вас уже максимум активных токенов. Сначала отзовите ненужные.',
  errorDelegationLimit: 'Достигнуто максимальное число делегирований.',
  errorCatalogLimit: 'Каталог хранилища заполнен. Обратитесь к администратору.',
  errorQueueFull: 'Очередь обработки заполнена. Повторите позже.',
  errorTransferLimit: 'Сейчас выполняется слишком много передач. Повторите позже.',
  errorCompletionFailed:
    'Сервер не смог завершить загрузку. Начните новую загрузку или обратитесь к администратору.',
  errorUnexpectedResponse:
    'Сервер прислал ответ, который консоль не понимает. Обновите сервер или консоль.',
  fieldRequired: 'Обязательное поле.',
  fieldInvalid: 'Проверьте значение.',
  fieldFormat: 'Неверный формат.',
  fieldLength: 'Длина вне допустимого диапазона.',
  fieldRange: 'Значение вне допустимого диапазона.',
  fieldType: 'Такой тип значения не принимается.',
  fieldUnknown: 'Сервер не принимает это поле.',
  requestIdLabel: 'ID запроса',
  retryIn: 'Повторите через {seconds} с.',
};
