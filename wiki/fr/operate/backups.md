---
title: Sauvegardes
description: 'Connectez un stockage de sauvegardes, planifiez et vérifiez les sauvegardes, restaurez un point de restauration dans un serveur vide et testez régulièrement la restauration.'
---

# Sauvegardes

L’agent de sauvegarde copie la base de données et les fichiers stockés de votre installation dans un **stockage des sauvegardes** : un répertoire sur un autre disque ou sur un partage réseau. Il fonctionne pendant que les utilisateurs continuent de téléverser et de télécharger. Chaque sauvegarde terminée est un **point de restauration** que vous pouvez vérifier et restaurer.

Cette page couvre le stockage des sauvegardes, le plan, la rétention, la vérification, les écrans d’état et la procédure de restauration. La restauration est une commande que vous exécutez sur le serveur. La console n’a pas de bouton de restauration.

## Fonctionnement des sauvegardes {#how-backups-work}

L’agent est le troisième service d’une installation, à côté de l’API et du worker. Il s’appelle `arkvory-backup` sous Linux, `Arkvorybackup` sous Windows et `backup` dans Docker Compose. Un seul agent travaille à la fois. Un second agent attend et prend le relais lorsque le premier s’arrête.

L’agent fait trois choses :

- Il exécute le plan quotidien lorsque le plan est activé.
- Il exécute les tâches que vous demandez dans la console, avec `arkvoryctl` ou via l’API.
- Il vérifie chaque nouveau point de restauration et applique la rétention.

Un point de restauration contient l’état publié de l’installation à un instant **T**, l’heure de l’instantané. Les fichiers publiés après T vont dans la sauvegarde suivante. La console calcule l’âge d’une sauvegarde à partir de T, non à partir du moment où la copie s’est terminée.

Gardez ces faits à l’esprit :

- Une sauvegarde n’arrête ni les téléversements ni les téléchargements. Pendant son exécution, le nettoyage physique laisse les fichiers dont la sauvegarde a besoin et les supprime lors d’une passe ultérieure.
- Un fichier n’est stocké qu’une fois dans le stockage des sauvegardes, quel que soit le nombre de points de restauration qui le contiennent. La première sauvegarde copie tout, donc avec des téraoctets de contenu, elle prend beaucoup de temps. Les sauvegardes suivantes ne copient que les nouveaux fichiers.
- Un point de restauration n’apparaît que lorsque sa copie est terminée. Une sauvegarde échouée ou interrompue n’endommage jamais les points de restauration antérieurs.
- Une sauvegarde n’est ni un système de restauration à un instant précis ni une haute disponibilité. Vous restaurez l’état à un point de restauration donné, et vous perdez les changements survenus après son T.

## Contenu d’une sauvegarde {#contents}

Un point de restauration contient :

- Les tables du catalogue de la base de données : artefacts, paquets, chemins de fichiers et leur historique, étiquettes et métadonnées, étapes, pièces jointes, comptes, groupes et autorisations, comptes de service et clés, les pistes d’audit, les politiques de stockage et de nettoyage, les données de registre d’images de conteneurs, Git LFS et npm, et l’état des miroirs.
- Le contenu de chaque fichier publié.

Un point de restauration ne contient pas :

- Les sessions de connexion, les liens de téléchargement et l’état d’exécution des passerelles de lecture.
- Les téléversements non terminés. Une restauration les annule, et les clients les recommencent.
- Le plan de sauvegarde et l’état de l’agent. Une installation restaurée démarre avec les sauvegardes désactivées.
- Le répertoire `config/` de l’installation : paramètres, fichiers TLS, clés de miroir, clé de récupération. Conservez vous-même des copies de ces fichiers.
- Les programmes Arkvory. Installez d’abord une version, puis restaurez.

## Préparer le stockage des sauvegardes {#vault}

### Exigences {#vault-requirements}

| Exigence                                                                                                                       | Pourquoi                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Un répertoire nouveau ou vide, monté avant le démarrage des services                                                           | L’agent y écrit `vault.json` et les points de restauration                                                                                            |
| En dehors du répertoire d’installation et du répertoire de stockage, y compris via des liens, des jonctions et des noms courts | Un stockage des sauvegardes placé dans le stockage est perdu avec lui. La vérification refuse un chemin qui les contient ou se trouve à l’intérieur   |
| Accessible en écriture au compte de service                                                                                    | Sous Linux, `arkvory`. Sous Windows, `NT AUTHORITY\LocalService`. `arkvory configure` définit les droits pour vous                                    |
| Au moins 1 GiB d’espace libre au-delà des données copiées                                                                      | Le stockage des sauvegardes conserve cette réserve. Un volume plein termine la sauvegarde avec `vault_full`, et les points antérieurs restent intacts |
| Sous Linux, pas sous `/home`, `/root`, `/run/user`, `/tmp` ou `/var/tmp`                                                       | Le bac à sable du service masque ces arborescences                                                                                                    |
| Sous Windows, un volume local ou iSCSI avec une lettre de lecteur                                                              | `LocalService` ne peut pas se connecter aux partages SMB, donc les chemins comme `\\nas\share` sont refusés                                           |

Utilisez un volume sur un autre disque, ou sur un NAS, pour qu’une panne du disque de stockage n’emporte pas les sauvegardes. Un stockage des sauvegardes sur le même disque physique que le stockage protège contre les erreurs, pas contre une panne de disque.

**Le vault est chiffré par défaut.** Arkvory chiffre les fichiers, le catalogue et les descriptions des points (voir [Chiffrer le vault](#encryption)). Un vault créé sans chiffrement contient en clair le catalogue, les empreintes de mots de passe et tous les fichiers publiés : placez-le sur un volume chiffré (LUKS, BitLocker, chiffrement du NAS) et n'autorisez l'accès qu'au compte de service et à l'administrateur des sauvegardes.

### Chiffrer le vault {#encryption}

Un vault est chiffré à sa création et le reste. Arkvory chiffre le contenu des fichiers, le catalogue et les descriptions des points avec AES-256-GCM, et détecte à la lecture un fichier modifié, coupé ou remplacé. Il ne cache ni les noms des fichiers, ni leurs tailles, ni le nombre de points.

Créez le vault sur le serveur avec le programme `arkvory-backup` (voir [Avant de commencer](#restore-prepare)). Les deux fichiers doivent être nouveaux et situés hors du vault et du stockage :

```bash
arkvory-backup vault init /mnt/backup/arkvory \
  --kit-file /root/arkvory-recovery-kit.txt \
  --agent-key-file /root/arkvory-agent.key
```

1. La commande crée le vault avec deux clés : la clé de l’agent (`arkvory-agent.key`) et la clé de récupération dans le kit de récupération. Elle ouvre le vault avec chacune avant d'annoncer le succès.
2. Sortez dès maintenant le kit de récupération de ce serveur : dans un gestionnaire de mots de passe ou un coffre. Sans le kit ni la clé de l’agent, personne ne peut lire les sauvegardes, et personne ne peut les restaurer à votre place. Quiconque possède le kit et une copie du vault peut lire toutes les sauvegardes qu'il contient.
3. Connectez le vault avec la clé de l’agent, comme le montre la section suivante, et supprimez votre copie du fichier de clé. L'installation garde sa propre copie dans `config/backup/vault.key`, lisible uniquement par le compte de service.

La clé de récupération du kit n’ouvre que ce vault. Ce n’est pas la clé de récupération de l’installation (`config/bootstrap-token.txt`).

Vérifiez que le kit ouvre le vault maintenant, puis après chaque changement de clés :

```bash
arkvory-backup vault key verify --vault /mnt/backup/arkvory --key-file /root/arkvory-recovery-kit.txt
```

Une clé appartient à un emplacement, et chaque emplacement ouvre le vault avec sa propre clé. Ces commandes modifient les emplacements. Aucune n'affiche de clé :

| Commande                                                                 | Effet                                                                                                                       |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `vault key list --vault DIR`                                             | Liste les emplacements : identifiant, type (`agent` ou `recovery`) et date de création. Aucune clé n'est nécessaire.        |
| `vault key add-recovery --vault DIR --key-file KEY --kit-file NEW`       | Ajoute un emplacement de récupération et écrit son kit, pour une autre personne ou un autre coffre.                         |
| `vault key rotate-agent --vault DIR --key-file KEY --agent-key-file NEW` | Crée une nouvelle clé de l’agent et supprime l'ancienne. Lancez ensuite `arkvory configure` avec le nouveau fichier de clé. |
| `vault key remove --vault DIR --key-file KEY --slot ID`                  | Supprime un emplacement. Le dernier emplacement et le dernier emplacement de récupération restent.                          |

Supprimer un emplacement ferme le vault à qui n'a que cette clé. Cela ne rechiffre pas les points précédents : qui a copié le vault et une clé auparavant lit toujours cette copie. Si une clé a pu fuiter, créez un nouveau vault avec de nouvelles clés et commencez-y de nouveaux points.

Un vault sans chiffrement est possible : `arkvory-backup vault init DIR --no-encryption`. Il contient en clair le catalogue, les empreintes de mots de passe et tous les fichiers ; il lui faut donc un volume chiffré et un accès réservé au compte de service.

### Connecter le stockage des sauvegardes {#connect-vault}

Exécutez la commande en tant que root ou administrateur, sur le serveur. Elle vérifie le répertoire avant de modifier quoi que ce soit.

```bash
sudo arkvory configure --root /opt/proanima-arkvory --backup-vault /mnt/backup/arkvory --vault-key-file /root/arkvory-agent.key
```

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' configure --root $root --backup-vault D:\Backup\Arkvory --vault-key-file C:\Private\arkvory-agent.key
```

Pour une installation par script sous Windows, démarrez `manage.mjs` comme décrit dans [Windows](../install/windows#manage-the-services).

1. La commande vérifie le chemin : absolu, répertoire existant accessible en écriture, en dehors de l’installation et du stockage, et visible par le service.
2. Un vault chiffré, le choix par défaut, existe déjà : vous l'avez créé avec `arkvory-backup vault init`, et `--vault-key-file` donne au service sa clé (une clé `AK1-…`, jamais la clé de récupération). Avec `--init-vault --vault-no-encryption`, elle crée à la place un vault sans chiffrement dans un répertoire **vide**. Elle n'initialise jamais deux fois un répertoire. Sans `vault.json` et sans `--init-vault`, elle refuse, pour qu'un NAS non monté ne soit pas pris pour un vault vide.
3. Elle donne l'accès au compte de service, copie la clé dans `config/backup/vault.key`, écrit `ARKVORY_BACKUP_VAULT` et `ARKVORY_BACKUP_VAULT_KEY_FILE` dans `config/runtime.json` et ne redémarre que l'agent.
4. Elle attend jusqu’à 150 secondes que l’agent signale ce stockage des sauvegardes comme disponible. Cette vérification lit `config/bootstrap-token.txt`, donc ne supprimez pas ce fichier.
5. Si quelque chose échoue, elle restaure les paramètres précédents et l’accès précédent, puis redémarre l’agent.

Pour utiliser un vault qui existe déjà, par exemple sur un nouveau serveur, donnez sa clé avec `--vault-key-file` et omettez `--init-vault`. Pour déconnecter le vault, utilisez `--backup-vault-off` : le répertoire et ses fichiers restent inchangés, et le fichier de clé de l'installation est supprimé. Un redémarrage interrompt une sauvegarde en cours, et l'agent la refait.

Dans Docker Compose, le stockage des sauvegardes est un montage de liaison depuis `config/compose.vault.yml`. Lorsque vous exécutez vous-même des commandes Compose, ajoutez `-f config/compose.vault.yml`. Sans cela, `up` crée le conteneur de l’agent sans le stockage des sauvegardes.

### Stockage des sauvegardes sur un partage réseau {#network-share}

Sous Linux, un NAS fonctionne via SMB 3 et NFS 4. Montez le partage de sorte que les fichiers appartiennent au compte de service, sinon l’agent ne peut pas écrire, et `configure` refuse puis restaure les anciens paramètres.

```bash
sudo mount -t cifs //nas/arkvory /mnt/backup/arkvory \
  -o credentials=/etc/arkvory/smb.credentials,uid=$(id -u arkvory),gid=$(id -g arkvory),file_mode=0600,dir_mode=0700,vers=3.1.1
```

- Donnez au fichier d’identifiants le mode `0600`.
- Pour NFS, mappez les propriétaires afin que les fichiers appartiennent à `arkvory`. Utilisez `no_root_squash` sur l’export, ou le même identifiant utilisateur des deux côtés.
- Ajoutez le montage à `/etc/fstab` avec `_netdev`. Pour SMB, ajoutez `nofail` lorsque le NAS peut être indisponible au démarrage.
- Si le NAS disparaît, l’agent signale `vault_unavailable`. Il n’écrit pas dans le point de montage vide, car l’identité du stockage des sauvegardes est stockée dans `vault.json`.

## Planification et rétention {#schedule}

### Définir le plan {#set-schedule}

Ouvrez [[ui:backups]] et utilisez [[ui:backupPlan]]. Il vous faut le droit de gérer les sauvegardes. Sans lui, le formulaire affiche [[ui:backupReadOnly]].

| Paramètre                                                     | Signification                                                                                                                             | Valeur par défaut |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| [[ui:backupEnabled]]                                          | Active le plan quotidien. L’activer ne lance pas immédiatement une sauvegarde                                                             | Désactivé         |
| [[ui:backupTime]]                                             | Heure locale de la sauvegarde quotidienne, à la minute près                                                                               | 02:00             |
| [[ui:backupTimezone]]                                         | Le fuseau horaire IANA de cette heure locale, par exemple `Europe/Moscow` ou `UTC`. Les décalages tels que `+03:00` ne sont pas acceptés  | `UTC`             |
| [[ui:backupDaily]], [[ui:backupWeekly]], [[ui:backupMonthly]] | Combien de jours, de semaines et de mois de points de restauration conserver. Voir [Rétention](#retention). Limites : 0–366, 0–260, 0–120 | 7, 4, 6           |

Sélectionnez [[ui:backupPlanSave]]. Si quelqu’un d’autre a modifié le plan entre-temps, la console charge le plan actuel, puis vous le vérifiez et l’enregistrez à nouveau.

Le plan suit ces règles :

- Une heure locale qui n’existe pas le jour d’un changement d’heure s’exécute au moment du changement. Une heure locale qui se produit deux fois s’exécute une seule fois, la première.
- Après une indisponibilité, l’agent effectue une seule sauvegarde de rattrapage, pas une pour chaque jour manqué. Modifier le plan ne déclenche pas de rattrapage pour les heures passées.
- La fenêtre de mise à jour par défaut d’une installation est 03:00 UTC. Une mise à jour arrête l’agent, et une sauvegarde en cours est interrompue puis répétée plus tard. Choisissez une heure de sauvegarde qui ne tombe pas dans la fenêtre de mise à jour. Voir [Mises à jour](../install/updates).

### Rétention {#retention}

La rétention conserve le point de restauration le plus récent de chacun des N derniers jours locaux, de chacune des N dernières semaines ISO et de chacun des N derniers mois, comptés dans le fuseau horaire du plan. Les trois groupes sont réunis, donc 7, 4 et 6 conservent au plus 17 points, et souvent moins.

La rétention conserve toujours :

- Les points épinglés.
- Le point le plus récent, donc il reste toujours au moins un point.

La rétention ne supprime jamais un point qui a échoué à la vérification, et ne touche jamais aux points d’une autre installation dans le même stockage des sauvegardes.

Après chaque sauvegarde, l’agent met la rétention en file d’attente comme tâche distincte. Vous pouvez aussi sélectionner [[ui:backupRetentionApply]]. La console affiche d’abord quels points restent et lesquels sont supprimés. Une suppression est irréversible. L’agent supprime ensuite le point puis, après, les fichiers dont plus aucun point restant n’a besoin. Si le stockage des sauvegardes contient un point endommagé (un répertoire de point sans `COMMITTED` ou avec un manifeste invalide), la suppression s’arrête avec `invalid_manifest`. Laissez le stockage des sauvegardes tel quel, trouvez la cause, puis supprimez le répertoire endommagé à la main.

La rétention des sauvegardes ne change pas la rétention des builds dans vos dépôts. Voir [Stockage](./storage).

### Épingler un point de restauration {#pin}

Un point épinglé est conservé au-delà des règles de rétention. Par exemple, épinglez le point d’avant une grosse migration.

- Console : sélectionnez [[ui:backupPin]] dans la ligne du point dans [[ui:backupPoints]]. [[ui:backupUnpin]] le libère.
- CLI : `arkvoryctl backup pin POINT_ID`, et `arkvoryctl backup pin POINT_ID --off`.
- API : [setBackupPointPin](../api/reference/backups#setBackupPointPin).

## Vérification {#verification}

Il existe deux types de vérification :

| Type                                                      | Ce qu’elle vérifie                                                                                                       | Quand elle s’exécute                                                                                                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rapide (la console indique [[ui:backupVerifyStructural]]) | Chaque fichier du point par rapport au digest de son manifeste, et que chaque fichier stocké existe avec la bonne taille | Automatiquement après chaque sauvegarde                                                                                                                                                                 |
| Complète ([[ui:backupVerifyDeep]])                        | Les vérifications rapides, et elle lit chaque fichier stocké et vérifie son SHA-256                                      | Automatiquement une fois tous les 7 jours pour le point le plus récent. Sur demande avec [[ui:backupVerifyDeepAction]], avec `arkvoryctl backup verify POINT_ID` ou avec `arkvory-backup verify --deep` |

Une vérification complète lit tout le point, donc avec un gros stockage des sauvegardes, elle demande du temps et du débit disque. Si un point échoue, la console affiche [[ui:backupVerifyFailed]] avec un code d’erreur, et l’avertissement `verify_failed` devient actif. Ne modifiez pas le stockage des sauvegardes avant d’en connaître la cause.

Un point qui n’a pas encore été vérifié affiche [[ui:backupVerifyNone]]. Une vérification complète du point le plus récent est aussi la meilleure vérification régulière que le stockage des sauvegardes est lisible.

## Lancer une sauvegarde maintenant {#run-now}

Utilisez l’un des moyens suivants :

- Console : [[ui:backupRun]] dans [[ui:backups]].
- CLI : `arkvoryctl backup run`.
- API : [requestBackupRun](../api/reference/backups#requestBackupRun) répond 202 avec la tâche mise en file d’attente.

L’agent vérifie sa file d’attente toutes les 15 secondes (`ARKVORY_BACKUP_POLL_SECONDS`), donc la tâche démarre peu après. Les tâches s’exécutent une à la fois, et fermer la console ne les arrête pas. Une tâche qui s’arrête à cause d’un redémarrage ou d’un conflit est répétée, jusqu’à 5 tentatives. Voir [Variables d’environnement](../reference/environment#backups) pour les paramètres de l’agent, y compris la limite de débit de copie `ARKVORY_BACKUP_BYTES_PER_SECOND`.

Une sauvegarde passe par ces phases, que la console affiche dans [[ui:backupJobPhase]] : [[ui:backupPhasePreparing]], [[ui:backupPhaseCatalog]], [[ui:backupPhaseTransfer]], [[ui:backupPhaseFinishing]] et [[ui:backupPhaseDone]]. Une vérification rapide affiche [[ui:backupPhaseStructural]], et une complète [[ui:backupPhaseDeep]].

N’exécutez pas de migrations de base de données ni les outils hors ligne `gc` et `scrub` pendant une sauvegarde. Ils attendent la fin de celle-ci ou refusent avec `busy`.

## Surveiller l’état {#status}

### Dans la console {#status-console}

[[ui:backups]] est visible par les administrateurs et par la clé de récupération. Les clés de service et les jetons d’accès personnels ne la voient jamais. La page affiche :

- L’état : [[ui:backupStateOk]], [[ui:backupStateWarning]] ou [[ui:backupStateCritical]].
- [[ui:backupNewest]] avec son âge depuis T, [[ui:backupNextRun]] avec [[ui:backupOverdue]] lorsqu’une exécution est en retard, [[ui:backupAgent]] avec son dernier signal et [[ui:backupVault]] avec l’espace libre.
- La tâche en cours, puis les avertissements, chacun avec une indication sur la marche à suivre.
- [[ui:backupPoints]], avec [[ui:backupSnapshot]], [[ui:backupCompleted]], [[ui:backupSize]], [[ui:backupFiles]], [[ui:backupVerification]] et l’épinglage.
- [[ui:backupJobs]], avec le type ([[ui:backupKindCapture]], [[ui:backupKindVerify]], [[ui:backupKindRetention]]), l’état, la phase, les heures, le code d’erreur et la progression.

Une tâche a l’un de ces états : [[ui:backupJobQueued]], [[ui:backupJobRunning]], [[ui:backupJobCommitting]], [[ui:backupJobCompleted]], [[ui:backupJobFailed]] ou [[ui:backupJobInterrupted]]. La page s’actualise pendant qu’une tâche s’exécute. Utilisez [[ui:backupRefresh]] à tout moment.

### Avertissements {#warnings}

| Code                   | Niveau        | Marche à suivre                                                                                                                                                                                       |
| ---------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vault_not_configured` | Avertissement | Connectez un stockage des sauvegardes. Voir [Connecter le stockage des sauvegardes](#connect-vault)                                                                                                   |
| `agent_offline`        | Critique      | Aucun signal depuis 2 minutes. Démarrez le service de l’agent et lisez son journal                                                                                                                    |
| `schedule_disabled`    | Avertissement | Activez le plan si vous avez besoin de sauvegardes quotidiennes                                                                                                                                       |
| `no_backup_yet`        | Avertissement | Créez la première sauvegarde                                                                                                                                                                          |
| `backup_stale`         | Critique      | Le point le plus récent a plus de 26 heures alors que le plan est activé. Lisez les codes d’erreur des tâches et le journal de l’agent                                                                |
| `last_run_failed`      | Avertissement | La dernière sauvegarde a échoué. Le code d’erreur se trouve dans la liste des tâches                                                                                                                  |
| `vault_unavailable`    | Critique      | Le volume n'est pas monté, `vault.json` manque, le vault n'est pas inscriptible, ou un vault chiffré n'a pas de clé valide (le journal de l'agent indique `vault_key_missing` ou `vault_key_invalid`) |
| `vault_low_space`      | Avertissement | Moins de 10 % du volume est libre, ou moins de deux fois les nouvelles données de la dernière sauvegarde. Libérez de l’espace ou conservez moins de points                                            |
| `verify_failed`        | Critique      | Un point a échoué à la vérification. Ne modifiez pas le stockage des sauvegardes ; enquêtez                                                                                                           |
| `never_deep_verified`  | Avertissement | Aucune vérification complète depuis plus de 8 jours. Vérifiez que l’agent s’exécute, ou lancez une vérification complète                                                                              |

### Avec le CLI et l’API {#status-cli}

```bash
arkvoryctl backup status
arkvoryctl backup jobs
arkvoryctl backup points
arkvoryctl backup status --json || echo "backup problem"
```

`backup status` se termine avec le code de sortie 9 tant qu’un avertissement critique est actif, vous pouvez donc l’utiliser dans une supervision. Ces commandes nécessitent la clé de fichier du propriétaire ou une session d’administrateur de compte. Voir [Client en ligne de commande](../protocols/cli#backups) et [SDK TypeScript](../protocols/sdk#backups). Les opérations HTTP se trouvent dans la [référence de l’API des sauvegardes](../api/reference/backups).

Pour Prometheus, l’API expose `arkvory_backup_last_success_timestamp_seconds` (le T du point le plus récent), `arkvory_backup_agent_last_seen_timestamp_seconds` et `arkvory_backup_warnings` avec une étiquette `code`. Voir [Supervision](./monitoring).

## Restauration {#restore}

Une restauration écrit dans une base de données **vide** et un répertoire de stockage **vide**. Elle n’écrase jamais une installation en cours. Après la restauration, vous démarrez une instance distincte sur les données restaurées, vous la vérifiez, et seulement ensuite vous décidez si elle remplace l’ancien serveur.

### Avant de commencer {#restore-prepare}

- **Le programme.** La commande de restauration est le programme `arkvory-backup` de la version installée. Démarrez-le avec le Node.js de l’installation :
  - Paquets Linux : `/opt/proanima-arkvory/runtime/node /opt/proanima-arkvory/releases/VERSION/apps/backup/dist/main.js COMMAND`
  - Programme d’installation graphique Windows : `& "$root\runtime\node.exe" "$root\releases\VERSION\apps\backup\dist\main.js" COMMAND`

  `VERSION` est la version installée d’après `installation.json`. Dans le reste de cette page, `arkvory-backup` désigne toute cette ligne de commande. Les utilisateurs de Docker Compose exécutent le même programme depuis un conteneur de l’image de la version. Pour une installation par script, utilisez le dossier Node.js sous `runtime/`.

- **La version.** Utilisez la version qui a créé le point ou une version plus récente. Un point issu d’une version plus récente est refusé avec `schema_mismatch`.
- **Le compte.** Exécutez la commande avec un compte qui peut lire le stockage des sauvegardes. Sous Linux, le stockage des sauvegardes appartient à `arkvory` et a le mode 0700, utilisez donc `sudo -u arkvory`. Sous Windows, utilisez une console PowerShell élevée. Le nouveau répertoire de stockage doit finir par appartenir au compte qui exécutera l’API.
- **La clé.** Un vault chiffré a besoin de sa clé. Donnez le kit de récupération ou un fichier de clé en `--key-file FILE` à chaque commande ci-dessous, ou définissez `ARKVORY_BACKUP_VAULT_KEY_FILE`. La clé est toujours un fichier, jamais un argument.
- **La cible.** Créez une base de données vide, par exemple `CREATE DATABASE arkvory_restore OWNER arkvory;`. Choisissez un répertoire de stockage qui n’existe pas ou qui est vide, sur un volume différent du stockage des sauvegardes et non à l’intérieur du stockage source.
- **L’URL de la base de données.** Passez-la dans l’environnement, pas comme argument, car les arguments sont visibles dans la liste des processus.

### Restauration étape par étape {#restore-steps}

1. Listez les points de restauration et choisissez-en un. Copiez l’ID du point.

   ```bash
   arkvoryctl backup points
   arkvory-backup list --vault /mnt/backup/arkvory
   ```

2. Vérifiez le point entièrement.

   ```bash
   arkvory-backup verify --vault /mnt/backup/arkvory --point POINT_ID --deep
   ```

3. Définissez la base de données cible dans l’environnement.

   ```bash
   export ARKVORY_RESTORE_DATABASE_URL='postgresql://arkvory@db.example/arkvory_restore'
   ```

4. Lancez la restauration **sans** `--yes`. C’est une simulation. Elle vérifie le point, les hachages des fichiers, la version du schéma et que la cible est vide, et n’écrit rien.

   ```bash
   arkvory-backup restore --vault /mnt/backup/arkvory --point POINT_ID --storage /srv/arkvory-restore
   ```

   Une vérification réussie se termine par le code de sortie 0 et la ligne de journal `backup.restore.planned`.

5. Exécutez la même commande avec `--yes`. Ajoutez `--report` pour conserver un fichier de rapport. Le fichier ne doit pas encore exister.

   ```bash
   arkvory-backup restore --vault /mnt/backup/arkvory --point POINT_ID --storage /srv/arkvory-restore --yes --report /root/restore-report.json
   ```

   La restauration passe par les phases `verify`, `content`, `schema`, `tables`, `migrate` et `done`. Elle copie chaque fichier et vérifie son SHA-256, crée le schéma, charge toutes les tables dans une seule transaction, applique la normalisation puis exécute les migrations restantes. Le rapport ne contient que des identifiants et des décomptes, jamais de chemins ni d’identifiants de connexion.

6. Démarrez une instance d’API distincte sur les données restaurées : `ARKVORY_DATABASE_URL` de la nouvelle base de données, `ARKVORY_DATA_DIR` du nouveau répertoire, son propre `ARKVORY_KEYS_FILE` et un autre port. Vérifiez que `/health/ready` répond, que vous pouvez vous connecter, que le catalogue est complet et qu’un fichier de contrôle se télécharge avec le même SHA-256.

Si une restauration échoue, supprimez la base de données et le répertoire cibles puis recréez-les. Une cible non vide est refusée avec `target_not_empty`, ce qui protège les données existantes.

### Ce qu’une restauration modifie {#after-restore}

La restauration applique un ensemble fixe de changements, afin que la nouvelle instance ne poursuive rien qui était en cours et n’active aucun ancien identifiant :

- Les téléversements non terminés sont annulés et libèrent leur quota. Les tâches de finalisation en file d’attente et en cours se terminent en échec avec le code `conflict`. Les promotions non terminées sont abandonnées.
- Aucune session n’est restaurée. Tout le monde se reconnecte.
- Tous les jetons d’accès personnels sont révoqués, et toutes les clés de service deviennent `revoked`. Émettez de nouvelles clés.
- La rétention du stockage et le nettoyage physique sont désactivés dans chaque dépôt. Réactivez-les délibérément.
- Les sauvegardes sont désactivées, et aucun stockage des sauvegardes n’est configuré. Les liens de téléchargement et les paramètres des passerelles de lecture ne sont pas transférés.
- Les comptes, les groupes et les autorisations restent, avec les hachages de mots de passe tels qu’à T. Un mot de passe que vous avez changé après T fonctionne de nouveau dans son ancienne forme, donc réinitialisez les mots de passe selon votre propre politique.
- La clé de récupération et les clés de fichier proviennent du fichier de clés de l’installation qui exécute les données restaurées.
- Les miroirs conservent leur position, mais les paramètres de miroir se trouvent dans `config/`. Reconnectez-les. Voir [Miroirs](./mirrors).
- Une entrée d’audit de sécurité `backup.restored` enregistre le point et les décomptes.

### Déplacer vers un autre serveur {#move-server}

Vous pouvez utiliser une sauvegarde pour déplacer une installation vers un autre serveur :

1. Installez Arkvory sur le nouveau serveur avec la même version ou une plus récente. Voir [Choisir une installation](../install/index).
2. Connectez le même stockage des sauvegardes, ou une copie de celui-ci, au nouveau serveur. N’utilisez pas `--init-vault` pour un stockage des sauvegardes existant.
3. Restaurez le point le plus récent dans une nouvelle base de données vide et un répertoire vide, comme décrit ci-dessus, et testez le résultat.
4. Faites pointer l’installation vers les données restaurées : définissez `ARKVORY_DATABASE_URL` et `ARKVORY_DATA_DIR` dans `config/runtime.json` et redémarrez les services. Voir [Configuration](../install/configuration).
5. Émettez de nouvelles clés, redéfinissez les politiques de rétention et de nettoyage, reconnectez les miroirs et le plan de sauvegarde, et communiquez la nouvelle adresse aux clients.

Les deux dernières étapes sont manuelles et ne font pas partie d’une bascule guidée. Répétez d’abord toute la séquence sur un serveur de secours. Les changements effectués sur l’ancien serveur après T sont perdus, donc arrêtez l’ancien serveur avant le déplacement des clients.

## Tester régulièrement une restauration {#test-restore}

Une sauvegarde que vous n’avez jamais restaurée n’est qu’un espoir. Le produit vérifie les octets d’un point, mais il n’enregistre pas de test de restauration. Consignez vous-même la date et le résultat.

Testez au moins :

- Après la première sauvegarde.
- Après chaque mise à jour qui modifie le schéma de la base de données.
- Selon votre propre calendrier, par exemple chaque trimestre.

Chaque test suit [Restauration étape par étape](#restore-steps) sur un serveur de secours ou une base de données jetable, et se termine par une connexion, un examen du catalogue et le téléchargement d’un fichier de contrôle. Supprimez ensuite la base de données jetable et le répertoire.

## Codes de sortie et lignes de journal {#exit-codes}

### Codes de sortie {#exit-codes-table}

Le programme `arkvory-backup` écrit un objet JSON par ligne sur sa sortie standard, et en cas d’échec une ligne d’indication sur la sortie d’erreur.

| Code | Signification                                                                                                                                                                       |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Succès. Pour `restore` sans `--yes`, la vérification a réussi                                                                                                                       |
| 1    | L’exécution a échoué : base de données ou disque indisponible, bail ou instantané perdu, stockage des sauvegardes ou cible plein. Les points de restauration ne sont pas endommagés |
| 2    | Arguments ou variables d’environnement incorrects                                                                                                                                   |
| 3    | Une vérification de sécurité a refusé : pas de `vault.json`, répertoires qui se chevauchent, une cible non vide, un schéma non pris en charge, aucun point de ce type               |
| 4    | Échec d’intégrité : un hachage, un fichier manquant ou un manifeste modifié. Laissez le stockage des sauvegardes inchangé jusqu’à ce que vous compreniez                            |
| 5    | Occupé : une autre sauvegarde ou maintenance s’exécute, ou une suppression ne s’est pas terminée à temps. Réessayez plus tard                                                       |

### Lignes de journal {#log-lines}

Chaque ligne a `component` défini sur `backup`. Les chemins, les URL et les secrets ne sont jamais écrits. Les lignes les plus utiles :

| Code                                                                                        | Signification                                                                                                                        |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `backup.phase`                                                                              | Une sauvegarde passe à une phase : `barrier`, `pins`, `tables`, `blobs`, `manifest`, `commit`, `done`                                |
| `backup.capture.completed`                                                                  | Une sauvegarde est terminée. Champs : `pointId`, `outcome`, `blobs`, `copied`, `reused`, `copiedBytes`, `contentBytes`, `durationMs` |
| `backup.point`                                                                              | Un point de restauration dans la sortie de `list`                                                                                    |
| `backup.verify.point`, `backup.verify.problem`                                              | Le résultat d’une vérification, et chaque problème avec son `errorCode`                                                              |
| `backup.restore.phase`, `backup.restore.planned`, `backup.restore.completed`                | Progression et résultat de la restauration, avec le nombre de lignes et des changements listés ci-dessus                             |
| `backup.failed`                                                                             | Une commande a échoué. Lisez `errorCode`                                                                                             |
| `backup.agent.started`, `.standby`, `.lease_acquired`, `.lease_lost`, `.stopped`, `.failed` | La vie de l’agent                                                                                                                    |
| `backup.request.started`, `.done`, `.failed`, `.requeued`                                   | Une tâche de l’agent, avec `kind` et `errorCode`                                                                                     |
| `backup.schedule.due`                                                                       | Le plan a lancé une sauvegarde                                                                                                       |
| `backup.retention.applied`                                                                  | La rétention est terminée. Champs : `forgotten`, `blobs`, `freedBytes`                                                               |

Lisez le journal de l’agent avec `journalctl -u arkvory-backup` sous Linux, dans `logs\` de la racine d’installation sous Windows, et avec `docker compose logs backup` dans Compose.

### Codes d’erreur {#error-codes}

| `errorCode`                                              | Sortie | Marche à suivre                                                                                                                                                      |
| -------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vault_missing`                                          | 3      | Le répertoire n’a pas de `vault.json`. Montez le volume, ou exécutez `vault init` une fois                                                                           |
| `vault_key_missing`                                      | 3      | Le vault est chiffré et aucune clé n'a été donnée. Utilisez `--key-file FILE` ou `ARKVORY_BACKUP_VAULT_KEY_FILE`                                                     |
| `vault_key_invalid`                                      | 3      | La clé n'ouvre pas ce vault : vérifiez le fichier, le vault, ou si l'emplacement a été supprimé. Une faute de frappe est détectée par la somme de contrôle de la clé |
| `unsafe_path`                                            | 3      | Gardez le stockage des sauvegardes, le stockage et la cible de restauration dans des arborescences distinctes                                                        |
| `target_not_empty`                                       | 3      | La restauration n’écrit que dans une base de données vide et un répertoire vide                                                                                      |
| `schema_mismatch`                                        | 3      | Le point est plus récent que la version, ou plus ancien que la restauration prise en charge. Utilisez une autre version                                              |
| `upgrade_required`                                       | 3      | Mettez à jour chaque processus d’API et de maintenance de l’installation                                                                                             |
| `point_not_found`, `storage_mismatch`                    | 3      | ID de point incorrect, ou `ARKVORY_DATA_DIR` n’est pas un répertoire de stockage initialisé de cette installation                                                    |
| `integrity_mismatch`, `invalid_manifest`, `blob_missing` | 4      | Laissez le stockage des sauvegardes inchangé. Exécutez `verify --deep` et enquêtez                                                                                   |
| `busy`, `barrier_timeout`                                | 5      | Une autre opération s’exécute. Réessayez plus tard                                                                                                                   |
| `vault_full`, `storage_full`                             | 1      | Libérez de l’espace. Les points antérieurs sont intacts                                                                                                              |
| `attempts_exhausted`                                     | 3      | Cette requête a utilisé ses 5 tentatives. Lancez une nouvelle sauvegarde                                                                                             |

## Limites {#limits}

- Un plan et un stockage des sauvegardes par installation. Le stockage des sauvegardes est un répertoire sur un disque ou sur un partage monté, sans S3 ni profil hors site ou immuable.
- Le chiffrement cache le contenu et le catalogue, pas les noms de fichiers, leurs tailles ni le nombre de points. Des clés perdues, ce sont des sauvegardes perdues. Supprimer un emplacement de clé ne rechiffre pas les points précédents.
- Vous ne pouvez ni suspendre ni annuler une tâche de sauvegarde, et la console n’a ni assistant de restauration ni état de test de restauration.
- La restauration exige une cible vide, et la bascule vers les données restaurées est une étape manuelle.
- L’agent de sauvegarde n’est pas un système à haute disponibilité. Un second agent ne fait qu’attendre comme secours.

## Pages associées {#related-pages}

- [Choisir une installation](../install/index)
- [Mises à jour](../install/updates)
- [Stockage](./storage)
- [Miroirs](./mirrors) pour un second site
- [Supervision](./monitoring)
- [Autoréparation](./self-healing)
- [Dépannage](./troubleshooting)
- [Variables d’environnement](../reference/environment#backups)
