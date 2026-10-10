---
title: Choisir une installation
---

# Choisir une installation

Arkvory s’exécute sur un seul serveur. Chaque installation comprend les mêmes éléments :

- **API** : l’API HTTP et la console web.
- **Processus de traitement (worker)** : termine les téléversements et exécute les tâches d’arrière-plan.
- **Agent de sauvegarde** : effectue des sauvegardes planifiées vers un stockage des sauvegardes.
- **PostgreSQL** : la base de données du catalogue.

Le contenu des fichiers est stocké sur un disque local du serveur. Un serveur seul n’est pas un système à haute disponibilité : une mise à jour ou une panne du serveur provoque une courte interruption, et les clients reprennent leurs transferts. Pour deux ou trois serveurs Linux qui conservent une copie synchrone et se relaient, voir [Cluster à haute disponibilité](../operate/cluster).

## Options d’installation {#installation-options}

| Option                                                                                          | Plateforme                                   | Démarre après un redémarrage sans connexion                                                                 | Base de données                                                  | Mises à jour automatiques après l’installation                    | Recommandée pour                                                          |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [Programme d’installation graphique](./windows) `Arkvory-Setup-x64.exe`                         | Windows x64                                  | Oui (services Windows)                                                                                      | PostgreSQL 18.4 intégré, géré par Arkvory                        | Désactivées                                                       | Serveurs et postes de travail Windows, installation sans accès à internet |
| [Paquet Linux](./linux) `Arkvory-amd64.deb`, `Arkvory-x86_64.rpm`                               | Linux x64 avec systemd                       | Oui (unités systemd)                                                                                        | Cluster PostgreSQL dédié de votre distribution (version 16 à 19) | Désactivées                                                       | Serveurs Debian, Ubuntu et à base de RPM                                  |
| Script, services natifs : `install.sh` ([Linux](./linux)), `install.ps1` ([Windows](./windows)) | Linux x64 ou arm64 avec systemd, Windows x64 | Oui                                                                                                         | Votre serveur PostgreSQL existant                                | Désactivées, ou activées avec `--automatic` / `-AutomaticUpdates` | Automatisation, serveur PostgreSQL existant, Linux arm64                  |
| [Docker Compose](./docker)                                                                      | Linux avec Docker Engine                     | Oui, si le moteur de conteneurs démarre au démarrage du système                                             | Conteneur PostgreSQL 18.4                                        | Désactivées, ou activées avec `--automatic`                       | Hôtes de conteneurs                                                       |
| [Docker Desktop](./docker)                                                                      | Windows x64                                  | Non. Les conteneurs ne s’exécutent qu’après la connexion de l’utilisateur et le démarrage de Docker Desktop | Conteneur PostgreSQL 18.4                                        | Désactivées, ou activées avec `-AutomaticUpdates`                 | Évaluation sur un poste de travail                                        |

Toutes les options installent la même API, le même processus de traitement et le même agent de sauvegarde. HTTPS intégré n’est disponible que pour les installations natives. Une installation Compose a besoin d’un proxy inverse pour HTTPS. Voir [HTTPS et proxy inverse](./https).

### Installation à distance par SSH {#remote-installation-over-ssh}

**Arkvory Remote Setup** fait partie des paquets clients. Il s’exécute sur l’ordinateur de l’administrateur, se connecte à un serveur par SSH et y installe le paquet natif Linux ou Windows. Il crée ensuite le compte propriétaire et ouvre la console par un tunnel SSH privé.

| Serveur     | Prérequis                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| Linux x64   | SSH et SFTP, systemd, `apt-get` ou `dnf`, root ou un utilisateur avec `sudo -n` (sans invite de mot de passe) |
| Windows x64 | OpenSSH Server avec SFTP, Windows PowerShell, un compte administrateur                                        |

Le tunnel ne fonctionne que pendant l’exécution de Remote Setup. Il ne publie pas Arkvory vers d’autres ordinateurs. Un `sudo` protégé par mot de passe, les agents SSH, les hôtes de rebond et les serveurs ARM ne sont pas pris en charge.

## Contenu d’une version {#what-a-release-contains}

Les versions sont publiées sur [github.com/ProAnima/Arkvory/releases](https://github.com/ProAnima/Arkvory/releases).

| Fichier                                                                                                                                   | Rôle                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Arkvory-Setup-x64.exe`                                                                                                                   | Programme d’installation graphique pour Windows. Inclut Node.js, PostgreSQL, WinSW et l’environnement d’exécution Microsoft Visual C++              |
| `Arkvory-amd64.deb`, `Arkvory-x86_64.rpm`                                                                                                 | Paquets Linux. Incluent Node.js                                                                                                                     |
| `install.sh`, `install.ps1`                                                                                                               | Programmes d’installation en ligne de commande pour les services natifs ou Docker Compose                                                           |
| `Arkvory-Linux.tar.gz`, `Arkvory-Windows.zip`                                                                                             | Kits d’automatisation : le programme d’installation en ligne de commande et les fichiers de la version, pour installer sans accès à GitHub Releases |
| `Arkvory-CLI-Setup-x64.exe`, `Arkvory-CLI-amd64.deb`, `Arkvory-CLI-x86_64.rpm`                                                            | Paquets clients : le client en ligne de commande `arkvoryctl` et Arkvory Remote Setup                                                               |
| `arkvoryctl.mjs`, `arkvory-remote.mjs`                                                                                                    | Les mêmes outils clients, sous forme de fichiers uniques pour Node.js 24                                                                            |
| `arkvory-runtime.zip`, `arkvory-setup.mjs`, `arkvory-release.json`, `arkvory-release.json.sig`, `release-checksums.json`, `native-*.json` | Fichiers du programme, manifestes, sommes de contrôle et signature. Les programmes d’installation et l’outil de mise à jour les lisent              |

## Prérequis {#requirements}

| Élément                                     | Exigence                                                                                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows, programme d’installation graphique | x64, Windows build 10.0.17763 ou ultérieur (Windows 10 version 1809, Windows Server 2019). Droits d’administrateur                           |
| Windows, script                             | x64, Windows PowerShell. Droits d’administrateur pour les services natifs                                                                    |
| Paquets Linux                               | x64, systemd, glibc 2.28 ou ultérieure, Python 3. Le gestionnaire de paquets installe PostgreSQL 16 ou ultérieur                             |
| Linux, script                               | x64 ou arm64, systemd pour les services natifs, glibc, Bash, curl, Python 3, tar et xz                                                       |
| Docker Compose                              | Docker Engine avec le plugin Compose, ou Docker Desktop en mode conteneurs Linux. Podman avec un fournisseur compose compatible est possible |
| PostgreSQL                                  | Une base de données pour une installation d’Arkvory. Ne connectez jamais deux installations à la même base                                   |
| Stockage des fichiers                       | Un système de fichiers local qui prend en charge les liens physiques. N’utilisez pas de partage réseau pour le stockage des fichiers         |
| Stockage des sauvegardes                    | Un volume distinct, monté avant le démarrage des services. Voir [Sauvegardes](../operate/backups)                                            |

Arkvory ne définit pas de minimum fixe de processeur ni de mémoire. Prévoyez l’espace disque pour vos fichiers, la base de données et le stockage des sauvegardes. Par défaut, Arkvory conserve 1 GiB d’espace libre sur le volume de stockage et accepte jusqu’à 10 TiB de téléversements réservés. Vous pouvez modifier ces deux limites. Voir [Configuration](./configuration).

### Accès réseau pendant l’installation et les mises à jour {#network-access-during-installation-and-updates}

Le programme d’installation graphique fonctionne sans accès à internet. Les autres options téléchargent des fichiers en HTTPS :

| Hôte                                                                    | Utilisé par                                                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `nodejs.org`                                                            | `install.sh` et `install.ps1` téléchargent Node.js 24.21.0 et vérifient son SHA-256                           |
| `api.github.com`, `github.com` et les hôtes de téléchargement de GitHub | Les programmes d’installation par script, et les mises à jour lorsque le hub de mises à jour est inaccessible |
| `hub.proanima.net`                                                      | Vérification et téléchargement des mises à jour. Voir [Mises à jour](./updates)                               |
| Docker Hub                                                              | Compose construit son image à partir de `node:24.21.0-bookworm-slim` et exécute `postgres:18.4`               |

Sans accès à internet, installez et mettez à jour depuis une copie locale d’une version. Voir [Mises à jour](./updates).

## Ports {#ports}

| Port      | Service                                                                    | Exposition par défaut                                                                                                                                        |
| --------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 8080/TCP  | API et console (HTTP, ou HTTPS avec TLS intégré)                           | `127.0.0.1` uniquement. Une installation native peut écouter sur d’autres adresses une fois HTTPS configuré. Compose le publie toujours sur `127.0.0.1:8080` |
| 54329/TCP | PostgreSQL géré du programme d’installation graphique et des paquets Linux | `127.0.0.1` uniquement                                                                                                                                       |
| 5432/TCP  | Conteneur PostgreSQL d’une installation Compose                            | Non publié. Accessible uniquement dans le réseau Compose                                                                                                     |

N’ouvrez aux réseaux clients que le port HTTPS. N’ouvrez jamais le port de la base de données.

## Répertoire d’installation {#installation-directory}

La racine d’installation est `C:\ProgramData\ProAnima\Arkvory` sous Windows et `/opt/proanima-arkvory` sous Linux. Utilisez un répertoire dédié et vide, en dehors des répertoires personnels et des profils utilisateur.

| Chemin dans la racine            | Contenu                                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `installation.json`              | Version installée, mode d’installation, réglage des mises à jour automatiques et épinglage de la version |
| `journal.json`, `operation.lock` | État de la dernière mise à jour, et verrou d’une opération en cours                                      |
| `launcher.mjs`, `manage.mjs`     | Démarrent les services et fournissent les commandes de gestion                                           |
| `releases/<version>/`            | Code du programme de chaque version installée. Les services n’y écrivent pas                             |
| `runtime/`                       | Node.js. Le programme d’installation graphique y place aussi PostgreSQL et WinSW                         |
| `config/`                        | Paramètres, clés et clé de récupération. Voir [Configuration](./configuration)                           |
| `data/`                          | Stockage des fichiers d’une installation native                                                          |
| `database/`                      | Cluster PostgreSQL géré. Sous Windows, aussi ses journaux                                                |
| `logs/`                          | Journaux des services Windows et journal de l’outil de mise à jour Windows                               |
| `service/`                       | Wrappers des services Windows                                                                            |
| `updates/`                       | Demandes de mise à jour émises par la console et état de l’outil de mise à jour                          |

Une installation Compose conserve ses données dans les volumes Docker `proanima-arkvory_storage` (fichiers) et `proanima-arkvory_catalog` (base de données), et non dans `data/`.

Les anciennes versions de `releases/` ne sont pas supprimées automatiquement. Après une mise à jour réussie, vous pouvez supprimer les versions inutilisées. Conservez la version actuelle et la version précédente indiquée dans `journal.json`.

## Clé de récupération {#recovery-key}

Le programme d’installation crée `config/bootstrap-token.txt`. Ce fichier contient la **clé de récupération** : une clé dotée de droits d’administrateur. Seuls root ou le groupe Administrateurs peuvent le lire.

- Utilisez-la une seule fois pour créer le premier compte propriétaire, si le programme d’installation n’en a pas créé. La console la demande au premier démarrage.
- Les outils d’installation la lisent sur le serveur : création du propriétaire, `arkvory configure --backup-vault`, vérification de la sauvegarde après une mise à jour et sauvegarde avant une modification du schéma de la base de données. **Ne supprimez pas ce fichier.**
- Ne la copiez pas sur des clients, des systèmes de CI ou des scripts. Pour le travail quotidien, créez des comptes utilisateur et des clés de service aux droits limités. Voir [Comptes et accès](../use/accounts).

Pour remplacer la clé de récupération, voir [Configuration](./configuration).

## Pour continuer {#next-steps}

1. Installez avec la page de votre plateforme : [Windows](./windows), [Linux](./linux) ou [Docker Compose](./docker).
2. Connectez-vous et publiez un premier fichier. Voir [Démarrage rapide](../guide/quick-start).
3. Configurez [HTTPS](./https) avant que des clients se connectent depuis d’autres ordinateurs.
4. Connectez un stockage des sauvegardes et lancez une première sauvegarde. Voir [Sauvegardes](../operate/backups).
5. Choisissez une [politique de mise à jour](./updates).
