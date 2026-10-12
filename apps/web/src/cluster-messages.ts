/** The Cluster page of an HA installation (ADR 0072). */
export const clusterEnglish = {
  cluster: 'Cluster',
  clusterIntro:
    'This server runs as a high-availability cluster: every write is kept on more than one node before it is confirmed. This page refreshes on its own.',
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
    'Every copy is complete: a node can fail without losing confirmed writes. Before maintenance of the serving node, move Arkvory to another node. On the serving node, run:',
  clusterDegraded:
    'Writes are stopped until the missing copy is back; downloads keep working. Bring the node back, or replace it with a new one (see the guide). Only if you accept losing writes on a second failure, allow one copy for a limited time. On the serving node, run:',
  clusterSingle:
    'Writes are confirmed with one copy: a second failure loses them. The decision ends by itself once the copy is back. To end it now, on the serving node run:',
  clusterUnknown:
    'The server cannot read the state of its copies, so writes are stopped. On the serving node, check the arkvory-replica service:',
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
  clusterIntro:
    'Сервер работает как кластер высокой доступности: каждая запись хранится больше чем на одном узле, прежде чем подтверждается. Страница обновляется сама.',
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
  clusterHealthy:
    'Все копии полные: отказ узла не теряет подтверждённых записей. Перед обслуживанием рабочего узла перенесите Arkvory на другой узел. На рабочем узле выполните:',
  clusterDegraded:
    'Запись остановлена, пока не вернётся недостающая копия; скачивание работает. Верните узел или замените его новым (см. руководство). Только если вы готовы потерять записи при втором отказе, разрешите одну копию на ограниченное время. На рабочем узле выполните:',
  clusterSingle:
    'Записи подтверждаются одной копией: второй отказ их потеряет. Решение закончится само, когда копия вернётся. Чтобы закончить сейчас, на рабочем узле выполните:',
  clusterUnknown:
    'Сервер не может прочитать состояние копий, поэтому запись остановлена. На рабочем узле проверьте службу arkvory-replica:',
  clusterOld:
    'Сведения об узлах появятся, когда все узлы обновятся до этого выпуска. Копии и запись выше актуальны.',
  clusterGuide: 'Руководство по кластеру',
  clusterReplaceGuide: 'Замена узла',
  clusterUnavailable: 'Не удалось прочитать состояние кластера. Повторяем автоматически.',
  clusterOpen: 'Открыть страницу кластера',
  replicationReaders:
    'Загрузка приостановлена, пока сервер восстанавливает копию данных. Скачивание работает.',
};
