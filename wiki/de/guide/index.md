---
title: Überblick
description: 'ProAnima Arkvory ist ein selbst gehostetes Repository für Build-Artefakte und Dateien: was es speichert, was es kann und wie es läuft.'
---

# Überblick

ProAnima Arkvory ist ein selbst gehostetes Repository für Build-Artefakte und Dateien. Sie installieren es auf Ihrem eigenen Server. Es speichert die Dateien, die Ihre Builds erzeugen, und liefert sie an die Personen und Systeme aus, die sie brauchen: Deployment-Agents, CI/CD-Pipelines, Testrechner und Entwickler.

Arkvory ist für alle kostenlos, auch für Unternehmen. Der Quellcode ist zum Lesen offen, aber es ist kein Open Source. Sie dürfen es innerhalb Ihrer Organisation verwenden und ändern. Sie dürfen keine Kopien verbreiten, es nicht verkaufen und nicht als Dienst anbieten. Siehe die [Lizenz](https://github.com/ProAnima/Arkvory/blob/main/LICENSE.md).

## Für wen es gedacht ist {#who-it-is-for}

- **CI/CD-Engineers**, die einen zentralen Ort brauchen, um Builds zu veröffentlichen, einen Build nach Version oder Stufe zu finden und ihn in einem Deployment-Job herunterzuladen.
- **Administratoren**, die einen Speicherdienst wollen, der auf einem Server läuft, sich selbst neu startet, eigene Backups erstellt und sich selbst aktualisiert.
- **Spielestudios**, die mit Unity oder Unreal Engine arbeiten. Arkvory speichert große Binär-Assets über Git LFS, Unity-Pakete über eine npm-Registry und Build-Ausgaben von mehreren zehn Gigabyte.
- **Teams mit mehreren Standorten**, die eine schreibgeschützte Kopie eines Repositorys in der Nähe der Personen wollen, die daraus herunterladen.

## Was es speichert {#what-it-stores}

Alles liegt in **Repositorys**. Ein Repository kann gleichzeitig mehrere Arten von Inhalt enthalten:

| Inhalt                      | So arbeiten Sie damit                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Artefakte (beliebige Datei) | Upload mit der Konsole, dem [Kommandozeilen-Client](../protocols/cli), dem [SDK](../protocols/sdk) oder der HTTP-API                                          |
| UPack-Pakete                | Versionierte Pakete mit Gruppe, Name und SemVer-Version. Siehe [Pakete](../use/packages).                                                                     |
| Dateien nach Pfad           | Ein Pfad wie `builds/game/1.4/Setup.exe`, der jede frühere Version behält. Siehe [Dateien und Pfade](../use/files) und [Raw-Dateien](../protocols/raw-files). |
| Container-Images            | Eine OCI-Registry für Docker, Podman, Helm und ORAS. Siehe [Container-Images](../protocols/containers).                                                       |
| Git-LFS-Objekte             | Ein Git-LFS-Server mit Dateisperren. Siehe [Git LFS](../protocols/git-lfs).                                                                                   |
| npm- und Unity-Pakete       | Eine npm-Registry, die der Unity Package Manager nutzen kann. Siehe [Unity und npm](../protocols/unity-npm).                                                  |

Jede gespeicherte Datei ist ein unveränderliches **Artefakt** mit einer SHA-256-Prüfsumme. Neuer Inhalt ersetzt nie alte Bytes, sondern erzeugt ein neues Artefakt. Siehe [Konzepte](./concepts).

## Die wichtigsten Funktionen {#main-capabilities}

- **Große Dateien.** Uploads werden in Teilen gesendet und können nach einem Netzwerkausfall oder einem Neustart fortgesetzt werden. Ein Objekt kann bis zu rund 10 TiB groß sein. Downloads unterstützen HTTP-Bereichsanfragen (Ranges) und lassen sich daher ebenfalls fortsetzen.
- **Zugriffssteuerung.** Benutzerkonten, Gruppen, persönliche Zugriffstoken und Dienstkonten mit Schlüsseln. Jeder Schlüssel erhält nur die Repository-Aktionen, die er braucht.
- **Stufen und Hochstufung.** Markieren Sie einen Build als `qa`, `release` oder `prod` oder veröffentlichen Sie ihn ohne erneuten Upload in einem anderen Repository. Ein Deployment-Agent kann „den neuesten `release`-Build im Bereich `^1.4`“ anfordern.
- **Metadaten.** Labels, Textmetadaten, Sammlungen und angehängte Dateien wie Manifeste, SBOMs und Signaturen.
- **Aufbewahrung.** Behalten Sie die letzten N Builds jedes Pakets, legen Sie Kontingente fest und entfernen Sie alte Inhalte im Hintergrund.
- **Backups.** Ein Backup-Agent kopiert die Datenbank und alle Inhalte in einen Backup-Speicher auf einem anderen Datenträger oder NAS, nach einem täglichen Zeitplan, den ein Administrator einschaltet, und prüft die Kopien.
- **Spiegel.** Eine zweite Installation kann eine schreibgeschützte Kopie eines Repositorys führen und sie ausliefern, wenn der Hauptserver nicht verfügbar ist.
- **Lese-Gateways.** Zusätzliche Download-Prozesse auf demselben gemeinsamen Speicher teilen sich ein Download-Budget.
- **Selbstheilung.** Die Dienste starten nach einem Absturz oder Stillstand neu. Lange Übertragungen können nach dem Neustart fortgesetzt werden.
- **Updates.** Der Server sucht nach signierten stabilen Releases, die ProAnimaStudio in seinem Hub freigibt. Sie lassen sich manuell oder automatisch in einer Wartungsstunde installieren; ein Zurücksetzen auf die vorherige Version ist möglich.
- **Webkonsole.** Helles und dunkles Design, in elf Sprachen: Englisch, Russisch, Spanisch, Französisch, Deutsch, Portugiesisch, Chinesisch, Japanisch, Koreanisch, Hindi und Arabisch (von rechts nach links). Diese Dokumentation gibt es in denselben Sprachen. Siehe [Die Webkonsole](./console).

## So läuft es {#how-it-runs}

Arkvory läuft auf einem Server. Es nutzt PostgreSQL für den Katalog und ein lokales Verzeichnis für die Inhalte. Drei Dienste arbeiten zusammen:

| Dienst       | Zweck                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| API          | Der HTTP-Server: die API, die Konsole und die Registrys. Er führt auch Aufbewahrung und physische Bereinigung aus. |
| Worker       | Hintergrundaufgaben: große Uploads abschließen und Spiegel synchronisieren                                         |
| Backup-Agent | Geplante Backups in den Backup-Speicher                                                                            |

Sie können es auf drei Arten installieren:

| Plattform                     | Installer                                 | Details                                                                                                                                                                    |
| ----------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows 10/11, Windows Server | `Arkvory-Setup-x64.exe`                   | Ein Setup-Assistent. Er enthält Node.js und PostgreSQL und funktioniert ohne Internet. Die Dienste laufen ohne angemeldeten Benutzer. Siehe [Windows](../install/windows). |
| Linux                         | `Arkvory-amd64.deb`, `Arkvory-x86_64.rpm` | Pakete für apt und dnf mit systemd-Diensten. Siehe [Linux](../install/linux).                                                                                              |
| Docker                        | Docker Compose                            | API, Worker, Backup-Agent und PostgreSQL in Containern. Siehe [Docker](../install/docker).                                                                                 |

Standardmäßig lauscht der Server nur auf `127.0.0.1:8080`. Richten Sie [HTTPS](../install/https) ein, bevor sich andere Rechner verbinden.

Eine Installation ist ein Server: Fällt er aus, warten die Clients, bis er wieder erreichbar ist. Unter Linux übernimmt ein [Hochverfügbarkeits-Cluster](../operate/cluster) aus zwei oder drei Servern, wenn einer ausfällt. Nutzen Sie [Backups](../operate/backups) und bei Bedarf [Spiegel](../operate/mirrors) an einem zweiten Standort.

## Wie es weitergeht {#where-to-go-next}

1. [Schnellstart](./quick-start): Installieren Sie Arkvory und laden Sie Ihre erste Datei hoch.
2. [Konzepte](./concepts): die Begriffe, die der Rest der Dokumentation verwendet.
3. [Installation](../install/index): Anforderungen und Optionen für jede Plattform.
4. [Kommandozeilen-Client](../protocols/cli): Arkvory aus Skripten und CI verwenden.
5. [Backups](../operate/backups): Sichern Sie Ihre Daten, bevor Sie in Produktion gehen.
