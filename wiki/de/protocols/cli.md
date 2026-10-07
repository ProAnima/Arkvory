---
title: Kommandozeile (arkvoryctl)
---

# Kommandozeile (arkvoryctl)

`arkvoryctl` ist der Remote-Client von Arkvory für Menschen und CI/CD. Er lädt in Teilen hoch und herunter, setzt nach Unterbrechungen fort und prüft SHA-256. Er arbeitet mit den Berechtigungen des Schlüssels, den Sie ihm geben.

## Installation {#install}

| System                                                   | Paket                       | So installieren Sie es                                                                                                                                                               |
| -------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows 10/11, Windows Server 2019+ (x64)                | `Arkvory-CLI-Setup-x64.exe` | Führen Sie die Datei aus. Sie installiert für den aktuellen Benutzer, ohne Administratorrechte, und fügt `arkvoryctl` zum `PATH` des Benutzers hinzu. Öffnen Sie ein neues Terminal. |
| Debian, Ubuntu (x64)                                     | `Arkvory-CLI-amd64.deb`     | `sudo apt install ./Arkvory-CLI-amd64.deb`                                                                                                                                           |
| Fedora, RHEL-kompatibel (x64)                            | `Arkvory-CLI-x86_64.rpm`    | `sudo dnf install ./Arkvory-CLI-x86_64.rpm`                                                                                                                                          |
| Jedes System mit Node.js 24 (zum Beispiel ein CI-Runner) | `arkvoryctl.mjs`            | `node ./arkvoryctl.mjs --help`                                                                                                                                                       |

Die nativen Pakete enthalten ihr eigenes Node.js. Die Einzeldatei `arkvoryctl.mjs` hat keine npm-Abhängigkeiten. Nehmen Sie die Dateien aus einem vertrauenswürdigen Release von `ProAnima/Arkvory` und vergleichen Sie ihren SHA-256-Wert mit `release-checksums.json`. ARM64-Pakete gibt es noch nicht. Zum Aktualisieren installieren Sie ein neueres stabiles Release. Beim Deinstallieren bleiben Ihre Profile, Schlüsseldateien und Checkpoints erhalten.

## Mit einem Server verbinden {#connect-to-a-server}

1. Besorgen Sie sich einen Schlüssel: ein persönliches Zugriffstoken aus der Konsole oder einen Dienstschlüssel von Ihrem Administrator. Siehe [Konten und Schlüssel](../use/accounts).
2. Speichern Sie den Schlüssel in einer privaten Datei außerhalb jedes Repositorys. Verwenden Sie unter Linux den Modus `0600`. Erlauben Sie unter Windows nur Ihrem Konto den Zugriff.
3. Fügen Sie ein Profil hinzu und prüfen Sie die Verbindung:

```bash
arkvoryctl profile add production --server https://arkvory.example --token-file "$HOME/.secrets/arkvory.key" --repository releases
arkvoryctl doctor
arkvoryctl repositories
```

```powershell
arkvoryctl profile add production --server https://arkvory.example --token-file C:\Private\arkvory.key --repository releases
arkvoryctl doctor
```

`doctor` zeigt den Server, das Repository, die unterstützten Funktionen und die Berechtigungen des Schlüssels. Der Schlüssel ist nie ein Befehlsargument.

## Profile und Umgebung {#profiles-and-environment}

Profile werden in `profiles.json` in `~/.config/arkvory` gespeichert (unter Windows in `.config\arkvory` in Ihrem Benutzerordner). Ein Profil speichert die Server-URL, das Standard-Repository und den **Pfad** zur Schlüsseldatei, nicht den Schlüssel.

| Befehl                                                                  | Wirkung                                                                                            |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `profile add NAME --server URL [--token-file PATH] [--repository NAME]` | Fügt ein Profil hinzu. Das erste Profil wird zum Standard. Das Standard-Repository ist `releases`. |
| `profile list`                                                          | Zeigt alle Profile und das aktive an                                                               |
| `profile use NAME`                                                      | Macht ein Profil zum Standard                                                                      |
| `profile remove NAME`                                                   | Entfernt ein Profil                                                                                |

| Variable             | Bedeutung                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_TOKEN`      | Der Schlüssel selbst. Hat Vorrang vor jeder Datei.                                                                                                               |
| `ARKVORY_TOKEN_FILE` | Pfad zu einer Schlüsseldatei. Hat Vorrang vor der Datei des Profils.                                                                                             |
| `ARKVORY_BASE_URL`   | Server-URL. Ist sie gesetzt, wird die Schlüsseldatei des Profils **nicht** verwendet: Geben Sie den Schlüssel über `ARKVORY_TOKEN` oder `ARKVORY_TOKEN_FILE` an. |
| `ARKVORY_CLI_HOME`   | Anderer Ordner für `profiles.json`                                                                                                                               |

Die Server-URL muss HTTPS verwenden. Unverschlüsseltes HTTP ist nur für `localhost`, `127.0.0.1` und `[::1]` erlaubt. Die TLS-Prüfung lässt sich nicht ausschalten.

## Globale Optionen {#global-options}

| Option                       | Standard       | Bedeutung                                                                                                      |
| ---------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------- |
| `--profile NAME`             | aktives Profil | Profil nur für diesen Befehl                                                                                   |
| `--repository NAME`          | aus dem Profil | Repository nur für diesen Befehl                                                                               |
| `--json`                     | aus            | Ein kompaktes JSON-Ergebnis auf stdout; Fehler als JSON auf stderr                                             |
| `--lang en` oder `--lang ru` | aus `LANG`     | Sprache von Hilfe und Meldungen                                                                                |
| `--timeout MS`               | 60000          | Limit für Verwaltungsanfragen (1 bis 3600000)                                                                  |
| `--attempt-timeout MS`       | 120000         | Limit für einen Übertragungsversuch (1 bis 1800000)                                                            |
| `--retries N`                | 20             | Netzwerkwiederholungen für einen Vorgang (0 bis 100); `0` schaltet sie aus                                     |
| `--verbose`                  | aus            | Eine stderr-Zeile pro HTTP-Anfrage: Methode, Pfad, Status, Zeit, Anfrage-ID. Keine Header und keine Schlüssel. |
| `--help`, `--version`        |                | Hilfe; Client-Version als JSON                                                                                 |
| `--`                         |                | Beendet die Optionen, für Dateinamen, die mit `-` beginnen                                                     |

Jede Option darf nur einmal vorkommen. Unbekannte Optionen werden abgelehnt.

## Befehle {#commands}

### Erkundung und Katalog {#discovery-and-catalog}

| Befehl                                                                     | Ergebnis                                             |
| -------------------------------------------------------------------------- | ---------------------------------------------------- |
| `doctor`                                                                   | Verbindung, Funktionen und Berechtigungen            |
| `repositories [--after CURSOR]`                                            | Für den Schlüssel sichtbare Repositorys              |
| `operations [--after CURSOR]`                                              | Im Repository verfügbare API-Vorgänge                |
| `list [--after CURSOR]`                                                    | Artefakte des Repositorys                            |
| `search [--query TEXT] [--label TAG] [--collection NAME] [--after CURSOR]` | Suche nach Name und Metadatentext                    |
| `search --metadata-key KEY --metadata-value VALUE`                         | Exakte Übereinstimmung der Metadaten (beide angeben) |
| `inspect ID`                                                               | Metadaten eines Artefakts                            |
| `storage usage` / `storage policy`                                         | Belegung des Repositorys und Speicherrichtlinie      |

Seiten liefern `next`. Übergeben Sie den Wert mit `--after`, um die nächste Seite zu lesen.

### Übertragungen {#transfers}

| Befehl                                                                         | Ergebnis                                                                                                                                |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `upload FILE [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]`   | Fortsetzbarer Upload einer beliebigen Datei                                                                                             |
| `download ID OUTPUT`                                                           | Fortsetzbarer Download mit SHA-256-Prüfung                                                                                              |
| `put FILE PATH [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]` | Lädt die Datei hoch und macht sie zur nächsten Revision eines Pfads. Enthält der Pfad bereits dieselben Bytes, wird nichts hochgeladen. |
| `get PATH OUTPUT`                                                              | Lädt die aktuelle Revision eines Pfads herunter, geprüft und fortsetzbar                                                                |
| `link ID [--ttl SECONDS]`                                                      | Eine Download-URL ohne Schlüssel, 60 Sekunden bis 24 Stunden gültig (standardmäßig 1 Stunde)                                            |
| `uploads status ID` / `uploads cancel ID`                                      | Zustand einer Upload-Sitzung; Abbrechen (Abbrechen ist keine Pause)                                                                     |

`METADATA.json` enthält `labels` und `metadata` (eine Map von Zeichenketten). Sie hat Vorrang vor `--label`.

```bash
arkvoryctl put "./Build/Game Setup.exe" builds/game/1.4/GameSetup.exe
arkvoryctl get builds/game/1.4/GameSetup.exe ./GameSetup.exe
arkvoryctl link 00000000-0000-4000-8000-000000000001 --ttl 900
```

Ein Download-Link ist ein Geheimnis. Er kann nicht vor Ablauf widerrufen werden.

### Pakete und Hochstufung {#packages-and-promotion}

| Befehl                                                                                                                | Ergebnis                                                                                 |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `packages list [--group G] [--name N] [--after CURSOR]`                                                               | UPack-Pakete                                                                             |
| `packages publish FILE [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]`                                | Lädt ein UPack-Archiv hoch und registriert es                                            |
| `packages register ID`                                                                                                | Registriert ein bereits hochgeladenes UPack                                              |
| `packages resolve NAME [--group G] [--exact V] [--range R] [--stage S] [--prerelease] [--order promoted]`             | Wählt eine Version aus (`--exact` und `--range` schließen sich aus)                      |
| `packages download NAME OUTPUT [same filters]`                                                                        | Wählt eine Version aus und lädt sie geprüft herunter                                     |
| `promote ID --to REPOSITORY [--move] [--stage S1,S2] [--comment TEXT]`                                                | Veröffentlicht das Artefakt in einem anderen Repository, ohne die Bytes erneut zu senden |
| `stages list ID` / `stages add ID STAGE [--comment TEXT]` / `stages remove ID STAGE` / `stages artifacts [--stage S]` | Stufen von Artefakten                                                                    |
| `promotions history ID` / `promotions journal [--after CURSOR]`                                                       | Verlauf der Hochstufungen                                                                |

```bash
arkvoryctl packages publish ./build.upack --label test --state ./job-state/build.json --json
arkvoryctl promote 00000000-0000-4000-8000-000000000001 --to prod --stage release
arkvoryctl packages download app ./app.upack --range ^1.4 --stage release
```

Verwenden Sie `--exact` für eine exakte Version; `--version` gibt die Client-Version aus. Siehe [Pakete](../use/packages) und [Hochstufung](../use/promotion).

### Annotationen und Anhänge {#annotations-and-attachments}

`annotations get ID` und `annotations set ID --revision N --file ANNOTATIONS.json` lesen und ersetzen Labels, Metadaten und Sammlungen. `attachments get ID`, `attachments history ID` und `attachments set ID --revision N --file ATTACHMENTS.json` tun dasselbe für die verknüpften Dateien eines Builds. Lesen Sie zuerst und senden Sie dann den vollständigen neuen Zustand mit der Revision, die Sie gelesen haben. Eine gleichzeitige Änderung führt zu einem Konflikt (Exit-Code 6).

### Backups {#backups}

| Befehl                                                            | Ergebnis                                                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `backup status`                                                   | Backup-Speicher, Agent, Plan, letzter Punkt, Warnungen; Exit-Code 9 bei einer kritischen Warnung |
| `backup run`                                                      | Stellt einen Backup-Auftrag in die Warteschlange                                                 |
| `backup jobs [--after CURSOR]` / `backup points [--after CURSOR]` | Aufträge und Wiederherstellungspunkte, neueste zuerst                                            |
| `backup verify POINT_ID`                                          | Stellt eine vollständige Prüfung eines Punkts in die Warteschlange                               |
| `backup pin POINT_ID [--off]`                                     | Behält einen Punkt über die Aufbewahrung hinaus oder gibt ihn frei                               |

Diese Befehle benötigen den Dateischlüssel des Installationsbesitzers (Bootstrap) oder die Sitzung eines Konto-Administrators. Persönliche Zugriffstoken und Dienstschlüssel erhalten 403 (Exit-Code 3). Die Arbeit erledigt der Backup-Agent des Servers. Beispiel für das Monitoring: `arkvoryctl backup status --json || alert`. Siehe [Backups](../operate/backups).

## Unterbrochene Übertragungen fortsetzen {#resume-interrupted-transfers}

Führen Sie nach Strg+C oder einem Netzwerkausfall **denselben Befehl mit denselben Optionen** erneut aus.

- `upload`, `put` und `packages publish` legen neben der Quelldatei einen Checkpoint ab: `<source>.arkvory-upload.json` oder die mit `--state` angegebene Datei. Er speichert den Idempotenzschlüssel vor der ersten Anfrage, sodass eine verlorene Antwort nie eine zweite Kopie erzeugt.
- Um dieselben Bytes als **neues** Artefakt zu veröffentlichen, verwenden Sie eine neue `--state`-Datei.
- `download` und `get` legen `<output>.arkvory-part` und `<output>.arkvory-download.json` neben der Ausgabedatei ab. Die endgültige Datei erscheint erst nach der SHA-256-Prüfung. Eine vorhandene Ausgabedatei wird nie überschrieben.
- Legen Sie in CI den Zustandsordner vor dem Job an und behalten Sie ihn zusammen mit der Quelldatei zwischen den Wiederholungen.

Legen Sie Checkpoints auf einem lokalen Datenträger mit Hardlinks ab (NTFS, ext4, XFS), nicht auf FAT, exFAT oder Netzwerkfreigaben. Nach einem harten Absturz bleibt eine `.lock`-Datei zurück. Prüfen Sie, dass der Prozess mit der darin gespeicherten PID beendet ist, und löschen Sie dann nur die `.lock`-Datei.

## CI-Beispiel {#ci-example}

```bash
# Der Schlüssel stammt aus dem Secret-Speicher von CI. Geben Sie ihn nie aus.
export ARKVORY_BASE_URL=https://arkvory.example
export ARKVORY_TOKEN_FILE=/run/secrets/arkvory-key
mkdir -p job-state
node ./arkvoryctl.mjs packages publish ./build.upack --label test --state ./job-state/upload.json --json
```

Schlägt die Registrierung nach dem Upload fehl, enthält der JSON-Fehler `stage: "register"` und die `artifactId`. Wiederholen Sie denselben Befehl. Das erneute Registrieren desselben Artefakts ist unbedenklich.

### CI-Systeme {#ci-systems}

Alle folgenden Systeme tun dasselbe: Sie installieren eine festgelegte `arkvoryctl.mjs`, holen den Schlüssel aus dem Secret-Speicher des Systems und führen einen Befehl aus. Legen Sie die Version und das SHA-256 fest, damit ein veränderter Download den Job scheitern lässt. Verwenden Sie einen Dienstschlüssel, der auf das Repository und die vom Job benötigten Aktionen beschränkt ist ([Konten und Schlüssel](../use/accounts)). Der Agent braucht Node.js 24.

```yaml
# GitHub Actions: .github/workflows/publish.yml
name: publish
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    env:
      ARKVORY_BASE_URL: https://arkvory.example
      ARKVORY_TOKEN: ${{ secrets.ARKVORY_KEY }}
      ARKVORY_CLI_VERSION: '0.3.0'
      ARKVORY_CLI_SHA256: 555af7e66e25447ba17ea0d3dc676f6d04b4b8adc47818d8c8bb548085752504
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: Install arkvoryctl
        run: |
          curl -fsSL -o arkvoryctl.mjs "https://github.com/ProAnima/Arkvory/releases/download/v${ARKVORY_CLI_VERSION}/arkvoryctl.mjs"
          echo "${ARKVORY_CLI_SHA256}  arkvoryctl.mjs" | sha256sum -c -
      - name: Publish the build
        run: node ./arkvoryctl.mjs put ./Build/Game.zip "builds/game/${GITHUB_REF_NAME}/Game.zip" --json
```

```yaml
# GitLab CI: .gitlab-ci.yml (ARKVORY_TOKEN is a masked CI/CD variable)
publish:
  image: node:24
  variables:
    ARKVORY_BASE_URL: https://arkvory.example
    ARKVORY_CLI_VERSION: '0.3.0'
    ARKVORY_CLI_SHA256: 555af7e66e25447ba17ea0d3dc676f6d04b4b8adc47818d8c8bb548085752504
  script:
    - curl -fsSL -o arkvoryctl.mjs "https://github.com/ProAnima/Arkvory/releases/download/v${ARKVORY_CLI_VERSION}/arkvoryctl.mjs"
    - echo "${ARKVORY_CLI_SHA256}  arkvoryctl.mjs" | sha256sum -c -
    - node ./arkvoryctl.mjs put ./Build/Game.zip "builds/game/${CI_COMMIT_TAG}/Game.zip" --json
```

```groovy
// Jenkins: Jenkinsfile. The agent has Node.js 24 and a checked arkvoryctl.mjs, installed as above.
pipeline {
  agent any
  environment {
    ARKVORY_BASE_URL = 'https://arkvory.example'
    ARKVORY_TOKEN = credentials('arkvory-key')
  }
  stages {
    stage('Publish') {
      steps {
        sh 'node ./arkvoryctl.mjs put ./Build/Game.zip "builds/game/${BUILD_NUMBER}/Game.zip" --json'
      }
    }
  }
}
```

Jedes andere System, etwa TeamCity oder Buildkite, funktioniert genauso: Setzen Sie `ARKVORY_BASE_URL` und `ARKVORY_TOKEN` aus dessen Secret-Speicher und führen Sie den Befehl aus. Entscheiden Sie anhand des [Exit-Codes](#exit-codes).

## Ausgabe {#output}

- Ergebnisse sind JSON auf stdout. Ohne `--json` ist das JSON eingerückt. Backup-Befehle geben lesbare Zeilen aus, sofern Sie nicht `--json` angeben.
- Der Fortschritt erscheint nur auf einem interaktiven stderr.
- Ein Fehler ohne `--json` ist eine stderr-Zeile mit Servercode, Grund, Meldung, nächstem Schritt und Anfrage-ID. Mit `--json` enthält stderr `{"error": {...}}` mit `code`, `exitCode`, `status`, `serverCode`, `reason`, `requestId` und `retryAfterSeconds`. Entscheiden Sie nach `exitCode`, wenn ein Code unbekannt ist.

## Exit-Codes {#exit-codes}

| Code | Bedeutung                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------- |
| 0    | Erfolg                                                                                         |
| 2    | Falsche Argumente oder Konfiguration                                                           |
| 3    | Kein Schlüssel oder Zugriff verweigert (401, 403)                                              |
| 4    | HTTP- oder Netzwerkfehler, Zeitüberschreitung, Server ausgelastet, nicht gefunden              |
| 5    | Integritätsfehler (SHA-256 stimmt nicht überein, 422 `integrity_mismatch`)                     |
| 6    | Konflikt: Revision, Zustand, Sperre, vorhandene Datei, geänderter Checkpoint (409)             |
| 7    | Fehler bei einer lokalen Datei oder ungültige Serverantwort                                    |
| 8    | Kapazitätsgrenze des Servers: Kontingent, Datenträger, Warteschlange (507 `capacity_exceeded`) |
| 9    | `backup status`: Eine kritische Backup-Warnung ist aktiv                                       |
| 130  | Unterbrochen                                                                                   |

Der Client wiederholt nur bei Netzwerkfehlern und den HTTP-Statuscodes 408, 429, 502, 503 und 504, innerhalb von `--retries`.

## Fehlerbehebung {#troubleshooting}

| Meldung                                | Ursache und Lösung                                                                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `credential_required` (Exit 3)         | Kein Schlüssel gefunden. Prüfen Sie `--token-file`, `ARKVORY_TOKEN_FILE` oder setzen Sie den Schlüssel, wenn `ARKVORY_BASE_URL` verwendet wird.      |
| `forbidden` (Exit 3)                   | Dem Schlüssel fehlt die Berechtigung. Führen Sie `doctor` aus, um die Berechtigungen zu sehen.                                                       |
| `checkpoint_mismatch` (Exit 6)         | Datei, Server, Repository oder Optionen weichen vom gespeicherten Checkpoint ab. Verwenden Sie die ursprünglichen Optionen oder ein neues `--state`. |
| `state_locked` (Exit 6)                | Ein anderer Prozess verwendet den Checkpoint, oder nach einem Absturz ist eine alte `.lock`-Datei zurückgeblieben.                                   |
| `destination_exists` (Exit 6)          | Die Ausgabedatei existiert bereits. Wählen Sie einen anderen Namen.                                                                                  |
| `revision_mismatch` bei `put` (Exit 6) | Jemand hat den Pfad inzwischen geändert. Prüfen Sie den Verlauf des Pfads und entscheiden Sie dann.                                                  |
| Exit 8                                 | Kontingent oder Datenträger ist voll. Wenden Sie sich an den Administrator.                                                                          |

## Verwandte Seiten {#related-pages}

- [Clients und Protokolle](./index)
- [Übertragungen](../use/transfers) und [Dateien nach Pfad](../use/files)
- [TypeScript-SDK](./sdk)
- [Fehler](../api/errors)
