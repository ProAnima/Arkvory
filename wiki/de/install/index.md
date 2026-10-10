---
title: Installation auswählen
---

# Installation auswählen

Arkvory läuft auf einem Server. Jede Installation besteht aus denselben Teilen:

- **API**: die HTTP-API und die Webkonsole.
- **Worker**: schließt Uploads ab und führt Hintergrundaufgaben aus.
- **Backup-Agent**: erstellt geplante Backups in einem Backup-Speicher.
- **PostgreSQL**: die Datenbank für den Katalog.

Dateiinhalte liegen auf einem lokalen Datenträger des Servers. Ein einzelner Server ist kein Hochverfügbarkeitssystem: Ein Update oder ein Serverausfall führt zu einer kurzen Unterbrechung, danach setzen die Clients ihre Übertragungen fort. Für zwei oder drei Linux-Server, die eine synchrone Kopie halten und einander ablösen, siehe [Hochverfügbarkeits-Cluster](../operate/cluster).

## Installationsoptionen {#installation-options}

| Option                                                                                        | Plattform                                     | Start nach einem Neustart ohne Anmeldung                                                | Datenbank                                                             | Automatische Updates nach der Installation          | Empfohlen für                                                            |
| --------------------------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| [Grafischer Installer](./windows) `Arkvory-Setup-x64.exe`                                     | Windows x64                                   | Ja (Windows-Dienste)                                                                    | Mitgelieferte PostgreSQL 18.4, von Arkvory verwaltet                  | Aus                                                 | Windows-Server und Arbeitsplatzrechner, Installation ohne Internetzugang |
| [Linux-Paket](./linux) `Arkvory-amd64.deb`, `Arkvory-x86_64.rpm`                              | Linux x64 mit systemd                         | Ja (systemd-Units)                                                                      | Eigener PostgreSQL-Cluster aus Ihrer Distribution (Version 16 bis 19) | Aus                                                 | Debian-, Ubuntu- und RPM-basierte Server                                 |
| Skript, native Dienste: `install.sh` ([Linux](./linux)), `install.ps1` ([Windows](./windows)) | Linux x64 oder arm64 mit systemd, Windows x64 | Ja                                                                                      | Ihr vorhandener PostgreSQL-Server                                     | Aus oder an mit `--automatic` / `-AutomaticUpdates` | Automatisierung, ein vorhandener PostgreSQL-Server, Linux arm64          |
| [Docker Compose](./docker)                                                                    | Linux mit Docker Engine                       | Ja, wenn die Container-Engine beim Systemstart startet                                  | PostgreSQL-18.4-Container                                             | Aus oder an mit `--automatic`                       | Container-Hosts                                                          |
| [Docker Desktop](./docker)                                                                    | Windows x64                                   | Nein. Container laufen erst, wenn sich der Benutzer anmeldet und Docker Desktop startet | PostgreSQL-18.4-Container                                             | Aus oder an mit `-AutomaticUpdates`                 | Evaluierung auf einem Arbeitsplatzrechner                                |

Alle Optionen installieren dieselbe API, denselben Worker und denselben Backup-Agent. Integriertes HTTPS gibt es nur für native Installationen. Eine Compose-Installation braucht für HTTPS einen Reverse-Proxy. Siehe [HTTPS und Reverse-Proxy](./https).

### Remote-Installation per SSH {#remote-installation-over-ssh}

**Arkvory Remote Setup** gehört zu den Client-Paketen. Es läuft auf dem Rechner des Administrators, verbindet sich per SSH mit einem Server und installiert dort das native Linux- oder Windows-Paket. Anschließend erstellt es das Besitzerkonto und öffnet die Konsole über einen privaten SSH-Tunnel.

| Server      | Anforderungen                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| Linux x64   | SSH und SFTP, systemd, `apt-get` oder `dnf`, root oder ein Benutzer mit `sudo -n` (ohne Passwortabfrage) |
| Windows x64 | OpenSSH-Server mit SFTP, Windows PowerShell, ein Administratorkonto                                      |

Der Tunnel besteht nur, solange Remote Setup läuft. Er macht Arkvory für andere Rechner nicht zugänglich. Passwortgeschütztes `sudo`, SSH-Agents, Jump-Hosts und ARM-Server werden nicht unterstützt.

## Was ein Release enthält {#what-a-release-contains}

Releases werden unter [github.com/ProAnima/Arkvory/releases](https://github.com/ProAnima/Arkvory/releases) veröffentlicht.

| Datei                                                                                                                                     | Zweck                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Arkvory-Setup-x64.exe`                                                                                                                   | Grafischer Windows-Installer. Enthält Node.js, PostgreSQL, WinSW und die Microsoft-Visual-C++-Laufzeit                             |
| `Arkvory-amd64.deb`, `Arkvory-x86_64.rpm`                                                                                                 | Linux-Pakete. Enthalten Node.js                                                                                                    |
| `install.sh`, `install.ps1`                                                                                                               | Kommandozeilen-Installer für native Dienste oder Docker Compose                                                                    |
| `Arkvory-Linux.tar.gz`, `Arkvory-Windows.zip`                                                                                             | Automatisierungs-Kits: der Kommandozeilen-Installer und die Release-Dateien, für die Installation ohne Zugriff auf GitHub Releases |
| `Arkvory-CLI-Setup-x64.exe`, `Arkvory-CLI-amd64.deb`, `Arkvory-CLI-x86_64.rpm`                                                            | Client-Pakete: der Kommandozeilen-Client `arkvoryctl` und Arkvory Remote Setup                                                     |
| `arkvoryctl.mjs`, `arkvory-remote.mjs`                                                                                                    | Dieselben Client-Tools als Einzeldateien für Node.js 24                                                                            |
| `arkvory-runtime.zip`, `arkvory-setup.mjs`, `arkvory-release.json`, `arkvory-release.json.sig`, `release-checksums.json`, `native-*.json` | Programmdateien, Manifeste, Prüfsummen und die Signatur. Installer und Updater lesen sie                                           |

## Anforderungen {#requirements}

| Element                       | Anforderung                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows, grafischer Installer | x64, Windows-Build 10.0.17763 oder neuer (Windows 10 Version 1809, Windows Server 2019). Administratorrechte                                     |
| Windows, Skript               | x64, Windows PowerShell. Administratorrechte für native Dienste                                                                                  |
| Linux-Pakete                  | x64, systemd, glibc 2.28 oder neuer, Python 3. Der Paketmanager installiert PostgreSQL 16 oder neuer                                             |
| Linux, Skript                 | x64 oder arm64, systemd für native Dienste, glibc, Bash, curl, Python 3, tar und xz                                                              |
| Docker Compose                | Docker Engine mit dem Compose-Plugin oder Docker Desktop im Modus für Linux-Container. Podman mit einem kompatiblen Compose-Provider ist möglich |
| PostgreSQL                    | Eine Datenbank für eine Arkvory-Installation. Verbinden Sie nie zwei Installationen mit derselben Datenbank                                      |
| Dateispeicher                 | Ein lokales Dateisystem, das Hardlinks unterstützt. Verwenden Sie keine Netzwerkfreigabe als Dateispeicher                                       |
| Backup-Speicher               | Ein separates Volume, das eingebunden ist, bevor die Dienste starten. Siehe [Backups](../operate/backups)                                        |

Arkvory legt keine festen Mindestwerte für Prozessor oder Arbeitsspeicher fest. Planen Sie Speicherplatz für Ihre Dateien, die Datenbank und den Backup-Speicher ein. Standardmäßig hält Arkvory 1 GiB freien Speicherplatz auf dem Speichervolume frei und akzeptiert bis zu 10 TiB reservierter Uploads. Sie können beide Grenzen ändern. Siehe [Konfiguration](./configuration).

### Netzwerkzugriff bei Installation und Updates {#network-access-during-installation-and-updates}

Der grafische Installer funktioniert ohne Internetzugang. Die anderen Optionen laden Dateien über HTTPS herunter:

| Host                                                     | Verwendet von                                                                                |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `nodejs.org`                                             | `install.sh` und `install.ps1` laden Node.js 24.21.0 herunter und prüfen dessen SHA-256-Wert |
| `api.github.com`, `github.com` und GitHub-Download-Hosts | Skript-Installer sowie Updates, wenn der Update-Hub nicht erreichbar ist                     |
| `hub.proanima.net`                                       | Update-Prüfungen und Downloads. Siehe [Updates](./updates)                                   |
| Docker Hub                                               | Compose baut sein Image aus `node:24.21.0-bookworm-slim` und führt `postgres:18.4` aus       |

Ohne Internetzugang installieren und aktualisieren Sie aus einer lokalen Kopie eines Releases. Siehe [Updates](./updates).

## Ports {#ports}

| Port      | Dienst                                                               | Standardmäßige Erreichbarkeit                                                                                                                                              |
| --------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8080/TCP  | API und Konsole (HTTP oder HTTPS mit integriertem TLS)               | Nur `127.0.0.1`. Eine native Installation kann nach der HTTPS-Konfiguration auch auf anderen Adressen lauschen. Compose veröffentlicht den Port immer auf `127.0.0.1:8080` |
| 54329/TCP | Verwaltete PostgreSQL des grafischen Installers und der Linux-Pakete | Nur `127.0.0.1`                                                                                                                                                            |
| 5432/TCP  | PostgreSQL-Container einer Compose-Installation                      | Nicht veröffentlicht. Nur innerhalb des Compose-Netzwerks erreichbar                                                                                                       |

Öffnen Sie für Client-Netzwerke nur den HTTPS-Port. Öffnen Sie nie den Datenbank-Port.

## Installationsverzeichnis {#installation-directory}

Das Installationsverzeichnis ist unter Windows `C:\ProgramData\ProAnima\Arkvory` und unter Linux `/opt/proanima-arkvory`. Verwenden Sie ein eigenes, leeres Verzeichnis außerhalb von Home-Verzeichnissen und Benutzerprofilen.

| Pfad im Installationsverzeichnis | Inhalt                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `installation.json`              | Installierte Version, Installationsmodus, Einstellung für automatische Updates und angeheftete Version |
| `journal.json`, `operation.lock` | Zustand des letzten Updates und die Sperre eines laufenden Vorgangs                                    |
| `launcher.mjs`, `manage.mjs`     | Dienststart und Verwaltungsbefehle                                                                     |
| `releases/<version>/`            | Programmcode jeder installierten Version. Die Dienste schreiben hier nichts                            |
| `runtime/`                       | Node.js. Der grafische Installer legt hier auch PostgreSQL und WinSW ab                                |
| `config/`                        | Einstellungen, Schlüssel und der Wiederherstellungsschlüssel. Siehe [Konfiguration](./configuration)   |
| `data/`                          | Dateispeicher einer nativen Installation                                                               |
| `database/`                      | Verwalteter PostgreSQL-Cluster. Unter Windows auch seine Protokolle                                    |
| `logs/`                          | Protokolle der Windows-Dienste und das Protokoll des Windows-Updaters                                  |
| `service/`                       | Windows-Dienst-Wrapper                                                                                 |
| `updates/`                       | Update-Anforderungen aus der Konsole und der Status des Updaters                                       |

Eine Compose-Installation speichert ihre Daten in den Docker-Volumes `proanima-arkvory_storage` (Dateien) und `proanima-arkvory_catalog` (Datenbank), nicht in `data/`.

Alte Versionen in `releases/` werden nicht automatisch gelöscht. Nach einem erfolgreichen Update können Sie nicht verwendete Versionen löschen. Behalten Sie die aktuelle Version und die in `journal.json` genannte vorherige Version.

## Wiederherstellungsschlüssel {#recovery-key}

Der Installer erstellt `config/bootstrap-token.txt`. Diese Datei enthält den **Wiederherstellungsschlüssel**: einen Schlüssel mit Administratorrechten. Nur root oder die Gruppe Administratoren kann sie lesen.

- Verwenden Sie ihn einmal, um das erste Besitzerkonto zu erstellen, falls der Installer keines erstellt hat. Die Konsole fragt beim ersten Start danach.
- Installationstools lesen ihn auf dem Server: das Erstellen des Besitzers, `arkvory configure --backup-vault`, die Backup-Prüfung nach einem Update und das Backup vor einer Änderung des Datenbankschemas. **Löschen Sie diese Datei nicht.**
- Kopieren Sie ihn nicht auf Clients, CI-Systeme oder in Skripte. Legen Sie für die tägliche Arbeit Benutzerkonten und Dienstschlüssel mit eingeschränkten Rechten an. Siehe [Konten und Zugriff](../use/accounts).

Wie Sie den Wiederherstellungsschlüssel ersetzen, steht unter [Konfiguration](./configuration).

## Nächste Schritte {#next-steps}

1. Installieren Sie mit der Seite für Ihre Plattform: [Windows](./windows), [Linux](./linux) oder [Docker Compose](./docker).
2. Melden Sie sich an und veröffentlichen Sie eine erste Datei. Siehe [Schnellstart](../guide/quick-start).
3. Konfigurieren Sie [HTTPS](./https), bevor sich Clients von anderen Rechnern verbinden.
4. Verbinden Sie einen Backup-Speicher und führen Sie ein erstes Backup aus. Siehe [Backups](../operate/backups).
5. Wählen Sie eine [Update-Richtlinie](./updates).
