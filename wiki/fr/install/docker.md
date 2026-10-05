---
title: Docker Compose
description: 'Exécuter Arkvory comme projet Docker Compose, avec ses conteneurs, volumes, ports, mises à jour, agent de sauvegarde et désinstallation.'
---

# Docker Compose

Une installation Compose exécute l’API, le processus de traitement (worker), l’agent de sauvegarde et PostgreSQL sous forme de conteneurs sur un même hôte. L’installateur construit l’image Arkvory à partir de la version et démarre le projet `proanima-arkvory`. Utilisez-la sur des hôtes de conteneurs. Sous Windows, Docker Desktop est réservé à l’évaluation : voir [Windows avec Docker Desktop](#docker-desktop).

Compose n’a pas de HTTPS intégré. Placez un proxy inverse devant avant que des clients se connectent depuis d’autres ordinateurs : voir [HTTPS et proxy inverse](./https).

## Prérequis {#requirements}

| Élément           | Exigence                                                                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Moteur            | Docker Engine avec le plugin Compose (`docker compose`). Podman avec un fournisseur compose compatible est possible avec `--engine podman`, mais il n’est pas testé                           |
| Compte            | `root`, ou un utilisateur du groupe `docker`                                                                                                                                                  |
| Démarrage au boot | Le moteur de conteneurs doit démarrer au boot, sinon Arkvory ne revient pas après un redémarrage. Vérifiez avec `systemctl is-enabled docker`                                                 |
| Hôte              | Une installation Arkvory par hôte de conteneurs. Le nom du projet et le port sont fixes                                                                                                       |
| Port libre        | 8080 sur `127.0.0.1`                                                                                                                                                                          |
| Conteneurs        | Uniquement des conteneurs Linux. Les conteneurs Windows ne sont pas pris en charge                                                                                                            |
| Internet          | `nodejs.org` (l’installateur télécharge Node.js 24.21.0 et vérifie son SHA-256), le hub de mise à jour ou GitHub (la version) et Docker Hub (`node:24.21.0-bookworm-slim` et `postgres:18.4`) |

L’installateur n’installe ni ne modifie le moteur de conteneurs, l’hyperviseur ou WSL.

## Le paquet de la version {#bundle}

L’installateur prend une version vérifiée et la décompresse dans `releases/<version>/` à la racine d’installation. Le fichier Compose est `releases/<version>/deploy/compose.yml` et le fichier de construction est `releases/<version>/deploy/Dockerfile`. L’image `proanima-arkvory:<version>` est construite sur votre hôte à partir de `node:24.21.0-bookworm-slim`. Rien n’est tiré d’un registre Arkvory.

La racine d’installation est `/opt/proanima-arkvory` sous Linux. Son agencement est décrit dans [Choisir une installation](./#installation-directory). Dans une installation Compose, les données ne sont pas dans `data/` : elles se trouvent dans les volumes décrits ci-dessous.

## Conteneurs {#containers}

| Service       | Image                        | Rôle                                                                                                                                     |
| ------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `database`    | `postgres:18.4`              | PostgreSQL. Signale qu’il est prêt avec `pg_isready` toutes les 5 secondes                                                               |
| `api`         | `proanima-arkvory:<version>` | API HTTP et console. Publiée sur `127.0.0.1:8080`. Contrôle de santé toutes les 10 secondes                                              |
| `worker`      | `proanima-arkvory:<version>` | Finalise les téléversements et exécute les tâches d’arrière-plan. Démarre une fois l’API saine                                           |
| `backup`      | `proanima-arkvory:<version>` | Agent de sauvegarde. Lit le volume de stockage en lecture seule. Ne publie aucun port                                                    |
| `initialize`  | `proanima-arkvory:<version>` | Exécution unique, en tant que root : donne à l’utilisateur 1000 la propriété du volume de stockage                                       |
| `migrate`     | `proanima-arkvory:<version>` | Exécution unique : exécute les migrations de la base de données                                                                          |
| `vault-owner` | `proanima-arkvory:<version>` | Exécution unique, uniquement avec le profil `maintenance` : donne à l’utilisateur 1000 la propriété du stockage des sauvegardes (coffre) |

Les services de longue durée redémarrent sauf si vous les arrêtez. Les conteneurs d’Arkvory s’exécutent sous l’utilisateur `node` (utilisateur 1000) de l’image, avec un système de fichiers racine en lecture seule, un `/tmp` de 64 MiB en mémoire, toutes les capacités abandonnées, `no-new-privileges` et 120 secondes pour s’arrêter. Docker conserve jusqu’à cinq fichiers de journal JSON de 20 MiB par conteneur.

## Volumes et montages de liaison {#volumes}

### Volumes Docker {#docker-volumes}

| Volume                     | Monté sur                             | Contenu                                                                                                     |
| -------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `proanima-arkvory_storage` | `/var/lib/arkvory`                    | Contenu des fichiers et zone de transit des téléversements. L’agent de sauvegarde le monte en lecture seule |
| `proanima-arkvory_catalog` | `/var/lib/postgresql` dans `database` | Les données PostgreSQL                                                                                      |

Les volumes survivent aux mises à jour et à `docker compose down`. Seul `down --volumes` les supprime.

### Montages de liaison depuis la racine d’installation {#bind-mounts}

| Chemin sur l’hôte                    | Dans le conteneur               | Mode                | Monté dans                                                         |
| ------------------------------------ | ------------------------------- | ------------------- | ------------------------------------------------------------------ |
| `config/runtime.json`                | `/run/arkvory/runtime.json`     | en lecture seule    | api, worker, backup                                                |
| `config/keys.json`                   | `/run/arkvory/keys.json`        | en lecture seule    | api, worker                                                        |
| `config/health-token.txt`            | `/run/arkvory/health-token.txt` | en lecture seule    | api, worker                                                        |
| `config/postgres.env`                | fichier d’environnement         |                     | database                                                           |
| `updates/status`                     | `/run/arkvory-updates/status`   | en lecture seule    | api, worker                                                        |
| `updates/inbox`                      | `/run/arkvory-updates/inbox`    | en lecture-écriture | api, worker                                                        |
| le stockage des sauvegardes (coffre) | `/srv/arkvory-vault`            | en lecture-écriture | backup, `vault-owner` (uniquement tant qu’un coffre est configuré) |
| `config/mirrors`                     | `/run/arkvory/mirrors`          | en lecture seule    | api, worker (uniquement tant qu’un dépôt est mis en miroir)        |

### Propriétaires et modes {#owners}

| Chemin                                                 | Propriétaire et mode               | Raison                                                                                                                                                                                             |
| ------------------------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| La racine d’installation                               | L’utilisateur qui installe, `0700` | La racine contient la clé de récupération et le mot de passe de la base de données. Seul l’utilisateur qui installe peut y accéder                                                                 |
| `config/runtime.json`, `keys.json`, `health-token.txt` | `0644`                             | L’utilisateur 1000 du conteneur doit pouvoir les lire. `runtime.json` contient le mot de passe de la base de données ; la racine en `0700` tient les autres utilisateurs à l’écart de ces fichiers |
| `updates/inbox`                                        | `0777`                             | Le seul répertoire dans lequel le conteneur écrit sur l’hôte. L’utilisateur du conteneur et le programme de mise à jour de l’hôte peuvent avoir des ID d’utilisateur différents                    |
| `updates/status`                                       | `0755`                             | Écrit par le programme de mise à jour de l’hôte ; le conteneur ne fait que le lire                                                                                                                 |
| Volume de stockage                                     | Utilisateur 1000                   | `initialize` le définit à l’installation et à la mise à jour                                                                                                                                       |
| Stockage des sauvegardes (coffre)                      | Utilisateur 1000                   | `vault-owner` le définit lorsque vous connectez le coffre. Le coffre appartient alors à l’utilisateur de l’hôte dont l’ID est 1000                                                                 |

## Ports {#ports}

| Port     | Service        | Exposition                                                        |
| -------- | -------------- | ----------------------------------------------------------------- |
| 8080/TCP | API et console | `127.0.0.1:8080` sur l’hôte. L’adresse est fixe                   |
| 5432/TCP | PostgreSQL     | Non publié. Accessible uniquement à l’intérieur du réseau Compose |

Le fichier Compose appartient au répertoire de la version, que les mises à jour remplacent, vous ne pouvez donc pas y modifier l’adresse publiée. Pour joindre la console depuis d’autres ordinateurs, installez un proxy inverse sur l’hôte qui redirige vers `127.0.0.1:8080`.

## Environnement {#environment}

Le fichier Compose ne définit aucun réglage Arkvory. Les services lisent `/run/arkvory/runtime.json`, qui correspond à `config/runtime.json` sur l’hôte. L’installateur écrit ces valeurs et vous ne devez pas les modifier : `ARKVORY_HOST` (`0.0.0.0` dans le conteneur), `ARKVORY_PORT` (`8080`), `ARKVORY_DATABASE_URL` (le conteneur `database` avec un mot de passe généré), `ARKVORY_DATA_DIR` (`/var/lib/arkvory`), `ARKVORY_KEYS_FILE` et `ARKVORY_UPDATE_CONTROL_DIR`.

Vous pouvez ajouter d’autres réglages, comme `ARKVORY_TRUSTED_PROXIES`, les limites ou `ARKVORY_LOG_LEVEL`. Ajoutez-les à `config/runtime.json`, puis arrêtez et redémarrez les services comme indiqué dans [Gérer le projet](#manage). La liste complète se trouve dans [Variables d’environnement](../reference/environment). `config/compose.env` contient `ARKVORY_IMAGE`. L’installateur le maintient ; ne le modifiez pas.

## Installer sous Linux {#install}

1. Téléchargez `install.sh` depuis [GitHub Releases](https://github.com/ProAnima/Arkvory/releases) et lisez-le.
2. Exécutez-le en tant que `root` :

   ```bash
   sudo bash ./install.sh --mode compose
   ```

   Ajoutez `--automatic` pour activer les mises à jour automatiques, ou `--engine podman` pour Podman. Avec `ARKVORY_RELEASE_VERSION=1.2.3`, le script installe cette version stable. Sans accès internet à GitHub, décompressez `Arkvory-Linux.tar.gz` et exécutez `sudo env ARKVORY_ARTIFACT_DIR="$PWD" bash ./install.sh --mode compose` dans le répertoire décompressé. Node.js est tout de même téléchargé.

3. Attendez que l’installateur se termine. Il vérifie et décompresse la version, construit l’image, démarre la base de données, exécute `initialize` et `migrate`, démarre l’API et le processus de traitement (worker), attend que l’API signale qu’elle est prête trois fois de suite, démarre l’agent de sauvegarde et enregistre le minuteur de mise à jour.

Un utilisateur du groupe `docker` peut installer sans `root` dans un répertoire qui lui appartient :

```bash
ARKVORY_INSTALL_ROOT="$HOME/arkvory" bash ./install.sh --mode compose
```

L’installateur n’enregistre alors aucun minuteur de mise à jour. La console ne peut pas demander de mises à jour tant que vous ne planifiez pas vous-même le programme de mise à jour. Voir [Mises à jour dans Compose](#updates-compose).

## Premier démarrage et premiers pas {#first-start}

1. Vérifiez que les conteneurs fonctionnent. Voir [Gérer le projet](#manage) pour la commande `compose`.

   ```bash
   "${compose[@]}" ps
   ```

2. Lisez la clé de récupération :

   ```bash
   sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
   ```

3. Ouvrez `http://127.0.0.1:8080/console/#onboarding` sur le serveur. Depuis votre propre ordinateur, redirigez le port : `ssh -L 8080:127.0.0.1:8080 admin@arkvory.example`.
4. Dans la console, ouvrez [[ui:navStart]] et développez [[ui:welcomeOwner]]. Collez la clé dans [[ui:welcomeRecovery]], saisissez le nom du propriétaire et un mot de passe d’au moins 12 caractères, puis sélectionnez [[ui:welcomeCreate]].

Conservez la clé de récupération sur le serveur. Voir [Sécurité](../operate/security).

## Gérer le projet {#manage}

Ouvrez un shell root (`sudo -i`) et définissez la commande `compose` une fois pour toutes. Compose a besoin du nom du projet, du répertoire du projet, du fichier d’environnement et de chaque fichier Compose de l’installation :

```bash
root=/opt/proanima-arkvory
node="$root/runtime/node-v24.21.0-linux-x64/bin/node"   # linux-arm64 on arm64
version=$("$node" -p "require('$root/installation.json').current.version")
compose=(docker compose --project-name proanima-arkvory --project-directory "$root"
  --env-file "$root/config/compose.env" -f "$root/releases/$version/deploy/compose.yml")
for file in compose.vault.yml compose.mirrors.yml; do
  if [[ -f "$root/config/$file" ]]; then compose+=(-f "$root/config/$file"); fi
done
```

Si vous omettez un fichier qui existe, `up` recrée le conteneur sans le montage du coffre ou du miroir.

| Tâche                   | Commande                                                                      |
| ----------------------- | ----------------------------------------------------------------------------- |
| Afficher les conteneurs | `"${compose[@]}" ps`                                                          |
| Lire les journaux       | `"${compose[@]}" logs --tail 100 api worker backup`                           |
| Arrêter Arkvory         | `"${compose[@]}" stop --timeout 120 backup worker api`                        |
| Démarrer Arkvory        | `"${compose[@]}" up -d --wait api worker` puis `"${compose[@]}" up -d backup` |

Un arrêt avec `stop` maintient un conteneur arrêté après un redémarrage du moteur. Redémarrez-le avec `up -d`.

Les commandes de cycle de vie s’exécutent avec le Node.js que l’installateur a placé dans la racine :

```bash
sudo "$node" "$root/manage.mjs" status --root "$root"
```

`arkvory` n’est pas installé sur un hôte Compose, appelez donc `manage.mjs` pour `status`, `update` et `configure`. Les commandes sont décrites dans [Configuration](./configuration).

## Journaux {#logs}

Les conteneurs écrivent dans les fichiers de journal JSON de Docker. Lisez-les avec `"${compose[@]}" logs`. L’API et le processus de traitement (worker) écrivent un enregistrement JSON par ligne. Voir [Supervision](../operate/monitoring). Les commandes de cycle de vie affichent leurs messages dans le terminal, et le minuteur de mise à jour écrit dans le journal : `journalctl -u arkvory-update`.

## Mises à jour dans Compose {#updates-compose}

Effectuez la mise à jour avec la console, la fenêtre de mise à jour automatique ou la commande :

```bash
sudo "$node" "$root/manage.mjs" update --root "$root"
```

La mise à jour télécharge et vérifie la version, construit la nouvelle image, puis arrête `backup`, `worker` et `api` et les redémarre avec la nouvelle image. Le conteneur `database` continue de fonctionner. Les volumes restent tels quels. Une version qui modifie le schéma de la base de données n’est installée qu’après une sauvegarde vérifiée. Voir [Mises à jour](./updates).

Le programme de mise à jour de l’hôte s’exécute une fois par minute. Installé en tant que `root` sur un hôte systemd, l’installateur l’enregistre sous `arkvory-update.timer`. Sans `root`, l’installateur affiche un avertissement. Planifiez cette commande toutes les minutes en tant qu’utilisateur qui possède l’installation et a accès au moteur de conteneurs, par exemple avec cron :

```text
* * * * * /home/admin/arkvory/runtime/node-v24.21.0-linux-x64/bin/node /home/admin/arkvory/manage.mjs updates-poll --root /home/admin/arkvory
```

Ne donnez jamais le socket Docker aux conteneurs Arkvory.

## Agent de sauvegarde dans Compose {#backup-agent}

Le conteneur `backup` s’exécute dès le départ. Sans coffre, il s’exécute et signale qu’aucun coffre n’est configuré. Le coffre est un répertoire de l’hôte, en dehors de la racine d’installation, sur un volume distinct.

1. Montez le volume du coffre et créez un répertoire vide, par exemple `/mnt/backup/arkvory`. Le répertoire doit exister : Compose ne le crée pas.
2. Connectez-le :

   ```bash
   sudo "$node" "$root/manage.mjs" configure --root "$root" --backup-vault /mnt/backup/arkvory --init-vault
   ```

   La commande vérifie le répertoire, écrit `config/compose.vault.yml`, donne à l’utilisateur 1000 la propriété du répertoire, crée le coffre dans un répertoire vide (`--init-vault`) et ne redémarre que le conteneur de sauvegarde. Elle réussit lorsque l’agent signale le coffre comme disponible. Sinon, elle restaure la configuration précédente.

3. Pour déconnecter le coffre, exécutez la même commande avec `--backup-vault-off`. Le coffre lui-même n’est pas touché.

Les planifications, la rétention et les restaurations sont décrites dans [Sauvegardes](../operate/backups).

## Désinstallation {#remove}

```bash
"${compose[@]}" down              # removes the containers, keeps the volumes
"${compose[@]}" down --volumes    # also deletes the catalog and all stored files
```

`down --volumes` supprime toutes les données. Ne l’exécutez jamais sur une installation qui contient des fichiers. Faites d’abord une sauvegarde et conservez le coffre.

Après `down`, vous pouvez supprimer ce qui reste :

```bash
sudo systemctl disable --now arkvory-update.timer
sudo rm -f /etc/systemd/system/arkvory-update.service /etc/systemd/system/arkvory-update.timer
sudo systemctl daemon-reload
docker image rm "proanima-arkvory:$version"
sudo rm -rf /opt/proanima-arkvory
```

Ne supprimez la racine qu’une fois que vous n’avez plus besoin de la configuration et de la clé de récupération. Les images des versions antérieures restent sur l’hôte jusqu’à ce que vous les supprimiez.

## Windows avec Docker Desktop {#docker-desktop}

N’utilisez Docker Desktop pour l’évaluation que sur un poste de travail. Docker Desktop est une application propre à un utilisateur : les conteneurs ne s’exécutent que tant que cet utilisateur est connecté et que Docker Desktop fonctionne. Après un redémarrage de l’ordinateur, Arkvory reste indisponible jusque-là. Activez **Settings > General > Start Docker Desktop when you sign in**. L’installateur et la commande `status` avertissent lorsque ce réglage est désactivé. Pour un serveur, utilisez les [services Windows](./windows).

1. Démarrez Docker Desktop en mode conteneurs Linux.
2. Téléchargez `install.ps1` depuis la version et lisez-le.
3. Ouvrez Windows PowerShell en tant qu’utilisateur qui exécute Docker Desktop, **sans** droits d’administrateur, et exécutez :

   ```powershell
   .\install.ps1 -Mode compose
   ```

   Les paramètres `-Root`, `-Version`, `-Engine`, `-Artifact`, `-AutomaticUpdates` et `-Pin` sont décrits dans [Windows](./windows#install-with-powershell-and-an-existing-postgresql). Indiquez `-Root` et `-Artifact` sous forme de chemins absolus.

4. Ouvrez `http://127.0.0.1:8080/console/#onboarding`, lisez la clé de récupération dans `C:\ProgramData\ProAnima\Arkvory\config\bootstrap-token.txt` et créez le propriétaire comme décrit dans [Premier démarrage et premiers pas](#first-start).

La racine d’installation `C:\ProgramData\ProAnima\Arkvory` accorde l’accès à SYSTEM, aux administrateurs et à l’utilisateur qui installe, sans héritage, car Docker Desktop lit les montages de liaison avec le jeton de cet utilisateur. N’exécutez pas l’installateur avec élévation pour Compose.

L’installateur n’enregistre la tâche de mise à jour `ProAnimaArkvoryUpdate` que lorsqu’il s’exécute en tant qu’administrateur. Cette tâche convient à un moteur à l’échelle du système, pas à Docker Desktop. Pour Docker Desktop, enregistrez la tâche en tant qu’utilisateur de Docker Desktop. Elle ne fonctionne que tant que cet utilisateur est connecté et que Docker Desktop fonctionne :

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
$node = "$root\runtime\node-v24.21.0-win-x64\node.exe"
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$root\manage.mjs`" updates-poll --root `"$root`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Action $action -Trigger $trigger -Settings $settings
```

Gérez le projet dans PowerShell avec les mêmes arguments :

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
$version = (Get-Content "$root\installation.json" -Raw | ConvertFrom-Json).current.version
$compose = @('compose', '--project-name', 'proanima-arkvory', '--project-directory', $root,
  '--env-file', "$root\config\compose.env", '-f', "$root\releases\$version\deploy\compose.yml")
foreach ($file in 'compose.vault.yml', 'compose.mirrors.yml') {
  if (Test-Path "$root\config\$file") { $compose += @('-f', "$root\config\$file") }
}
docker @compose ps
& "$root\runtime\node-v24.21.0-win-x64\node.exe" "$root\manage.mjs" status --root $root
```

Un coffre de sauvegarde sous Windows doit être un volume local ou iSCSI. Les chemins UNC et SMB sont refusés. Pour désinstaller, exécutez `docker @compose down --volumes`, désenregistrez la tâche avec `Unregister-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Confirm:$false`, puis supprimez la racine. Sauvegardez d’abord.
