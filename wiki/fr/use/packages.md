---
title: 'Paquets UPack'
description: 'Publiez des paquets UPack versionnés, listez-les et filtrez-les, et téléchargez une version par numéro exact, plage, dernière version ou étape.'
---

# Paquets UPack

Un paquet UPack est une archive ZIP avec un nom et une version SemVer. Arkvory enregistre chaque version une fois et ne la modifie jamais. Une tâche de déploiement demande « app, version `^1.4`, étape `release` » et obtient exactement un fichier.

## Ce qu’est un paquet {#what-it-is}

Un UPack est un fichier ZIP contenant un fichier `upack.json` à sa racine. Le manifeste nomme le paquet :

```json
{
  "group": "acme/game",
  "name": "game-client",
  "version": "1.4.2"
}
```

| Champ     | Règle                                                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| `name`    | Obligatoire. 1 à 128 lettres, chiffres, `.`, `_` ou `-`                                                              |
| `version` | Obligatoire. SemVer : `1.4.2`, `1.5.0-rc.1`, `2.0.0+build.7`. Au plus 128 caractères                                 |
| `group`   | Facultatif. Segments de lettres, chiffres, `.`, `_` ou `-`, séparés par `/`. Au plus 128 caractères. Vide par défaut |

Les autres champs restent tels que vous les avez écrits et reviennent dans la liste des paquets. Le manifeste fait au plus 64 Kio. L’archive ne doit pas contenir de chemins absolus, de `..`, de liens symboliques, d’entrées chiffrées ni de noms en double, et elle compte au plus 100 000 entrées. Arkvory stocke l’archive octet par octet et ne la décompresse pas.

L’identité d’un paquet est son groupe, son nom et sa version, comparés sans tenir compte de la casse. Au sein d’un dépôt, une identité appartient définitivement à une seule archive. Enregistrer une archive différente sous une identité existante est refusé avec `409 version_exists`. Enregistrer de nouveau la même archive est sans danger et ne change rien. Publiez un correctif comme nouvelle version.

## Publier un paquet {#publish}

La publication est un téléversement suivi d’un enregistrement. L’enregistrement lit `upack.json` et consigne l’identité. Vous avez besoin des actions `package.publish` et `artifact.read`, en plus des actions de téléversement. Voir [Autorisations](./accounts#permissions).

### Dans la console {#publish-console}

1. Téléversez l’archive dans [[ui:upload]]. Voir [Transferts](./transfers).
2. Ouvrez l’artefact dans [[ui:catalog]] avec [[ui:open]].
3. Dans [[ui:metadata]], sélectionnez [[ui:register]]. La console affiche le nom et la version enregistrés.

Le paquet apparaît maintenant dans [[ui:packages]].

### Avec arkvoryctl {#publish-cli}

```bash
arkvoryctl packages publish ./build.upack --label test --state ./job-state/build.json --json
arkvoryctl packages register 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`packages publish` téléverse l’archive avec reprise et l’enregistre. Si l’enregistrement échoue après le téléversement, l’erreur contient l’`artifactId` et l’étape `register`. Relancez la même commande : le téléversement n’est pas répété, et enregistrer deux fois est sans danger. `packages register ID` enregistre un artefact déjà téléversé. Voir [Ligne de commande](../protocols/cli#packages-and-promotion).

### Avec l’API HTTP et le SDK {#publish-api}

Téléversez l’archive comme dans [Transferts](./transfers#upload-http), puis enregistrez-la :

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/package" \
  -H "Authorization: Bearer $ARKVORY_KEY"
```

```typescript
const entry = await releases.packages.register(uploaded.id);
console.log(entry.group, entry.name, entry.version);
```

L’opération est `registerPackage`. Une archive corrompue, un `upack.json` manquant ou une version incorrecte donne `400 invalid_input`.

## Lister et filtrer {#list}

Dans la console, ouvrez [[ui:packages]]. Saisissez un [[ui:packageGroup]] ou un [[ui:packageName]] : les deux doivent correspondre exactement, sans tenir compte de la casse. Choisissez une colonne dans [[ui:sortBy]], un ordre dans [[ui:direction]] ([[ui:ascending]] ou [[ui:descending]]) et un regroupement dans [[ui:groupBy]] ([[ui:packageGroup]], [[ui:packageName]] ou [[ui:noGrouping]]), puis sélectionnez [[ui:apply]]. [[ui:clearFilters]] réinitialise le formulaire. Le tableau affiche le groupe, le nom, la version et les étapes de chaque version. [[ui:open]] affiche l’artefact. [[ui:previousPage]] et [[ui:nextPage]] changent de page.

```bash
arkvoryctl packages list --group acme/game --name game-client
arkvoryctl packages list --after <next from the previous answer>
```

Avec l’API, `listPackages` prend `group`, `name`, `sort` (`group`, `name` ou `version`), `direction` (`asc` ou `desc`), `groupBy` (`none`, `group` ou `package`), `after` et `limit` (1 à 100, 50 par défaut). La réponse contient `items` (groupe, nom, version, `artifactId` et le manifeste complet), `groups` et `next`. Un curseur appartient aux filtres dont il provient. Utilisez-le uniquement avec les mêmes filtres.

```typescript
const page = await releases.packages.list({
  name: 'game-client',
  sort: 'version',
  direction: 'desc',
});
```

Le listage nécessite `package.read`. Pour rechercher plutôt par étiquettes ou métadonnées, voir [Fichiers par chemin](./files#labels).

## Versions et plages {#versions}

Arkvory compare les versions selon la préséance SemVer. `1.10.0` est plus récente que `1.9.0`. Une version avec une partie de préversion, telle que `1.5.0-rc.1`, est plus ancienne que `1.5.0`.

Une sélection prend le `name` d’un paquet et, éventuellement, ces filtres :

| Filtre         | Signification                                                                             |
| -------------- | ----------------------------------------------------------------------------------------- |
| `group`        | Le groupe. Vide par défaut : un paquet qui a un groupe n’est trouvé que si vous le donnez |
| version exacte | Une version. La casse est ignorée                                                         |
| plage          | Une plage SemVer                                                                          |
| `stage`        | Uniquement les versions qui portent cette étape (voir [Étapes et promotion](./promotion)) |
| prerelease     | Inclure les préversions. Désactivé par défaut                                             |
| ordre          | `version` (par défaut) ou `promoted`                                                      |

Les plages peuvent s’écrire `1.2.3`, `^1.2`, `~1.2.3`, `1.x`, `>=1.0.0 <2.0.0`, `1.0.0 - 1.4.0` et `^1 || ^3`. Une plage compte au plus 256 caractères. Une version exacte et une plage ne peuvent pas être combinées.

Sans version exacte ni plage, la sélection renvoie la version stable la plus élevée, c’est-à-dire la plus récente. Les préversions ne sont choisies qu’avec le filtre prerelease activé, ou lorsque la version exacte ou la plage elle-même nomme une préversion du même `major.minor.patch`. `order promoted` retient la version qui a été promue en dernier, pas la plus élevée, et nécessite une étape. Si rien ne correspond, le serveur répond `404 not_found`.

## Télécharger un paquet {#download}

Résolvez d’abord si vous voulez voir ce que vous obtenez, ou téléchargez directement.

```bash
arkvoryctl packages resolve game-client --group acme/game --range ^1.4 --stage release
arkvoryctl packages download game-client ./game-client.upack --group acme/game --range ^1.4 --stage release
arkvoryctl packages download game-client ./game-client.upack --exact 1.4.2 --group acme/game
arkvoryctl packages download game-client ./game-client.upack --group acme/game
```

Les options sont `--group`, `--exact`, `--range`, `--stage`, `--prerelease` et `--order promoted`. Utilisez `--exact` pour une version exacte, car `--version` affiche la version du client. `resolve` affiche le groupe, le nom, la version, l’`artifactId`, `sha256`, `size`, `publishedAt`, `stagedAt` et les étapes. `download` résout, puis télécharge cet artefact avec reprise et une vérification SHA-256, comme dans [Transferts](./transfers#download-cli). Le client a besoin de `package.read`, `artifact.read` et `content.read`.

Avec HTTP, il y a deux opérations. `resolvePackage` nécessite `package.read` et renvoie les mêmes informations que `resolve`. `downloadPackageContent` envoie les octets de la version choisie et ne nécessite que `content.read`. Il ajoute les en-têtes `X-Arkvory-Artifact-Id` et `X-Arkvory-Package-Version`.

```bash
curl -fL -G -H "Authorization: Bearer $ARKVORY_KEY" -o game-client.upack \
  --data-urlencode "name=game-client" --data-urlencode "group=acme/game" \
  --data-urlencode "range=^1.4" --data-urlencode "stage=release" \
  "$ARKVORY/api/v1/repositories/prod/packages/content"
```

L’adresse par nom est résolue à chaque requête. Si vous reprenez un téléchargement avec une plage, le fichier peut avoir changé entre les deux appels. Téléchargez plutôt l’`artifactId` renvoyé par `resolve`, ou envoyez l’`ETag` dans `If-Range`.

```typescript
const found = await prod.packages.resolve({
  name: 'game-client',
  group: 'acme/game',
  range: '^1.4',
  stage: 'release',
});
const stream = await prod.artifacts.downloadVerified(found.artifactId);
```

Un agent de déploiement qui ne doit que récupérer des builds reçoit une clé de service avec `content.read` seul pour l’adresse HTTP, ou le préréglage de lecture pour `arkvoryctl`. Voir [Comptes de service et clés pour la CI](./accounts#service-accounts).

## Étiquettes, métadonnées et pièces jointes {#labels}

Une version de paquet est un artefact ordinaire, donc tout ce qui est décrit dans [Fichiers par chemin](./files#labels) s’y applique : des étiquettes telles que `test`, `staging` et `release`, des métadonnées textuelles telles que `git.commit`, des collections, et des pièces jointes comme un SBOM ou une signature. Définissez les premières étiquettes au moment du téléversement avec `--label test`. Les étiquettes ne changent rien à l’archive. Ce sont du texte libre, pas un statut contrôlé. Pour une approbation sur laquelle un déploiement peut s’appuyer, utilisez une étape. Voir [Étapes et promotion](./promotion).

## Conserver les anciennes versions {#retention}

Les paquets enregistrés sont ce que compte la politique de rétention d’un dépôt. Par défaut, lorsqu’elle est activée, elle conserve les 10 derniers builds de chaque paquet et de chaque canal. Un canal est l’étiquette `test`, `staging` ou `release`. Une version portant une étape, une étiquette protégée, un chemin de fichier ou un lien de pièce jointe n’est jamais supprimée par la rétention. La rétention est désactivée tant qu’un administrateur ne l’active pas et n’accepte pas la suppression. Voir [Stockage et rétention](../operate/storage).

## Erreurs {#errors}

| Réponse                                | Signification                                                                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400 invalid_input` à l’enregistrement | Ce n’est pas un ZIP UPack valide, pas d’`upack.json` à la racine, ou un nom ou une version incorrects                                                                |
| `409 version_exists`                   | L’identité appartient déjà à une autre archive. Publiez une nouvelle version. Promouvoir vers un dépôt qui a la version avec d’autres octets échoue de la même façon |
| `404 not_found` à la résolution        | Rien ne correspond aux filtres. Vérifiez le groupe, la plage et l’étape                                                                                              |
| `403 permission_missing`               | La clé n’a pas `package.read`, `package.publish` ou `content.read`                                                                                                   |

## Pages associées {#related-pages}

- [Transferts](./transfers)
- [Étapes et promotion](./promotion)
- [Ligne de commande (arkvoryctl)](../protocols/cli)
- Référence de l’API : [Paquets](../api/reference/packages), [Étapes et promotion](../api/reference/promotion)
