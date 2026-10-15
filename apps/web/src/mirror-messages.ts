/** Mirrors (ADR 0058): the badge of the connected repository and the Mirrors page. */
export const mirrorEnglish = {
  mirrorBadge: 'Mirror',
  mirrorBehind: 'Mirror · syncing',
  mirrorFailing: 'Mirror · sync error',
  mirrorHelpLabel: 'About this mirror',
  mirrorDetails: 'Read-only copy of “{source}” from {upstream}, kept in sync by the server.',
  mirrorSynced: 'Last synchronized:',
  mirrorNever: 'not yet',
  mirrorImport: 'Import',
  mirrorImportFailing: 'Import · sync error',
  mirrorImportDetails:
    'Versions marked {stages} in “{source}” on {upstream} are copied here automatically. Later changes and deletions there do not affect them.',
  mirrorProblem: 'Synchronization stopped. Downloads keep working.',
  mirrorFixLink: 'What to do',
  // What stopped the synchronization, and the next step.
  mirrorReasonUnauthorized:
    'The source no longer accepts this server’s key. An administrator gives the mirror a new key:',
  mirrorReasonForbidden:
    'The key of this mirror cannot read “{source}” on {upstream}. Give it read access there.',
  mirrorReasonNotFound:
    '{upstream} has no repository “{source}”. Check that it was not renamed or deleted there.',
  mirrorReasonUnreachable:
    '{upstream} cannot be reached. The server keeps retrying; check the network and that the source is running.',
  mirrorReasonCertificate:
    'The certificate of {upstream} is not trusted here. Add its certificate authority:',
  mirrorReasonCapacity:
    'This server has no room for the next file. Free space or raise the storage limit; copying resumes by itself.',
  mirrorReasonSourceBehind:
    'The source was restored from a backup, so the mirror reads it again. Nothing to do: this clears once it has caught up.',
  mirrorReasonMismatch:
    'A file here differs from the source under the same ID. Find out why before deleting either copy.',
  mirrorReasonSourceChanged:
    'This repository already holds a copy of another source. Mirror the new source into a new repository.',
  mirrorReasonDeleteBlocked:
    'The source deleted a file that is still used here, for example by a file path. It stays here.',
  mirrorReasonDetached:
    'This repository was detached and has changes of its own; it is never synchronized again. Mirror the source into a new repository.',
  mirrorReasonPackage:
    'A version of the source has a package version that this repository holds with other bytes. Remove the stage or the version on the source, or publish it under another version.',
  mirrorReasonIdTaken:
    'A file of the source is held by another repository here. One source repository can fill only one repository.',
  mirrorReasonOther:
    'The last attempt failed ({code}). The server retries by itself; its log names the cause.',
  // Entries put aside on a conflict while the rest of the feed goes on.
  mirrorConflicts:
    'Set aside: {count}. These entries of the source conflict with what is here and are not copied; everything else keeps syncing, and the server retries them.',
  // The Mirrors page.
  mirrors: 'Mirrors',
  mirrorsRepository: 'Repository',
  mirrorsSource: 'Source',
  mirrorsState: 'State',
  mirrorsLastSync: 'Last synchronized',
  mirrorsCopied: 'Copied',
  mirrorsCopiedValue: '{count} files · {size}',
  mirrorsSourceValue: '“{source}” on {upstream}',
  mirrorsModeMirror: 'Read-only mirror',
  mirrorsModeImport: 'Imports versions marked {stages}',
  mirrorStateSynced: 'In sync',
  mirrorStateBehind: 'Catching up',
  mirrorStatePending: 'Starting',
  mirrorStateSeeding: 'First copy',
  mirrorStateFailing: 'Sync error',
  mirrorsEmptyTitle: 'No mirrors on this server',
  mirrorsEmpty:
    'A mirror copies a repository from another installation: a second site, or staging to production. Set one up with “arkvory configure --mirror”.',
  mirrorsGuide: 'Mirrors guide',
};

export const mirrorRussian: Record<keyof typeof mirrorEnglish, string> = {
  mirrorBadge: 'Зеркало',
  mirrorBehind: 'Зеркало · синхронизация',
  mirrorFailing: 'Зеркало · ошибка синхронизации',
  mirrorHelpLabel: 'Об этом зеркале',
  mirrorDetails:
    'Копия «{source}» с {upstream} только для чтения; сервер поддерживает её актуальной.',
  mirrorSynced: 'Последняя синхронизация:',
  mirrorNever: 'ещё не было',
  mirrorImport: 'Импорт',
  mirrorImportFailing: 'Импорт · ошибка синхронизации',
  mirrorImportDetails:
    'Версии со стадией {stages} из «{source}» на {upstream} копируются сюда автоматически. Дальнейшие изменения и удаления там их не затрагивают.',
  mirrorProblem: 'Синхронизация остановлена. Скачивание продолжает работать.',
  mirrorFixLink: 'Что делать',
  mirrorReasonUnauthorized:
    'Источник больше не принимает ключ этого сервера. Администратор выдаёт зеркалу новый ключ:',
  mirrorReasonForbidden:
    'Ключ зеркала не может читать «{source}» на {upstream}. Выдайте ему там право чтения.',
  mirrorReasonNotFound:
    'На {upstream} нет репозитория «{source}». Проверьте, что его там не переименовали и не удалили.',
  mirrorReasonUnreachable:
    '{upstream} недоступен. Сервер повторяет попытки сам; проверьте сеть и что источник работает.',
  mirrorReasonCertificate:
    'Сертификату {upstream} здесь не доверяют. Добавьте его центр сертификации:',
  mirrorReasonCapacity:
    'На этом сервере нет места для следующего файла. Освободите место или поднимите лимит хранения; копирование продолжится само.',
  mirrorReasonSourceBehind:
    'Источник восстановлен из резервной копии, поэтому зеркало читает его заново. Ничего делать не нужно: сообщение исчезнет, когда зеркало догонит источник.',
  mirrorReasonMismatch:
    'Файл здесь отличается от источника при том же ID. Выясните причину, прежде чем удалять любую из копий.',
  mirrorReasonSourceChanged:
    'Этот репозиторий уже хранит копию другого источника. Зеркалируйте новый источник в новый репозиторий.',
  mirrorReasonDeleteBlocked:
    'Источник удалил файл, который здесь ещё используется, например путём файла. Здесь он остаётся.',
  mirrorReasonDetached:
    'Репозиторий отсоединён и содержит собственные изменения; он больше не синхронизируется. Зеркалируйте источник в новый репозиторий.',
  mirrorReasonPackage:
    'У версии источника та же версия пакета, что здесь хранится с другими байтами. Снимите стадию или удалите версию в источнике либо опубликуйте её под другой версией.',
  mirrorReasonIdTaken:
    'Файл источника уже хранит другой репозиторий этого сервера. Один репозиторий источника наполняет только один репозиторий.',
  mirrorReasonOther:
    'Последняя попытка не удалась ({code}). Сервер повторит сам; причина — в его журнале.',
  mirrorConflicts:
    'Отложено: {count}. Эти записи источника конфликтуют с тем, что есть здесь, и не копируются; остальное продолжает синхронизироваться, а сервер повторяет их сам.',
  mirrors: 'Зеркала',
  mirrorsRepository: 'Репозиторий',
  mirrorsSource: 'Источник',
  mirrorsState: 'Состояние',
  mirrorsLastSync: 'Последняя синхронизация',
  mirrorsCopied: 'Скопировано',
  mirrorsCopiedValue: 'Файлов: {count} · {size}',
  mirrorsSourceValue: '«{source}» на {upstream}',
  mirrorsModeMirror: 'Зеркало только для чтения',
  mirrorsModeImport: 'Импорт версий со стадией {stages}',
  mirrorStateSynced: 'Синхронизировано',
  mirrorStateBehind: 'Догоняет',
  mirrorStatePending: 'Запускается',
  mirrorStateSeeding: 'Первое копирование',
  mirrorStateFailing: 'Ошибка синхронизации',
  mirrorsEmptyTitle: 'На этом сервере нет зеркал',
  mirrorsEmpty:
    'Зеркало копирует репозиторий другой установки: вторая площадка или путь из стейджинга в прод. Настраивается командой «arkvory configure --mirror».',
  mirrorsGuide: 'Руководство по зеркалам',
};
