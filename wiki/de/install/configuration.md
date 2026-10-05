---
title: Konfiguration
description: 'Wo die Konfiguration von Arkvory liegt, welche Lebenszyklus-Befehle sie ändern, die wichtigsten Einstellungen nach Aufgabe und wie Sie eine Änderung anwenden.'
---

# Konfiguration

Arkvory kennt zwei Arten von Einstellungen:

- **Servereinstellungen** sind `ARKVORY_*`-Variablen in der Datei `config/runtime.json`. Sie legen die Adresse, die Limits, den Speicher und Ähnliches fest. Die API, der Worker und der Backup-Agent lesen sie beim Start.
- **Installationsrichtlinie** sind die Update-Richtlinie, die HTTPS-Dateien, der Backup-Speicher und die Spiegel. Sie ändern sie mit dem Befehl `arkvory configure`. Der Befehl prüft die Änderung, startet neu, was neu gestartet werden muss, und stellt den alten Zustand wieder her, wenn die Dienste nicht starten.

Diese Seite zeigt, wo die Dateien liegen, welche Befehle es gibt und wie die wichtigsten Einstellungen wirken. Die vollständige Liste der Variablen mit Standardwerten und Bereichen steht unter [Umgebungsvariablen](../reference/environment).

## Wo die Konfiguration liegt {#where-it-lives}

Das Installationsverzeichnis enthält alles. Unter Windows ist es `C:\ProgramData\ProAnima\Arkvory`, unter Linux `/opt/proanima-arkvory`. Eine Compose-Installation verwendet dasselbe Verzeichnis auf dem Host. Die folgenden Pfade sind relativ zum Installationsverzeichnis.

| Datei                                                                          | Inhalt                                                                                                                          | Ändern mit                                                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `config/runtime.json`                                                          | Die Servereinstellungen. Schlüssel beginnen mit `ARKVORY_`, und jeder Wert ist eine Zeichenkette. Enthält das Datenbankpasswort | Von Hand oder mit `configure`                                              |
| `config/keys.json`                                                             | SHA-256-Hashes des Wiederherstellungsschlüssels und des Bereitschaftsschlüssels. Enthält nie einen Schlüssel                    | Nur zum [Ersetzen des Wiederherstellungsschlüssels](#replace-recovery-key) |
| `config/bootstrap-token.txt`                                                   | Der Wiederherstellungsschlüssel                                                                                                 | Nur zum Ersetzen                                                           |
| `config/health-token.txt`                                                      | Der Schlüssel, den die Installationswerkzeuge für die Bereitschaftsprüfung verwenden                                            | Nicht ändern                                                               |
| `config/hub.json`                                                              | Die Hub-Adresse, der Update-Kanal und die Einstellung für Statistiken                                                           | Mit `configure`                                                            |
| `config/install-id`                                                            | Eine zufällige Installations-ID, die nur bei eingeschalteten Statistiken an den Hub gesendet wird                               | Nicht ändern                                                               |
| `config/mirrors/`                                                              | Die Spiegelliste und die Schlüssel, die der Worker für die Quellen verwendet                                                    | Mit `configure --mirror`                                                   |
| `installation.json`                                                            | Der Modus, die Engine, die Einstellung für automatische Updates, das Anheften der Version und das installierte Release          | Nur mit Befehlen                                                           |
| `github-token.txt`                                                             | Optionales GitHub-Token für Release-Downloads. Siehe [Updates](./updates#hub-unreachable)                                       | Von Hand                                                                   |
| `config/compose.env`, `config/compose.vault.yml`, `config/compose.mirrors.yml` | Nur bei Compose: das Image, der Backup-Speicher-Mount und der Spiegel-Mount                                                     | Nur mit Befehlen                                                           |

Bei einer nativen Linux-Installation gehören `runtime.json` und `keys.json` `root:arkvory` mit Modus `0640`, und die Dateien mit Anmeldedaten in `config/` kann nur `root` lesen. Eine Compose-Installation verwendet Modus `0644` für die Dateien, die die Container lesen: siehe [Docker Compose](./docker#owners). Behalten Sie die Besitzer und Modi bei, die der Installer gesetzt hat.

## Lebenszyklus-Befehle {#lifecycle-commands}

Alle Befehle benötigen Administratorrechte und die Option `--root` mit dem Installationsverzeichnis.

| Installation                  | So führen Sie einen Befehl aus                                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux-Paket                   | `sudo arkvory <command> --root /opt/proanima-arkvory`                                                                                                                  |
| Windows, grafischer Installer | In einer PowerShell mit erhöhten Rechten: `& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' <command> --root C:\ProgramData\ProAnima\Arkvory`                         |
| Skriptinstallation, Compose   | `sudo <root>/runtime/node-v24.21.0-linux-x64/bin/node <root>/manage.mjs <command> --root <root>`. Unter Windows verwenden Sie `runtime\node-v24.21.0-win-x64\node.exe` |

`arkvory help` listet die Befehle ohne besondere Rechte auf. Die Beispiele auf dieser Seite verwenden die Kurzform `arkvory <command>`.

| Befehl                          | Verwendung                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                        | Zeigt den Installationsmodus, die Engine, die Einstellung für automatische Updates, das Anheften und das installierte Release         |
| `configure`                     | Ändert eine Richtlinie. Siehe [Der Befehl configure](#configure-command)                                                              |
| `update`                        | Installiert jetzt ein neueres stabiles Release. Siehe [Updates](./updates)                                                            |
| `upgrade`                       | Installiert ein Release, das das Datenbankschema ändert, mit einem eigenen Backup-Nachweis. Siehe [Updates](./updates#manual-upgrade) |
| `recover`                       | Schließt ein unterbrochenes Update ab. Siehe [Updates](./updates#recover-update)                                                      |
| `finish-install`                | Setzt eine unterbrochene Erstinstallation fort                                                                                        |
| `updates-connect`               | Verbindet die Konsole und den Update-Timer und registriert Dienste, die einer alten Installation fehlen                               |
| `updates-poll`, `updates-reset` | Werden vom Update-Timer und zur Wiederherstellung ausgeführt. Siehe [Updates](./updates#recover-update)                               |

Es läuft immer nur ein Befehl gleichzeitig. Ein zweiter Befehl bricht mit `Installation is locked` ab. Geben Sie niemals einen Schlüssel oder ein Passwort in einer Befehlsoption an: Verwenden Sie Dateien.

### Der Befehl configure {#configure-command}

Ein Aufruf ändert eine Art von Einstellung. Die vier Arten lassen sich nicht in einem Aufruf mischen.

| Art             | Optionen                                                                                                                                                                            | Wirkung                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| HTTPS           | `--tls-cert FILE --tls-key FILE [--listen-host ADDRESS]`, oder `--tls-off [--listen-host ADDRESS]`                                                                                  | Schaltet das eingebaute HTTPS ein oder aus. Startet die Dienste neu und prüft die Bereitschaft. Siehe [HTTPS](./https)       |
| Backup-Speicher | `--backup-vault DIRECTORY [--init-vault]`, oder `--backup-vault-off`                                                                                                                | Verbindet oder trennt den Backup-Speicher. Startet nur den Backup-Agent neu. Siehe [Backups](../operate/backups)             |
| Spiegel         | `--mirror REPOSITORY --mirror-upstream URL --mirror-token-file FILE [--mirror-source REPOSITORY] [--mirror-stages LIST] [--mirror-ca-file FILE]`, oder `--mirror-detach REPOSITORY` | Macht ein Repository zu einem Spiegel oder Importziel oder wieder zu einem gewöhnlichen. Siehe [Spiegel](../operate/mirrors) |
| Updates         | `--enable-updates`, `--disable-updates`, `--pin [--version X.Y.Z]`, `--unpin`, `--update-channel stable` oder `beta`, `--statistics on` oder `off`, `--hub-url URL`, `--hub-off`    | Ändert die Update-Richtlinie. Siehe [Updates](./updates)                                                                     |

HTTPS-, Backup-Speicher- und Spiegel-Änderungen starten Dienste neu und stellen die vorherige Konfiguration wieder her, wenn die Änderung nicht funktioniert. Update-Optionen schreiben nur `installation.json` und `hub.json` neu; sie starten nichts neu. Dateipfade sind absolut.

## Einstellungen nach Aufgabe {#settings-by-task}

### Adresse und Port {#address-and-port}

| Variable       | Standard    | Bedeutung                            |
| -------------- | ----------- | ------------------------------------ |
| `ARKVORY_HOST` | `127.0.0.1` | Die Adresse, auf der die API lauscht |
| `ARKVORY_PORT` | `8080`      | Der TCP-Port                         |

Mit dem Standardwert können sich nur Programme auf dem Server verbinden. Um andere Computer zuzulassen, wählen Sie einen von zwei Wegen:

- **Eingebautes HTTPS.** `arkvory configure --tls-cert … --tls-key … --listen-host 0.0.0.0`. Siehe [HTTPS](./https#built-in-tls).
- **Ein Reverse-Proxy auf einem anderen Computer.** Setzen Sie `ARKVORY_HOST` auf die Adresse der Netzwerkschnittstelle für den Proxy und listen Sie den Proxy in `ARKVORY_TRUSTED_PROXIES` auf. Bearbeiten Sie `runtime.json`, oder führen Sie `arkvory configure --tls-off --listen-host <address>` aus. Beschränken Sie den Port mit einer Firewall auf den Proxy.

`--listen-host` allein wird abgelehnt: Verwenden Sie es mit den TLS-Dateien oder mit `--tls-off`. Fügen Sie nach `--tls-off` `--listen-host 127.0.0.1` hinzu, um zum Loopback zurückzukehren, sonst lauscht die API weiterhin auf der festgelegten Adresse.

Wenn die API auf einer Nicht-Loopback-Adresse ohne TLS und ohne vertrauenswürdigen Proxy lauscht, protokolliert sie beim Start die Warnung `http.plaintext_exposed`. Senden Sie niemals Schlüssel über unverschlüsseltes HTTP zwischen Computern.

Unter Linux laufen die Dienste unter einem unprivilegierten Konto, das normalerweise nicht auf einem Port unter 1024 lauschen kann. Die Verknüpfungen zur Konsole (Startmenü, Menüeintrag) zeigen weiterhin auf Port 8080. Die Lebenszyklus-Befehle folgen der Adresse und dem Port in `runtime.json`. Bei einer Compose-Installation sind die Adresse und der Port fest: siehe [Docker Compose](./docker#ports).

### Öffentliche Adresse und weitergeleitete Header {#public-address}

Es gibt keine Einstellung für eine öffentliche URL. Der Server erzeugt absolute Links, etwa die Links in Git-LFS- und npm-Antworten, aus der Anfrage: Das Schema ist `https`, wenn die Verbindung TLS verwendet oder der Proxy `X-Forwarded-Proto: https` sendet, und der Host ist der `Host`-Header. Ein in `ARKVORY_TRUSTED_PROXIES` aufgeführter Proxy kann den Host auch mit `X-Forwarded-Host` setzen. Ihr Proxy muss daher den öffentlichen Namen weiterleiten. Siehe [HTTPS](./https#reverse-proxy).

`ARKVORY_TRUSTED_PROXIES` akzeptiert bis zu 32 Adressen oder CIDR-Bereiche, durch Kommas getrennt. Nur diese Peers können die Client-Adresse mit `X-Forwarded-For` und die Anfrage-ID mit `X-Request-Id` setzen. Ohne die Liste scheint jeder Client von der Adresse des Proxys zu kommen, und das Anmeldelimit zählt sie als einen.

### Browser auf einer anderen Adresse {#browsers}

`ARKVORY_CORS_ORIGINS` listet bis zu 16 Origins einer Konsole oder einer anderen Webanwendung auf, die auf einer anderen Adresse läuft, durch Kommas getrennt. Jeder Origin hat ein Schema, einen Host und einen optionalen Port, aber keinen Pfad. Er muss HTTPS verwenden; unverschlüsseltes HTTP wird nur für `localhost`, `127.0.0.1` und `[::1]` akzeptiert. Siehe [HTTPS](./https#console-api-address). `ARKVORY_ALLOW_REGISTRATION=true` lässt Personen auf der Anmeldeseite eigene Konten anlegen; standardmäßig ist es ausgeschaltet.

### Datenbank {#database}

| Variable                     | Standard              | Bedeutung                                                                               |
| ---------------------------- | --------------------- | --------------------------------------------------------------------------------------- |
| `ARKVORY_DATABASE_URL`       | vom Installer gesetzt | Die PostgreSQL-Verbindungs-URL. Eine verwaltete Datenbank lauscht auf `127.0.0.1:54329` |
| `ARKVORY_DATABASE_POOL_SIZE` | `10`                  | Die Größe des Verbindungspools der API, von 4 bis 200                                   |

Richten Sie eine Installation nicht auf eine andere Datenbank. Die gespeicherten Dateien und der Katalog gehören zusammen. Der Umzug auf eine neue Datenbank ist eine Wiederherstellung aus einem Backup: siehe [Backups](../operate/backups). Setzen Sie bei einem externen PostgreSQL `max_connections` hoch genug für den Pool der API, eine Verbindung pro gleichzeitigem Upload für Schreibsperren, 5 für den Worker und die Verbindungen des Backup-Agents.

### Speicherverzeichnis und freier Platz {#storage}

| Variable                        | Standard      | Bedeutung                                                                                                                  |
| ------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_DATA_DIR`              | `<root>/data` | Wo Dateiinhalte gespeichert werden. Vom Installer gesetzt. Verwenden Sie eine lokale Festplatte                            |
| `ARKVORY_CAPACITY_BYTES`        | 10 TiB        | Das Maximum, das alle reservierten Inhalte verwenden dürfen. Es ist ein Limit für Reservierungen, keine Festplattenmessung |
| `ARKVORY_STORAGE_RESERVE_BYTES` | 1 GiB         | Freier Platz, den Uploads nie verwenden. `0` schaltet die Reserve aus                                                      |
| `ARKVORY_MAX_OBJECT_BYTES`      | etwa 10 TiB   | Das größte einzelne Objekt. Legen Sie einen niedrigeren Wert fest, um die Dateigröße zu begrenzen                          |

Lassen Sie `ARKVORY_DATA_DIR` dort, wo der Installer es gesetzt hat. Die Linux-Units können nur in `data/`, `logs/` und `updates/inbox/` des Installationsverzeichnisses schreiben, daher ist ein anderer Pfad für sie schreibgeschützt. Um eine größere Festplatte zu verwenden, stoppen Sie die Dienste, kopieren Sie den Inhalt auf die neue Festplatte, mounten Sie die Festplatte unter `data/` mit dem Besitzer `arkvory` und starten Sie die Dienste. Unter Windows und Linux können Sie bei einer Skriptinstallation auch das Installationsverzeichnis selbst wählen (`-Root`, `ARKVORY_INSTALL_ROOT`). Siehe [Speicher](../operate/storage).

### Übertragungslimits {#limits}

Die Limits gelten für einen API-Prozess. Eine Rate von `0` bedeutet kein Limit.

| Variable                              | Standard  | Bedeutung                                                          |
| ------------------------------------- | --------- | ------------------------------------------------------------------ |
| `ARKVORY_MAX_UPLOADS`                 | `2`       | Gleichzeitige Uploads, 1 bis 32                                    |
| `ARKVORY_MAX_DOWNLOADS`               | `16`      | Gleichzeitige Downloads, 1 bis 256                                 |
| `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`   | `1`       | Gleichzeitige Uploads eines Kontos oder Schlüssels                 |
| `ARKVORY_MAX_DOWNLOADS_PER_PRINCIPAL` | `4`       | Gleichzeitige Downloads eines Kontos oder Schlüssels               |
| `ARKVORY_UPLOAD_BYTES_PER_SECOND`     | `0`       | Gesamte Upload-Rate in Bytes pro Sekunde                           |
| `ARKVORY_DOWNLOAD_BYTES_PER_SECOND`   | `0`       | Gesamte Download-Rate in Bytes pro Sekunde                         |
| `ARKVORY_UPLOAD_DEADLINE_MS`          | `1800000` | Die längste Dauer einer Upload-Anfrage, 30 Minuten                 |
| `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`      | `30000`   | Eine Upload-Anfrage, die so lange keine Daten sendet, wird beendet |

Ein Proxy vor der API muss eine Anfrage mindestens so lange zulassen wie `ARKVORY_UPLOAD_DEADLINE_MS`. Siehe [HTTPS](./https#reverse-proxy). Alle anderen Limits, etwa die Warteschlange und die Raten pro Konto, stehen unter [Umgebungsvariablen](../reference/environment#transfers-and-bandwidth).

### Backups und Spiegel {#backups-mirrors}

Verwenden Sie `configure` für beides. `--backup-vault` schreibt `ARKVORY_BACKUP_VAULT`, gewährt dem Dienstkonto Zugriff auf das Verzeichnis, startet nur den Backup-Agent neu und behält die Änderung nur, wenn der Agent den Backup-Speicher als verfügbar meldet. Der Backup-Speicher muss außerhalb des Installationsverzeichnisses und außerhalb des Speichers liegen. `--mirror` schreibt `ARKVORY_MIRRORS_FILE` und die Schlüsseldateien, startet die API und den Worker neu und prüft die Quelle mit Ihrem Schlüssel, bevor es etwas ändert.

### Updates und der Hub {#updates-and-hub}

Die Update-Richtlinie steht in `installation.json` und `config/hub.json`. Die Optionen stehen unter [Der Befehl configure](#configure-command), ihre Bedeutung unter [Updates](./updates). `ARKVORY_HUB_URL` in `runtime.json` ist getrennt: Es legt fest, wohin die Konsole Feedback sendet. `configure --hub-url` oder `--hub-off` ändern beides, und die Feedback-Adresse folgt nach dem nächsten Neustart der Dienste.

### Protokolle und Herunterfahren {#logs-and-shutdown}

| Variable                   | Standard | Bedeutung                                                                                                      |
| -------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_LOG_LEVEL`        | `info`   | `debug`, `info`, `warning` oder `error`. Die Stufen `warning` und `error` verbergen auch das Zugriffsprotokoll |
| `ARKVORY_ACCESS_LOG`       | `true`   | Ein JSON-Datensatz für jede HTTP-Anfrage. Die Query-Zeichenkette wird nie geschrieben                          |
| `ARKVORY_DRAIN_TIMEOUT_MS` | `30000`  | Nach einer Stopp-Anforderung die Zeit, die laufende Anfragen zum Abschluss haben                               |

Die Supervisoren geben einem Dienst 120 Sekunden zum Stoppen. Wenn Sie eine Drain-Zeit von mehr als etwa 90 Sekunden festlegen, erhöhen Sie auch das Stopp-Timeout des Dienstmanagers: `TimeoutStopSec` in den systemd-Units, das Stopp-Timeout der Windows-Dienste und `stop_grace_period` in Compose. Siehe [Monitoring](../operate/monitoring).

## Eine Änderung anwenden {#apply-change}

`configure` wendet seine eigene Änderung an. Für alles, was Sie in `config/runtime.json` bearbeiten:

1. Machen Sie eine Kopie der Datei, zum Beispiel `sudo cp -p /opt/proanima-arkvory/config/runtime.json /root/runtime.json.bak`. Sie enthält das Datenbankpasswort: Bewahren Sie die Kopie privat auf.
2. Bearbeiten Sie die Datei direkt. Halten Sie das JSON gültig, wobei jeder Wert eine Zeichenkette ist.
3. Prüfen Sie Besitzer und Modus. Unter Linux müssen sie `root:arkvory` und `0640` bleiben. Reparieren Sie sie mit `sudo chown root:arkvory runtime.json` und `sudo chmod 0640 runtime.json`.
4. Starten Sie die Dienste neu. Die Einstellungen werden nur beim Start gelesen.

   ```bash
   sudo systemctl restart arkvory-api arkvory-worker arkvory-backup
   ```

   ```powershell
   Restart-Service Arkvoryapi, Arkvoryworker, Arkvorybackup
   ```

   Bei einer Compose-Installation stoppen und starten Sie die Container mit dem Befehl `compose` aus [Docker Compose](./docker#manage):

   ```bash
   "${compose[@]}" stop --timeout 120 backup worker api
   "${compose[@]}" up -d --wait api worker
   "${compose[@]}" up -d backup
   ```

5. Prüfen Sie das Ergebnis. Ein Wert außerhalb seines Bereichs beendet den Prozess beim Start mit einer Meldung, die die Variable nennt, nie ihren Wert. Unter Linux lesen Sie sie mit `journalctl -u arkvory-api -n 50`. Arkvory fällt in diesem Fall nicht auf einen Standardwert zurück.

Ein Neustart unterbricht laufende Übertragungen. Clients setzen sie fort.

## Den Wiederherstellungsschlüssel ersetzen {#replace-recovery-key}

Ersetzen Sie den Wiederherstellungsschlüssel, wenn Sie vermuten, dass jemand `config/bootstrap-token.txt` gelesen hat. Der Schlüssel ist an zwei Stellen gespeichert, die sich zusammen ändern müssen: Die Datei `bootstrap-token.txt` enthält den Schlüssel, und der Eintrag `bootstrap-owner` in `keys.json` enthält seinen SHA-256-Wert. Lassen Sie den Eintrag `deployment-health` unverändert.

1. Machen Sie eine Kopie von `config/keys.json`.
2. Speichern Sie dieses Skript als `replace-recovery-key.mjs`:

   ```js
   import { createHash, randomBytes } from 'node:crypto';
   import { readFileSync, writeFileSync } from 'node:fs';

   const directory = process.argv[2];
   const token = randomBytes(32).toString('hex');
   const keys = JSON.parse(readFileSync(`${directory}/keys.json`, 'utf8'));
   const owner = keys.find((key) => key.id === 'bootstrap-owner');
   if (!owner) throw new Error('No bootstrap-owner entry');
   owner.sha256 = createHash('sha256').update(token).digest('hex');
   writeFileSync(`${directory}/keys.json`, JSON.stringify(keys, null, 2));
   writeFileSync(`${directory}/bootstrap-token.txt`, token);
   ```

3. Führen Sie es als `root` oder Administrator mit dem Node.js der Installation aus. Das Skript schreibt in die vorhandenen Dateien, sodass die Besitzer und die Zugriffsregeln unverändert bleiben.

   ```bash
   sudo /opt/proanima-arkvory/runtime/node ./replace-recovery-key.mjs /opt/proanima-arkvory/config
   ```

   ```powershell
   & 'C:\ProgramData\ProAnima\Arkvory\runtime\node.exe' .\replace-recovery-key.mjs 'C:\ProgramData\ProAnima\Arkvory\config'
   ```

   Verwenden Sie nach einer Skriptinstallation stattdessen das Node.js unter `runtime\node-v24.21.0-…`.

4. Starten Sie die Dienste neu, wie unter [Eine Änderung anwenden](#apply-change) beschrieben.
5. Lesen Sie den neuen Schlüssel aus `config/bootstrap-token.txt` und löschen Sie das Skript und die Kopie von `keys.json`.

Konten, persönliche Token und Dienstschlüssel sind nicht betroffen. Sie liegen in der Datenbank.
