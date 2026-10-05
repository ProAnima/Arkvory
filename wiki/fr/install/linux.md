---
title: Linux
description: Installez Arkvory sous Linux depuis le paquet .deb ou .rpm, démarrez-le, exploitez les services systemd, mettez-le à niveau et supprimez-le.
---

# Linux

Il existe deux façons d’exécuter Arkvory sous Linux :

- **Paquet** `Arkvory-amd64.deb` ou `Arkvory-x86_64.rpm`. Recommandé. Il installe les services systemd et un cluster PostgreSQL dédié qu’Arkvory gère. Votre gestionnaire de paquets fournit les programmes PostgreSQL.
- **Script** `install.sh`. Il installe les mêmes services, mais utilise un serveur PostgreSQL existant. Il prend aussi en charge arm64. Voir [Utiliser un PostgreSQL existant](#existing-postgresql).

Pour Docker, voir [Docker Compose](./docker). Pour une première prise en main de la console, voir le [Démarrage rapide](../guide/quick-start).

## Prérequis {#requirements}

| Élément               | Exigence                                                                                                                                                                                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Processeur            | x64 pour les paquets. Il n’y a pas de paquet arm64 : utilisez `install.sh` sous arm64                                                                                                                                                                                                                      |
| Système d’init        | systemd. OpenRC, runit et les autres systèmes d’init ne sont pas pris en charge                                                                                                                                                                                                                            |
| Bibliothèque C        | glibc 2.28 ou version ultérieure. Alpine Linux (musl) n’est pas pris en charge                                                                                                                                                                                                                             |
| Distributions testées | Ubuntu 24.04 pour le `.deb`, Fedora 44 pour le `.rpm`. Les autres distributions systemd qui satisfont les dépendances ci-dessous ne sont pas testées                                                                                                                                                       |
| Dépendances du `.deb` | `postgresql` 16 ou version ultérieure, `systemd`, `python3`, `ca-certificates`, `libc6` 2.28 ou version ultérieure, `libstdc++6`, `libgcc-s1`, `libatomic1`                                                                                                                                                |
| Dépendances du `.rpm` | `postgresql-server` 16 ou version ultérieure, `systemd`, `python3`, `ca-certificates`, `glibc` 2.28 ou version ultérieure, `libstdc++`, `libatomic`                                                                                                                                                        |
| Programmes PostgreSQL | Version 16 à 19. L’étape d’installation cherche dans `/usr/lib/postgresql/*/bin`, `/usr/pgsql-*/bin`, `/usr/bin` et `/usr/lib/pgsql/bin` et prend la version la plus élevée qu’elle trouve. Si votre distribution ne propose qu’une version plus ancienne, ajoutez d’abord un dépôt PostgreSQL plus récent |
| Compte                | `root`, ou un utilisateur pouvant exécuter `sudo`                                                                                                                                                                                                                                                          |
| Ports libres          | 8080 et 54329 sur `127.0.0.1`                                                                                                                                                                                                                                                                              |
| Stockage de fichiers  | Un système de fichiers local qui prend en charge les liens physiques. N’utilisez pas un partage réseau                                                                                                                                                                                                     |

Le paquet contient Node.js 24. Son installation ne nécessite aucun accès à internet au-delà de ce que votre gestionnaire de paquets utilise pour les dépendances.

Le paquet ne modifie jamais un cluster ou un service PostgreSQL existant. Arkvory démarre son propre cluster à partir des programmes PostgreSQL.

## Installer le paquet {#install-package}

1. Téléchargez le paquet correspondant à votre distribution depuis [GitHub Releases](https://github.com/ProAnima/Arkvory/releases), avec `native-linux.json` de la même version.
2. Comparez le SHA-256 du paquet avec la valeur dans `native-linux.json`. Les paquets ne sont pas signés par une clé d’éditeur : cette vérification est donc la seule preuve de ce que vous avez téléchargé.
3. Installez le paquet. Gardez le `./` devant le nom du fichier : il indique au gestionnaire de paquets que le fichier est local. Sur Debian et Ubuntu :

```bash
sudo apt install ./Arkvory-amd64.deb
```

Sur Fedora et les systèmes compatibles RPM :

```bash
sudo dnf install ./Arkvory-x86_64.rpm
```

Le gestionnaire de paquets installe les dépendances, puis Arkvory se configure. Il :

1. copie Node.js vers `/opt/proanima-arkvory/runtime/node`,
2. crée les deux comptes de service, la configuration, les clés et la clé de récupération,
3. crée et démarre le cluster PostgreSQL et exécute les migrations de base de données,
4. enregistre et démarre les services et le minuteur de mise à jour,
5. attend que l’API réponde à son contrôle de disponibilité trois fois de suite.

À la fin, il affiche l’adresse de la console et le chemin de la clé de récupération. Si une étape échoue, l’installation s’arrête avec une erreur. Voir [Dépannage](#troubleshooting).

Les mises à jour automatiques sont désactivées après l’installation. Pour les activer, voir [Mises à jour](./updates).

## Ce que crée le paquet {#what-package-creates}

### Fichiers et répertoires {#files}

| Chemin                                                          | Contenu                                                                                                                                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/usr/lib/proanima-arkvory/`                                    | Contenu du paquet : Node.js, les fichiers de version et le programme d’installation. Appartient au paquet                                                                        |
| `/usr/bin/arkvory`                                              | La commande de gestion. Voir [La commande arkvory](#arkvory-command)                                                                                                             |
| `/usr/share/applications/arkvory.desktop`                       | Entrée de menu qui ouvre la console sur un poste de bureau. Un serveur sans bureau ne l’utilise pas                                                                              |
| `/opt/proanima-arkvory/`                                        | La racine d’installation : configuration, données, base de données, code de chaque version. Son agencement est décrit dans [Choisir une installation](./#installation-directory) |
| `/etc/systemd/system/arkvory-*.service`, `arkvory-update.timer` | Les unités de service et le minuteur de mise à jour                                                                                                                              |

La racine est `root:arkvory` avec le mode `0711`. À l’intérieur, `config/` est `0750 root:arkvory`, `data/` et `logs/` appartiennent à `arkvory`, et `database/` appartient à `arkvory-db` avec le mode `0700`. La clé de récupération et les fichiers de mot de passe de la base de données ne sont lisibles que par `root`.

### Comptes {#accounts}

| Compte       | Exécute                                                    | Remarques                                                                                                       |
| ------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `arkvory`    | API, processus de traitement (worker), agent de sauvegarde | Compte système, sans shell de connexion, répertoire personnel `/opt/proanima-arkvory/data`                      |
| `arkvory-db` | La base de données                                         | Compte système, sans shell de connexion. Le compte de l’API ne peut pas lire les fichiers de la base de données |

### Services {#services}

| Unité                  | Exécuté en tant que                                 | Politique de redémarrage                                                    |
| ---------------------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| `arkvory-database`     | `arkvory-db`                                        | `on-failure`, après 10 secondes                                             |
| `arkvory-api`          | `arkvory`                                           | `always`, après 10 secondes                                                 |
| `arkvory-worker`       | `arkvory`                                           | `always`, après 10 secondes                                                 |
| `arkvory-backup`       | `arkvory`                                           | `always`, après 10 secondes                                                 |
| `arkvory-update.timer` | démarre `arkvory-update.service` en tant que `root` | Chaque minute. La tâche vérifie les demandes de mise à jour et les versions |

Toutes les unités démarrent au démarrage (`multi-user.target`). Elles disposent de 120 secondes pour s’arrêter. Elles s’exécutent avec `NoNewPrivileges`, un `/tmp` privé, un système de fichiers en lecture seule en dehors de leurs propres répertoires et aucun accès à `/home`. L’API et le processus de traitement (worker) ne peuvent écrire que dans `data/`, `logs/` et `updates/inbox/` de la racine. L’agent de sauvegarde lit le stockage et n’écrit que dans le stockage des sauvegardes. Comme `/home` est masqué pour les unités, ne placez jamais de certificats, de stockages des sauvegardes ou de répertoire de données sous un répertoire personnel.

Un service qui s’arrête sans votre demande redémarre après 10 secondes. Un processus dont le thread principal se bloque pendant 60 secondes se termine et redémarre. Un contrôle de disponibilité échoué ne suffit pas à redémarrer un service. Voir [Autoréparation](../operate/self-healing).

### Ports {#ports}

| Port      | Usage                      | Exposition                                                               |
| --------- | -------------------------- | ------------------------------------------------------------------------ |
| 8080/TCP  | API et console             | `127.0.0.1` uniquement, jusqu’à ce que vous configuriez [HTTPS](./https) |
| 54329/TCP | Le cluster PostgreSQL géré | `127.0.0.1` uniquement. Le numéro est fixe                               |

## Premier démarrage et premiers pas {#first-start}

1. Vérifiez que les services fonctionnent :

   ```bash
   systemctl status arkvory-database arkvory-api arkvory-worker arkvory-backup
   ```

2. Lisez la clé de récupération. Seul `root` peut la lire.

   ```bash
   sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
   ```

3. Ouvrez `http://127.0.0.1:8080/console/#onboarding`. Sur un serveur distant, redirigez d’abord le port puis ouvrez l’adresse sur votre propre ordinateur :

   ```bash
   ssh -L 8080:127.0.0.1:8080 admin@arkvory.example
   ```

4. Dans la console, ouvrez [[ui:navStart]] et dépliez [[ui:welcomeOwner]]. Collez la clé dans [[ui:welcomeRecovery]], saisissez le nom du propriétaire et un mot de passe d’au moins 12 caractères, puis sélectionnez [[ui:welcomeCreate]]. Le nom contient de 3 à 64 caractères : lettres latines, chiffres, point, tiret ou trait de soulignement.
5. Connectez-vous avec le nouveau nom et le mot de passe.

Le propriétaire est le premier administrateur. La clé de récupération reste sur le serveur : ne supprimez pas le fichier et ne le copiez pas vers des clients ou des systèmes de CI. Les outils d’installation la lisent. Pour le travail quotidien, créez des comptes et des clés de service. Voir [Comptes et accès](../use/accounts) et [Sécurité](../operate/security).

Avant que des clients se connectent depuis d’autres ordinateurs, configurez [HTTPS](./https). Connectez ensuite un stockage des sauvegardes et lancez une première sauvegarde : voir [Sauvegardes](../operate/backups).

Pour installer sur un serveur depuis votre propre ordinateur, vous pouvez plutôt utiliser Arkvory Remote Setup. Voir [Choisir une installation](./#remote-installation-over-ssh).

## La commande arkvory {#arkvory-command}

Le paquet installe `/usr/bin/arkvory`. `arkvory help` liste toutes les commandes et ne nécessite aucun droit particulier. Toute autre commande nécessite `root` et la racine d’installation :

```bash
sudo arkvory status --root /opt/proanima-arkvory
```

`status` affiche le mode d’installation, la version installée, le réglage des mises à jour automatiques et l’épinglage de version.

| Commande          | Usage                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `status`          | Affiche la version installée et la politique de mise à jour                                                      |
| `update`          | Installe maintenant une version stable plus récente. Voir [Mises à jour](./updates)                              |
| `configure`       | HTTPS, stockage des sauvegardes, miroirs, politique de mise à jour et hub. Voir [Configuration](./configuration) |
| `recover`         | Termine une mise à jour interrompue. Voir [Mises à jour](./updates#recover-update)                               |
| `finish-install`  | Poursuit une installation interrompue                                                                            |
| `updates-connect` | Connecte la console et le minuteur de mise à jour d’une installation mise à jour depuis une ancienne version     |

## Journaux {#logs}

Les services écrivent dans le journal système. L’API et le processus de traitement (worker) écrivent un enregistrement JSON par ligne.

```bash
sudo journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup -u arkvory-database
sudo journalctl -u arkvory-api -f
sudo journalctl -u arkvory-update --since today
```

`arkvory-update` contient la sortie du minuteur de mise à jour. La taille du journal et sa rétention sont des réglages de votre système d’exploitation. Pour les champs des enregistrements et les métriques, voir [Supervision](../operate/monitoring). Les commandes de déploiement affichent des lignes de la forme `<ISO-8601 time> INFO|WARN|ERROR <text>`. Les secrets en sont retirés.

## Mise à niveau {#upgrade}

Installez un paquet plus récent par-dessus l’ancien, ou mettez à jour depuis la console ou avec `arkvory update`. Les services en cours continuent de répondre jusqu’à ce que la mise à jour bascule vers le nouveau code. Voir [Mises à jour](./updates) pour les politiques, la sauvegarde avant une modification du schéma de la base de données et les étapes de récupération.

Il n’y a pas de dépôt apt ou dnf pour Arkvory. Téléchargez chaque nouveau paquet depuis la page de version.

## Désinstallation {#remove}

### Supprimer le paquet et conserver les données {#remove-package}

Sur Debian et Ubuntu :

```bash
sudo apt remove proanima-arkvory
```

Sur Fedora et les systèmes compatibles RPM :

```bash
sudo dnf remove proanima-arkvory
```

La désinstallation arrête et désactive les services et le minuteur de mise à jour. Elle supprime `/usr/lib/proanima-arkvory`, `/usr/bin/arkvory` et l’entrée de menu. Elle **conserve** volontairement :

- `/opt/proanima-arkvory` : la base de données, tous les fichiers, la configuration et la clé de récupération,
- les fichiers d’unités dans `/etc/systemd/system`, les comptes `arkvory` et `arkvory-db`,
- le stockage des sauvegardes et son drop-in systemd. Il ne touche jamais au stockage des sauvegardes.

`apt purge` ne supprime pas plus que `apt remove`. Si vous réinstallez le paquet, il reprend avec les données conservées et démarre les services.

### Tout supprimer {#remove-all}

Cette opération supprime tous les fichiers stockés et le catalogue. Faites d’abord une sauvegarde et conservez le stockage des sauvegardes.

```bash
sudo systemctl disable --now arkvory-update.timer arkvory-backup arkvory-worker arkvory-api arkvory-database
sudo rm -rf /opt/proanima-arkvory
sudo rm -f /etc/systemd/system/arkvory-*.service /etc/systemd/system/arkvory-update.timer
sudo rm -rf /etc/systemd/system/arkvory-backup.service.d
sudo systemctl daemon-reload
sudo userdel arkvory
sudo userdel arkvory-db
```

Supprimez d’abord le paquet, comme décrit ci-dessus. Après une installation par script, il n’y a pas de paquet : la première commande arrête les services, et les commandes qui nomment `arkvory-database` et `arkvory-db` signalent que ces éléments n’existent pas.

## Utiliser un PostgreSQL existant {#existing-postgresql}

Le paquet crée toujours son propre cluster. Pour utiliser un serveur PostgreSQL exploité par votre organisation, installez avec `install.sh`. Il crée les trois mêmes services et le minuteur de mise à jour, mais aucune unité `arkvory-database` et aucune commande `/usr/bin/arkvory`.

Utilisez une version PostgreSQL de 16 à 19. Utilisez une base de données pour une installation d’Arkvory. Ne connectez jamais deux installations à la même base de données.

1. Demandez à votre administrateur de base de données une base vide et un rôle qui en est propriétaire. Arkvory exécute ses migrations avec ce rôle.
2. Téléchargez `install.sh` depuis la version publiée et relisez-le. Il nécessite `bash`, `curl`, `python3`, `tar` et `xz`, systemd et `root`.
3. Exécutez-le. Le script demande l’URL de connexion ; la saisie est masquée.

   ```bash
   sudo bash ./install.sh --automatic
   ```

   Pour transmettre plutôt l’URL dans un fichier, créez un fichier que seul `root` peut lire :

   ```json
   { "ARKVORY_DATABASE_URL": "postgresql://arkvory:<password>@db.example:5432/arkvory" }
   ```

   ```bash
   sudo bash ./install.sh --config /root/arkvory.json
   ```

4. Supprimez le répertoire temporaire `/opt/proanima-arkvory/bootstrap.*` lorsque l’installation est terminée. Si vous avez saisi l’URL à l’invite, le répertoire la contient dans `native.json`.
5. Créez le propriétaire comme décrit dans [Premier démarrage et premiers pas](#first-start).

Le script télécharge Node.js 24.21.0 depuis `nodejs.org`, vérifie son SHA-256 et installe la dernière version stable. Omettez `--automatic` pour laisser les mises à jour automatiques désactivées. Les variables d’environnement modifient les valeurs par défaut :

| Variable                  | Signification                                                                    | Valeur par défaut       |
| ------------------------- | -------------------------------------------------------------------------------- | ----------------------- |
| `ARKVORY_INSTALL_ROOT`    | Racine d’installation. Utilisez un répertoire dédié et vide en dehors de `/home` | `/opt/proanima-arkvory` |
| `ARKVORY_RELEASE_VERSION` | Installe cette version stable au lieu de la dernière                             | dernière version stable |
| `ARKVORY_ARTIFACT_DIR`    | Installe depuis un `Arkvory-Linux.tar.gz` décompressé au lieu de GitHub          | non définie             |

Transmettez-les via `sudo env`, par exemple `sudo env ARKVORY_INSTALL_ROOT=/srv/arkvory bash ./install.sh`.

Sans la commande `arkvory`, appelez le programme de gestion avec le Node.js installé par le script. Utilisez `linux-arm64` sous arm64 :

```bash
root=/opt/proanima-arkvory
sudo "$root/runtime/node-v24.21.0-linux-x64/bin/node" "$root/manage.mjs" status --root "$root"
```

Vous sauvegardez et maintenez vous-même le serveur PostgreSQL. L’agent de sauvegarde d’Arkvory copie le contenu de la base de données dans le stockage des sauvegardes via l’URL de connexion. Voir [Sauvegardes](../operate/backups).

## Dépannage {#troubleshooting}

| Problème                                                                      | Que faire                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PostgreSQL 16–19 server binaries are required`                               | Les programmes PostgreSQL sont absents ou trop anciens. Installez un serveur PostgreSQL de version 16 à 19 et réinstallez le paquet                                                                                                                                                                                                                                                                                                                                                   |
| `Use a dedicated empty installation directory`                                | `/opt/proanima-arkvory` contient des fichiers d’une première installation qui s’est arrêtée avant d’enregistrer `installation.json`. Le programme d’installation n’écrase jamais une configuration. Lisez le journal et la sortie du gestionnaire de paquets, puis corrigez la cause. Un répertoire qui ne contient pas encore de données peut être déplacé pour vous permettre de réinstaller. Ne supprimez pas `config/` ni `database/` d’une installation qui contient des données |
| `Installation is locked`                                                      | Une opération est en cours ou a planté. Arrêtez le minuteur de mise à jour, lisez `journal.json` dans la racine et ne supprimez pas `operation.lock` avant de connaître l’état. Voir [Mises à jour](./updates#recover-update)                                                                                                                                                                                                                                                         |
| `database/bootstrap-started` existe, mais `database/initialized` n’existe pas | La création de la base de données a été interrompue. Ne supprimez pas le cluster et ne rejouez pas le SQL à la main. Corrigez la cause et exécutez `sudo arkvory finish-install --root /opt/proanima-arkvory`                                                                                                                                                                                                                                                                         |
| Un service ne démarre pas                                                     | `journalctl -u arkvory-api -n 100`. Un échec de démarrage affiche un enregistrement JSON avec une `reason` qui nomme le réglage, jamais sa valeur                                                                                                                                                                                                                                                                                                                                     |
| Le port 8080 est occupé                                                       | Un autre programme l’utilise. Libérez le port, ou définissez `ARKVORY_PORT` dans `config/runtime.json`. Voir [Configuration](./configuration#address-and-port). Le port de base de données 54329 ne peut pas être modifié                                                                                                                                                                                                                                                             |

Si l’installation s’est arrêtée après avoir écrit `installation.json`, vous pouvez aussi répéter l’étape de configuration du paquet : `sudo dpkg --configure -a` sous Debian et Ubuntu, ou réinstaller le même paquet sur les systèmes RPM.

D’autres conseils figurent dans [Dépannage](../operate/troubleshooting).
