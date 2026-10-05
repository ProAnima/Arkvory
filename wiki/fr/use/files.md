---
title: 'Fichiers par chemin'
description: 'Conservez un fichier à un chemin avec un historique complet, restaurez des révisions antérieures et ajoutez des étiquettes, des métadonnées, des collections et des pièces jointes.'
---

# Fichiers par chemin

Un fichier par chemin est un nom dans un dépôt, tel que `builds/game/1.4/GameSetup.exe`, qui pointe vers un fichier stocké. Quand vous placez un nouveau contenu au même chemin, le chemin pointe vers le nouveau fichier. L’ancien reste, et vous pouvez y revenir. Utilisez un chemin quand des personnes et des scripts ont besoin d’une adresse stable pour « le Setup.exe actuel ».

## Ce qu’est un chemin {#what-it-is}

Chaque fichier stocké est un **artefact** immuable doté d’un identifiant et d’une somme SHA-256. Un chemin est un pointeur vers un artefact. Chaque changement du pointeur est une **révision**, numérotée à partir de 1. Les révisions ne sont jamais supprimées ni modifiées.

Un chemin compte 1 à 1024 caractères. Il est composé de segments séparés par `/`. Un segment n’est pas vide, n’est pas `.` ni `..` et ne contient aucun caractère de contrôle. Un chemin ne peut pas contenir `\` ni `:`. La casse compte.

Un chemin et un paquet sont deux vues des mêmes artefacts : une archive UPack peut aussi avoir un chemin. Voir [Paquets UPack](./packages).

## Placer un fichier à un chemin {#put}

Vous avez besoin des actions `upload.create`, `upload.write` et `upload.complete`, ainsi que `asset.read`, `asset.write` et `artifact.read`. En termes de groupes, vous avez besoin de l’accès en écriture. Voir [Autorisations](./accounts#permissions).

### Avec arkvoryctl {#put-cli}

```bash
arkvoryctl put "./Build/Game Setup.exe" builds/game/1.4/GameSetup.exe
arkvoryctl put ./config.json config/settings.json --label test
arkvoryctl get builds/game/1.4/GameSetup.exe ./GameSetup.exe
```

`put` téléverse le fichier par parties, avec un point de contrôle à côté du fichier source, et en fait la révision suivante du chemin. Il affiche le `path`, la `revision`, l’`id` de l’artefact et `created`. Si le chemin contient déjà les mêmes octets, `put` ne téléverse rien et affiche `created` à `false` : une étape de build répétée ne coûte rien. Si quelqu’un a modifié le chemin pendant votre téléversement, `put` s’arrête avec `revision_mismatch` (code de sortie 6) et n’écrase pas son travail. Consultez l’historique et décidez. Si un téléversement s’arrête, relancez la même commande. Voir [Transferts](./transfers#resume).

`get` télécharge la révision actuelle avec reprise et une vérification SHA-256. Il n’existe aucune commande pour lister les chemins ni pour lire l’historique. Utilisez la console ou l’API pour cela.

### Avec une seule requête HTTP {#put-http}

Un `PUT` brut stocke les octets au chemin en une seule requête, comme le fait `curl -T` :

```bash
curl -T ./GameSetup.exe -H "Authorization: Bearer $ARKVORY_KEY" \
  "$ARKVORY/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe"
```

La réponse contient `path`, `revision`, `created` et l’`artifact` avec son `id`, sa `size` et son `sha256`. Une nouvelle révision répond `201`. Les mêmes octets de nouveau répondent `200` avec `created` à false. Deux en-têtes sont facultatifs : `X-Checksum-Sha256` permet au serveur de vérifier les octets en un seul passage, et `If-None-Match: *` refuse la requête si le chemin existe déjà. Une requête doit se terminer en moins de 30 minutes. Utilisez `put` pour les gros fichiers. Voir [Fichiers bruts](../protocols/raw-files).

### Dans la console {#put-console}

1. Téléversez le fichier dans [[ui:upload]]. Voir [Transferts](./transfers).
2. Ouvrez l’artefact dans [[ui:catalog]] avec [[ui:open]].
3. Dans [[ui:assetTitle]], saisissez le [[ui:assetPath]], par exemple `releases/current.upack`.
4. Saisissez la [[ui:currentRevision]] : `0` pour un nouveau chemin, ou la révision actuelle affichée dans [[ui:history]].
5. Sélectionnez [[ui:assign]].

Le champ de révision protège contre deux personnes modifiant un chemin en même temps. S’il ne s’agit pas de la révision actuelle, le serveur refuse avec un conflit. Rechargez l’historique et réessayez.

### Avec l’API et le SDK {#put-api}

`setAsset` fait pointer un chemin vers un artefact que vous avez déjà téléversé. `expectedRevision` vaut `0` pour créer le chemin, et la révision actuelle sinon.

```bash
curl -X PUT "$ARKVORY/api/v1/repositories/releases/asset" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"path":"builds/game/1.4/GameSetup.exe","artifactId":"3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11","expectedRevision":0}'
```

```typescript
const current = await releases.assets.get('builds/game/1.4/GameSetup.exe');
await releases.assets.assign('builds/game/1.4/GameSetup.exe', artifactId, current.revision);
```

Un conflit répond `409 revision_mismatch`. Ne réessayez pas avec une révision devinée. Après une réponse perdue, lisez le chemin : si le nouvel artefact s’y trouve déjà, c’est terminé.

## Lire un chemin {#read}

- `arkvoryctl get PATH OUTPUT` télécharge le fichier actuel.
- `GET /api/v1/repositories/<repository>/raw/<path>` et `GET /api/v1/repositories/<repository>/asset/content?path=<path>` renvoient les octets. Les deux nécessitent `content.read` et prennent en charge les plages et l’ETag.
- `getAsset` (`GET …/asset?path=`) renvoie le pointeur : `path`, `revision`, `artifactId`.
- `listAssetPage` (`GET …/assets/page?prefix=`) liste les pointeurs. Les pages contiennent jusqu’à 100 éléments (50 par défaut) dans l’ordre des octets du chemin UTF-8. Le préfixe est littéral et sensible à la casse. Passez `next` comme `after`. L’ancien `listAssets` renvoie jusqu’à 1000 éléments et vous demande de restreindre le préfixe.

```typescript
const page = await releases.assets.list({ prefix: 'builds/game/', limit: 100 });
```

## Révisions et historique {#history}

Dans la console, ouvrez [[ui:history]], saisissez le chemin dans [[ui:assetPath]] et sélectionnez [[ui:historyLoad]]. Le tableau affiche la [[ui:revision]], l’heure ([[ui:date]]), l’auteur ([[ui:actor]]) et, pour les révisions restaurées, la révision dont elles proviennent ([[ui:source]]). La plus récente est en premier. [[ui:historyMore]] charge les plus anciennes, 50 à la fois. [[ui:open]] sur une ligne ouvre l’artefact de cette révision, d’où vous pouvez télécharger son contenu d’origine.

Avec l’API, `getAssetHistory` (`…/asset/history?path=&before=`) renvoie les pages, de la plus récente à la plus ancienne, et `before` est la dernière révision de la page précédente. `getAssetRevision` (`…/asset/revision?path=&revision=`) renvoie une révision. L’auteur et l’heure sont vides pour les révisions écrites avant que l’historique ne les enregistre. La lecture nécessite `asset.read`.

## Restaurer une révision antérieure {#restore}

Restaurer fait pointer le chemin vers l’artefact d’une révision plus ancienne. Cela ne copie aucun octet et ne supprime aucune révision : la restauration est une nouvelle révision, la plus récente, et l’historique indique d’où elle vient.

Dans la console, chargez l’historique et sélectionnez le bouton de restauration de la révision souhaitée. Le bouton de la révision actuelle est désactivé. La restauration nécessite `asset.restore`, `asset.read` et `artifact.read`.

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/asset/restore" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"path":"builds/game/1.4/GameSetup.exe","sourceRevision":3,"expectedRevision":5}'
```

```typescript
await releases.assets.restore('builds/game/1.4/GameSetup.exe', 3, 5);
```

`expectedRevision` est la dernière révision que vous avez vue. Si le chemin a changé entre-temps, le serveur répond `409 revision_mismatch` ; la console affiche un message et vous demande de recharger l’historique. Une restauration ne rétablit pas les anciennes étiquettes ni les anciennes métadonnées : elles restent telles qu’elles sont maintenant.

## Étiquettes, métadonnées et collections {#labels}

Chaque artefact porte trois sortes de notes. Vous pouvez les modifier à tout moment. Le fichier lui-même ne change jamais.

| Type        | Exemple                                        | Règles                                                                                                                                                         |
| ----------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Étiquettes  | `test`, `staging`, `release`, `linux`          | Jusqu’à 32. Chacune de 1 à 64 lettres, chiffres, `_`, `.`, `:` ou `-`. La casse compte                                                                         |
| Métadonnées | `build.number` = `42`, `git.commit` = `abc123` | Jusqu’à 32 champs textuels. Une clé commence par une lettre et compte jusqu’à 64 lettres, chiffres, `_`, `.` ou `-`. Une valeur compte jusqu’à 1024 caractères |
| Collections | `desktop`, `nightly`                           | Jusqu’à 32. Mêmes règles que les étiquettes. Elles regroupent des artefacts, quelle que soit leur version ou leur chemin                                       |

Les étiquettes sont du texte libre. Elles ne donnent aucun accès et ne déplacent aucun fichier. La console suggère [[ui:labelPresets]] (`nightly`, `test`, `staging`, `release`), mais toute étiquette est valide, et `relase` n’est pas corrigé. Pour une approbation sur laquelle les déploiements s’appuient, utilisez une étape ([Étapes et promotion](./promotion)).

**Console.** Ouvrez l’artefact dans [[ui:metadata]]. Saisissez [[ui:labels]] et [[ui:collections]] séparés par des virgules. Utilisez [[ui:metadataAdd]] pour un champ dans [[ui:metadataFields]] : une [[ui:metadataKey]] et une [[ui:metadataValue]]. [[ui:metadataJson]] modifie les mêmes données sous forme de JSON. Sélectionnez [[ui:save]].

**arkvoryctl.** Au moment du téléversement, `--label test` ajoute une étiquette, et `--file metadata.json` fournit `labels` et `metadata` :

```json
{ "labels": ["test"], "metadata": { "build.number": "42", "git.commit": "abc123" } }
```

Pour modifier un artefact existant, lisez-le, puis envoyez l’état complet et nouveau avec la révision que vous avez lue :

```bash
arkvoryctl annotations get 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl annotations set 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --revision 3 --file annotations.json
```

`annotations.json` doit contenir les trois clés : `labels`, `metadata` et `collections`. Tout ce que vous omettez devient vide. Un enregistrement remplace l’ensemble. Si quelqu’un a enregistré en premier, le serveur répond `409 revision_mismatch` : relisez et décidez. Le SDK ne répète pas ces enregistrements.

```typescript
const current = await releases.annotations.get(id);
await releases.annotations.update(id, current.revision, {
  labels: [...current.labels, 'release'],
  metadata: current.metadata,
  collections: current.collections,
});
```

Vous avez besoin de `annotation.read` pour lire, et de `annotation.write` avec `artifact.read` pour écrire.

**Recherche.** Dans [[ui:catalog]], saisissez du texte dans [[ui:search]] : cela correspond au nom du fichier et aux valeurs de métadonnées, sans tenir compte de la casse. [[ui:labelFilter]] n’affiche qu’une étiquette. [[ui:metadataFilter]] fait correspondre une clé et une valeur exactement, casse comprise. Avec `arkvoryctl` :

```bash
arkvoryctl search --query game --label release
arkvoryctl search --collection nightly
arkvoryctl search --metadata-key git.commit --metadata-value abc123
```

`--metadata-key` et `--metadata-value` vont ensemble. Les pages contiennent jusqu’à 100 résultats. Passez `next` comme `--after`. Les filtres se combinent avec AND.

## Pièces jointes {#attachments}

Les pièces jointes lient d’autres fichiers à un build : un manifeste, un SBOM, une signature, un rapport ou tout autre fichier. Une pièce jointe est un nom et un lien vers un autre artefact du même dépôt. Le build et la pièce jointe restent des fichiers distincts.

| Règle       | Valeur                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Types       | `manifest`, `sbom`, `signature`, `report`, `file`                                                                            |
| Par build   | Au plus 32                                                                                                                   |
| Nom         | 1 à 240 caractères, unique au sein du build (casse ignorée), sans `/`, `\`, caractères de contrôle ni espaces aux extrémités |
| Description | Jusqu’à 512 caractères, peut être vide                                                                                       |
| Cible       | Un artefact publié du même dépôt. Pas le build lui-même                                                                      |

Le type indique seulement à quoi sert le fichier. Arkvory ne vérifie pas une signature, ne lit pas un SBOM et n’exécute pas un manifeste.

Dans la console, ouvrez l’artefact. Sous [[ui:attachmentsTitle]], développez le formulaire [[ui:attachmentAdd]]. Choisissez la [[ui:attachmentSource]] : [[ui:attachmentUpload]] envoie un nouveau fichier et le lie, [[ui:attachmentExisting]] lie un artefact déjà publié. Choisissez le [[ui:attachmentKind]] : [[ui:attachmentManifest]], [[ui:attachmentSbom]], [[ui:attachmentSignature]], [[ui:attachmentReport]] ou [[ui:attachmentFile]]. Donnez-lui un [[ui:attachmentName]] et, si vous le souhaitez, une [[ui:attachmentDescription]]. Sélectionnez ensuite [[ui:attachmentAdd]]. [[ui:attachmentUnlink]] retire un lien et conserve le fichier. [[ui:attachmentReload]] relit la liste. Si le téléversement d’une pièce jointe échoue, [[ui:attachmentRecovery]] affiche l’ID du téléversement avec lequel continuer.

Chaque modification de la liste est une version numérotée. [[ui:attachmentHistory]] affiche les précédentes, et [[ui:attachmentRestore]] en rétablit une comme nouvelle version.

Avec `arkvoryctl`, le fichier contient toute la liste sous forme de tableau JSON :

```json
[
  {
    "name": "build.json",
    "kind": "manifest",
    "artifactId": "64b42380-902d-41cf-9151-10c12e4809dc",
    "description": "Build provenance from CI"
  }
]
```

```bash
arkvoryctl attachments get 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl attachments set 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --revision 0 --file attachments.json
arkvoryctl attachments history 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`--revision` est le numéro que vous avez lu avec `get` ; un nouveau build a `0`. Avec l’API, `replaceBuildAttachments` prend `expectedRevision` et `items` ; `getBuildAttachments` et `getBuildAttachmentHistory` lisent. Pour télécharger une pièce jointe, utilisez l’`artifactId` de son lien avec le téléchargement habituel. La lecture nécessite `annotation.read`, la modification nécessite `annotation.write` avec `artifact.read`, et le téléversement du fichier joint nécessite les actions de téléversement.

Les pièces jointes et les chemins ne suivent pas une promotion vers un autre dépôt. Voir [Étapes et promotion](./promotion).

## Pages associées {#related-pages}

- [Fichiers bruts](../protocols/raw-files)
- [Transferts](./transfers) et [Paquets UPack](./packages)
- [Ligne de commande (arkvoryctl)](../protocols/cli)
- Référence de l’API : [Fichiers par chemin](../api/reference/files), [Artefacts et catalogue](../api/reference/artifacts), [Pièces jointes de build](../api/reference/attachments)
