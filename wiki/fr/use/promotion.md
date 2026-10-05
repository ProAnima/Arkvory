---
title: Étapes et promotion
description: 'Marquez les builds avec des étapes, promouvez-les vers un autre dépôt et laissez un agent de déploiement choisir le build le plus récent d’une étape.'
---

# Étapes et promotion

Un build passe de la CI à la production par étapes : testé, approuvé, publié. Arkvory dispose de deux outils pour cela. Une **étape** est une marque sur un build, telle que `qa` ou `release`. La **promotion** publie un build dans un autre dépôt sans renvoyer les octets. Utilisez l’un, l’autre, ou les deux ensemble.

## Étapes et dépôts {#concepts}

- Une **étape** indique où un build est approuvé. Un build peut avoir plusieurs étapes, jusqu’à 16. Les étapes appartiennent à un build dans un seul dépôt. Seules les opérations d’étape les modifient, et chaque changement est inscrit dans un journal avec l’auteur et un commentaire facultatif.
- Une **promotion** copie ou déplace un build d’un dépôt vers un autre, par exemple de `dev` à `staging` puis `prod`. La copie est un nouvel artefact dans la cible. Aucun octet n’est téléversé.
- Une **étiquette** n’est qu’un tag libre sans historique. Une étape est la marque contrôlée sur laquelle un déploiement peut s’appuyer. Voir [Fichiers par chemin](./files#labels).

Un nom d’étape comporte de 1 à 32 caractères : lettres minuscules, chiffres, `.`, `_` ou `-`, en commençant par une lettre ou un chiffre. Un build portant une étape ne peut pas être supprimé, et la rétention le conserve. Retirez d’abord l’étape.

## Ajouter et retirer des étapes {#stages}

Dans la console, ouvrez l’artefact dans [[ui:metadata]]. La section [[ui:promotionTitle]] affiche [[ui:stagesTitle]] avec les étapes du build. Saisissez un [[ui:stageName]] et, si vous le souhaitez, un [[ui:stageComment]], puis sélectionnez [[ui:stageAdd]]. Chaque étape dispose d’un bouton pour la retirer, et la console demande confirmation : les déploiements qui demandent cette étape choisiront une autre version.

Les étapes apparaissent aussi dans le catalogue, sous forme de pastilles sur chaque ligne, et dans la colonne [[ui:packageStages]] de [[ui:packages]].

```bash
arkvoryctl stages add 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 qa --comment "smoke passed" --repository dev
arkvoryctl stages list 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository dev
arkvoryctl stages remove 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 qa --repository dev
arkvoryctl stages artifacts --stage release --repository prod
```

`stages artifacts` liste chaque build qui possède une étape, ou une seule étape, 100 à la fois. Passez `next` comme `--after`.

Avec l’API :

```bash
curl -X PUT "$ARKVORY/api/v1/repositories/dev/artifacts/$ID/stages/qa" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"comment":"smoke passed"}'
curl -X DELETE "$ARKVORY/api/v1/repositories/dev/artifacts/$ID/stages/qa" \
  -H "Authorization: Bearer $ARKVORY_KEY"
```

```typescript
await dev.stages.add(id, 'qa', 'smoke passed');
const { items } = await prod.stages.artifacts({ stage: 'release' });
```

Les opérations sont `setArtifactStage`, `removeArtifactStage`, `listArtifactStages` et `listStagedArtifacts`. Ajouter une étape déjà présente ne change rien : l’heure et le commentaire d’origine sont conservés. Retirer une étape absente réussit. Un build portant 16 étapes refuse la suivante avec `409 stage_limit`.

## Promouvoir vers un autre dépôt {#promote}

Dans la console, ouvrez l’artefact. Le formulaire [[ui:promoteTitle]] apparaît lorsque vous pouvez lire le build et promouvoir vers au moins un autre dépôt. Choisissez la [[ui:promoteTarget]] parmi ces dépôts. Saisissez les [[ui:promoteStages]] à définir dans la cible, séparées par des virgules, et un [[ui:promoteComment]]. Sélectionnez [[ui:promoteSubmit]]. Si aucun autre dépôt ne l’autorise, la console affiche [[ui:promoteNoTargets]].

```bash
arkvoryctl promote 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository staging --to prod --stage release --comment CAB-142
arkvoryctl promote 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository staging --to prod --move
```

`--repository` est la source, `--to` la cible. Le résultat contient le `repository` cible, le nouvel `artifactId`, le `sourceArtifactId`, le `mode`, `created` et les `stages`.

```bash
curl -X POST "$ARKVORY/api/v1/repositories/staging/artifacts/$ID/promote" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"target":"prod","mode":"copy","stages":["release"],"comment":"CAB-142"}'
```

```typescript
await staging.promotions.promote(id, { target: 'prod', mode: 'copy', stages: ['release'] });
```

La réponse est `201` pour une nouvelle copie et `200` lorsque la cible la possédait déjà. L’opération est `promoteArtifact`.

### Copie ou déplacement {#copy-move}

|                     | Copie (par défaut)    | Déplacement                                                                                                                 |
| ------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Source              | Reste                 | Est supprimée à la même étape que la publication de la copie                                                                |
| Étapes de la source | Restent sur la source | Passent à la copie, en plus des étapes que vous donnez                                                                      |
| Dans la console     |                       | Cochez [[ui:promoteMove]]. La console demande confirmation                                                                  |
| Bloqué lorsque      |                       | La source est encore utilisée par une référence externe, un chemin de fichier ou un lien de pièce jointe. Rien n’est publié |

Ce que la copie reçoit et ce qu’elle ne reçoit pas :

- Elle reçoit les étiquettes, les métadonnées et les collections de la source, son identité UPack et les étapes que vous donnez. C’est un nouvel artefact avec un nouvel ID. Sa somme SHA-256 est identique.
- Elle ne reçoit aucune pièce jointe ni pointeur de chemin. Liez-les de nouveau dans la cible.
- Aucun octet n’est téléversé. Sur le même serveur, le fichier stocké est partagé jusqu’à ce que le dernier artefact qui l’utilise disparaisse.
- Elle est décomptée du quota de la cible comme un nouveau téléversement.
- Répéter une promotion renvoie la même copie. Si la cible possède déjà un paquet avec le même groupe, nom, version et checksum, cet artefact est renvoyé. Avec des octets différents, le serveur répond `409 version_exists`.
- La cible doit différer de la source. Un miroir ne peut pas être une cible, car il est en lecture seule. Voir [Dépôts](./repositories#read-only).

Une promotion interrompue laisse une réservation de courte durée. Relancez la même promotion avec le même compte pour continuer.

## Historique des promotions {#history}

La page de l’artefact dans la console affiche [[ui:promotionHistory]], du plus ancien au plus récent : qui a ajouté ou retiré une étape, qui a copié ou déplacé le build vers un autre dépôt, et l’origine d’une copie reçue. [[ui:promotionMore]] charge les entrées suivantes.

```bash
arkvoryctl promotions history 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository prod
arkvoryctl promotions journal --repository prod --after 120 --json
```

Le journal d’un dépôt est destiné à la CI. Interrogez-le avec la dernière `sequence` vue comme `--after`, et vous obtenez les nouveaux événements dans l’ordre. Un événement contient une `sequence`, l’`action` (`stage.added`, `stage.removed`, `promoted` ou `received`), la `stage`, le `mode`, le dépôt et l’artefact pairs, l’`actor`, le `comment` et l’heure. Les pages contiennent jusqu’à 100 événements. Les opérations sont `listArtifactPromotions` et `listRepositoryPromotions`.

## Choisir un build pour le déploiement {#resolve}

Un agent de déploiement demande « le build le plus récent du paquet `app` qui se trouve dans la plage `^1.4` et porte l’étape `release` ». Arkvory répond avec exactement une version, ou avec `404` s’il n’y en a aucune.

```bash
arkvoryctl packages resolve app --group acme/game --range ^1.4 --stage release --repository prod --json
arkvoryctl packages download app ./app.upack --group acme/game --range ^1.4 --stage release --repository prod
```

`resolve` affiche le choix sans le télécharger :

```json
{
  "group": "acme/game",
  "name": "app",
  "version": "1.4.7",
  "artifactId": "3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11",
  "sha256": "…",
  "size": "73400320",
  "publishedAt": "2026-10-01T09:30:00.000Z",
  "stagedAt": "2026-10-02T12:00:00.000Z",
  "stages": ["qa", "release"]
}
```

En HTTP, `resolvePackage` renvoie ceci, et `downloadPackageContent` envoie les octets du même choix en un seul appel :

```bash
curl -fL -G -H "Authorization: Bearer $DEPLOY_KEY" -o app.upack \
  --data-urlencode "name=app" --data-urlencode "group=acme/game" \
  --data-urlencode "range=^1.4" --data-urlencode "stage=release" \
  "$ARKVORY/api/v1/repositories/prod/packages/content"
```

```typescript
const found = await prod.packages.resolve({ name: 'app', range: '^1.4', stage: 'release' });
```

Les filtres sont les mêmes dans chaque outil : le `name` du paquet, le `group` (vide si le paquet n’en a pas), une version exacte ou une plage, la `stage`, l’inclusion ou non des préversions et l’ordre. Les plages sont expliquées dans [Paquets UPack](./packages#versions).

Par défaut, la version SemVer la plus récente l’emporte. Avec `--order promoted` (`order=promoted` en HTTP), la version qui a été marquée d’une étape le plus récemment l’emporte, même si son numéro est inférieur. Cela nécessite une étape.

Le nom est résolu à chaque requête, deux appels peuvent donc renvoyer des builds différents si quelqu’un promeut entre-temps. Pour un téléchargement qui doit pouvoir reprendre, prenez l’`artifactId` renvoyé par `resolve` et téléchargez celui-ci.

## Revenir à la version précédente {#rollback}

Avec l’ordre `promoted`, un retour arrière est une étape ordinaire. Retirez l’étape de la version défectueuse, et la version marquée avant elle devient le choix. Pour remettre une version plus ancienne en vigueur, retirez son étape puis ajoutez-la de nouveau : ajouter une étape déjà présente ne renouvelle pas son horodatage.

```bash
arkvoryctl stages remove <faulty artifact id> release --repository prod
arkvoryctl packages download app ./app.upack --stage release --order promoted --repository prod
```

## Autorisations {#permissions}

| Action                                     | Clés : actions de dépôt                                                | Personnes : accès de groupe                  |
| ------------------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------- |
| Lire les étapes et l’historique d’un build | `artifact.read`                                                        | Lecture                                      |
| Lister les builds marqués et le journal    | `artifact.list`                                                        | Lecture                                      |
| Ajouter ou retirer une étape               | `artifact.promote` avec `artifact.read`                                | Écriture                                     |
| Promouvoir par copie                       | Source : `artifact.read` et `content.read`. Cible : `artifact.promote` | Lecture sur la source, écriture sur la cible |
| Promouvoir par déplacement                 | Idem, plus `artifact.promote` sur la source                            | Écriture sur les deux                        |
| Résoudre une version                       | `package.read`                                                         | Lecture                                      |
| Télécharger la version choisie par nom     | `content.read`                                                         | Lecture                                      |

Une clé pour un agent de déploiement qui ne fait que télécharger a besoin de `content.read` dans le dépôt qu’il lit. Pour `arkvoryctl packages download`, elle a aussi besoin de `package.read` et `artifact.read`. Voir [Autorisations](./accounts#permissions).

Les serveurs peuvent aussi échanger des builds d’eux-mêmes : un dépôt peut importer, depuis un dépôt d’un autre serveur, les versions qui portent certaines étapes. Voir [Miroirs](../operate/mirrors).

## Pages associées {#related-pages}

- [Paquets UPack](./packages) et [Dépôts](./repositories)
- [Comptes et accès](./accounts)
- [Ligne de commande (arkvoryctl)](../protocols/cli#packages-and-promotion)
- Référence API : [Étapes et promotion](../api/reference/promotion)
