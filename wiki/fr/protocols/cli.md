---
title: Ligne de commande (arkvoryctl)
---

# Ligne de commande (arkvoryctl)

`arkvoryctl` est le client distant d’Arkvory pour les personnes et le CI/CD. Il téléverse et télécharge par parties, reprend après une interruption et vérifie le SHA-256. Il fonctionne avec les autorisations de la clé que vous lui donnez.

## Installation {#install}

| Système                                                    | Paquet                      | Comment l’installer                                                                                                                                                 |
| ---------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows 10/11, Windows Server 2019+ (x64)                  | `Arkvory-CLI-Setup-x64.exe` | Exécutez-le. Il s’installe pour l’utilisateur courant, sans droits d’administrateur, et ajoute `arkvoryctl` au `PATH` de l’utilisateur. Ouvrez un nouveau terminal. |
| Debian, Ubuntu (x64)                                       | `Arkvory-CLI-amd64.deb`     | `sudo apt install ./Arkvory-CLI-amd64.deb`                                                                                                                          |
| Fedora, distributions compatibles RHEL (x64)               | `Arkvory-CLI-x86_64.rpm`    | `sudo dnf install ./Arkvory-CLI-x86_64.rpm`                                                                                                                         |
| Tout système avec Node.js 24 (par exemple un runner de CI) | `arkvoryctl.mjs`            | `node ./arkvoryctl.mjs --help`                                                                                                                                      |

Les paquets natifs incluent leur propre Node.js. Le fichier unique `arkvoryctl.mjs` n’a aucune dépendance npm. Prenez les fichiers dans une version fiable de `ProAnima/Arkvory` et comparez leur SHA-256 avec `release-checksums.json`. Les paquets ARM64 ne sont pas encore disponibles. Pour mettre à jour, installez une version stable plus récente. La désinstallation conserve vos profils, vos fichiers de clés et vos points de contrôle.

## Se connecter à un serveur {#connect-to-a-server}

1. Obtenez une clé : un jeton d’accès personnel depuis la console, ou une clé de service auprès de votre administrateur. Voir [Comptes et clés](../use/accounts).
2. Enregistrez la clé dans un fichier privé, en dehors de tout dépôt. Sous Linux, utilisez le mode `0600`. Sous Windows, n’autorisez l’accès qu’à votre compte.
3. Ajoutez un profil et vérifiez la connexion :

```bash
arkvoryctl profile add production --server https://arkvory.example --token-file "$HOME/.secrets/arkvory.key" --repository releases
arkvoryctl doctor
arkvoryctl repositories
```

```powershell
arkvoryctl profile add production --server https://arkvory.example --token-file C:\Private\arkvory.key --repository releases
arkvoryctl doctor
```

`doctor` affiche le serveur, le dépôt, les fonctionnalités et les autorisations de la clé. La clé n’est jamais un argument de commande.

## Profils et environnement {#profiles-and-environment}

Les profils sont stockés dans `profiles.json`, dans `~/.config/arkvory` (sous Windows, `.config\arkvory` dans votre dossier utilisateur). Un profil stocke l’URL du serveur, le dépôt par défaut et le **chemin** du fichier de clé, pas la clé.

| Commande                                                                | Effet                                                                                                 |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `profile add NAME --server URL [--token-file PATH] [--repository NAME]` | Ajoute un profil. Le premier profil devient le profil par défaut. Le dépôt par défaut est `releases`. |
| `profile list`                                                          | Affiche tous les profils et le profil actif                                                           |
| `profile use NAME`                                                      | Définit un profil comme profil par défaut                                                             |
| `profile remove NAME`                                                   | Supprime un profil                                                                                    |

| Variable             | Signification                                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_TOKEN`      | La clé elle-même. Prioritaire sur tout fichier.                                                                                                             |
| `ARKVORY_TOKEN_FILE` | Chemin d’un fichier de clé. Prioritaire sur le fichier du profil.                                                                                           |
| `ARKVORY_BASE_URL`   | URL du serveur. Lorsqu’elle est définie, le fichier de clé du profil n’est **pas** utilisé : fournissez la clé par `ARKVORY_TOKEN` ou `ARKVORY_TOKEN_FILE`. |
| `ARKVORY_CLI_HOME`   | Autre dossier pour `profiles.json`                                                                                                                          |

L’URL du serveur doit utiliser HTTPS. HTTP simple n’est autorisé que pour `localhost`, `127.0.0.1` et `[::1]`. La vérification TLS ne peut pas être désactivée.

## Options globales {#global-options}

| Option                     | Valeur par défaut | Signification                                                                                                                                              |
| -------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--profile NAME`           | profil actif      | Profil pour cette seule commande                                                                                                                           |
| `--repository NAME`        | celui du profil   | Dépôt pour cette seule commande                                                                                                                            |
| `--json`                   | désactivé         | Un résultat JSON compact sur stdout ; erreurs en JSON sur stderr                                                                                           |
| `--lang en` ou `--lang ru` | selon `LANG`      | Langue de l’aide et des messages                                                                                                                           |
| `--timeout MS`             | 60000             | Limite pour les requêtes de gestion (1 à 3600000)                                                                                                          |
| `--attempt-timeout MS`     | 120000            | Limite d’une tentative de transfert (1 à 1800000)                                                                                                          |
| `--retries N`              | 20                | Nouvelles tentatives réseau pour une opération (0 à 100) ; `0` les désactive                                                                               |
| `--wait-limit MS`          | aucune            | Durée totale pendant laquelle une opération peut attendre un serveur occupé. Sans cette option, le client attend aussi longtemps que le serveur le demande |
| `--class CLASS`            |                   | Classe de file des téléchargements : `release`, `bulk` ou `background`. Elle ne peut que baisser votre classe                                              |
| `--not-before T`           |                   | Ne pas commencer un téléchargement avant T : RFC 3339 ou `HH:MM`, la prochaine fois que l’horloge l’indique                                                |
| `--not-after T`            |                   | Abandonner avec le code 4 si la file commencerait le téléchargement après T                                                                                |
| `--verbose`                | désactivé         | Une ligne stderr par requête HTTP : méthode, chemin, statut, durée, ID de requête. Ni en-têtes ni clés.                                                    |
| `--transfer MODE`          | `auto`            | Extensions de transfert des [modules client](#client-modules) : `auto`, `strict` ou `core` (aucune)                                                        |
| `--help`, `--version`      |                   | Aide ; version du client en JSON                                                                                                                           |
| `--`                       |                   | Termine les options, pour les noms de fichiers qui commencent par `-`                                                                                      |

Chaque option ne peut apparaître qu’une fois. Les options inconnues sont refusées.

## Commandes {#commands}

### Découverte et catalogue {#discovery-and-catalog}

| Commande                                                                                     | Résultat                                                         |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `doctor`                                                                                     | Connexion, fonctionnalités et autorisations                      |
| `repositories [--after CURSOR]`                                                              | Dépôts visibles avec la clé                                      |
| `operations [--after CURSOR]`                                                                | Opérations d’API disponibles dans le dépôt                       |
| `list [--after CURSOR]`                                                                      | Artefacts du dépôt                                               |
| `search [--query TEXT] [--label TAG] [--collection NAME] [--after CURSOR]`                   | Recherche par nom et par texte de métadonnées                    |
| `search --metadata-key KEY --metadata-value VALUE`                                           | Correspondance exacte des métadonnées (indiquez les deux)        |
| `search --all [--query TEXT] [--repositories R1,R2] [--label L1,L2] [--stage S] [--limit N]` | Tous les dépôts que la clé peut lister, les plus récents d’abord |
| `inspect ID`                                                                                 | Métadonnées d’un artefact                                        |
| `storage usage` / `storage policy`                                                           | Utilisation du dépôt et politique de stockage                    |

Les pages renvoient `next`. Transmettez-le avec `--after` pour lire la page suivante.

### Transferts {#transfers}

| Commande                                                                       | Résultat                                                                                                                             |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `upload FILE [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]`   | Téléversement avec reprise de n’importe quel fichier                                                                                 |
| `download ID OUTPUT`                                                           | Téléchargement avec reprise, vérifié par SHA-256                                                                                     |
| `put FILE PATH [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]` | Téléverse le fichier et en fait la révision suivante d’un chemin. Si le chemin contient déjà les mêmes octets, rien n’est téléversé. |
| `get PATH OUTPUT`                                                              | Télécharge la révision actuelle d’un chemin, avec vérification et reprise                                                            |
| `link ID [--ttl SECONDS]`                                                      | Une URL de téléchargement sans clé, valable de 60 secondes à 24 heures (1 heure par défaut)                                          |
| `uploads status ID` / `uploads cancel ID`                                      | État d’une session de téléversement ; annulation de celle-ci (annuler n’est pas suspendre)                                           |

`METADATA.json` contient `labels` et `metadata` (une table de chaînes). Il est prioritaire sur `--label`.

```bash
arkvoryctl put "./Build/Game Setup.exe" builds/game/1.4/GameSetup.exe
arkvoryctl get builds/game/1.4/GameSetup.exe ./GameSetup.exe
arkvoryctl link 00000000-0000-4000-8000-000000000001 --ttl 900
```

Un lien de téléchargement est un secret. Il ne peut pas être révoqué avant son expiration.

### Arborescences de répertoires {#directory-trees}

| Commande                                                                            | Résultat                                                                                     |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `tree push DIR [--name NAME.zip] [--label TAG] [--file METADATA.json] [--compress]` | Publie le dossier sous forme d’un seul artefact ZIP, avec reprise                            |
| `tree pull ID DIR`                                                                  | Fait du dossier l’arborescence : archive entière, ou seulement les fichiers qui diffèrent    |
| `tree verify ID DIR`                                                                | Liste les fichiers manquants, divergents et en trop ; code de sortie 5 si l’un d’eux diffère |
| `tree repair ID DIR`                                                                | Réécrit les fichiers manquants et divergents ; conserve les fichiers en trop                 |

Voir [Arborescences de répertoires](../use/trees).

### Paquets et promotion {#packages-and-promotion}

| Commande                                                                                                              | Résultat                                                                 |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `packages list [--group G] [--name N] [--after CURSOR]`                                                               | Paquets UPack                                                            |
| `packages publish FILE [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]`                                | Téléverse une archive UPack et l’enregistre                              |
| `packages register ID`                                                                                                | Enregistre un UPack déjà téléversé                                       |
| `packages resolve NAME [--group G] [--exact V] [--range R] [--stage S] [--prerelease] [--order promoted]`             | Sélectionne une version (`--exact` et `--range` s’excluent mutuellement) |
| `packages download NAME OUTPUT [mêmes filtres]`                                                                       | Sélectionne une version, puis la télécharge avec vérification            |
| `promote ID --to REPOSITORY [--move] [--stage S1,S2] [--comment TEXT]`                                                | Publie l’artefact dans un autre dépôt sans renvoyer les octets           |
| `stages list ID` / `stages add ID STAGE [--comment TEXT]` / `stages remove ID STAGE` / `stages artifacts [--stage S]` | Étapes des artefacts                                                     |
| `promotions history ID` / `promotions journal [--after CURSOR]`                                                       | Historique des promotions                                                |

```bash
arkvoryctl packages publish ./build.upack --label test --state ./job-state/build.json --json
arkvoryctl promote 00000000-0000-4000-8000-000000000001 --to prod --stage release
arkvoryctl packages download app ./app.upack --range ^1.4 --stage release
```

Utilisez `--exact` pour une version exacte ; `--version` affiche la version du client. Voir [Paquets](../use/packages) et [Promotion](../use/promotion).

### Annotations et pièces jointes {#annotations-and-attachments}

`annotations get ID` et `annotations set ID --revision N --file ANNOTATIONS.json` lisent et remplacent les étiquettes, les métadonnées et les collections. `attachments get ID`, `attachments history ID` et `attachments set ID --revision N --file ATTACHMENTS.json` font de même pour les fichiers liés à un build. Lisez d’abord, puis envoyez l’état complet et nouveau avec la révision que vous avez lue. Une modification concurrente renvoie un conflit (code de sortie 6).

### Sauvegardes {#backups}

| Commande                                                          | Résultat                                                                                                                |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `backup status`                                                   | Stockage des sauvegardes, agent, plan, dernier point, avertissements ; code de sortie 9 en cas d’avertissement critique |
| `backup run`                                                      | Met en file d’attente une tâche de sauvegarde                                                                           |
| `backup jobs [--after CURSOR]` / `backup points [--after CURSOR]` | Tâches et points de restauration, du plus récent au plus ancien                                                         |
| `backup verify POINT_ID`                                          | Met en file d’attente une vérification complète d’un point                                                              |
| `backup pin POINT_ID [--off]`                                     | Conserve un point au-delà de la rétention, ou le libère                                                                 |

Ces commandes nécessitent la clé de fichier du propriétaire de l’installation (bootstrap) ou une session d’administrateur de compte. Les jetons personnels et les clés de service reçoivent 403 (code de sortie 3). L’agent de sauvegarde du serveur fait le travail. Exemple de supervision : `arkvoryctl backup status --json || alert`. Voir [Sauvegardes](../operate/backups).

## Reprendre des transferts interrompus {#resume-interrupted-transfers}

Après Ctrl+C ou une panne réseau, relancez **la même commande avec les mêmes options**.

- `upload`, `put` et `packages publish` conservent un point de contrôle à côté du fichier source : `<source>.arkvory-upload.json`, ou le fichier indiqué par `--state`. Il enregistre la clé d’idempotence avant la première requête : une réponse perdue ne crée donc jamais une seconde copie.
- Pour publier les mêmes octets comme **nouvel** artefact, utilisez un nouveau fichier `--state`.
- `download` et `get` conservent `<output>.arkvory-part` et `<output>.arkvory-download.json` à côté de la sortie. Le fichier final n’apparaît qu’après la vérification du SHA-256. Un fichier de sortie existant n’est jamais écrasé.
- En CI, créez le dossier d’état avant le job et conservez-le, avec le fichier source, entre les nouvelles tentatives.

Conservez les points de contrôle sur un disque local qui prend en charge les liens physiques (NTFS, ext4, XFS), pas sur FAT, exFAT ni sur des partages réseau. Après un plantage brutal, un fichier `.lock` subsiste. Vérifiez que le processus dont le PID figure dans ce fichier est arrêté, puis supprimez uniquement le fichier `.lock`.

## Exemple de CI {#ci-example}

```bash
# La clé provient du magasin de secrets de la CI. Ne l’affichez jamais.
export ARKVORY_BASE_URL=https://arkvory.example
export ARKVORY_TOKEN_FILE=/run/secrets/arkvory-key
mkdir -p job-state
node ./arkvoryctl.mjs packages publish ./build.upack --label test --state ./job-state/upload.json --json
```

Si l’enregistrement échoue après le téléversement, l’erreur JSON contient `stage: "register"` et l’`artifactId`. Répétez la même commande. Enregistrer de nouveau le même artefact est sans danger.

### Systèmes de CI {#ci-systems}

Tous les systèmes ci-dessous font la même chose : installer un `arkvoryctl.mjs` épinglé, prendre la clé dans le coffre de secrets du système et lancer une commande. Épinglez la version et le SHA-256 pour qu'un téléchargement modifié fasse échouer la tâche. Utilisez une clé de service limitée au dépôt et aux actions dont la tâche a besoin ([Comptes et clés](../use/accounts)). L'agent a besoin de Node.js 24.

```yaml
# GitHub Actions: .github/workflows/publish.yml
name: publish
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    env:
      ARKVORY_BASE_URL: https://arkvory.example
      ARKVORY_TOKEN: ${{ secrets.ARKVORY_KEY }}
      ARKVORY_CLI_VERSION: '0.3.0'
      ARKVORY_CLI_SHA256: 555af7e66e25447ba17ea0d3dc676f6d04b4b8adc47818d8c8bb548085752504
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: Install arkvoryctl
        run: |
          curl -fsSL -o arkvoryctl.mjs "https://github.com/ProAnima/Arkvory/releases/download/v${ARKVORY_CLI_VERSION}/arkvoryctl.mjs"
          echo "${ARKVORY_CLI_SHA256}  arkvoryctl.mjs" | sha256sum -c -
      - name: Publish the build
        run: node ./arkvoryctl.mjs put ./Build/Game.zip "builds/game/${GITHUB_REF_NAME}/Game.zip" --json
```

```yaml
# GitLab CI: .gitlab-ci.yml (ARKVORY_TOKEN is a masked CI/CD variable)
publish:
  image: node:24
  variables:
    ARKVORY_BASE_URL: https://arkvory.example
    ARKVORY_CLI_VERSION: '0.3.0'
    ARKVORY_CLI_SHA256: 555af7e66e25447ba17ea0d3dc676f6d04b4b8adc47818d8c8bb548085752504
  script:
    - curl -fsSL -o arkvoryctl.mjs "https://github.com/ProAnima/Arkvory/releases/download/v${ARKVORY_CLI_VERSION}/arkvoryctl.mjs"
    - echo "${ARKVORY_CLI_SHA256}  arkvoryctl.mjs" | sha256sum -c -
    - node ./arkvoryctl.mjs put ./Build/Game.zip "builds/game/${CI_COMMIT_TAG}/Game.zip" --json
```

```groovy
// Jenkins: Jenkinsfile. The agent has Node.js 24 and a checked arkvoryctl.mjs, installed as above.
pipeline {
  agent any
  environment {
    ARKVORY_BASE_URL = 'https://arkvory.example'
    ARKVORY_TOKEN = credentials('arkvory-key')
  }
  stages {
    stage('Publish') {
      steps {
        sh 'node ./arkvoryctl.mjs put ./Build/Game.zip "builds/game/${BUILD_NUMBER}/Game.zip" --json'
      }
    }
  }
}
```

Tout autre système, comme TeamCity ou Buildkite, fonctionne de la même façon : définissez `ARKVORY_BASE_URL` et `ARKVORY_TOKEN` depuis son coffre de secrets et lancez la commande. Décidez selon le [code de sortie](#exit-codes).

## Agents d’IA (MCP) {#mcp}

`arkvoryctl mcp` permet à un client d’agent d’IA qui parle le Model Context Protocol, comme Claude Code, de travailler avec Arkvory. Le client lance la commande et dialogue avec elle par stdin et stdout ; aucun port réseau n’est ouvert. Les appels utilisent la clé du profil ou de l’environnement, et le serveur vérifie ses permissions comme pour toute autre commande.

```bash
claude mcp add arkvory -- arkvoryctl mcp --profile production --root ~/work
```

- **Lecture seule par défaut.** Les outils listent les dépôts, recherchent dans tous, lisent les artefacts, les paquets, les fichiers par chemin, le flux des changements et l’état de l’installation, et téléchargent un artefact. Les outils que la clé ne peut pas utiliser ne sont pas proposés. Avec `--write`, l’agent peut aussi téléverser, publier, promouvoir et étiqueter, mais jamais supprimer : voir [Agents d’IA](../guide/agents).
- **Fichiers.** Un téléchargement n’écrit que sous `--root` (par défaut, le répertoire courant). Le fichier n’apparaît qu’après vérification de sa taille et de son SHA-256 ; un fichier existant n’est remplacé que si l’agent le demande.
- **Sortie.** Un résultat fait au plus `--max-output-bytes` (64 Kio par défaut, jusqu’à 1 Mio) et 100 éléments ; pour la suite, renvoyez `next` dans `after`. La clé et les liens de téléchargement n’apparaissent jamais dans les résultats.
- **Clé.** Donnez à l’agent sa propre clé de service, qui ne peut lire que les dépôts dont il a besoin. Ne collez jamais une clé dans la conversation.
- **Données.** Les noms, étiquettes et métadonnées des résultats sont écrits par d’autres personnes. L’agent doit les traiter comme des données, pas comme des instructions.
- Le client doit prendre en charge MCP 2025-06-18 ou plus récent.

## Modules client {#client-modules}

Un module client est un paquet signé de ProAnimaStudio qui étend `arkvoryctl` lui-même, par exemple avec un moyen plus rapide de déplacer les octets (une extension de transfert). Le client gratuit ne contient aucun module de ce type ; sans module, chaque commande fonctionne comme décrit sur cette page.

| Commande                                                  | Résultat                                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `module install FILE [--yes] [--allow-stale-revocations]` | Vérifie le paquet et l’affiche avec ses conditions ; l’installe avec `--yes`       |
| `module list`                                             | Modules installés, là où ils sont activés, et l’état de la liste de révocation     |
| `module enable ID [--profile NAME]`                       | Active le module pour tous les profils, ou pour un seul                            |
| `module disable ID [--profile NAME]`                      | Le désactive partout, ou pour un profil                                            |
| `module remove ID`                                        | Supprime le module                                                                 |
| `module revocations FILE`                                 | Enregistre une liste de révocation signée, pour les machines sans accès à internet |

- **Où.** Les modules sont installés pour votre utilisateur dans le dossier `modules` du dossier du CLI (`ARKVORY_CLI_HOME`, par défaut `~/.config/arkvory`). Un nouveau module est désactivé jusqu’à ce que vous l’activiez.
- **Vérifications.** Seuls les paquets signés avec la clé de modules de ProAnimaStudio et construits pour le client sont acceptés. Avant qu’une commande utilise un module, `arkvoryctl` vérifie de nouveau la signature et chaque fichier, ainsi qu’aucun autre utilisateur ne puisse modifier les fichiers (sous Linux et macOS : ils vous appartiennent, ne sont pas modifiables par les autres, sans liens ; sous Windows : sans liens ni jonctions, et le propriétaire et les règles d’accès ne permettent de les modifier qu’à vous et aux administrateurs, sinon `module_access`). Une version révoquée n’est jamais chargée. Un module qui échoue à une vérification est signalé sur stderr (`client module ID VERSION not loaded (code)`) et écarté ; la commande continue sans lui.
- **Révocations.** `module install` exige une liste de révocation à jour. Un paquet peut en apporter une plus récente ; sinon, enregistrez-en une avec `module revocations`. `--allow-stale-revocations` installe quand même ; le résultat le signale.
- **Code.** Le code d’un module ne peut charger que ses propres fichiers et les modules intégrés de Node. Seules les commandes qui déplacent du contenu chargent des modules : `upload`, `download`, `put`, `get`, `packages publish`, `packages download` et `tree`.
- **Extensions de transfert.** L’extension d’un module n’est utilisée que lorsque le serveur propose la même dans `transfer` de `GET /api/v1/capabilities`. Le client vérifie lui-même le résultat : la taille et le SHA-256 de chaque téléchargement et la somme de contrôle publiée de chaque téléversement. Avec `--transfer auto`, le client revient à son propre transfert lorsque l’extension refuse ou échoue ; `--transfer strict` échoue à la place (`transfer_unavailable`, code de sortie 4) ; `--transfer core` ne charge aucun module. `--verbose` indique quelle voie a prise chaque transfert.

## Sortie {#output}

- Les résultats sont du JSON sur stdout. Sans `--json`, le JSON est indenté. Les commandes de sauvegarde affichent des lignes lisibles, sauf si vous ajoutez `--json`.
- La progression n’apparaît que sur un stderr interactif.
- Sans `--json`, une erreur tient en une ligne stderr avec le code du serveur, la raison, le message, la marche à suivre et l’ID de requête. Avec `--json`, stderr contient `{"error": {...}}` avec `code`, `exitCode`, `status`, `serverCode`, `reason`, `requestId` et `retryAfterSeconds`. Décidez d’après `exitCode` lorsqu’un code est inconnu.

## Codes de sortie {#exit-codes}

| Code | Signification                                                                           |
| ---- | --------------------------------------------------------------------------------------- |
| 0    | Succès                                                                                  |
| 2    | Arguments ou configuration incorrects                                                   |
| 3    | Pas de clé, ou accès refusé (401, 403)                                                  |
| 4    | Erreur HTTP ou réseau, délai dépassé, serveur occupé, ressource introuvable             |
| 5    | Échec d’intégrité (SHA-256 différent, 422 `integrity_mismatch`)                         |
| 6    | Conflit : révision, état, verrou, fichier existant, point de contrôle modifié (409)     |
| 7    | Erreur de fichier local ou réponse du serveur invalide                                  |
| 8    | Limite de capacité du serveur : quota, disque, file d’attente (507 `capacity_exceeded`) |
| 9    | `backup status` : un avertissement critique de sauvegarde est actif                     |
| 130  | Interrompu                                                                              |

Le client ne réessaie que les échecs réseau et les codes HTTP 408, 429, 502, 503 et 504, dans la limite de `--retries`. Un serveur occupé (503 `busy`, 429 `rate_limited`) n’est pas un échec : le client attend aussi longtemps que le serveur le demande dans `Retry-After`, affiche la durée sur stderr et ne décompte pas ces attentes de `--retries`. `--wait-limit` plafonne l’attente totale.

## Dépannage {#troubleshooting}

| Message                                           | Cause et correction                                                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `credential_required` (code de sortie 3)          | Aucune clé trouvée. Vérifiez `--token-file` et `ARKVORY_TOKEN_FILE`, ou fournissez la clé lorsque `ARKVORY_BASE_URL` est utilisée.                           |
| `forbidden` (code de sortie 3)                    | La clé n’a pas l’autorisation requise. Exécutez `doctor` pour voir les autorisations.                                                                        |
| `checkpoint_mismatch` (code de sortie 6)          | Le fichier, le serveur, le dépôt ou les options diffèrent du point de contrôle enregistré. Reprenez les options d’origine, ou utilisez un nouveau `--state`. |
| `state_locked` (code de sortie 6)                 | Un autre processus utilise le point de contrôle, ou un ancien `.lock` subsiste après un plantage.                                                            |
| `destination_exists` (code de sortie 6)           | Le fichier de sortie existe. Choisissez un autre nom.                                                                                                        |
| `revision_mismatch` avec `put` (code de sortie 6) | Quelqu’un a modifié le chemin entre-temps. Consultez l’historique du chemin, puis décidez.                                                                   |
| code de sortie 8                                  | Le quota est atteint ou le disque est plein. Contactez l’administrateur.                                                                                     |
| `checksum_mismatch` (code de sortie 5)            | Un fichier d’une arborescence ne correspondait pas au fichier publié ; le fichier du dossier est resté tel quel. Relancez la commande.                       |
| `path_outside_root`, `unsafe_name`                | Une archive ou une table des matières désigne un chemin hors du dossier, ou un nom que Windows ne peut pas accepter. Rien n’a été écrit.                     |
| `stale_revocations` (code de sortie 6)            | Pas de liste de révocation à jour pour `module install`. Enregistrez-en une avec `module revocations FILE`.                                                  |

## Pages associées {#related-pages}

- [Clients et protocoles](./index)
- [Transferts](../use/transfers), [Arborescences de répertoires](../use/trees) et [Fichiers par chemin](../use/files)
- [SDK TypeScript](./sdk)
- [Erreurs](../api/errors)
