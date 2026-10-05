---
title: TypeScript-SDK
---

# TypeScript-SDK

Das TypeScript-SDK ist die Client-Bibliothek, die die Konsole und `arkvoryctl` verwenden. Es kapselt die REST-API `/api/v1`. Es validiert jede Antwort zur Laufzeit, lädt in Teilen hoch, setzt unterbrochene Übertragungen fort und prüft Downloads per SHA-256. Es nutzt nur Standard-Web-APIs (`fetch`, Streams, Web Crypto) und läuft daher in Node.js und in Browsern.

## SDK beziehen {#get-the-sdk}

Das SDK ist das Workspace-Paket `@proanima/arkvory-sdk` im Ordner `packages/sdk` des Quell-Repositorys `ProAnima/Arkvory`. Es ist **nicht in der npm-Registry veröffentlicht**. Es hängt vom Workspace-Paket `@proanima/arkvory-contracts` ab.

- Um es zu verwenden, bauen Sie das Quell-Repository (`npm ci`, dann `npm run build`) und schreiben Sie Ihr Tool innerhalb dieses Workspace, wie es die eigenen Skripte des Repositorys tun.
- Aus einer anderen Sprache oder aus einem Projekt, das den Workspace nicht verwenden kann, rufen Sie die [REST-API](../api/index) direkt mit `Authorization: Bearer <key>` auf.

Der Quellcode steht unter der Arkvory-Lizenz. Sie dürfen ihn innerhalb Ihrer Organisation verwenden und ändern. Sie dürfen keine Kopien verbreiten.

## Client erstellen {#create-a-client}

```typescript
import { ArkvoryClient } from '@proanima/arkvory-sdk';

const client = new ArkvoryClient('https://arkvory.example/', () => process.env.ARKVORY_KEY ?? '', {
  requestTimeoutMs: 60_000,
  attemptTimeoutMs: 120_000,
  maxRetries: 20,
});
const releases = client.inRepository('releases');
```

- **Basis-URL.** HTTPS ist erforderlich. Unverschlüsseltes HTTP ist nur für `localhost`, `127.0.0.1` und `[::1]` erlaubt. Die URL darf keinen Benutzer, kein Passwort, keine Query und kein Fragment enthalten. Sie darf ein Pfadpräfix enthalten. Weiterleitungen werden als Fehler behandelt.
- **Token-Callback.** Das SDK ruft ihn bei jeder Anfrage auf und speichert das Ergebnis nie zwischen. Sie können Schlüssel rotieren, ohne einen neuen Client zu erstellen.
- **`inRepository(id)`** gibt einen an ein Repository gebundenen Client zurück. Das ist eine Vereinfachung, keine Sicherheitsgrenze.

| Option             | Standard | Bedeutung                                                                                                         |
| ------------------ | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `signal`           | keiner   | Bricht jede Anfrage dieses Clients ab                                                                             |
| `requestTimeoutMs` | keiner   | Frist einer Anfrage ohne eigenes Signal (1 bis 3600000)                                                           |
| `maxAttempts`      | 5        | Versuche einer Übertragungsanfrage, einschließlich des ersten (1 bis 10)                                          |
| `maxRetries`       | 20       | Wiederholungen, die sich ein Upload- oder Download-Vorgang teilt (0 bis 100)                                      |
| `attemptTimeoutMs` | 120000   | Limit eines Übertragungsversuchs (1 bis 1800000)                                                                  |
| `baseDelayMs`      | 500      | Erste Backoff-Verzögerung (1 bis 60000)                                                                           |
| `maxDelayMs`       | 60000    | Längste Verzögerung, einschließlich `Retry-After`                                                                 |
| `onRequest`        | keiner   | Wird einmal pro HTTP-Anfrage mit Methode, Pfad, Status, Dauer und Anfrage-ID aufgerufen. Erhält nie Anmeldedaten. |

Automatische Wiederholungen gelten nur für Übertragungen: `create`, die Schritte innerhalb von `resume` und `downloadVerified`. Sie wiederholen bei Netzwerkfehlern und den HTTP-Statuscodes 408, 429, 502, 503 und 504 mit exponentiellem Backoff und nie früher als `Retry-After`. Andere Aufrufe laufen einmal. Durch eine Revision geschützte Änderungen werden nie automatisch wiederholt.

## Häufige Aufgaben {#common-tasks}

### Erkunden und auflisten {#discover-and-list}

```typescript
const permissions = await client.permissions();
const repositories = await client.repositories({ limit: 50 });
const page = await releases.artifacts.list();
const found = await releases.artifacts.search({ q: 'build-42', label: 'staging' });
for (const item of found.items) console.log(item.id, item.name, item.size);
const artifact = await releases.artifacts.get('00000000-0000-4000-8000-000000000001');
```

Seiten liefern `next`. Übergeben Sie den Wert als `after`, um die nächste Seite zu lesen.

### Große Datei mit Fortsetzung hochladen (Node.js) {#upload-a-large-file-with-resume-node-js}

```typescript
import { openAsBlob } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const file = await openAsBlob('./build/Game.zip'); // wird nicht in den Speicher gelesen
const hash = createHash('sha256');
for await (const chunk of file.stream()) hash.update(chunk);

const key = randomUUID(); // vor der ersten Anfrage zusammen mit dem Job-Zustand speichern
const session = await releases.uploads.create(key, {
  name: 'Game.zip',
  size: String(file.size),
  sha256: hash.digest('hex'),
  labels: ['test'],
  metadata: { commit: 'abc123' },
});
const uploaded = await releases.uploads.resume(session.id, file, {
  onProgress: (bytes) => console.log(`${bytes} of ${file.size} bytes`),
});
await releases.assets.assign('builds/game/1.4/Game.zip', uploaded.id, 0); // 0: der Pfad ist neu
```

- Derselbe Idempotenzschlüssel mit demselben Deskriptor liefert dieselbe Sitzung, sodass eine verlorene Antwort keinen zweiten Upload erzeugt.
- `resume` liest die Teile, die der Server bereits hat, prüft ihre Hashes gegen Ihre Datei und sendet nur die fehlenden Teile. Rufen Sie nach einem Absturz `resume` erneut mit der gespeicherten Sitzungs-ID auf.
- Der Server wählt die Teilgröße: 8 MiB, größer nur bei Dateien, die mehr als 10 000 Teile benötigen. Das SDK hält jeweils nur einen Teil im Speicher.
- Dateien ab 16 GiB schließt der Worker des Servers ab. `resume` wartet darauf.
- `assets.assign(path, artifactId, expectedRevision)` schlägt mit einem Konflikt fehl, wenn der Pfad eine andere Revision hat. Lesen Sie den Pfad zuvor mit `assets.get(path)`.

### Download mit Prüfung {#download-with-verification}

```typescript
import { createWriteStream } from 'node:fs';
import { rename } from 'node:fs/promises';
import { Writable } from 'node:stream';

const stream = await releases.artifacts.downloadVerified(uploaded.id);
await stream.pipeTo(Writable.toWeb(createWriteStream('./Game.zip.part')));
await rename('./Game.zip.part', './Game.zip'); // erst nach erfolgreichem pipeTo
```

Das SDK liest den Inhalt in Bereichen von 8 MiB und prüft Größe, `Content-Range` und `ETag` jedes Bereichs. Es prüft den SHA-256-Wert der ganzen Datei, bevor es den letzten Block liefert. Schlägt die Prüfung fehl, bricht der Stream mit `ArkvoryIntegrityError` ab. Stellen Sie nie direkt aus dem Stream bereit: Schreiben Sie in eine temporäre Datei und verwenden Sie sie erst, nachdem der Stream erfolgreich beendet wurde.

Um nach einem Neustart fortzufahren, übergeben Sie die bereits gespeicherten Bytes als `prefix`. Der Stream enthält dann nur den Rest:

```typescript
const prefix = await openAsBlob('./Game.zip.part');
const rest = await releases.artifacts.downloadVerified(uploaded.id, { prefix });
await rest.pipeTo(Writable.toWeb(createWriteStream('./Game.zip.part', { flags: 'a' })));
```

Für einen einzelnen Byte-Bereich ohne Prüfung gibt `releases.artifacts.download(id, { start: 0, end: 1023 })` die rohe `Response` zurück (Status 206).

### Raw-Dateien nach Pfad {#raw-files-by-path}

```typescript
const body = new Blob([JSON.stringify({ level: 3 })]);
const result = await client.raw.putRawFile('releases', 'config/settings.json', body, {
  createOnly: true, // optional: ablehnen, wenn der Pfad existiert
});
console.log(result.revision, result.created); // created ist false, wenn die Bytes schon vorhanden waren
const response = await client.raw.downloadRawFile('releases', 'config/settings.json');
```

Mit der Option `sha256` (64 Hexziffern) kann der Server die Bytes in einem Durchlauf schreiben und eine Abweichung ablehnen. `releases.assets.put(path, blob, options)` und `releases.assets.download(path, range)` sind dieselben Aufrufe. Jeder Upload ist eine einzige Anfrage; verwenden Sie sie daher für kleine und mittelgroße Dateien. Siehe [Raw-Dateien](./raw-files).

### Pakete, Hochstufung und Links {#packages-promotion-and-links}

```typescript
await releases.packages.register(uploaded.id); // UPack-Archiv
const selected = await releases.packages.resolve({ name: 'app', range: '^1.4', stage: 'release' });
await releases.promotions.promote(selected.artifactId, {
  target: 'prod',
  mode: 'copy',
  stages: ['release'],
});
const link = await releases.artifacts.link(selected.artifactId, { ttlSeconds: 900 });
```

Die Link-URL ist ein Geheimnis, mit dem ein Artefakt bis `expiresAt` gelesen werden kann. Sie lässt sich nicht vorzeitig widerrufen.

### Backups {#backups}

```typescript
const status = await client.backup.status();
const job = await client.backup.run(); // für den Backup-Agent eingereiht
const points = await client.backup.points({ limit: 20 });
```

Backup-Aufrufe benötigen die Sitzung eines Konto-Administrators oder den Dateischlüssel des Besitzers. Dienstschlüssel und persönliche Token erhalten 403.

## Fehler {#errors}

```typescript
import {
  ArkvoryClientError,
  ArkvoryHttpError,
  ArkvoryIntegrityError,
  ArkvoryNetworkError,
} from '@proanima/arkvory-sdk';

try {
  await releases.artifacts.get(id);
} catch (error) {
  if (error instanceof ArkvoryHttpError) {
    console.error(error.status, error.code, error.reason, error.requestId, error.retryAfterSeconds);
  } else if (error instanceof ArkvoryClientError) {
    console.error(error.code);
  }
}
```

| Klasse                  | Bedeutung                                                                                                                                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ArkvoryHttpError`      | Der Server hat mit einem Fehler geantwortet. Felder: `status`, `code`, `reason`, `details`, `requestId`, `retryAfterMs`, `retryAfterSeconds`, `serverMessage`. `code` ist `http_error`, wenn ein Proxy ohne das Arkvory-Format geantwortet hat. |
| `ArkvoryNetworkError`   | Die Verbindung ist fehlgeschlagen oder nach allen Wiederholungen in eine Zeitüberschreitung gelaufen                                                                                                                                            |
| `ArkvoryIntegrityError` | Heruntergeladene Bytes stimmen nicht mit dem Artefakt überein                                                                                                                                                                                   |
| `ArkvoryClientError`    | Lokaler Fehler mit `code`: `invalid_argument`, `insecure_url`, `invalid_response`, `response_too_large`, `size_mismatch`, `file_changed`, `upload_cancelled`, `completion_failed`                                                               |

Entscheiden Sie nach `code` und `reason`, nicht nach dem Meldungstext. Behandeln Sie unbekannte Codes nach dem HTTP-Status. `Error.message` enthält nie Servertext. Siehe [Fehler](../api/errors).

## Browser und Node.js {#browser-and-node-js}

- **Browser mit anderem Origin.** Der Administrator muss den genauen Origin Ihrer Seite in `ARKVORY_CORS_ORIGINS` auf dem Server eintragen. Das SDK sendet den Schlüssel im Header `Authorization` und sendet nie Cookies.
- **Schlüssel im Browser.** Halten Sie den Schlüssel nur im Speicher. Legen Sie ihn nicht in URLs, `localStorage`, Protokollen oder im Seitenquelltext ab. Ein Benutzer kann sich mit `client.login(name, password)` anmelden, um ein Sitzungstoken zu erhalten.
- **Dateien in Node.js.** Verwenden Sie `openAsBlob` aus `node:fs`, um eine Datei zu übergeben, ohne sie in den Speicher zu lesen.
- **Download-Warteschlange.** `DownloadQueue` und `checkpointedDownload` bieten eine begrenzte Warteschlange mit Pause, Fortsetzen und Abbrechen. Den Speicheradapter liefern Sie selbst.

## Grenzen {#limits}

- JSON-Antworten sind auf 2 MiB begrenzt (Paketseiten 8 MiB, Artefaktlisten 24 MiB). Größere Antworten schlagen mit `response_too_large` fehl.
- Größen sind Dezimalzeichenketten, sodass Werte über 2^53 die volle Genauigkeit behalten.

## Verwandte Seiten {#related-pages}

- [Kommandozeile (arkvoryctl)](./cli)
- [Übertragungen](../use/transfers)
- [API-Überblick](../api/index) und [Authentifizierung](../api/authentication)
- [Raw-Dateien](./raw-files)
