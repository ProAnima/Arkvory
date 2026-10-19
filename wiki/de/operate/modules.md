---
title: Module
description: Signierte Modulpakete auf einem Host installieren, einschalten, prüfen und entfernen und die Schlüssel von Plugin-Autoren verwalten, denen Sie vertrauen.
---

# Module

Ein Modulpaket fügt Arkvory eine Funktion hinzu. Arkvory installiert nur Pakete, deren Signatur es prüfen kann. Die Befehle dieser Seite laufen auf dem Host der Installation, unter Linux als root, unter Windows als Administrator. Konsole und HTTP-API können weder Module installieren noch Schlüsseln vertrauen. Ein gestohlenes Administratorkonto der Konsole kann daher keinen Code auf dem Server ausführen.

Die Dienste prüfen die installierten Module bei jedem Start erneut und laden sie. Ein Modul läuft erst, nachdem Sie es eingeschaltet haben.

## Ein Paket installieren {#install}

1. Kopieren Sie die Paketdatei `arkvory-module-<id>-<version>.tgz` auf den Host.
2. Prüfen Sie sie und lesen Sie die Bedingungen:

   ```bash
   sudo arkvory module install /root/arkvory-module-sample-1.0.0.tgz --root /opt/proanima-arkvory
   ```

   Der Befehl zeigt das Modul, seine Rollen, die Daten, die es speichert, den Signaturschlüssel und den SHA-256 des Pakets und danach die Bedingungen des Moduls. Noch ändert sich nichts.

3. Installieren Sie es:

   ```bash
   sudo arkvory module install /root/arkvory-module-sample-1.0.0.tgz --root /opt/proanima-arkvory --yes
   ```

Arkvory lehnt ein Paket ab, wenn:

| Grund                                                                                                                                | Code in der Meldung                                            |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Die Signatur stammt nicht von einem Modulschlüssel von ProAnimaStudio, oder das Manifest wurde geändert                              | `unknown_key`, `wrong_key_class`, `signature_invalid`          |
| Eine Datei fehlt, wurde geändert oder steht nicht im Manifest                                                                        | `file_missing`, `file_mismatch`, `file_unlisted`               |
| Das Archiv enthält Links, Geräte, Pfade außerhalb des Pakets oder Namen, die sich nur in der Groß- und Kleinschreibung unterscheiden | `link_entry`, `special_entry`, `unsafe_path`, `case_collision` |
| Das Archiv enthält ein natives Add-on (`.node`)                                                                                      | `native_addon`                                                 |
| Das Modul braucht eine andere Version von Arkvory                                                                                    | `module_incompatible`                                          |
| ProAnimaStudio hat diese Version widerrufen                                                                                          | `module_revoked`, mit der Ersatzversion                        |
| Keine aktuelle Widerrufsliste (siehe unten)                                                                                          | `stale_revocations`                                            |

Grenzen: 1 GiB pro Paket, 256 MiB pro Datei, 4096 Dateien. Ein größeres Paket wird abgelehnt, bevor seine Daten gelesen werden.

Eine Version, die mit denselben Bytes bereits installiert ist, bleibt unverändert. Dieselbe Version mit anderen Bytes wird abgelehnt.

## Ein Modul einschalten und laden {#load}

Ein installiertes Modul bleibt abgeschaltet, bis Sie es einschalten. Die Dienste laden Module nur beim Start.

1. Tragen Sie das Modul in die Moduldatei ein (`ARKVORY_MODULES_FILE`, siehe [Umgebungsvariablen](../reference/environment#core)). Die Einstellungen des Moduls stehen in `config`:

   ```json
   { "format": 1, "modules": { "sample": { "enabled": true } } }
   ```

2. Wenn das Modul Dateien speichert, genehmigen Sie die Größe seines Datenverzeichnisses mit `resources`, zum Beispiel `"resources": { "dataMiB": 512, "dataFiles": 10000 }` neben `enabled`. Sie ersetzt die Größe, die das Paket anfordert. Siehe [Datenverzeichnis eines Moduls](#data).
3. Starten Sie die Dienste neu, wie unter [Eine Änderung anwenden](../install/configuration#apply-change).
4. Prüfen Sie das Modul als globaler Administrator: `GET /api/v1/system/modules` zeigt es auf der API und auf jedem Lese-Gateway mit `running: true` und `health.status` `ok`.

Signierte Module laufen entsprechend ihren deklarierten Rollen in API, Lesegateway, Worker und Backup-Agent. Jeder Prozess stellt nur die für seine Rolle verfügbaren und in `uses` angegebenen Dienste bereit. Routen erfordern `routes`. Docker Compose lädt noch keine Module.

Modulspeicher werden als `<module>.<name>` registriert und können für neue Uploads ausgewählt werden. Nimmt ein Speicher keine neuen Schreibvorgänge mehr an, fallen neue Uploads auf `default` zurück. Der Kern prüft alle Bytes vor der Veröffentlichung zusammengesetzter Objekte. Die Bereinigung wartet auf aktive Leser, sämtliche Backup-Pins und die Kopierbarriere. Berechnungen laufen in begrenzten Threads. Abonnements bestätigen Ereignisse erst nach erfolgreicher Verarbeitung; nach Fehlern ist eine erneute Zustellung möglich.

Bevor ein Dienst irgendeinen Code eines Moduls importiert, prüft er das Paket erneut:

1. Nur root (unter Windows: SYSTEM und Administrators) oder der Eigentümer des Installationsverzeichnisses darf das Installationsverzeichnis, `modules/`, den Modulsatz, die Widerrufsliste und ihr Verzeichnis ändern. Die Installation richtet das so ein. Eine Datei, die ein anderes Konto ändern darf, und ein Link in einem Paket werden abgelehnt (`access_unsafe`, `access_link`).
2. Die Signatur, jede Datei und die Version von Arkvory, so wie `module install` sie prüft.
3. Die Widerrufsliste. Eine widerrufene Version wird nie geladen. Eine abgelaufene oder fehlende Liste hält kein Modul an.

Ein Modul, das eine Prüfung nicht besteht, wird nicht geladen; die anderen Module und Arkvory laufen weiter. `GET /api/v1/system/modules` zeigt es mit `running: false`:

| `health.status` | Bedeutung                                                                    | Codes                                                                                                                |
| --------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `failed`        | Das Paket wurde abgelehnt, oder sein Code ließ sich nicht laden oder starten | `file_mismatch`, `unknown_key`, `module_incompatible`, `access_unsafe`, `config_invalid`, `start_failed` und weitere |
| `revoked`       | ProAnimaStudio hat diese Version widerrufen                                  | der Grund aus der Widerrufsliste                                                                                     |
| `unavailable`   | Das Paketverzeichnis fehlt auf dem Host                                      | `module_unavailable`                                                                                                 |

Ein ausgefallenes Modul nimmt Arkvory nur dann die Bereitschaft (`/health/ready` antwortet 503 mit `module_failed`), wenn ein anderes eingeschaltetes Modul es braucht. Ein Modul, das die Bytes veröffentlichter Dateien speichert (Daten `layout`), tut das nie: Arkvory liefert seine Daten weiter aus und schreibt neue Uploads in den eigenen Speicher statt in den des Moduls. Das Protokoll verzeichnet `module.refused` und `module.failed` mit dem Code in `errorCode`.

Um ein geändertes oder fehlendes Paket zu reparieren, installieren Sie es erneut. Alle Dienste der Installation müssen dieselben Module sehen, eingeschaltet oder nicht: Ein Lese-Gateway oder Worker mit anderen Modulen ist nicht bereit (`module_plan_mismatch`). Installieren Sie dieselben Pakete auf dem Host jedes Lese-Gateways.

### Datenverzeichnis eines Moduls {#data}

Ein Modul, das eigene Indizes, Caches oder einen eigenen Zustand speichert, erhält ein Verzeichnis auf dem Daten-Volume: `module-data/<id>/` im Speicherverzeichnis von `default`. Sein Teil `data` ist für Backups gedacht, sein Teil `cache` nicht. Arkvory rechnet jeden Schreibvorgang auf die genehmigte Größe an, in MiB und in Dateien, für beide Teile zusammen. Ein Schreibvorgang darüber hinaus wird abgelehnt (`module_quota_exceeded`), und das Modul läuft weiter. Ohne genehmigte Größe kann das Modul nur lesen. Die [Reserve des Volumes](./storage#disk) gilt ebenfalls. Auf einem Lese-Gateway liest das Modul dieselben Dateien und kann sie nicht ändern.

Wenn Sie ein Modul entfernen, bleibt sein Verzeichnis erhalten. Löschen Sie `module-data/<id>/` selbst, wenn Sie die Daten nicht mehr brauchen. Backups enthalten Modulverzeichnisse noch nicht.

## Routen von Modulen {#routes}

Ein Modul kann HTTP-Routen unter seinem eigenen Präfix `/api/ext/<id>/v<major>/` hinzufügen, zum Beispiel `/api/ext/sample/v1/`. Arkvory prüft jede Anfrage, bevor Code des Moduls läuft:

| Prüfung      | Wie bei `/api/v1`                                                                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anmeldedaten | Dieselben Schlüssel, Sitzungen und Tokens; eine Route steht jedem angemeldeten Aufrufer offen oder nur dem globalen Administrator                                                             |
| Berechtigung | Die Berechtigung, die die Route für das Repository in ihrem Pfad nennt, etwa `content.read` oder `upload.create`: ein Dienstschlüssel braucht sie, ein Konto seine Lese- oder Schreibfreigabe |
| Anfragetext  | Das Größenlimit der Route, die Upload-Limits, Fristen und die Bandbreite des Servers                                                                                                          |
| Dateien      | Von Arkvory selbst gesendet: ETag, Range, `If-Range`, 304, die Download-Warteschlange und die Download-Bandbreite                                                                             |

Fehler haben das Fehlerformat der API. Ein Modul sieht nie die Anmeldedaten oder andere Header. Ein Lese-Gateway bedient die lesenden Routen eines Moduls und antwortet auf die übrigen mit `read_only`.

Jedes Modul beschreibt seine Routen in einem OpenAPI-Dokument, und Arkvory gleicht beides beim Start des Moduls ab. Ein Modul, dessen Routen gegen die Regeln verstoßen, startet nicht und bedient nichts; Arkvory läuft weiter. `GET /api/v1/system/modules` zeigt es mit `running: false` und `health.status` `failed`:

| Code                     | Bedeutung                                                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `routes_invalid`         | Eine Route verstößt gegen die Regeln, etwa ein Pfad außerhalb des Modulpräfixes oder eine Änderung, die jedem angemeldeten Aufrufer offensteht |
| `openapi_invalid`        | Das OpenAPI-Dokument fehlt oder ist ungültig                                                                                                   |
| `openapi_route_mismatch` | Eine Route hat keine Operation im Dokument, oder eine Operation hat keine Route                                                                |
| `transfer_invalid`       | Das Modul bietet ein Übertragungsprotokoll an, das es nicht anbieten darf                                                                      |

Die Dokumente der Routen:

| Adresse                                                                                     | Wer sie lesen darf         | Inhalt                                                                                                   |
| ------------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /api/ext/openapi.json`                                                                 | Jeder angemeldete Aufrufer | Die Routen aller Module, die dieser Dienst ausführt, mit den Operationen, die der Aufrufer aufrufen darf |
| [`GET /api/v1/system/modules/{id}/openapi`](../api/reference/system#getSystemModuleOpenApi) | Der globale Administrator  | Die Routen eines Moduls                                                                                  |

`/api/v1/openapi.json` listet nie Routen von Modulen. Ein Modul der Art `transfer` kann einen anderen Weg zur Dateiübertragung anbieten: `GET /api/v1/capabilities` listet ihn unter `transfer`. Ein Client nutzt ihn nur mit einer passenden Erweiterung; sonst überträgt er Dateien wie gewohnt.

## Aktualisieren, festhalten, zurückstufen {#versions}

Installieren Sie die Datei der neuen Version mit `--yes`. Das vorherige Paket bleibt bis zur nächsten Moduländerung auf dem Host.

| Aufgabe                          | Befehl                                                          |
| -------------------------------- | --------------------------------------------------------------- |
| Installierte Version festhalten  | `sudo arkvory module pin sample 1.0.0 --root …`                 |
| Andere Versionen wieder zulassen | `sudo arkvory module pin sample --unpin --root …`               |
| Eine ältere Version installieren | `sudo arkvory module install <file> --downgrade --yes --root …` |

Ein festgehaltenes Modul lehnt jede andere Version ab, bis Sie es freigeben. Eine Version, die älter ist als die installierte oder als eine entfernte, deren Paket noch auf dem Host liegt, braucht `--downgrade`.

## Installierte Module prüfen {#list}

```bash
sudo arkvory module list --root /opt/proanima-arkvory
```

Der Befehl prüft jedes installierte Paket erneut, so wie die Dienste es vor dem Laden tun: die Signatur, jede Datei und das Archiv. Jedes Modul zeigt einen Zustand:

| Zustand              | Bedeutung                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `ok`                 | Das Paket ist unversehrt                                                                                                         |
| `refused: <code>`    | Eine Datei wurde geändert, hinzugefügt oder durch einen Link ersetzt (`file_mismatch`, `file_unlisted`, `link_entry` und andere) |
| `revoked (<reason>)` | ProAnimaStudio hat diese Version widerrufen. `read path only` bedeutet, dass ihre Daten lesbar bleiben                           |

Ein abgelehntes Paket wird nie verwendet. Installieren Sie die Paketdatei erneut, um es zu reparieren.

## Ein Modul entfernen {#remove}

```bash
sudo arkvory module remove sample --root /opt/proanima-arkvory
```

Das Modul verlässt die Installation, und sein Paket bleibt bis zur nächsten Moduländerung auf dem Host. Ein Modul, das die Bytes veröffentlichter Dateien speichert (Daten `layout`), lässt sich nicht entfernen: Arkvory lehnt mit `module_owns_data` ab, damit seine Daten nie unlesbar werden.

## Widerrufsliste {#revocations}

ProAnimaStudio veröffentlicht eine signierte Liste widerrufener Modulversionen. Jede Liste hat eine Nummer, und Arkvory nimmt nie eine Liste an, deren Nummer kleiner ist als die der vorhandenen. Ein Modulpaket kann eine neuere Liste mitbringen: Arkvory behält sie, wenn Sie das Paket installieren. Auf einem Host ohne Zugang zum Hub speichern Sie eine Listendatei selbst:

```bash
sudo arkvory module revocations /root/module-revocations.json --root /opt/proanima-arkvory
```

Jede Liste ist mit einem Ablaufdatum signiert: standardmäßig 90 Tage, nie mehr als 180. `module install` und `module pin <id> <version>` brauchen eine aktuelle Liste; mit einer abgelaufenen oder ohne Liste lehnen sie mit `stale_revocations` ab. Ein Paket mit einer aktuellen Liste zählt. Um trotzdem fortzufahren, fügen Sie `--allow-stale-revocations` hinzu: Arkvory gibt eine Warnung aus und hält die Entscheidung in `modules/audit.jsonl` fest. Eine abgelaufene Liste hält installierte Module nie an: Sie laufen weiter, und ihre Daten bleiben lesbar; nur ein Widerrufseintrag stoppt eine Version. Eine Liste mit höherer Nummer ersetzt die gespeicherte immer, auch wenn sie abgelaufen ist.

Wenn ProAnimaStudio seinen Modul-Signaturschlüssel ersetzt, enthält ein Release beide Schlüssel, und die nächste Liste wird mit dem neuen Schlüssel signiert; erst ein späteres Release entfernt den alten Schlüssel. Ein Update auf dieses Release wird abgelehnt, solange der Host noch eine mit dem alten Schlüssel signierte Liste speichert: Speichern Sie zuerst eine aktuelle Liste. `sudo arkvory module check-revocations --root …` zeigt, ob dieses Release dem Schlüssel der gespeicherten Liste vertraut.

## Einem Plugin-Autor vertrauen {#trust}

Plugins Ihres Teams oder eines anderen Autors sind mit dem Schlüssel des Autors signiert. Fügen Sie den Schlüssel der Vertrauensliste des Hosts hinzu, bevor Sie solche Plugins installieren. Die Vertrauensliste gehört dem Host: Die Dienste können sie lesen, aber nicht ändern.

1. Holen Sie sich vom Autor die öffentliche Schlüsseldatei (`.pub`, minisign-Format) und ihren Fingerabdruck über einen anderen Kanal.
2. Zeigen Sie den Schlüssel an und vergleichen Sie den Fingerabdruck:

   ```bash
   sudo arkvory module trust add /root/acme.pub --label "Acme platform team" --plugins "op-acme-*" --root /opt/proanima-arkvory
   ```

3. Fügen Sie ihn mit `--yes` hinzu.

| Option               | Bedeutung                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `--label`            | Wem der Schlüssel gehört; Pflicht                                                                                            |
| `--plugins`          | Plugin-IDs, die der Schlüssel signieren darf, durch Kommas getrennt: eine genaue ID oder ein Präfix mit `*`. Standard `op-*` |
| `--expires`          | UTC-Zeit wie `2027-01-31T00:00:00Z`. Danach nimmt der Schlüssel keine neue Installation mehr an                              |
| `--allow-in-process` | Erlaubt den Plugins des Schlüssels, im Prozess von Arkvory zu laufen. Solcher Code erhält alle Rechte des Dienstes           |

Plugin-IDs beginnen immer mit `op-`. Ein Plugin-Schlüssel signiert nie Module von ProAnimaStudio, und Schlüssel von ProAnimaStudio signieren nie `op-`-Plugins. Ein Schlüssel, den der Host schon unter einer anderen ID oder als Schlüssel einer anderen Art kennt, wird abgelehnt (`duplicate_key`). Signaturen müssen vorab gehasht sein, die Vorgabe aktueller minisign-Versionen; alte Signaturen werden mit `signature_algorithm` abgelehnt.

`sudo arkvory module trust list --root …` zeigt die vertrauenswürdigen Schlüssel. `sudo arkvory module trust remove <key id> --root …` entfernt einen.

Diese Version führt die Vertrauensliste; Plugins installiert eine spätere Version.

## Nach einer Unterbrechung {#recover}

Jede Änderung der Modulmenge wird im Aktualisierungsjournal festgehalten. Bricht ein Befehl auf halbem Weg ab, lehnt der nächste Bereitstellungsbefehl mit `Interrupted deployment` ab. Führen Sie `sudo arkvory recover --root …` aus: Es stellt die vorherige Modulmenge wieder her. Bis dahin lehnt jeder Modulbefehl ab, der etwas ändert, auch `module trust` und `module revocations`.

## Lebensdauer der Modulanfrage {#request-scope}

Die Route verwendet die Rechte des Aufrufers bis zum Ende der Antwort, auch beim Streaming. Abbruch oder Abschluss widerruft die Rechte und schließt Leseressourcen. `upload-read` liest bestätigte Teile unvollständiger Uploads und prüft Eigentümer, `upload.read`, Bereich und Abbruch. Module können Transferangebote im Betrieb zurückziehen. Spätere Fähigkeitsabfragen lassen sie weg; Routen und aktive Transfers bleiben erhalten. Clients können alte Angebote zwischenspeichern, deshalb muss die Route jede Operation prüfen.
