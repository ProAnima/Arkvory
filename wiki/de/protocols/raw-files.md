---
title: Raw-Dateien
description: 'Speichern und Lesen einer Datei über ihren Pfad mit einer einzigen HTTP-Anfrage, mit curl, wget oder PowerShell, ohne etwas zu installieren.'
---

# Raw-Dateien

Ein Dateipfad in einem Repository funktioniert wie eine Datei auf einem Webserver. `PUT` speichert einen Body als nächste Version eines Pfads. `GET` gibt die aktuelle Version zurück. Verwenden Sie es aus Build-Skripten und CI-Jobs, die `curl` oder PowerShell und sonst nichts haben.

Die Adresse ist für alle drei Methoden dieselbe:

```text
https://<host>/api/v1/repositories/<repository>/raw/<path>
```

Zum Beispiel: `https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe`.

## Eine Datei speichern {#store-a-file}

Sie brauchen ein Repository und einen Schlüssel mit Schreibzugriff. Siehe [Konten und Schlüssel](../use/accounts). Senden Sie den Schlüssel als `Authorization: Bearer <key>`. Raw-Dateien akzeptieren keine andere Art der Authentifizierung.

```bash
export ARKVORY_KEY="$(cat ~/.arkvory/key)"
URL="https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe"

curl --fail-with-body -sS -T ./GameSetup.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  "$URL"
```

```powershell
$headers = @{ Authorization = "Bearer $env:ARKVORY_KEY" }
$url = 'https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe'
Invoke-RestMethod -Method Put -InFile .\GameSetup.exe -Headers $headers -Uri $url
```

```bash
wget -qO- --method=PUT --body-file=GameSetup.exe \
  --header="Authorization: Bearer $ARKVORY_KEY" "$URL"
```

Geben Sie `curl -T` die vollständige Adresse der Datei, nicht die eines Ordners. Kodieren Sie Zeichen im Pfad, die eine URL nicht zulässt: Schreiben Sie ein Leerzeichen als `%20`, `#` als `%23` und `?` als `%3F`.

Die Antwort ist JSON. Eine neue Datei oder neue Bytes geben `201` zurück:

```json
{
  "path": "builds/game/1.4/GameSetup.exe",
  "revision": 1,
  "created": true,
  "artifact": { "id": "00000000-0000-4000-8000-000000000001", "size": "1048576", "sha256": "…" }
}
```

Wenn der Pfad bereits genau diese Bytes enthält, ist die Antwort `200` mit `"created": false` und derselben Revision. Nichts wird gespeichert. Ein Schritt eines CI-Jobs kann erneut ausgeführt werden, ohne eine neue Version zu erzeugen. `size` ist eine Zeichenkette aus Dezimalziffern.

### Eine Prüfsumme senden {#send-a-checksum}

Senden Sie den SHA-256 der Datei mit `X-Checksum-Sha256` und die Länge mit `Content-Length`. `curl -T` und PowerShell senden die Länge für eine Datei. Dann schreibt der Server die Bytes in einem Durchgang direkt in den Speicher und prüft sie dort. Eine falsche Prüfsumme gibt `422` mit dem Code `integrity_mismatch` zurück, speichert nichts und lässt den Pfad unverändert.

```bash
curl --fail-with-body -sS -T ./GameSetup.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  -H "X-Checksum-Sha256: $(sha256sum GameSetup.exe | cut -d' ' -f1)" \
  "$URL"
```

```powershell
$headers['X-Checksum-Sha256'] = (Get-FileHash .\GameSetup.exe -Algorithm SHA256).Hash.ToLower()
Invoke-RestMethod -Method Put -InFile .\GameSetup.exe -Headers $headers -Uri $url
```

Ohne die Prüfsumme oder mit einem chunked Body ohne `Content-Length` schreibt der Server den Body zuerst in eine temporäre Datei und berechnet deren Hash. Dann speichert er sie. Dies benötigt kurzzeitig bis zu die doppelte Dateigröße auf der Festplatte des Servers und einen zweiten Durchgang über die Bytes. Der Server entfernt temporäre Dateien, die ein Fehler hinterlassen hat, nach einem Tag.

Wenn Sie die Prüfsumme und die Länge senden und der Pfad bereits diese Bytes enthält, antwortet der Server mit `200`, ohne den Body zu lesen, und schließt die Verbindung.

### Nur anlegen {#create-only}

Ein `PUT` liest nur eine Bedingung, `If-None-Match: *`. Damit speichert der Server die Datei nur, wenn der Pfad nicht existiert. Andernfalls antwortet er mit `409` und dem Grund `already_exists`, auch wenn die Bytes dieselben sind. Jeder andere Wert von `If-None-Match` bei einem `PUT` gibt `400` zurück.

```bash
curl --fail-with-body -sS -T ./notes.txt \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "If-None-Match: *" \
  "https://arkvory.example/api/v1/repositories/releases/raw/docs/notes.txt"
```

### Zwei Schreiber {#two-writers}

Wenn zwei Anfragen denselben Pfad gleichzeitig ändern, gewinnt die erste. Die spätere erhält `409` mit dem Grund `revision_mismatch`, und der Pfad behält den Inhalt des Gewinners. Führen Sie die Anfrage erneut aus, um eine neue Revision zu erzeugen. Die hochgeladenen Bytes des Verlierers bleiben als Artefakt ohne Pfad, bis die Aufbewahrung sie entfernt.

## Eine Datei lesen {#read-a-file}

`GET` gibt die aktuelle Version des Pfads zurück. `HEAD` gibt nur die Header zurück.

```bash
curl --fail-with-body -sS -H "Authorization: Bearer $ARKVORY_KEY" -o GameSetup.exe "$URL"
```

```powershell
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -Headers $headers -Uri $url -OutFile .\GameSetup.exe
```

```bash
wget --header="Authorization: Bearer $ARKVORY_KEY" -O GameSetup.exe "$URL"
```

Die Antwort-Header:

| Header                  | Wert                                                               |
| ----------------------- | ------------------------------------------------------------------ |
| `ETag`                  | `"sha256:<digest>"`: der SHA-256 des Inhalts, in Anführungszeichen |
| `Content-Length`        | Die Größe der Datei                                                |
| `Accept-Ranges`         | `bytes`                                                            |
| `Content-Type`          | Immer `application/octet-stream`                                   |
| `Content-Disposition`   | `attachment` mit dem letzten Segment des Pfads als Dateinamen      |
| `X-Arkvory-Artifact-Id` | Die ID des Artefakts, das diese Version hält                       |

Ein unbekannter Pfad gibt `404` zurück.

### Ranges und bedingte Anfragen {#ranges-and-conditional-requests}

| Anfrage-Header              | Wirkung                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `Range: bytes=0-1023`       | `206` mit dem angeforderten Teil und `Content-Range`. Ein Start hinter dem Dateiende gibt `416` mit `Content-Range: bytes */<size>` zurück. |
| `Range: bytes=-1024`        | Die letzten 1024 Bytes                                                                                                                      |
| `Range: bytes=1048576-`     | Vom Offset bis zum Ende                                                                                                                     |
| `If-Range: "sha256:…"`      | Wendet den `Range` nur an, wenn der ETag genau dieser ist. Wenn der Pfad eine neue Version hat, erhalten Sie die ganze neue Datei.          |
| `If-None-Match: "sha256:…"` | `304` ohne Body, wenn der ETag derselbe ist. Es funktioniert auch mit `HEAD`.                                                               |

Nur ein Bereich pro Anfrage wird unterstützt. Eine Anfrage mit mehreren Bereichen gibt die ganze Datei zurück.

Ein Pfad kann jederzeit eine neue Version erhalten, und ein `GET` löst den Pfad erneut auf. Um einen Download sicher fortzusetzen, merken Sie sich den `ETag` der ersten Antwort und senden Sie ihn als `If-Range`:

```bash
etag=$(curl -sSI -H "Authorization: Bearer $ARKVORY_KEY" "$URL" | awk 'tolower($1)=="etag:" {print $2}' | tr -d '\r')
curl -sS -H "Authorization: Bearer $ARKVORY_KEY" -H "If-Range: $etag" \
  -H "Range: bytes=1048576-" "$URL" >> GameSetup.part
```

Um einen Download zu überspringen, wenn sich die Datei nicht geändert hat, senden Sie den ETag, den Sie zuletzt gespeichert haben:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $ARKVORY_KEY" \
  -H 'If-None-Match: "sha256:<digest>"' "$URL"
```

Bei großen Dateien lädt [`arkvoryctl get`](./cli) mit Fortsetzen herunter und prüft den SHA-256 für Sie.

## Pfade und Versionen {#paths-and-versions}

Eine Raw-Datei ist eine [Datei nach Pfad](../use/files). Jeder `PUT` mit neuen Bytes fügt dem Pfad eine Revision hinzu: Revision 1, 2, 3 und so weiter. Frühere Revisionen bleiben. Bytes werden nie ersetzt, weil jede Revision auf ihr eigenes unveränderliches Artefakt zeigt, benannt nach dem letzten Segment des Pfads.

- `GET` auf der Raw-Adresse gibt immer die aktuelle Revision zurück.
- Um alle Revisionen eines Pfads zu sehen, lesen Sie seinen Verlauf: [`getAssetHistory`](../api/reference/files#getAssetHistory) oder [[ui:history]] in der Konsole.
- Um eine ältere Revision zu lesen, gibt [`getAssetRevision`](../api/reference/files#getAssetRevision) ihr Artefakt zurück. Laden Sie es mit der Inhaltsadresse des Artefakts herunter.
- Um zu einer alten Revision zurückzukehren, verwenden Sie [`restoreAsset`](../api/reference/files#restoreAsset). Es fügt eine neue Revision hinzu, die auf die alten Bytes zeigt.
- Um die Pfade eines Repositorys nach Präfix aufzulisten, verwenden Sie [`listAssetPage`](../api/reference/files#listAssetPage).
- Ein Pfad kann nicht gelöscht werden. Der Verlauf bleibt. Die Aufbewahrung entfernt keine Artefakte, die eine Pfadrevision verwendet.

Dieselben Vorgänge gibt es im [SDK](./sdk#raw-files-by-path) (`client.raw.putRawFile`, `downloadRawFile`) und in [`arkvoryctl`](./cli#transfers) (`put`, `get`).

### Pfadregeln {#path-rules}

| Regel         | Wert                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------- |
| Länge         | 1 bis 1024 Zeichen                                                                           |
| Ordner        | Segmente getrennt durch `/`                                                                  |
| Nicht erlaubt | Ein leeres Segment (`a//b`), `.` oder `..`, ein Backslash, ein Doppelpunkt und Steuerzeichen |

`curl` und Browser entfernen `.` und `..` aus einer URL, bevor sie sie senden, daher kommt ein solcher Pfad nie an. Ein Pfad, der die Regeln verletzt, gibt `400` zurück.

## Berechtigungen {#permissions}

Persönliche Token und Dateischlüssel erhalten Lese- oder Schreibzugriff auf das Repository. Dienstschlüssel erhalten exakte Aktionen.

| Vorgang       | Aktionen des Dienstschlüssels                                                                    | Persönliches Token oder Dateischlüssel   |
| ------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| `GET`, `HEAD` | `content.read`                                                                                   | Lesezugriff                              |
| `PUT`         | `upload.create`, `upload.write`, `upload.complete`, `asset.read`, `asset.write`, `artifact.read` | Schreibzugriff, Token-Scope `read-write` |

Ein Deployment-Agent, der nur herunterlädt, benötigt die Aktion `content.read`.

Ein [Lese-Gateway](../operate/read-gateways) akzeptiert nur `GET` und `HEAD`. Ein [Spiegel](../operate/mirrors) bedient Lesezugriffe und lehnt `PUT` mit `409` und dem Grund `mirror_read_only` ab.

## Limits {#limits}

| Limit                  | Wert                                                                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dateigröße             | Die maximale Objektgröße der Installation, `ARKVORY_MAX_OBJECT_BYTES` (standardmäßig etwa 10 TiB)                                                                                                               |
| Eine `PUT`-Anfrage     | Muss innerhalb von 30 Minuten abgeschlossen sein und darf nicht länger als 30 Sekunden pausieren (`ARKVORY_UPLOAD_DEADLINE_MS`, `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`). Dies sind auch die höchsten erlaubten Werte. |
| Uploads gleichzeitig   | Standardmäßig 2 pro Server und 1 pro Schlüssel (`ARKVORY_MAX_UPLOADS`, `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`). Eine wartende Anfrage gibt nach 20 Sekunden mit `503` auf.                                         |
| Downloads gleichzeitig | Standardmäßig 16 pro Server und 4 pro Schlüssel                                                                                                                                                                 |
| Kontingent             | Die Datei zählt gegen das Repository-Kontingent und die Kapazität der Installation                                                                                                                              |

Ein einzelnes `PUT` hat kein Fortsetzen: Nach einem Fehler beginnt es wieder beim ersten Byte. Verwenden Sie Raw-Dateien für kleine und mittlere Dateien und für Skripte. Verwenden Sie für große Dateien oder langsame Netzwerke [`arkvoryctl put`](./cli) oder das [SDK](./sdk). Sie laden in Teilen hoch, setzen nach einem Fehler fort und prüfen den SHA-256. Sie speichern die Datei außerdem als Revision eines Pfads. Die Variablen sind in [Umgebungsvariablen](../reference/environment#transfers-and-bandwidth) beschrieben.

## Fehlerbehebung {#troubleshooting}

Fehler sind JSON-Dokumente mit `code`, `reason`, `message` und `requestId`. Siehe [Fehler](../api/errors). Geben Sie die `requestId` Ihrem Administrator, um die Anfrage im Serverprotokoll zu finden.

| Status      | Grund                                                       | Ursache                                                                                                                  | Vorgehen                                                                                              |
| ----------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `400`       | `validation`                                                | Der Pfad, `Content-Length`, `X-Checksum-Sha256` oder `If-None-Match` ist ungültig                                        | Prüfen Sie die Pfadregeln und kodieren Sie die URL                                                    |
| `401`       | `credential_missing`, `credential_invalid`, `token_expired` | Kein Schlüssel, ein falscher Schlüssel oder ein abgelaufenes Token                                                       | Senden Sie `Authorization: Bearer <key>`. Basic-Authentifizierung funktioniert nicht für Raw-Dateien. |
| `403`       | `permission_missing`, `read_only_token`                     | Der Schlüssel kann nicht schreiben, oder es ist ein schreibgeschütztes Token                                             | Verwenden Sie einen Schlüssel mit den Aktionen aus [Berechtigungen](#permissions)                     |
| `404`       |                                                             | Der Pfad existiert nicht, oder der Schlüssel sieht das Repository nicht                                                  | Prüfen Sie den Repository-Namen und den Pfad                                                          |
| `409`       | `already_exists`                                            | `If-None-Match: *` und der Pfad existiert                                                                                | Entfernen Sie den Header, um eine Revision hinzuzufügen                                               |
| `409`       | `revision_mismatch`                                         | Eine andere Anfrage hat den Pfad zuerst geändert                                                                         | Führen Sie die Anfrage erneut aus                                                                     |
| `409`       | `mirror_read_only`                                          | Das Repository ist ein Spiegel                                                                                           | Schreiben Sie zum Hauptserver                                                                         |
| `416`       | `range_not_satisfiable`                                     | Der Bereich beginnt nach dem Ende der Datei                                                                              | Prüfen Sie die Größe mit `HEAD`                                                                       |
| `422`       | `integrity_mismatch`                                        | Der Body stimmt nicht mit `X-Checksum-Sha256` oder `Content-Length` überein                                              | Berechnen Sie die Prüfsumme erneut; prüfen Sie den Proxy                                              |
| `503`       | `busy`                                                      | Zu viele Übertragungen gleichzeitig                                                                                      | Warten Sie die Zeit in `Retry-After` ab und wiederholen Sie                                           |
| `507`       | `storage_quota`                                             | Das Repository-Kontingent oder die Kapazität der Installation ist erreicht                                               | Geben Sie Speicher frei oder bitten Sie um ein größeres Kontingent                                    |
| Kein Status | `curl: (55)` oder `(56)` beim Senden                        | Der Server hat die Verbindung geschlossen. Wenn der Pfad die Bytes bereits enthält, antwortet er mit `200` und schließt. | Führen Sie `curl -i` aus und lesen Sie die Antwort                                                    |
| Kein Status | Die Verbindung schließt nach 30 Minuten                     | Die Upload-Frist                                                                                                         | Verwenden Sie `arkvoryctl put`                                                                        |

## Verwandte Seiten {#related-pages}

- [Clients und Protokolle](./index)
- [Kommandozeile (arkvoryctl)](./cli)
- [TypeScript-SDK](./sdk)
- [Dateien und Pfade](../use/files)
- [API-Referenz: Dateien nach Pfad](../api/reference/files)
