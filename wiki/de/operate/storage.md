---
title: Speicher
description: 'Planen Sie Datenträgerspeicher, legen Sie Kontingente und Aufbewahrungsrichtlinien pro Repository fest, geben Sie Speicherplatz frei, ohne den Server zu stoppen, und reagieren Sie, wenn der Datenträger voll ist.'
---

# Speicher

Arkvory hält jede veröffentlichte Datei einmal, unverändert, in einem Speicherverzeichnis auf einem lokalen Datenträger des Servers. Diese Seite erklärt, was Datenträgerspeicher belegt, wie Sie ihn mit Kontingenten und Aufbewahrungsrichtlinien begrenzen, wie gelöschte Dateien den Datenträger verlassen und was zu tun ist, wenn der Datenträger voll ist.

## Wo die Inhalte liegen {#location}

Das Speicherverzeichnis wird durch `ARKVORY_DATA_DIR` festgelegt. Die Installationsprogramme verwenden diese Orte:

| Installation   | Speicher                                     |
| -------------- | -------------------------------------------- |
| Windows        | `data\` in `C:\ProgramData\ProAnima\Arkvory` |
| Linux          | `data/` in `/opt/proanima-arkvory`           |
| Docker Compose | Das Docker-Volume `proanima-arkvory_storage` |

Darin enthält `blobs/` die fertigen Dateien, `staging/` und `parts/` enthalten laufende Uploads, und die Datei `storage-id` bindet das Verzeichnis an die Datenbank. Der Katalog mit allen Namen, Labels, Versionen und Berechtigungen liegt in PostgreSQL. Dateien und Datenbank gehören zusammen.

- Verwenden Sie ein lokales Dateisystem, das Hardlinks unterstützt. Verwenden Sie keine Netzwerkfreigabe für den Speicher.
- Fügen Sie Dateien im Verzeichnis nicht von Hand hinzu, ändern oder löschen Sie sie nicht. Arkvory entfernt Dateien selbst, wie unten beschrieben.
- Eine veröffentlichte Datei wird nie geändert. Neuer Inhalt ist eine neue Datei mit einer neuen ID.

## Den Datenträger planen {#disk}

Folgendes belegt Datenträgerspeicher auf dem Speicher-Volume:

| Was                                       | Hinweise                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Veröffentlichte Dateien                   | Alle Versionen, die Sie behalten                                                                                                                                   |
| Laufende Uploads                          | Die Teile und die Staging-Dateien, bis der Upload endet                                                                                                            |
| Dateien abgeschlossener Uploads in Teilen | Die temporären Teile bleiben neben der fertigen Datei, bis ein Durchlauf der physischen Bereinigung sie entfernt. Siehe [Physische Bereinigung](#physical-cleanup) |
| Gelöschte Dateien                         | Sie bleiben auf dem Datenträger, bis die Karenzzeit endet und ein Bereinigungsdurchlauf sie entfernt                                                               |
| Spiegelkopien                             | Ein Teil in `mirror-staging`, während ein Spiegel eine Datei kopiert. Siehe [Spiegel](./mirrors)                                                                   |

Planen Sie neben dem Speicher nach Möglichkeit die PostgreSQL-Datenbank, die Logs und den Backup-Speicher auf eigenen Volumes. Siehe [Backups](./backups).

Arkvory hält eine **Reserve** an freiem Speicherplatz auf dem Speicher-Volume. Standardmäßig sind es 1 GiB (`ARKVORY_STORAGE_RESERVE_BYTES`). Ein Upload, der die Reserve nutzen würde, wird mit HTTP 507 und dem Grund `storage_full` abgelehnt. Downloads funktionieren weiter. `GET /health/ready` zeigt `writable: false`, solange kein Platz für neue Daten ist.

Zwei Grenzen wirken unabhängig vom Datenträger:

- `ARKVORY_CAPACITY_BYTES` begrenzt den gesamten reservierten Inhalt der Installation. Der Standardwert ist 10 TiB. Es ist eine logische Grenze, keine Prüfung des Datenträgers. Wenn sie erreicht ist, schlagen Uploads mit HTTP 507 und dem Grund `catalog_limit` fehl.
- `ARKVORY_MAX_OBJECT_BYTES` begrenzt die Größe einer Datei.

Siehe [Umgebungsvariablen](../reference/environment#storage-and-limits). Arkvory hat keine Metrik für den freien Speicherplatz des Speichers oder der Datenbank. Beobachten Sie die Volumes mit den Werkzeugen Ihres Betriebssystems oder einem Node-Exporter.

## Wer den Speicher verwalten kann {#permissions}

Speichereinstellungen sind nicht Teil der normalen Lese- und Schreibrechte. Ein Dienstschlüssel braucht ausdrückliche Aktionen am Repository:

| Aktion             | Erlaubt                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `storage.read`     | Die Richtlinie, die Nutzung und die Bereinigungseinstellungen sehen                                              |
| `storage.manage`   | Die Richtlinie, das Kontingent und die Bereinigungseinstellungen ändern und einen Bereinigungsstapel anfordern   |
| `artifact.delete`  | Löschungen in der Vorschau anzeigen, Artefakte löschen und eine automatische Aufbewahrungsrichtlinie einschalten |
| `diagnostics.read` | Die Speicherereignisse lesen                                                                                     |

Konten mit Passwort und der Wiederherstellungsschlüssel haben diese Rechte nicht von selbst. So verwalten Sie den Speicher in der Konsole:

1. Erstellen Sie ein Dienstkonto mit einer Richtlinie für das Repository, die die vier Aktionen enthält. Siehe [Konten und Zugriff](../use/accounts).
2. Stellen Sie einen Schlüssel dafür aus und aktivieren Sie ihn.
3. Öffnen Sie in der Konsole [[ui:keySignIn]], fügen Sie den Schlüssel ein und wählen Sie [[ui:connect]].
4. Öffnen Sie [[ui:repositories]] und wählen Sie auf der Karte des Repositorys [[ui:repositoryStorage]].

Das Panel [[ui:storageTitle]] erscheint über dem Katalog. Ohne die Rechte bleibt das Panel verborgen.

Eine aktivierte Aufbewahrungsrichtlinie ist an den **Schlüssel gebunden, der sie aktiviert hat**. Jeder automatische Lauf prüft erneut, dass dieser Schlüssel noch aktiv, nicht abgelaufen ist und noch `storage.manage` und `artifact.delete` hat. Wenn Sie den Schlüssel widerrufen oder seine Rechte einschränken, stoppt die Löschung, und das Ereignis `retention.failed` erscheint. Nachdem Sie den Schlüssel rotiert haben, speichern Sie die Richtlinie erneut mit dem neuen Schlüssel.

## Kontingente und Warnschwellen {#quotas}

Ein Repository kann ein Kontingent haben. Ohne Kontingent gilt nur die globale Grenze.

| Einstellung        | Konsolenfeld                  | Bedeutung                                                                                                                                             | Standard   |
| ------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Kontingent         | [[ui:storageQuota]]           | Der maximale Speicherplatz, den das Repository verwenden darf. Die API nimmt exakte Bytes, von 1 bis 9 007 199 254 740 991, und `null` für kein Limit | Kein Limit |
| Warnschwelle       | [[ui:storageWarningPercent]]  | Der Anteil des Kontingents, der eine Warnung auslöst. 1–98                                                                                            | 80         |
| Kritische Schwelle | [[ui:storageCriticalPercent]] | Der Anteil, der einen Fehler auslöst. 2–99, höher als die Warnschwelle                                                                                | 95         |

Die Nutzung, die gegen das Kontingent zählt, ist die Größe aller Dateien des Repositorys, die noch nicht vom Datenträger entfernt wurden: veröffentlichte Dateien, unfertige Uploads und gelöschte Dateien, die auf die Bereinigung warten. Eine gelöschte Datei belegt daher weiterhin Kontingent, bis ein Bereinigungsdurchlauf sie entfernt.

- **Prüfung.** Der Server prüft das Kontingent, wenn ein Upload beginnt. Ein neuer Upload, der das Kontingent überschreiten würde, schlägt mit HTTP 507 und dem Grund `storage_quota` fehl. Ein neuer Versuch mit demselben Idempotenzschlüssel reserviert den Speicher nicht zweimal.
- **Senken.** Sie können ein Kontingent unter die aktuelle Nutzung setzen. Laufende Uploads können beendet werden. Neue Uploads über der Grenze werden abgelehnt.
- **Keine automatische Freigabe.** Das Kontingent löst nie eine Löschung aus. Die Aufbewahrung entfernt keine zusätzlichen Builds, um ein Kontingent einzuhalten.
- **Zustände.** Der Zustand ist `unlimited`, `normal`, `warning`, `critical` oder `exceeded`. Eine Zustandsänderung wird einmal als Speicherereignis aufgezeichnet.
- **Überwachung.** Der Server prüft die Zustände von bis zu 20 Repositorys jede Minute erneut, auch wenn die automatische Löschung aus ist.

Die Zahlen sind logische Reservierungen, kein freier Datenträgerspeicher. Ein Repository kann unter seinem Kontingent liegen, während der Datenträger voll ist, weil der Datenträger auch Staging-Dateien und andere Repositorys enthält.

## Aufbewahrungsrichtlinie {#retention}

Eine Aufbewahrungsrichtlinie löscht alte **registrierte UPack-Builds** automatisch und behält die letzten N davon. Sie löscht keine anderen Dateien: einfache Dateien nach Pfad, Container-Images, Git-LFS-Objekte und npm-Pakete liegen außerhalb davon. Ohne Richtlinie wird nichts automatisch gelöscht.

### Die Einstellungen {#retention-settings}

| Einstellung       | Konsolenfeld            | Bedeutung                                                                                                                  | Standard                              |
| ----------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Aktivieren        | [[ui:storageEnabled]]   | Schaltet die automatische Löschung ein                                                                                     | Aus                                   |
| Gruppierung       | [[ui:storageGrouping]]  | Die Einheit, die gezählt wird: [[ui:storagePerChannel]], [[ui:storagePerPackage]] oder [[ui:storageGlobal]]                | Paket und Kanal                       |
| Letzte N          | [[ui:storageKeep]]      | Wie viele Builds pro Zähler behalten werden, 1–100 000                                                                     | 10                                    |
| Kanäle            | [[ui:storageChannels]]  | Eigenes N für ein Label, als `label=N`, eines pro Zeile, bis zu 32. Wird nur bei der Gruppierung Paket und Kanal verwendet | `test=10`, `staging=10`, `release=10` |
| Mindestalter      | [[ui:storageAge]]       | Ein jüngerer Build wird behalten, in Stunden, 0–87 600                                                                     | 24                                    |
| Geschützte Labels | [[ui:storageProtected]] | Builds mit einem dieser Labels werden nie gelöscht, bis zu 32, durch Kommas getrennt                                       | `bse`, `release`                      |
| Intervall         | [[ui:storageInterval]]  | Minuten zwischen den Läufen, 1–10 080                                                                                      | 60                                    |

Ein Label besteht aus 1 bis 64 Buchstaben, Ziffern oder den Zeichen `_ . : -`.

### Wie Builds ausgewählt werden {#retention-rules}

1. Der Server ordnet die Builds jedes Zählers nach der **Veröffentlichungszeit**, neueste zuerst. Die Reihenfolge ist nicht die SemVer-Reihenfolge der Versionen.
2. Der Zähler hängt von der Gruppierung ab. Bei Paket und Kanal wird ein Build für jedes konfigurierte Kanal-Label, das es trägt, getrennt pro Paket (`group/name`) gezählt. Ein Build ohne konfiguriertes Label geht in einen gemeinsamen Zähler des Pakets mit dem Standard-N. Bei Paket hat jedes Paket einen Zähler. Beim ganzen Repository teilen sich alle Builds einen Zähler. Paketnamen ignorieren die Groß-/Kleinschreibung, Labels nicht.
3. Ein Build bleibt, wenn es unter den letzten N **eines** Zählers ist, zu dem es gehört.
4. Ein Build, das jünger als das Mindestalter ist, bleibt.
5. Ein Build mit einem geschützten Label bleibt. Seine Labels stammen aus der aktuellen Annotation oder aus dem Upload, wenn es keine Annotation hat. Geschützte Builds nehmen weiterhin an der Rangfolge teil, die behaltene Anzahl kann also höher als N sein.

Ein Build wird nie gelöscht, solange noch etwas es braucht:

- Ein externer Dienst hält eine Referenz darauf.
- Ein Dateipfad, aktuell oder aus dem Verlauf, verwendet es.
- Ein anderes Build führt es als Anhang auf, jetzt oder im Verlauf.
- Es ist auf eine Stufe hochgestuft. Entfernen Sie zuerst die Stufe.
- Ein Container-Image, Git-LFS- oder npm-Eintrag verwendet es.

Das Löschen eines Builds ist logisch: Es verlässt die Listen, und neue Downloads schlagen mit 404 fehl. Die Bytes verlassen den Datenträger später, in [Physische Bereinigung](#physical-cleanup). Die Paketversion bleibt reserviert, dieselbe Version kann also nicht erneut mit anderem Inhalt veröffentlicht werden.

### Eine Richtlinie sicher aktivieren {#retention-enable}

Zuerst die Vorschau, dann aktivieren. Eine Vorschau zeigt, was die gespeicherte Richtlinie löschen würde, und löscht nichts.

1. Verbinden Sie sich mit einem Schlüssel, der die vier Aktionen hat, und öffnen Sie das Speicherpanel des Repositorys.
2. Legen Sie die Felder fest und lassen Sie [[ui:storageEnabled]] aus. Wählen Sie [[ui:storageSave]].
3. Wählen Sie [[ui:storagePreview]]. Die Liste zeigt bis zu 100 Builds, die die gespeicherte Richtlinie in einem Stapel löschen würde. Wenn mehr Kandidaten übrig bleiben, sagt die Konsole das.
4. Wenn die Liste stimmt, aktivieren Sie [[ui:storageEnabled]] und die Bestätigung [[ui:storageAcknowledge]] und speichern Sie erneut. Dafür ist `artifact.delete` nötig.

Hinweise:

- Die Vorschau zeigt einen Moment. Wenn die Richtlinie läuft, ordnet sie erneut und prüft die Abhängigkeiten erneut.
- Die Richtlinie wird mit einer Revision gespeichert. Wenn jemand anderes sie geändert hat, laden Sie neu und speichern Sie erneut.
- [[ui:storageRefresh]] lädt die Einstellungen und die Nutzung neu.

### Wie sie läuft {#retention-run}

Der schreibende API-Prozess (kein Lese-Gateway) prüft alle 60 Sekunden und bearbeitet bis zu 20 fällige Richtlinien. Ein Stapel löscht höchstens 100 Builds. Wenn Kandidaten übrig bleiben, startet der nächste Stapel nach einer Minute. Andernfalls kommt der nächste Lauf nach dem Intervall. Der Zeitplan wird in der Datenbank gespeichert und übersteht einen Neustart.

Sie können auch selbst einen Stapel mit dem API-Vorgang [runStoragePolicy](../api/reference/storage#runStoragePolicy) ausführen. Die Nutzung, die Vorschau und die Ereignisse haben Vorgänge in derselben [Speicher-API-Referenz](../api/reference/storage).

## Physische Bereinigung {#physical-cleanup}

Das Löschen eines Artefakts, durch eine Person oder eine Richtlinie, entfernt es nur aus dem Katalog. Die **physische Bereinigung** entfernt seine Bytes vom Datenträger, im Hintergrund und ohne die API, den Worker oder die Lese-Gateways zu stoppen. Sie erledigt außerdem:

- Bricht Uploads ab, die abgelaufen sind, ohne fertig zu werden, und entfernt ihre Teile.
- Entfernt die temporären Teile abgeschlossener Uploads.

Sie wählt keine zu löschenden Builds aus. Sie entfernt nur, was bereits gelöscht oder abgebrochen ist.

**Die physische Bereinigung ist standardmäßig aus und wird pro Repository festgelegt.** Schalten Sie sie in jedem Repository ein, das Sie verwenden. Bis dahin bleiben gelöschte Dateien, abgelaufene Uploads und die Teile abgeschlossener Uploads auf dem Datenträger, und das Kontingent zählt die gelöschten Dateien.

### Einstellungen {#cleanup-settings}

Öffnen Sie im Panel des Repositorys [[ui:cleanupTitle]]:

| Einstellung | Konsolenfeld           | Bedeutung                                                             | Standard | Bereich  |
| ----------- | ---------------------- | --------------------------------------------------------------------- | -------- | -------- |
| Aktivieren  | [[ui:cleanupEnabled]]  | Schaltet die Hintergrundbereinigung ein                               | Aus      |          |
| Karenzzeit  | [[ui:cleanupGrace]]    | Wie lange eine gelöschte Datei auf dem Datenträger bleibt, in Stunden | 24       | 0–8760   |
| Stapel      | [[ui:cleanupBatch]]    | Dateien, die in einem Stapel bearbeitet werden                        | 25       | 1–100    |
| Intervall   | [[ui:cleanupInterval]] | Sekunden zwischen den Stapeln                                         | 60       | 5–86 400 |
| Verzögerung | [[ui:cleanupDelay]]    | Millisekunden Pause zwischen Dateien                                  | 50       | 0–1000   |

Wählen Sie [[ui:cleanupSave]], um sie anzuwenden. Die Änderung wirkt sofort. Wenn Sie die Bereinigung ausschalten, stoppt sie nach der aktuellen Datei. [[ui:cleanupRun]] fordert bald einen Stapel an, löscht aber nicht sofort. Wählen Sie [[ui:cleanupRefresh]], um das Ergebnis des letzten Stapels zu sehen.

Die Karenzzeit ist kein Papierkorb. Beim Wert 0 kann eine Datei sofort verschwinden, nachdem sie gelöscht wurde und kein Leser sie mehr geöffnet hat. Arkvory kann ein gelöschtes Artefakt nicht wiederherstellen.

### Was die Bereinigung tut und was sie überspringt {#cleanup-rules}

- Sie entfernt nur Dateien, die abgebrochen oder gelöscht sind und die Karenzzeit überschritten haben. Sie prüft erneut, dass nichts sie verwendet: keine Referenz, kein Dateipfadverlauf und kein Anhangsverlauf.
- Ein offener Download, ein Upload, der gerade geschrieben wird, und eine Datei, die ein laufendes Backup braucht, lassen die Bereinigung diese Datei **überspringen**. Der nächste Stapel versucht es erneut. Das letzte Ergebnis zeigt, wie viele Dateien verarbeitet, übersprungen und fehlgeschlagen sind und wie viele Bytes freigegeben wurden.
- Das Kontingent und die logische Kapazität werden erst freigegeben, nachdem die Dateien vom Datenträger entfernt wurden.
- Ein Stapel ist durch die Stapelgröße und die Verzögerung begrenzt, was die Datenträgerlast senkt. Er garantiert keinen strikten Datenträgerdurchsatz und kann keinen Null-Einfluss auf die Latenz anderer Anfragen versprechen.
- Die Bereinigung läuft in der Writer-API, einmal pro Datenbank. Der Writer prüft alle 5 Sekunden ein fälliges Repository. Ohne einen laufenden Writer wird nichts bereinigt.
- Aktivieren Sie die Bereinigung erst, nachdem Sie jeden Arkvory-Prozess aktualisiert haben, einschließlich Gateways und Worker. Ein alter Prozess ohne das Bereinigungsprotokoll lässt die Bereinigung ihre Arbeit aufschieben.

## Ein Artefakt löschen {#delete-artifacts}

Sie können ein veröffentlichtes Artefakt von Hand löschen. Sie brauchen `artifact.delete` am Repository.

1. Öffnen Sie das Artefakt in [[ui:metadata]] und suchen Sie [[ui:deletionTitle]].
2. Wählen Sie [[ui:deletionInspect]]. Die Konsole zeigt, was das Artefakt noch verwendet. Wenn etwas die Löschung blockiert, müssen Sie diese Abhängigkeit zuerst entfernen.
3. Fügen Sie die ID des Artefakts zur Bestätigung ein und wählen Sie dann [[ui:deletionSubmit]].

Das Löschen auf diese Weise prüft keine geschützten Labels, weil Sie das Objekt selbst auswählen. Abhängigkeiten werden immer geprüft. Nach der Löschung:

- Das Artefakt verlässt die Listen und Suchen. Ein neuer Download schlägt mit 404 fehl. Ein bereits laufender Download kann beendet werden.
- Die Paketversion bleibt reserviert.
- Die Bytes bleiben auf dem Datenträger, bis die [physische Bereinigung](#physical-cleanup) sie nach der Karenzzeit entfernt.
- Sie können es in der Konsole oder der API nicht rückgängig machen.

Für viele Artefakte bietet die API [previewRetention](../api/reference/storage#previewRetention) und [applyRetention](../api/reference/storage#applyRetention). Eine Vorschau listet Kandidaten auf, die vor einem Datum veröffentlicht wurden, mit ihren blockierenden Gründen. Apply löscht nur die IDs, die Sie übergeben, bis zu 100 pro Aufruf, und gibt ein Ergebnis für jede ID zurück: `deleted`, `already_deleted`, `protected`, `changed`, `not_eligible` oder `not_found`. Prüfen Sie jedes Ergebnis, nicht nur den HTTP-Status.

## Speicherdiagnosen und Ereignisse {#diagnostics}

Der Abschnitt [[ui:storageEvents]] listet auf, was im Repository passiert ist, älteste zuerst, 100 pro Seite. Wählen Sie [[ui:storageMore]] für die nächste Seite. Zum Lesen ist `diagnostics.read` nötig. Der API-Vorgang ist [getStorageEvents](../api/reference/storage#getStorageEvents), mit einem Filter nach Ebene (`info`, `warning`, `error`).

| Ereignis                                                                                              | Ebene                    | Bedeutung                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage.policy_updated`                                                                              | info                     | Die Aufbewahrungsrichtlinie wurde gespeichert                                                                                                   |
| `retention.completed`                                                                                 | info                     | Ein Stapel hat Builds gelöscht. Das Ereignis enthält die Anzahl                                                                                 |
| `retention.failed`                                                                                    | error                    | Die automatische Löschung wurde gestoppt, zum Beispiel weil der autorisierende Schlüssel widerrufen wurde                                       |
| `cleanup.configured`                                                                                  | info                     | Die Bereinigungseinstellungen wurden gespeichert                                                                                                |
| `cleanup.completed`                                                                                   | info oder error          | Ein Bereinigungsstapel hat Dateien verarbeitet, übersprungen oder ist fehlgeschlagen. Er listet die Anzahlen und die freigegebenen Bytes        |
| `capacity.normal`, `capacity.warning`, `capacity.critical`, `capacity.exceeded`, `capacity.unlimited` | info, warning oder error | Der Kontingentzustand hat sich geändert                                                                                                         |
| HTTP-Fehlercodes                                                                                      | warning oder error       | Eine Anfrage eines verwalteten Schlüssels an dieses Repository ist fehlgeschlagen. Das Ereignis behält die Anfrage-ID, die Route und den Status |

Der Verlauf ist begrenzt: 1000 Ereignisse pro Repository und 20 000 insgesamt, die ältesten werden verworfen. Es sind Best-Effort-Diagnosen, kein Log mit garantierter Zustellung. Exportieren Sie rechtzeitig, was Sie brauchen, und verwenden Sie das Server-Log für langfristige Nachweise. Siehe [Monitoring](./monitoring).

Das Panel zeigt außerdem die Nutzung: veröffentlichte Bytes, unfertige Uploads, die Bytes, die auf die Bereinigung warten, und die Summe gegen das Kontingent. Der API-Vorgang ist [getStorageUsage](../api/reference/storage#getStorageUsage).

## Wenn der Datenträger voll ist {#disk-full}

Anzeichen: Uploads schlagen mit HTTP 507 und dem Grund `storage_full` fehl, `GET /health/ready` zeigt `writable: false`, oder das Betriebssystem meldet keinen freien Speicherplatz. Downloads funktionieren weiter. Clients können ihre Uploads fortsetzen, nachdem Sie Speicherplatz freigegeben haben.

1. **Finden Sie die Ursache.** Prüfen Sie den freien Speicherplatz des Speicher-Volumes, des Datenbank-Volumes und des Backup-Speicher-Volumes. Vergleichen Sie die Nutzungszahlen im Speicherpanel. Große Zahlen bei „warten auf Bereinigung“ bedeuten, dass gelöschte Daten noch auf dem Datenträger liegen. Eine große Zahl bei „unfertige Uploads“ bedeutet verwaiste Uploads.
2. **Führen Sie die Bereinigung aus.** Wenn die Bereinigung aus ist, schalten Sie sie in jedem Repository ein, mit einer kurzen Karenzzeit wie 0, wenn Sie akzeptieren, dass gelöschte Dateien sofort verschwinden. Wählen Sie [[ui:cleanupRun]]. Sie entfernt auch die temporären Teile abgeschlossener Uploads und die abgelaufenen Uploads. Warten Sie auf die Stapel und lesen Sie das letzte Ergebnis. Die Bereinigung überspringt Dateien, die in Verwendung sind, wiederholen Sie sie also.
3. **Löschen Sie, was Sie nicht brauchen.** Wenden Sie eine Aufbewahrungsrichtlinie an oder löschen Sie Artefakte. Das gibt Speicherplatz erst frei, nachdem die Bereinigung die Bytes entfernt hat.
4. **Fügen Sie Speicherplatz hinzu.** Erweitern Sie das Volume oder den Datenträger. Verschieben Sie den Backup-Speicher oder andere Daten vom Volume, wenn sie es gemeinsam nutzen.
5. **Prüfen Sie die Erholung.** Nachdem Speicherplatz frei ist, kehrt `writable` zu `true` zurück, und Uploads funktionieren wieder.

Löschen Sie keine Dateien in `blobs/`, `staging/` oder `parts/` von Hand: Das bricht die Verbindung zwischen Datenbank und Datenträger. Wenn die Reserve für Ihre Logs und die Datenbank auf demselben Volume zu klein ist, erhöhen Sie `ARKVORY_STORAGE_RESERVE_BYTES`.

Wenn ein Upload stattdessen mit dem Grund `storage_quota` oder `catalog_limit` fehlschlägt, ist der Datenträger nicht das Problem. Erhöhen Sie das Kontingent oder die globale Grenze, oder löschen Sie Daten.

## Grenzen {#limits}

- Die Aufbewahrungsrichtlinie behandelt nur registrierte UPack-Builds. Sie entfernt nie andere Dateien.
- Die Aufbewahrungsreihenfolge ist die Veröffentlichungszeit, nicht die Versionsnummer.
- Speicher, Kontingente und Bereinigung benötigen ausdrückliche Dienstschlüssel-Aktionen. Passwortkonten und der Wiederherstellungsschlüssel haben sie nicht.
- Die physische Bereinigung ist standardmäßig aus und wird für jedes Repository festgelegt.
- Ein gelöschtes Artefakt kann nicht wiederhergestellt werden. Stellen Sie Daten aus einem Backup wieder her. Siehe [Backups](./backups).
- Gespiegelte Repositorys führen keine Speicherrichtlinie aus. Siehe [Spiegel](./mirrors).
- Der Speicher muss ein lokales Dateisystem sein. Es gibt keine Unterstützung für Netzwerkfreigaben oder mehrere Speicher-Backends.

## Verwandte Seiten {#related-pages}

- [Backups](./backups)
- [Spiegel](./mirrors)
- [Monitoring](./monitoring)
- [Fehlerbehebung](./troubleshooting)
- [Umgebungsvariablen](../reference/environment)
- [Repositorys](../use/repositories)
