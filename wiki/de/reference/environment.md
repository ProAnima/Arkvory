---
title: Umgebungsvariablen
---

# Umgebungsvariablen

Arkvory wird über Umgebungsvariablen konfiguriert, deren Namen mit `ARKVORY_` beginnen. Diese Seite listet jede Variable auf, die die Serverprozesse, der Kommandozeilen-Client und die Installer-Skripte lesen.

## Woher die Werte stammen {#where-the-values-come-from}

Die Installer schreiben die Servereinstellungen in eine Datei, `config/runtime.json`, im Installationsverzeichnis. Der Launcher jedes Dienstes liest diese Datei und gibt ihre Werte an API, Worker und Backup-Agent weiter. Jeder JSON-Schlüssel muss mit `ARKVORY_` beginnen, und jeder Wert muss eine Zeichenkette sein.

```json
{
  "ARKVORY_HOST": "127.0.0.1",
  "ARKVORY_PORT": "8080",
  "ARKVORY_CAPACITY_BYTES": "10995116277760",
  "ARKVORY_DATABASE_URL": "postgresql://arkvory:PASSWORD@127.0.0.1:54329/arkvory",
  "ARKVORY_DATA_DIR": "/opt/proanima-arkvory/data",
  "ARKVORY_KEYS_FILE": "/opt/proanima-arkvory/config/keys.json",
  "ARKVORY_MAX_DOWNLOADS": "32"
}
```

Die Datei enthält das Datenbankpasswort. Belassen Sie ihre Zugriffsrechte so, wie der Installer sie gesetzt hat.

Um eine Einstellung zu ändern, bearbeiten Sie `config/runtime.json` und starten Sie die Dienste neu. Bevorzugen Sie den Befehl `arkvory configure`, wo er die Einstellung abdeckt (HTTPS, Backup-Speicher, Spiegel, Updates). Er prüft die Änderung und stellt die alte Datei wieder her, wenn die Dienste nicht starten. Siehe [Konfiguration](../install/configuration).

```bash
sudo systemctl restart arkvory-api arkvory-worker arkvory-backup
```

```powershell
Restart-Service Arkvoryapi, Arkvoryworker, Arkvorybackup
```

Ein Wert außerhalb des erlaubten Bereichs stoppt den Prozess beim Start mit einer Meldung, die die Variable nennt. Arkvory greift in diesem Fall nicht auf einen Standardwert zurück.

Die Spalte „Gelesen von“ verwendet diese Namen: **API** ist der HTTP-Server (auch als Lese-Gateway), **Worker** ist der Hintergrund-Worker, **Agent** ist der Backup-Agent, **CLI** ist `arkvoryctl`.

## Kern {#core}

| Variable                     | Gelesen von                   | Standard          | Bedeutung                                                                                                                                                                               |
| ---------------------------- | ----------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_DATABASE_URL`       | API, Worker, Agent, Migration | erforderlich      | PostgreSQL-Verbindungs-URL (`postgres://` oder `postgresql://`). Verwenden Sie für jede Installation eine eigene Datenbank.                                                             |
| `ARKVORY_DATA_DIR`           | API, Worker, Agent            | erforderlich      | Lokales Speicherverzeichnis: Staging, Inhalte und die Datei `storage-id`. Verwenden Sie keine Netzwerkfreigabe.                                                                         |
| `ARKVORY_HOST`               | API                           | `127.0.0.1`       | Adresse, auf der gelauscht wird. Die Installer schreiben `127.0.0.1`; in Docker Compose ist es `0.0.0.0` im Container, und der Port wird nur auf dem Loopback des Hosts veröffentlicht. |
| `ARKVORY_PORT`               | API                           | `8080`            | TCP-Port, 1–65535.                                                                                                                                                                      |
| `ARKVORY_WEB_DIR`            | API                           | `apps/web/public` | Verzeichnis mit den Dateien der Webkonsole. Der Launcher setzt es bei jedem Start auf das aktuelle Release.                                                                             |
| `ARKVORY_DATABASE_POOL_SIZE` | API                           | `10`              | Größe des Verbindungspools der API, 4–200. Bis zu drei Verbindungen sind immer in Gebrauch.                                                                                             |

## Speicher und Limits {#storage-and-limits}

| Variable                        | Gelesen von        | Standard     | Bedeutung                                                                                                                                                                                                       |
| ------------------------------- | ------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_CAPACITY_BYTES`        | API, Worker        | 10 TiB       | Obergrenze in Bytes für alle reservierten Inhalte: veröffentlichte, unfertige Uploads und Inhalte, die auf die Bereinigung warten. Es ist keine Datenträgerprüfung. Der Worker liest sie nur für Spiegelkopien. |
| `ARKVORY_STORAGE_RESERVE_BYTES` | API, Worker, Agent | `1073741824` | Freier Speicherplatz in Bytes, den Uploads nie verwenden. Er bleibt für die Datenbank, Protokolle und das System reserviert. `0` schaltet die Reserve aus.                                                      |
| `ARKVORY_MAX_OBJECT_BYTES`      | API                | etwa 10 TiB  | Größtes Objekt in Bytes. Der höchste erlaubte Wert sind 10 000 Teile zu je 1 GiB. Setzen Sie einen niedrigeren Wert, um die Dateigröße zu begrenzen.                                                            |

## Übertragungen und Bandbreite {#transfers-and-bandwidth}

Diese Limits gelten für einen API-Prozess. Raten sind in Bytes pro Sekunde angegeben: `0` bedeutet keine Begrenzung, jeder andere Wert muss zwischen 65 536 und 1 TiB liegen.

| Variable                                          | Gelesen von | Standard  | Bedeutung                                                                                                                                                                                                          |
| ------------------------------------------------- | ----------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ARKVORY_MAX_UPLOADS`                             | API         | `2`       | Gleichzeitig laufende Uploads, 1–32.                                                                                                                                                                               |
| `ARKVORY_MAX_DOWNLOADS`                           | API         | `16`      | Gleichzeitig laufende Downloads, 1–256.                                                                                                                                                                            |
| `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`               | API         | `1`       | Gleichzeitige Uploads eines Kontos oder Schlüssels, bis zum Gesamtlimit für Uploads.                                                                                                                               |
| `ARKVORY_MAX_DOWNLOADS_PER_PRINCIPAL`             | API         | `4`       | Gleichzeitige Downloads eines Kontos oder Schlüssels, bis zum Gesamtlimit für Downloads.                                                                                                                           |
| `ARKVORY_TRANSFER_QUEUE_LIMIT`                    | API         | `64`      | Übertragungen, die auf einen freien Platz warten dürfen, 1–1024.                                                                                                                                                   |
| `ARKVORY_TRANSFER_QUEUE_PER_PRINCIPAL`            | API         | `8`       | Wartende Übertragungen eines Kontos oder Schlüssels, bis zum Warteschlangenlimit.                                                                                                                                  |
| `ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS`               | API         | `20000`   | Wie lange eine Übertragung in der Warteschlange warten darf, 1–120 000 ms.                                                                                                                                         |
| `ARKVORY_MAX_REQUESTS`                            | API         | `128`     | Gleichzeitige authentifizierte Anfragen, 1–4096. Der Wert muss größer sein als Uploads plus Downloads. Ist er nicht gesetzt und sind die Übertragungslimits hoch, ist der Standard Uploads plus Downloads plus 64. |
| `ARKVORY_UPLOAD_BYTES_PER_SECOND`                 | API         | `0`       | Gesamte Upload-Rate des Prozesses.                                                                                                                                                                                 |
| `ARKVORY_DOWNLOAD_BYTES_PER_SECOND`               | API         | `0`       | Gesamte Download-Rate des Prozesses.                                                                                                                                                                               |
| `ARKVORY_UPLOAD_BYTES_PER_SECOND_PER_PRINCIPAL`   | API         | `0`       | Upload-Rate eines Kontos oder Schlüssels über alle seine Verbindungen.                                                                                                                                             |
| `ARKVORY_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL` | API         | `0`       | Download-Rate eines Kontos oder Schlüssels über alle seine Verbindungen.                                                                                                                                           |
| `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`                  | API         | `30000`   | Eine Upload-Anfrage, die so lange keine Daten sendet, wird gestoppt, 1–1 800 000 ms.                                                                                                                               |
| `ARKVORY_UPLOAD_DEADLINE_MS`                      | API         | `1800000` | Längste Dauer einer Upload-Anfrage, 1–1 800 000 ms. Sie darf nicht kürzer sein als die Leerlauf-Zeitüberschreitung.                                                                                                |

## Netzwerk, HTTPS und Browser {#network-https-and-browsers}

| Variable                     | Gelesen von | Standard      | Bedeutung                                                                                                                           |
| ---------------------------- | ----------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_TLS_CERT_FILE`      | API         | nicht gesetzt | PEM-Zertifikat (mit seiner Kette) für integriertes HTTPS. Setzen Sie es zusammen mit der Schlüsseldatei.                            |
| `ARKVORY_TLS_KEY_FILE`       | API         | nicht gesetzt | Privater PEM-Schlüssel ohne Passwort.                                                                                               |
| `ARKVORY_TLS_MIN_VERSION`    | API         | `TLSv1.2`     | `TLSv1.2` oder `TLSv1.3`.                                                                                                           |
| `ARKVORY_TLS_RELOAD_SECONDS` | API         | `300`         | Wie oft erneuerte Zertifikatsdateien gelesen werden: 30–86 400 Sekunden, oder `0`, um sie nur beim Start zu lesen.                  |
| `ARKVORY_CORS_ORIGINS`       | API         | leer          | Kommagetrennte Liste von bis zu 16 Browser-Origins, für eine Konsole unter einer anderen Adresse. Nur HTTPS oder HTTP auf Loopback. |
| `ARKVORY_TRUSTED_PROXIES`    | API         | leer          | Bis zu 32 Reverse-Proxy-Adressen (IP oder CIDR). Nur diese dürfen die Client-Adresse mit `X-Forwarded-For` setzen.                  |

Integriertes HTTPS ist für native Installationen gedacht. Verwenden Sie mit Docker Compose einen Reverse-Proxy. Siehe [HTTPS](../install/https).

## Identität und Schlüssel {#identity-and-keys}

| Variable                     | Gelesen von | Standard     | Bedeutung                                                                                                                                                  |
| ---------------------------- | ----------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_KEYS_FILE`          | API, Worker | erforderlich | JSON-Datei mit Dateischlüsseln, etwa dem Wiederherstellungsschlüssel und dem Schlüssel für Health-Checks. Sie speichert SHA-256-Hashes, nie die Schlüssel. |
| `ARKVORY_ALLOW_REGISTRATION` | API         | aus          | `true` erlaubt Personen, auf der Anmeldeseite eigene Konten zu erstellen. Jeder andere Wert lässt es ausgeschaltet.                                        |

## Backups {#backups}

| Variable                          | Gelesen von    | Standard      | Bedeutung                                                                                                                                                                                      |
| --------------------------------- | -------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_BACKUP_VAULT`            | Agent          | nicht gesetzt | Verzeichnis eines initialisierten Backup-Speichers. Ohne diese Angabe läuft der Agent und meldet, dass kein Backup-Speicher konfiguriert ist. `arkvory configure --backup-vault` schreibt sie. |
| `ARKVORY_BACKUP_BYTES_PER_SECOND` | Agent          | keine Grenze  | Begrenzung der Kopierrate eines Backups, mindestens 65 536.                                                                                                                                    |
| `ARKVORY_BACKUP_POLL_SECONDS`     | Agent          | `15`          | Wie oft der Agent nach neuen Backup-Aufträgen sucht, 1–3600 Sekunden.                                                                                                                          |
| `ARKVORY_BACKUP_LEASE_SECONDS`    | Agent          | `60`          | Lease-Dauer, die verhindert, dass gleichzeitig ein zweiter Agent läuft, 2–3600 Sekunden.                                                                                                       |
| `ARKVORY_BACKUP_SNAPSHOT_SECONDS` | Agent          | `1800`        | Zeitlimit für den Teil eines Backups, der den Datenbank-Snapshot erstellt, 60–86 400 Sekunden.                                                                                                 |
| `ARKVORY_BACKUP_BARRIER_SECONDS`  | Agent          | `30`          | Wie lange ein Backup auf einen laufenden Bereinigungsschritt wartet, 1–600 Sekunden.                                                                                                           |
| `ARKVORY_RESTORE_DATABASE_URL`    | Restore-Befehl | nicht gesetzt | Zieldatenbank einer Wiederherstellung. Das ist sicherer als `--database-url`, weil andere Benutzer sie nicht in der Prozessliste sehen.                                                        |

Siehe [Backups](../operate/backups).

## Spiegel {#mirrors}

| Variable                  | Gelesen von | Standard      | Bedeutung                                                                                                              |
| ------------------------- | ----------- | ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_MIRRORS_FILE`    | API, Worker | nicht gesetzt | JSON-Datei, die gespiegelte Repositorys auflistet (bis zu 64). `arkvory configure --mirror` schreibt sie.              |
| `ARKVORY_MIRRORS_CA_FILE` | Worker      | nicht gesetzt | Absoluter Pfad zu einer PEM-Datei mit zusätzlichen Zertifizierungsstellen für die Quellserver. TLS wird immer geprüft. |

Siehe [Spiegel](../operate/mirrors).

## Updates und der Hub {#updates-and-the-hub}

| Variable                     | Gelesen von | Standard                   | Bedeutung                                                                                                                                                 |
| ---------------------------- | ----------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_HUB_URL`            | API         | `https://hub.proanima.net` | Adresse des ProAnimaStudio-Hubs, verwendet für das Feedback aus der Konsole. Ein leerer Wert schaltet das Feedback aus. Nur HTTPS oder HTTP auf Loopback. |
| `ARKVORY_HUB_PROJECT`        | API         | `arkvory`                  | Projektname im Hub.                                                                                                                                       |
| `ARKVORY_UPDATE_CONTROL_DIR` | API         | nicht gesetzt              | Verzeichnis, das die API mit dem Updater des Hosts teilt. Die Installer setzen es. Ohne diese Angabe kann die Konsole keine Updates anfordern.            |

Siehe [Updates](../install/updates).

## Protokollierung und Herunterfahren {#logging-and-shutdown}

| Variable                   | Gelesen von        | Standard | Bedeutung                                                                               |
| -------------------------- | ------------------ | -------- | --------------------------------------------------------------------------------------- |
| `ARKVORY_LOG_LEVEL`        | API, Worker, Agent | `info`   | `debug`, `info`, `warning` oder `error`.                                                |
| `ARKVORY_ACCESS_LOG`       | API                | `true`   | `true` schreibt für jede HTTP-Anfrage eine JSON-Zeile; `false` schaltet es aus.         |
| `ARKVORY_DRAIN_TIMEOUT_MS` | API                | `30000`  | Zeit, die laufende Anfragen nach einem Stoppsignal zum Abschluss haben, 0–3 600 000 ms. |

## Lese-Gateways {#read-gateways}

Ist eine dieser Variablen gesetzt, sind der Slot, die Anzahl der Slots und die gemeinsame Rate erforderlich. Die schreibende Instanz verwendet die Rolle `api` und den Slot `0`. Jedes Lese-Gateway verwendet die Rolle `reader` und einen eigenen Slot. Siehe [Lese-Gateways](../operate/read-gateways).

| Variable                                                 | Gelesen von | Standard      | Bedeutung                                                                                                           |
| -------------------------------------------------------- | ----------- | ------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_ROLE`                                           | API         | `api`         | `api` (die schreibende Instanz) oder `reader` (ein Lese-Gateway).                                                   |
| `ARKVORY_GATEWAY_SLOTS`                                  | API         | nicht gesetzt | Anzahl der Prozesse, die sich das Download-Budget teilen, 2–16.                                                     |
| `ARKVORY_GATEWAY_SLOT`                                   | API         | nicht gesetzt | Slot dieses Prozesses, von `0` bis Slots minus eins.                                                                |
| `ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND`               | API         | nicht gesetzt | Gesamte Download-Rate aller Prozesse. Jeder Slot erhält einen gleichen Anteil, mindestens 65 536 Bytes pro Sekunde. |
| `ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL` | API         | `0`           | Gesamte Download-Rate eines Kontos oder Schlüssels über alle Prozesse; `0` bedeutet keine Begrenzung.               |

## Watchdog {#watchdog}

| Variable                   | Gelesen von        | Standard | Bedeutung                                                                                                                                                                  |
| -------------------------- | ------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_WATCHDOG_SECONDS` | API, Worker, Agent | `60`     | Ein Prozess, der so lange blockiert bleibt, beendet sich selbst, und der Dienstmanager startet ihn neu. `0` schaltet ihn aus (für einen Debugger); sonst 10–3600 Sekunden. |

Siehe [Selbstheilung](../operate/self-healing).

## Kommandozeilen-Client {#command-line-client}

| Variable              | Gelesen von | Standard                             | Bedeutung                                                                        |
| --------------------- | ----------- | ------------------------------------ | -------------------------------------------------------------------------------- |
| `ARKVORY_BASE_URL`    | CLI         | Profil, dann `http://127.0.0.1:8080` | Serveradresse. Ist sie gesetzt, muss auch der Schlüssel aus der Umgebung kommen. |
| `ARKVORY_TOKEN`       | CLI         | nicht gesetzt                        | Der Schlüssel selbst. Er hat Vorrang vor einer Schlüsseldatei.                   |
| `ARKVORY_TOKEN_FILE`  | CLI         | Schlüsseldatei des Profils           | Pfad zu einer Datei, die den Schlüssel enthält.                                  |
| `ARKVORY_CLI_HOME`    | CLI         | `~/.config/arkvory`                  | Verzeichnis der Datei `profiles.json`.                                           |
| `ARKVORY_CLI_VERSION` | CLI         | `development`                        | Version, die `--version` ausgibt. Release-Pakete enthalten sie.                  |

Siehe [Kommandozeilen-Client](../protocols/cli).

## Installer-Skripte {#installer-scripts}

Diese Variablen liest `install.sh` unter Linux. Unter Windows verwendet `install.ps1` stattdessen Parameter wie `-Root` und `-Artifact`.

| Variable                  | Standard                | Bedeutung                                                                                            |
| ------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `ARKVORY_INSTALL_ROOT`    | `/opt/proanima-arkvory` | Installationsverzeichnis. Legen Sie eine native Installation nicht in einem Home-Verzeichnis ab.     |
| `ARKVORY_ARTIFACT_DIR`    | nicht gesetzt           | Verzeichnis eines entpackten Releases. Das Skript installiert es, statt ein Release herunterzuladen. |
| `ARKVORY_RELEASE_VERSION` | neuestes stabiles       | Exakte stabile Version, die installiert werden soll, etwa `1.2.3`.                                   |

## Vom Installer gesetzt {#set-by-the-installer}

Der Installer setzt diese Variablen für seine eigenen Hilfsprozesse. Setzen Sie sie nicht selbst.

| Variable                  | Bedeutung                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `ARKVORY_IMAGE`           | Container-Image des aktuellen Releases, in `config/compose.env`.                                       |
| `ARKVORY_SERVICE_WRAPPER` | Pfad zum Wrapper des Windows-Backup-Dienstes, verwendet, wenn der Dienst angehalten ist.               |
| `ARKVORY_PROTECT_ROOT`    | Installationsverzeichnis, dessen Zugriffsregeln unter Windows gesetzt werden.                          |
| `ARKVORY_ENGINE_USER`     | Gibt unter Windows mit Docker Desktop dem aktuellen Benutzer Zugriff auf das Installationsverzeichnis. |

## Verwandte Seiten {#related-pages}

- [Konfiguration](../install/configuration)
- [Monitoring](../operate/monitoring)
- [Sicherheit](../operate/security)
- [Speicher](../operate/storage)
