---
title: 'HTTP-API-Übersicht'
description: 'Die Regeln, die jede Integration mit der Arkvory HTTP-API braucht: JSON und Größen, Erkundung, Seitennummerierung, Revisionen, Idempotenz, Wiederholungen, Bereichsanfragen, Fehler und Grenzen.'
---

# HTTP-API-Übersicht

Die HTTP-API ist die Schnittstelle, die die Webkonsole, der Kommandozeilen-Client und das SDK verwenden. Alles, was sie tun, kann Ihre Integration in jeder Sprache tun. Diese Seite erklärt die Regeln, die für jeden Vorgang gelten. Die Seiten unter [Referenzseiten](#reference-pages) listen jeden Vorgang mit seiner Zugriffsregel, Wiederholungsregel, seinen Parametern und Antworten auf, und sie werden aus dem Vertrag erzeugt, den der Server durchsetzt.

## Grundlagen {#basics}

- **Basispfad.** Jeder Vorgang liegt unter `/api/v1`, zum Beispiel `https://arkvory.example/api/v1/repositories`. Die einzigen Ausnahmen sind die Health-Checks unter `/health`.
- **Format.** Anfragen und Antworten sind JSON (`application/json`). Ein JSON-Body ist auf 64 KiB begrenzt, und eine Anfrage, die für einen JSON-Vorgang einen anderen Inhaltstyp sendet, erhält `415`. Dateibytes werden als `application/octet-stream` gesendet.
- **Unbekannte Felder.** Die meisten Vorgänge lehnen eine Anfrage ab, die ein Feld enthält, das sie nicht definieren (`400`, mit dem Feld in `details`). In Antworten ignorieren Sie Felder, die Sie nicht kennen.
- **Zeiten** sind RFC-3339-Zeitstempel in UTC. **IDs** von Artefakten, Uploads, Aufträgen, Konten und Schlüsseln sind UUIDs.
- **Namen.** Ein Repository-Name entspricht `[a-z0-9][a-z0-9_-]{0,63}`. Ein Dateiname (der Artefaktname) hat bis zu 240 Zeichen und kein `/` oder `\`. Ein Pfad in einem Repository hat bis zu 1.024 Zeichen.
- **Caching.** Antworten tragen `Cache-Control: private, no-store`.
- **Andere Protokolle.** Die Routen `/v2` (Container), `/lfs` (Git LFS) und `/npm` folgen den Spezifikationen ihrer eigenen Clients und verwenden ihre eigenen Fehlerformate. Sie sind nicht Teil des OpenAPI-Dokuments. Siehe [Clients und Protokolle](../protocols/index).

### Größen und Anzahlen {#sizes}

Eine JSON-Zahl kann nicht jeden 64-Bit-Wert tragen. Arkvory sendet **Größen und Byte-Zähler daher als Dezimalzeichenketten**: `"size": "1048576"`. Dasselbe gilt für die Größe, die Sie beim Anlegen eines Uploads angeben. Eine Größe hat kein Vorzeichen, keine führenden Nullen und höchstens 16 Ziffern. Anzahlen, Revisionen, Grenzen und Teil-Indizes sind gewöhnliche JSON-Ganzzahlen.

Das größte Objekt ist 10.000 GiB (10 737 418 240 000 Byte), es sei denn, der Administrator setzt ein niedrigeres `ARKVORY_MAX_OBJECT_BYTES`. Eine größere angegebene Größe wird mit `400` abgelehnt.

## Authentifizierung {#authentication}

Jeder Vorgang außer der Anmeldung, den öffentlichen Health-Checks und den Anmeldeoptionen benötigt Anmeldedaten im Header `Authorization: Bearer <credential>`. Die Anmeldedaten sind eine Konsolensitzung, ein persönliches Zugriffstoken, ein Dienstschlüssel oder der Wiederherstellungsschlüssel. Was Anmeldedaten tun dürfen, hängt von ihrer Art und von der **Zugriffsregel** jedes Vorgangs ab. Lesen Sie [Authentifizierung](./authentication), bevor Sie die Integration entwerfen, und geben Sie der Automatisierung einen Dienstschlüssel mit nur den Aktionen, die sie braucht.

## Erkundung {#discovery}

Ein Client kann den Server fragen, was er unterstützt, statt zu raten. All dies benötigt Anmeldedaten.

| Anfrage                        | Antwort                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/capabilities`     | Die API-Versionen (`v1`), die Gateway-Rolle (`api` oder `reader`), die Feature-Flags und die Grenzen dieses Servers: `maxObjectBytes`, `partBytes` (der kleinste Teil, 8 MiB), `maxPartBytes` (1 GiB), `maxParts` (10.000) und `maxPageSize` (100).                                                                                                                  |
| `GET /api/v1/operations`       | Die Vorgänge, die diese Anmeldedaten wahrscheinlich aufrufen dürfen, jeweils mit ihrer `operationId`, Methode, Pfad, `surface`, `retry`-Klasse, erforderlichen Aktionen und verbleibenden Bedingungen. Filtern Sie mit `repository`, `surface`, `after` und `limit` (1 bis 100, standardmäßig 50). Die Liste ist beratend: nur die tatsächliche Anfrage entscheidet. |
| `GET /api/v1/openapi.json`     | Das OpenAPI-3.0.3-Dokument der Writer-API. Fügen Sie `?surface=<name>` hinzu, um nur eine Oberfläche zu erhalten.                                                                                                                                                                                                                                                    |
| `GET /api/v1/auth/permissions` | Die Aktionen der aufrufenden Anmeldedaten pro Repository.                                                                                                                                                                                                                                                                                                            |
| `GET /api/v1/auth/me`          | Wer die Anmeldedaten sind, ihre Art und ihre groben `read`/`write`-Gewährungen.                                                                                                                                                                                                                                                                                      |
| `GET /api/v1/repositories`     | Die Repositorys, die die Anmeldedaten sehen dürfen.                                                                                                                                                                                                                                                                                                                  |

Verwenden Sie `capabilities`, um Grenzen zu lesen, anstatt sie fest zu kodieren. Behandeln Sie ein Feature-Flag, das Sie nicht kennen, als `false`.

### Oberflächen {#surfaces}

Vorgänge sind in sechs **Oberflächen** gruppiert. Sie sind Bezeichnungen des Vertrags, keine getrennten Dienste; die URLs ändern sich nicht.

| Oberfläche       | Was sie abdeckt                                                                  |
| ---------------- | -------------------------------------------------------------------------------- |
| `discovery`      | Fähigkeiten, der Vorgangskatalog, OpenAPI und Repositorys                        |
| `identity`       | Anmeldung, die eigene Identität des Aufrufers, Token und Schlüsselaktivierung    |
| `catalog`        | Artefakte, Annotationen, Pakete, Dateien nach Pfad, Stufen, Hochstufung, Anhänge |
| `transfers`      | Upload-Sitzungen, Teile, Abschlussaufträge und Downloads                         |
| `administration` | Konten, Gruppen, Dienstkonten, Schlüssel, Delegierungen, Updates und Backups     |
| `operations`     | Liveness, Bereitschaft, Metriken und Feedback                                    |

Die Health-Checks sind `GET /health/live` (der Prozess läuft) und `GET /health/status` (öffentlich; `{"status":"ready"}` oder `unavailable`) ohne Anmeldedaten, sowie `GET /health/ready` und `GET /health/metrics` mit Anmeldedaten. Sie verbrauchen das Anfragebudget nicht, damit Last einen Load Balancer nicht dazu bringt, den Server zu entfernen.

## Seitennummerierung {#pagination}

Eine Liste wird Seite für Seite zurückgegeben. Die Antwort enthält `items` und `next`. Wenn `next` nicht `null` ist, senden Sie es unverändert im Query-Parameter `after` zurück, um die nächste Seite zu lesen; wenn es `null` ist, ist die Liste vollständig. Behandeln Sie einen Cursor als undurchsichtige Zeichenkette und bauen Sie keinen selbst.

`limit` legt die Seitengröße fest, von 1 bis 100. Die meisten Listen geben 50 Einträge zurück, wenn Sie es weglassen. Seiten sind keine Momentaufnahme: Einträge, die während des Lesens eintreffen, können erscheinen oder nicht. Filter und Sortierreihenfolge müssen gleich bleiben, während Sie `next` folgen.

## Revisionen und Compare-and-Swap {#revisions}

Dinge, die Menschen bearbeiten, haben eine **Revision**, die ab 1 hochzählt: die Labels, Metadaten und Sammlungen eines Artefakts, die Anhänge eines Builds, ein Dateipfad, eine Speicherrichtlinie, der Backup-Plan und die Einstellungen eines Dienstkontos. Eine Änderung nennt die Revision, die sie erwartet, im Anfrage-Body als `expectedRevision`:

```json
{ "expectedRevision": 3, "value": { "labels": ["tested"], "metadata": {}, "collections": [] } }
```

Wenn die aktuelle Revision nicht 3 ist, ändert sich nichts, und der Server antwortet `409` mit dem Grund `revision_mismatch`. Das ist **Compare-and-Swap**. Lesen Sie den Zustand erneut, wenden Sie Ihre Änderung darauf an und senden Sie die neue Revision. Wiederholen Sie niemals in einer Schleife mit einer größeren Zahl, um die Schreibung zu erzwingen. Verwenden Sie `0` für etwas, das noch nicht existiert, etwa einen neuen Pfad. Die API verwendet nicht den Header `If-Match`.

Ein **heruntergeladenes Artefakt** hat einen anderen Validator, das `ETag`. Siehe [Bereichs-Downloads und ETags](#range-downloads).

## Idempotenzschlüssel {#idempotency}

Ein Header `Idempotency-Key` bewirkt, dass eine wiederholte Anfrage nur einmal wirkt. Verwenden Sie einen Wert aus 1 bis 128 Zeichen aus Buchstaben, Ziffern und `_ . : -`, und bewahren Sie ihn zusammen mit dem Auftragszustand vor der ersten Anfrage auf, damit ein neu gestarteter Auftrag denselben Schlüssel wiederholt. Diese Schreibvorgänge benötigen einen:

| Vorgang                                                             | Eine Wiederholung mit demselben Schlüssel und demselben Body                                                                                                                 |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createUpload`                                                      | Gibt dieselbe Upload-Sitzung zurück.                                                                                                                                         |
| `issueServiceKey` und `rotateServiceKey`                            | Gibt die Metadaten des Schlüssels mit `200` zurück, ohne das Geheimnis. Widerrufen Sie den Schlüssel und geben Sie einen anderen aus, wenn Sie das Geheimnis verloren haben. |
| `requestBackupRun`, `requestBackupVerify`, `requestBackupRetention` | Gibt dieselbe Anfrage zurück, anstatt eine weitere einzureihen.                                                                                                              |

Derselbe Schlüssel mit einem anderen Body wird mit `409` und dem Grund `idempotency_mismatch` abgelehnt. Ein Schlüssel ist auf den Aufrufer und das Ziel begrenzt, sodass zwei Aufrufer denselben Wert verwenden können.

Andere Schreibvorgänge sind aus einem anderen Grund sicher zu wiederholen: Sie setzen einen Zustand (eine Stufe setzen, ein Paket registrieren, einen Schlüssel widerrufen) oder sie sind Compare-and-Swap. Der nächste Abschnitt sagt Ihnen, welche.

## Wiederholungsregeln {#retry-rules}

Jeder Vorgang hat eine **Wiederholungsklasse**. Die Klasse sagt einem Client, was zu tun ist, wenn er die Antwort nicht erhalten hat. Die Referenz zeigt sie als „Retry“ bei jedem Vorgang.

| Klasse             | Bedeutung                                              | Was zu tun ist                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `read`             | Lesen ändert nichts.                                   | Mit Backoff wiederholen.                                                                                                                                                                                     |
| `idempotent`       | Dieselbe Anfrage hat dieselbe Wirkung.                 | Wiederholen. Eine Antwort kann im Detail abweichen: zweimaliges Löschen kann melden, dass das Objekt weg ist.                                                                                                |
| `idempotency-key`  | Nur mit einem Schlüssel sicher.                        | Mit demselben `Idempotency-Key` und demselben Body wiederholen.                                                                                                                                              |
| `compare-and-swap` | Eine Änderung, die von einer Revision abhängt.         | Lesen Sie den Zustand, entscheiden Sie erneut und wiederholen Sie mit der Revision, die Sie gelesen haben. Erhöhen Sie niemals `expectedRevision`, um einen `409` zu passieren.                              |
| `reconcile-upload` | Ein Schritt einer Upload-Sitzung.                      | Lesen Sie zuerst den Upload und seine Teile (`getUpload`, `listUploadParts`) und senden Sie dann, was fehlt. Ein `PUT` der ganzen Datei kann nicht in der Mitte fortsetzen: Es beginnt wieder bei Byte null. |
| `reconcile-job`    | Einreihen eines Abschlussauftrags.                     | Lesen Sie zuerst den Auftrag (`getCompletionJob`). Ein fehlgeschlagener Auftrag kann erneut eingereiht werden.                                                                                               |
| `never-automatic`  | Eine Wiederholung könnte die Aktion zweimal ausführen. | Nicht automatisch wiederholen. Prüfen Sie das Ergebnis und entscheiden Sie dann. Beispiele: ein Konto, ein Token oder einen Download-Link anlegen, eine Speicherrichtlinie ausführen, Feedback senden.       |

Ein Netzwerkfehler und die Statuscodes `408`, `429`, `502`, `503` und `504` sind vorübergehend: Wiederholen Sie gemäß der Klasse, warten Sie mindestens so lange wie `Retry-After` und fügen Sie exponentiellen Backoff mit einer Begrenzung der Versuche hinzu. Wiederholen Sie `401`, `403` und andere `4xx`-Antworten nicht, ohne die Anfrage zu ändern. Wiederholen Sie `500` nicht blind; geben Sie die Anfrage-ID an den Support. Nach einem `503` bei einer Änderung ist das Ergebnis unbekannt; verwenden Sie daher die Klasse, um herauszufinden, was passiert ist. Das SDK und der Kommandozeilen-Client wenden diese Regeln an.

## Bereichs-Downloads und ETags {#range-downloads}

`GET` und `HEAD` von `…/artifacts/{id}/content` geben die Originalbytes mit einem starken `ETag` der Form `"sha256:<hex>"` und `Accept-Ranges: bytes` zurück. Dasselbe gilt für die Downloads nach Paket (`…/packages/content`) und nach Dateipfad (`…/asset/content`, `…/raw/{path}`). Sie schlagen das aktuelle Artefakt bei jeder Anfrage nach; `packages/content` und `raw` nennen das gewählte in `X-Arkvory-Artifact-Id`, sodass Sie es für eine Fortsetzung anheften können.

- `Range: bytes=0-1023`, `bytes=1024-` und `bytes=-1024` geben `206` mit `Content-Range` zurück. Der Server bedient einen Bereich; eine Liste von Bereichen wird mit der ganzen Datei beantwortet.
- Ein Start jenseits des Dateiendes gibt `416` mit dem Code `invalid_input`, dem Grund `range_not_satisfiable` und `Content-Range: bytes */<size>` zurück.
- Um fortzusetzen, senden Sie `Range` zusammen mit `If-Range: "<das ETag, das Sie gesehen haben>"`. Wenn sich der Inhalt hinter einem Namen geändert hat, unterscheidet sich das `ETag`, und Sie erhalten die ganze neue Datei statt einer gemischten.
- `If-None-Match` mit dem `ETag` gibt `304` ohne Body zurück.
- Prüfen Sie den SHA-256 dessen, was Sie gespeichert haben. Das ETag trägt ihn.

Ein Download-Link (`?token=`) funktioniert auf der Inhaltsroute eines Artefakts. Siehe [Authentifizierung](./authentication#download-links).

## Fehler {#errors}

Jeder Fehler hat dieselbe JSON-Hülle: `code`, `message`, `requestId` und, wenn es mehr zu sagen gibt, `reason`, `details` und `retryAfterSeconds`. Entscheiden Sie nach `code` und `reason`, niemals nach der `message`. Unbekannte Gründe zählen als abwesend, und ein unbekannter `code` wird nach seinem HTTP-Status behandelt. Siehe [Fehler](./errors).

## Ratenlimits und ausgelastete Server {#rate-limits}

Arkvory misst API-Aufrufe nicht pro Minute. Es begrenzt, wie viel es gleichzeitig tut, und es begrenzt Versuche, ein Passwort zu erraten:

- **Ausgelastet.** Der Server lässt eine feste Anzahl von Anfragen und Übertragungen gleichzeitig zu (`ARKVORY_MAX_REQUESTS`, standardmäßig 128; 2 Uploads und 16 Downloads standardmäßig). Eine Übertragung kann bis zu 20 Sekunden in einer begrenzten Warteschlange warten. Wenn kein Platz ist, ist die Antwort `503` mit dem Code `busy`. Wiederholen Sie nach `Retry-After`.
- **Kapazität.** Eine volle Datenträgerreserve, ein Kontingent oder eine Begrenzung der Objektanzahl gibt `507` zurück, was sich durch Warten nicht verbessert.
- **Versuche.** Zu viele Anmelde-, Registrierungs-, Passwort- oder Feedback-Versuche geben `429` mit dem Code `rate_limited` zurück. Siehe [Authentifizierung](./authentication#sign-in-limits).

Sowohl `429` als auch `503` tragen den Header `Retry-After` in Sekunden (2, wenn der Server keine Schätzung hat) und dieselbe Zahl in `retryAfterSeconds`. Wenn eine Anfrage über einen Proxy läuft, kann der Proxy eigene Grenzen hinzufügen.

## Anfrage-IDs {#request-ids}

Jede Antwort hat einen Header `X-Request-Id`, und jeder Fehler hat denselben Wert in `requestId`. Protokollieren Sie ihn mit Ihrem eigenen Auftrag und nennen Sie ihn dem Support. Eine Anfrage-ID, die Sie senden, wird nur verwendet, wenn sie über einen in `ARKVORY_TRUSTED_PROXIES` aufgeführten Proxy eintrifft und 8 bis 128 sichere Zeichen hat; andernfalls erstellt der Server eine neue. Ein W3C-Header `traceparent` wird nur im Zugriffsprotokoll des Servers aufgezeichnet.

## Browser und CORS {#cors}

Eine Webseite unter derselben Adresse wie Arkvory funktioniert ohne jede Einstellung. Eine Seite unter einer anderen Adresse funktioniert nur, wenn der Administrator ihren exakten Ursprung in `ARKVORY_CORS_ORIGINS` aufführt (bis zu 16, HTTPS oder Loopback-HTTP). Ein anderer Ursprung erhält `403` mit dem Grund `origin_not_allowed`, selbst wenn der Schlüssel gültig ist. Anfragen verwenden niemals Cookies: Senden Sie den Schlüssel im Header `Authorization` und behalten Sie ihn im Speicher. Siehe [Umgebungsvariablen](../reference/environment).

## Kompatibilitätsversprechen {#evolution}

`/api/v1` ändert sich nur durch Hinzufügung: neue Vorgänge, neue optionale Anfragefelder, neue Antwortfelder, neue Fehlergründe und neue Feature-Flags. Eine Änderung, die einen Client brechen würde, etwa eine andere Bedeutung, ein neues erforderliches Feld, ein anderer Status oder eine andere Seitennummerierung, erhält eine neue Version der API und einen Zeitraum, in dem beide funktionieren. Im Gegenzug muss Ihr Client:

- Antwortfelder ignorieren, die er nicht kennt;
- einen unbekannten `reason` als abwesend und einen unbekannten `code` nach seinem HTTP-Status behandeln;
- Grenzen aus `capabilities` nehmen;
- nur die Felder senden, die der Vorgang definiert.

Die `operationId`-Werte sind stabile Namen. Verwenden Sie sie, wenn Sie Vorgänge Ihrem eigenen Code zuordnen.

## Beispiel: eine Datei hochladen und herunterladen {#example}

Diese Sequenz lädt eine Datei in einer Anfrage hoch. Verwenden Sie für Dateien über einigen Gigabyte oder bei unzuverlässigen Verbindungen [`arkvoryctl`](../protocols/cli) oder das [SDK](../protocols/sdk): Sie senden Teile und setzen nach einem Fehler fort. Das Beispiel verwendet `jq`, um das JSON zu lesen.

Zuerst legen Sie die Adresse und den Schlüssel fest und berechnen die Größe und den SHA-256 der Datei:

```bash
export ARKVORY_URL=https://arkvory.example
export ARKVORY_KEY="$(cat ~/.arkvory/key)"
FILE=./Setup.exe
SIZE=$(stat -c %s "$FILE")
SHA=$(sha256sum "$FILE" | cut -d ' ' -f 1)
```

**Schritt 1. Den Upload reservieren.** Derselbe `Idempotency-Key` gibt dieselbe Sitzung zurück, sodass Sie diesen Aufruf sicher wiederholen können.

```bash
ID=$(curl -fsS -X POST "$ARKVORY_URL/api/v1/repositories/releases/uploads" \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  -H "Idempotency-Key: build-1042-setup" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Setup.exe\",\"size\":\"$SIZE\",\"sha256\":\"$SHA\",\"labels\":[\"nightly\"]}" \
  | jq -r .id)
```

**Schritt 2. Die Bytes senden.** Der Server veröffentlicht das Artefakt, wenn Größe und SHA-256 übereinstimmen.

```bash
curl -fsS -X PUT "$ARKVORY_URL/api/v1/repositories/releases/uploads/$ID/content" \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  -H "Content-Type: application/octet-stream" \
  -T "$FILE" | jq '{id, status}'
```

**Schritt 3. Herunterladen.** Die Artefakt-ID ist die Upload-ID.

```bash
curl -fL -o Setup-copy.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  "$ARKVORY_URL/api/v1/repositories/releases/artifacts/$ID/content"
sha256sum Setup-copy.exe
```

Schritt 2 antwortet `{"id": "…", "status": "available"}`. Wenn die Verbindung während Schritt 2 abbricht, lesen Sie den Upload mit `GET …/uploads/$ID`: Solange sein Status `pending` ist, senden Sie die Datei von Anfang an erneut. Eine Upload-Sitzung lebt 7 Tage. Der Schlüssel benötigt die Aktionen `upload.create`, `upload.write`, `upload.complete` und `content.read` auf `releases`. Siehe [Uploads](./reference/uploads) und [Übertragungen](../use/transfers).

## Referenzseiten {#reference-pages}

Jede Seite listet die Vorgänge einer Gruppe mit ihrer Zugriffsregel, Wiederholungsklasse, Parametern und Antworten auf.

- [System und Zustand](./reference/system): Liveness, Bereitschaft, Metriken, OpenAPI, Fähigkeiten
- [Repositorys](./reference/repositories)
- [Uploads](./reference/uploads)
- [Artefakte und Katalog](./reference/artifacts)
- [Pakete](./reference/packages)
- [Dateien nach Pfad](./reference/files)
- [Stufen und Hochstufung](./reference/promotion)
- [Speicherrichtlinien und Aufbewahrung](./reference/storage)
- [Spiegel](./reference/mirrors)
- [Download-Links](./reference/links)
- [Build-Anhänge](./reference/attachments)
- [Konten und Anmeldung](./reference/accounts)
- [Dienstkonten und Schlüssel](./reference/services)
- [Backups](./reference/backups)
- [Updates](./reference/updates)
- [Feedback](./reference/feedback)

Verwandte Seiten: [Authentifizierung](./authentication), [Fehler](./errors), [TypeScript-SDK](../protocols/sdk).
