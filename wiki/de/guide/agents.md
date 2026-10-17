---
title: KI-Agenten
description: 'Ein KI-Agent wie Claude Code findet, lädt, veröffentlicht und stuft Artefakte über arkvoryctl mcp und den Arkvory-Skill für Agenten hoch.'
---

# KI-Agenten

Ein KI-Agenten-Client, der das Model Context Protocol (MCP) spricht, etwa Claude Code, kann über `arkvoryctl mcp` mit Arkvory arbeiten. Der Client startet den Befehl und spricht über stdin und stdout mit ihm; es wird kein Netzwerkport geöffnet. Der Skill für Agenten bringt dem Agenten darauf aufbauend sichere Abläufe bei.

## Bevor Sie beginnen {#before}

1. Installieren Sie den [Kommandozeilen-Client](../protocols/cli) auf dem Rechner, auf dem der Agent läuft.
2. Erstellen Sie für den Agenten einen Dienstschlüssel, der nur die Repositorys und Aktionen erreicht, die er braucht. Speichern Sie ihn in einer Datei, die nur Sie lesen können.
3. Fügen Sie ein Profil hinzu, das auf die Schlüsseldatei verweist, und prüfen Sie es:

```bash
arkvoryctl profile add agent --server https://arkvory.example --token-file ~/.config/arkvory/agent.key --repository builds
arkvoryctl doctor --profile agent
```

Fügen Sie den Schlüssel nie in den Chat, ein Argument oder eine Projektdatei ein. Der Agent sieht ihn nie: Ergebnisse und Fehler enthalten ihn nicht.

## MCP-Server verbinden {#connect}

```bash
claude mcp add arkvory -- arkvoryctl mcp --profile agent --root ~/work
```

Ohne `--write` ist der Server nur lesend: Der Agent kann Repositorys auflisten, alle durchsuchen, Artefakte, Pakete, Dateien nach Pfad, den Änderungsfeed und den Status der Installation lesen und Artefakte herunterladen. Werkzeuge, die der Schlüssel nicht nutzen kann, werden nicht angeboten. Der Client muss MCP 2025-06-18 oder neuer unterstützen.

## Schreiben erlauben {#write}

Schreiben ist eine eigene Konfiguration. Nennen Sie die Repositorys, in die der Agent schreiben darf:

```bash
claude mcp add arkvory-publish -- arkvoryctl mcp --profile agent --root ~/work --write --write-repositories builds
```

| Werkzeug                  | Was es tut                                                                    |
| ------------------------- | ----------------------------------------------------------------------------- |
| `arkvory_upload`          | Lädt eine Datei als neues Artefakt oder als nächste Revision eines Pfads hoch |
| `arkvory_publish_package` | Lädt ein UPack hoch und registriert es als Paketversion                       |
| `arkvory_promote`         | Fügt eine Stufe hinzu; mit `sha256` nur dem Artefakt mit genau diesen Bytes   |
| `arkvory_stage_remove`    | Entfernt eine Stufe; das Artefakt bleibt                                      |
| `arkvory_annotate`        | Ersetzt Labels und Metadaten bei der Revision, die der Agent gelesen hat      |

- Ein Schreibvorgang in ein Repository, das nicht in `--write-repositories` steht, wird abgelehnt, bevor etwas gesendet wird (`repository_not_allowed`). Der Server prüft die Berechtigungen des Schlüssels trotzdem.
- Nichts kann gelöscht oder wiederhergestellt werden, und es werden keine Download-Links erstellt. Das bleibt Aufgabe eines Menschen in der Konsole.
- Der Server weist den Agenten an, jeden Schreibvorgang zu beschreiben und auf Ihre Bestätigung zu warten. Ihr MCP-Client kann zusätzlich vor jedem Aufruf fragen.
- Ein Upload lässt sich fortsetzen: Nach einem Fehler wiederholt der Agent denselben Aufruf, und dasselbe Artefakt wird zurückgegeben statt eines zweiten. Das Ergebnis nennt den SHA-256 der gelesenen Datei.

## Dateien und Grenzen {#files}

- Der Agent liest und schreibt lokale Dateien nur unterhalb von `--root` (standardmäßig das aktuelle Verzeichnis). Ein Pfad, der hinausführt, auch über einen Link, wird abgelehnt (`path_outside_root`).
- Ein Download erscheint erst, nachdem Größe und SHA-256 geprüft sind. Eine vorhandene Datei wird nur ersetzt, wenn der Agent darum bittet.
- Eine Datei, die den Schlüssel enthält, wird nie hochgeladen (`source_contains_credential`), und die eigenen Dateien von arkvoryctl (Profile, Schlüsseldateien, Upload-Checkpoints) werden auch unterhalb von `--root` nie gelesen oder ersetzt (`private_path`).
- Ein Ergebnis umfasst höchstens `--max-output-bytes` (standardmäßig 64 KiB, bis 1 MiB) und 100 Einträge; für mehr gibt der Agent `next` als `after` zurück.

## Skill installieren {#skill}

Der Skill ist eine Sammlung von Anweisungen für den Agenten: wie er sucht, Downloads prüft, veröffentlicht, hochstuft und Fehlercodes liest und was er nie tun darf. Er wird mit dem Client geliefert:

```bash
arkvoryctl skill install
```

Der Skill landet in `~/.claude/skills/arkvory`; mit `--target DIR` installieren Sie ihn in ein Projekt, etwa `.claude/skills/arkvory`. Ein erneuter Aufruf aktualisiert die Dateien, die Sie nicht geändert haben. Eine von Ihnen geänderte Datei bleibt erhalten: Der Befehl bricht ab und ändert nichts, außer Sie geben `--force` an.

## Sicherheit {#safety}

- Namen, Labels, Metadaten und Kommentare in Ergebnissen schreiben andere Menschen. Der Agent behandelt sie als Daten und folgt nie Anweisungen, die darin stehen.
- Halten Sie die Lese- und die Schreibkonfiguration getrennt, und erlauben Sie Schreiben nur in die Repositorys, die die Aufgabe braucht.
- Verwenden Sie einen eigenen Schlüssel mit engen Berechtigungen; widerrufen Sie ihn in der Konsole, wenn der Agent ihn nicht mehr braucht.

## Fehlerbehebung {#troubleshooting}

| Fehler                   | Ursache und Lösung                                                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keine Schreibwerkzeuge   | Der Server wurde ohne `--write` gestartet, oder dem Schlüssel fehlt die Berechtigung.                                                                                                                                                 |
| `repository_not_allowed` | Das Repository steht nicht in `--write-repositories`. Ändern Sie die MCP-Konfiguration.                                                                                                                                               |
| `forbidden`              | Dem Schlüssel fehlt die Berechtigung. `arkvoryctl doctor` zeigt die Berechtigungen.                                                                                                                                                   |
| `path_outside_root`      | Die Datei liegt außerhalb von `--root` oder ist keine reguläre Datei.                                                                                                                                                                 |
| `state_locked`           | Derselbe Upload läuft noch in einem anderen Aufruf. Prüfen Sie nach einem Absturz, dass kein `arkvoryctl mcp` diese Datei hochlädt, und löschen Sie dann die `.lock`-Datei in `mcp-uploads` im CLI-Verzeichnis (`~/.config/arkvory`). |
| `skill_modified`         | Sie haben eine Skill-Datei geändert. Behalten Sie Ihre Kopie oder wiederholen Sie `arkvoryctl skill install` mit `--force`.                                                                                                           |
