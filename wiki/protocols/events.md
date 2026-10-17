---
title: 'Events'
description: 'Follow every change of the installation with one cursor: CloudEvents, permissions, retention and resynchronization.'
---

# Events

The event feed tells an external system what changed in the whole installation: publications, deletions, file paths, package registrations, annotations, attachments, stages, promotions, container images, npm and Git LFS. It is one ordered stream for every repository you may read, in the [CloudEvents 1.0](https://cloudevents.io) format. Read it with `arkvoryctl events tail`, the [TypeScript SDK](./sdk) or `GET /api/v1/events`.

An event is a hint that something changed. Read the current state through the ordinary API, and handle events so that a repeated one does no harm.

## Read the feed {#read}

```bash
arkvoryctl events tail --cursor-file ./arkvory.cursor
```

The command prints one event per line as JSON and saves the position in `--cursor-file` after every event. Run it again and it continues where it stopped. Add `--follow` to wait for new events until Ctrl+C. `--types artifact.*,stage.added` keeps the named types or prefixes, `--repository releases` keeps one repository, and `--after <id>` starts after the given event.

In TypeScript, `follow` reads page after page and calls `save` after every event you have handled:

```ts
for await (const event of client.events.follow({ after: saved, save: (cursor) => store(cursor) })) {
  await handle(event);
}
```

Over HTTP:

```bash
curl -H "Authorization: Bearer $ARKVORY_TOKEN" \
  "https://arkvory.example.com/api/v1/events?limit=100&types=artifact.*"
```

The answer holds `items`, `next`, `head`, `oldest` and `epoch`. Pass `next` as `after` in the next request. Without `after` the feed starts at the oldest event the server keeps. A request returns up to `limit` events (1–500, 100 by default). A page with fewer than `limit` events is not the end of the feed: one request looks at no more than 5000 events, so you have read everything when the position in `next` equals `head`. See [listEvents](../api/reference/events#listEvents).

## The event {#event}

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

- `id` is the same for every repeat of an event: deduplicate by it.
- `data` holds identifiers and facts of the artifact: the name, the size as a decimal string, SHA-256, labels and stages at the time of the event and the UPack package. File, stage, image, npm and Git LFS events add the path, the stage, the image with its digest or tag, the npm package or the object id.
- Metadata values, the user who made the change, secrets and file contents are never in an event. If labels would make `data` larger than 8 KiB, they are left out and `truncated` is `true`.
- `GET /api/v1/events/types` lists every type with the JSON Schema of its `data`.

| Group              | Types                                                                               |
| ------------------ | ----------------------------------------------------------------------------------- |
| Artifacts          | `artifact.published`, `artifact.deleted`, `artifact.promoted`, `artifact.received`  |
| Files and packages | `asset.revision.created`, `asset.restored`, `package.registered`                    |
| Descriptions       | `annotation.updated`, `attachments.updated`, `stage.added`, `stage.removed`         |
| Container images   | `oci.manifest.pushed`, `oci.manifest.deleted`, `oci.tag.updated`, `oci.tag.deleted` |
| npm and Git LFS    | `npm.version.published`, `npm.tag.updated`, `npm.tag.deleted`, `lfs.object.stored`  |

## Order and permissions {#order}

- Events of one repository come in the order their changes were committed (`partitionkey`). Across repositories, positions show the order in which events became visible, not cause and effect.
- Positions grow but may skip numbers. Never expect them to be consecutive.
- An event appears in the feed about half a second after its change, once the worker has numbered it. While the worker is stopped, events wait and nothing is lost.
- You see the events of the repositories where your key or account has `artifact.list`, the same right as for the [change feed](../api/reference/artifacts#listCatalogChanges). Permissions are checked on every request, so a revoked right hides events at once.
- `next` also moves past events you may not see, at most 5000 per request, so a narrow key never stands still. It only tells that the server had other events at those positions.

## Retention and restore {#retention}

The server keeps events for 168 hours and at most 5 000 000 of them (`ARKVORY_EVENTS_RETENTION_HOURS`, `ARKVORY_EVENTS_MAX_ROWS`, see [Environment variables](../reference/environment)). The feed is a window, not a history: the catalog audit keeps the history. Events are not part of backups.

| Answer                                 | What happened                                                               | What to do                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `410`, `gone/events_cursor_expired`    | Your cursor is older than `oldest`                                          | Read the current state through the API, then continue from `oldest`         |
| `409`, `conflict/events_epoch_changed` | The server was restored from a backup and its positions began a new `epoch` | Read the current state, then continue without a cursor or from the new head |

Both answers carry `events` with the current `epoch`, `oldest` and `head`; a cursor is `<epoch>:<position>`. `arkvoryctl events tail` ends with exit code 6, and the SDK raises the error with the same fields.

## Webhooks {#webhooks}

[Webhooks](./webhooks) still send the change feed of one repository to an HTTP address. The event feed does not replace them.
