---
title: Configuration
description: 'Où réside la configuration d’Arkvory, quelles commandes de cycle de vie la modifient, les principaux réglages selon la tâche et comment appliquer une modification.'
---

# Configuration

Arkvory comporte deux types de réglages :

- Les **réglages serveur** sont des variables `ARKVORY_*` dans le fichier `config/runtime.json`. Ils définissent l’adresse, les limites, le stockage et d’autres éléments analogues. L’API, le processus de traitement (worker) et l’agent de sauvegarde les lisent au démarrage.
- La **politique d’installation** regroupe la politique de mise à jour, les fichiers HTTPS, le stockage des sauvegardes (coffre) et les miroirs. Vous la modifiez avec la commande `arkvory configure`. La commande vérifie la modification, redémarre ce qu’il faut et restaure l’état précédent lorsque les services ne démarrent pas.

Cette page indique où se trouvent les fichiers, quelles commandes existent et comment fonctionnent les principaux réglages. La liste complète des variables, avec les valeurs par défaut et les plages, se trouve dans [Variables d’environnement](../reference/environment).

## Où réside la configuration {#where-it-lives}

La racine d’installation contient tout. Elle est `C:\ProgramData\ProAnima\Arkvory` sous Windows et `/opt/proanima-arkvory` sous Linux. Une installation Compose utilise la même racine sur l’hôte. Les chemins ci-dessous sont relatifs à la racine.

| Fichier                                                                        | Contenu                                                                                                                                  | Comment le modifier                                                       |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `config/runtime.json`                                                          | Les réglages serveur. Les clés commencent par `ARKVORY_` et chaque valeur est une chaîne. Contient le mot de passe de la base de données | À la main, ou avec `configure`                                            |
| `config/keys.json`                                                             | Empreintes SHA-256 de la clé de récupération et de la clé de disponibilité. Ne contient jamais de clé                                    | Uniquement pour [remplacer la clé de récupération](#replace-recovery-key) |
| `config/bootstrap-token.txt`                                                   | La clé de récupération                                                                                                                   | Uniquement pour la remplacer                                              |
| `config/health-token.txt`                                                      | La clé que les outils d’installation utilisent pour le contrôle de disponibilité                                                         | Ne pas modifier                                                           |
| `config/hub.json`                                                              | L’adresse du hub, le canal de mise à jour et le réglage des statistiques                                                                 | Avec `configure`                                                          |
| `config/install-id`                                                            | Un ID d’installation aléatoire, envoyé au hub uniquement si les statistiques sont activées                                               | Ne pas modifier                                                           |
| `config/mirrors/`                                                              | La liste des miroirs et les clés que le processus de traitement (worker) utilise pour les sources                                        | Avec `configure --mirror`                                                 |
| `installation.json`                                                            | Le mode, le moteur, le réglage des mises à jour automatiques, l’épinglage de version et la version installée                             | Uniquement avec des commandes                                             |
| `github-token.txt`                                                             | Jeton GitHub facultatif pour le téléchargement des versions. Voir [Mises à jour](./updates#hub-unreachable)                              | À la main                                                                 |
| `config/compose.env`, `config/compose.vault.yml`, `config/compose.mirrors.yml` | Uniquement Compose : l’image, le montage du coffre et le montage du miroir                                                               | Uniquement avec des commandes                                             |

Sur une installation Linux native, `runtime.json` et `keys.json` appartiennent à `root:arkvory` avec le mode `0640`, et les fichiers d’identifiants dans `config/` ne sont lisibles que par `root`. Une installation Compose utilise le mode `0644` pour les fichiers que les conteneurs lisent : voir [Docker Compose](./docker#owners). Conservez les propriétaires et les modes définis par l’installateur.

## Commandes de cycle de vie {#lifecycle-commands}

Toutes les commandes requièrent des droits d’administrateur et l’option `--root` avec la racine d’installation.

| Installation                                | Comment exécuter une commande                                                                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paquet Linux                                | `sudo arkvory <command> --root /opt/proanima-arkvory`                                                                                                             |
| Windows, programme d’installation graphique | Dans un PowerShell élevé : `& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' <command> --root C:\ProgramData\ProAnima\Arkvory`                                   |
| Installation par script, Compose            | `sudo <root>/runtime/node-v24.21.0-linux-x64/bin/node <root>/manage.mjs <command> --root <root>`. Sous Windows, utilisez `runtime\node-v24.21.0-win-x64\node.exe` |

`arkvory help` liste les commandes sans droits particuliers. Les exemples de ce site utilisent la forme courte `arkvory <command>`.

| Commande                        | Utilisation                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `status`                        | Affiche le mode d’installation, le moteur, le réglage des mises à jour automatiques, l’épinglage et la version installée                                                 |
| `configure`                     | Modifie une politique. Voir [La commande configure](#configure-command)                                                                                                  |
| `update`                        | Installe immédiatement une version stable plus récente. Voir [Mises à jour](./updates)                                                                                   |
| `upgrade`                       | Installe une version qui modifie le schéma de la base de données avec un enregistrement de sauvegarde qui vous est propre. Voir [Mises à jour](./updates#manual-upgrade) |
| `recover`                       | Termine une mise à jour interrompue. Voir [Mises à jour](./updates#recover-update)                                                                                       |
| `finish-install`                | Poursuit une première installation interrompue                                                                                                                           |
| `updates-connect`               | Connecte la console et le minuteur de mise à jour, et enregistre les services qui manquent à une ancienne installation                                                   |
| `updates-poll`, `updates-reset` | Exécutées par le minuteur de mise à jour et pour la récupération. Voir [Mises à jour](./updates#recover-update)                                                          |

Une seule commande s’exécute à la fois. Une seconde commande s’arrête avec `Installation is locked`. Ne mettez jamais une clé ni un mot de passe dans une option de commande : utilisez des fichiers.

### La commande configure {#configure-command}

Un appel modifie un seul type de réglage. Les quatre types ne peuvent pas être mélangés dans un même appel.

| Type                              | Options                                                                                                                                                                           | Effet                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| HTTPS                             | `--tls-cert FILE --tls-key FILE [--listen-host ADDRESS]`, ou `--tls-off [--listen-host ADDRESS]`                                                                                  | Active ou désactive le HTTPS intégré. Redémarre les services et vérifie la disponibilité. Voir [HTTPS](./https)      |
| Stockage des sauvegardes (coffre) | `--backup-vault DIRECTORY [--init-vault]`, ou `--backup-vault-off`                                                                                                                | Connecte ou déconnecte le coffre. Redémarre uniquement l’agent de sauvegarde. Voir [Sauvegardes](../operate/backups) |
| Miroirs                           | `--mirror REPOSITORY --mirror-upstream URL --mirror-token-file FILE [--mirror-source REPOSITORY] [--mirror-stages LIST] [--mirror-ca-file FILE]`, ou `--mirror-detach REPOSITORY` | Fait d’un dépôt un miroir ou une cible d’import, ou le rend de nouveau ordinaire. Voir [Miroirs](../operate/mirrors) |
| Mises à jour                      | `--enable-updates`, `--disable-updates`, `--pin [--version X.Y.Z]`, `--unpin`, `--update-channel stable` ou `beta`, `--statistics on` ou `off`, `--hub-url URL`, `--hub-off`      | Modifie la politique de mise à jour. Voir [Mises à jour](./updates)                                                  |

Les modifications HTTPS, du coffre et des miroirs redémarrent les services et restaurent la configuration précédente lorsque la modification ne fonctionne pas. Les options de mise à jour ne réécrivent que `installation.json` et `hub.json` ; elles ne redémarrent rien. Les chemins de fichiers sont absolus.

## Réglages par tâche {#settings-by-task}

### Adresse et port {#address-and-port}

| Variable       | Valeur par défaut | Signification                       |
| -------------- | ----------------- | ----------------------------------- |
| `ARKVORY_HOST` | `127.0.0.1`       | L’adresse sur laquelle l’API écoute |
| `ARKVORY_PORT` | `8080`            | Le port TCP                         |

Avec la valeur par défaut, seuls les programmes sur le serveur peuvent se connecter. Pour accepter d’autres ordinateurs, choisissez l’une des deux méthodes :

- **HTTPS intégré.** `arkvory configure --tls-cert … --tls-key … --listen-host 0.0.0.0`. Voir [HTTPS](./https#built-in-tls).
- **Un proxy inverse sur un autre ordinateur.** Définissez `ARKVORY_HOST` sur l’adresse de l’interface réseau pour le proxy et listez le proxy dans `ARKVORY_TRUSTED_PROXIES`. Modifiez `runtime.json`, ou exécutez `arkvory configure --tls-off --listen-host <address>`. Restreignez le port au proxy avec un pare-feu.

`--listen-host` seul est refusé : utilisez-le avec les fichiers TLS ou avec `--tls-off`. Après `--tls-off`, ajoutez `--listen-host 127.0.0.1` pour revenir à l’interface de bouclage, sinon l’API continue d’écouter sur l’adresse définie.

Lorsque l’API écoute sur une adresse qui n’est pas l’interface de bouclage sans TLS et sans proxy de confiance, elle journalise l’avertissement `http.plaintext_exposed` au démarrage. N’envoyez jamais de clés en HTTP simple entre ordinateurs.

Sous Linux, les services s’exécutent sous un compte non privilégié, qui ne peut normalement pas écouter sur un port inférieur à 1024. Les raccourcis vers la console (menu Démarrer, entrée de menu) continuent de pointer vers le port 8080. Les commandes de cycle de vie suivent l’adresse et le port de `runtime.json`. Dans une installation Compose, l’adresse et le port sont fixes : voir [Docker Compose](./docker#ports).

### Adresse publique et en-têtes transmis {#public-address}

Il n’existe pas de réglage pour une URL publique. Le serveur construit les liens absolus, comme ceux des réponses Git LFS et npm, à partir de la requête : le schéma est `https` lorsque la connexion est en TLS ou lorsque le proxy envoie `X-Forwarded-Proto: https`, et l’hôte est l’en-tête `Host`. Un proxy listé dans `ARKVORY_TRUSTED_PROXIES` peut aussi définir l’hôte avec `X-Forwarded-Host`. Votre proxy doit donc transmettre le nom public. Voir [HTTPS](./https#reverse-proxy).

`ARKVORY_TRUSTED_PROXIES` accepte jusqu’à 32 adresses ou plages CIDR, séparées par des virgules. Seuls ces pairs peuvent définir l’adresse du client avec `X-Forwarded-For` et l’ID de requête avec `X-Request-Id`. Sans la liste, chaque client semble venir de l’adresse du proxy, et la limite de connexion les compte comme un seul.

### Navigateurs sur une autre adresse {#browsers}

`ARKVORY_CORS_ORIGINS` liste jusqu’à 16 origines d’une console ou d’une autre application web qui s’exécute sur une adresse différente, séparées par des virgules. Chaque origine comporte un schéma, un hôte et un port facultatif, sans chemin. Elle doit utiliser HTTPS ; le HTTP simple n’est accepté que pour `localhost`, `127.0.0.1` et `[::1]`. Voir [HTTPS](./https#console-api-address). `ARKVORY_ALLOW_REGISTRATION=true` permet aux personnes de créer leurs propres comptes sur la page de connexion ; c’est désactivé par défaut.

### Base de données {#database}

| Variable                     | Valeur par défaut          | Signification                                                                         |
| ---------------------------- | -------------------------- | ------------------------------------------------------------------------------------- |
| `ARKVORY_DATABASE_URL`       | définie par l’installateur | L’URL de connexion PostgreSQL. Une base de données gérée écoute sur `127.0.0.1:54329` |
| `ARKVORY_DATABASE_POOL_SIZE` | `10`                       | La taille du pool de connexions de l’API, de 4 à 200                                  |

Ne pointez pas une installation vers une autre base de données. Les fichiers stockés et le catalogue vont ensemble. Passer à une nouvelle base de données est une restauration à partir d’une sauvegarde : voir [Sauvegardes](../operate/backups). Pour un PostgreSQL externe, définissez `max_connections` assez haut pour le pool de l’API, une connexion par téléversement simultané pour les verrous d’écriture, 5 pour le processus de traitement (worker) et les connexions de l’agent de sauvegarde.

### Répertoire de stockage et espace libre {#storage}

| Variable                        | Valeur par défaut | Signification                                                                                                         |
| ------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_DATA_DIR`              | `<root>/data`     | Où le contenu des fichiers est stocké. Défini par l’installateur. Utilisez un disque local                            |
| `ARKVORY_CAPACITY_BYTES`        | 10 TiB            | Le maximum que tout le contenu réservé peut utiliser. C’est une limite sur les réservations, pas une mesure du disque |
| `ARKVORY_STORAGE_RESERVE_BYTES` | 1 GiB             | Espace libre que les téléversements n’utilisent jamais. `0` désactive la réserve                                      |
| `ARKVORY_MAX_OBJECT_BYTES`      | environ 10 TiB    | Le plus gros objet unique. Définissez une valeur plus basse pour limiter la taille des fichiers                       |

Laissez `ARKVORY_DATA_DIR` là où l’installateur l’a placé. Les unités Linux ne peuvent écrire que dans `data/`, `logs/` et `updates/inbox/` de la racine, donc tout autre chemin est en lecture seule pour elles. Pour utiliser un disque plus grand, arrêtez les services, copiez le contenu sur le nouveau disque, montez le disque sur `data/` avec le propriétaire `arkvory`, puis démarrez les services. Sous Windows et Linux, vous pouvez aussi choisir la racine elle-même lorsque vous installez avec un script (`-Root`, `ARKVORY_INSTALL_ROOT`). Voir [Stockage](../operate/storage).

### Limites de transfert {#limits}

Les limites appartiennent à un processus d’API. Un débit de `0` signifie aucune limite.

| Variable                              | Valeur par défaut | Signification                                                                     |
| ------------------------------------- | ----------------- | --------------------------------------------------------------------------------- |
| `ARKVORY_MAX_UPLOADS`                 | `2`               | Téléversements simultanés, de 1 à 32                                              |
| `ARKVORY_MAX_DOWNLOADS`               | `16`              | Téléchargements simultanés, de 1 à 256                                            |
| `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`   | `1`               | Téléversements simultanés d’un même compte ou d’une même clé                      |
| `ARKVORY_MAX_DOWNLOADS_PER_PRINCIPAL` | `4`               | Téléchargements simultanés d’un même compte ou d’une même clé                     |
| `ARKVORY_UPLOAD_BYTES_PER_SECOND`     | `0`               | Débit total de téléversement en octets par seconde                                |
| `ARKVORY_DOWNLOAD_BYTES_PER_SECOND`   | `0`               | Débit total de téléchargement en octets par seconde                               |
| `ARKVORY_UPLOAD_DEADLINE_MS`          | `1800000`         | La durée maximale d’une requête de téléversement, 30 minutes                      |
| `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`      | `30000`           | Une requête de téléversement qui n’envoie aucune donnée pendant ce délai s’arrête |

Un proxy devant l’API doit autoriser une requête d’une durée au moins égale à `ARKVORY_UPLOAD_DEADLINE_MS`. Voir [HTTPS](./https#reverse-proxy). Toutes les autres limites, comme la file d’attente et les débits par compte, se trouvent dans [Variables d’environnement](../reference/environment#transfers-and-bandwidth).

### Sauvegardes et miroirs {#backups-mirrors}

Utilisez `configure` pour les deux. `--backup-vault` écrit `ARKVORY_BACKUP_VAULT`, accorde au compte de service l’accès au répertoire, redémarre uniquement l’agent de sauvegarde et ne conserve la modification que lorsque l’agent signale le coffre comme disponible. Le coffre doit se trouver en dehors de la racine d’installation et du stockage. `--mirror` écrit `ARKVORY_MIRRORS_FILE` et les fichiers de clés, redémarre l’API et le processus de traitement (worker), et vérifie la source avec votre clé avant de modifier quoi que ce soit.

### Mises à jour et le hub {#updates-and-hub}

La politique de mise à jour se trouve dans `installation.json` et `config/hub.json`. Les options sont dans [La commande configure](#configure-command), et leur signification dans [Mises à jour](./updates). `ARKVORY_HUB_URL` dans `runtime.json` est distinct : il définit où la console envoie les commentaires. `configure --hub-url` ou `--hub-off` modifient les deux, et l’adresse des commentaires suit au prochain redémarrage des services.

### Journaux et arrêt {#logs-and-shutdown}

| Variable                   | Valeur par défaut | Signification                                                                                             |
| -------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------- |
| `ARKVORY_LOG_LEVEL`        | `info`            | `debug`, `info`, `warning` ou `error`. Les niveaux `warning` et `error` masquent aussi le journal d’accès |
| `ARKVORY_ACCESS_LOG`       | `true`            | Un enregistrement JSON par requête HTTP. La chaîne de requête n’est jamais écrite                         |
| `ARKVORY_DRAIN_TIMEOUT_MS` | `30000`           | Après une demande d’arrêt, le temps laissé aux requêtes en cours pour se terminer                         |

Les superviseurs accordent 120 secondes à un service pour s’arrêter. Si vous définissez un délai de drainage supérieur à environ 90 secondes, augmentez aussi le délai d’arrêt du gestionnaire de services : `TimeoutStopSec` dans les unités systemd, le délai d’arrêt des services Windows et `stop_grace_period` dans Compose. Voir [Supervision](../operate/monitoring).

## Appliquer une modification {#apply-change}

`configure` applique sa propre modification. Pour tout ce que vous modifiez dans `config/runtime.json` :

1. Faites une copie du fichier, par exemple `sudo cp -p /opt/proanima-arkvory/config/runtime.json /root/runtime.json.bak`. Il contient le mot de passe de la base de données : gardez la copie privée.
2. Modifiez le fichier sur place. Gardez le JSON valide, avec chaque valeur sous forme de chaîne.
3. Vérifiez le propriétaire et le mode. Sous Linux, ils doivent rester `root:arkvory` et `0640`. Réparez-les avec `sudo chown root:arkvory runtime.json` et `sudo chmod 0640 runtime.json`.
4. Redémarrez les services. Les réglages ne sont lus qu’au démarrage.

   ```bash
   sudo systemctl restart arkvory-api arkvory-worker arkvory-backup
   ```

   ```powershell
   Restart-Service Arkvoryapi, Arkvoryworker, Arkvorybackup
   ```

   Dans une installation Compose, arrêtez et démarrez les conteneurs avec la commande `compose` de [Docker Compose](./docker#manage) :

   ```bash
   "${compose[@]}" stop --timeout 120 backup worker api
   "${compose[@]}" up -d --wait api worker
   "${compose[@]}" up -d backup
   ```

5. Vérifiez le résultat. Une valeur hors de sa plage arrête le processus au démarrage avec un message qui nomme la variable, jamais sa valeur. Sous Linux, lisez-le avec `journalctl -u arkvory-api -n 50`. Arkvory ne revient pas à une valeur par défaut dans ce cas.

Un redémarrage interrompt les transferts en cours. Les clients les reprennent.

## Remplacer la clé de récupération {#replace-recovery-key}

Remplacez la clé de récupération si vous soupçonnez que quelqu’un a lu `config/bootstrap-token.txt`. La clé est stockée à deux endroits qui doivent changer ensemble : le fichier `bootstrap-token.txt` contient la clé, et l’entrée `bootstrap-owner` dans `keys.json` contient son SHA-256. Laissez l’entrée `deployment-health` telle quelle.

1. Faites une copie de `config/keys.json`.
2. Enregistrez ce script sous `replace-recovery-key.mjs` :

   ```js
   import { createHash, randomBytes } from 'node:crypto';
   import { readFileSync, writeFileSync } from 'node:fs';

   const directory = process.argv[2];
   const token = randomBytes(32).toString('hex');
   const keys = JSON.parse(readFileSync(`${directory}/keys.json`, 'utf8'));
   const owner = keys.find((key) => key.id === 'bootstrap-owner');
   if (!owner) throw new Error('No bootstrap-owner entry');
   owner.sha256 = createHash('sha256').update(token).digest('hex');
   writeFileSync(`${directory}/keys.json`, JSON.stringify(keys, null, 2));
   writeFileSync(`${directory}/bootstrap-token.txt`, token);
   ```

3. Exécutez-le en tant que `root` ou administrateur avec le Node.js de l’installation. Le script écrit dans les fichiers existants, donc les propriétaires et les règles d’accès restent inchangés.

   ```bash
   sudo /opt/proanima-arkvory/runtime/node ./replace-recovery-key.mjs /opt/proanima-arkvory/config
   ```

   ```powershell
   & 'C:\ProgramData\ProAnima\Arkvory\runtime\node.exe' .\replace-recovery-key.mjs 'C:\ProgramData\ProAnima\Arkvory\config'
   ```

   Après une installation par script, utilisez plutôt le Node.js sous `runtime\node-v24.21.0-…`.

4. Redémarrez les services comme indiqué dans [Appliquer une modification](#apply-change).
5. Lisez la nouvelle clé dans `config/bootstrap-token.txt`, puis supprimez le script et la copie de `keys.json`.

Les comptes, les jetons personnels et les clés de service ne sont pas concernés. Ils résident dans la base de données.
