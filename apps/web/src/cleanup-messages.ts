export const cleanupEnglish = {
  cleanupTitle: 'Physical cleanup',
  cleanupHelp:
    'Reclaim retired files without stopping Depot. Active transfers and pinned files are deferred. Enable only after upgrading every gateway and worker. Pausing finishes the current file. A grace period is not a recycle bin.',
  cleanupEnabled: 'Enable background cleanup',
  cleanupGrace: 'Grace period after deletion (hours)',
  cleanupBatch: 'Files per batch',
  cleanupInterval: 'Interval between batches (seconds)',
  cleanupDelay: 'Delay between files (milliseconds)',
  cleanupRefresh: 'Refresh cleanup status',
  cleanupSave: 'Apply settings',
  cleanupRun: 'Request a batch',
  cleanupSaved: 'Cleanup settings applied.',
  cleanupRequested: 'Batch requested. Refresh status to see its result.',
  cleanupStats:
    'Last batch: reclaimed {bytes} B · processed {collected} · deferred {deferred} · failed {failed}',
  cleanupLastRun: 'Last completed batch',
  cleanupPaused: 'Cleanup is paused.',
  cleanupScheduled: 'Background cleanup is enabled.',
};
export const cleanupRussian: Record<keyof typeof cleanupEnglish, string> = {
  cleanupTitle: 'Физическая очистка',
  cleanupHelp:
    'Освобождает место без остановки Depot. Активные передачи и закреплённые файлы откладываются. Включайте после обновления всех gateways и workers. Пауза завершает текущий файл. Защитный срок не является корзиной восстановления.',
  cleanupEnabled: 'Включить фоновую очистку',
  cleanupGrace: 'Защитный срок после удаления (часы)',
  cleanupBatch: 'Файлов за проход',
  cleanupInterval: 'Интервал между проходами (секунды)',
  cleanupDelay: 'Пауза между файлами (миллисекунды)',
  cleanupRefresh: 'Обновить состояние очистки',
  cleanupSave: 'Применить настройки',
  cleanupRun: 'Запросить проход',
  cleanupSaved: 'Настройки очистки применены.',
  cleanupRequested: 'Проход запрошен. Обновите состояние, чтобы увидеть результат.',
  cleanupStats:
    'Последний проход: освобождено {bytes} Б · обработано {collected} · отложено {deferred} · ошибок {failed}',
  cleanupLastRun: 'Последний завершённый проход',
  cleanupPaused: 'Очистка приостановлена.',
  cleanupScheduled: 'Фоновая очистка включена.',
};
