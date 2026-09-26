export function help(language: 'en' | 'ru'): string {
  const ru = language === 'ru';
  return `ProAnima Arkvory · arkvoryctl
${ru ? 'Удалённый клиент хранилища для людей и CI/CD.' : 'Remote storage client for people and CI/CD.'}

${ru ? 'НАЧАЛО РАБОТЫ' : 'GET STARTED'}
  arkvoryctl profile add production --server https://arkvory.example --token-file /private/arkvory.key
  arkvoryctl doctor
  arkvoryctl packages publish build.upack --label test --json
  arkvoryctl download ARTIFACT_ID ./build.upack

${ru ? 'КОМАНДЫ' : 'COMMANDS'}
  profile add NAME --server URL [--token-file PATH] [--repository NAME]
  profile list | use NAME | remove NAME
  doctor                                      ${ru ? 'Подключение, возможности и права' : 'Connection, capabilities and permissions'}
  repositories [--after CURSOR]
  operations [--after CURSOR]                  ${ru ? 'Доступные операции API' : 'Available API operations'}
  list [--after CURSOR]
  search [--query TEXT] [--label TAG] [--collection NAME] [--after CURSOR]
  search --metadata-key KEY --metadata-value VALUE
  inspect ID
  upload FILE [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]
  download ID OUTPUT
  uploads status ID | cancel ID
  packages list [--group GROUP] [--name NAME] [--after CURSOR]
  packages publish FILE [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]
  packages register ID                        ${ru ? 'Индексировать загруженный UPack' : 'Index an uploaded UPack'}
  annotations get ID
  annotations set ID --revision N --file ANNOTATIONS.json
  attachments get ID | history ID
  attachments set ID --revision N --file ATTACHMENTS.json
  storage usage | policy

${ru ? 'ОБЩИЕ ПАРАМЕТРЫ' : 'GLOBAL OPTIONS'}
  --profile NAME  --repository NAME  --json  --lang en|ru  --help  --version
  --timeout MS (60000)  --attempt-timeout MS (120000)  --retries N (20)
  -- ${ru ? 'завершает разбор параметров (для имён файлов с дефисом)' : 'ends option parsing (for filenames starting with a dash)'}

${ru ? 'АВТОРИЗАЦИЯ' : 'AUTHENTICATION'}
  ARKVORY_TOKEN / ARKVORY_TOKEN_FILE; ARKVORY_BASE_URL; ARKVORY_CLI_HOME
  ${ru ? 'Ключ не передаётся аргументом. Профили хранят только путь к ключу.' : 'Keys are never command arguments. Profiles store only the credential file path.'}
  ${ru ? 'При ARKVORY_BASE_URL нужен ключ из окружения; ключ профиля не используется.' : 'ARKVORY_BASE_URL requires an environment credential; profile credentials are not reused.'}

${ru ? 'ПРОДОЛЖЕНИЕ ПЕРЕДАЧИ' : 'RESUMING TRANSFERS'}
  ${ru ? 'После Ctrl+C или обрыва повторите ту же команду с теми же параметрами.' : 'After Ctrl+C or a network failure, repeat the same command with the same options.'}
  ${ru ? 'Upload сохраняет чекпойнт рядом с исходным файлом; download — рядом с результатом.' : 'Upload keeps a checkpoint beside the source; download keeps staging beside the destination.'}
  ${ru ? 'Существующие файлы не перезаписываются. Готовый файл проверен по SHA-256.' : 'Existing files are never overwritten. Completed downloads are SHA-256 verified.'}
  ${ru ? 'После аварийного завершения .lock снимается вручную только при отсутствии работающего процесса.' : 'After a hard crash, remove .lock manually only after confirming the owning process has stopped.'}

${ru ? 'КОДЫ ВЫХОДА' : 'EXIT CODES'}
  0 OK; 2 ${ru ? 'параметры' : 'usage'}; 3 ${ru ? 'доступ' : 'access'}; 4 HTTP/network;
  5 SHA-256; 6 ${ru ? 'конфликт' : 'conflict'}; 7 ${ru ? 'локальная ошибка/протокол' : 'local/protocol error'}; 130 Ctrl+C
  ${ru ? 'JSON: результат — stdout, ошибки — stderr. Страницы возвращают next; используйте --after.' : 'JSON: result on stdout, errors on stderr. Pages return next; pass it using --after.'}

${ru ? 'Полная справка и форматы JSON: docs/CLI.md в репозитории ProAnima/Arkvory.' : 'Full reference and JSON formats: docs/CLI.md in ProAnima/Arkvory.'}
`;
}
