---
title: Konzepte
description: 'Die Ideen, die der Rest der Dokumentation verwendet, von Installation und Repositorys bis hin zu Zugriff, Aufbewahrung, Backups und Spiegeln.'
---

# Konzepte

Diese Seite erklärt die Begriffe, die die anderen Seiten verwenden. Jeder Abschnitt ist kurz und verlinkt auf die Seite, die das Thema vollständig behandelt. Einzeilige Definitionen finden Sie im [Glossar](../reference/glossary).

## Die Installation und ihre Dienste {#installation}

Eine Installation ist ein Server. Sie betreibt drei Arkvory-Dienste neben einer PostgreSQL-Datenbank:

| Teil         | Aufgabe                                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API          | Der HTTP-Server: die HTTP-API, die [Webkonsole](./console) und die Registrys für Container, Git LFS und npm. Er führt auch Aufbewahrung und physische Bereinigung aus. |
| Worker       | Hintergrundaufgaben: Er schließt große Uploads ab und synchronisiert Spiegel.                                                                                          |
| Backup-Agent | Geplante Backups in den Backup-Speicher.                                                                                                                               |
| PostgreSQL   | Der Katalog: Artefakte, Pakete, Revisionen, Konten, Schlüssel und Aufträge.                                                                                            |

Dateiinhalte liegen in einem lokalen Verzeichnis des Servers, nicht in der Datenbank. Alle Teile liegen im **Installationsverzeichnis** (`C:\ProgramData\ProAnima\Arkvory` unter Windows, `/opt/proanima-arkvory` unter Linux). Die Dienste starten ohne angemeldeten Benutzer und starten nach einem Absturz oder Stillstand neu ([Selbstheilung](../operate/self-healing)).

Eine Installation ist kein Hochverfügbarkeits-Cluster. Wenn der Server stoppt, warten die Clients und setzen dann ihre Übertragungen fort. Siehe [Eine Installation wählen](../install/index).

## Repositorys {#repositories}

Ein **Repository** ist ein benannter Bereich für Inhalte. Es hat eigene Zugriffsregeln, eine eigene Speicherrichtlinie (Kontingent und Aufbewahrung) und optional eine Spiegel-Quelle. Ein Repository-Name hat 1 bis 64 Zeichen: lateinische Kleinbuchstaben, Ziffern, `-` und `_`, beginnend mit einem Buchstaben oder einer Ziffer.

Sie erstellen ein Repository nicht mit einem separaten Befehl. Ein Repository existiert, sobald einer Gruppe Zugriff auf seinen Namen gewährt wird oder eine Richtlinie eines Dienstkontos ihn nennt. Eine neue Installation hat einen Platz für das erste, `releases`. Siehe [Repositorys](../use/repositories).

## Artefakte {#artifacts}

Ein **Artefakt** ist eine gespeicherte Datei. Es ist **unveränderlich**: Seine Bytes ändern sich nie. Es hat eine UUID, einen Namen (bis zu 240 Zeichen, ohne `/` oder `\`), eine Größe und eine SHA-256-Prüfsumme. Neuer Inhalt erzeugt ein neues Artefakt; es ersetzt nie ein altes.

Ein Artefakt wird erst sichtbar, nachdem der Server geprüft hat, dass die Bytes mit der angegebenen Größe und dem SHA-256 übereinstimmen. Ein Download gibt dieselben Bytes zurück, mit der Prüfsumme als starkem `ETag`. Alles andere in Arkvory baut auf Artefakten auf: eine Paketversion, eine Revision eines Pfads, eine Container-Schicht und ein Git-LFS-Objekt sind alle Artefakte.

## Uploads {#uploads}

Ein **Upload** reserviert ein zukünftiges Artefakt. Sie erstellen eine **Upload-Sitzung** mit dem Namen, der Größe und dem SHA-256 der Datei und mit einem `Idempotency-Key`, der die Anfrage sicher wiederholbar macht. Dann senden Sie die Bytes:

- in einer Anfrage, für kleine und mittlere Dateien; oder
- in **Teilen**, für große Dateien. Der Server wählt die Teilgröße: mindestens 8 MiB, für sehr große Dateien verdoppelt, damit der Upload nie mehr als 10.000 Teile braucht. Ein Teil überschreitet nie 1 GiB. Jeder Teil trägt seinen eigenen SHA-256, und ein wiederholter Teil ist harmlos.

Dann **schließen** Sie den Upload **ab**. Der Server prüft die ganze Datei und veröffentlicht sie. Bei großen Dateien schließt der Worker den Upload in einem **Abschlussauftrag** ab, dem der Client folgt; das SDK und der Kommandozeilen-Client wählen dies für Dateien ab 16 GiB. Eine Upload-Sitzung lebt 7 Tage. Ein unterbrochener Upload setzt mit den Teilen fort, die der Server bereits hat. Das größte Objekt ist 10.000 GiB, sofern der Administrator nicht ein niedrigeres `ARKVORY_MAX_OBJECT_BYTES` festlegt.

Der [Kommandozeilen-Client](../protocols/cli) und das [SDK](../protocols/sdk) erledigen das alles für Sie. Siehe [Übertragungen](../use/transfers) und die [Upload-Referenz](../api/reference/uploads).

## Pakete {#packages}

Ein **Paket** ist ein UPack-Archiv, das Arkvory registriert hat. Seine Identität ist eine **Gruppe**, ein **Name** und eine **SemVer-Version**, zum Beispiel `acme` / `game-server` / `1.4.2`. Die Gruppe ist Teil der Identität: Zwei Pakete mit demselben Namen in verschiedenen Gruppen sind verschiedene Pakete. Eine veröffentlichte Version ändert sich nie; das Veröffentlichen derselben Version mit anderem Inhalt wird abgelehnt.

Ein Deployment-Agent fordert ein Paket über eine exakte Version, über einen **Versionsbereich** wie `^1.4` oder über die neueste Version in einer **Stufe** an. Vorabversionen erscheinen nur, wenn Sie sie anfordern. Siehe [Pakete](../use/packages).

## Dateien nach Pfad {#files-by-path}

Eine **Datei nach Pfad** hat eine Adresse wie `builds/game/1.4/Setup.exe` und zeigt auf ein Artefakt. Wenn Sie neue Bytes unter dem Pfad speichern, erhält der Pfad eine neue **Revision** (1, 2, 3 und so weiter). Frühere Revisionen bleiben im **Verlauf**, und Sie können eine **wiederherstellen**: Das Wiederherstellen fügt eine neue Revision mit dem alten Inhalt hinzu. Das erneute Speichern derselben Bytes fügt nichts hinzu.

Ein Pfad hat höchstens 1.024 Zeichen, verwendet `/` als Trennzeichen und hat keine leeren, `.`- oder `..`-Segmente und kein `:`. Eine Änderung nennt die Revision, die sie erwartet; wenn eine andere Änderung zuerst kam, antwortet der Server mit `409`. Verwenden Sie `0` für einen Pfad, der noch nicht existiert. Siehe [Dateien und Pfade](../use/files) und [Raw-Dateien](../protocols/raw-files).

## Labels, Metadaten, Sammlungen und Anhänge {#annotations}

Sie können ein Artefakt beschreiben, ohne seine Bytes zu berühren:

| Element    | Regel                                                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Labels     | Bis zu 32 kurze Tags wie `nightly` oder `tested`.                                                                                                               |
| Metadaten  | Bis zu 32 Textfelder; ein Schlüssel hat bis zu 64 Zeichen, ein Wert bis zu 1.024.                                                                               |
| Sammlungen | Benannte Mengen, die Artefakte gruppieren.                                                                                                                      |
| Anhänge    | Bis zu 32 Verknüpfungen von einem Build zu anderen Artefakten desselben Repositorys: ein Manifest, ein SBOM, eine Signatur, ein Bericht oder eine andere Datei. |

Labels, Metadaten und Sammlungen ändern sich als ein gemeinsamer Revisionsstand. Anhänge haben ihre eigene Revision und ihren eigenen Verlauf.

## Stufen und Hochstufung {#stages-and-promotion}

Eine **Stufe** ist eine kontrollierte Markierung an einem Build, wie `qa`, `release` oder `prod`. Ein Stufenname verwendet Kleinbuchstaben, Ziffern, `.`, `_` und `-` (bis zu 32 Zeichen), und ein Artefakt kann bis zu 16 Stufen haben. Das Ändern einer Stufe benötigt eine eigene Berechtigung, `artifact.promote`, und jede Änderung wird mit Akteur, Zeit und Kommentar aufgezeichnet.

**Hochstufung** veröffentlicht einen Build in einem anderen Repository, ohne die Bytes erneut zu senden. `copy` behält die Quelle; `move` entfernt den Build zusätzlich aus dem Quell-Repository. Eine wiederholte Hochstufung gibt die vorhandene Kopie zurück. **Auflösen** findet den Build, auf den eine Stufe und ein Versionsbereich zeigen. Siehe [Hochstufung](../use/promotion).

## Konten, Gruppen und Berechtigungen {#access}

Personen verwenden **Konten**. Ein Konto hat einen Namen (3 bis 64 Zeichen) und ein Passwort (12 bis 128 Zeichen). Ein **Administrator**-Konto verwaltet Konten und Gruppen. Konten gehören zu **Gruppen**, und einer Gruppe wird `read`- oder `write`-Zugriff („Read and write“) auf ein Repository gewährt. Rechte werden bei jeder Anfrage neu berechnet, daher wirkt eine Änderung sofort.

Automatisierung verwendet stattdessen ein **Dienstkonto**. Seine **Richtlinie** listet exakte **Aktionen** pro Repository auf, wie `upload.create` oder `content.read`, und seine Schlüssel können diese Richtlinie nur einschränken. Der Server prüft jede Aktion; das Ausblenden einer Schaltfläche in der Konsole ist kein Schutz. Siehe [Konten und Zugriff](../use/accounts) und [Authentifizierung](../api/authentication).

## Schlüssel und Token {#keys-and-tokens}

Jede Anfrage trägt eine Anmeldeinformation. Es gibt vier Arten, die Sie erstellen, und eine, die eingebaut ist:

| Anmeldeinformation              | Für                                                   | Lebensdauer                                         |
| ------------------------------- | ----------------------------------------------------- | --------------------------------------------------- |
| **Sitzung** der Konsole         | Eine Person, die mit Name und Passwort angemeldet ist | 12 Stunden                                          |
| **Persönliches Zugriffstoken**  | Skripte und Werkzeuge einer Person                    | standardmäßig 90 Tage, höchstens 365                |
| **Dienstschlüssel**             | CI/CD- und Deployment-Agenten                         | standardmäßig 90 Tage, höchstens 365                |
| **Download-Link**               | Ein Artefakt an jemanden ohne Schlüssel übergeben     | 60 Sekunden bis 24 Stunden (standardmäßig 1 Stunde) |
| **Wiederherstellungsschlüssel** | Die Installation selbst                               | Läuft nicht ab                                      |

Ein Dienstschlüssel wird einmal ausgegeben, einmal angezeigt und wird erst nutzbar, nachdem er **aktiviert** wurde. Sie können ihn **rotieren** (einen neuen ausgeben und dann den alten außer Betrieb nehmen) und endgültig **widerrufen**. Siehe [Authentifizierung](../api/authentication).

## Der Besitzer und der Wiederherstellungsschlüssel {#owner-and-recovery-key}

Der **Besitzer** ist das erste Konto. Es ist ein Administrator und Mitglied der Gruppe `arkvory-owners`, die `write`-Zugriff auf `releases` hat. Der Windows-Installer erstellt es; unter Linux und Docker erstellen Sie es in der Konsole mit dem Wiederherstellungsschlüssel.

Der **Wiederherstellungsschlüssel** ist ein Geheimnis, das der Installer in `config/bootstrap-token.txt` im Installationsverzeichnis schreibt. Er kann den ersten Besitzer und Konten erstellen, Dienstkonten und ihre Delegierungen verwalten, Backups ausführen und Updates anfordern. Die Installationstools lesen ihn auf dem Server. Er ist nicht für CI oder die tägliche Arbeit gedacht: Behalten Sie ihn auf dem Server und kopieren Sie ihn nicht. Siehe [Eine Installation wählen](../install/index#recovery-key) und [Sicherheit](../operate/security).

## Aufbewahrung, Kontingente und Bereinigung {#retention}

Eine **Speicherrichtlinie** gehört zu einem Repository. Sie kann die letzten N Builds jedes Pakets (oder jedes Pakets und Kanals) behalten, Labels und Stufen vor dem Entfernen schützen, ein Mindestalter abwarten, bevor etwas entfernt wird, und ein **Kontingent** mit Warn- und Kritisch-Schwellenwerten festlegen. Sie ist aus, bis ein Administrator sie einschaltet. Das Entfernen eines Artefakts ist zuerst logisch: Die Bytes bleiben für eine **Karenzzeit** (standardmäßig 24 Stunden) auf dem Datenträger, und dann gibt die **physische Bereinigung** den Platz im Hintergrund in kleinen Stapeln frei, ohne den Server anzuhalten.

Der Server hält außerdem eine Reserve an freiem Speicherplatz (standardmäßig 1 GiB) zurück, die Uploads nie verwenden. Siehe [Speicher](../operate/storage).

## Backups {#backups}

Der **Backup-Agent** kopiert die Datenbank und alle veröffentlichten Inhalte in den **Backup-Speicher**, einen Ordner auf einem anderen Datenträger oder einer Netzwerkfreigabe. Eine vollständige Kopie ist ein **Wiederherstellungspunkt**. Der Agent prüft jeden Punkt, wendet die Aufbewahrung auf die Punkte an (standardmäßig 7 täglich, 4 wöchentlich und 6 monatlich) und lässt Sie einen Punkt **anheften**, damit die Aufbewahrung ihn behält. Der tägliche Zeitplan ist aus, bis ein Administrator ihn in [[ui:backupPlan]] einschaltet.

Das Wiederherstellen ist ein Befehl auf dem Server. Er schreibt in eine leere Datenbank und ein leeres Speicherverzeichnis. Siehe [Backups](../operate/backups).

## Spiegel und Lese-Gateways {#mirrors-and-gateways}

Ein **Spiegel** ist eine schreibgeschützte Kopie eines Repositorys, die eine zweite Installation führt, indem sie der ersten, der **Quelle**, folgt. Er lehnt Änderungen ab und bedient Downloads. Wenn die Quelle verloren geht, trennt ein Betreiber den Spiegel und er wird zu einem gewöhnlichen Repository; der Wechsel ist manuell und kein automatisches Failover. Siehe [Spiegel](../operate/mirrors).

Ein **Lese-Gateway** ist ein zusätzlicher API-Prozess auf demselben Speicher, der nur `GET` und `HEAD` beantwortet. Der Writer und die Gateways teilen sich ein Download-Bandbreitenbudget. Siehe [Lese-Gateways](../operate/read-gateways).

## Wie es weitergeht {#next}

1. [Schnellstart](./quick-start): Installieren Sie Arkvory und laden Sie eine erste Datei hoch.
2. [Konten und Zugriff](../use/accounts): Personen, Gruppen, Token und Dienstschlüssel.
3. [HTTP-API-Überblick](../api/index): die Regeln, die jede Integration braucht.
4. [Glossar](../reference/glossary): kurze Definitionen jedes Begriffs.
