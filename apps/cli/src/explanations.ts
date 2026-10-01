/** What to do next, per failure code; [English, Russian]. Keys never contain user data. */
type Text = readonly [string, string];

// Local and usage failures raised by arkvoryctl itself.
const local: Readonly<Record<string, Text>> = {
  credential_required: [
    'Set ARKVORY_TOKEN_FILE or add a profile with --token-file.',
    'Задайте ARKVORY_TOKEN_FILE или добавьте профиль с --token-file.',
  ],
  checkpoint_mismatch: [
    'The source, server or publication options differ from the checkpoint. Use the original values or a new --state.',
    'Исходный файл, сервер или параметры отличаются от чекпойнта. Верните прежние значения или выберите новый --state.',
  ],
  state_locked: [
    'Another process owns this checkpoint. After a hard crash, confirm it has stopped before removing the .lock file.',
    'Чекпойнт занят другим процессом. После аварии убедитесь, что процесс остановлен, прежде чем удалять .lock.',
  ],
  destination_exists: [
    'Choose a new output filename; the existing file was preserved.',
    'Выберите другое имя результата; существующий файл сохранён.',
  ],
  orphan_partial: [
    'A partial download without its checkpoint exists beside the output. Remove it or choose another output.',
    'Рядом с результатом есть частичный файл без чекпойнта. Удалите его или выберите другое имя.',
  ],
  invalid_partial: [
    'The partial download path is not a regular file. Remove it and repeat the command.',
    'Путь частичного файла не является обычным файлом. Удалите его и повторите команду.',
  ],
  invalid_checkpoint: [
    'The checkpoint file is damaged. Remove it or pass a new --state.',
    'Файл чекпойнта повреждён. Удалите его или укажите новый --state.',
  ],
  invalid_state_path: [
    'The checkpoint path must differ from the source file.',
    'Путь чекпойнта должен отличаться от исходного файла.',
  ],
  invalid_server_url: [
    'Use an HTTPS URL without credentials or query parameters.',
    'Укажите HTTPS URL без ключей, пароля и query-параметров.',
  ],
  invalid_configuration: [
    'The profile file is not a supported arkvoryctl configuration. Recreate it with profile add.',
    'Файл профилей не является конфигурацией arkvoryctl. Создайте его заново через profile add.',
  ],
  invalid_profile: [
    'Profile names use letters, digits, dash and underscore (up to 64).',
    'Имя профиля: буквы, цифры, дефис и подчёркивание (до 64).',
  ],
  profile_exists: [
    'A profile with this name exists. Remove it first or choose another name.',
    'Профиль с таким именем уже есть. Удалите его или выберите другое имя.',
  ],
  profile_not_found: [
    'No such profile. List profiles with: arkvoryctl profile list.',
    'Профиль не найден. Список профилей: arkvoryctl profile list.',
  ],
  invalid_repository: [
    'Repository names use lowercase letters, digits, dash and underscore.',
    'Имя репозитория: строчные буквы, цифры, дефис и подчёркивание.',
  ],
  invalid_revision: [
    'Pass the current revision as a non-negative integer.',
    'Укажите текущую ревизию неотрицательным целым числом.',
  ],
  invalid_language: ['Use --lang en or --lang ru.', 'Используйте --lang en или --lang ru.'],
  invalid_order: [
    'Use --order version or --order promoted.',
    'Используйте --order version или --order promoted.',
  ],
  metadata_pair_required: [
    'Pass --metadata-key and --metadata-value together.',
    'Передайте --metadata-key и --metadata-value вместе.',
  ],
  unknown_command: ['See arkvoryctl --help for commands.', 'Список команд: arkvoryctl --help.'],
  unknown_option: [
    'The option is not known. Keys are never command-line arguments.',
    'Неизвестный параметр. Ключи никогда не передаются аргументами.',
  ],
  duplicate_option: ['Pass each option once.', 'Передайте каждый параметр один раз.'],
  missing_option_value: ['The option needs a value.', 'Параметру нужно значение.'],
  missing_option: [
    'A required option is missing. See --help for the command.',
    'Не указан обязательный параметр. См. --help для команды.',
  ],
  missing_argument: [
    'A command argument is missing. See --help.',
    'Не хватает аргумента команды. См. --help.',
  ],
  unexpected_argument: [
    'The command got too many arguments. See --help.',
    'У команды лишние аргументы. См. --help.',
  ],
  option_not_supported: [
    'This command does not accept the option.',
    'Эта команда не принимает такой параметр.',
  ],
  invalid_local_file: [
    'The file must be a regular, small file (no symbolic links).',
    'Файл должен быть обычным и небольшим (без символических ссылок).',
  ],
  local_file_too_large: [
    'The local file is larger than allowed.',
    'Локальный файл больше допустимого.',
  ],
  invalid_file_stream: [
    'The source file could not be read as bytes.',
    'Исходный файл не удалось прочитать.',
  ],
  integrity_failed: [
    'SHA-256 verification failed. Nothing was published; repeat the download.',
    'Проверка SHA-256 не пройдена. Файл не опубликован; повторите скачивание.',
  ],
  interrupted: [
    'Transfer interrupted. Repeat the same command to resume.',
    'Передача прервана. Повторите ту же команду для продолжения.',
  ],
  file_not_found: [
    'Check the input file, credential file and parent directory of the destination.',
    'Проверьте исходный файл, файл ключа и родительский каталог результата.',
  ],
  permission_denied: [
    'The operating system denied access to a local file or directory.',
    'Операционная система запретила доступ к локальному файлу или каталогу.',
  ],
  disk_full: [
    'Free local disk space, then repeat the command.',
    'Освободите место на локальном диске и повторите команду.',
  ],
  disk_write_failed: [
    'The local disk accepted no bytes. Check free space and repeat the command.',
    'Локальный диск не принял данные. Проверьте свободное место и повторите команду.',
  ],
  network_failed: [
    'The connection failed. Repeat the same command; transfers resume from their checkpoint.',
    'Соединение прервалось. Повторите ту же команду; передача продолжится с чекпойнта.',
  ],
  request_timeout: [
    'The server did not answer in time. Repeat the command or raise --timeout.',
    'Сервер не ответил вовремя. Повторите команду или увеличьте --timeout.',
  ],
  local_or_protocol_error: [
    'Unexpected local or protocol failure. Repeat with --verbose and report the output.',
    'Непредвиденная локальная или протокольная ошибка. Повторите с --verbose и сообщите вывод.',
  ],
  size_mismatch: [
    'The file size differs from the started upload. Use the original file or a new --state.',
    'Размер файла отличается от начатой загрузки. Используйте исходный файл или новый --state.',
  ],
  file_changed: [
    'The file differs from the parts already uploaded. Use the original file or a new --state.',
    'Файл отличается от уже загруженных частей. Используйте исходный файл или новый --state.',
  ],
  upload_cancelled: [
    'The upload was cancelled. Start again with a new --state.',
    'Загрузка отменена. Начните заново с новым --state.',
  ],
  completion_failed: [
    'The server could not complete the upload. Start again with a new --state.',
    'Сервер не смог завершить загрузку. Начните заново с новым --state.',
  ],
  invalid_response: [
    'The server answered in an unexpected form. Check that client and server versions match.',
    'Сервер ответил в неожиданном формате. Проверьте совместимость версий клиента и сервера.',
  ],
  response_too_large: [
    'The server answer exceeded the client limit. Check the server URL.',
    'Ответ сервера превысил лимит клиента. Проверьте адрес сервера.',
  ],
  invalid_argument: [
    'A value is outside the allowed range.',
    'Значение вне допустимого диапазона.',
  ],
  insecure_url: [
    'Use HTTPS; plain HTTP is allowed only on loopback.',
    'Используйте HTTPS; HTTP разрешён только на loopback.',
  ],
};

// Server codes and reasons of the error contract (ADR 0051), most specific first.
const server: Readonly<Record<string, Text>> = {
  'invalid_input/validation': [
    'The server rejected a value; see details in --json output.',
    'Сервер отклонил значение; подробности — в выводе --json.',
  ],
  'invalid_input/body_too_large': [
    'The request body is too large.',
    'Тело запроса слишком велико.',
  ],
  'invalid_input/method_not_allowed': [
    'The server does not offer this operation. Check client and server versions.',
    'Сервер не предоставляет эту операцию. Проверьте версии клиента и сервера.',
  ],
  invalid_input: ['Check the command values.', 'Проверьте значения команды.'],
  'not_found/route_not_found': [
    'The server does not offer this operation. Check the URL and server version.',
    'Сервер не предоставляет эту операцию. Проверьте адрес и версию сервера.',
  ],
  not_found: [
    'The repository, artifact or version does not exist or is not visible to this key.',
    'Репозиторий, артефакт или версия не существует либо недоступны этому ключу.',
  ],
  'conflict/upload_expired': [
    'The upload expired. Start again with a new --state.',
    'Срок загрузки истёк. Начните заново с новым --state.',
  ],
  'conflict/revision_mismatch': [
    'The resource changed meanwhile. Read the current revision and repeat with it.',
    'Ресурс изменился. Прочитайте текущую ревизию и повторите с ней.',
  ],
  'conflict/version_exists': [
    'This package version already exists with other content. Publish a new version.',
    'Такая версия пакета уже есть с другим содержимым. Опубликуйте новую версию.',
  ],
  conflict: [
    'The request conflicts with the current state. Read it again and repeat.',
    'Запрос противоречит текущему состоянию. Прочитайте его снова и повторите.',
  ],
  'unauthorized/session_expired': [
    'The session expired. Sign in again.',
    'Сеанс истёк. Войдите снова.',
  ],
  'unauthorized/token_expired': [
    'The key expired. Issue a new key and update the token file.',
    'Срок ключа истёк. Выпустите новый ключ и обновите файл ключа.',
  ],
  unauthorized: [
    'The key is missing, invalid or revoked. Check ARKVORY_TOKEN_FILE or the profile.',
    'Ключ отсутствует, недействителен или отозван. Проверьте ARKVORY_TOKEN_FILE или профиль.',
  ],
  'forbidden/read_only_token': [
    'The token is read-only. Use a read-write token.',
    'Токен только для чтения. Используйте токен с записью.',
  ],
  forbidden: [
    'The key lacks the permission for this repository and action.',
    'У ключа нет права на это действие в репозитории.',
  ],
  'capacity_exceeded/storage_quota': [
    'The repository quota is used up. Delete old builds or raise the quota.',
    'Квота репозитория исчерпана. Удалите старые сборки или увеличьте квоту.',
  ],
  'capacity_exceeded/storage_full': [
    'The server disk is full. Contact the administrator.',
    'Диск сервера заполнен. Обратитесь к администратору.',
  ],
  'capacity_exceeded/queue_full': [
    'The server queue is full. Repeat later.',
    'Очередь сервера заполнена. Повторите позже.',
  ],
  capacity_exceeded: [
    'A server limit was reached; see reason. Free capacity or contact the administrator.',
    'Достигнут лимит сервера (см. reason). Освободите ресурс или обратитесь к администратору.',
  ],
  integrity_mismatch: [
    'The bytes do not match the declared size or SHA-256. Repeat with the original file.',
    'Байты не совпадают с объявленным размером или SHA-256. Повторите с исходным файлом.',
  ],
  busy: ['The server is busy. Repeat after the delay.', 'Сервер занят. Повторите после паузы.'],
  unavailable: [
    'The server is temporarily unavailable. Repeat later; check upload status first.',
    'Сервер временно недоступен. Повторите позже; сначала проверьте статус загрузки.',
  ],
  rate_limited: [
    'Too many attempts. Wait and repeat.',
    'Слишком много попыток. Подождите и повторите.',
  ],
  read_only: [
    'This server only serves downloads. Use the writer address for changes.',
    'Этот сервер только раздаёт файлы. Для изменений используйте основной адрес.',
  ],
  internal: [
    'Unexpected server error. Report the request ID to the administrator.',
    'Непредвиденная ошибка сервера. Сообщите администратору ID запроса.',
  ],
};
const http: Text = [
  'The HTTP answer has no Arkvory error body; check proxies and the server URL.',
  'HTTP-ответ без тела ошибки Arkvory; проверьте прокси и адрес сервера.',
];
const fallback: Text = ['See arkvoryctl --help.', 'См. arkvoryctl --help.'];

export function explain(
  failure: { readonly code: string; readonly serverCode?: string; readonly reason?: string },
  language: 'en' | 'ru',
): string {
  const index = language === 'ru' ? 1 : 0;
  const { code, serverCode, reason } = failure;
  const text =
    (serverCode !== undefined
      ? ((reason !== undefined ? server[`${serverCode}/${reason}`] : undefined) ??
        server[serverCode])
      : undefined) ??
    local[code] ??
    (code === 'http_error' ? http : undefined) ??
    // Generated option codes, e.g. missing_server or invalid_timeout.
    (code.startsWith('missing_') ? local['missing_option'] : undefined) ??
    (code.startsWith('invalid_') ? local['invalid_argument'] : undefined) ??
    fallback;
  return text[index];
}
