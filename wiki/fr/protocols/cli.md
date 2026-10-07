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

| Option                     | Valeur par défaut | Signification                                                                                           |
| -------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------- |
| `--profile NAME`           | profil actif      | Profil pour cette seule commande                                                                        |
| `--repository NAME`        | celui du profil   | Dépôt pour cette seule commande                                                                         |
| `--json`                   | désactivé         | Un résultat JSON compact sur stdout ; erreurs en JSON sur stderr                                        |
| `--lang en` ou `--lang ru` | selon `LANG`      | Langue de l’aide et des messages                                                                        |
| `--timeout MS`             | 60000             | Limite pour les requêtes de gestion (1 à 3600000)                                                       |
| `--attempt-timeout MS`     | 120000            | Limite d’une tentative de transfert (1 à 1800000)                                                       |
| `--retries N`              | 20                | Nouvelles tentatives réseau pour une opération (0 à 100) ; `0` les désactive                            |
| `--verbose`                | désactivé         | Une ligne stderr par requête HTTP : méthode, chemin, statut, durée, ID de requête. Ni en-têtes ni clés. |
| `--help`, `--version`      |                   | Aide ; version du client en JSON                                                                        |
| `--`                       |                   | Termine les options, pour les noms de fichiers qui commencent par `-`                                   |

Chaque option ne peut apparaître qu’une fois. Les options inconnues sont refusées.

## Commandes {#commands}

### Découverte et catalogue {#discovery-and-catalog}

| Commande                                                                   | Résultat                                                  |
| -------------------------------------------------------------------------- | --------------------------------------------------------- |
| `doctor`                                                                   | Connexion, fonctionnalités et autorisations               |
| `repositories [--after CURSOR]`                                            | Dépôts visibles avec la clé                               |
| `operations [--after CURSOR]`                                              | Opérations d’API disponibles dans le dépôt                |
| `list [--after CURSOR]`                                                    | Artefacts du dépôt                                        |
| `search [--query TEXT] [--label TAG] [--collection NAME] [--after CURSOR]` | Recherche par nom et par texte de métadonnées             |
| `search --metadata-key KEY --metadata-value VALUE`                         | Correspondance exacte des métadonnées (indiquez les deux) |
| `inspect ID`                                                               | Métadonnées d’un artefact                                 |
| `storage usage` / `storage policy`                                         | Utilisation du dépôt et politique de stockage             |

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

Le client ne réessaie que les échecs réseau et les codes HTTP 408, 429, 502, 503 et 504, dans la limite de `--retries`.

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

## Pages associées {#related-pages}

- [Clients et protocoles](./index)
- [Transferts](../use/transfers) et [Fichiers par chemin](../use/files)
- [SDK TypeScript](./sdk)
- [Erreurs](../api/errors)
