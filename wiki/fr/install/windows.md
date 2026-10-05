---
title: Windows
---

# Windows

Il existe trois façons d’exécuter Arkvory sous Windows :

- **Le programme d’installation graphique** `Arkvory-Setup-x64.exe`. Recommandé. Il installe des services Windows et une base de données PostgreSQL dédiée. Il ne nécessite aucun accès à internet.
- **Le script PowerShell** `install.ps1`. Il installe les mêmes services Windows, mais utilise votre serveur PostgreSQL existant.
- **Docker Desktop** avec `install.ps1 -Mode compose`. Pour l’évaluation uniquement. Voir [Docker Compose](./docker).

## Prérequis {#requirements}

- Windows x64, build 10.0.17763 ou ultérieur (Windows 10 version 1809, Windows Server 2019 ou ultérieur).
- Un compte du groupe Administrateurs.
- Un volume NTFS local pour les données. Les partages réseau ne sont pas pris en charge pour le stockage des fichiers.
- Un répertoire d’installation en dehors des profils utilisateur et de `AppData`. Le compte de service doit pouvoir lire chaque répertoire parent.

## Installer avec le programme d’installation graphique {#install-with-the-graphical-installer}

1. Téléchargez `Arkvory-Setup-x64.exe` depuis [GitHub Releases](https://github.com/ProAnima/Arkvory/releases).
2. Exécutez le fichier et confirmez l’invite du contrôle de compte d’utilisateur (UAC).
3. Sélectionnez l’anglais ou le russe, les deux langues du programme d’installation, et acceptez la licence.
4. Saisissez le compte propriétaire. Le nom compte de 3 à 64 caractères : lettres latines, chiffres, point, tiret ou tiret bas. Le mot de passe compte de 12 à 128 caractères.
5. Patientez pendant que le programme prépare la base de données, les services et le compte propriétaire.
6. Sur la dernière page, laissez cochée l’option **Open Arkvory and finish onboarding** et cliquez sur **Finish**. La console s’ouvre à l’adresse `http://127.0.0.1:8080/console/#onboarding`.

Le programme d’installation crée aussi deux raccourcis dans le menu Démarrer : **Arkvory** (la console) et **API and CLI** (la page d’aide de la console).

Si le programme d’installation signale que l’environnement d’exécution Microsoft nécessite un redémarrage, redémarrez Windows et relancez-le. Les données Arkvory existantes sont conservées.

Les mises à jour automatiques sont désactivées après l’installation. Pour les activer, voir [Mises à jour](./updates).

### Installation silencieuse {#silent-installation}

Pour un déploiement automatisé, placez le compte propriétaire dans un fichier JSON. Protégez le fichier afin que seuls SYSTEM et les administrateurs puissent le lire.

```json
{ "name": "admin", "password": "<au moins 12 caractères>" }
```

```powershell
.\Arkvory-Setup-x64.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /OWNERFILE="C:\secure\owner.json"
```

Le programme d’installation supprime le fichier du propriétaire après avoir créé le compte. Ne transmettez jamais un mot de passe comme argument de commande. Sans `/OWNERFILE`, créez le propriétaire plus tard dans la console avec la clé de récupération. Le programme se termine avec un code non nul si la configuration n’a pas abouti. N’exécutez pas le programme d’installation pendant qu’une mise à jour est en cours.

## Ce que crée le programme d’installation graphique {#what-the-graphical-installer-creates}

| Élément                            | Emplacement ou valeur                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| Fichiers du programme              | `C:\Program Files\ProAnima\Arkvory`                                                                 |
| Données, configuration et journaux | `C:\ProgramData\ProAnima\Arkvory` (la racine d’installation)                                        |
| Base de données                    | PostgreSQL 18.4 dans `database\` de la racine, sur `127.0.0.1:54329`                                |
| Console                            | `http://127.0.0.1:8080/console/`                                                                    |
| Clé de récupération                | `config\bootstrap-token.txt` dans la racine                                                         |
| Tâche de mise à jour               | `ProAnimaArkvoryUpdate` dans le Planificateur de tâches. S’exécute chaque minute en tant que SYSTEM |

### Services {#services}

| Nom du service    | Nom complet               | Compte                        | Type de démarrage           |
| ----------------- | ------------------------- | ----------------------------- | --------------------------- |
| `Arkvoryapi`      | ProAnima Arkvory api      | `NT AUTHORITY\LocalService`   | Automatique (début différé) |
| `Arkvoryworker`   | ProAnima Arkvory worker   | `NT AUTHORITY\LocalService`   | Automatique (début différé) |
| `Arkvorybackup`   | ProAnima Arkvory backup   | `NT AUTHORITY\LocalService`   | Automatique (début différé) |
| `Arkvorydatabase` | ProAnima Arkvory database | `NT AUTHORITY\NetworkService` | Automatique                 |

Les services s’exécutent sans utilisateur connecté. L’API, le processus de traitement et l’agent de sauvegarde partagent le compte LocalService. La base de données s’exécute sous NetworkService : le compte de l’API ne peut donc pas lire les fichiers de la base.

La racine accorde le contrôle total à SYSTEM et aux administrateurs uniquement. LocalService peut lire la racine et ne peut modifier que `data\`, `logs\` et la boîte de réception des mises à jour. La clé de récupération et les autres fichiers d’identifiants du programme d’installation ne sont lisibles que par SYSTEM et les administrateurs.

## Installer avec PowerShell et un PostgreSQL existant {#install-with-powershell-and-an-existing-postgresql}

Utilisez cette méthode si votre organisation exploite déjà PostgreSQL. Elle ne crée ni service de base de données géré, ni entrée dans **Applications**.

1. Demandez à votre administrateur de base de données une base vide et un rôle qui en est propriétaire. Arkvory exécute ses migrations avec ce rôle.
2. Téléchargez `install.ps1` depuis la version publiée et relisez-le.
3. Ouvrez Windows PowerShell **en tant qu’administrateur** et exécutez :

```powershell
.\install.ps1 -AutomaticUpdates
```

Le script demande l’URL de connexion PostgreSQL. La saisie est masquée. Il télécharge ensuite Node.js 24.21.0 depuis `nodejs.org`, vérifie son SHA-256 et installe la dernière version stable.

Au lieu de l’invite, vous pouvez transmettre un fichier JSON protégé :

```json
{ "ARKVORY_DATABASE_URL": "postgresql://arkvory:<password>@db.example:5432/arkvory" }
```

```powershell
.\install.ps1 -Config C:\secure\arkvory.json
```

Si PowerShell bloque les scripts, exécutez `powershell -ExecutionPolicy Bypass -File .\install.ps1`. Cela ne modifie la stratégie que pour ce processus.

| Paramètre                    | Signification                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `-Root <path>`               | Racine d’installation. Valeur par défaut : `C:\ProgramData\ProAnima\Arkvory`   |
| `-Version <x.y.z>`           | Installe cette version stable au lieu de la dernière                           |
| `-Mode windows` ou `compose` | Services Windows (par défaut) ou [Docker Compose](./docker)                    |
| `-Engine docker` ou `podman` | Moteur de conteneurs pour Compose                                              |
| `-Config <file>`             | Fichier JSON avec les paramètres `ARKVORY_*`, dont l’URL de la base de données |
| `-Artifact <directory>`      | Installe depuis un `Arkvory-Windows.zip` extrait au lieu de GitHub             |
| `-AutomaticUpdates`          | Active les mises à jour automatiques                                           |
| `-Pin`                       | Épingle la version installée                                                   |

Indiquez `-Root`, `-Config` et `-Artifact` sous forme de chemins absolus, par exemple `-Artifact $PWD.Path`.

Le script ne crée pas de compte propriétaire. Ouvrez `http://127.0.0.1:8080/console/` sur le serveur, sélectionnez **[[ui:welcomeOwner]]** et saisissez la clé de récupération qui se trouve dans `config\bootstrap-token.txt`.

## Gérer les services {#manage-the-services}

```powershell
Get-Service Arkvoryapi, Arkvoryworker, Arkvorybackup, Arkvorydatabase
Restart-Service Arkvoryapi, Arkvoryworker
sc.exe qfailure Arkvoryapi
```

La commande de gestion nécessite un PowerShell avec élévation de privilèges, et toujours l’option `--root` :

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
# Programme d’installation graphique
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' status --root $root
# Installation par script
& "$root\runtime\node-v24.21.0-win-x64\node.exe" "$root\manage.mjs" status --root $root
```

Exécutez `arkvory.ps1 help` pour voir toutes les commandes. Elles sont décrites dans [Configuration](./configuration) et [Mises à jour](./updates).

## Récupération après une défaillance {#recovery-after-a-failure}

- Lorsqu’un processus de service s’arrête sans qu’on le lui ait demandé, Windows le redémarre après 10 secondes. Le compteur d’échecs est remis à zéro au bout d’une heure.
- Un processus dont le thread principal reste bloqué pendant 60 secondes se termine de lui-même, puis Windows le redémarre. Voir [Autoréparation](../operate/self-healing).
- L’échec du seul contrôle de disponibilité ne redémarre pas un service (par exemple pendant que le serveur termine ses requêtes en cours avant de s’arrêter). En revanche, lorsque la base de données ne répond plus, l’API et le processus de traitement ne peuvent plus confirmer qu’ils sont propriétaires du stockage : au bout d’environ 8 secondes, ils se terminent d’eux-mêmes, et Windows les redémarre toutes les 10 secondes jusqu’au retour de la base de données.
- Un service que vous arrêtez vous-même reste arrêté jusqu’à ce que vous le démarriez ou que Windows redémarre.

Relancer le programme d’installation graphique rétablit le type de démarrage et les actions de récupération des services.

## Journaux {#logs}

| Emplacement dans la racine | Contenu                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `logs\`                    | Sortie de l’API, du processus de traitement et de l’agent de sauvegarde. Rotation des fichiers à 20 MiB ; 5 anciens fichiers sont conservés |
| `logs\updater.log`         | Sortie de la tâche de mise à jour, avec la même rotation                                                                                    |
| `database\`                | Journaux du service de base de données (`arkvory-database*.log`)                                                                            |
| `bootstrap.log`            | Sortie de l’étape de configuration du programme d’installation graphique                                                                    |

Le programme d’installation écrit aussi son propre journal dans le dossier temporaire de l’utilisateur qui l’a exécuté. L’API et le processus de traitement écrivent un enregistrement JSON par ligne. Voir [Supervision](../operate/monitoring).

## Désinstallation {#uninstall}

Ouvrez **Paramètres > Applications**, sélectionnez **ProAnima Arkvory** et cliquez sur **Désinstaller**. Le programme de désinstallation :

1. Supprime la tâche `ProAnimaArkvoryUpdate`.
2. Arrête et supprime `Arkvorybackup`, `Arkvoryworker`, `Arkvoryapi` et `Arkvorydatabase`.
3. Supprime les fichiers du programme.

Il **conserve** volontairement `C:\ProgramData\ProAnima\Arkvory` : la base de données, tous les fichiers, la configuration et la clé de récupération. Il ne touche jamais au stockage des sauvegardes. Si vous exécutez plus tard le programme d’installation de la même version ou d’une version plus récente, il reprend avec les données conservées. Pour supprimer les données, faites d’abord une sauvegarde, puis supprimez vous-même le dossier.

Une installation par script n’a pas de programme de désinstallation. Pour supprimer ses services, exécutez ceci dans un PowerShell avec élévation de privilèges :

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
Unregister-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Confirm:$false
foreach ($role in 'backup', 'worker', 'api') {
  $exe = "$root\service\arkvory-$role.exe"
  if ((Get-Service "Arkvory$role").Status -ne 'Stopped') { & $exe stopwait }
  & $exe uninstall
}
```

## Docker Desktop {#docker-desktop}

Docker Desktop est l’application d’un utilisateur donné. Ses conteneurs ne s’exécutent qu’après la connexion de cet utilisateur et le démarrage de Docker Desktop. Après un redémarrage de l’ordinateur, Arkvory n’est donc pas disponible tant que ces deux conditions ne sont pas remplies. Si vous installez avec Docker Desktop, activez **Settings > General > Start Docker Desktop when you sign in**. Le programme d’installation et la commande `status` signalent ce réglage lorsqu’il est désactivé. Pour un serveur qui doit démarrer sans connexion, utilisez les services natifs décrits sur cette page.

## Dépannage {#troubleshooting}

| Problème                                                                      | Que faire                                                                                                                                                                       |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Le programme d’installation indique que la configuration n’a pas abouti       | Lisez `bootstrap.log`, le journal du programme d’installation et les journaux de la base de données. Ne supprimez pas le dossier de la base de données                          |
| `database\bootstrap-started` existe, mais `database\initialized` n’existe pas | La création de la base de données a été interrompue. Ne supprimez pas le cluster et ne rejouez pas le SQL à la main. Corrigez la cause et exécutez la commande `finish-install` |
| `Run installer as Administrator`                                              | Démarrez PowerShell avec **Exécuter en tant qu’administrateur**                                                                                                                 |
| `Use a dedicated directory`                                                   | La racine contient déjà des fichiers. Utilisez un répertoire vide. Gérez une installation existante avec ses commandes                                                          |
| `Node.js runtime is incomplete after extraction`                              | Vérifiez la quarantaine de votre antivirus                                                                                                                                      |
| `Another installation owns this service`                                      | Des services d’une installation située dans une autre racine existent. Supprimez-les d’abord                                                                                    |

Pour terminer une installation interrompue sans supprimer de données :

```powershell
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' finish-install --root C:\ProgramData\ProAnima\Arkvory
```

D’autres conseils figurent dans [Dépannage](../operate/troubleshooting).
