---
title: Module
description: Signierte Modulpakete auf einem Host installieren, prüfen und entfernen und die Schlüssel von Plugin-Autoren verwalten, denen Sie vertrauen.
---

# Module

Ein Modulpaket fügt Arkvory eine Funktion hinzu. Arkvory installiert nur Pakete, deren Signatur es prüfen kann. Die Befehle dieser Seite laufen auf dem Host der Installation, unter Linux als root, unter Windows als Administrator. Konsole und HTTP-API können weder Module installieren noch Schlüsseln vertrauen. Ein gestohlenes Administratorkonto der Konsole kann daher keinen Code auf dem Server ausführen.

Diese Version speichert und prüft Modulpakete. Die Dienste führen noch keinen Modulcode aus: Eine spätere Version lädt die installierten Module.

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

Grenzen: 1 GiB pro Paket, 256 MiB pro Datei, 4096 Dateien. Ein größeres Paket wird abgelehnt, bevor seine Daten gelesen werden.

Eine Version, die mit denselben Bytes bereits installiert ist, bleibt unverändert. Dieselbe Version mit anderen Bytes wird abgelehnt.

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

Der Befehl prüft jedes installierte Paket erneut, so wie die Dienste es vor dem Laden tun werden: die Signatur, jede Datei und das Archiv. Jedes Modul zeigt einen Zustand:

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
