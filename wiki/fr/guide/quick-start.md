---
title: Démarrage rapide
---

# Démarrage rapide

Cette page montre le chemin le plus court pour passer de rien à un serveur Arkvory en marche avec un fichier téléversé. Choisissez une méthode d’installation à l’étape 1, puis suivez les autres étapes dans l’ordre.

Téléchargez les programmes d’installation uniquement depuis la [page des versions](https://github.com/ProAnima/Arkvory/releases) du projet, et comparez leur SHA-256 avec les fichiers de sommes de contrôle de la version.

## Étape 1. Installer le serveur {#step-1-install-the-server}

### Windows {#windows}

Il vous faut Windows 10 version 1809 ou ultérieure, ou Windows Server 2019 ou ultérieur, en x64, ainsi que des droits d’administrateur. Aucun accès à internet n’est nécessaire.

1. Exécutez `Arkvory-Setup-x64.exe` et confirmez l’invite d’administrateur.
2. Choisissez la langue et acceptez la licence.
3. Sur la page du propriétaire, saisissez un nom (3 à 64 lettres latines, chiffres, `.`, `-` ou `_`) et un mot de passe d’au moins 12 caractères. C’est le premier compte administrateur.
4. Terminez l’assistant. Il peut ouvrir la console pour vous.

Le programme d’installation place le programme dans `C:\Program Files\ProAnima\Arkvory` et les données dans `C:\ProgramData\ProAnima\Arkvory`. Il crée quatre services Windows : `Arkvorydatabase`, `Arkvoryapi`, `Arkvoryworker` et `Arkvorybackup`. Ils s’exécutent sans utilisateur connecté. Voir [Windows](../install/windows).

### Linux {#linux}

Utilisez le paquet correspondant à votre distribution. Le gestionnaire de paquets installe aussi le serveur PostgreSQL (les versions 16 à 19 sont prises en charge).

```bash
# Debian, Ubuntu
sudo apt install ./Arkvory-amd64.deb

# Fedora, distributions compatibles RHEL
sudo dnf install ./Arkvory-x86_64.rpm
```

La racine d’installation est `/opt/proanima-arkvory`. Le paquet crée les services systemd `arkvory-database`, `arkvory-api`, `arkvory-worker` et `arkvory-backup`. Vérifiez-les :

```bash
systemctl status arkvory-api arkvory-worker arkvory-backup
```

Voir [Linux](../install/linux).

### Docker Compose {#docker-compose}

Il vous faut Docker avec Compose. Sous Windows, utilisez Docker Desktop avec des conteneurs Linux. Le script télécharge Node.js et la version publiée : il a donc besoin d’un accès à internet.

Téléchargez `install.sh` ou `install.ps1` depuis la version publiée et lisez-le avant de l’exécuter.

```bash
sudo bash ./install.sh --mode compose
```

Sous Windows, exécutez PowerShell avec le même utilisateur que Docker Desktop, sans droits d’administrateur :

```powershell
.\install.ps1 -Mode compose
```

La racine d’installation est `/opt/proanima-arkvory` sous Linux et `C:\ProgramData\ProAnima\Arkvory` sous Windows. La pile contient l’API, le processus de traitement, l’agent de sauvegarde et PostgreSQL 18. Voir [Docker](../install/docker).

## Étape 2. Ouvrir la console {#step-2-open-the-console}

Ouvrez `http://127.0.0.1:8080/console/` dans un navigateur sur le serveur.

Au départ, le serveur n’écoute que sur l’adresse locale `127.0.0.1`. Pour ouvrir la console depuis votre propre ordinateur, redirigez le port par SSH :

```bash
ssh -L 8080:127.0.0.1:8080 admin@arkvory.example
```

Ouvrez ensuite `http://127.0.0.1:8080/console/` sur votre ordinateur. Pour donner accès à d’autres machines, configurez d’abord [HTTPS](../install/https).

## Étape 3. Créer le propriétaire {#step-3-create-the-owner}

Ignorez cette étape sous Windows : le programme d’installation a déjà créé le propriétaire.

Sous Linux et Docker, le premier compte se crée avec la **clé de récupération**. Le programme d’installation l’écrit dans `config/bootstrap-token.txt`, dans la racine d’installation. Seul un administrateur peut lire ce fichier.

```bash
sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
```

```powershell
Get-Content C:\ProgramData\ProAnima\Arkvory\config\bootstrap-token.txt
```

1. Dans la console, ouvrez [[ui:navStart]] et développez [[ui:welcomeOwner]].
2. Collez la clé dans [[ui:welcomeRecovery]].
3. Saisissez le nom du propriétaire et un mot de passe d’au moins 12 caractères, puis sélectionnez [[ui:welcomeCreate]].
4. Connectez-vous avec le nouveau nom et le mot de passe dans la carte [[ui:connection]].

Gardez la clé de récupération secrète et ne supprimez pas le fichier. Les outils d’installation et de mise à jour l’utilisent. Voir [Sécurité](../operate/security).

Le propriétaire est un administrateur et peut écrire dans le dépôt `releases`. Pour créer un autre dépôt, ouvrez [[ui:administration]], développez [[ui:manageGrants]], donnez au groupe `arkvory-owners` l’accès [[ui:write]] à un nouveau nom, par exemple `builds`, puis sélectionnez [[ui:saveGrant]]. Un nom de dépôt se compose de lettres latines minuscules, de chiffres, de `-` et de `_`, et compte 64 caractères au plus.

## Étape 4. Créer une clé pour vos outils {#step-4-create-a-key-for-your-tools}

Les scripts et le client en ligne de commande ont besoin d’une clé. Pour un premier essai, utilisez un jeton d’accès personnel :

1. Développez [[ui:personalAccessTokens]] dans la carte [[ui:connection]].
2. Renseignez le champ [[ui:tokenName]], réglez [[ui:tokenScope]] sur [[ui:tokenScopeReadWrite]] et sélectionnez [[ui:generateToken]].
3. Copiez le jeton. Il n’est affiché qu’une seule fois.
4. Enregistrez-le dans un fichier que vous seul pouvez lire, par exemple `~/.arkvory/key`.

Pour le CI/CD et les agents de déploiement, créez plutôt un compte de service avec sa propre clé. Voir [Comptes et accès](../use/accounts).

## Étape 5. Téléverser et télécharger avec curl {#step-5-upload-and-download-with-curl}

Un chemin de fichier dans un dépôt fonctionne comme un fichier sur un serveur web. `PUT` stocke une nouvelle version du chemin, et `GET` renvoie la version actuelle.

```bash
export ARKVORY_KEY="$(cat ~/.arkvory/key)"

# Téléversement
curl -T ./Setup.exe -H "Authorization: Bearer $ARKVORY_KEY" \
  http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe

# Téléchargement
curl -fL -H "Authorization: Bearer $ARKVORY_KEY" -o Setup-copy.exe \
  http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe
```

Le téléversement renvoie du JSON de ce type :

```json
{
  "path": "builds/game/1.0/Setup.exe",
  "revision": 1,
  "created": true,
  "artifact": { "id": "…", "size": "1048576", "sha256": "…" }
}
```

Si vous téléversez de nouveau les mêmes octets, la réponse est `200` avec `"created": false`, et aucune nouvelle version n’est créée. Un nouveau fichier reçoit le statut `201`.

Dans PowerShell :

```powershell
$headers = @{ Authorization = "Bearer $env:ARKVORY_KEY" }
$url = 'http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe'
Invoke-WebRequest -Method Put -InFile .\Setup.exe -Headers $headers -Uri $url
Invoke-WebRequest -Headers $headers -Uri $url -OutFile .\Setup-copy.exe
```

Une requête `PUT` doit se terminer en moins de 30 minutes. Pour de très gros fichiers ou des réseaux lents, utilisez le client en ligne de commande : il téléverse par parties et reprend après un échec. Voir [Fichiers bruts](../protocols/raw-files).

## Étape 6. Utiliser le client en ligne de commande {#step-6-use-the-command-line-client}

Installez `arkvoryctl` sur votre propre ordinateur : `Arkvory-CLI-Setup-x64.exe` sous Windows, `Arkvory-CLI-amd64.deb` ou `Arkvory-CLI-x86_64.rpm` sous Linux. Sur une machine de CI dotée de Node.js 24, `arkvoryctl.mjs` fonctionne aussi.

```bash
arkvoryctl profile add local --server http://127.0.0.1:8080 --token-file ~/.arkvory/key
arkvoryctl doctor
arkvoryctl put ./Setup.exe builds/game/1.0/Setup.exe
arkvoryctl get builds/game/1.0/Setup.exe ./Setup-copy.exe
```

Le profil utilise le dépôt `releases`, sauf si vous ajoutez `--repository`. Si un transfert s’interrompt, relancez la même commande : il reprend là où il s’est arrêté et vérifie le SHA-256 à la fin. Le client n’accepte HTTP simple que pour l’ordinateur local ; utilisez HTTPS pour un serveur distant. Voir [Client en ligne de commande](../protocols/cli).

## Pour continuer {#next-steps}

- [Concepts](./concepts) : dépôts, artefacts, étapes et clés.
- [HTTPS](../install/https) : ouvrir le serveur à d’autres machines en toute sécurité.
- [Sauvegardes](../operate/backups) : connecter un stockage des sauvegardes avant de stocker des données importantes.
- [Paquets](../use/packages) et [Promotion](../use/promotion) : des builds versionnés pour le déploiement.
- [La console web](./console) : visite de toutes les sections.
