---
title: Verzeichnisbäume
description: Veröffentlichen Sie ein Verzeichnis als ein Archiv, holen Sie es in einen Ordner, prüfen Sie einen Ordner dagegen und reparieren Sie nur die abweichenden Dateien.
---

# Verzeichnisbäume

Ein Deployment-Agent oder ein CI-Job braucht oft ein ganzes Verzeichnis: einen Spiel-Build, eine Sammlung von Werkzeugen, einen Konfigurationsbaum. `arkvoryctl tree` veröffentlicht ein Verzeichnis als ein einziges ZIP-Artefakt, holt es in einen Ordner, prüft einen Ordner dagegen und repariert nur die abweichenden Dateien. Das Artefakt ist eine gewöhnliche ZIP-Datei: Die Konsole, die API und jedes ZIP-Werkzeug lesen sie, und Backups bewahren sie wie jedes andere Artefakt auf.

Diese Befehle gehören zum kostenlosen Kern. Sie brauchen dieselben Berechtigungen wie Uploads und Downloads: siehe [Uploads und Downloads](./transfers).

## Ein Verzeichnis veröffentlichen {#push}

```bash
arkvoryctl tree push ./Build/Game --name game-1.4.zip --label release
```

| Option                 | Bedeutung                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `--name NAME.zip`      | Name des Artefakts. Standard: der Ordnername mit `.zip`. Der Name muss auf `.zip` enden.          |
| `--label TAG`          | Ein Label für das Artefakt                                                                        |
| `--file METADATA.json` | Labels und Metadaten, wie bei `upload`                                                            |
| `--compress`           | Komprimiert die Einträge (deflate). Ohne diese Option werden die Dateien unverändert gespeichert. |

Das Ergebnis zeigt die `id` des Artefakts, seine `size`, `sha256` und die Anzahl der Dateien in `entries`.

- **Derselbe Ordner ergibt dasselbe Archiv.** Die Dateien stehen in Pfadreihenfolge, jeder Eintrag trägt das Datum 1980-01-01, und nur eine Eigenschaft des Dateisystems bleibt erhalten: Eine Datei, die ihr Besitzer ausführen darf, erhält den Modus 755, jede andere Datei 644. Ein unveränderter Ordner ergibt beim erneuten Veröffentlichen dieselben Bytes und denselben SHA-256.
- **Unterbrechungen.** Das Archiv wird neben dem Ordner erstellt (`.<folder>.arkvory-tree.zip`) und in Teilen mit einem Checkpoint hochgeladen. Führen Sie nach Strg+C oder einem Netzwerkausfall denselben Befehl erneut aus: Er erstellt dasselbe Archiv und setzt den Upload fort. Nach dem Erfolg werden beide Dateien entfernt.
- **Was abgelehnt wird.** Symbolische Links, Junctions, Geräte und Pipes im Ordner (`tree_entry_unsupported`), Namen, die Windows nicht speichern kann (`unsafe_name`), und zwei Namen, die sich nur in der Groß- und Kleinschreibung unterscheiden (`case_collision`). Leere Ordner bleiben nicht erhalten.
- **Gespeichert oder komprimiert.** Ohne `--compress` bilden die Bytes jeder Datei einen zusammenhängenden Bereich des Archivs. Der Server kann dann eine einzelne Datei über einen Bytebereich ausliefern, und Reparaturen übertragen genau die Bytes der abweichenden Dateien. Mit `--compress` ist das Archiv kleiner, und eine reparierte Datei wird auf Ihrem Rechner entpackt.

## Ein Verzeichnis holen {#pull}

```bash
arkvoryctl tree pull 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game
```

- **Ein leerer oder fehlender Ordner** erhält das ganze Archiv. Es wird mit Checkpoints neben den Ordner heruntergeladen, sodass ein unterbrochenes Holen dort weitermacht, wo es aufgehört hat. Nach der Prüfung seines SHA-256 werden die Dateien in einen neuen Ordner neben dem Ziel entpackt, der dann den Platz des Ziels einnimmt.
- **Ein Ordner mit Dateien** wird zum Baum. Hat der Server das [Inhaltsverzeichnis](#table-of-contents), werden nur die abweichenden Dateien heruntergeladen, jede über ihren Bytebereich, und Dateien, die der Baum nicht enthält, werden entfernt. Ohne Inhaltsverzeichnis wird das ganze Archiv heruntergeladen, und der entpackte Ordner ersetzt den alten.

Der übergeordnete Ordner muss existieren. Eine Datei im Ziel wird in einem Schritt ersetzt: Sie wird in eine temporäre Datei daneben geschrieben, geprüft und umbenannt. Ein Programm, das die Datei liest, sieht entweder die alte oder die neue Version.

## Ein Verzeichnis prüfen {#verify}

```bash
arkvoryctl tree verify 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game
```

Das Ergebnis listet fehlende Dateien (`missing`), abweichende Dateien (`mismatched`: andere Größe oder anderer SHA-256) und zusätzliche Dateien, die der Baum nicht enthält (`extra`), mit ihrer Anzahl in `counts`. Jede Liste zeigt höchstens 1000 Pfade. `ok` ist `true`, wenn nichts fehlt oder abweicht; zusätzliche Dateien ändern daran nichts. Der Exit-Code ist 0, wenn `ok` true ist, sonst 5.

## Ein Verzeichnis reparieren {#repair}

```bash
arkvoryctl tree repair 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game
```

Die Reparatur schreibt jede fehlende und abweichende Datei neu und behält zusätzliche Dateien. Mit Inhaltsverzeichnis lädt sie nur die Einträge dieser Dateien herunter; `fetchedBytes` im Ergebnis gibt an, wie viele Bytes des Archivs sie gelesen hat. Ohne Inhaltsverzeichnis lädt sie zuerst das ganze Archiv herunter.

## Das Inhaltsverzeichnis {#table-of-contents}

Nachdem ein Archiv veröffentlicht wurde, liest der Worker des Servers es einmal und erfasst jede Datei: ihren Pfad, ihre Größe, ihren SHA-256 und die Lage ihrer Bytes im Archiv. Das geschieht für Artefakte, deren Name auf `.zip` oder `.upack` endet. Bis das erledigt ist oder wenn das Archiv nicht indiziert werden kann, arbeiten die Befehle stattdessen mit dem ganzen Archiv.

Ein Server, der das Inhaltsverzeichnis hat, bietet `zip-tree` in `tree` von `GET /api/v1/capabilities` an (siehe `arkvoryctl doctor`); mit einem älteren Server verwenden die Befehle das ganze Archiv. Das Inhaltsverzeichnis selbst liefert die Operation [getArtifactTree](../api/reference/artifacts#getArtifactTree): `status` ist `ready`, `pending` oder `unavailable` mit einem `reason`.

| `reason`             | Bedeutung                                                                             |
| -------------------- | ------------------------------------------------------------------------------------- |
| `not_archive`        | Der Name des Artefakts endet nicht auf `.zip` oder `.upack`                           |
| `invalid_archive`    | Die Datei ist kein lesbares ZIP-Archiv                                                |
| `unsafe_entry`       | Ein Pfad verlässt das Archiv, oder ein Eintrag ist ein Link oder eine Sonderdatei     |
| `encrypted_entry`    | Ein Eintrag ist verschlüsselt                                                         |
| `duplicate_entry`    | Zwei Einträge haben denselben Pfad, auch ohne Beachtung der Groß- und Kleinschreibung |
| `unsupported_method` | Ein Eintrag verwendet eine andere Komprimierungsmethode als stored oder deflate       |
| `crc_mismatch`       | Die Bytes eines Eintrags stimmen nicht mit seiner Prüfsumme im Archiv überein         |
| `too_many_entries`   | Mehr als 100.000 Einträge                                                             |
| `too_large`          | Mehr als 100 GiB unkomprimiert                                                        |

## Wie Dateien geprüft werden {#checks}

- **Jede Datei wird geprüft, bevor sie ihren Platz einnimmt.** Mit Inhaltsverzeichnis müssen ihre Größe und ihr SHA-256 mit den Werten übereinstimmen, die der Server aus dem veröffentlichten Archiv berechnet hat. Ohne Inhaltsverzeichnis wird zuerst der SHA-256 des ganzen Archivs geprüft, dann Größe und CRC-32 jeder Datei. Eine Abweichung beendet den Befehl mit `checksum_mismatch` (Exit-Code 5), und die Datei im Ordner bleibt, wie sie war.
- **Nichts wird außerhalb des Ordners geschrieben.** Pfade aus dem Archiv und vom Server werden als nicht vertrauenswürdige Daten behandelt. Ein Pfad, der den Ordner verlässt, wird mit `path_outside_root` abgelehnt. Einem Link im Ordner auf dem Weg zu einer Datei wird nie gefolgt. Namen, die Windows nicht speichern kann (`CON`, `aux.txt`, `a:b`, ein Punkt oder Leerzeichen am Ende), werden auf jedem System mit `unsafe_name` abgelehnt, sodass ein Baum unter Windows und Linux dasselbe bedeutet.
- **Modi.** Eine aus dem Archiv entpackte Datei erhält den Modus 755, wenn das Archiv sie als ausführbar kennzeichnet, sonst 644 (Linux und macOS). Eine über einen Bereich reparierte Datei behält den Modus der Datei, die sie ersetzt.

## Schnellere Übertragungen {#extensions}

Der Upload des ganzen Archivs bei `tree push` und der Download bei `tree pull` laufen über dieselbe Übertragung wie `upload` und `download`. Ein [Client-Modul](../protocols/cli#client-modules) mit einer Übertragungserweiterung kann sie übernehmen, wenn der Server dieselbe Erweiterung anbietet; das Archiv bleibt ein gewöhnliches ZIP, und sein SHA-256 sowie jede Datei werden wie oben beschrieben geprüft. Ohne Modul oder wenn der Server sie nicht anbietet, verwendet `arkvoryctl` seine eigene Übertragung.

## Verwandte Seiten {#related-pages}

- [Uploads und Downloads](./transfers)
- [Kommandozeile](../protocols/cli)
- [Artefakt-Referenz](../api/reference/artifacts)
