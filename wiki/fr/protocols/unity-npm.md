---
title: 'Paquets Unity et npm'
description: 'Utilisez un dépôt comme registre à portée pour le Unity Package Manager et comme registre npm pour publier et installer des paquets.'
---

# Paquets Unity et npm

Chaque dépôt Arkvory est un registre compatible npm à l’adresse `https://<host>/npm/<repository>/`. Le Unity Package Manager le lit comme registre à portée, et `npm` y publie et y installe. Les studios l’utilisent pour les SDK, les outils et les modules que partagent plusieurs projets Unity, chacun avec sa propre version.

Les archives de paquet sont des artefacts ordinaires : les autorisations du dépôt, les quotas, les sommes de contrôle SHA-256, les sauvegardes et les miroirs s’y appliquent.

## Avant de commencer {#before-you-start}

Vous avez besoin de :

- L’adresse du serveur avec HTTPS (voir [HTTPS](../install/https)).
- Un dépôt, par exemple `games`. Son adresse de registre est `https://arkvory.example/npm/games/`.
- Une clé. Les développeurs utilisent un jeton d’accès personnel avec la portée `read`. Les agents de build qui publient utilisent un jeton personnel avec la portée `read-write` ou une clé de service. Voir [Comptes et clés](../use/accounts).

Arkvory envoie au client l’adresse de chaque archive dans les données du paquet. L’adresse est construite à partir du nom d’hôte avec lequel le client est arrivé. Lorsqu’un proxy inverse termine HTTPS, il doit transmettre l’en-tête `Host` et envoyer `X-Forwarded-Proto: https`, comme dans l’exemple nginx de l’installation. Sinon le client reçoit des adresses d’archives en `http://`.

## Ajouter le registre à un projet Unity {#unity-manifest}

1. Ouvrez `Packages/manifest.json` du projet et ajoutez un registre à portée :

```json
{
  "scopedRegistries": [
    {
      "name": "Arkvory",
      "url": "https://arkvory.example/npm/games/",
      "scopes": ["com.proanima"]
    }
  ],
  "dependencies": {
    "com.proanima.tools": "1.2.0"
  }
}
```

2. Donnez la clé à Unity. Ne la placez pas dans le projet. Créez le fichier `.upmconfig.toml` dans votre dossier utilisateur (`%USERPROFILE%\.upmconfig.toml` sous Windows, `~/.upmconfig.toml` sous macOS et Linux) :

```toml
[npmAuth."https://arkvory.example/npm/games/"]
token = "<your Arkvory key>"
alwaysAuth = true
```

3. Redémarrez Unity. Dans la fenêtre Package Manager, ouvrez **My Registries** pour voir les paquets du registre.

Remarques :

- `scopes` sont des préfixes de noms de paquet. Unity prend dans Arkvory les paquets dont le nom commence par une portée, et tous les autres paquets dans le registre Unity.
- L’adresse dans `.upmconfig.toml` doit être identique à `url` dans le manifeste, barre oblique finale comprise.
- `alwaysAuth = true` est obligatoire. Le registre n’envoie pas de demande d’authentification, Unity doit donc envoyer le jeton à chaque requête.
- Les noms de paquet Unity sont des noms de domaine inversés en minuscules, comme `com.company.package`. Unity ne prend pas en charge les noms avec `@scope/`.

Validez `Packages/manifest.json` avec le projet. Chaque développeur conserve son propre `.upmconfig.toml`.

## Publier un paquet {#publish}

Un paquet est un dossier contenant un `package.json` à la racine. Publiez-le avec `npm`.

1. Dans le dossier du paquet, créez un fichier `.npmrc` :

```ini
registry=https://arkvory.example/npm/games/
//arkvory.example/npm/games/:_authToken=${ARKVORY_TOKEN}
```

2. Définissez la clé dans l’environnement et publiez :

```bash
export ARKVORY_TOKEN="$(cat ~/.arkvory/key)"
npm publish
```

```powershell
$env:ARKVORY_TOKEN = (Get-Content C:\Private\arkvory.key -Raw).Trim()
npm publish
```

La ligne avec `_authToken` doit commencer par l’adresse du registre sans `https:`. Gardez la clé hors de `.npmrc` : npm remplace `${ARKVORY_TOKEN}` depuis l’environnement.

Au lieu de la ligne `registry` dans `.npmrc`, vous pouvez définir le registre dans le `package.json` du paquet :

```json
{
  "name": "com.proanima.tools",
  "version": "1.2.0",
  "publishConfig": { "registry": "https://arkvory.example/npm/games/" }
}
```

Ce que le registre vérifie :

- **Nom et version.** `name` et `version` dans le `package.json` à l’intérieur de l’archive doivent correspondre à ceux publiés. La version suit SemVer 2.0.0, par exemple `1.2.0` ou `2.0.0-beta.1`. Le registre lit les données de la version dans ce fichier, pas dans le JSON que le client envoie.
- **Sommes de contrôle.** La longueur, `shasum` et `integrity` que le client déclare doivent correspondre aux octets. Une incohérence renvoie `422 integrity_mismatch`.
- **L’archive.** Elle doit contenir `<folder>/package.json`, comme `npm pack` la produit. Un second `package.json` dans l’archive est refusé, car npm et le registre pourraient lire des fichiers différents.
- **Une version est immuable.** La même archive publiée à nouveau réussit et ne change rien (`200`). Un autre contenu pour une version existante renvoie `409` avec la raison `version_exists`. Publiez la correction comme version suivante.

`npm publish` lit le paquet depuis le registre avant de le publier ; accordez donc à une clé de publication `content.read` et `artifact.list` en plus de `upload.create`. Voir [Autorisations](#permissions).

La version est disponible dès que `npm publish` se termine. L’archive d’une version est stockée comme artefact `<name>-<version>.tgz` avec l’étiquette `npm`. Pour un nom avec une portée, `@team/util` devient `util-<version>.tgz`.

## Installer des paquets {#install}

Dans Unity, ajoutez la dépendance dans le manifeste ou choisissez le paquet dans la fenêtre Package Manager sous **My Registries**.

Pour npm, définissez le registre dans le `.npmrc` du projet ou de votre utilisateur. Un registre pour une seule portée est le choix habituel, car Arkvory ne transmet pas les requêtes au registre npm public :

```ini
@team:registry=https://arkvory.example/npm/games/
//arkvory.example/npm/games/:_authToken=${ARKVORY_TOKEN}
```

```bash
npm install @team/util
npm view @team/util versions
npm search tools
```

Si vous définissez `registry=` sur Arkvory pour tout le projet, npm y cherche chaque paquet, y compris les paquets publics comme `lodash`, et échoue avec `404`. Utilisez un registre à portée ou un projet qui ne contient que vos propres paquets.

npm vérifie `dist.integrity` pendant l’installation et écrit l’adresse du registre dans `package-lock.json`.

## Versions et dist-tags {#versions-and-tags}

Un dist-tag est un nom déplaçable pour une version. `npm publish` définit `latest` sur la nouvelle version. D’autres tags aident à séparer les canaux de publication.

```bash
npm publish --tag beta
npm dist-tag add com.proanima.tools@1.3.0 latest
npm dist-tag ls com.proanima.tools
npm dist-tag rm com.proanima.tools beta
```

```bash
npm install com.proanima.tools@beta
```

| Règle           | Valeur                                                                              |
| --------------- | ----------------------------------------------------------------------------------- |
| Nom de tag      | Commence par une lettre. Lettres, chiffres, `.`, `_` et `-`. Jusqu’à 64 caractères. |
| Tags interdits  | Un nom qui ressemble à une version (`v1`, `v2.0`), et `x` ou `X`                    |
| `latest`        | Pointe toujours vers une version. Il peut être déplacé, pas supprimé (`409`).       |
| Déplacer un tag | `npm dist-tag add`, ou publier avec `--tag`. La nouvelle version doit exister.      |

Un tag n’est qu’un nom : il ne supprime ni ne masque d’autres versions.

Il n’existe aucun moyen de supprimer une version publiée. Voir [Non pris en charge](#not-supported).

## Recherche {#search}

La liste **My Registries** dans Unity et `npm search` utilisent l’adresse de recherche `/-/v1/search`. La recherche trouve les paquets dont le nom ou la description contient le texte, quelle que soit la casse, et les paquets qui ont le texte comme mot-clé entier. Sans texte, elle liste tous les paquets.

- Elle renvoie une ligne par paquet : la version avec le tag `latest`, ou sinon la plus récente.
- Les résultats sont triés par nom. Il n’y a pas de classement par popularité.
- `size` vaut 20 par défaut et au plus 250. `from` est le décalage.

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_TOKEN" \
  "https://arkvory.example/npm/games/-/v1/search?text=tools&from=0&size=20"
```

Pour lire un paquet directement, demandez son nom. `@scope/name` peut être envoyé comme `@scope%2fname` :

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_TOKEN" https://arkvory.example/npm/games/com.proanima.tools
```

La réponse liste chaque version avec le contenu de son `package.json` (y compris les champs `unity` et `displayName` que Unity lit), les dist-tags et les dates de publication. `dist` contient `tarball`, `shasum` (SHA-1) et `integrity` (SHA-512).

## Noms et limites {#limits}

| Élément                               | Règle                                                                                                                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nom de paquet                         | Lettres minuscules, chiffres, `.`, `_`, `~` et `-`, commençant par une lettre ou un chiffre. Jusqu’à 214 caractères. `@scope/name` est autorisé pour npm.                              |
| Version                               | SemVer 2.0.0, jusqu’à 256 caractères                                                                                                                                                   |
| `package.json` dans l’archive         | Jusqu’à 256 KiB. Les données de toutes les versions arrivent dans une seule réponse, gardez-le donc petit.                                                                             |
| Archive                               | Jusqu’à la taille maximale d’objet de l’installation, `ARKVORY_MAX_OBJECT_BYTES` (environ 10 TiB par défaut). Une archive qui se décompresse plus de 100 fois plus 64 MiB est refusée. |
| Le reste de la requête de publication | Jusqu’à 8 MiB de JSON, imbriqué au plus sur 64 niveaux. L’archive est lue en flux et n’est pas conservée en mémoire.                                                                   |
| Une requête de publication            | Doit se terminer en 30 minutes et ne pas s’interrompre plus de 30 secondes (`ARKVORY_UPLOAD_DEADLINE_MS`, `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`)                                            |
| Téléversements simultanés             | 2 par serveur et 1 par clé par défaut. Une requête en attente abandonne après 20 secondes.                                                                                             |
| Texte de recherche                    | Jusqu’à 256 caractères                                                                                                                                                                 |

`npm publish` est une seule requête, et elle recommence depuis le premier octet après un échec. Pour les paquets de plusieurs gigaoctets, téléversez le fichier avec [`arkvoryctl`](./cli) comme artefact ou [fichier brut](./raw-files). Les grandes ressources binaires qui changent souvent sont mieux placées dans [Git LFS](./git-lfs) ; gardez le code et les ressources stables dans les paquets.

Les limites du serveur sont dans [Variables d’environnement](../reference/environment#transfers-and-bandwidth).

## Autorisations {#permissions}

Les jetons personnels et les clés de fichier obtiennent un accès en lecture ou en écriture au dépôt. Les clés de service obtiennent des actions précises.

| Opération                                             | Actions de clé de service | Jeton personnel ou clé de fichier               |
| ----------------------------------------------------- | ------------------------- | ----------------------------------------------- |
| Installer : lire un paquet et télécharger une archive | `content.read`            | Accès en lecture                                |
| Rechercher, lister les dist-tags                      | `artifact.list`           | Accès en lecture                                |
| Publier, ajouter et supprimer des dist-tags           | `upload.create`           | Accès en écriture, portée du jeton `read-write` |

Un développeur qui ne fait qu’installer des paquets a besoin d’un jeton avec la portée `read`. Un agent de build qui publie a besoin de `upload.create`, `content.read` et `artifact.list`. Personne ne peut supprimer une version publiée.

## Passerelles de lecture et miroirs {#read-gateways-and-mirrors}

- Une [passerelle de lecture](../operate/read-gateways) sert l’installation et la recherche, car ce sont des requêtes `GET`. Une publication reçoit `405`.
- Un [miroir](../operate/mirrors) détient les versions et les tags de sa source. L’installation et la recherche fonctionnent. La publication est refusée avec `409` et la raison `mirror_read_only`. Les adresses d’archives dans les données d’un miroir pointent vers le miroir.

Pour utiliser un miroir dans Unity, placez l’adresse du miroir dans `url` et sa clé dans `.upmconfig.toml`.

## Non pris en charge {#not-supported}

- Supprimer une version (`npm unpublish`). Les projets épinglent des versions, et une suppression casserait leurs builds. Publiez une version corrigée et déplacez plutôt le tag.
- `npm deprecate`, `npm login`, `npm owner`, `npm access` et d’autres commandes de gestion. Les requêtes qui modifient des données sur d’autres chemins répondent `405` avec « This registry supports publish, install and dist-tags ». Créez un jeton dans la console et placez-le dans `.npmrc` au lieu de `npm login`.
- La liste de tous les paquets à `/-/all`, et `npm audit`.
- Un proxy vers les registres publics. Arkvory stocke vos propres paquets. Les paquets de npmjs.com ou du registre Unity sont récupérés depuis ceux-ci.
- Le classement des résultats de recherche.
- Une section pour les paquets dans la console. Les archives apparaissent dans [[ui:catalog]] comme artefacts avec l’étiquette `npm`.

## Dépannage {#troubleshooting}

Les erreurs ont la forme `{"error": "...", "code": "...", "request_id": "..."}`. `npm` affiche `error`. Donnez le `request_id` à votre administrateur pour retrouver la requête dans le journal du serveur.

| Symptôme                                                  | Cause                                                                                | Que faire                                                                                                                                                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401` dans Unity ou npm                                   | Le client n’a pas envoyé la clé, ou la clé est erronée, expirée ou révoquée          | Dans Unity, vérifiez que l’adresse dans `.upmconfig.toml` est égale à `url` dans le manifeste et que `alwaysAuth = true`. Dans npm, vérifiez que la ligne `_authToken` commence par le même hôte et le même chemin que `registry`. |
| `403` lors de la publication                              | Le jeton a la portée `read`, ou la clé n’a pas `upload.create`                       | Utilisez une clé avec accès en écriture                                                                                                                                                                                            |
| `404` pour un paquet                                      | Il n’existe pas un tel paquet dans ce dépôt, ou la clé ne voit pas le dépôt          | Vérifiez le dépôt dans l’adresse et le nom. Pour un paquet Unity, vérifiez que son nom commence par une portée de `scopes`.                                                                                                        |
| `404` pour un paquet public                               | `registry=` pointe vers Arkvory pour tous les paquets                                | Utilisez `@scope:registry=`                                                                                                                                                                                                        |
| `409` avec `version_exists`                               | La version existe avec un autre contenu                                              | Publiez une nouvelle version                                                                                                                                                                                                       |
| `409` avec `state_conflict`                               | Vous avez tenté de supprimer `latest`                                                | Déplacez plutôt `latest` vers une autre version                                                                                                                                                                                    |
| `409` avec `mirror_read_only`                             | Le dépôt est un miroir                                                               | Publiez vers le serveur principal                                                                                                                                                                                                  |
| `422` avec `integrity_mismatch`                           | Les octets diffèrent du `shasum` ou de l’`integrity` déclaré                         | Reconditionnez et publiez à nouveau. Vérifiez qu’aucun proxy ne modifie le corps.                                                                                                                                                  |
| `400` « package.json names another package or version »   | Le `package.json` à l’intérieur de l’archive diffère du nom ou de la version publiés | Exécutez `npm publish` depuis un build propre du paquet                                                                                                                                                                            |
| `400` « Only publishing a new version is supported »      | La commande a envoyé un paquet modifié, par exemple `npm deprecate`                  | Ces commandes ne sont pas prises en charge                                                                                                                                                                                         |
| `405`                                                     | La commande n’est pas prise en charge par ce registre                                | Voir [Non pris en charge](#not-supported)                                                                                                                                                                                          |
| `507`                                                     | Le quota du dépôt ou la capacité de l’installation est atteint                       | Libérez de l’espace ou demandez un quota plus élevé                                                                                                                                                                                |
| `503`                                                     | Trop de téléversements en même temps                                                 | Attendez et réessayez                                                                                                                                                                                                              |
| Les archives se téléchargent depuis `http://` et échouent | Le proxy n’envoie pas `X-Forwarded-Proto: https`                                     | Corrigez le proxy comme décrit dans [Avant de commencer](#before-you-start)                                                                                                                                                        |

## Pages associées {#related-pages}

- [Clients et protocoles](./index)
- [Git LFS](./git-lfs)
- [Comptes et clés](../use/accounts)
- [HTTPS](../install/https)
- [Miroirs](../operate/mirrors)
