---
title: Dateien nach Pfad
description: 'Behalten Sie eine Datei unter einem Pfad mit vollständigem Verlauf, stellen Sie frühere Revisionen wieder her und fügen Sie Labels, Metadaten, Sammlungen und Anhänge hinzu.'
---

# Dateien nach Pfad

Eine Datei nach Pfad ist ein Name in einem Repository, etwa `builds/game/1.4/GameSetup.exe`, der auf eine gespeicherte Datei zeigt. Legen Sie neuen Inhalt unter demselben Pfad ab, zeigt der Pfad auf die neue Datei. Die alte bleibt erhalten, und Sie können zu ihr zurückkehren. Verwenden Sie einen Pfad, wenn Personen und Skripte eine stabile Adresse für „die aktuelle Setup.exe“ brauchen.

## Was ein Pfad ist {#what-it-is}

Jede gespeicherte Datei ist ein unveränderliches **Artefakt** mit einer ID und einem SHA-256. Ein Pfad ist ein Zeiger auf ein Artefakt. Jede Änderung des Zeigers ist eine **Revision**, nummeriert ab 1. Revisionen werden nie gelöscht oder bearbeitet.

Ein Pfad hat 1 bis 1024 Zeichen. Er besteht aus Segmenten, die durch `/` getrennt sind. Ein Segment ist nicht leer, ist nicht `.` oder `..` und enthält keine Steuerzeichen. Ein Pfad darf kein `\` oder `:` enthalten. Groß- und Kleinschreibung ist wichtig.

Ein Pfad und ein Paket sind zwei Sichten auf dieselben Artefakte: Ein UPack-Archiv kann auch einen Pfad haben. Siehe [UPack-Pakete](./packages).

## Eine Datei unter einem Pfad ablegen {#put}

Sie brauchen die Aktionen `upload.create`, `upload.write` und `upload.complete` sowie `asset.read`, `asset.write` und `artifact.read`. Bezogen auf Gruppen brauchen Sie Schreibzugriff. Siehe [Berechtigungen](./accounts#permissions).

### Mit arkvoryctl {#put-cli}

```bash
arkvoryctl put "./Build/Game Setup.exe" builds/game/1.4/GameSetup.exe
arkvoryctl put ./config.json config/settings.json --label test
arkvoryctl get builds/game/1.4/GameSetup.exe ./GameSetup.exe
```

`put` lädt die Datei in Teilen hoch, mit einem Checkpoint neben der Quelldatei, und macht sie zur nächsten Revision des Pfads. Es gibt `path`, `revision`, die Artefakt-`id` und `created` aus. Enthält der Pfad bereits dieselben Bytes, lädt `put` nichts hoch und gibt `created` als `false` aus: Ein wiederholter Build-Schritt kostet nichts. Hat jemand den Pfad während Ihres Uploads geändert, stoppt `put` mit `revision_mismatch` (Exit-Code 6) und überschreibt dessen Arbeit nicht. Lesen Sie den Verlauf und entscheiden Sie. Stoppt ein Upload, führen Sie denselben Befehl erneut aus. Siehe [Uploads und Downloads](./transfers#resume).

`get` lädt die aktuelle Revision mit Fortsetzung und einer SHA-256-Prüfung herunter. Es gibt keinen Befehl zum Auflisten von Pfaden oder zum Lesen des Verlaufs. Verwenden Sie dafür die Konsole oder die API.

### Mit einer einzigen HTTP-Anfrage {#put-http}

Ein rohes `PUT` speichert die Bytes unter dem Pfad in einer Anfrage, wie es `curl -T` tut:

```bash
curl -T ./GameSetup.exe -H "Authorization: Bearer $ARKVORY_KEY" \
  "$ARKVORY/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe"
```

Die Antwort enthält `path`, `revision`, `created` und das `artifact` mit seiner `id`, `size` und `sha256`. Eine neue Revision antwortet mit `201`. Dieselben Bytes erneut antworten mit `200` und `created` false. Zwei Header sind optional: `X-Checksum-Sha256` lässt den Server die Bytes in einem Durchgang prüfen, und `If-None-Match: *` lehnt die Anfrage ab, wenn der Pfad bereits existiert. Eine Anfrage muss innerhalb von 30 Minuten abgeschlossen sein. Verwenden Sie `put` für große Dateien. Siehe [Raw-Dateien](../protocols/raw-files).

### In der Konsole {#put-console}

1. Laden Sie die Datei in [[ui:upload]] hoch. Siehe [Uploads und Downloads](./transfers).
2. Öffnen Sie das Artefakt in [[ui:catalog]] mit [[ui:open]].
3. Geben Sie in [[ui:assetTitle]] den [[ui:assetPath]] ein, zum Beispiel `releases/current.upack`.
4. Geben Sie die [[ui:currentRevision]] ein: `0` für einen neuen Pfad oder die aktuelle Revision, die in [[ui:history]] angezeigt wird.
5. Wählen Sie [[ui:assign]].

Das Revisionsfeld schützt davor, dass zwei Personen einen Pfad gleichzeitig ändern. Ist es nicht die aktuelle, lehnt der Server mit einem Konflikt ab. Laden Sie den Verlauf erneut und versuchen Sie es noch einmal.

### Mit der API und dem SDK {#put-api}

`setAsset` richtet einen Pfad auf ein bereits hochgeladenes Artefakt. `expectedRevision` ist `0`, um den Pfad zu erstellen, andernfalls die aktuelle Revision.

```bash
curl -X PUT "$ARKVORY/api/v1/repositories/releases/asset" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"path":"builds/game/1.4/GameSetup.exe","artifactId":"3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11","expectedRevision":0}'
```

```typescript
const current = await releases.assets.get('builds/game/1.4/GameSetup.exe');
await releases.assets.assign('builds/game/1.4/GameSetup.exe', artifactId, current.revision);
```

Ein Konflikt antwortet mit `409 revision_mismatch`. Wiederholen Sie nicht mit einer geratenen Revision. Lesen Sie nach einer verlorenen Antwort den Pfad: Ist das neue Artefakt bereits da, sind Sie fertig.

## Einen Pfad lesen {#read}

- `arkvoryctl get PATH OUTPUT` lädt die aktuelle Datei herunter.
- `GET /api/v1/repositories/<repository>/raw/<path>` und `GET /api/v1/repositories/<repository>/asset/content?path=<path>` geben die Bytes zurück. Beide brauchen `content.read` und unterstützen Bereiche und den ETag.
- `getAsset` (`GET …/asset?path=`) gibt den Zeiger zurück: `path`, `revision`, `artifactId`.
- `listAssetPage` (`GET …/assets/page?prefix=`) listet Zeiger auf. Seiten enthalten bis zu 100 (standardmäßig 50) in Byte-Reihenfolge des UTF-8-Pfads. Das Präfix ist wörtlich und groß-/kleinschreibungssensitiv. Übergeben Sie `next` als `after`. Das ältere `listAssets` gibt bis zu 1000 zurück und bittet Sie, das Präfix einzugrenzen.

```typescript
const page = await releases.assets.list({ prefix: 'builds/game/', limit: 100 });
```

## Revisionen und Verlauf {#history}

Öffnen Sie in der Konsole [[ui:history]], geben Sie den Pfad in [[ui:assetPath]] ein und wählen Sie [[ui:historyLoad]]. Die Tabelle zeigt die [[ui:revision]], die Zeit ([[ui:date]]), den Autor ([[ui:actor]]) und bei wiederhergestellten Revisionen die Revision, von der sie stammen ([[ui:source]]). Die neueste steht zuerst. [[ui:historyMore]] lädt ältere, je 50. [[ui:open]] in einer Zeile öffnet das Artefakt dieser Revision, von wo aus Sie ihren ursprünglichen Inhalt herunterladen können.

Mit der API gibt `getAssetHistory` (`…/asset/history?path=&before=`) die Seiten zurück, neueste zuerst, und `before` ist die letzte Revision der vorherigen Seite. `getAssetRevision` (`…/asset/revision?path=&revision=`) gibt eine Revision zurück. Autor und Zeit sind leer bei Revisionen, die geschrieben wurden, bevor der Verlauf sie aufzeichnete. Das Lesen braucht `asset.read`.

## Eine frühere Revision wiederherstellen {#restore}

Das Wiederherstellen lässt den Pfad auf das Artefakt einer älteren Revision zeigen. Es kopiert keine Bytes und löscht keine Revision: Die Wiederherstellung ist eine neue, neueste Revision, und der Verlauf zeigt, woher sie stammt.

Laden Sie in der Konsole den Verlauf und wählen Sie die Wiederherstellen-Schaltfläche der gewünschten Revision. Die Schaltfläche der aktuellen Revision ist aus. Das Wiederherstellen braucht `asset.restore`, `asset.read` und `artifact.read`.

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/asset/restore" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"path":"builds/game/1.4/GameSetup.exe","sourceRevision":3,"expectedRevision":5}'
```

```typescript
await releases.assets.restore('builds/game/1.4/GameSetup.exe', 3, 5);
```

`expectedRevision` ist die neueste Revision, die Sie gesehen haben. Hat sich der Pfad zwischenzeitlich geändert, antwortet der Server mit `409 revision_mismatch`; die Konsole zeigt eine Meldung und bittet Sie, den Verlauf neu zu laden. Eine Wiederherstellung bringt keine alten Labels oder Metadaten zurück: Sie bleiben so, wie sie jetzt sind.

## Labels, Metadaten und Sammlungen {#labels}

Jedes Artefakt trägt drei Arten von Notizen. Sie können sie jederzeit ändern. Die Datei selbst ändert sich nie.

| Art        | Beispiel                                       | Regeln                                                                                                                                                      |
| ---------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Labels     | `test`, `staging`, `release`, `linux`          | Bis zu 32. Jedes 1 bis 64 Buchstaben, Ziffern, `_`, `.`, `:` oder `-`. Groß- und Kleinschreibung ist wichtig                                                |
| Metadaten  | `build.number` = `42`, `git.commit` = `abc123` | Bis zu 32 Textfelder. Ein Schlüssel beginnt mit einem Buchstaben und hat bis zu 64 Buchstaben, Ziffern, `_`, `.` oder `-`. Ein Wert hat bis zu 1024 Zeichen |
| Sammlungen | `desktop`, `nightly`                           | Bis zu 32. Dieselben Regeln wie Labels. Sie gruppieren Artefakte, unabhängig von ihrer Version oder ihrem Pfad                                              |

Labels sind freier Text. Sie gewähren keinen Zugriff und verschieben keine Datei. Die Konsole schlägt [[ui:labelPresets]] vor (`nightly`, `test`, `staging`, `release`), aber jedes Label ist gültig, und `relase` wird nicht korrigiert. Für eine Freigabe, auf die sich Deployments verlassen, verwenden Sie eine Stufe ([Stufen und Hochstufung](./promotion)).

**Konsole.** Öffnen Sie das Artefakt in [[ui:metadata]]. Geben Sie [[ui:labels]] und [[ui:collections]] durch Kommas getrennt ein. Verwenden Sie [[ui:metadataAdd]] für ein Feld in [[ui:metadataFields]]: einen [[ui:metadataKey]] und einen [[ui:metadataValue]]. [[ui:metadataJson]] bearbeitet dieselben Daten als JSON. Wählen Sie [[ui:save]].

**arkvoryctl.** Beim Upload fügt `--label test` ein Label hinzu, und `--file metadata.json` liefert `labels` und `metadata`:

```json
{ "labels": ["test"], "metadata": { "build.number": "42", "git.commit": "abc123" } }
```

Um ein vorhandenes Artefakt zu ändern, lesen Sie es und senden Sie dann den vollständigen neuen Zustand mit der Revision, die Sie gelesen haben:

```bash
arkvoryctl annotations get 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl annotations set 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --revision 3 --file annotations.json
```

`annotations.json` muss alle drei Schlüssel haben: `labels`, `metadata` und `collections`. Was Sie weglassen, wird leer. Ein Speichern ersetzt den ganzen Satz. Hat jemand zuerst gespeichert, antwortet der Server mit `409 revision_mismatch`: Lesen Sie erneut und entscheiden Sie. Das SDK wiederholt solche Speicherungen nicht.

```typescript
const current = await releases.annotations.get(id);
await releases.annotations.update(id, current.revision, {
  labels: [...current.labels, 'release'],
  metadata: current.metadata,
  collections: current.collections,
});
```

Zum Lesen brauchen Sie `annotation.read`, zum Schreiben `annotation.write` mit `artifact.read`.

**Suche.** Geben Sie in [[ui:catalog]] Text in [[ui:search]] ein: Er stimmt mit dem Dateinamen und den Metadatenwerten überein, ohne Beachtung der Groß-/Kleinschreibung. [[ui:labelFilter]] zeigt ein einzelnes Label. [[ui:metadataFilter]] stimmt exakt mit einem Schlüssel und einem Wert überein, einschließlich Groß-/Kleinschreibung. Mit `arkvoryctl`:

```bash
arkvoryctl search --query game --label release
arkvoryctl search --collection nightly
arkvoryctl search --metadata-key git.commit --metadata-value abc123
```

`--metadata-key` und `--metadata-value` gehören zusammen. Seiten enthalten bis zu 100 Ergebnisse. Übergeben Sie `next` als `--after`. Die Filter kombinieren sich mit UND.

## Anhänge {#attachments}

Anhänge verknüpfen andere Dateien mit einem Build: ein Manifest, ein SBOM, eine Signatur, einen Bericht oder eine beliebige Datei. Ein Anhang ist ein Name und eine Verknüpfung zu einem anderen Artefakt desselben Repositorys. Der Build und der Anhang bleiben getrennte Dateien.

| Regel        | Wert                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arten        | `manifest`, `sbom`, `signature`, `report`, `file`                                                                                                          |
| Pro Build    | Höchstens 32                                                                                                                                               |
| Name         | 1 bis 240 Zeichen, eindeutig innerhalb des Builds (Groß-/Kleinschreibung ignoriert), kein `/`, `\`, keine Steuerzeichen und keine Leerzeichen an den Enden |
| Beschreibung | Bis zu 512 Zeichen, darf leer sein                                                                                                                         |
| Ziel         | Ein veröffentlichtes Artefakt desselben Repositorys. Nicht der Build selbst                                                                                |

Die Art sagt nur, wofür die Datei gedacht ist. Arkvory prüft keine Signatur, liest kein SBOM und führt kein Manifest aus.

Öffnen Sie in der Konsole das Artefakt. Erweitern Sie unter [[ui:attachmentsTitle]] das Formular [[ui:attachmentAdd]]. Wählen Sie die [[ui:attachmentSource]]: [[ui:attachmentUpload]] sendet eine neue Datei und verknüpft sie, [[ui:attachmentExisting]] verknüpft ein bereits veröffentlichtes Artefakt. Wählen Sie die [[ui:attachmentKind]]: [[ui:attachmentManifest]], [[ui:attachmentSbom]], [[ui:attachmentSignature]], [[ui:attachmentReport]] oder [[ui:attachmentFile]]. Geben Sie einen [[ui:attachmentName]] und, wenn Sie möchten, eine [[ui:attachmentDescription]] an. Wählen Sie dann [[ui:attachmentAdd]]. [[ui:attachmentUnlink]] entfernt eine Verknüpfung und behält die Datei. [[ui:attachmentReload]] liest die Liste erneut. Bricht der Upload eines Anhangs ab, zeigt [[ui:attachmentRecovery]] die Upload-ID, mit der Sie fortfahren können.

Jede Änderung der Liste ist eine nummerierte Version. [[ui:attachmentHistory]] zeigt die früheren, und [[ui:attachmentRestore]] gibt eine davon als neue Version zurück.

Bei `arkvoryctl` enthält die Datei die ganze Liste als JSON-Array:

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

`--revision` ist die Nummer, die Sie mit `get` gelesen haben; ein neuer Build hat `0`. Mit der API nimmt `replaceBuildAttachments` `expectedRevision` und `items`; `getBuildAttachments` und `getBuildAttachmentHistory` lesen. Um einen Anhang herunterzuladen, verwenden Sie die `artifactId` seiner Verknüpfung mit dem normalen Download. Das Lesen braucht `annotation.read`, das Ändern `annotation.write` mit `artifact.read`, und der Upload der Anhangsdatei braucht die Upload-Aktionen.

Anhänge und Pfade wandern bei einer Hochstufung nicht in ein anderes Repository mit. Siehe [Stufen und Hochstufung](./promotion).

## Verwandte Seiten {#related-pages}

- [Raw-Dateien](../protocols/raw-files)
- [Uploads und Downloads](./transfers) und [UPack-Pakete](./packages)
- [Kommandozeile (arkvoryctl)](../protocols/cli)
- API-Referenz: [Dateien nach Pfad](../api/reference/files), [Artefakte und Katalog](../api/reference/artifacts), [Build-Anhänge](../api/reference/attachments)
