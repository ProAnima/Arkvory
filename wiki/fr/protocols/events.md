---
title: 'Événements'
description: 'Suivez chaque modification de l’installation avec un seul curseur : CloudEvents, permissions, conservation et resynchronisation.'
---

# Événements

Le flux d’événements indique à un système externe ce qui a changé dans toute l’installation : publications, suppressions, chemins de fichiers, enregistrements de paquets, annotations, pièces jointes, étapes, promotions, images de conteneur, npm et Git LFS. C’est un seul flux ordonné pour tous les dépôts que vous pouvez lire, au format [CloudEvents 1.0](https://cloudevents.io). Lisez-le avec `arkvoryctl events tail`, le [SDK TypeScript](./sdk) ou `GET /api/v1/events`.

Un événement est une indication que quelque chose a changé. Lisez l’état actuel par l’API habituelle et traitez les événements de sorte qu’une répétition ne fasse aucun dégât.

## Lire le flux {#read}

```bash
arkvoryctl events tail --cursor-file ./arkvory.cursor
```

La commande affiche un événement par ligne en JSON et enregistre la position dans `--cursor-file` après chaque événement. Relancez-la et elle reprend là où elle s’est arrêtée. Ajoutez `--follow` pour attendre de nouveaux événements jusqu’à Ctrl+C. `--types artifact.*,stage.added` garde les types ou préfixes nommés, `--repository releases` un seul dépôt, et `--after <id>` commence après l’événement indiqué.

En TypeScript, `follow` lit page après page et appelle `save` après chaque événement que vous avez traité :

```ts
for await (const event of client.events.follow({ after: saved, save: (cursor) => store(cursor) })) {
  await handle(event);
}
```

En HTTP :

```bash
curl -H "Authorization: Bearer $ARKVORY_TOKEN" \
  "https://arkvory.example.com/api/v1/events?limit=100&types=artifact.*"
```

La réponse contient `items`, `next`, `head`, `oldest` et `epoch`. Passez `next` comme `after` dans la requête suivante. Sans `after`, le flux commence au plus ancien événement conservé par le serveur. Une requête renvoie jusqu’à `limit` événements (1–500, 100 par défaut). Voir [listEvents](../api/reference/events#listEvents).

## L’événement {#event}

```json
{
  "specversion": "1.0",
  "id": "0f7d8e3c-1d2b-4a5c-9e8f-0a1b2c3d4e5f:42",
  "source": "/arkvory/studio/repositories/releases",
  "type": "arkvory.artifact.published.v1",
  "subject": "9a7b6c5d-4e3f-4a1b-8c2d-1e0f9a8b7c6d",
  "time": "2026-10-17T09:30:00.000Z",
  "datacontenttype": "application/json",
  "dataschema": "urn:arkvory:event:artifact.published:1",
  "partitionkey": "repository:releases",
  "arkvoryposition": "42",
  "arkvoryepoch": "0f7d8e3c-1d2b-4a5c-9e8f-0a1b2c3d4e5f",
  "data": {
    "repository": "releases",
    "artifactId": "9a7b6c5d-4e3f-4a1b-8c2d-1e0f9a8b7c6d",
    "name": "game.upack",
    "size": "73400320",
    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "labels": ["ci"],
    "stages": []
  }
}
```

- `id` est le même à chaque répétition d’un événement : dédupliquez par lui.
- `data` contient des identifiants et des faits sur l’artefact : le nom, la taille en chaîne décimale, SHA-256, les étiquettes et étapes au moment de l’événement et le paquet UPack. Les événements de fichiers, d’étapes, d’images, npm et Git LFS ajoutent le chemin, l’étape, l’image avec son digest ou son tag, le paquet npm ou l’id de l’objet.
- Les valeurs de métadonnées, l’utilisateur à l’origine du changement, les secrets et le contenu des fichiers ne figurent jamais dans un événement. Si les étiquettes rendaient `data` plus grand que 8 KiB, elles sont omises et `truncated` vaut `true`.
- `GET /api/v1/events/types` liste chaque type avec le JSON Schema de son `data`.

| Groupe              | Types                                                                               |
| ------------------- | ----------------------------------------------------------------------------------- |
| Artefacts           | `artifact.published`, `artifact.deleted`, `artifact.promoted`, `artifact.received`  |
| Fichiers et paquets | `asset.revision.created`, `asset.restored`, `package.registered`                    |
| Descriptions        | `annotation.updated`, `attachments.updated`, `stage.added`, `stage.removed`         |
| Images de conteneur | `oci.manifest.pushed`, `oci.manifest.deleted`, `oci.tag.updated`, `oci.tag.deleted` |
| npm et Git LFS      | `npm.version.published`, `npm.tag.updated`, `npm.tag.deleted`, `lfs.object.stored`  |

## Ordre et permissions {#order}

- Les événements d’un dépôt arrivent dans l’ordre de validation de leurs changements (`partitionkey`). Entre dépôts, les positions montrent l’ordre dans lequel les événements sont devenus visibles, pas la cause et l’effet.
- Les positions croissent mais peuvent sauter des numéros. Ne comptez jamais sur des valeurs consécutives.
- Un événement apparaît dans le flux environ une demi-seconde après son changement, une fois que le worker l’a numéroté. Tant que le worker est arrêté, les événements attendent et rien n’est perdu.
- Vous voyez les événements des dépôts où votre clé ou votre compte a `artifact.list`, la même permission que pour le [flux de modifications](../api/reference/artifacts#listCatalogChanges). Les permissions sont vérifiées à chaque requête : une permission retirée masque aussitôt les événements.
- `next` avance aussi au-delà des événements que vous ne pouvez pas voir, au plus 5000 par requête, de sorte qu’une clé aux droits restreints n’est jamais bloquée. Il indique seulement que le serveur avait d’autres événements à ces positions.

## Conservation et restauration {#retention}

Le serveur conserve les événements 168 heures et au plus 5 000 000 (`ARKVORY_EVENTS_RETENTION_HOURS`, `ARKVORY_EVENTS_MAX_ROWS`, voir [Variables d’environnement](../reference/environment)). Le flux est une fenêtre, pas un historique : l’audit du catalogue garde l’historique. Les événements ne font pas partie des sauvegardes.

| Réponse                                | Ce qui s’est passé                                                                                 | Que faire                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `410`, `gone/events_cursor_expired`    | Votre curseur est plus ancien que `oldest`                                                         | Lisez l’état actuel par l’API, puis continuez depuis `oldest`               |
| `409`, `conflict/events_epoch_changed` | Le serveur a été restauré depuis une sauvegarde et ses positions ont commencé une nouvelle `epoch` | Lisez l’état actuel, puis continuez sans curseur ou depuis la nouvelle tête |

Les deux réponses portent `events` avec les `epoch`, `oldest` et `head` actuels ; un curseur est `<epoch>:<position>`. `arkvoryctl events tail` se termine avec le code de sortie 6, et le SDK lève l’erreur avec les mêmes champs.

## Webhooks {#webhooks}

Les [webhooks](./webhooks) envoient toujours le flux de modifications d’un dépôt à une adresse HTTP. Le flux d’événements ne les remplace pas.
