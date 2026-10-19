/** What to do next after a failure of `tree` or `module`; [English, Russian]. */
export const treeExplanations: Readonly<Record<string, readonly [string, string]>> = {
  checksum_mismatch: [
    'A file did not match the published tree; the local file was left as it was. Repeat the command.',
    'Файл не совпал с опубликованным деревом; локальный файл не изменён. Повторите команду.',
  ],
  unsafe_name: [
    'A path holds a name Windows cannot store (device name, ":", trailing dot or space). Rename it.',
    'В пути есть имя, которое Windows не хранит (имя устройства, «:», точка или пробел в конце). Переименуйте.',
  ],
  case_collision: [
    'Two paths differ only in letter case; they would be one file on Windows and macOS.',
    'Два пути отличаются только регистром; в Windows и macOS это один файл.',
  ],
  duplicate_entry: ['The archive lists one path twice.', 'В архиве один путь указан дважды.'],
  tree_entry_unsupported: [
    'The folder holds a link, device or pipe. Trees keep regular files only.',
    'В каталоге есть ссылка, устройство или канал. Дерево хранит только обычные файлы.',
  ],
  unsupported_entry: [
    'The archive holds a link or an encrypted entry; it is not extracted.',
    'В архиве есть ссылка или зашифрованная запись; он не распаковывается.',
  ],
  unsupported_method: [
    'An entry uses a compression method other than stored or deflate.',
    'Запись сжата методом, отличным от stored и deflate.',
  ],
  not_archive: ['The artifact is not a ZIP archive.', 'Артефакт — не ZIP-архив.'],
  invalid_archive: ['The ZIP archive is damaged.', 'ZIP-архив повреждён.'],
  too_many_entries: ['The archive has more than 100,000 files.', 'В архиве больше 100 000 файлов.'],
  too_large: [
    'The files of the archive add up to more than 100 GiB.',
    'Файлы архива вместе больше 100 ГиБ.',
  ],
  path_conflict: [
    'A directory, or something other than a folder, stands where the tree needs a file or a folder.',
    'На месте файла или каталога дерева находится каталог или не каталог.',
  ],
  tree_changed: [
    'The table of contents changed while it was read. Repeat the command.',
    'Оглавление изменилось во время чтения. Повторите команду.',
  ],
  invalid_tree_name: [
    'The artifact name must end with .zip.',
    'Имя артефакта должно оканчиваться на .zip.',
  ],
  stale_revocations: [
    'No current revocation list. Store one with arkvoryctl module revocations FILE.',
    'Нет актуального списка отзыва. Сохраните его: arkvoryctl module revocations FILE.',
  ],
  module_revoked: [
    'This module version is revoked. Install the version its publisher names.',
    'Эта версия модуля отозвана. Установите версию, указанную издателем.',
  ],
  module_not_installed: ['No such module is installed.', 'Такой модуль не установлен.'],
  module_enabled_everywhere: [
    'The module is enabled for every profile. Disable it without --profile first.',
    'Модуль включён для всех профилей. Сначала выключите его без --profile.',
  ],
  side_mismatch: [
    'This package is for the server (arkvory module install), not for arkvoryctl.',
    'Этот пакет для сервера (arkvory module install), а не для arkvoryctl.',
  ],
  transfer_unavailable: [
    'With --transfer strict, no client module transfer the server offers was available.',
    'При --transfer strict не нашлось расширения передачи, которое предлагает сервер.',
  ],
  module_access: [
    'Another account may change the modules folder or a module, or it holds a link. Keep the CLI folder private to you.',
    'Каталог модулей или модуль может изменить другая учётная запись, либо в нём ссылка. Закройте каталог CLI для других.',
  ],
  module_access_unverified: [
    'The access rules of the modules folder could not be read (Windows PowerShell). No module was loaded.',
    'Не удалось прочитать права каталога модулей (Windows PowerShell). Модули не загружены.',
  ],
  invalid_module_set: [
    'modules/installed.json in the CLI folder is damaged. Reinstall the modules.',
    'Файл modules/installed.json в каталоге CLI повреждён. Установите модули заново.',
  ],
};
