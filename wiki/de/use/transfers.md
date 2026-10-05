---
title: Uploads und Downloads
description: 'Senden und holen Sie Dateien beliebiger Größe, fahren Sie nach einer Unterbrechung fort, prüfen Sie Prüfsummen und teilen Sie eine Datei ohne Schlüssel.'
---

# Uploads und Downloads

Dateien beliebiger Größe gehen in Teilen zu Arkvory, und eine Übertragung, die stoppt, kann dort fortfahren, wo sie aufgehört hat. Diese Seite zeigt, wie, in der Konsole, mit `arkvoryctl`, mit dem SDK und mit der HTTP-API.

Ein Upload braucht die Aktionen `upload.create`, `upload.read`, `upload.write` und `upload.complete`. Bezogen auf Gruppen braucht er Schreibzugriff. Ein Download braucht `content.read`. Siehe [Berechtigungen](./accounts#permissions).

## Eine Datei hochladen {#upload}

Jeder Upload macht dieselben Schritte. Der Client berechnet den SHA-256 der ganzen Datei und startet eine Upload-Sitzung mit dem Dateinamen, der Größe und der Prüfsumme. Er sendet die Datei in Teilen. Sind alle Teile da, setzt der Server sie zusammen, prüft die Prüfsumme und veröffentlicht die Datei als unveränderliches Artefakt.

### In der Konsole {#upload-console}

1. Wählen Sie [[ui:upload]] in der Seitenleiste oder [[ui:uploadFile]] in der oberen Leiste.
2. Wählen Sie die Datei unter [[ui:chooseFile]]. Die Konsole liest die ganze Datei einmal, um ihre Prüfsumme zu berechnen ([[ui:hashing]]). Bei einer Datei von mehreren zehn Gigabyte dauert das eine Weile, bevor das erste Byte gesendet wird.
3. Wählen Sie [[ui:startUpload]]. Der Balken unter [[ui:transferTitle]] zeigt den Fortschritt.
4. Ist die Datei veröffentlicht, wird ihre ID angezeigt. Öffnen Sie [[ui:catalog]], um sie zu sehen.

[[ui:pause]] stoppt die Übertragung und behält die angekommenen Teile. Der Browser warnt Sie, bevor Sie die Seite während eines Uploads verlassen. Die Konsole sendet keine Labels oder Metadaten mit der Datei. Fügen Sie sie danach in [[ui:metadata]] hinzu; siehe [Dateien nach Pfad](./files#labels).

### Mit arkvoryctl {#upload-cli}

```bash
arkvoryctl upload ./Build/Game.zip --label test
arkvoryctl upload ./Build/Game.zip --file metadata.json --state ./job-state/game.json
arkvoryctl uploads status 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl uploads cancel 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`upload` gibt das Artefakt aus, wenn es veröffentlicht ist. `--label` fügt ein Label hinzu. `--file` zeigt auf eine JSON-Datei mit `labels` und `metadata` und hat Vorrang. Um die Datei unter einem Pfad abzulegen, verwenden Sie `put`; um ein UPack zu veröffentlichen, verwenden Sie `packages publish`. Siehe [Kommandozeile](../protocols/cli#transfers).

### Mit dem SDK {#upload-sdk}

```typescript
const session = await releases.uploads.create(idempotencyKey, {
  name: 'Game.zip',
  size: String(file.size),
  sha256,
  labels: ['test'],
  metadata: { commit: 'abc123' },
});
const artifact = await releases.uploads.resume(session.id, file, {
  onProgress: (bytes) => console.log(bytes),
});
```

`resume` sendet die Teile, die der Server nicht hat, und schließt den Upload ab. Das vollständige Beispiel mit Hashing in Node.js steht im [TypeScript-SDK](../protocols/sdk#upload-a-large-file-with-resume-node-js).

### Mit der HTTP-API {#upload-http}

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/uploads" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Idempotency-Key: game-1234" \
  -H "Content-Type: application/json" \
  -d '{"name":"Game.zip","size":"73400320","sha256":"<64 hex digits>"}'

curl "$ARKVORY/api/v1/repositories/releases/uploads/$ID/parts" -H "Authorization: Bearer $ARKVORY_KEY"

curl -X PUT "$ARKVORY/api/v1/repositories/releases/uploads/$ID/parts/0" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/octet-stream" \
  -H "X-Content-SHA256: <64 hex digits of this part>" --data-binary @part-0.bin

curl -X POST "$ARKVORY/api/v1/repositories/releases/uploads/$ID/complete" \
  -H "Authorization: Bearer $ARKVORY_KEY"
```

Die Größe ist eine Dezimalzeichenkette. Der `Idempotency-Key` hat 1 bis 128 Buchstaben, Ziffern, `.`, `_`, `:` oder `-`. Die Antwort auf den ersten Aufruf enthält die Upload-`id` und `expiresAt`. Der zweite Aufruf gibt die Teilgröße `partBytes` und die bereits gespeicherten Teile zurück. Jeder Teil hat genau diese Größe außer dem letzten. Die Vorgänge sind `createUpload`, `listUploadParts`, `putUploadPart` und `completeUpload` ([Uploads](../api/reference/uploads)).

Für eine kleine Datei können Sie zwei einfachere Wege nutzen. `PUT /uploads/{id}/content` sendet die ganze Datei in einer Anfrage. `PUT /raw/<path>` erstellt die Sitzung, sendet die Bytes und speichert sie unter einem Pfad in einer Anfrage, wie es `curl -T` tut. Beide Anfragen müssen innerhalb von 30 Minuten abgeschlossen sein. Verwenden Sie Teile für alles Große oder Langsame. Siehe [Raw-Dateien](../protocols/raw-files). Eine leere Datei geht in einer Anfrage.

## Wie groß eine Datei sein kann {#limits}

| Limit                 | Wert                                                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Teilgröße             | 8 MiB für Dateien bis etwa 78 GiB. Größere Dateien verwenden 16, 32, 64 MiB und so weiter, bis 1 GiB, damit eine Datei nie mehr als 10 000 Teile braucht. |
| Teile pro Upload      | 10 000 (Indizes 0 bis 9999)                                                                                                                               |
| Größte Datei          | 10 000 Teile à 1 GiB, etwa 10 TiB                                                                                                                         |
| Niedrigere Obergrenze | Der Administrator kann eine mit `ARKVORY_MAX_OBJECT_BYTES` festlegen                                                                                      |
| Dateiname             | 1 bis 240 Zeichen, kein `/`, `\` und keine Steuerzeichen                                                                                                  |

Der Server wählt die Teilgröße beim Erstellen des Uploads und behält sie für den ganzen Upload. `GET /api/v1/capabilities` zeigt `maxObjectBytes`, `partBytes`, `maxPartBytes` und `maxParts`. Die Konsole lehnt eine Datei über dem Serverlimit ab, bevor sie beginnt.

Ein Client hält einen Teil im Speicher, während er ihn hasht und sendet. Bei Dateien über 78 GiB wächst der Teil und damit der Speicher bis auf 1 GiB.

Der freie Speicherplatz auf dem Server muss die Teile und die zusammengesetzte Datei eine Zeit lang aufnehmen. Ist der Datenträger voll, lehnt der Server den Upload mit `507 storage_full` ab.

## Einen Upload fortsetzen {#resume}

Eine Upload-Sitzung behält ihre Teile nach einem Fehler. Geben Sie dem Client zum Fortsetzen dieselbe Datei und dieselbe Sitzung.

**Konsole.** Wählen Sie im geöffneten Tab nach [[ui:pause]] erneut [[ui:startUpload]]. Behalten Sie nach dem Schließen des Tabs die Upload-ID. Erweitern Sie [[ui:resumeTitle]]: Das Feld [[ui:uploadId]] zeigt die ID, während der Upload läuft. Wählen Sie später dieselbe Datei, geben Sie die ID dort ein und wählen Sie [[ui:startUpload]]. Die Konsole vergleicht die Teile mit Ihrer Datei. Weicht die Datei ab, stoppt sie und sagt es Ihnen. [[ui:newUpload]] leert beide Felder und startet einen neuen Upload.

Das Feld [[ui:idempotency]] ist ein zweiter Weg zurück. Die Konsole füllt es selbst. Derselbe Schlüssel mit derselben Datei gibt dieselbe Sitzung statt einer zweiten zurück.

**arkvoryctl.** Führen Sie denselben Befehl mit denselben Optionen aus. Der Client hat vor der ersten Anfrage einen Checkpoint `<file>.arkvory-upload.json` neben der Quelldatei oder die mit `--state` angegebene Datei gespeichert. Um dieselben Bytes als neues Artefakt zu veröffentlichen, verwenden Sie ein neues `--state`. Behalten Sie in CI die Quelldatei und den Zustandsordner zwischen den Wiederholungen. Eine Änderung der Datei, des Servers, des Repositorys oder der Optionen ergibt `checkpoint_mismatch` (Exit-Code 6).

**SDK.** Rufen Sie `resume` erneut mit der gespeicherten Sitzungs-ID und derselben Datei auf. Um sich zu erholen, wenn sogar die Antwort auf `create` verloren ging, rufen Sie `create` mit demselben Idempotenzschlüssel und demselben Deskriptor auf: Es gibt dieselbe Sitzung zurück.

**HTTP.** Lesen Sie die gespeicherten Teile mit `listUploadParts` und senden Sie dann die fehlenden Indizes. Einen Teil erneut mit denselben Bytes zu senden ist sicher. Andere Bytes für einen gespeicherten Index werden mit `409 upload_state` abgelehnt.

Die Clients wiederholen eine Anfrage auch selbst nach einem Netzwerkfehler oder nach `408`, `429`, `502`, `503` und `504`: bis zu 20 Mal für einen Vorgang, mit einer Pause, die von 0,5 auf 60 Sekunden wächst und `Retry-After` beachtet. `arkvoryctl` hat die Optionen `--retries` und `--attempt-timeout` für langsame Verbindungen.

Nur das Konto oder der Schlüssel, der einen Upload erstellt hat, kann ihn fortsetzen. Für jeden anderen existiert er nicht. Das Rotieren eines Dienstschlüssels behält das Konto, daher setzt der neue Schlüssel den Upload fort.

## Prüfsummen {#checksums}

- **Vor dem Upload.** Die Konsole, die CLI und das SDK berechnen den SHA-256 der Datei und senden ihn in der Sitzung.
- **Jeder Teil.** Der Header `X-Content-SHA256` enthält die Prüfsumme des Teils. Ein Teil, dessen Bytes nicht übereinstimmen, wird mit `422 integrity_mismatch` abgelehnt und nicht gespeichert.
- **Am Ende.** Der Server prüft die Größe und den SHA-256 der zusammengesetzten Datei gegen die Sitzung, bevor er veröffentlicht. Eine Abweichung ist `422 integrity_mismatch`; die CLI beendet mit Code 5. Das Artefakt erscheint nicht.
- **Downloads.** Die Konsole, die CLI und das SDK prüfen den SHA-256 der ganzen Datei, bevor sie sie herausgeben. Die endgültige Datei erscheint erst, nachdem die Prüfung bestanden ist.

Der ETag einer Datei ist ihre Prüfsumme: `"sha256:<64 hex digits>"`. Die Artefaktdetails zeigen den SHA-256, und [[ui:copyHash]] kopiert ihn.

## Abschlussauftrag {#completion}

Das Zusammensetzen einer großen Datei dauert. Bei Dateien unter 16 GiB setzt `completeUpload` sie innerhalb der Anfrage zusammen, was bis zu 30 Minuten dauern kann. Ab 16 GiB bitten das SDK und damit die Konsole und die CLI den Worker, sie fertigzustellen: `enqueueCompletion` antwortet mit `202` und einem Auftrag, und der Client fragt `getCompletionJob` ab, bis der Zustand `completed` oder `failed` ist. Ein fehlgeschlagener Auftrag hat einen Fehlercode, zum Beispiel `integrity_mismatch`.

Der Worker-Dienst muss für Aufträge laufen. Er versucht einen Auftrag bis zu 5 Mal, mit wachsender Pause, und gibt bei Fehlern, die eine Wiederholung nicht beheben kann, sofort auf. Ein wiederholtes `enqueueCompletion` gibt denselben Auftrag zurück. Startet der Server neu, läuft der Auftrag weiter. Sie müssen den Upload nicht erneut starten.

## Ablauf von Uploads {#expiry}

Eine unfertige Upload-Sitzung läuft 7 Tage nach ihrer Erstellung ab. Die Zeit steht in `expiresAt`, wird nicht verlängert und verschiebt sich nicht, wenn Sie Teile senden. Danach werden Teile und `complete` mit `409 upload_expired` abgelehnt. Starten Sie einen neuen Upload. Veröffentlichte Dateien laufen nie ab.

Der Server entfernt abgelaufene Sitzungen und ihre Teile im Hintergrund. Um eine früher aufzugeben, verwenden Sie `arkvoryctl uploads cancel ID` oder `cancelUpload`. Abbrechen ist kein Pausieren: Die Teile werden verworfen.

## Eine Datei herunterladen {#download}

### In der Konsole {#download-console}

Wählen Sie [[ui:download]] neben einer Datei in [[ui:catalog]] oder in den Artefaktdetails. Der Browser fragt, wo die Datei gespeichert werden soll. Die Datei geht in die Warteschlange in [[ui:downloads]]. Die Warteschlange schreibt die Daten in eine temporäre Kopie, prüft den SHA-256 und ersetzt erst dann die Zieldatei.

Die Warteschlange braucht Chrome oder Edge unter HTTPS oder auf dem lokalen Rechner, weil sie eine große Datei über den Dateisystemzugriff des Browsers schreibt. Andere Browser sollten die CLI oder das SDK verwenden.

Die Zustände eines Downloads sind [[ui:downloadQueued]], [[ui:downloadRunning]], [[ui:downloadRetrying]], [[ui:downloadPaused]], [[ui:downloadSaving]], [[ui:downloadCompleted]], [[ui:downloadFailed]] und [[ui:downloadCancelled]]. Die Schaltflächen sind:

| Schaltfläche                                   | Wirkung                                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| [[ui:downloadResume]]                          | Ein pausiertes oder fehlgeschlagenes Download ab dem gespeicherten Teil fortsetzen |
| [[ui:downloadCancel]]                          | Einen Download abbrechen und seine temporäre Kopie löschen                         |
| [[ui:downloadsPause]] / [[ui:downloadsResume]] | Die ganze Warteschlange anhalten und freigeben                                     |
| [[ui:downloadsClearWaiting]]                   | Die wartenden Downloads abbrechen                                                  |
| [[ui:downloadsCancel]]                         | Alle Downloads abbrechen                                                           |
| [[ui:downloadsClearFinished]]                  | Fertige Zeilen entfernen, um Platz zu schaffen (die Warteschlange fasst 64)        |
| [[ui:downloadRestore]]                         | Nach einem Neuladen der Seite die unfertigen Downloads zurückbringen               |

[[ui:downloadSettings]] hat [[ui:downloadConcurrency]] (1 bis 8, Standard 2), [[ui:downloadInterval]] (0 bis 60 000 ms, Standard 250) und [[ui:downloadWait]] (1 bis 1800 Sekunden, Standard 300). Wählen Sie [[ui:downloadApply]], um sie zu verwenden. Sie erhöhen nicht die Limits des Servers.

Melden Sie sich nach einem Neuladen oder einem geschlossenen Tab erneut beim selben Server als dasselbe Konto an, öffnen Sie [[ui:downloads]] und wählen Sie [[ui:downloadRestore]]. Die wiederhergestellten Downloads warten pausiert. Wählen Sie bei jedem [[ui:downloadResume]] und wählen Sie die Zieldatei erneut. Der Browser braucht freien Platz für die temporäre Kopie.

### Mit arkvoryctl {#download-cli}

```bash
arkvoryctl download 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game.zip
arkvoryctl get builds/game/1.4/Game.zip ./Game.zip
arkvoryctl packages download app ./app.upack --range ^1.4 --stage release
```

Während ein Download läuft, bleiben `<output>.arkvory-part` und `<output>.arkvory-download.json` neben dem Ziel. Führen Sie denselben Befehl nach einer Unterbrechung erneut aus. Die endgültige Datei erscheint erst nach der SHA-256-Prüfung. Ein vorhandenes Ziel wird nie überschrieben (`destination_exists`, Exit-Code 6).

### Mit HTTP: Bereiche und ETag {#download-http}

`downloadArtifact` gibt die Bytes eines Artefakts zurück. `HEAD` gibt nur die Header zurück.

```bash
curl -fL -H "Authorization: Bearer $ARKVORY_KEY" -C - -o Game.zip \
  "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/content"
```

- `Accept-Ranges: bytes`. Senden Sie `Range: bytes=1048576-`, `bytes=0-1023` oder `bytes=-500` für einen Bereich. Die Antwort ist `206` mit `Content-Range`. Mehrere Bereiche auf einmal werden nicht unterstützt: Der Server sendet die ganze Datei. Ein Start hinter dem Ende ergibt `416`.
- `ETag` ist `"sha256:<hex>"`. `If-None-Match` damit ergibt `304`. `If-Range` damit setzt einen Bereich nur fort, wenn die Datei noch dieselbe ist; andernfalls kommt die ganze Datei.
- `curl -C -` setzt einen Download fort. Adressen nach Namen lösen bei jeder Anfrage auf, zum Beispiel `packages/content?name=app&range=^1.4`, daher kann sich die Datei zwischen zwei Aufrufen ändern. Um sie sicher fortzusetzen, senden Sie den ETag, den Sie erhalten haben, in `If-Range`, oder lösen Sie den Namen zuerst auf und laden Sie über die Artefakt-ID herunter.

Das SDK liest den Inhalt in 8-MiB-Bereichen und prüft jeden einzelnen. Siehe [TypeScript-SDK](../protocols/sdk#download-with-verification).

## Links für Personen ohne Schlüssel {#links}

Ein Download-Link lässt jemanden eine Datei ohne jeden Schlüssel abrufen: einen Tester, einen Kunden, einen Build-Rechner ohne Anmeldedaten. Der Link öffnet nur dieses Artefakt, für `GET` und `HEAD`, bis er abläuft. Er funktioniert mit `curl -C -` und mit Bereichen.

Öffnen Sie in der Konsole das Artefakt in [[ui:metadata]] und wählen Sie [[ui:downloadLink]]. Die Konsole kopiert den Link und zeigt ihn mit seinem Ablauf an. Der Link hält eine Stunde. Die Schaltfläche erscheint nur, wenn Sie die Datei herunterladen dürfen.

```bash
arkvoryctl link 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --ttl 900
```

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/links" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"ttlSeconds":900}'
```

Die Lebensdauer beträgt 60 Sekunden bis 24 Stunden (86 400 Sekunden) und standardmäßig eine Stunde. Die Antwort enthält ein `token`, das mit `dtl_` beginnt, eine `url` und `expiresAt`. Die CLI und das SDK geben eine vollständige URL aus. Die API gibt den Pfad zurück, den Sie an die Serveradresse anhängen.

Der Link ist ein Geheimnis. Wer ihn hat, kann die Datei herunterladen. Sie können einen Link nicht vor seinem Ablauf widerrufen, machen Sie ihn also kurz. Behandeln Sie die URL wie einen Schlüssel: Halten Sie sie aus Chaträumen und öffentlichen Protokollen heraus. Proxy-Protokolle und Browser-Verlauf können sie aufzeichnen. Siehe [Download-Links](../api/reference/links).

## Limits und Warteschlangen {#queues}

Der Administrator legt fest, wie viele Übertragungen der Server gleichzeitig und wie schnell ausführt. Standardmäßig führt ein Server 2 Uploads und 16 Downloads gleichzeitig aus, und ein Konto 1 Upload und 4 Downloads. Mehr warten in einer Warteschlange bis zu 20 Sekunden. Ist die Warteschlange voll oder endet die Wartezeit, antwortet der Server mit `503` und `Retry-After`, und die Clients warten und wiederholen. Ein Budget in Byte pro Sekunde macht Übertragungen langsamer, stoppt sie aber nicht. Benutzer können diese Budgets nicht sehen oder ändern. Die Werte stehen in [Umgebungsvariablen](../reference/environment#transfers-and-bandwidth).

## Fehler {#errors}

| Antwort                    | Grund                                                                                                | Was zu tun ist                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `409 upload_expired`       | Die Sitzung ist älter als 7 Tage                                                                     | Starten Sie einen neuen Upload                                                    |
| `409 upload_state`         | Der Upload ist bereits veröffentlicht oder abgebrochen, oder ein gespeicherter Teil hat andere Bytes | Starten Sie einen neuen Upload oder prüfen Sie, dass Sie dieselbe Datei verwenden |
| `409 parts_incomplete`     | Einige Teile sind nicht angekommen                                                                   | Setzen Sie den Upload fort                                                        |
| `409 part_mismatch`        | Die Teile passen nicht zur geplanten Teilgröße oder den Indizes                                      | Nehmen Sie die Teilgröße aus `listUploadParts` und setzen Sie fort                |
| `409 idempotency_mismatch` | Der Schlüssel wurde für eine andere Datei verwendet                                                  | Verwenden Sie einen neuen Schlüssel                                               |
| `422 integrity_mismatch`   | Eine Prüfsumme stimmt nicht überein                                                                  | Senden Sie die Originaldatei erneut                                               |
| `507 storage_quota`        | Das Kontingent des Repositorys ist aufgebraucht                                                      | Löschen Sie alte Builds oder bitten Sie um ein größeres Kontingent                |
| `507 storage_full`         | Der Server-Datenträger ist voll                                                                      | Rufen Sie den Administrator                                                       |
| `503` mit `Retry-After`    | Der Server ist ausgelastet                                                                           | Warten Sie, die Clients wiederholen selbst                                        |

Die vollständige Liste steht in [Fehler](../api/errors).

## Verwandte Seiten {#related-pages}

- [Kommandozeile (arkvoryctl)](../protocols/cli) und [TypeScript-SDK](../protocols/sdk)
- [Dateien nach Pfad](./files) und [Pakete](./packages)
- API-Referenz: [Uploads](../api/reference/uploads), [Download-Links](../api/reference/links), [Artefakte](../api/reference/artifacts)
