---
title: Spiegel und ein zweiter Standort
description: 'Halten Sie eine schreibgeschützte Kopie von Repositorys auf einer zweiten Installation, beobachten Sie ihre Synchronisierung und schalten Sie auf sie um, wenn die Quelle verloren geht.'
---

# Spiegel und ein zweiter Standort

Ein **Spiegel** ist ein Repository auf einer Arkvory-Installation, das eine schreibgeschützte Kopie eines Repositorys auf einer anderen Installation ist, der **Quelle**. Die Spiegel-Installation zieht Änderungen über HTTPS von der Quelle. Sie behält ihre eigene Datenbank, ihren eigenen Speicher, ihre eigenen Konten und ihre eigenen Schlüssel.

Verwenden Sie einen Spiegel, um Downloads von einem zweiten Standort auszuliefern und einen zweiten Standort zu halten, der übernehmen kann, wenn die Quelle verloren geht. Ein Spiegel ist kein Backup der Quelle und keine automatische Hochverfügbarkeit. Das Umschalten erledigen Sie selbst. Zu anderen Schutzmaßnahmen siehe [Backups](./backups) und [Lese-Gateways](./read-gateways).

## Was ein Spiegel ist {#what-a-mirror-is}

Für ein gespiegeltes Repository kopiert die Spiegel-Installation:

- Die veröffentlichten Dateien, mit ihren Bytes und den **gleichen Artefakt-IDs** wie auf der Quelle.
- Labels, Metadaten und Sammlungen.
- Die UPack-Registrierung, die Stufen und die aktuellen Dateipfade.
- Container-Images, Git-LFS-Objekte und npm-Pakete des Repositorys.
- Löschungen. Eine auf der Quelle gelöschte Datei wird auf dem Spiegel gelöscht.

Downloads nach ID, nach Paket (Version, Bereich, Stufe) und nach Dateipfad antworten auf dem Spiegel so wie auf der Quelle bei der letzten Synchronisierung. Sie funktionieren weiter, wenn die Quelle ausgefallen ist.

Ein Spiegel kopiert nicht:

- Konten, Gruppen, Schlüssel und Berechtigungen. Der Spiegel hat eigene, und sie sind unabhängig: Das Widerrufen eines Schlüssels auf der Quelle betrifft den Spiegel nicht.
- Referenzen, die Dateien vor der Bereinigung schützen, Anhänge von Builds, Audit-Trails und Speicherrichtlinien.
- Den Verlauf der Dateipfade von vor der ersten Synchronisierung. Revisionsnummern von Labels und Pfaden auf dem Spiegel sind seine eigenen.

Clients können nicht in ein gespiegeltes Repository schreiben. Uploads, Label-Änderungen, Dateipfade, Stufen, Löschung und Hochstufung hinein erhalten HTTP 409 mit dem Grund `mirror_read_only`. Andere Repositorys der Spiegel-Installation funktionieren wie gewohnt. Speicherrichtlinien laufen in einem gespiegelten Repository nicht, und nur die Synchronisierung löscht dort.

## Einen Spiegel einrichten {#set-up}

Sie brauchen einen Schlüssel auf der Quelle und einen Befehl auf dem Spiegel.

### Einen Schlüssel auf der Quelle erstellen {#source-key}

Der Spiegel braucht einen Schlüssel, der das Quellrepository nur lesen kann. Ein Schreibschlüssel ist nicht nötig.

1. Öffnen Sie auf der Quelle [[ui:services]] mit dem Wiederherstellungsschlüssel oder einem Operator-Schlüssel.
2. Wählen Sie [[ui:serviceCreate]] und fügen Sie in [[ui:servicePolicy]] das Repository hinzu. Wählen Sie [[ui:bindingRead]], um die Berechtigungen zu füllen, die ein Spiegel braucht. Dazu gehören `artifact.list`, `artifact.read`, `content.read`, `annotation.read`, `asset.read` und `package.read`.
3. Wählen Sie [[ui:keyIssue]], kopieren Sie das Geheimnis, bestätigen Sie [[ui:keySaved]] und wählen Sie [[ui:keyActivate]]. Ein nicht aktivierter Schlüssel läuft nach 15 Minuten ab.
4. Speichern Sie das Geheimnis in einer Datei auf dem Spiegel-Server. Die Datei enthält nur den Schlüssel, in einer Zeile, 16 bis 4000 druckbare Zeichen. Nur root oder die Gruppe der Administratoren darf sie lesen.

Die Quelle muss ein Release mit dem Change-Feed sein. Der Befehl im nächsten Schritt prüft dies.

### Das Repository auf dem Spiegel anhängen {#attach}

Verwenden Sie einen **neuen, leeren** Repository-Namen auf dem Spiegel. Die Synchronisierung macht das Repository gleich der Quelle, löscht aber nie, was die Quelle nie hatte.

```bash
sudo arkvory configure --root /opt/proanima-arkvory \
  --mirror releases \
  --mirror-upstream https://arkvory.example \
  --mirror-token-file /root/mirror-releases.key
```

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' configure --root $root `
  --mirror releases --mirror-upstream https://arkvory.example `
  --mirror-token-file C:\secure\mirror-releases.key
```

| Option                     | Bedeutung                                                                                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--mirror NAME`            | Das Repository auf dieser Installation. 1–64 Zeichen: Kleinbuchstaben, Ziffern, `_` und `-`, beginnend mit einem Buchstaben oder einer Ziffer                          |
| `--mirror-upstream URL`    | Der Ursprung der Quelle: `https://host`, ohne Pfad, ohne Anmeldedaten und ohne Query. Einfaches `http://` wird nur für `localhost`, `127.0.0.1` und `[::1]` akzeptiert |
| `--mirror-token-file FILE` | Ein absoluter Pfad zur Schlüsseldatei                                                                                                                                  |
| `--mirror-source NAME`     | Das Repository auf der Quelle. Standard: derselbe Name wie `--mirror`                                                                                                  |
| `--mirror-ca-file FILE`    | Eine PEM-Datei mit der Zertifizierungsstelle der Quelle. Siehe [HTTPS mit eigener Zertifizierungsstelle](#ca-file)                                                     |

Geben Sie einer Kommandozeile ein Repository. Sie können eine Spiegel-Änderung nicht mit Änderungen an HTTPS, dem Backup-Speicher oder Updates im selben Aufruf kombinieren.

1. Der Befehl prüft die Quelle mit dem Schlüssel, bevor er etwas ändert. Die Quelle muss den Change-Feed für Spiegel melden, und der Feed des Quellrepositorys muss antworten.
2. Er speichert den Schlüssel in `config/mirrors/NAME.token`, schreibt `config/mirrors/mirrors.json` und setzt `ARKVORY_MIRRORS_FILE` in `config/runtime.json`.
3. Er startet die API und den Worker neu und wartet, bis sie bereit sind. Wenn etwas fehlschlägt, stellt er die vorherigen Dateien wieder her und startet erneut.

In Docker Compose schreibt der Befehl außerdem `config/compose.mirrors.yml`, das die Spiegeldateien in die API- und Worker-Container einbindet. Fügen Sie es Compose-Befehlen hinzu, die Sie selbst ausführen.

Wiederholen Sie den Befehl mit einer neuen `--mirror-token-file`, um den Schlüssel eines Repositorys zu ersetzen. Der Worker liest die Schlüsseldatei nach jedem Fehler erneut, ein neuer Schlüssel funktioniert also ohne Neustart. Ein Repository, das bereits eine Quelle spiegelt, lehnt eine andere Quelle mit der Meldung `NAME mirrors another source; detach it first` ab.

Geben Sie auf der Spiegel-Installation Personen und Werkzeugen Zugriff auf das Repository. Ein Repository existiert, sobald eine Berechtigung oder eine Dienstrichtlinie es nennt. Verwenden Sie [[ui:manageGrants]] in [[ui:administration]] für Personen und eine Dienstrichtlinie für Werkzeuge. Die Berechtigungen der Quelle werden nicht übernommen.

### HTTPS mit eigener Zertifizierungsstelle {#ca-file}

Wenn die Quelle ein Zertifikat einer Unternehmens- oder selbstsignierten Zertifizierungsstelle verwendet, fügen Sie `--mirror-ca-file /path/ca.pem` zum `--mirror`-Befehl hinzu. Der Befehl prüft, dass jedes Zertifikat gelesen werden kann und nicht abgelaufen ist, und speichert 1 bis 64 Zertifikate in `config/mirrors/ca.pem` (die Datei darf 1 MiB nicht überschreiten). Der Worker vertraut ihnen dann zusätzlich zu den Standardzertifikaten.

- Die Datei dient jedem Spiegel der Installation. Eine neue `--mirror-ca-file` ergänzt sie, und ein bereits vorhandenes Zertifikat wird einmal behalten. Das Trennen des letzten Spiegels entfernt die Datei.
- Der Worker vertraut dem ganzen Satz für alle seine Verbindungen, nicht nur für einen Spiegel.
- Die Zertifikatsprüfung wird nie ausgeschaltet.

## Was und wie oft kopiert wird {#sync}

Der Worker der Spiegel-Installation führt die Synchronisierung aus. Es gibt keinen separaten Dienst. Für jedes gespiegelte Repository führt er diese Schritte aus:

1. **Erstbefüllung.** Der Worker merkt sich die aktuelle Position des Change-Feeds der Quelle. Dann liest er die Liste der Artefakte, Pakete und Dateipfade Seite für Seite und macht den Spiegel gleich dieser Liste.
2. **Mitlaufen.** Der Worker liest den Feed der Quelle. Wenn er aufgeholt hat, prüft er alle 10 Sekunden erneut. Er speichert seine Position nach jeder Änderung, die er angewendet hat.
3. **Dateien kopieren.** Eine Datei wird in Teilen kopiert. Der Worker prüft den SHA-256 jedes Teils und der ganzen Datei. Nach einer Unterbrechung setzt er mit dem ersten fehlenden Teil fort. Ein Teil wartet in `mirror-staging` im Speicherverzeichnis des Spiegels.
4. **Nach einem Fehler.** Der Worker wiederholt den Schritt nach einer Pause, die bei 2 Sekunden beginnt und sich bis auf 5 Minuten verdoppelt. Ein fehlschlagender Spiegel stoppt die anderen nicht.

Eine Installation kann bis zu 64 gespiegelte Repositorys haben. Die Kopien zählen gegen die Kapazitätsgrenze und den Datenträger des Spiegels, planen Sie also denselben Speicherplatz ein, den das Quellrepository braucht. Siehe [Speicher](./storage).

Wenn der Quellschlüssel widerrufen wird oder die Quelle nicht erreichbar ist, liefert der Spiegel weiter aus, was er bereits hat, und zeigt den Fehler in seinem Status.

## Den Synchronisierungsstatus prüfen {#status}

### In der Konsole {#status-console}

Verbinden Sie die Konsole der Spiegel-Installation mit dem gespiegelten Repository. Über dem Katalog zeigt ein Badge den Zustand:

- [[ui:mirrorBadge]] bedeutet, der Spiegel hat aufgeholt.
- [[ui:mirrorBehind]] bedeutet, er kopiert noch oder hat noch nicht begonnen.
- [[ui:mirrorFailing]] bedeutet, der letzte Versuch ist fehlgeschlagen. Downloads funktionieren weiter.

Öffnen Sie die Hilfe des Badges ([[ui:mirrorHelpLabel]]), um die Quelle, die Zeit der letzten Synchronisierung und den Fehlercode zu sehen. Die Konsole verbirgt die Upload- und Änderungsschaltflächen in einem gespiegelten Repository.

### Mit der API {#status-api}

[getRepositoryMirror](../api/reference/mirrors#getRepositoryMirror) gibt den Status eines Repositorys zurück. Es braucht das Recht, das Repository zu lesen. Für ein gewöhnliches Repository lautet die Antwort 404.

| Feld                             | Bedeutung                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `mode`                           | `mirror` oder `import`                                                                                                    |
| `phase`                          | `pending` (der Worker hat nicht begonnen), `seeding` (Erstbefüllung) oder `following`                                     |
| `caughtUp`                       | `true`, wenn die gespeicherte Position der neuesten Position der Quelle entspricht. `null`, bevor die Erstbefüllung endet |
| `checkedAt`, `syncedAt`          | Wann der Worker den Feed zuletzt gelesen hat und wann er zuletzt aufgeholt hat                                            |
| `copiedArtifacts`, `copiedBytes` | Bisher kopierte Summen (`copiedBytes` ist eine Dezimalzeichenkette)                                                       |
| `errorCode`, `errorAt`           | Der letzte Fehler eines Schritts oder `null`                                                                              |

### Fehlercodes {#error-codes}

| `errorCode`             | Bedeutung und was zu tun ist                                                                                                                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mirror_mismatch`       | Dieselbe Artefakt-ID hat auf der Quelle anderen Inhalt. Der Spiegel behält seine Datei. Untersuchen Sie das Artefakt; löschen Sie keine der beiden Kopien, bevor Sie die Ursache kennen                                                                     |
| `mirror_source_changed` | Das Repository enthält bereits eine Kopie einer anderen Quelle. Trennen Sie es, oder spiegeln Sie die neue Quelle in ein neues Repository                                                                                                                   |
| `mirror_source_behind`  | Die Quelle wurde wiederhergestellt oder neu installiert, und ihr Feed liegt hinter dem Spiegel. Der Spiegel liest ihn erneut, und der Code verschwindet, wenn er aufgeholt hat. Dateien, die der wiederhergestellten Quelle fehlen, bleiben auf dem Spiegel |
| `mirror_delete_blocked` | Die Quelle hat eine Datei gelöscht, die der Spiegel nicht löschen kann, weil hier noch etwas sie verwendet, etwa eine Referenz oder ein Dateipfadverlauf                                                                                                    |
| `mirror_failed`         | Ein Fehler ohne spezifischeren Code. Lesen Sie das Worker-Log                                                                                                                                                                                               |
| andere Codes            | Der Code der fehlgeschlagenen Anfrage, zum Beispiel `unauthorized`, wenn der Schlüssel widerrufen wurde, oder `capacity_exceeded`, wenn der Spiegel voll ist                                                                                                |

Das Worker-Log (`component` ist `mirror`) enthält `mirror.started`, `mirror.step_failed` mit `errorCode` und `attempts`, `mirror.recovered` und `mirror.stopped`.

## Spiegel überwachen {#monitoring}

Die API der Spiegel-Installation stellt drei Metriken für jedes gespiegelte Repository bereit, mit den Labels `repository` und `mode`:

- `arkvory_mirror_last_sync_timestamp_seconds`: wann der Spiegel zuletzt aufgeholt hat.
- `arkvory_mirror_last_check_timestamp_seconds`: wann er zuletzt den Feed gelesen hat.
- `arkvory_mirror_failing`: 1, solange der letzte Versuch fehlgeschlagen ist.

Die fertigen Prometheus-Regeln sind `ArkvoryMirrorStale` (länger als eine Stunde nicht aufgeholt) und `ArkvoryMirrorFailing` (der Fehler dauert 15 Minuten). Siehe [Monitoring](./monitoring). Ein Spiegel, den der Worker noch nicht erreicht hat, hat keine Synchronisierungszeit, die Stale-Regel schlägt also vor seiner ersten Synchronisierung nicht an.

## Import nach Stufe {#import}

Mit `--mirror-stages` ist das Repository auf der zweiten Installation **kein** Spiegel. Es ist ein gewöhnliches beschreibbares Repository, das die Versionen übernimmt, die eine der Stufen auf der Quelle tragen. Verwenden Sie es, um Builds von einem Entwicklungsserver auf einen Produktionsserver zu verschieben.

```bash
sudo arkvory configure --root /opt/proanima-arkvory \
  --mirror releases --mirror-upstream https://dev.example \
  --mirror-token-file /root/dev.key --mirror-stages release
```

- Sie listen 1 bis 16 verschiedene Stufennamen auf, durch Kommas getrennt.
- Eine Version wird einmal kopiert, mit derselben ID, denselben Bytes, Labels und derselben UPack-Registrierung sowie mit den passenden Stufen.
- Danach gehört sie dieser Installation. Änderungen, Stufenentfernung und Löschung auf der Quelle erreichen sie nicht. Eine Version, die Sie hier löschen, wird nie wieder importiert.
- Uploads und die Speicherrichtlinie des Repositorys funktionieren wie gewohnt.
- Container-Image-, Git-LFS- und npm-Registry-Daten werden nicht übernommen.
- Eine Änderung der Stufen startet eine neue Erstbefüllung. Sie fügt nur hinzu und überspringt, was bereits vorhanden ist.

Die Konsole zeigt das Badge [[ui:mirrorImport]] oder [[ui:mirrorImportFailing]], wenn der letzte Versuch fehlgeschlagen ist. Der Schlüssel auf der Quelle braucht dieselben schreibgeschützten Berechtigungen wie für einen Spiegel.

## Umschalten, wenn die Quelle verloren geht {#failover}

Dies ist ein manuelles Umschalten für zwei unabhängige Installationen an zwei Standorten. Es ist nicht automatisch. Änderungen, die der Spiegel noch nicht gezogen hat, gehen verloren.

### Im Voraus vorbereiten {#failover-prepare}

1. Installieren Sie den zweiten Standort nach Möglichkeit mit demselben Release wie die Quelle, mit eigenem PostgreSQL und eigenem Datenträger. Die beiden Standorte teilen nichts.
2. Erstellen Sie einen schreibgeschützten Schlüssel auf der Quelle und hängen Sie jedes Repository als Spiegel an. Ein später auf der Quelle erstelltes Repository erscheint nicht von selbst auf dem Spiegel, hängen Sie es also auf dieselbe Weise an.
3. Stellen Sie auf dem Spiegel die Schlüssel aus, die Ihre Konsumenten verwenden werden, einschließlich Schlüsseln, die nach dem Umschalten schreiben können. Die Berechtigungen der Quelle werden nicht übernommen, eine kompromittierte Quelle gewährt also keinen Zugriff auf den Spiegel.
4. Richten Sie die Konsumenten (CI, Deployment-Agents) mit der Adresse des Spiegels als Ausweichlösung für Downloads ein. Das entlastet auch die Verbindung zur Quelle.
5. Sichern Sie die Quelle in einen Backup-Speicher außerhalb ihres Standorts. Siehe [Backups](./backups). Ein Spiegel ersetzt dies nicht.
6. Überwachen Sie den Spiegel mit den obigen Regeln.

### Umschalten {#failover-switch}

1. Stellen Sie sicher, dass die Quelle für Clients wirklich nicht verfügbar ist und nicht von selbst zurückkehrt. Zwei Standorte, die beide Schreibzugriffe auf ein logisches Repository akzeptieren, können später nicht zusammengeführt werden. Wenn die Quelle teilweise erreichbar ist, stoppen Sie ihre Dienste oder schließen Sie ihren Port.
2. Lesen Sie auf dem Spiegel `syncedAt` jedes Repositorys. Änderungen auf der Quelle nach diesem Zeitpunkt sind nicht auf dem Spiegel.
3. Trennen Sie jedes gespiegelte Repository auf dem Spiegel. Es wird ein gewöhnliches beschreibbares Repository mit denselben Artefakt-IDs und allen seinen Daten.

   ```bash
   sudo arkvory configure --root /opt/proanima-arkvory --mirror-detach releases
   ```

   Der Befehl startet die API und den Worker neu, rechnen Sie also mit einer kurzen Unterbrechung.

4. Richten Sie die schreibenden Clients über DNS oder die Konfiguration Ihrer CI auf den Spiegel.
5. Laden Sie eine Kontrolldatei auf den Spiegel hoch und wieder herunter.

Was Clients sehen:

- Vor dem Umschalten funktionieren Downloads vom Spiegel, und Schreibzugriffe erhalten 409 `mirror_read_only`.
- Nach dem Trennen funktionieren Schreibzugriffe. Das Badge verschwindet.
- Die Schlüssel und Passwörter der Quelle funktionieren auf dem Spiegel nicht, es sei denn, Sie haben dort dieselben Konten erstellt.

Es gibt keinen Weg zurück. Hängen Sie ein getrenntes Repository nicht wieder als Spiegel an. Um die alte Quelle zurückzubringen, leeren Sie sie, oder installieren Sie sie neu und hängen Sie die Repositorys des neuen Primärsystems als Spiegel an. Betreiben Sie die alte Quelle und das neue Primärsystem niemals gleichzeitig mit aktivierten Schreibzugriffen.

### Üben {#failover-rehearse}

Üben Sie das Umschalten jedes Quartal und nach Updates. Trennen Sie ein Repository auf einer Ersatzkopie, prüfen Sie `syncedAt`, einen Download und einen Upload und notieren Sie Datum und Ergebnis. Testen Sie die Wiederherstellung eines Backups der Quelle in eine leere Installation getrennt. Siehe [Testen Sie eine Wiederherstellung regelmäßig](./backups#test-restore).

## Grenzen {#limits}

- Ein Spiegel ist schreibgeschützt, bis Sie ihn trennen. Ein getrenntes Repository kann nicht wieder zu einem Spiegel werden.
- Der Spiegel ist kein Backup. Er hat keine Kopie von Konten, Schlüsseln oder Berechtigungen und kopiert keine Referenzen, Anhänge, Audit-Trails oder Speicherrichtlinien.
- Der Importmodus kopiert keine Container-Images, Git-LFS- oder npm-Daten.
- Eine Synchronisierung fügt nur hinzu und aktualisiert. Nach einer Wiederherstellung der Quelle bleiben Dateien, die die Quelle verloren hat, auf dem Spiegel.
- Beide Installationen werden eigenständig aktualisiert. Die Quelle muss den Change-Feed für Spiegel anbieten.
- Der Satz vertrauenswürdiger Zertifizierungsstellen der Quelle gilt für den ganzen Worker.
- Es gibt kein automatisches Failover, kein Fencing der alten Quelle und keine Rücksynchronisierung.

## Verwandte Seiten {#related-pages}

- [Backups](./backups)
- [Lese-Gateways](./read-gateways)
- [Speicher](./storage)
- [Monitoring](./monitoring)
- [Umgebungsvariablen](../reference/environment#mirrors)
- [Konten und Zugriff](../use/accounts)
