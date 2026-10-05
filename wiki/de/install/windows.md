---
title: Windows
---

# Windows

Es gibt drei Wege, Arkvory unter Windows zu betreiben:

- **Grafischer Installer** `Arkvory-Setup-x64.exe`. Empfohlen. Er installiert Windows-Dienste und eine eigene PostgreSQL-Datenbank. Er braucht keinen Internetzugang.
- **PowerShell-Skript** `install.ps1`. Es installiert dieselben Windows-Dienste, verwendet aber Ihren vorhandenen PostgreSQL-Server.
- **Docker Desktop** mit `install.ps1 -Mode compose`. Nur zur Evaluierung. Siehe [Docker Compose](./docker).

## Anforderungen {#requirements}

- Windows x64, Build 10.0.17763 oder neuer (Windows 10 Version 1809, Windows Server 2019 oder neuer).
- Ein Konto in der Gruppe Administratoren.
- Ein lokales NTFS-Volume für die Daten. Netzwerkfreigaben werden als Dateispeicher nicht unterstützt.
- Ein Installationsverzeichnis außerhalb von Benutzerprofilen und `AppData`. Das Dienstkonto muss jedes übergeordnete Verzeichnis lesen können.

## Mit dem grafischen Installer installieren {#install-with-the-graphical-installer}

1. Laden Sie `Arkvory-Setup-x64.exe` von [GitHub Releases](https://github.com/ProAnima/Arkvory/releases) herunter.
2. Führen Sie die Datei aus und bestätigen Sie die Abfrage der Benutzerkontensteuerung.
3. Wählen Sie Englisch oder Russisch und akzeptieren Sie die Lizenz.
4. Geben Sie das Besitzerkonto ein. Der Name hat 3 bis 64 Zeichen: lateinische Buchstaben, Ziffern, Punkt, Bindestrich oder Unterstrich. Das Passwort hat 12 bis 128 Zeichen.
5. Warten Sie, während das Setup die Datenbank, die Dienste und das Besitzerkonto vorbereitet.
6. Lassen Sie auf der letzten Seite **Open Arkvory and finish onboarding** ausgewählt und klicken Sie auf **Finish**. Die Konsole öffnet sich unter `http://127.0.0.1:8080/console/#onboarding`.

Das Setup erstellt außerdem zwei Verknüpfungen im Startmenü: **Arkvory** (die Konsole) und **API and CLI** (die Hilfeseite der Konsole).

Meldet das Setup, dass die Microsoft-Laufzeit einen Neustart erfordert, starten Sie Windows neu und führen Sie das Setup erneut aus. Vorhandene Arkvory-Daten bleiben erhalten.

Nach der Installation sind automatische Updates ausgeschaltet. Wie Sie sie einschalten, steht unter [Updates](./updates).

### Stille Installation {#silent-installation}

Für eine automatisierte Bereitstellung legen Sie das Besitzerkonto in einer JSON-Datei ab. Schützen Sie die Datei so, dass nur SYSTEM und Administratoren sie lesen können.

```json
{ "name": "admin", "password": "<mindestens 12 Zeichen>" }
```

```powershell
.\Arkvory-Setup-x64.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /OWNERFILE="C:\secure\owner.json"
```

Der Installer löscht die Besitzerdatei, nachdem er das Konto erstellt hat. Übergeben Sie ein Passwort nie als Befehlsargument. Ohne `/OWNERFILE` erstellen Sie den Besitzer später in der Konsole mit dem Wiederherstellungsschlüssel. Das Setup beendet sich mit einem Exit-Code ungleich null, wenn die Konfiguration nicht abgeschlossen wurde. Führen Sie das Setup nicht aus, während ein Update läuft.

## Was der grafische Installer erstellt {#what-the-graphical-installer-creates}

| Element                             | Ort oder Wert                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| Programmdateien                     | `C:\Program Files\ProAnima\Arkvory`                                                   |
| Daten, Konfiguration und Protokolle | `C:\ProgramData\ProAnima\Arkvory` (das Installationsverzeichnis)                      |
| Datenbank                           | PostgreSQL 18.4 in `database\` des Installationsverzeichnisses, auf `127.0.0.1:54329` |
| Konsole                             | `http://127.0.0.1:8080/console/`                                                      |
| Wiederherstellungsschlüssel         | `config\bootstrap-token.txt` im Installationsverzeichnis                              |
| Update-Aufgabe                      | `ProAnimaArkvoryUpdate` in der Aufgabenplanung. Läuft jede Minute als SYSTEM          |

### Dienste {#services}

| Dienstname        | Anzeigename               | Konto                         | Starttyp                        |
| ----------------- | ------------------------- | ----------------------------- | ------------------------------- |
| `Arkvoryapi`      | ProAnima Arkvory api      | `NT AUTHORITY\LocalService`   | Automatisch (Verzögerter Start) |
| `Arkvoryworker`   | ProAnima Arkvory worker   | `NT AUTHORITY\LocalService`   | Automatisch (Verzögerter Start) |
| `Arkvorybackup`   | ProAnima Arkvory backup   | `NT AUTHORITY\LocalService`   | Automatisch (Verzögerter Start) |
| `Arkvorydatabase` | ProAnima Arkvory database | `NT AUTHORITY\NetworkService` | Automatisch                     |

Die Dienste laufen ohne angemeldeten Benutzer. API, Worker und Backup-Agent teilen sich das Konto LocalService. Die Datenbank läuft unter NetworkService, sodass das Konto der API die Datenbankdateien nicht lesen kann.

Das Installationsverzeichnis gewährt nur SYSTEM und Administratoren Vollzugriff. LocalService kann das Verzeichnis lesen und nur `data\`, `logs\` und den Update-Eingang ändern. Der Wiederherstellungsschlüssel und die anderen Dateien des Installers mit Anmeldedaten können nur SYSTEM und Administratoren lesen.

## Mit PowerShell und vorhandener PostgreSQL installieren {#install-with-powershell-and-an-existing-postgresql}

Verwenden Sie diese Methode, wenn Ihre Organisation bereits PostgreSQL betreibt. Sie erstellt keinen verwalteten Datenbankdienst und keinen Eintrag unter **Apps**.

1. Bitten Sie Ihren Datenbankadministrator um eine leere Datenbank und eine Rolle, die ihr Besitzer ist. Arkvory führt seine Migrationen mit dieser Rolle aus.
2. Laden Sie `install.ps1` aus dem Release herunter und prüfen Sie das Skript.
3. Öffnen Sie Windows PowerShell **als Administrator** und führen Sie aus:

```powershell
.\install.ps1 -AutomaticUpdates
```

Das Skript fragt nach der PostgreSQL-Verbindungs-URL. Die Eingabe wird nicht angezeigt. Anschließend lädt es Node.js 24.21.0 von `nodejs.org` herunter, prüft dessen SHA-256-Wert und installiert das neueste stabile Release.

Statt der Abfrage können Sie eine geschützte JSON-Datei übergeben:

```json
{ "ARKVORY_DATABASE_URL": "postgresql://arkvory:<Passwort>@db.example:5432/arkvory" }
```

```powershell
.\install.ps1 -Config C:\secure\arkvory.json
```

Blockiert PowerShell Skripte, führen Sie `powershell -ExecutionPolicy Bypass -File .\install.ps1` aus. Das ändert die Richtlinie nur für diesen Prozess.

| Parameter                      | Bedeutung                                                                  |
| ------------------------------ | -------------------------------------------------------------------------- |
| `-Root <path>`                 | Installationsverzeichnis. Standard: `C:\ProgramData\ProAnima\Arkvory`      |
| `-Version <x.y.z>`             | Installiert diese stabile Version statt der neuesten                       |
| `-Mode windows` oder `compose` | Windows-Dienste (Standard) oder [Docker Compose](./docker)                 |
| `-Engine docker` oder `podman` | Container-Engine für Compose                                               |
| `-Config <file>`               | JSON-Datei mit `ARKVORY_*`-Einstellungen, einschließlich der Datenbank-URL |
| `-Artifact <directory>`        | Installiert aus einer entpackten `Arkvory-Windows.zip` statt von GitHub    |
| `-AutomaticUpdates`            | Schaltet automatische Updates ein                                          |
| `-Pin`                         | Heftet die installierte Version an                                         |

Geben Sie `-Root`, `-Config` und `-Artifact` als absolute Pfade an, zum Beispiel `-Artifact $PWD.Path`.

Das Skript erstellt kein Besitzerkonto. Öffnen Sie `http://127.0.0.1:8080/console/` auf dem Server, wählen Sie **[[ui:welcomeOwner]]** und geben Sie den Wiederherstellungsschlüssel aus `config\bootstrap-token.txt` ein.

## Dienste verwalten {#manage-the-services}

```powershell
Get-Service Arkvoryapi, Arkvoryworker, Arkvorybackup, Arkvorydatabase
Restart-Service Arkvoryapi, Arkvoryworker
sc.exe qfailure Arkvoryapi
```

Der Verwaltungsbefehl benötigt eine PowerShell mit erhöhten Rechten und immer die Option `--root`:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
# Grafischer Installer
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' status --root $root
# Installation per Skript
& "$root\runtime\node-v24.21.0-win-x64\node.exe" "$root\manage.mjs" status --root $root
```

Mit `arkvory.ps1 help` sehen Sie alle Befehle. Die Befehle sind unter [Konfiguration](./configuration) und [Updates](./updates) beschrieben.

## Wiederherstellung nach einem Ausfall {#recovery-after-a-failure}

- Wenn ein Dienstprozess ohne Anforderung beendet wird, startet Windows ihn nach 10 Sekunden neu. Der Fehlerzähler wird nach einer Stunde zurückgesetzt.
- Ein Prozess, dessen Hauptthread 60 Sekunden lang nicht reagiert, beendet sich selbst, und Windows startet ihn neu. Siehe [Selbstheilung](../operate/self-healing).
- Eine fehlgeschlagene Bereitschaftsprüfung allein startet einen Dienst nicht neu (zum Beispiel, während der Server laufende Anfragen abschließt und herunterfährt). Antwortet die Datenbank jedoch nicht mehr, können die API und der Worker nicht bestätigen, dass der Speicher ihnen gehört: Nach etwa 8 Sekunden beenden sie sich selbst, und Windows startet sie alle 10 Sekunden neu, bis die Datenbank wieder erreichbar ist.
- Ein Dienst, den Sie selbst anhalten, bleibt angehalten, bis Sie ihn starten oder Windows neu startet.

Wenn Sie den grafischen Installer erneut ausführen, werden der Starttyp und die Wiederherstellungsaktionen der Dienste wiederhergestellt.

## Protokolle {#logs}

| Ort im Installationsverzeichnis | Inhalt                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `logs\`                         | Ausgabe von API, Worker und Backup-Agent. Dateien rotieren bei 20 MiB; 5 alte Dateien werden aufbewahrt |
| `logs\updater.log`              | Ausgabe der Update-Aufgabe, mit derselben Rotation                                                      |
| `database\`                     | Protokolle des Datenbankdienstes (`arkvory-database*.log`)                                              |
| `bootstrap.log`                 | Ausgabe des Konfigurationsschritts des grafischen Installers                                            |

Das Setup schreibt außerdem ein eigenes Protokoll in den temporären Ordner des Benutzers, der es ausgeführt hat. API und Worker schreiben pro Zeile einen JSON-Datensatz. Siehe [Monitoring](../operate/monitoring).

## Deinstallation {#uninstall}

Öffnen Sie **Einstellungen > Apps**, wählen Sie **ProAnima Arkvory** und klicken Sie auf **Deinstallieren**. Das Deinstallationsprogramm:

1. Entfernt die Aufgabe `ProAnimaArkvoryUpdate`.
2. Beendet und entfernt `Arkvorybackup`, `Arkvoryworker`, `Arkvoryapi` und `Arkvorydatabase`.
3. Entfernt die Programmdateien.

Es **behält** `C:\ProgramData\ProAnima\Arkvory` absichtlich bei: die Datenbank, alle Dateien, die Konfiguration und den Wiederherstellungsschlüssel. Den Backup-Speicher berührt es nie. Führen Sie später das Setup derselben oder einer neueren Version aus, arbeitet es mit den behaltenen Daten weiter. Um die Daten zu entfernen, erstellen Sie zuerst ein Backup und löschen Sie den Ordner dann selbst.

Eine Skriptinstallation hat kein Deinstallationsprogramm. Um ihre Dienste zu entfernen, führen Sie in einer PowerShell mit erhöhten Rechten aus:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
Unregister-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Confirm:$false
foreach ($role in 'backup', 'worker', 'api') {
  $exe = "$root\service\arkvory-$role.exe"
  if ((Get-Service "Arkvory$role").Status -ne 'Stopped') { & $exe stopwait }
  & $exe uninstall
}
```

## Docker Desktop {#docker-desktop}

Docker Desktop ist die Anwendung eines einzelnen Benutzers. Seine Container laufen erst, wenn sich dieser Benutzer anmeldet und Docker Desktop startet. Nach einem Neustart des Computers ist Arkvory bis dahin nicht verfügbar. Wenn Sie mit Docker Desktop installieren, aktivieren Sie **Settings > General > Start Docker Desktop when you sign in**. Der Installer und der Befehl `status` warnen, wenn diese Einstellung ausgeschaltet ist. Verwenden Sie für einen Server, der ohne Anmeldung starten muss, die nativen Dienste, die auf dieser Seite beschrieben sind.

## Fehlerbehebung {#troubleshooting}

| Problem                                                                       | Was zu tun ist                                                                                                                                                                               |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Das Setup meldet, dass die Konfiguration nicht abgeschlossen wurde            | Lesen Sie `bootstrap.log`, das Setup-Protokoll und die Datenbankprotokolle. Löschen Sie den Datenbankordner nicht                                                                            |
| `database\bootstrap-started` ist vorhanden, `database\initialized` aber nicht | Die Erstellung der Datenbank wurde unterbrochen. Löschen Sie den Cluster nicht und wiederholen Sie kein SQL von Hand. Beheben Sie die Ursache und führen Sie den Befehl `finish-install` aus |
| `Run installer as Administrator`                                              | Starten Sie PowerShell mit **Als Administrator ausführen**                                                                                                                                   |
| `Use a dedicated directory`                                                   | Das Installationsverzeichnis enthält bereits Dateien. Verwenden Sie ein leeres Verzeichnis. Eine vorhandene Installation verwalten Sie mit ihren Befehlen                                    |
| `Node.js runtime is incomplete after extraction`                              | Prüfen Sie die Quarantäne Ihrer Antivirensoftware                                                                                                                                            |
| `Another installation owns this service`                                      | Es gibt Dienste einer Installation in einem anderen Verzeichnis. Entfernen Sie sie zuerst                                                                                                    |

So schließen Sie eine unterbrochene Installation ab, ohne Daten zu löschen:

```powershell
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' finish-install --root C:\ProgramData\ProAnima\Arkvory
```

Weitere Hinweise stehen unter [Fehlerbehebung](../operate/troubleshooting).
