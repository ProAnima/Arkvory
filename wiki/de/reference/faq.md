---
title: FAQ
description: Kurze, präzise Antworten auf häufige Fragen zu Grenzen, Verfügbarkeit, Datenbanken, Updates, dem Umzug auf einen anderen Server, Zugriff und Lizenz.
---

# FAQ

## Größe und Verfügbarkeit {#size-and-availability}

### Welche ist die größte Datei, die ich speichern kann? {#max-object-size}

10.000 GiB (10 737 418 240 000 Bytes). Ein Upload umfasst höchstens 10.000 Teile von je höchstens 1 GiB. Der Administrator kann mit `ARKVORY_MAX_OBJECT_BYTES` ein niedrigeres Limit festlegen. Eine größere angegebene Größe wird mit `400` abgelehnt. In der Praxis begrenzen Sie zuerst der freie Speicherplatz, das Kontingent des Repositorys und die Reserve von 1 GiB freiem Speicher: Sie antworten mit `507`. Siehe [Konzepte](../guide/concepts#uploads) und [Umgebungsvariablen](./environment).

### Wie viel kann ein Server speichern? {#capacity}

Arkvory reserviert standardmäßig bis zu 10 TiB Inhalt (`ARKVORY_CAPACITY_BYTES`) und zählt dabei veröffentlichte Dateien, nicht abgeschlossene Uploads und Inhalt, der auf die Bereinigung wartet. Es ist ein Zähler, keine Datenträgerprüfung. Der Datenträger und die Reserve sind die eigentliche Grenze. Ein Repository kann ein eigenes Kontingent haben. Siehe [Speicher](../operate/storage).

### Ist Arkvory hochverfügbar? {#high-availability}

Nein. Eine Installation ist ein Server mit einer PostgreSQL-Datenbank und einem lokalen Inhaltsverzeichnis. Bleibt der Server stehen, warten die Clients und setzen ihre Übertragungen dann fort; die Dienste starten nach einem Absturz oder Stillstand selbst neu. Zum Schutz vor dem Verlust des Servers verwenden Sie [Backups](../operate/backups). Zum Lesen von einem zweiten Standort verwenden Sie [Spiegel](../operate/mirrors); das Umschalten auf einen Spiegel ist ein manueller Schritt, und Änderungen, die der Spiegel noch nicht erhalten hat, gehen verloren.

### Funktioniert es offline? {#offline}

Der Server funktioniert ohne Internetzugang. Das Windows-Installationsprogramm enthält Node.js und PostgreSQL und installiert offline. Die Linux-Pakete enthalten Node.js, und der Paketmanager installiert PostgreSQL. Die Skript-Installer und Docker laden Dateien herunter. Updates lassen sich aus einer lokalen Kopie eines Releases installieren. Ist der Update-Hub nicht erreichbar, schlägt die Update-Prüfung fehl und wird in der Konsole angezeigt; alles andere ist nicht betroffen. Siehe [Eine Installation wählen](../install/index) und [Updates](../install/updates).

## Speicher und Datenbank {#storage-and-database}

### Welche Datenbank verwendet es? {#database}

PostgreSQL, eine Datenbank pro Installation. Das Windows-Installationsprogramm enthält PostgreSQL 18.4. Die Linux-Pakete verwenden einen dedizierten Cluster eines PostgreSQL-16-bis-19-Servers aus Ihrer Distribution. Der Docker-Compose-Stack betreibt PostgreSQL 18.4 in einem Container. Die Skript-Installer verwenden Ihren eigenen Server. Verbinden Sie niemals zwei Installationen mit einer Datenbank. Dateiinhalte liegen nicht in der Datenbank, sondern im Datenverzeichnis.

### Kann ich S3 oder einen anderen Objektspeicher verwenden? {#s3}

Nein. Dateiinhalte werden in einem lokalen Verzeichnis gespeichert, das auf einem lokalen Dateisystem mit Unterstützung für Hardlinks liegen muss, nicht auf einer Netzwerkfreigabe. Arkvory speichert keine Inhalte in S3 und bietet keine S3-Schnittstelle an. Der Backup-Speicher ist ein Ordner auf einem anderen Datenträger oder auf einer eingebundenen Netzwerkfreigabe (unter Windows ein lokales oder iSCSI-Volume).

### Kann ich das Single Sign-on meines Unternehmens verwenden? {#sso}

Nein. Konten, Gruppen und Passwörter gehören zu Arkvory. Automatisierung meldet sich mit Dienstschlüsseln an. Siehe [Authentifizierung](../api/authentication).

## Den Server betreiben {#running}

### Wie sehe ich, welche Version installiert ist? {#version}

Öffnen Sie in der Konsole [[ui:updates]]: [[ui:updateCurrent]] zeigt sie an. Führen Sie auf dem Server `arkvory status --root <installation root>` aus und lesen Sie `current`; führen Sie unter Windows mit dem grafischen Installationsprogramm `& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' status --root 'C:\ProgramData\ProAnima\Arkvory'` in einer erhöhten PowerShell aus. Ein Administrator kann auch `GET /api/v1/system/updates` aufrufen, das `currentVersion` zurückgibt. Der Befehl `arkvoryctl --version` zeigt die Version des Clients, nicht die des Servers.

### Wie schalte ich automatische Updates ein? {#automatic-updates}

Öffnen Sie in der Konsole [[ui:updates]], wählen Sie [[ui:updateAutomatic]], wählen Sie die [[ui:updateHour]] und wählen Sie [[ui:updateSave]]. Führen Sie auf dem Server `arkvory configure --root <installation root> --enable-updates` aus; `--disable-updates` schaltet sie aus. Installationsprogramme lassen sie ausgeschaltet, sofern Sie nicht `--automatic` übergeben.

Der Server sucht alle 6 Stunden nach einem Release, auch wenn die automatische Installation ausgeschaltet ist. Ist sie eingeschaltet, wird ein stabiles Release einmal täglich während der Wartungsstunde installiert (standardmäßig 03:00 UTC), sofern die Version nicht angeheftet ist. Ein Release, das das Datenbankschema ändert, wird erst installiert, nachdem der Server ein frisches Backup erstellt und geprüft hat. Siehe [Updates](../install/updates).

### Was sendet Arkvory an ProAnimaStudio? {#hub-traffic}

Ihre Dateien und Daten bleiben auf Ihrem Server. Der Server kontaktiert den Hub von ProAnimaStudio (`hub.proanima.net`) und, wenn der Hub nicht erreichbar ist, GitHub, um drei Dinge zu erledigen:

- **Update-Prüfungen.** Die Anfrage enthält den Projektnamen, das Betriebssystem, die Prozessorarchitektur, die installierte Version und den Update-Kanal. Ist die Statistik eingeschaltet, enthält sie außerdem eine zufällige Installations-ID.
- **Anonyme Statistiken.** Ein Ereignis nach jedem installierten Update mit der Installations-ID, der Version, dem System, der Architektur und dem Kanal. Es werden keine Namen, Adressen, Inhalte oder IP-Adressen gespeichert. Statistiken sind standardmäßig eingeschaltet; schalten Sie sie mit [[ui:updateStatistics]] in [[ui:updates]] oder mit `arkvory configure --statistics off` aus. Ohne Statistiken erreicht Sie eine neue Version erst, wenn sie für alle ausgerollt wird.
- **Feedback.** Nur wenn eine angemeldete Person es über [[ui:reportOpen]] sendet. Es enthält die Nachricht, eine optionale E-Mail-Adresse, bis zu 6 Screenshots und das Konsolenprotokoll. Ein Administrator kann das Serverprotokoll und eine Zusammenfassung von Versionen und Zuständen ohne Geheimnisse hinzufügen. [[ui:reportShow]] zeigt genau, was gesendet wird.

`arkvory configure --hub-off` beendet den Kontakt mit dem Hub: Releases kommen dann nur noch von GitHub, und Feedback wird nach dem Neustart der Dienste ausgeschaltet. Eine leere `ARKVORY_HUB_URL` schaltet nur das Feedback aus. Siehe [Lizenz](https://github.com/ProAnima/Arkvory/blob/main/LICENSE.md), Abschnitt 7.

### Laufen Backups von selbst? {#automatic-backups}

Erst wenn Sie sie einrichten. Verbinden Sie einen Backup-Speicher mit `arkvory configure --backup-vault <folder> --init-vault` und schalten Sie dann den täglichen Zeitplan in [[ui:backupPlan]] in [[ui:backups]] ein. Der Plan beginnt um 02:00 UTC und behält 7 tägliche, 4 wöchentliche und 6 monatliche Wiederherstellungspunkte. Solange der Zeitplan ausgeschaltet ist, zeigt die Konsole die Warnung, dass der tägliche Zeitplan aus ist. Siehe [Backups](../operate/backups).

### Wie ziehe ich auf einen anderen Server um? {#move-server}

1. Installieren Sie Arkvory in derselben oder einer neueren Version auf dem neuen Server.
2. Stellen Sie den neuesten Wiederherstellungspunkt aus dem Backup-Speicher mit dem Befehl `arkvory-backup restore` in eine leere Datenbank und ein leeres Speicherverzeichnis wieder her. Er prüft jede Datei per SHA-256. Siehe [Backups](../operate/backups).
3. Richten Sie `ARKVORY_DATABASE_URL` und `ARKVORY_DATA_DIR` in `config/runtime.json` auf die wiederhergestellte Datenbank und das Verzeichnis, starten Sie die Dienste neu und prüfen Sie die Konsole, einen Download und einen Upload.
4. Verlegen Sie die Adresse (DNS oder die CI-Einstellungen) auf den neuen Server.

Benutzer, Gruppen und Passwörter kommen zurück. Sitzungen werden nicht übernommen, persönliche Token und Dienstschlüssel werden widerrufen; melden Sie sich daher erneut an und stellen Sie neue Schlüssel aus. Aufbewahrungs- und Bereinigungsrichtlinien kommen ausgeschaltet zurück; schalten Sie sie bewusst ein. Uploads, die nicht abgeschlossen wurden, werden abgebrochen. Für ein Repository, das Sie umziehen möchten, während der alte Server weiterläuft, können Sie den neuen Server es auch als [Spiegel](../operate/mirrors) verfolgen lassen und ihn beim Umschalten abtrennen; ein Spiegel trägt die Dateien, Pakete und Images, aber keine Konten, Schlüssel, Anhänge oder Richtlinien.

### Was geschieht mit einer Übertragung, wenn der Server neu startet? {#interrupted-transfers}

Der Client setzt fort. Eine Upload-Sitzung lebt 7 Tage und behält die Teile, die angekommen sind; der Kommandozeilen-Client und das SDK fragen den Server, was er hat, und senden den Rest. Ein Download wird mit einer `Range`-Anfrage fortgesetzt. Eine einzelne `PUT`-Anfrage, etwa eine Raw-Datei oder ein Docker-Layer, beginnt wieder beim ersten Byte. Siehe [Unterbrochene Übertragungen fortsetzen](../protocols/cli#resume-interrupted-transfers).

### Wo schaue ich nach, wenn etwas fehlschlägt? {#logs}

Jeder Fehler hat eine Anfrage-ID, im Feld `requestId` und im Header `X-Request-Id`. Sie finden sie im Zugriffsprotokoll des Servers. Die Dienste schreiben ihre Protokolle unter Windows in den Ordner `logs` und unter Linux ins Journal (`journalctl -u arkvory-api`). Senden Sie einen Bericht mit [[ui:reportOpen]], um die Protokolle beizufügen. Siehe [Fehlerbehebung](../operate/troubleshooting) und [Monitoring](../operate/monitoring).

## Zugriff {#access}

### Wie setze ich das Passwort des Besitzers zurück? {#reset-owner-password}

Ein anderer Administrator kann [[ui:resetPassword]] in [[ui:administration]] verwenden. Kann sich niemand anmelden, verwenden Sie den Wiederherstellungsschlüssel aus `config/bootstrap-token.txt`: Ermitteln Sie die ID des Kontos mit `GET /api/v1/users` und senden Sie `PATCH /api/v1/users/<id>` mit `{"password": "…"}`. Das neue Passwort hat 12 bis 128 Zeichen. Das Zurücksetzen beendet alle Sitzungen und persönlichen Token des Kontos. Siehe [Authentifizierung](../api/authentication#recovery-key).

### Was ist der Wiederherstellungsschlüssel, und was, wenn ich ihn verliere? {#lost-recovery-key}

Er ist ein Geheimnis in `config/bootstrap-token.txt` im Installationsverzeichnis, das nur der Systemadministrator lesen kann. Er erstellt den ersten Besitzer und verwaltet Dienstkonten. Die Installationswerkzeuge lesen die Datei, löschen Sie sie daher nicht. Ist die Datei verloren, Sie haben aber noch ein Administratorkonto, können Sie mit dem Konto weiterarbeiten; um einen neuen Wiederherstellungsschlüssel zu erzeugen, folgen Sie [Konfiguration](../install/configuration). Siehe [Konzepte](../guide/concepts#owner-and-recovery-key).

### Welchen Schlüssel sollte mein CI verwenden? {#ci-key}

Einen Dienstschlüssel eines Dienstkontos, dessen Richtlinie nur die Aktionen enthält, die der Auftrag braucht, zum Beispiel `upload.create`, `upload.write`, `upload.complete`, `upload.read` und `job.read` zum Veröffentlichen. Die Konsolen-Voreinstellungen [[ui:bindingRead]] und [[ui:bindingPublish]] füllen typische Sätze. Verwenden Sie im CI weder den Wiederherstellungsschlüssel noch das Token einer Person. Schlüssel gelten standardmäßig 90 Tage und sind auf 365 begrenzt; planen Sie daher eine Rotation. Siehe [Authentifizierung](../api/authentication#service-accounts).

### Warum kann ein Administrator ein Artefakt nicht löschen oder eine Speicherrichtlinie ändern? {#delete-forbidden}

Die Aktionen `artifact.delete`, `storage.read`, `storage.manage` und `diagnostics.read` existieren nur für Dienstschlüssel. Eine Gruppenzuweisung, ein persönliches Token, eine Sitzung und der Wiederherstellungsschlüssel tragen sie nie. Erstellen Sie ein Dienstkonto, das diese Aktionen für das Repository hat, stellen Sie einen Schlüssel aus und verwenden Sie diesen Schlüssel für den Aufruf (die API, `arkvoryctl` oder [[ui:keySignIn]] in der Konsole). Der Fehler ist `403` mit dem Grund `permission_missing`. Siehe [Authentifizierung](../api/authentication#repository-actions).

### Funktionieren Docker, Git LFS und Unity damit? {#protocols}

Ja. Arkvory bedient eine Container-Registry unter `/v2/`, einen Git-LFS-Server unter `/lfs/<repository>` und eine npm-Registry unter `/npm/<repository>/`, die der Unity Package Manager nutzen kann. Sie akzeptieren den Arkvory-Schlüssel als Passwort. Siehe [Clients und Protokolle](../protocols/index).

## Lizenz {#license}

### Ist Arkvory Open Source? {#open-source}

Nein. Arkvory ist kostenlos, und sein Quellcode ist zum Lesen offen, aber es ist kein Open Source. Es steht unter der ProAnima Arkvory License 1.0 von Ian Panaev, die nicht erlaubt, Forks oder Kopien zu verbreiten. Bitte nennen Sie es nicht „Open Source“. Der vollständige Text steht in [LICENSE.md](https://github.com/ProAnima/Arkvory/blob/main/LICENSE.md); bei Abweichungen zwischen beiden Fassungen gilt der russische Text.

### Was darf ich damit tun? {#license-allowed}

Sie dürfen beliebig viele Kopien für jeden Zweck installieren und verwenden, auch in einem Unternehmen; den Quellcode lesen und studieren; ihn ändern; und Ihre geänderte Version innerhalb Ihrer Organisation verwenden. Sie dürfen Ihre eigenen Artefakte darüber speichern und ausliefern, auch an Ihre eigenen Kunden.

### Was ist nicht erlaubt? {#license-forbidden}

Sie dürfen die Software oder geänderte Versionen nicht an Personen außerhalb Ihrer Organisation verbreiten, keine Forks, Builds, Container-Images oder Patches veröffentlichen, die ihren Code enthalten, sie oder den Zugriff darauf nicht verkaufen, vermieten oder verleihen, keine Gebühren dafür verlangen und sie Dritten nicht als gehosteten oder verwalteten Dienst anbieten. Sie dürfen die Urheberrechtshinweise, die Lizenz oder die Namen ProAnima Arkvory und ProAnimaStudio nicht entfernen und eine geänderte Version nicht als Original darstellen. Wenn Sie öffentlich ein System beschreiben, das auf Arkvory aufbaut, nennen Sie die Quelle: „ProAnima Arkvory by ProAnimaStudio (Ian Panaev), https://github.com/ProAnima/Arkvory“. Beziehen Sie Kopien nur aus den offiziellen Quellen. Für andere Genehmigungen schreiben Sie an info@proanima.net.

### Wo melde ich ein Problem oder eine Sicherheitslücke? {#report}

Für ein Problem mit Ihrer Installation verwenden Sie [[ui:reportOpen]] in der Konsole. Bei einem Sicherheitsproblem folgen Sie [SECURITY.md](https://github.com/ProAnima/Arkvory/blob/main/SECURITY.md) im Repository und veröffentlichen es nicht öffentlich.
