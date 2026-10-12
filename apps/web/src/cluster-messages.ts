/** The Cluster page of an HA installation (ADR 0072). */
export const clusterEnglish = {
  cluster: 'Cluster',
  clusterProfile: 'Layout',
  clusterProfileTwo: 'Two data nodes and a witness',
  clusterProfileThree: 'Three data nodes',
  clusterActive: 'Serving now',
  clusterCopies: 'Complete copies',
  clusterCopiesValue: '{copies} of {required} required',
  clusterWrites: 'Writes',
  clusterWritesOn: 'Accepted',
  clusterWritesOff: 'Stopped',
  clusterWritesSingle: 'Accepted with one copy until {until}',
  clusterNodes: 'Other nodes',
  clusterNode: 'Node',
  clusterRole: 'Role',
  clusterConnection: 'Connection',
  clusterCopy: 'Copy',
  clusterRoleData: 'Data copy',
  clusterRoleWitness: 'Witness (votes, holds no data)',
  clusterConnected: 'Connected',
  clusterDisconnected: 'Not connected',
  clusterCopyComplete: 'Complete',
  clusterCopySyncing: 'Catching up',
  clusterCopyMissing: 'Missing',
  clusterCopyNone: '—',
  clusterNoPeers: 'No other node is configured or connected.',
  clusterNextStep: 'Next step',
  clusterHealthy:
    'All copies are complete. Before maintaining the serving node, move Arkvory away from it:',
  clusterDegraded:
    'Writes are paused until the copy is back: return the node or replace it. To accept writes with one copy for a while (a second failure loses them), on the serving node:',
  clusterSingle:
    'Writes are confirmed with one copy until the copy is back. To end it now, on the serving node:',
  clusterUnknown:
    'The state of the copies cannot be read, so writes are paused. On the serving node, check:',
  clusterOld:
    'Node details appear after every node runs this release. Copies and writes above are current.',
  clusterGuide: 'Cluster guide',
  clusterReplaceGuide: 'Replace a node',
  clusterUnavailable: 'Cannot read the cluster state. Retrying automatically.',
  clusterOpen: 'Open the cluster page',
  replicationReaders:
    'Uploads are paused while the server restores a copy of its data. Downloads keep working.',
};

export const clusterRussian: Record<keyof typeof clusterEnglish, string> = {
  cluster: 'Кластер',
  clusterProfile: 'Схема',
  clusterProfileTwo: 'Два узла с данными и свидетель',
  clusterProfileThree: 'Три узла с данными',
  clusterActive: 'Сейчас обслуживает',
  clusterCopies: 'Полных копий',
  clusterCopiesValue: '{copies} из {required} нужных',
  clusterWrites: 'Запись',
  clusterWritesOn: 'Принимается',
  clusterWritesOff: 'Остановлена',
  clusterWritesSingle: 'Принимается с одной копией до {until}',
  clusterNodes: 'Другие узлы',
  clusterNode: 'Узел',
  clusterRole: 'Роль',
  clusterConnection: 'Связь',
  clusterCopy: 'Копия',
  clusterRoleData: 'Копия данных',
  clusterRoleWitness: 'Свидетель (голосует, данных не хранит)',
  clusterConnected: 'Есть',
  clusterDisconnected: 'Нет',
  clusterCopyComplete: 'Полная',
  clusterCopySyncing: 'Догоняет',
  clusterCopyMissing: 'Нет',
  clusterCopyNone: '—',
  clusterNoPeers: 'Другие узлы не настроены или не подключены.',
  clusterNextStep: 'Что дальше',
  clusterHealthy: 'Все копии полные. Перед обслуживанием рабочего узла перенесите с него Arkvory:',
  clusterDegraded:
    'Запись приостановлена до возврата копии: верните узел или замените его. Чтобы временно принимать запись с одной копией (второй отказ её потеряет), на рабочем узле:',
  clusterSingle:
    'Запись подтверждается одной копией, пока копия не вернётся. Чтобы закончить сейчас, на рабочем узле:',
  clusterUnknown:
    'Состояние копий не читается, поэтому запись приостановлена. На рабочем узле проверьте:',
  clusterOld:
    'Сведения об узлах появятся, когда все узлы обновятся до этого выпуска. Копии и запись выше актуальны.',
  clusterGuide: 'Руководство по кластеру',
  clusterReplaceGuide: 'Замена узла',
  clusterUnavailable: 'Не удалось прочитать состояние кластера. Повторяем автоматически.',
  clusterOpen: 'Открыть страницу кластера',
  replicationReaders:
    'Загрузка приостановлена, пока сервер восстанавливает копию данных. Скачивание работает.',
};
