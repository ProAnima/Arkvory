---
title: Variables d’environnement
---

# Variables d’environnement

Arkvory se configure avec des variables d’environnement dont le nom commence par `ARKVORY_`. Cette page liste toutes les variables que lisent les processus du serveur, le client en ligne de commande et les scripts d’installation.

## Origine des valeurs {#where-the-values-come-from}

Les programmes d’installation écrivent les paramètres du serveur dans un seul fichier, `config/runtime.json`, dans la racine d’installation. Le lanceur de chaque service lit ce fichier et transmet ses valeurs à l’API, au processus de traitement et à l’agent de sauvegarde. Chaque clé doit commencer par `ARKVORY_`, et chaque valeur doit être une chaîne.

```json
{
  "ARKVORY_HOST": "127.0.0.1",
  "ARKVORY_PORT": "8080",
  "ARKVORY_CAPACITY_BYTES": "10995116277760",
  "ARKVORY_DATABASE_URL": "postgresql://arkvory:PASSWORD@127.0.0.1:54329/arkvory",
  "ARKVORY_DATA_DIR": "/opt/proanima-arkvory/data",
  "ARKVORY_KEYS_FILE": "/opt/proanima-arkvory/config/keys.json",
  "ARKVORY_MAX_DOWNLOADS": "32"
}
```

Le fichier contient le mot de passe de la base de données. Gardez ses droits d’accès tels que le programme d’installation les a définis.

Pour modifier un paramètre, éditez `config/runtime.json` et redémarrez les services. Préférez la commande `arkvory configure` lorsqu’elle couvre le paramètre (HTTPS, stockage des sauvegardes, miroirs, mises à jour). Elle vérifie la modification et restaure l’ancien fichier si les services ne démarrent pas. Voir [Configuration](../install/configuration).

```bash
sudo systemctl restart arkvory-api arkvory-worker arkvory-backup
```

```powershell
Restart-Service Arkvoryapi, Arkvoryworker, Arkvorybackup
```

Une valeur hors de sa plage autorisée arrête le processus au démarrage, avec un message qui nomme la variable. Arkvory ne se rabat pas sur une valeur par défaut dans ce cas.

La colonne « Lue par » emploie ces noms : **API** est le serveur HTTP (aussi une passerelle de lecture), **worker** est le processus de traitement en arrière-plan, **agent** est l’agent de sauvegarde, **CLI** est `arkvoryctl`.

## Paramètres de base {#core}

| Variable                     | Lue par                       | Valeur par défaut | Signification                                                                                                                                                                                       |
| ---------------------------- | ----------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_DATABASE_URL`       | API, worker, agent, migration | obligatoire       | URL de connexion PostgreSQL (`postgres://` ou `postgresql://`). Utilisez une base distincte pour chaque installation.                                                                               |
| `ARKVORY_DATA_DIR`           | API, worker, agent            | obligatoire       | Répertoire de stockage local : zone temporaire, contenu et fichier `storage-id`. N’utilisez pas de partage réseau.                                                                                  |
| `ARKVORY_HOST`               | API                           | `127.0.0.1`       | Adresse d’écoute. Les programmes d’installation écrivent `127.0.0.1` ; dans Docker Compose, c’est `0.0.0.0` à l’intérieur du conteneur, et le port n’est publié que sur la boucle locale de l’hôte. |
| `ARKVORY_PORT`               | API                           | `8080`            | Port TCP, 1–65535.                                                                                                                                                                                  |
| `ARKVORY_WEB_DIR`            | API                           | `apps/web/public` | Répertoire des fichiers de la console web. Le lanceur le définit sur la version actuelle à chaque démarrage.                                                                                        |
| `ARKVORY_DATABASE_POOL_SIZE` | API                           | `10`              | Taille du pool de connexions de l’API, 4–200. Jusqu’à trois connexions sont toujours utilisées.                                                                                                     |

## Stockage et limites {#storage-and-limits}

| Variable                        | Lue par            | Valeur par défaut | Signification                                                                                                                                                                                                            |
| ------------------------------- | ------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ARKVORY_CAPACITY_BYTES`        | API, worker        | 10 TiB            | Limite supérieure, en octets, pour tout le contenu réservé : publié, téléversements inachevés et contenu en attente de nettoyage. Ce n’est pas un contrôle du disque. Le worker ne la lit que pour les copies de miroir. |
| `ARKVORY_STORAGE_RESERVE_BYTES` | API, worker, agent | `1073741824`      | Espace libre, en octets, que les téléversements n’utilisent jamais. Il est conservé pour la base de données, les journaux et le système. `0` désactive la réserve.                                                       |
| `ARKVORY_MAX_OBJECT_BYTES`      | API                | environ 10 TiB    | Plus gros objet, en octets. La valeur maximale autorisée est de 10 000 parties de 1 GiB. Définissez une valeur plus basse pour limiter la taille des fichiers.                                                           |

## Transferts et bande passante {#transfers-and-bandwidth}

Ces limites s’appliquent à un processus d’API. Les débits sont en octets par seconde : `0` signifie aucune limite, et toute autre valeur doit être comprise entre 65 536 et 1 TiB.

| Variable                                          | Lue par | Valeur par défaut | Signification                                                                                                                                                                                                                                                                       |
| ------------------------------------------------- | ------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_MAX_UPLOADS`                             | API     | `2`               | Téléversements simultanés, 1–32.                                                                                                                                                                                                                                                    |
| `ARKVORY_MAX_DOWNLOADS`                           | API     | `16`              | Téléchargements simultanés, 1–256.                                                                                                                                                                                                                                                  |
| `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`               | API     | `1`               | Téléversements simultanés d’un même compte ou d’une même clé, dans la limite du total des téléversements.                                                                                                                                                                           |
| `ARKVORY_MAX_DOWNLOADS_PER_PRINCIPAL`             | API     | `4`               | Téléchargements simultanés d’un même compte ou d’une même clé, dans la limite du total des téléchargements.                                                                                                                                                                         |
| `ARKVORY_TRANSFER_QUEUE_LIMIT`                    | API     | `64`              | Transferts qui peuvent attendre un emplacement libre, 1–1024.                                                                                                                                                                                                                       |
| `ARKVORY_TRANSFER_QUEUE_PER_PRINCIPAL`            | API     | `8`               | Transferts en attente d’un même compte ou d’une même clé, dans la limite de la file.                                                                                                                                                                                                |
| `ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS`               | API     | `20000`           | Durée pendant laquelle un transfert peut attendre dans la file, 1–120 000 ms.                                                                                                                                                                                                       |
| `ARKVORY_MAX_REQUESTS`                            | API     | `128`             | Requêtes authentifiées simultanées, 1–4096. La valeur doit être supérieure au nombre de téléversements plus celui de téléchargements. Si elle n’est pas définie et que les limites de transfert sont élevées, la valeur par défaut est téléversements plus téléchargements plus 64. |
| `ARKVORY_UPLOAD_BYTES_PER_SECOND`                 | API     | `0`               | Débit total de téléversement du processus.                                                                                                                                                                                                                                          |
| `ARKVORY_DOWNLOAD_BYTES_PER_SECOND`               | API     | `0`               | Débit total de téléchargement du processus.                                                                                                                                                                                                                                         |
| `ARKVORY_UPLOAD_BYTES_PER_SECOND_PER_PRINCIPAL`   | API     | `0`               | Débit de téléversement d’un même compte ou d’une même clé, toutes connexions confondues.                                                                                                                                                                                            |
| `ARKVORY_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL` | API     | `0`               | Débit de téléchargement d’un même compte ou d’une même clé, toutes connexions confondues.                                                                                                                                                                                           |
| `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`                  | API     | `30000`           | Une requête de téléversement qui n’envoie aucune donnée pendant cette durée est interrompue, 1–1 800 000 ms.                                                                                                                                                                        |
| `ARKVORY_UPLOAD_DEADLINE_MS`                      | API     | `1800000`         | Durée maximale d’une requête de téléversement, 1–1 800 000 ms. Elle ne peut pas être inférieure au délai d’inactivité.                                                                                                                                                              |

## Réseau, HTTPS et navigateurs {#network-https-and-browsers}

| Variable                     | Lue par | Valeur par défaut | Signification                                                                                                                                                |
| ---------------------------- | ------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ARKVORY_TLS_CERT_FILE`      | API     | non défini        | Certificat PEM (avec sa chaîne) pour HTTPS intégré. À définir avec le fichier de clé.                                                                        |
| `ARKVORY_TLS_KEY_FILE`       | API     | non défini        | Clé privée PEM sans mot de passe.                                                                                                                            |
| `ARKVORY_TLS_MIN_VERSION`    | API     | `TLSv1.2`         | `TLSv1.2` ou `TLSv1.3`.                                                                                                                                      |
| `ARKVORY_TLS_RELOAD_SECONDS` | API     | `300`             | Fréquence de relecture des fichiers de certificat renouvelés : 30–86 400 secondes, ou `0` pour ne les lire qu’au démarrage.                                  |
| `ARKVORY_CORS_ORIGINS`       | API     | vide              | Liste d’au plus 16 origines de navigateur séparées par des virgules, pour une console sur une autre adresse. HTTPS uniquement, ou HTTP sur la boucle locale. |
| `ARKVORY_TRUSTED_PROXIES`    | API     | vide              | Jusqu’à 32 adresses de proxy inverse (IP ou CIDR). Seules celles-ci peuvent définir l’adresse du client avec `X-Forwarded-For`.                              |

HTTPS intégré est réservé aux installations natives. Avec Docker Compose, utilisez un proxy inverse. Voir [HTTPS](../install/https).

## Identité et clés {#identity-and-keys}

| Variable                     | Lue par     | Valeur par défaut | Signification                                                                                                                                                    |
| ---------------------------- | ----------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_KEYS_FILE`          | API, worker | obligatoire       | Fichier JSON contenant les clés de fichier, telles que la clé de récupération et la clé du contrôle de santé. Il stocke des empreintes SHA-256, jamais les clés. |
| `ARKVORY_ALLOW_REGISTRATION` | API         | désactivé         | `true` permet aux personnes de créer leur propre compte sur la page de connexion. Toute autre valeur la laisse désactivée.                                       |

## Sauvegardes {#backups}

| Variable                          | Lue par                  | Valeur par défaut | Signification                                                                                                                                                              |
| --------------------------------- | ------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_BACKUP_VAULT`            | agent                    | non défini        | Répertoire d’un stockage des sauvegardes initialisé. Sans lui, l’agent s’exécute et signale qu’aucun stockage n’est configuré. `arkvory configure --backup-vault` l’écrit. |
| `ARKVORY_BACKUP_BYTES_PER_SECOND` | agent                    | aucune limite     | Limite du débit de copie d’une sauvegarde, au moins 65 536.                                                                                                                |
| `ARKVORY_BACKUP_POLL_SECONDS`     | agent                    | `15`              | Fréquence à laquelle l’agent cherche de nouvelles tâches de sauvegarde, 1–3600 secondes.                                                                                   |
| `ARKVORY_BACKUP_LEASE_SECONDS`    | agent                    | `60`              | Durée du bail (lease) qui empêche l’exécution simultanée d’un second agent, 2–3600 secondes.                                                                               |
| `ARKVORY_BACKUP_SNAPSHOT_SECONDS` | agent                    | `1800`            | Limite de temps pour la partie d’une sauvegarde qui capture l’instantané de la base de données, 60–86 400 secondes.                                                        |
| `ARKVORY_BACKUP_BARRIER_SECONDS`  | agent                    | `30`              | Durée pendant laquelle une sauvegarde attend la fin d’une opération de nettoyage en cours, 1–600 secondes.                                                                 |
| `ARKVORY_RESTORE_DATABASE_URL`    | commande de restauration | non défini        | Base de données cible d’une restauration. C’est plus sûr que `--database-url`, car les autres utilisateurs ne peuvent pas la voir dans la liste des processus.             |

Voir [Sauvegardes](../operate/backups).

## Miroirs {#mirrors}

| Variable                  | Lue par     | Valeur par défaut | Signification                                                                                                                                |
| ------------------------- | ----------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_MIRRORS_FILE`    | API, worker | non défini        | Fichier JSON qui liste les dépôts en miroir (jusqu’à 64). `arkvory configure --mirror` l’écrit.                                              |
| `ARKVORY_MIRRORS_CA_FILE` | worker      | non défini        | Chemin absolu d’un fichier PEM contenant des autorités de certification supplémentaires pour les serveurs sources. TLS est toujours vérifié. |

Voir [Miroirs](../operate/mirrors).

## Webhooks {#webhooks}

| Variable                         | Lue par | Valeur par défaut | Signification                                                                                                                                          |
| -------------------------------- | ------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ARKVORY_WEBHOOKS_FILE`          | worker  | non défini        | Fichier JSON listant les abonnements webhook (jusqu'à 16). Sans lui, aucun webhook n'est envoyé.                                                       |
| `ARKVORY_WEBHOOKS_ALLOW_PRIVATE` | worker  | non défini        | Réseaux au format CIDR séparés par des virgules (jusqu'à 32) pouvant recevoir des webhooks en plus des adresses publiques, par exemple `10.20.0.0/16`. |
| `ARKVORY_WEBHOOKS_CA_FILE`       | worker  | non défini        | Chemin absolu d'un fichier PEM contenant des autorités de certification supplémentaires pour les destinataires. TLS est toujours vérifié.              |

Voir [Webhooks](../protocols/webhooks).

## Mises à jour et hub {#updates-and-the-hub}

| Variable                     | Lue par | Valeur par défaut          | Signification                                                                                                                                                                |
| ---------------------------- | ------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_HUB_URL`            | API     | `https://hub.proanima.net` | Adresse du hub ProAnimaStudio, utilisée par les commentaires de la console. Une valeur vide désactive les commentaires. HTTPS uniquement, ou HTTP sur la boucle locale.      |
| `ARKVORY_HUB_PROJECT`        | API     | `arkvory`                  | Nom du projet sur le hub.                                                                                                                                                    |
| `ARKVORY_UPDATE_CONTROL_DIR` | API     | non défini                 | Répertoire que l’API partage avec l’outil de mise à jour de l’hôte. Les programmes d’installation le définissent. Sans lui, la console ne peut pas demander de mises à jour. |

Voir [Mises à jour](../install/updates).

## Journalisation et arrêt {#logging-and-shutdown}

| Variable                   | Lue par            | Valeur par défaut | Signification                                                                                 |
| -------------------------- | ------------------ | ----------------- | --------------------------------------------------------------------------------------------- |
| `ARKVORY_LOG_LEVEL`        | API, worker, agent | `info`            | `debug`, `info`, `warning` ou `error`.                                                        |
| `ARKVORY_ACCESS_LOG`       | API                | `true`            | `true` écrit une ligne JSON pour chaque requête HTTP ; `false` le désactive.                  |
| `ARKVORY_DRAIN_TIMEOUT_MS` | API                | `30000`           | Après un signal d’arrêt, temps laissé aux requêtes en cours pour se terminer, 0–3 600 000 ms. |

## Passerelles de lecture {#read-gateways}

Dès qu’une de ces variables est définie, l’emplacement, le nombre d’emplacements et le débit partagé deviennent obligatoires. Le processus d’écriture utilise le rôle `api` et l’emplacement `0`. Chaque passerelle de lecture utilise le rôle `reader` et son propre emplacement. Voir [Passerelles de lecture](../operate/read-gateways).

| Variable                                                 | Lue par | Valeur par défaut | Signification                                                                                                                           |
| -------------------------------------------------------- | ------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_ROLE`                                           | API     | `api`             | `api` (le processus d’écriture) ou `reader` (une passerelle de lecture).                                                                |
| `ARKVORY_GATEWAY_SLOTS`                                  | API     | non défini        | Nombre de processus qui se partagent le budget de téléchargement, 2–16.                                                                 |
| `ARKVORY_GATEWAY_SLOT`                                   | API     | non défini        | Emplacement de ce processus, de `0` au nombre d’emplacements moins un.                                                                  |
| `ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND`               | API     | non défini        | Débit de téléchargement total de tous les processus. Chaque emplacement en reçoit une part égale, d’au moins 65 536 octets par seconde. |
| `ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL` | API     | `0`               | Débit de téléchargement total d’un même compte ou d’une même clé sur l’ensemble des processus ; `0` signifie aucune limite.             |

## Watchdog {#watchdog}

| Variable                   | Lue par            | Valeur par défaut | Signification                                                                                                                                                                         |
| -------------------------- | ------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_WATCHDOG_SECONDS` | API, worker, agent | `60`              | Un processus qui reste bloqué pendant cette durée se termine de lui-même, et le gestionnaire de services le redémarre. `0` le désactive (pour un débogueur) ; sinon 10–3600 secondes. |

Voir [Autoréparation](../operate/self-healing).

## Client en ligne de commande {#command-line-client}

| Variable              | Lue par | Valeur par défaut                    | Signification                                                                               |
| --------------------- | ------- | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `ARKVORY_BASE_URL`    | CLI     | profil, puis `http://127.0.0.1:8080` | Adresse du serveur. Lorsqu’elle est définie, la clé doit aussi provenir de l’environnement. |
| `ARKVORY_TOKEN`       | CLI     | non défini                           | La clé elle-même. Elle est prioritaire sur un fichier de clé.                               |
| `ARKVORY_TOKEN_FILE`  | CLI     | fichier de clé du profil             | Chemin d’un fichier qui contient la clé.                                                    |
| `ARKVORY_CLI_HOME`    | CLI     | `~/.config/arkvory`                  | Répertoire du fichier `profiles.json`.                                                      |
| `ARKVORY_CLI_VERSION` | CLI     | `development`                        | Version qu’affiche `--version`. Les paquets de version la contiennent.                      |

Voir [Client en ligne de commande](../protocols/cli).

## Scripts d’installation {#installer-scripts}

`install.sh` lit ces variables sous Linux. Sous Windows, `install.ps1` utilise à la place des paramètres tels que `-Root` et `-Artifact`.

| Variable                  | Valeur par défaut       | Signification                                                                                   |
| ------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------- |
| `ARKVORY_INSTALL_ROOT`    | `/opt/proanima-arkvory` | Racine d’installation. Ne placez pas d’installation native dans un répertoire personnel.        |
| `ARKVORY_ARTIFACT_DIR`    | non défini              | Répertoire d’une version décompressée. Le script l’installe au lieu de télécharger une version. |
| `ARKVORY_RELEASE_VERSION` | dernière version stable | Version stable exacte à installer, par exemple `1.2.3`.                                         |

## Définies par le programme d’installation {#set-by-the-installer}

Le programme d’installation définit ces variables pour ses propres processus auxiliaires. Ne les définissez pas vous-même.

| Variable                  | Signification                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `ARKVORY_IMAGE`           | Image de conteneur de la version actuelle, dans `config/compose.env`.                      |
| `ARKVORY_SERVICE_WRAPPER` | Chemin du wrapper du service de sauvegarde Windows, utilisé lorsque le service est arrêté. |
| `ARKVORY_PROTECT_ROOT`    | Racine d’installation dont les règles d’accès sont définies sous Windows.                  |
| `ARKVORY_ENGINE_USER`     | Sous Windows avec Docker Desktop, donne à l’utilisateur courant l’accès à la racine.       |

## Pages associées {#related-pages}

- [Configuration](../install/configuration)
- [Supervision](../operate/monitoring)
- [Sécurité](../operate/security)
- [Stockage](../operate/storage)
