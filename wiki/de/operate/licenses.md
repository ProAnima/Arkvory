---
title: Lizenzen
description: Aktivieren Sie die Lizenz eines kostenpflichtigen Moduls online oder offline, prüfen Sie ihren Zustand und sehen Sie, was Arkvory sendet und speichert.
---

# Lizenzen

Der kostenlose Kern von Arkvory braucht keine Lizenz. Jede Funktion dieser Dokumentation arbeitet ohne sie, und kein Lizenzzustand schaltet eine davon ab oder macht Daten unlesbar. Eine Lizenz schaltet ein kostenpflichtiges Modul von ProAnimaStudio frei (siehe [Module](modules)). Bis Sie eine Lizenz aktivieren, sendet Arkvory nirgendwohin etwas über Lizenzen.

Die Befehle dieser Seite laufen auf dem Host der Installation, unter Linux als root, unter Windows als Administrator. Docker-Compose-Installationen laden keine Module und lehnen diese Befehle deshalb ab.

## Online aktivieren {#activate}

1. Speichern Sie den Lizenzschlüssel von der ProAnimaStudio-Website in einer Datei, die nur Sie lesen können, zum Beispiel `/root/arkvory.key`.
2. Aktivieren Sie:

   ```bash
   sudo arkvory license activate --key-file /root/arkvory.key --root /opt/proanima-arkvory
   ```

3. Löschen Sie die lokale Schlüsseldatei nach der Aktivierung. Bewahren Sie den Zugriff auf den Schlüssel in Ihrem Konto: Zur Wiederherstellung kann er erneut nötig sein.

Arkvory sendet die Anfrage an den Hub der Installation (die Adresse in `config/hub.json`, dieselbe wie für Updates) über HTTPS mit Zertifikatsprüfung. Die Antwort wird nur angenommen, wenn der Lizenzschlüssel von ProAnimaStudio sie signiert hat, für diese Installation und für diese Anfrage. Ein Schlüssel mit Tippfehler wird abgelehnt, bevor etwas gesendet wird. Dieselbe Installation mit demselben Schlüssel erneut zu aktivieren belegt keinen neuen Platz der Lizenz.

### Was gesendet wird {#sent}

| Anfrage     | Inhalt                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aktivierung | Der Lizenzschlüssel, die Installations-ID, ein Zufallswert, die Arkvory-Version, ID und Version der installierten kostenpflichtigen Module, die Uhrzeit |
| Erneuerung  | Die Aktivierungs-ID und ihr Geheimnis, ein Zufallswert, die Folgenummer, die Versionen                                                                  |

Der Name des Lizenznehmers, Namen von Personen, Adressen, Angaben zur Maschine, Datenmengen, Repository-Namen, Inhalte, Metadata und Nutzungsstatistiken werden nie gesendet. Abgeschaltete Statistik fügt hier nichts hinzu und nimmt nichts weg. Ist der Hub abgeschaltet (`--hub-off`), nutzen Sie die [Offline-Aktivierung](#offline).

### Was gespeichert wird {#kept}

- Das Token: das signierte Dokument des Hubs, in der Datenbank und in Backups.
- Das Aktivierungsgeheimnis: eine Datei in `config/licenses/`, die nur das Konto der Dienste lesen kann. Es steht nie in der Datenbank, in Logs oder in einem Backup.
- Der Lizenzschlüssel: nirgends.

## Zustand prüfen {#status}

```bash
sudo arkvory license status --root /opt/proanima-arkvory
```

Für Skripte fügen Sie `--json` hinzu. Ein globaler Administrator sieht dasselbe in `GET /api/v1/system/license` ([Referenz](../api/reference/system#getSystemLicense)). Arkvory prüft jedes gespeicherte Dokument jedes Mal neu; ein Dokument, das ProAnimaStudio nicht signiert hat, ist `invalid` und schaltet nichts frei.

| Zustand         | Bedeutung                                                                                                     | Kostenpflichtige Schreibvorgänge |
| --------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `valid`         | Die Lizenz gilt; `refreshFailing`, wenn der Hub eine Weile nicht geantwortet hat                              | im Modus des Moduls              |
| `offline-grace` | Seit über einem Tag keine Erneuerung; das Token gilt bis `offlineGraceUntil`                                  | im Modus des Moduls              |
| `grace`         | Die Lizenzlaufzeit ist zu Ende; Kulanzzeit für die Verlängerung bis `graceUntil`                              | im Modus des Moduls              |
| `mismatch`      | Das Token gehört zu einer anderen Installation (eine Wiederherstellung anderswo); Kulanzzeit bis `graceUntil` | bis dahin im Modus des Moduls    |
| `expired`       | `trial_expired`, `licence_expired` oder `activation_stale` (das Token ist abgelaufen)                         | in der Form des Kerns            |
| `revoked`       | Ein signierter Widerruf; der Grund wird angezeigt                                                             | in der Form des Kerns            |
| `invalid`       | Ein gespeichertes Dokument besteht die Prüfung nicht                                                          | in der Form des Kerns            |

In jedem Zustand bleiben Ihre Daten lesbar, Backups und Wiederherstellungen funktionieren, und Veröffentlichen scheitert nie an einer Lizenz: Ohne Lizenz schreibt ein kostenpflichtiges Modul neue Daten in der Form des kostenlosen Kerns. Schreiben im Modus des Moduls setzt nach einer erfolgreichen Erneuerung von selbst wieder ein.

## Erneuerung und Offline-Fenster {#refresh}

Der Worker erneuert jede Aktivierung etwa einmal am Tag und beim Start. Jede Erneuerung bringt ein neues Token und ein neues Geheimnis; das vorige Geheimnis gilt nicht mehr.

Ist der Hub nicht erreichbar, versucht der Worker es nach 15 Minuten erneut und wartet dann jedes Mal länger, bis zu 6 Stunden. Die Lizenz bleibt `valid`; nach einem Tag ohne Erneuerung ist sie `offline-grace`; wenn das Token endet (das Offline-Fenster: standardmäßig 30 Tage, 7 bei einer Testversion), ist sie `expired` mit `activation_stale`. Eine Ablehnung durch den Hub, etwa `licence_expired` oder `activation_suspended`, wird nicht wiederholt: Klären Sie sie und führen Sie dann aus:

```bash
sudo arkvory license refresh --root /opt/proanima-arkvory
```

Die Uhr zurückzustellen verlängert nichts: Arkvory urteilt nach der spätesten Zeit, die es gesehen hat. Liegt die Datenbankuhr mehr als einen Tag dahinter, erscheint `clockRollback`.

Wenn eine Erneuerung den Hub erreicht haben könnte, aber die Antwort verloren ging, erlaubt Arkvory nur eine Wiederholung innerhalb des 10-Minuten-Fensters, auch nach einem Neustart. Bleibt der Ausgang unbekannt, ist die Wiederholung verbraucht, endet das Fenster oder ist das erhaltene Token ungültig, stoppt `activation_recovery_required` weitere Erneuerungen. Das bisherige Token gilt bis zu seinem Ablauf. Rufen Sie den Schlüssel ab und wiederholen Sie `license activate --key-file <file>`; `license refresh` behebt diesen Zustand nicht.

### Kopien und Wiederherstellungen {#copies}

Eine Kopie der Installation, etwa eine geklonte virtuelle Maschine, hat dasselbe Geheimnis. Erneuern beide Kopien, setzt der Hub die Aktivierung aus (`activation_secret_reused`). Aktivieren Sie die Installation, die Sie behalten, erneut mit dem Schlüssel.

Ein auf einer anderen Installation wiederhergestelltes Backup behält sein Token, das zur alten Installation gehört: Der Zustand ist `mismatch` mit Kulanzzeit. Aktivieren Sie die neue Installation mit dem Schlüssel und deaktivieren Sie dann die alte.

Eine Aktivierung, die während ihres Offline-Fensters und weiterer 30 Tage nicht erneuert wurde, verfällt, und ihr Platz wird frei. Die nächste Erneuerung holt den Platz zurück, solange einer frei ist; sonst wird sie mit `activation_lapsed` abgelehnt. Deaktivieren Sie eine andere Installation und erneuern Sie dann.

## Deaktivieren {#deactivate}

```bash
sudo arkvory license deactivate lic_0123456789ABCDEFGHJKMNPQRS --root /opt/proanima-arkvory
```

Nennen Sie die Lizenz oder eine Aktivierung. Der Hub gibt den Platz frei, und Arkvory löscht das Geheimnis.

## Offline-Aktivierung {#offline}

Für Hosts ohne Zugang zum Hub:

1. Schreiben Sie eine Anfragedatei:

   ```bash
   sudo arkvory license request --key-file /root/arkvory.key --out /root/request.json --root /opt/proanima-arkvory
   ```

   Die Datei enthält den SHA-256 des Schlüssels, nie den Schlüssel. Arkvory nutzt dafür kein Netz.

2. Laden Sie die Datei in Ihrem ProAnimaStudio-Konto hoch und laden Sie die Antwort herunter.
3. Installieren Sie die Antwort:

   ```bash
   sudo arkvory license install /root/answer.json --root /opt/proanima-arkvory
   ```

Die Antwort muss zu einer Anfrage dieser Installation gehören. Eine Offline-Aktivierung wird nicht erneuert: Sie gilt bis zu ihrem Ende, höchstens 365 Tage, und eine neue Anfrage verlängert sie. Ein Widerruf erreicht einen solchen Host nur mit einer Widerrufsliste für Lizenzen, die Sie genauso installieren.

## Fehler {#errors}

| Code                                                | Bedeutung                                                                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `licence_key_invalid`                               | Der Hub kennt den Schlüssel nicht                                                                                            |
| `activation_limit_reached`                          | Alle Plätze der Lizenz sind belegt; deaktivieren Sie eine andere Installation                                                |
| `answer_invalid`                                    | Die Antwort ist nicht von ProAnimaStudio signiert oder gilt einer anderen Installation oder Anfrage; nichts wird gespeichert |
| `installation_mismatch`, `nonce_unknown`            | Die Offline-Antwort gehört zu einer anderen Installation oder zu keiner wartenden Anfrage                                    |
| `seq_replayed`                                      | Ein älteres Dokument als das gespeicherte; abgelehnt                                                                         |
| `revocation_rollback`                               | Eine ältere Widerrufsliste als die gespeicherte                                                                              |
| `unreachable`, `timeout`, `tls_failed`, `hub_error` | Der Hub war nicht erreichbar; der Worker versucht es erneut                                                                  |
