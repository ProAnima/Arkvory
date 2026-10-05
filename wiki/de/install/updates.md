---
title: Updates
description: 'Wie Arkvory neue Releases findet, verifiziert und installiert, mit manuellen und automatischen Updates, dem Backup vor einer Schemaänderung, Rollback, Anheften und Offline-Updates.'
---

# Updates

ProAnimaStudio kündigt jedes stabile Release von Arkvory über einen Hub an. Ihr Server fragt den Hub, welche Version er installieren darf, lädt das Release herunter, prüft dessen Signatur und installiert es. Nichts wird installiert, sofern Sie es nicht starten oder automatische Updates einschalten. Automatische Updates sind standardmäßig ausgeschaltet.

Ein Update ist kein Rolling Update. Die Dienste stoppen für kurze Zeit, und laufende Übertragungen werden unterbrochen. Clients, die fortsetzen können, setzen ihre Übertragungen fort. Aktualisieren Sie in einem Wartungsfenster.

## Wie Updates funktionieren {#how-it-works}

- **Releases.** Nur veröffentlichte, stabile Releases mit einer Version `x.y.z` werden installiert. Vorabversionen, Branches, beliebige Adressen und ältere Versionen werden abgelehnt.
- **Der Hub entscheidet.** Alle 6 Stunden fragt der Server den Hub nach der für ihn freigegebenen Version. Der Hub hält eine neue Version zurück oder gibt sie schrittweise frei. Die Dateien selbst kommen von GitHub über kurzlebige Links, die der Hub ausstellt. Der Server braucht dafür kein GitHub-Token.
- **Signatur.** Jedes Release-Manifest ist von ProAnimaStudio signiert. Der Server prüft die Signatur mit einem öffentlichen Schlüssel, der in das installierte Programm eingebaut ist, und danach den SHA-256 des Archivs. Ein Release, das unsigniert oder verändert ist, wird nicht installiert, ob es vom Hub oder von GitHub kommt. Dem Hub wird nicht für die Integrität vertraut.
- **Der Host-Updater.** Ein Timer auf dem Server (`arkvory-update.timer` unter Linux, die Aufgabe `ProAnimaArkvoryUpdate` unter Windows) führt den Updater jede Minute aus. Er nimmt Anfragen aus der Konsole auf, prüft auf Releases, wenn seit der letzten Prüfung 6 Stunden vergangen sind, und startet das automatische Update in seiner Stunde. Prüfungen laufen auch, wenn die automatische Installation ausgeschaltet ist.

### Was ein Update tut {#what-an-update-does}

1. Während die Dienste weiterlaufen, lädt es das Release herunter, prüft die Signatur und den SHA-256 und entpackt die Dateien nach `releases/<version>/` im Installationsverzeichnis. Für Compose baut es das neue Image.
2. Wenn das Release das Datenbankschema ändert, erstellt und verifiziert es zuerst ein frisches Backup. Siehe [Das Backup vor einem Update](#backup).
3. Es stoppt den Backup-Agent, den Worker und die API. Jeder bekommt bis zu 120 Sekunden zum Abschluss.
4. Es schaltet die Installation auf die neue Version um. Eine Schemaänderung führt jetzt ihre Migration aus.
5. Es startet die API und den Worker und wartet, bis die API dreimal hintereinander Bereitschaft meldet. Dann startet es den Backup-Agent. Der Agent ist nicht Teil der Prüfung: Wenn er nicht innerhalb von etwa 90 Sekunden meldet, gibt das Update eine Warnung aus und bleibt.
6. Es sendet das anonyme Ereignis `updated` an den Hub, wenn Statistiken eingeschaltet sind. Ein Fehler hier macht das Update nie rückgängig.

Die alte Version bleibt in `releases/`. Alle Daten, Schlüssel und die Konfiguration bleiben unverändert.

## Auf Updates prüfen {#check}

Melden Sie sich als Administrator in der Konsole an und öffnen Sie [[ui:updates]]. Die Seite zeigt [[ui:updateCurrent]], [[ui:updateLatest]] und [[ui:updateChecked]]. Wählen Sie [[ui:updateCheck]], um jetzt den Hub zu fragen. Nachdem Sie sich angemeldet haben, zeigt Ihnen ein Banner mit [[ui:updateOpen]], wann ein neueres Release existiert.

Wenn eine Prüfung fehlschlägt, zum Beispiel ohne Netzwerkzugang, behält die Seite das zuletzt gefundene Release und markiert es als möglicherweise veraltet. Die Prüfung wird nach 6 Stunden erneut versucht, oder wenn Sie [[ui:updateCheck]] wählen.

Auf dem Server zeigt `arkvory status --root <root>` die installierte Version, die Einstellung für automatische Updates und das Anheften.

Wenn die Seite meldet, dass der Host-Updater nicht verbunden ist, führen Sie `arkvory updates-connect --root <root>` aus. Es verbindet die Konsole und den Update-Timer einer Installation, die aus einem alten Release aktualisiert wurde. Wenn die Seite meldet, dass der Updater nicht mehr meldet, ist der Timer oder die Aufgabe 5 Minuten lang nicht gelaufen. Siehe [Fehlerbehebung](#troubleshooting).

## Manuell installieren {#manual}

### In der Konsole {#manual-console}

1. Öffnen Sie [[ui:updates]] und prüfen Sie, dass [[ui:updateLatest]] die gewünschte Version zeigt.
2. Wählen Sie [[ui:updateInstall]]. Der Dialog nennt die Version und warnt, dass Übertragungen unterbrochen werden können.
3. Wählen Sie [[ui:updateConfirmButton]]. Die Konsole sendet die Version und den SHA-256, den Sie gesehen haben. Wenn sich die veröffentlichten Bytes seither geändert haben, wird die Anfrage abgelehnt.
4. Warten Sie. Die Anfrage wird sofort angenommen; der Host-Updater nimmt sie innerhalb einer Minute auf. Die Seite verliert möglicherweise die Verbindung, während die Dienste neu starten, und verbindet sich selbst neu. Senden Sie keine zweite Anfrage.

Die Konsole lehnt eine Installation ab, wenn die Version angeheftet ist. Siehe [Eine Version anheften](#pin).

### Mit einem Befehl {#manual-command}

```bash
sudo arkvory update --root /opt/proanima-arkvory
sudo arkvory update --root /opt/proanima-arkvory --version 1.2.3
```

Ohne `--version` installiert der Befehl die Version, die der Hub für diesen Server freigibt. Mit `--version` installiert er genau diese stabile Version, die neuer als die installierte sein muss. Der Befehl endet mit einem Fehlercode, wenn das Update fehlschlägt. Wie Sie den Befehl auf jeder Plattform ausführen, steht unter [Konfiguration](./configuration#lifecycle-commands).

## Automatische Updates {#automatic}

Schalten Sie automatische Updates auf einem von drei Wegen ein:

- Öffnen Sie in der Konsole [[ui:updates]], wählen Sie [[ui:updateAutomatic]] unter [[ui:updateSettings]], wählen Sie [[ui:updateHour]] und wählen Sie [[ui:updateSave]].
- Auf dem Server: `arkvory configure --root <root> --enable-updates`.
- Bei einer Skriptinstallation: `--automatic` für `install.sh`, `-AutomaticUpdates` für `install.ps1`.

Schalten Sie sie über die Konsole oder `arkvory configure --root <root> --disable-updates` aus.

| Regel             | Wert                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Fenster           | Die gewählte UTC-Stunde. Standard ist 03:00 bis 03:59 UTC. Nur die Konsole legt die Stunde fest                         |
| Versuche          | Höchstens einer pro UTC-Tag, ob er gelingt oder fehlschlägt. Ein verpasstes Fenster wird nicht später am Tag nachgeholt |
| Übersprungen wenn | Die Version ist angeheftet, die letzte Prüfung ist fehlgeschlagen, oder es ist kein neueres Release bekannt             |
| Release           | Das neueste Release, das der Hub bei der letzten Prüfung freigegeben hat                                                |

Planen Sie Ihre Backups außerhalb des Update-Fensters. Ein Update stoppt den Backup-Agent, und ein laufendes Backup wird unterbrochen und erneut in die Warteschlange gestellt.

## Das Backup vor einem Update {#backup}

Ein Update, das das Datenbankschema nicht ändert, erstellt kein Backup. Verlassen Sie sich auf Ihre geplanten Backups.

Ein Release, das das Datenbankschema ändert, wird nur hinter einem frischen, verifizierten Backup installiert. Der Updater tut dies, während die Dienste noch laufen:

1. Er bittet den Backup-Agent um ein neues Backup und wartet, bis das Backup erstellt und geprüft ist. Er wartet bis zu 6 Stunden. Die Konsole zeigt während dieser Zeit, dass das Release installiert wird.
2. Erst dann stoppt er die Dienste, migriert die Datenbank und startet die neue Version.

Das Backup braucht drei Dinge: einen verbundenen, verfügbaren Backup-Speicher, einen Backup-Agent, der online ist, und mindestens ein Backup, das früher abgeschlossen wurde. Das erste vollständige Backup von mehreren Terabyte ist geplante Arbeit, nie ein Nebeneffekt eines Updates. Wenn eines der drei fehlt, wird das Update **abgelehnt, bevor sich etwas ändert**. Die Dienste laufen weiter, die Konsole zeigt, dass die Installation abgelehnt wurde, und ein automatisches Update versucht es am nächsten Tag erneut. Verbinden Sie den Backup-Speicher und führen Sie das erste Backup aus: siehe [Backups](../operate/backups).

Änderungen, die nach dem Snapshot und vor dem Stoppen der Dienste eintreffen, sind nicht in diesem Backup. Das Backup ist nur wichtig, wenn die neue Version nach ihrer Migration fehlschlägt: siehe [Zurücksetzen und wiederherstellen](#rollback).

### Aktualisierung mit einem eigenen Backup {#manual-upgrade}

Ohne eingebauten Backup-Speicher erstellen und verifizieren Sie Ihr eigenes Backup der Datenbank und des gesamten Speichers und geben Sie dem Updater dann eine Datei, die es festhält:

```bash
sudo arkvory upgrade --root /opt/proanima-arkvory --version 1.2.3 --backup-record /secure/backup-record.txt
```

Die Datei ist Ihre eigene Notiz. Der Updater prüft nur, dass sie existiert; er beweist nicht, dass das Backup vollständig ist. Das Journal und das Zurücksetzen sind dieselben wie bei `update`. Dieser Befehl funktioniert nur vorwärts und wird abgelehnt, wenn die Version auf eine andere Version angeheftet ist.

## Zurücksetzen und wiederherstellen {#rollback}

### Automatisches Zurücksetzen {#automatic-rollback}

- **Keine Schemaänderung.** Wenn die neue Version nicht bereit wird, stoppt der Updater sie, stellt das vorherige Release wieder her, wartet auf Bereitschaft und meldet `Update failed; previous release restored`.
- **Schemaänderung, fehlgeschlagene Migration.** Die Migration läuft in einer Transaktion. Eine fehlgeschlagene Migration wird zurückgesetzt, und das vorherige Release startet wieder auf dem unveränderten Schema.
- **Schemaänderung, neue Version startet nach der Migration nicht.** Das vorherige Release kann das neue Schema nicht lesen, daher gibt es keinen automatischen Weg zurück. Der Updater markiert das Journal mit `maintenance-required` und nennt den Wiederherstellungspunkt. Beheben Sie die Ursache und führen Sie `recover` aus, was das Update abschließt. Oder stellen Sie den in `journal.json` genannten Wiederherstellungspunkt wieder her und führen Sie die vorherige Version aus.

Arkvory hat keinen Downgrade-Befehl. Der Befehl lehnt eine ältere Version ab. Die vorherige Version bleibt in `releases/` nur für das automatische Zurücksetzen.

### Ein unterbrochenes Update wiederherstellen {#recover-update}

Ein Absturz oder ein Stromausfall während eines Updates hinterlässt zwei Dinge: die Sperre `operation.lock` und den Datensatz `journal.json` im Installationsverzeichnis. Neue Updates und die meisten Befehle weigern sich zu laufen, bis Sie wiederherstellen. Löschen Sie die Sperre nie, bevor Sie den Zustand kennen.

1. Stoppen Sie den Update-Timer, damit kein neuer Lauf startet. Unter Linux: `sudo systemctl stop arkvory-update.timer`. Unter Windows: `Disable-ScheduledTask -TaskName ProAnimaArkvoryUpdate`. Stoppen Sie bei einer Compose-Installation ohne den Timer Ihre geplante Aufgabe.
2. Stellen Sie sicher, dass kein Updater-Prozess läuft. Sichern Sie `journal.json` und die Protokolle.
3. Löschen Sie erst dann `operation.lock`.
4. Führen Sie `arkvory recover --root <root>` aus. Es bewegt sich in die Richtung, die das Journal erlaubt:
   - Bei einem Update ohne Schemaänderung oder bevor die Migration begonnen hat, kehrt es zur vorherigen Version zurück,
   - Nachdem die Migration begonnen hat, geht es vorwärts: Es wiederholt die Migration, die gefahrlos wiederholt werden kann, und startet die neue Version.
5. Prüfen Sie, dass die Dienste bereit sind und ein Testdownload funktioniert. Starten Sie den Timer erneut: `sudo systemctl start arkvory-update.timer`, oder `Enable-ScheduledTask -TaskName ProAnimaArkvoryUpdate`.

Wenn die Konsolenanfrage, die das Update gestartet hat, noch gespeichert ist, entfernt `arkvory updates-reset --root <root>` sie. Führen Sie es erst aus, nachdem Sie den Zustand geprüft haben. Die Sperre entfernt es nicht.

## Eine Version anheften {#pin}

Heften Sie eine Version an, um jedes Update auf eine andere Version zu stoppen.

```bash
sudo arkvory configure --root <root> --pin                  # pin the installed version
sudo arkvory configure --root <root> --pin --version 1.2.3  # pin another stable version
sudo arkvory configure --root <root> --unpin
```

Solange eine Version angeheftet ist:

- tun automatische Updates nichts,
- lehnt die Konsole die Installation eines Releases ab und bittet Sie, das Anheften auf dem Server zu entfernen,
- installiert `arkvory update` die angeheftete Version und lehnt ein anderes `--version` ab,
- laufen Prüfungen weiter, sodass die Konsole weiterhin neuere Releases zeigt.

Um eine neuere Version zu installieren, nachdem Sie eine ältere angeheftet haben, heften Sie die neuere Version an und führen Sie `arkvory update` aus. Sie können auch bei der Skriptinstallation anheften: `--pin` für `install.sh`, `-Pin` für `install.ps1`.

## Der Hub, der Kanal und Statistiken {#hub}

### Was der Server an den Hub sendet {#hub-data}

| Wann                                                      | Was gesendet wird                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Update-Prüfung, alle 6 Stunden oder auf Anfrage           | Eine Anfrage für das Update des Projekts `arkvory` mit der installierten Version, dem Betriebssystem (`linux` oder `windows`), dem Prozessor (`x86_64` oder `aarch64`) und dem Kanal. Bei eingeschalteten Statistiken wird der Header `X-Install-Id` mit einer zufälligen Installations-ID hinzugefügt |
| Ein Update abgeschlossen, bei eingeschalteten Statistiken | Ein Ereignis `updated` mit der Installations-ID, der neuen Version, dem Betriebssystem, dem Prozessor und dem Kanal                                                                                                                                                                                    |
| Download eines Releases                                   | Der Hub antwortet mit einem Link zu GitHub. Die Dateien kommen von dort                                                                                                                                                                                                                                |

Kein Schlüssel, Konto, Hostname oder gespeicherter Inhalt wird gesendet, und keine Anmeldedaten erreichen den Hub. Die Installations-ID ist ein Zufallswert, der nichts außer der Installation identifiziert. Nach Angaben des Projekts speichert der Hub keine IP-Adressen, Namen oder Inhalte. Der Hub empfängt auch Feedback, das ein Benutzer aus der Konsole sendet. Das ist eine separate Handlung des Benutzers.

Bei ausgeschalteten Statistiken sendet der Server keine Installations-ID und keine Ereignisse. Der Hub bietet dann eine Version nur an, wenn er sie für alle Installationen freigegeben hat.

### Optionen {#hub-options}

| Einstellung | Standard                   | Ändern mit                                                                                                                          |
| ----------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Statistiken | an                         | Konsole: [[ui:updateStatistics]] unter [[ui:updateSettings]]. Befehl: `--statistics off` oder `--statistics on`                     |
| Kanal       | `stable`                   | `--update-channel beta`, um Versionen zu erhalten, die ProAnimaStudio früher anbietet, `--update-channel stable`, um zurückzukehren |
| Hub-Adresse | `https://hub.proanima.net` | `--hub-url https://hub.example` für einen eigenen Hub, `--hub-off`, um nur GitHub zu verwenden. Die Adresse muss HTTPS verwenden    |

Sie alle sind Optionen von `arkvory configure --root <root>` und wirken ohne Neustart. Die Einstellungen werden in `config/hub.json` gespeichert. Eine Änderung der Hub-Adresse ändert auch, wohin die Konsole Feedback sendet, nach dem nächsten Neustart der Dienste.

### Wenn der Hub nicht erreichbar ist {#hub-unreachable}

Wenn der Hub nicht antwortet (Netzwerkfehler, Timeout oder ein Serverfehler), liest der Updater stattdessen das neueste stabile Release auf GitHub und protokolliert eine Warnung. Er führt dieselben Signatur- und SHA-256-Prüfungen durch. Eine Ablehnung vom Hub (Status 4xx), eine fehlende Datei oder eine schlechte Signatur ist ein Fehler, und es gibt keinen Rückfall.

Wenn die Releases auf GitHub eine Authentifizierung brauchen, erstellen Sie die Datei `github-token.txt` im Installationsverzeichnis mit einem Token, das den Inhalt des Repositorys lesen kann. Nur Administratoren dürfen die Datei lesen. Der Updater verwendet sie, die Dienste nicht, und sie wird nie als Befehlsoption übergeben. Mit `--hub-off` verwendet der Updater immer GitHub.

Der Server braucht HTTPS-Zugriff auf `hub.proanima.net`, `api.github.com`, `github.com` und die Download-Hosts von GitHub.

## Offline-Installationen {#offline}

Ein Server ohne Internetzugang kann nicht auf Releases prüfen. Die Seite [[ui:updates]] zeigt dann, dass die Prüfung fehlgeschlagen ist. Das betrifft die Dienste nicht. Aktualisieren Sie stattdessen aus Dateien.

1. Laden Sie auf einem Computer mit Internetzugang das Kit für die Plattform Ihres Servers herunter: `Arkvory-Linux.tar.gz` oder `Arkvory-Windows.zip`. Vergleichen Sie deren SHA-256 mit `release-checksums.json` des Releases.
2. Kopieren Sie das Kit auf den Server und entpacken Sie es. Das Verzeichnis enthält `arkvory-release.json`, `arkvory-runtime.zip` und `arkvory-setup.mjs`. Das Kit hat keine Signaturdatei. Laden Sie `arkvory-release.json.sig` von derselben Release-Seite herunter und legen Sie sie neben `arkvory-release.json`: Dann verifiziert der Updater auch die Signatur.
3. Führen Sie das Update mit dem absoluten Pfad des Verzeichnisses aus:

   ```bash
   sudo arkvory update --root /opt/proanima-arkvory --artifact /media/release
   ```

   ```powershell
   & 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' update --root C:\ProgramData\ProAnima\Arkvory --artifact D:\release
   ```

Der Updater prüft den SHA-256 des Archivs gegen das Manifest. Die Signatur prüft er nur, wenn `arkvory-release.json.sig` neben dem Manifest liegt. Ein lokales Verzeichnis ist Ihre eigene Wahl, daher verlangt das Update die Signatur nicht. Ohne sie ist der Vergleich des Kits mit `release-checksums.json` in Schritt 1 Ihr einziger Herkunftsnachweis. Dieselben Regeln für eine Schemaänderung gelten: Sie brauchen zuerst ein verifiziertes Backup.

Ein natives Paket oder `Arkvory-Setup-x64.exe` enthält sein Release und braucht keinen Internetzugang. Ein Compose-Update baut das Image auf dem Host. Es braucht Docker Hub nur, wenn das Basis-Image `node:24.21.0-bookworm-slim` noch nicht auf dem Host liegt.

## Update nach Plattform {#platforms}

### Windows {#platform-windows}

Führen Sie ein neueres `Arkvory-Setup-x64.exe` über das installierte aus. Das Setup findet die Daten und fragt nicht erneut nach dem Besitzer. Es aktualisiert die Programme, die Dienste und das Datenbank-Release auf dieselbe Weise wie ein Update aus der Konsole. Das Setup einer älteren Version wird abgelehnt, und das Setup derselben Version repariert die Dienste. Starten Sie das Setup nicht, während ein Update läuft. Der Installer ist nur auf Englisch und Russisch verfügbar. Sie können auch über die Konsole oder mit dem Befehl aktualisieren.

### Linux-Pakete {#platform-linux}

Laden Sie das neuere Paket von der Release-Seite herunter und installieren Sie es wie das erste: `sudo apt install ./Arkvory-amd64.deb` oder `sudo dnf install ./Arkvory-x86_64.rpm`. Es gibt kein apt- oder dnf-Repository, daher finden `apt upgrade` und `dnf upgrade` keine neuen Versionen. Der Konfigurationsschritt des Pakets führt dasselbe Update wie der Befehl aus, mit dem Release im Paket. Die laufenden Dienste bedienen weiter, bis umgeschaltet wird.

Wenn das Update abgelehnt wird, zum Beispiel weil eine Schemaänderung ein Backup braucht, das nicht existiert, läuft die alte Version weiter und der Konfigurationsschritt schlägt fehl. Beheben Sie die Ursache und wiederholen Sie dann den Schritt mit `sudo dpkg --configure -a` unter Debian und Ubuntu oder indem Sie dasselbe Paket unter RPM-Systemen erneut installieren.

Nach einem Update aus der Konsole kann die von der Paketverwaltung angezeigte Version älter als die laufende Version sein. Ein Paket, das älter als die laufende Version ist, wird abgelehnt.

### Skriptinstallation {#platform-script}

Eine Skriptinstallation hat keinen Befehl `arkvory`. Aktualisieren Sie über die Konsole, oder führen Sie `manage.mjs update` mit dem Node.js der Installation aus. Siehe [Konfiguration](./configuration#lifecycle-commands).

### Docker Compose {#platform-compose}

Aktualisieren Sie über die Konsole oder mit `manage.mjs update`. Der Updater baut das Image der neuen Version, ersetzt die Container `backup`, `worker` und `api` und behält die Volumes. Eine Compose-Installation ohne `root` braucht einen geplanten `updates-poll`. Siehe [Docker Compose](./docker#updates-compose).

## Nach dem Update {#after}

- Prüfen Sie `arkvory status --root <root>` und melden Sie sich in der Konsole an.
- Löschen Sie Versionen, die Sie nicht mehr brauchen, aus `releases/`. Behalten Sie die aktuelle Version und die vorherige, die in `journal.json` genannt wird. Alte Versionen, Download-Dateien und Staging werden vom Updater nie gelöscht.
- Ein Update aktualisiert nicht das Node.js einer Skriptinstallation, die PostgreSQL-Programme, das Betriebssystem oder die Container-Engine. Aktualisieren Sie sie getrennt. Eine Änderung der PostgreSQL-Hauptversion ist eine eigene Migration: Erstellen Sie zuerst ein Backup.

## Fehlerbehebung {#troubleshooting}

| Was Sie sehen                                                            | Was zu tun ist                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Die Seite meldet, dass der Host-Updater nicht verbunden ist              | Führen Sie `arkvory updates-connect --root <root>` in einem Wartungsfenster aus                                                                                                                                                                                        |
| Die Seite meldet, dass der Updater nicht mehr meldet                     | Prüfen Sie den Timer oder die Aufgabe. Unter Linux: `systemctl status arkvory-update.timer` und `journalctl -u arkvory-update`. Unter Windows: die Aufgabe `ProAnimaArkvoryUpdate` und `logs\updater.log`. Prüfen Sie, dass `operation.lock` nicht zurückgeblieben ist |
| Die Release-Prüfung ist fehlgeschlagen                                   | Prüfen Sie den Zugriff auf den Hub und GitHub vom Server aus. Die Dienste sind nicht betroffen                                                                                                                                                                         |
| Die Installation wurde abgelehnt, weil ein Backup nötig ist              | Verbinden Sie den Backup-Speicher, warten Sie auf das erste Backup, prüfen Sie den Status erneut. Siehe [Das Backup vor einem Update](#backup)                                                                                                                         |
| Das Update ist fehlgeschlagen                                            | Lesen Sie `journal.json`, das Updater-Protokoll und die Dienstprotokolle, bevor Sie es erneut versuchen                                                                                                                                                                |
| Manuelle Wiederherstellung ist erforderlich                              | Befolgen Sie [Ein unterbrochenes Update wiederherstellen](#recover-update)                                                                                                                                                                                             |
| Die Einstellungen haben sich geändert, während die Anfrage wartete       | Aktualisieren Sie die Seite und senden Sie die Anfrage erneut                                                                                                                                                                                                          |
| `Installation is locked`                                                 | Ein anderer Vorgang läuft, oder einer ist abgestürzt. Siehe [Ein unterbrochenes Update wiederherstellen](#recover-update)                                                                                                                                              |
| `Interrupted deployment; use recover after inspecting journal.json`      | Ein früheres Update wurde nicht abgeschlossen. Stellen Sie zuerst wieder her                                                                                                                                                                                           |
| `Downgrades are forbidden`                                               | Die Version ist nicht neuer als die installierte                                                                                                                                                                                                                       |
| `Version is pinned`                                                      | Entfernen Sie das Anheften, oder installieren Sie die angeheftete Version                                                                                                                                                                                              |
| `Interrupted update request; inspect installation and use updates-reset` | Eine Anfrage aus der Konsole wurde angenommen, aber nicht abgeschlossen. Prüfen Sie den Zustand und führen Sie dann `updates-reset` aus                                                                                                                                |

Weitere Hinweise stehen unter [Fehlerbehebung](../operate/troubleshooting) und [Selbstheilung](../operate/self-healing).
