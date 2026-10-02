/** Mirror indicator of the connected repository (ADR 0058). */
export const mirrorEnglish = {
  mirrorBadge: 'Mirror',
  mirrorBehind: 'Mirror · syncing',
  mirrorFailing: 'Mirror · sync error',
  mirrorHelpLabel: 'About this mirror',
  mirrorDetails: 'Read-only copy of “{source}” from {upstream}, kept in sync by the server.',
  mirrorSynced: 'Last synchronized:',
  mirrorError: 'The last attempt failed ({code}); downloads keep working.',
  mirrorNever: 'not yet',
  mirrorImport: 'Imports',
  mirrorImportFailing: 'Imports · sync error',
  mirrorImportDetails:
    'Versions marked {stages} in “{source}” on {upstream} are copied here automatically. Later changes and deletions there do not affect them.',
};

export const mirrorRussian: Record<keyof typeof mirrorEnglish, string> = {
  mirrorBadge: 'Зеркало',
  mirrorBehind: 'Зеркало · синхронизация',
  mirrorFailing: 'Зеркало · ошибка синхронизации',
  mirrorHelpLabel: 'Об этом зеркале',
  mirrorDetails:
    'Копия «{source}» с {upstream} только для чтения; сервер поддерживает её актуальной.',
  mirrorSynced: 'Последняя синхронизация:',
  mirrorError: 'Последняя попытка не удалась ({code}); скачивание продолжает работать.',
  mirrorNever: 'ещё не было',
  mirrorImport: 'Импорт',
  mirrorImportFailing: 'Импорт · ошибка синхронизации',
  mirrorImportDetails:
    'Версии со стадией {stages} из «{source}» на {upstream} копируются сюда автоматически. Дальнейшие изменения и удаления там их не затрагивают.',
};
