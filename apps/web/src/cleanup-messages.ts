export const cleanupEnglish = {
  cleanupTitle: 'Physical cleanup',
  cleanupHelp:
    'Frees disk space without stopping Arkvory. Active transfers and pinned files are deferred. Enable only after every Arkvory server is updated, including read servers and background processors. Pausing finishes the current file. The grace period is not a recycle bin.',
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
    'Last batch: freed {bytes} · processed {collected} · deferred {deferred} · failed {failed}',
  cleanupLastRun: 'Last completed batch:',
  cleanupPaused: 'Cleanup is paused.',
  cleanupScheduled: 'Background cleanup is enabled.',
};
export const cleanupRussian: Record<keyof typeof cleanupEnglish, string> = {
  cleanupTitle: 'Физическая очистка',
  cleanupHelp:
    'Освобождает место на диске без остановки Arkvory. Активные передачи и закреплённые файлы откладываются. Включайте только после обновления всех серверов Arkvory, включая серверы чтения и фоновые обработчики. Пауза завершает текущий файл. Защитный срок не является корзиной.',
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
    'Последний проход: освобождено {bytes} · обработано {collected} · отложено {deferred} · ошибок {failed}',
  cleanupLastRun: 'Последний завершённый проход:',
  cleanupPaused: 'Очистка приостановлена.',
  cleanupScheduled: 'Фоновая очистка включена.',
};
