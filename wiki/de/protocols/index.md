---
title: Clients und Protokolle
---

# Clients und Protokolle

Arkvory hat einen Speicher und ein Zugriffsmodell, aber mehrere Zugänge dazu. Jeder Zugang ist ein Client oder ein Protokoll, das ein Tool bereits spricht. Alle speichern Daten als Arkvory-Artefakte. Deshalb gelten dieselben Berechtigungen, Kontingente, SHA-256-Prüfungen, Aufbewahrungsregeln, Backups und Spiegel, egal welchen Zugang Sie nutzen.

Diese Seite listet alle Zugänge zu Arkvory auf, wofür sie gedacht sind und welche Anmeldedaten sie akzeptieren. Nutzen Sie sie, um das passende Tool für eine Aufgabe zu wählen.

## Überblick {#overview}

| Zugang                     | Adresse                                        | Einsatz                                                                                                | Anmeldedaten                                                                       |
| -------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Webkonsole                 | `https://arkvory.example/console/`             | Repositorys durchsuchen, im Browser hoch- und herunterladen, Benutzer, Schlüssel und Backups verwalten | Anmeldung mit Benutzername und Passwort oder mit einem Dienstschlüssel             |
| Kommandozeile `arkvoryctl` | `/api/v1`                                      | CI-Skripte, fortsetzbare Uploads und Downloads, Dateien nach Pfad, Hochstufung, Backups                | Schlüssel aus einer Datei oder einer Umgebungsvariablen (als Bearer gesendet)      |
| TypeScript-SDK             | `/api/v1`                                      | Eigene Tools in TypeScript oder JavaScript, in Node.js oder im Browser                                 | Schlüssel aus einem Callback (als Bearer gesendet)                                 |
| REST-API                   | `/api/v1/...`                                  | Integrationen in jeder Sprache                                                                         | Nur `Authorization: Bearer <key>`                                                  |
| Container-Registry (OCI)   | `/v2/`                                         | Docker, Podman, Buildx, containerd, Helm-Charts, ORAS-Artefakte                                        | Basic mit dem Schlüssel als Passwort (`docker login`) oder Bearer                  |
| Git LFS                    | `/lfs/<repository>`                            | Große Dateien eines Git-Repositorys, Dateisperren für Unity und Unreal                                 | Basic mit dem Schlüssel als Passwort (Git-Credential-Helper) oder Bearer           |
| npm-Registry               | `/npm/<repository>/`                           | Scoped Registrys des Unity Package Managers, `npm publish` und `npm install`                           | Bearer (`_authToken` in `.npmrc`, `token` in `.upmconfig.toml`) oder Basic `_auth` |
| Raw-Dateien nach Pfad      | `/api/v1/repositories/<repository>/raw/<path>` | Eine Anfrage mit `curl -T` oder PowerShell                                                             | Nur `Authorization: Bearer <key>`                                                  |
| Webhooks                   | Die URL Ihres Empfängers                       | Ein Deployment oder einen Job starten, wenn sich ein Repository ändert                                 | HMAC-Signatur jeder Anfrage                                                        |

Die Routen unter `/v2`, `/lfs` und `/npm` folgen den Spezifikationen ihrer Protokolle. Sie sind nicht Teil des OpenAPI-Dokuments von `/api/v1` und melden Fehler in dem Format, das ihre Clients erwarten.

## Anmeldedaten {#credentials}

Jede Anfrage benötigt Anmeldedaten, außer öffentlichen Health-Checks. Arkvory akzeptiert diese Arten:

| Art                        | Sieht so aus         | Woher es kommt                                                                                                                                                          | Typische Verwendung                                          |
| -------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Persönliches Zugriffstoken | `pat_...`            | Wird von einem Benutzer in der Konsole erstellt. Zugriff `read` oder `read-write`. Läuft ab (standardmäßig nach 90 Tagen, höchstens 365).                               | Entwickler: Unity, Git, Docker auf einem Arbeitsplatzrechner |
| Dienstschlüssel            | `arkvory_...`        | Wird für ein Dienstkonto ausgestellt, mit genau festgelegten Aktionen pro Repository, mit dem Wiederherstellungsschlüssel oder von einem delegierten Operator-Schlüssel | CI/CD, Deployment-Agents, Build-Server                       |
| Dateischlüssel             | beliebiges Geheimnis | Die Schlüsseldatei des Servers (`ARKVORY_KEYS_FILE`), mit `read` oder `write` pro Repository; der Besitzerschlüssel verwaltet außerdem                                  | Besitzer der Installation, ältere Integrationen              |
| Sitzung                    | `dps_...`            | Anmeldung an der Konsole; 12 Stunden gültig                                                                                                                             | Interaktive Arbeit in der Konsole                            |
| Download-Link              | URL mit `?token=`    | Für ein Artefakt erstellt; 60 Sekunden bis 24 Stunden                                                                                                                   | Eine Datei ohne Schlüssel an jemanden weitergeben            |

Die Protokolle unterscheiden sich nur darin, wie sie den Schlüssel senden:

- `/api/v1`, die CLI, das SDK und Raw-Dateien verwenden `Authorization: Bearer <key>`.
- `/v2`, `/lfs` und `/npm` akzeptieren auch HTTP Basic. Der Benutzername wird nicht geprüft. Das Passwort ist der Arkvory-Schlüssel. So senden `docker login`, Git-Credential-Helper und npm `_auth` ihre Anmeldedaten.
- Ein schreibgeschütztes persönliches Token ändert nie Daten. Es kann trotzdem Git-LFS-Objekte herunterladen, weil die Batch-Anfrage von Git LFS auch für Downloads ein `POST` ist.

So erstellen Sie Token und Schlüssel: [Konten und Schlüssel](../use/accounts). Details zu den Headern: [Authentifizierung](../api/authentication).

## Welchen Zugang soll ich verwenden? {#which-one-should-i-use}

| Aufgabe                                                                                                | Empfohlener Zugang                                                   |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Ein Build-Artefakt aus CI hochladen und nach einem Netzwerkausfall fortsetzen                          | [`arkvoryctl upload`](./cli) oder [`arkvoryctl put`](./cli)          |
| Ein UPack-Paket aus CI veröffentlichen                                                                 | [`arkvoryctl packages publish`](./cli)                               |
| „Das neueste 1.4-Release“ auf einem Server bereitstellen                                               | [`arkvoryctl packages download --range ^1.4 --stage release`](./cli) |
| Eine kleine oder mittelgroße Datei per Pfad aus einem Shell-Skript ablegen, ohne etwas zu installieren | [Raw-Dateien](./raw-files) mit `curl -T` oder PowerShell             |
| Container-Images oder Helm-Charts speichern                                                            | [Container-Images](./containers)                                     |
| Texturen, Modelle und Levels eines Spiels außerhalb des Git-Hosts aufbewahren                          | [Git LFS](./git-lfs)                                                 |
| Unity-Pakete zwischen Projekten teilen                                                                 | [Unity- und npm-Pakete](./unity-npm)                                 |
| Ein eigenes Tool oder eine eigene Weboberfläche bauen                                                  | [TypeScript-SDK](./sdk)                                              |
| Aus Python, Go, C# oder einer anderen Sprache integrieren                                              | [REST-API](../api/index)                                             |
| Sich umsehen, Benutzer, Schlüssel und Backups verwalten                                                | [Webkonsole](../guide/console)                                       |

Faustregeln:

- **Große Dateien (viele Gigabyte):** Verwenden Sie `arkvoryctl` oder das SDK. Sie laden in Teilen hoch und setzen nach einer Unterbrechung fort. Eine einzelne `PUT`-Anfrage (Raw-Dateien, Git-LFS-Objekte, npm publish, ein Docker-Layer) beginnt nach einem Fehler wieder bei Byte null.
- **Das Tool spricht bereits ein Protokoll:** Verwenden Sie dieses Protokoll. Docker, Git und Unity brauchen keine zusätzliche Software.
- **Eine Maschine liest nur:** Geben Sie ihr ein schreibgeschütztes Token oder einen Dienstschlüssel nur mit Leseaktionen.

## Gemeinsame Regeln {#shared-rules}

**HTTPS.** Verwenden Sie HTTPS für jeden Client. Die CLI und das SDK lehnen unverschlüsseltes HTTP ab, außer auf Loopback (`localhost`, `127.0.0.1`, `[::1]`). Docker braucht ein vertrauenswürdiges Zertifikat. Git sendet den Schlüssel mit jeder Anfrage. Siehe [HTTPS](../install/https).

**Gleicher Speicher.** Ein Image-Layer, ein Git-LFS-Objekt, ein npm-Tarball und eine Raw-Datei sind alle Artefakte. Sie zählen auf die Repository-Kontingente und die Kapazität der Installation. Sie werden beim Speichern per SHA-256 geprüft. Sie sind in Backups enthalten.

**Lese-Gateways und Spiegel.** Ein Lese-Gateway akzeptiert nur `GET` und `HEAD`. Ein Spiegel ist eine schreibgeschützte Kopie eines Repositorys auf einer anderen Installation.

| Zugang              | Auf einem Lese-Gateway                               | Auf einem Spiegel                                           |
| ------------------- | ---------------------------------------------------- | ----------------------------------------------------------- |
| `/api/v1`, CLI, SDK | Nur Lesen                                            | Lesen; Änderungen werden abgelehnt (`409 mirror_read_only`) |
| Container-Registry  | Pull                                                 | Pull; Push wird abgelehnt                                   |
| Git LFS             | Nicht unterstützt (die Batch-Anfrage ist ein `POST`) | Clone und Fetch; Push und Sperren werden abgelehnt          |
| npm-Registry        | Installieren und Suchen                              | Installieren und Suchen; Publish wird abgelehnt             |
| Raw-Dateien         | `GET` und `HEAD`                                     | `GET` und `HEAD`                                            |

Siehe [Lese-Gateways](../operate/read-gateways) und [Spiegel](../operate/mirrors).

## Verwandte Seiten {#related-pages}

- [Kommandozeile (arkvoryctl)](./cli)
- [TypeScript-SDK](./sdk)
- [Container-Images](./containers)
- [Git LFS](./git-lfs)
- [Unity- und npm-Pakete](./unity-npm)
- [Raw-Dateien](./raw-files)
- [Webhooks](./webhooks)
- [API-Überblick](../api/index) und [Fehler](../api/errors)
