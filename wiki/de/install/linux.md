---
title: Linux
description: 'Installieren Sie Arkvory unter Linux aus dem Paket .deb oder .rpm, starten Sie es, betreiben Sie die systemd-Dienste, aktualisieren und entfernen Sie es.'
---

# Linux

Es gibt zwei Wege, Arkvory unter Linux zu betreiben:

- **Paket** `Arkvory-amd64.deb` oder `Arkvory-x86_64.rpm`. Empfohlen. Es installiert systemd-Dienste und einen eigenen PostgreSQL-Cluster, den Arkvory verwaltet. Ihre Paketverwaltung liefert die PostgreSQL-Programme.
- **Skript** `install.sh`. Es installiert dieselben Dienste, verwendet aber einen vorhandenen PostgreSQL-Server. Es unterstützt auch arm64. Siehe [Vorhandenes PostgreSQL verwenden](#existing-postgresql).

Für Docker siehe [Docker Compose](./docker). Für einen ersten Rundgang durch die Konsole siehe den [Schnellstart](../guide/quick-start).

## Anforderungen {#requirements}

| Element                   | Anforderung                                                                                                                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prozessor                 | x64 für die Pakete. Es gibt keine arm64-Pakete: Verwenden Sie `install.sh` auf arm64                                                                                                                                                                                                                   |
| Init-System               | systemd. OpenRC, runit und andere Init-Systeme werden nicht unterstützt                                                                                                                                                                                                                                |
| C-Bibliothek              | glibc 2.28 oder neuer. Alpine Linux (musl) wird nicht unterstützt                                                                                                                                                                                                                                      |
| Getestete Distributionen  | Ubuntu 24.04 für das `.deb`, Fedora 44 für das `.rpm`. Andere systemd-Distributionen, die die unten genannten Abhängigkeiten erfüllen, sind nicht getestet                                                                                                                                             |
| Abhängigkeiten des `.deb` | `postgresql` 16 oder neuer, `systemd`, `python3`, `ca-certificates`, `libc6` 2.28 oder neuer, `libstdc++6`, `libgcc-s1`, `libatomic1`                                                                                                                                                                  |
| Abhängigkeiten des `.rpm` | `postgresql-server` 16 oder neuer, `systemd`, `python3`, `ca-certificates`, `glibc` 2.28 oder neuer, `libstdc++`, `libatomic`                                                                                                                                                                          |
| PostgreSQL-Programme      | Version 16 bis 19. Der Installationsschritt durchsucht `/usr/lib/postgresql/*/bin`, `/usr/pgsql-*/bin`, `/usr/bin` und `/usr/lib/pgsql/bin` und nimmt die höchste gefundene Version. Wenn Ihre Distribution nur eine ältere Version anbietet, fügen Sie zuerst ein neueres PostgreSQL-Repository hinzu |
| Konto                     | `root` oder ein Benutzer, der `sudo` ausführen kann                                                                                                                                                                                                                                                    |
| Freie Ports               | 8080 und 54329 auf `127.0.0.1`                                                                                                                                                                                                                                                                         |
| Dateispeicher             | Ein lokales Dateisystem, das Hardlinks unterstützt. Verwenden Sie keine Netzwerkfreigabe                                                                                                                                                                                                               |

Das Paket enthält Node.js 24. Die Installation braucht keinen Internetzugang über das hinaus, was Ihre Paketverwaltung für die Abhängigkeiten verwendet.

Das Paket ändert niemals einen vorhandenen PostgreSQL-Cluster oder -Dienst. Arkvory startet seinen eigenen Cluster aus den PostgreSQL-Programmen.

## Das Paket installieren {#install-package}

1. Laden Sie das Paket für Ihre Distribution von [GitHub Releases](https://github.com/ProAnima/Arkvory/releases) herunter, zusammen mit `native-linux.json` desselben Releases.
2. Vergleichen Sie den SHA-256 des Pakets mit dem Wert in `native-linux.json`. Die Pakete sind nicht mit einem Herausgeberschlüssel signiert, daher ist diese Prüfung der einzige Nachweis dessen, was Sie heruntergeladen haben.
3. Installieren Sie das Paket. Behalten Sie das `./` vor dem Dateinamen bei: Es sagt der Paketverwaltung, dass die Datei lokal ist. Unter Debian und Ubuntu:

```bash
sudo apt install ./Arkvory-amd64.deb
```

Unter Fedora und RPM-kompatiblen Systemen:

```bash
sudo dnf install ./Arkvory-x86_64.rpm
```

Die Paketverwaltung installiert die Abhängigkeiten, dann konfiguriert sich Arkvory selbst. Es:

1. kopiert Node.js nach `/opt/proanima-arkvory/runtime/node`,
2. erstellt die zwei Dienstkonten, die Konfiguration, die Schlüssel und den Wiederherstellungsschlüssel,
3. erstellt und startet den PostgreSQL-Cluster und führt die Datenbankmigrationen aus,
4. registriert und startet die Dienste und den Update-Timer,
5. wartet, bis die API ihre Bereitschaftsprüfung dreimal hintereinander beantwortet.

Am Ende gibt es die Konsolenadresse und den Pfad des Wiederherstellungsschlüssels aus. Wenn ein Schritt fehlschlägt, bricht die Installation mit einem Fehler ab. Siehe [Fehlerbehebung](#troubleshooting).

Automatische Updates sind nach der Installation ausgeschaltet. Wie Sie sie einschalten, steht unter [Updates](./updates).

## Was das Paket erstellt {#what-package-creates}

### Dateien und Verzeichnisse {#files}

| Pfad                                                            | Inhalt                                                                                                                                                                              |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/usr/lib/proanima-arkvory/`                                    | Paketinhalt: Node.js, die Release-Dateien und der Installer. Gehört dem Paket                                                                                                       |
| `/usr/bin/arkvory`                                              | Der Verwaltungsbefehl. Siehe [Der Befehl arkvory](#arkvory-command)                                                                                                                 |
| `/usr/share/applications/arkvory.desktop`                       | Menüeintrag, der die Konsole auf einem Desktop öffnet. Ein Server ohne Desktop verwendet ihn nicht                                                                                  |
| `/opt/proanima-arkvory/`                                        | Das Installationsverzeichnis: Konfiguration, Daten, Datenbank, Programmcode jeder Version. Seine Struktur ist unter [Installation auswählen](./#installation-directory) beschrieben |
| `/etc/systemd/system/arkvory-*.service`, `arkvory-update.timer` | Die Service-Units und der Update-Timer                                                                                                                                              |

Das Installationsverzeichnis gehört `root:arkvory` mit Modus `0711`. Darin ist `config/` `0750 root:arkvory`, `data/` und `logs/` gehören `arkvory`, und `database/` gehört `arkvory-db` mit Modus `0700`. Der Wiederherstellungsschlüssel und die Dateien mit dem Datenbankpasswort kann nur `root` lesen.

### Konten {#accounts}

| Konto        | Führt aus                 | Hinweise                                                                            |
| ------------ | ------------------------- | ----------------------------------------------------------------------------------- |
| `arkvory`    | API, Worker, Backup-Agent | Systemkonto, keine Login-Shell, Home `/opt/proanima-arkvory/data`                   |
| `arkvory-db` | Die Datenbank             | Systemkonto, keine Login-Shell. Das API-Konto kann die Datenbankdateien nicht lesen |

### Dienste {#services}

| Unit                   | Läuft als                                   | Neustartrichtlinie                                              |
| ---------------------- | ------------------------------------------- | --------------------------------------------------------------- |
| `arkvory-database`     | `arkvory-db`                                | `on-failure`, nach 10 Sekunden                                  |
| `arkvory-api`          | `arkvory`                                   | `always`, nach 10 Sekunden                                      |
| `arkvory-worker`       | `arkvory`                                   | `always`, nach 10 Sekunden                                      |
| `arkvory-backup`       | `arkvory`                                   | `always`, nach 10 Sekunden                                      |
| `arkvory-update.timer` | startet `arkvory-update.service` als `root` | Jede Minute. Die Aufgabe prüft auf Update-Anfragen und Releases |

Alle Units starten beim Booten (`multi-user.target`). Sie erlauben 120 Sekunden zum Stoppen. Sie laufen mit `NoNewPrivileges`, einem privaten `/tmp`, einem schreibgeschützten Dateisystem außerhalb ihrer eigenen Verzeichnisse und ohne Zugriff auf `/home`. Die API und der Worker können nur in `data/`, `logs/` und `updates/inbox/` des Installationsverzeichnisses schreiben. Der Backup-Agent liest den Speicher und schreibt nur in den Backup-Speicher. Weil `/home` vor den Units verborgen ist, legen Sie Zertifikate, Backup-Speicher oder das Datenverzeichnis niemals unter einem Home-Verzeichnis ab.

Ein Dienst, der ohne Ihre Anforderung stoppt, startet nach 10 Sekunden neu. Ein Prozess, dessen Hauptthread 60 Sekunden lang hängt, beendet sich selbst und startet neu. Eine fehlgeschlagene Bereitschaftsprüfung allein startet einen Dienst nicht neu. Siehe [Selbstheilung](../operate/self-healing).

### Ports {#ports}

| Port      | Verwendung                        | Freigabe                                                |
| --------- | --------------------------------- | ------------------------------------------------------- |
| 8080/TCP  | API und Konsole                   | Nur `127.0.0.1`, bis Sie [HTTPS](./https) konfigurieren |
| 54329/TCP | Der verwaltete PostgreSQL-Cluster | Nur `127.0.0.1`. Die Nummer ist fest                    |

## Erster Start und Erste Schritte {#first-start}

1. Prüfen Sie, dass die Dienste laufen:

   ```bash
   systemctl status arkvory-database arkvory-api arkvory-worker arkvory-backup
   ```

2. Lesen Sie den Wiederherstellungsschlüssel. Nur `root` kann ihn lesen.

   ```bash
   sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
   ```

3. Öffnen Sie `http://127.0.0.1:8080/console/#onboarding`. Leiten Sie auf einem entfernten Server zuerst den Port weiter und öffnen Sie die Adresse auf Ihrem eigenen Computer:

   ```bash
   ssh -L 8080:127.0.0.1:8080 admin@arkvory.example
   ```

4. Öffnen Sie in der Konsole [[ui:navStart]] und klappen Sie [[ui:welcomeOwner]] auf. Fügen Sie den Schlüssel in [[ui:welcomeRecovery]] ein, geben Sie den Besitzernamen und ein Passwort mit mindestens 12 Zeichen ein und wählen Sie [[ui:welcomeCreate]]. Der Name hat 3 bis 64 Zeichen: lateinische Buchstaben, Ziffern, Punkt, Bindestrich oder Unterstrich.
5. Melden Sie sich mit dem neuen Namen und Passwort an.

Der Besitzer ist der erste Administrator. Der Wiederherstellungsschlüssel bleibt auf dem Server: Löschen Sie die Datei nicht und kopieren Sie sie nicht auf Clients oder CI-Systeme. Die Installationswerkzeuge lesen ihn. Erstellen Sie für die tägliche Arbeit Konten und Dienstschlüssel. Siehe [Konten und Zugriff](../use/accounts) und [Sicherheit](../operate/security).

Bevor sich Clients von anderen Computern verbinden, konfigurieren Sie [HTTPS](./https). Verbinden Sie dann einen Backup-Speicher und führen Sie ein erstes Backup aus: siehe [Backups](../operate/backups).

Um von Ihrem eigenen Computer aus auf einem Server zu installieren, können Sie stattdessen Arkvory Remote Setup verwenden. Siehe [Installation auswählen](./#remote-installation-over-ssh).

## Der Befehl arkvory {#arkvory-command}

Das Paket installiert `/usr/bin/arkvory`. `arkvory help` listet alle Befehle auf und braucht keine besonderen Rechte. Jeder andere Befehl braucht `root` und das Installationsverzeichnis:

```bash
sudo arkvory status --root /opt/proanima-arkvory
```

`status` gibt den Installationsmodus, die installierte Version, die Einstellung für automatische Updates und das Anheften der Version aus.

| Befehl            | Verwendung                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `status`          | Zeigt die installierte Version und die Update-Richtlinie                                                      |
| `update`          | Installiert jetzt ein neueres stabiles Release. Siehe [Updates](./updates)                                    |
| `configure`       | HTTPS, Backup-Speicher, Spiegel, Update-Richtlinie und Hub. Siehe [Konfiguration](./configuration)            |
| `recover`         | Schließt ein unterbrochenes Update ab. Siehe [Updates](./updates#recover-update)                              |
| `finish-install`  | Setzt eine unterbrochene Installation fort                                                                    |
| `updates-connect` | Verbindet die Konsole und den Update-Timer einer Installation, die aus einem alten Release aktualisiert wurde |

## Protokolle {#logs}

Die Dienste schreiben ins Systemjournal. API und Worker schreiben pro Zeile einen JSON-Datensatz.

```bash
sudo journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup -u arkvory-database
sudo journalctl -u arkvory-api -f
sudo journalctl -u arkvory-update --since today
```

`arkvory-update` enthält die Ausgabe des Update-Timers. Die Größe und Aufbewahrung des Journals sind Einstellungen Ihres Betriebssystems. Die Datensatzfelder und Metriken finden Sie unter [Monitoring](../operate/monitoring). Deploy-Befehle geben Zeilen in der Form `<ISO-8601 time> INFO|WARN|ERROR <text>` aus. Geheimnisse werden daraus entfernt.

## Aktualisierung {#upgrade}

Installieren Sie ein neueres Paket über das alte, oder aktualisieren Sie über die Konsole oder mit `arkvory update`. Laufende Dienste bedienen weiter, bis das Update auf den neuen Code umschaltet. Richtlinien, das Backup vor einer Änderung des Datenbankschemas und die Wiederherstellungsschritte finden Sie unter [Updates](./updates).

Es gibt kein apt- oder dnf-Repository für Arkvory. Laden Sie jedes neue Paket von der Release-Seite herunter.

## Entfernen {#remove}

### Das Paket entfernen und die Daten behalten {#remove-package}

Unter Debian und Ubuntu:

```bash
sudo apt remove proanima-arkvory
```

Unter Fedora und RPM-kompatiblen Systemen:

```bash
sudo dnf remove proanima-arkvory
```

Das Entfernen stoppt und deaktiviert die Dienste und den Update-Timer. Es löscht `/usr/lib/proanima-arkvory`, `/usr/bin/arkvory` und den Menüeintrag. Es **behält** absichtlich:

- `/opt/proanima-arkvory`: die Datenbank, alle Dateien, die Konfiguration und den Wiederherstellungsschlüssel,
- die Unit-Dateien in `/etc/systemd/system`, die Konten `arkvory` und `arkvory-db`,
- den Backup-Speicher und sein systemd-Drop-in. Es berührt den Backup-Speicher nie.

`apt purge` entfernt nicht mehr als `apt remove`. Wenn Sie das Paket erneut installieren, arbeitet es mit den behaltenen Daten weiter und startet die Dienste.

### Alles entfernen {#remove-all}

Dies löscht alle gespeicherten Dateien und den Katalog. Erstellen Sie zuerst ein Backup und bewahren Sie den Backup-Speicher auf.

```bash
sudo systemctl disable --now arkvory-update.timer arkvory-backup arkvory-worker arkvory-api arkvory-database
sudo rm -rf /opt/proanima-arkvory
sudo rm -f /etc/systemd/system/arkvory-*.service /etc/systemd/system/arkvory-update.timer
sudo rm -rf /etc/systemd/system/arkvory-backup.service.d
sudo systemctl daemon-reload
sudo userdel arkvory
sudo userdel arkvory-db
```

Entfernen Sie zuerst das Paket, wie oben beschrieben. Nach einer Skriptinstallation gibt es kein Paket: Der erste Befehl stoppt die Dienste, und die Befehle, die `arkvory-database` und `arkvory-db` nennen, melden, dass diese nicht existieren.

## Vorhandenes PostgreSQL verwenden {#existing-postgresql}

Das Paket erstellt immer seinen eigenen Cluster. Um einen PostgreSQL-Server zu verwenden, den Ihre Organisation betreibt, installieren Sie mit `install.sh`. Es erstellt dieselben drei Dienste und den Update-Timer, aber keine Unit `arkvory-database` und keinen Befehl `/usr/bin/arkvory`.

Verwenden Sie eine PostgreSQL-Version von 16 bis 19. Verwenden Sie eine Datenbank für eine Arkvory-Installation. Verbinden Sie niemals zwei Installationen mit derselben Datenbank.

1. Bitten Sie Ihren Datenbankadministrator um eine leere Datenbank und eine Rolle, die ihr Besitzer ist. Arkvory führt seine Migrationen mit dieser Rolle aus.
2. Laden Sie `install.sh` aus dem Release herunter und prüfen Sie es. Es braucht `bash`, `curl`, `python3`, `tar` und `xz`, systemd und `root`.
3. Führen Sie es aus. Das Skript fragt nach der Verbindungs-URL; die Eingabe wird nicht angezeigt.

   ```bash
   sudo bash ./install.sh --automatic
   ```

   Um die URL stattdessen in einer Datei zu übergeben, erstellen Sie eine Datei, die nur `root` lesen kann:

   ```json
   { "ARKVORY_DATABASE_URL": "postgresql://arkvory:<password>@db.example:5432/arkvory" }
   ```

   ```bash
   sudo bash ./install.sh --config /root/arkvory.json
   ```

4. Löschen Sie das temporäre Verzeichnis `/opt/proanima-arkvory/bootstrap.*`, wenn die Installation abgeschlossen ist. Wenn Sie die URL an der Eingabeaufforderung eingegeben haben, enthält das Verzeichnis sie in `native.json`.
5. Erstellen Sie den Besitzer, wie unter [Erster Start und Erste Schritte](#first-start) beschrieben.

Das Skript lädt Node.js 24.21.0 von `nodejs.org` herunter, prüft dessen SHA-256 und installiert das neueste stabile Release. Lassen Sie `--automatic` weg, um automatische Updates ausgeschaltet zu lassen. Umgebungsvariablen ändern die Standardwerte:

| Variable                  | Bedeutung                                                                                     | Standard                |
| ------------------------- | --------------------------------------------------------------------------------------------- | ----------------------- |
| `ARKVORY_INSTALL_ROOT`    | Installationsverzeichnis. Verwenden Sie ein eigenes, leeres Verzeichnis außerhalb von `/home` | `/opt/proanima-arkvory` |
| `ARKVORY_RELEASE_VERSION` | Installiert diese stabile Version statt der neuesten                                          | neueste stabile         |
| `ARKVORY_ARTIFACT_DIR`    | Installiert aus einem entpackten `Arkvory-Linux.tar.gz` statt von GitHub                      | nicht gesetzt           |

Übergeben Sie sie über `sudo env`, zum Beispiel `sudo env ARKVORY_INSTALL_ROOT=/srv/arkvory bash ./install.sh`.

Ohne den Befehl `arkvory` rufen Sie das Verwaltungsprogramm mit dem Node.js auf, das das Skript installiert hat. Verwenden Sie `linux-arm64` auf arm64:

```bash
root=/opt/proanima-arkvory
sudo "$root/runtime/node-v24.21.0-linux-x64/bin/node" "$root/manage.mjs" status --root "$root"
```

Den PostgreSQL-Server sichern und warten Sie selbst. Der Backup-Agent von Arkvory kopiert den Inhalt der Datenbank über die Verbindungs-URL in den Backup-Speicher. Siehe [Backups](../operate/backups).

## Fehlerbehebung {#troubleshooting}

| Problem                                                                       | Was zu tun ist                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PostgreSQL 16–19 server binaries are required`                               | Die PostgreSQL-Programme fehlen oder sind zu alt. Installieren Sie einen PostgreSQL-Server der Version 16 bis 19 und installieren Sie das Paket erneut                                                                                                                                                                                                                                                                                                                                |
| `Use a dedicated empty installation directory`                                | `/opt/proanima-arkvory` enthält Dateien einer ersten Installation, die stehen blieb, bevor sie `installation.json` gespeichert hat. Der Installer überschreibt niemals eine Konfiguration. Lesen Sie das Journal und die Ausgabe der Paketverwaltung und beheben Sie die Ursache. Ein Verzeichnis, das noch keine Daten enthält, kann weg verschoben werden, damit Sie erneut installieren können. Löschen Sie nicht `config/` oder `database/` einer Installation, die Daten enthält |
| `Installation is locked`                                                      | Ein Vorgang läuft oder ist abgestürzt. Stoppen Sie den Update-Timer, lesen Sie `journal.json` im Installationsverzeichnis und löschen Sie `operation.lock` nicht, bevor Sie den Zustand kennen. Siehe [Updates](./updates#recover-update)                                                                                                                                                                                                                                             |
| `database/bootstrap-started` ist vorhanden, `database/initialized` aber nicht | Die Erstellung der Datenbank wurde unterbrochen. Löschen Sie den Cluster nicht und wiederholen Sie kein SQL von Hand. Beheben Sie die Ursache und führen Sie `sudo arkvory finish-install --root /opt/proanima-arkvory` aus                                                                                                                                                                                                                                                           |
| Ein Dienst startet nicht                                                      | `journalctl -u arkvory-api -n 100`. Ein Startfehler gibt einen JSON-Datensatz mit einem `reason` aus, der die Einstellung nennt, nie ihren Wert                                                                                                                                                                                                                                                                                                                                       |
| Port 8080 ist belegt                                                          | Ein anderes Programm verwendet ihn. Geben Sie den Port frei, oder setzen Sie `ARKVORY_PORT` in `config/runtime.json`. Siehe [Konfiguration](./configuration#address-and-port). Der Datenbankport 54329 kann nicht geändert werden                                                                                                                                                                                                                                                     |

Wenn die Installation stehen blieb, nachdem sie `installation.json` geschrieben hat, können Sie auch den Konfigurationsschritt des Pakets wiederholen: `sudo dpkg --configure -a` unter Debian und Ubuntu, oder installieren Sie dasselbe Paket unter RPM-Systemen erneut.

Weitere Hinweise stehen unter [Fehlerbehebung](../operate/troubleshooting).
