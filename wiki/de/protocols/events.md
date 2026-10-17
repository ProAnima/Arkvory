---
title: 'Ereignisse'
description: 'Verfolgen Sie jede Änderung der Installation mit einem Cursor: CloudEvents, Rechte, Aufbewahrung und Neusynchronisierung.'
---

# Ereignisse

Der Ereignis-Feed teilt einem externen System mit, was sich in der gesamten Installation geändert hat: Veröffentlichungen, Löschungen, Dateipfade, Paketregistrierungen, Annotationen, Anhänge, Stufen, Hochstufungen, Container-Images, npm und Git LFS. Er ist ein geordneter Strom über alle Repositorys, die Sie lesen dürfen, im Format [CloudEvents 1.0](https://cloudevents.io). Lesen Sie ihn mit `arkvoryctl events tail`, dem [TypeScript-SDK](./sdk) oder `GET /api/v1/events`.

Ein Ereignis ist ein Hinweis, dass sich etwas geändert hat. Lesen Sie den aktuellen Stand über die übliche API und verarbeiten Sie Ereignisse so, dass eine Wiederholung keinen Schaden anrichtet.

## Den Feed lesen {#read}

```bash
arkvoryctl events tail --cursor-file ./arkvory.cursor
```

Der Befehl gibt ein Ereignis pro Zeile als JSON aus und speichert die Position nach jedem Ereignis in `--cursor-file`. Starten Sie ihn erneut, setzt er dort fort, wo er aufgehört hat. Mit `--follow` wartet er bis Strg+C auf neue Ereignisse. `--types artifact.*,stage.added` behält die genannten Typen oder Präfixe, `--repository releases` ein Repository, und `--after <id>` beginnt nach dem angegebenen Ereignis.

In TypeScript liest `follow` Seite für Seite und ruft `save` nach jedem verarbeiteten Ereignis auf:

```ts
for await (const event of client.events.follow({ after: saved, save: (cursor) => store(cursor) })) {
  await handle(event);
}
```

Über HTTP:

```bash
curl -H "Authorization: Bearer $ARKVORY_TOKEN" \
  "https://arkvory.example.com/api/v1/events?limit=100&types=artifact.*"
```

Die Antwort enthält `items`, `next`, `head`, `oldest` und `epoch`. Übergeben Sie `next` in der nächsten Anfrage als `after`. Ohne `after` beginnt der Feed beim ältesten Ereignis, das der Server aufbewahrt. Eine Anfrage liefert bis zu `limit` Ereignisse (1–500, Standard 100). Eine Seite mit weniger als `limit` Ereignissen ist nicht das Ende des Feeds. Eine Anfrage prüft höchstens 5000 Ereignisse; Sie haben alles gelesen, wenn die Position in `next` gleich `head` ist. Siehe [listEvents](../api/reference/events#listEvents).

## Das Ereignis {#event}

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

- `id` ist bei jeder Wiederholung eines Ereignisses gleich: Deduplizieren Sie danach.
- `data` enthält Kennungen und Fakten des Artefakts: den Namen, die Größe als Dezimalzeichenkette, SHA-256, Labels und Stufen zum Zeitpunkt des Ereignisses und das UPack-Paket. Ereignisse zu Dateien, Stufen, Images, npm und Git LFS ergänzen den Pfad, die Stufe, das Image mit Digest oder Tag, das npm-Paket oder die Objekt-ID.
- Metadatenwerte, der Benutzer, der die Änderung vorgenommen hat, Geheimnisse und Dateiinhalte sind nie in einem Ereignis. Würden die Labels `data` größer als 8 KiB machen, entfallen sie und `truncated` ist `true`.
- `GET /api/v1/events/types` listet jeden Typ mit dem JSON Schema seiner `data`.

| Gruppe           | Typen                                                                               |
| ---------------- | ----------------------------------------------------------------------------------- |
| Artefakte        | `artifact.published`, `artifact.deleted`, `artifact.promoted`, `artifact.received`  |
| Dateien, Pakete  | `asset.revision.created`, `asset.restored`, `package.registered`                    |
| Beschreibungen   | `annotation.updated`, `attachments.updated`, `stage.added`, `stage.removed`         |
| Container-Images | `oci.manifest.pushed`, `oci.manifest.deleted`, `oci.tag.updated`, `oci.tag.deleted` |
| npm und Git LFS  | `npm.version.published`, `npm.tag.updated`, `npm.tag.deleted`, `lfs.object.stored`  |

## Reihenfolge und Rechte {#order}

- Ereignisse eines Repositorys kommen in der Reihenfolge, in der ihre Änderungen festgeschrieben wurden (`partitionkey`). Zwischen Repositorys zeigen die Positionen, in welcher Reihenfolge Ereignisse sichtbar wurden, nicht Ursache und Wirkung.
- Positionen steigen, können aber Nummern überspringen. Erwarten Sie nie, dass sie lückenlos sind.
- Ein Ereignis erscheint etwa eine halbe Sekunde nach seiner Änderung im Feed, sobald der Worker es nummeriert hat. Solange der Worker angehalten ist, warten die Ereignisse, und nichts geht verloren.
- Sie sehen die Ereignisse der Repositorys, in denen Ihr Schlüssel oder Konto `artifact.list` hat, dasselbe Recht wie für den [Änderungs-Feed](../api/reference/artifacts#listCatalogChanges). Rechte werden bei jeder Anfrage geprüft, daher verbirgt ein entzogenes Recht die Ereignisse sofort.
- `next` rückt auch über Ereignisse hinweg, die Sie nicht sehen dürfen, höchstens 5000 je Anfrage, sodass ein Schlüssel mit wenigen Rechten nie stehen bleibt. Es verrät nur, dass der Server an diesen Positionen andere Ereignisse hatte.

## Aufbewahrung und Wiederherstellung {#retention}

Der Server bewahrt Ereignisse 168 Stunden und höchstens 5 000 000 davon auf (`ARKVORY_EVENTS_RETENTION_HOURS`, `ARKVORY_EVENTS_MAX_ROWS`, siehe [Umgebungsvariablen](../reference/environment)). Der Feed ist ein Fenster, keine Historie: Die Historie bewahrt das Katalog-Audit. Ereignisse sind nicht Teil von Backups.

| Antwort                                | Was geschah                                                                                      | Was zu tun ist                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `410`, `gone/events_cursor_expired`    | Ihr Cursor ist älter als `oldest`                                                                | Lesen Sie den aktuellen Stand über die API und fahren Sie ab `oldest` fort           |
| `409`, `conflict/events_epoch_changed` | Der Server wurde aus einem Backup wiederhergestellt, seine Positionen begannen eine neue `epoch` | Lesen Sie den aktuellen Stand und fahren Sie ohne Cursor oder ab dem neuen Kopf fort |

Beide Antworten enthalten `events` mit den aktuellen `epoch`, `oldest` und `head`; ein Cursor ist `<epoch>:<position>`. `arkvoryctl events tail` endet mit Exit-Code 6, und das SDK wirft den Fehler mit denselben Feldern.

## Webhooks {#webhooks}

[Webhooks](./webhooks) senden weiterhin den Änderungs-Feed eines Repositorys an eine HTTP-Adresse. Der Ereignis-Feed ersetzt sie nicht.
