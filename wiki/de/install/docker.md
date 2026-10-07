---
title: Docker Compose
description: 'Betreiben Sie Arkvory als Projekt mit Docker Compose, mit seinen Containern, Volumes, Ports, Updates, Backup-Agent und Entfernung.'
---

# Docker Compose

Eine Compose-Installation betreibt die API, den Worker, den Backup-Agent und PostgreSQL als Container auf einem Host. Der Installer baut das Arkvory-Image aus dem Release und startet das Projekt `proanima-arkvory`. Verwenden Sie sie auf Container-Hosts. Unter Windows ist Docker Desktop nur zur Evaluierung gedacht: siehe [Windows mit Docker Desktop](#docker-desktop).

Compose hat kein eingebautes HTTPS. Setzen Sie einen Reverse-Proxy davor, bevor sich Clients von anderen Computern verbinden: siehe [HTTPS und Reverse-Proxy](./https).

## Anforderungen {#requirements}

| Element           | Anforderung                                                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine            | Docker Engine mit dem Compose-Plugin (`docker compose`). Podman mit einem kompatiblen Compose-Provider ist mit `--engine podman` möglich, aber nicht getestet                                   |
| Konto             | `root` oder ein Benutzer in der Gruppe `docker`                                                                                                                                                 |
| Start beim Booten | Die Container-Engine muss beim Booten starten, sonst kommt Arkvory nach einem Neustart nicht zurück. Prüfen Sie mit `systemctl is-enabled docker`                                               |
| Host              | Eine Arkvory-Installation pro Container-Host. Der Projektname und der Port sind fest                                                                                                            |
| Freier Port       | 8080 auf `127.0.0.1`                                                                                                                                                                            |
| Container         | Nur Linux-Container. Windows-Container werden nicht unterstützt                                                                                                                                 |
| Internet          | `nodejs.org` (der Installer lädt Node.js 24.21.0 herunter und prüft dessen SHA-256), der Update-Hub oder GitHub (das Release) und Docker Hub (`node:24.21.0-bookworm-slim` und `postgres:18.4`) |

Der Installer installiert oder ändert weder die Container-Engine noch den Hypervisor oder WSL.

## Das Bundle {#bundle}

Der Installer nimmt ein verifiziertes Release und entpackt es nach `releases/<version>/` im Installationsverzeichnis. Die Compose-Datei ist `releases/<version>/deploy/compose.yml`, die Build-Datei ist `releases/<version>/deploy/Dockerfile`. Das Image `proanima-arkvory:<version>` wird auf Ihrem Host aus `node:24.21.0-bookworm-slim` gebaut. Aus einer Arkvory-Registry wird nichts gezogen.

Das Installationsverzeichnis ist unter Linux `/opt/proanima-arkvory`. Seine Struktur ist unter [Installation auswählen](./#installation-directory) beschrieben. Bei einer Compose-Installation liegen die Daten nicht in `data/`: Sie liegen in den unten beschriebenen Volumes.

## Container {#containers}

| Dienst        | Image                        | Rolle                                                                                                   |
| ------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| `database`    | `postgres:18.4`              | PostgreSQL. Meldet alle 5 Sekunden mit `pg_isready` Bereitschaft                                        |
| `api`         | `proanima-arkvory:<version>` | HTTP-API und Konsole. Veröffentlicht auf `127.0.0.1:8080`. Health-Prüfung alle 10 Sekunden              |
| `worker`      | `proanima-arkvory:<version>` | Schließt Uploads ab und führt Hintergrundaufgaben aus. Startet, nachdem die API bereit ist              |
| `backup`      | `proanima-arkvory:<version>` | Backup-Agent. Liest das Speicher-Volume schreibgeschützt. Veröffentlicht keinen Port                    |
| `initialize`  | `proanima-arkvory:<version>` | Einmalig, als root: überträgt dem Benutzer 1000 den Besitz des Speicher-Volumes                         |
| `migrate`     | `proanima-arkvory:<version>` | Einmalig: führt die Datenbankmigrationen aus                                                            |
| `vault-owner` | `proanima-arkvory:<version>` | Einmalig, nur mit dem Profil `maintenance`: überträgt dem Benutzer 1000 den Besitz des Backup-Speichers |

Die lang laufenden Dienste starten neu, sofern Sie sie nicht stoppen. Die Container von Arkvory laufen als Benutzer `node` (Benutzer 1000) des Images, mit einem schreibgeschützten Root-Dateisystem, einem 64 MiB großen `/tmp` im Speicher, allen entfernten Capabilities, `no-new-privileges` und 120 Sekunden zum Stoppen. Docker bewahrt für jeden Container bis zu fünf JSON-Protokolldateien von 20 MiB auf.

## Volumes und Bind-Mounts {#volumes}

### Docker-Volumes {#docker-volumes}

| Volume                     | Eingehängt unter                    | Inhalt                                                                          |
| -------------------------- | ----------------------------------- | ------------------------------------------------------------------------------- |
| `proanima-arkvory_storage` | `/var/lib/arkvory`                  | Dateiinhalte und Upload-Staging. Der Backup-Agent hängt es schreibgeschützt ein |
| `proanima-arkvory_catalog` | `/var/lib/postgresql` in `database` | Die PostgreSQL-Daten                                                            |

Die Volumes überleben Updates und `docker compose down`. Nur `down --volumes` löscht sie.

### Bind-Mounts aus dem Installationsverzeichnis {#bind-mounts}

| Host-Pfad                 | Im Container                    | Modus            | Eingehängt in                                                            |
| ------------------------- | ------------------------------- | ---------------- | ------------------------------------------------------------------------ |
| `config/runtime.json`     | `/run/arkvory/runtime.json`     | schreibgeschützt | api, worker, backup                                                      |
| `config/keys.json`        | `/run/arkvory/keys.json`        | schreibgeschützt | api, worker                                                              |
| `config/health-token.txt` | `/run/arkvory/health-token.txt` | schreibgeschützt | api, worker                                                              |
| `config/postgres.env`     | Umgebungsdatei                  |                  | database                                                                 |
| `updates/status`          | `/run/arkvory-updates/status`   | schreibgeschützt | api, worker                                                              |
| `updates/inbox`           | `/run/arkvory-updates/inbox`    | lesen/schreiben  | api, worker                                                              |
| der Backup-Speicher       | `/srv/arkvory-vault`            | lesen/schreiben  | backup, `vault-owner` (nur solange ein Backup-Speicher konfiguriert ist) |
| `config/mirrors`          | `/run/arkvory/mirrors`          | schreibgeschützt | api, worker (nur solange ein Repository gespiegelt wird)                 |

### Besitzer und Modi {#owners}

| Pfad                                                   | Besitzer und Modus                  | Grund                                                                                                                                                                     |
| ------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Das Installationsverzeichnis                           | Der installierende Benutzer, `0700` | Das Verzeichnis enthält den Wiederherstellungsschlüssel und das Datenbankpasswort. Nur der installierende Benutzer kann es betreten                                       |
| `config/runtime.json`, `keys.json`, `health-token.txt` | `0644`                              | Benutzer 1000 im Container muss sie lesen. `runtime.json` enthält das Datenbankpasswort; das `0700`-Installationsverzeichnis hält andere Benutzer von diesen Dateien fern |
| `updates/inbox`                                        | `0777`                              | Das einzige Verzeichnis, in das der Container auf dem Host schreibt. Der Containerbenutzer und der Host-Updater können unterschiedliche Benutzer-IDs haben                |
| `updates/status`                                       | `0755`                              | Wird vom Host-Updater geschrieben; der Container liest es nur                                                                                                             |
| Speicher-Volume                                        | Benutzer 1000                       | `initialize` setzt es bei Installation und Update                                                                                                                         |
| Backup-Speicher                                        | Benutzer 1000                       | `vault-owner` setzt es, wenn Sie den Backup-Speicher verbinden. Der Backup-Speicher gehört dann dem Host-Benutzer mit ID 1000                                             |

## Ports {#ports}

| Port     | Dienst          | Freigabe                                                             |
| -------- | --------------- | -------------------------------------------------------------------- |
| 8080/TCP | API und Konsole | `127.0.0.1:8080` auf dem Host. Die Adresse ist fest                  |
| 5432/TCP | PostgreSQL      | Nicht veröffentlicht. Nur innerhalb des Compose-Netzwerks erreichbar |

Die Compose-Datei gehört zum Release-Verzeichnis, das Updates ersetzen, daher können Sie die veröffentlichte Adresse dort nicht ändern. Um die Konsole von anderen Computern zu erreichen, installieren Sie einen Reverse-Proxy auf dem Host, der an `127.0.0.1:8080` weiterleitet.

## Umgebung {#environment}

Die Compose-Datei setzt keine Arkvory-Einstellungen. Die Dienste lesen `/run/arkvory/runtime.json`, das auf dem Host `config/runtime.json` ist. Der Installer schreibt diese Werte, und Sie dürfen sie nicht ändern: `ARKVORY_HOST` (`0.0.0.0` im Container), `ARKVORY_PORT` (`8080`), `ARKVORY_DATABASE_URL` (der Container `database` mit einem generierten Passwort), `ARKVORY_DATA_DIR` (`/var/lib/arkvory`), `ARKVORY_KEYS_FILE` und `ARKVORY_UPDATE_CONTROL_DIR`.

Sie können weitere Einstellungen hinzufügen, etwa `ARKVORY_TRUSTED_PROXIES`, die Limits oder `ARKVORY_LOG_LEVEL`. Fügen Sie sie zu `config/runtime.json` hinzu und stoppen und starten Sie dann die Dienste, wie unter [Das Projekt verwalten](#manage) beschrieben. Die vollständige Liste steht unter [Umgebungsvariablen](../reference/environment). `config/compose.env` enthält `ARKVORY_IMAGE`. Der Installer pflegt sie; bearbeiten Sie sie nicht.

## Unter Linux installieren {#install}

1. Laden Sie `install.sh` von [GitHub Releases](https://github.com/ProAnima/Arkvory/releases) herunter und prüfen Sie das Skript.
2. Führen Sie es als `root` aus:

   ```bash
   sudo bash ./install.sh --mode compose
   ```

   Fügen Sie `--automatic` hinzu, um automatische Updates einzuschalten, oder `--engine podman` für Podman. Mit `ARKVORY_RELEASE_VERSION=1.2.3` installiert das Skript diese stabile Version. Ohne Internetzugang zu GitHub entpacken Sie `Arkvory-Linux.tar.gz` und führen im entpackten Verzeichnis `sudo env ARKVORY_ARTIFACT_DIR="$PWD" bash ./install.sh --mode compose` aus. Node.js wird trotzdem heruntergeladen.

3. Warten Sie, bis der Installer fertig ist. Er prüft und entpackt das Release, baut das Image, startet die Datenbank, führt `initialize` und `migrate` aus, startet die API und den Worker, wartet, bis die API dreimal hintereinander Bereitschaft meldet, startet den Backup-Agent und registriert den Update-Timer.

Ein Benutzer in der Gruppe `docker` kann ohne `root` in ein Verzeichnis installieren, dessen Besitzer er ist:

```bash
ARKVORY_INSTALL_ROOT="$HOME/arkvory" bash ./install.sh --mode compose
```

Der Installer registriert dann keinen Update-Timer. Die Konsole kann keine Updates anfordern, bis Sie den Updater selbst planen. Siehe [Updates in Compose](#updates-compose).

## Erster Start und Erste Schritte {#first-start}

1. Prüfen Sie, dass die Container laufen. Den Befehl `compose` finden Sie unter [Das Projekt verwalten](#manage).

   ```bash
   "${compose[@]}" ps
   ```

2. Lesen Sie den Wiederherstellungsschlüssel:

   ```bash
   sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
   ```

3. Öffnen Sie `http://127.0.0.1:8080/console/#onboarding` auf dem Server. Leiten Sie von Ihrem eigenen Computer den Port weiter: `ssh -L 8080:127.0.0.1:8080 admin@arkvory.example`.
4. Öffnen Sie in der Konsole [[ui:navStart]] und klappen Sie [[ui:welcomeOwner]] auf. Fügen Sie den Schlüssel in [[ui:welcomeRecovery]] ein, geben Sie den Besitzernamen und ein Passwort mit mindestens 12 Zeichen ein und wählen Sie [[ui:welcomeCreate]].

Bewahren Sie den Wiederherstellungsschlüssel auf dem Server auf. Siehe [Sicherheit](../operate/security).

## Das Projekt verwalten {#manage}

Öffnen Sie eine Root-Shell (`sudo -i`) und definieren Sie den Befehl `compose` einmal. Compose braucht den Projektnamen, das Projektverzeichnis, die Umgebungsdatei und jede Compose-Datei der Installation:

```bash
root=/opt/proanima-arkvory
node="$root/runtime/node-v24.21.0-linux-x64/bin/node"   # linux-arm64 on arm64
version=$("$node" -p "require('$root/installation.json').current.version")
compose=(docker compose --project-name proanima-arkvory --project-directory "$root"
  --env-file "$root/config/compose.env" -f "$root/releases/$version/deploy/compose.yml")
for file in compose.vault.yml compose.mirrors.yml; do
  if [[ -f "$root/config/$file" ]]; then compose+=(-f "$root/config/$file"); fi
done
```

Wenn Sie eine vorhandene Datei auslassen, erstellt `up` den Container ohne den Backup-Speicher- oder Spiegel-Mount neu.

| Aufgabe            | Befehl                                                                            |
| ------------------ | --------------------------------------------------------------------------------- |
| Container anzeigen | `"${compose[@]}" ps`                                                              |
| Protokolle lesen   | `"${compose[@]}" logs --tail 100 api worker backup`                               |
| Arkvory stoppen    | `"${compose[@]}" stop --timeout 120 backup worker api`                            |
| Arkvory starten    | `"${compose[@]}" up -d --wait api worker` und dann `"${compose[@]}" up -d backup` |

Ein Stopp mit `stop` hält einen Container nach einem Neustart der Engine gestoppt. Starten Sie ihn mit `up -d` erneut.

Die Lebenszyklus-Befehle laufen mit dem Node.js, das der Installer in das Installationsverzeichnis gelegt hat:

```bash
sudo "$node" "$root/manage.mjs" status --root "$root"
```

Auf einem Compose-Host ist `arkvory` nicht installiert, rufen Sie daher `manage.mjs` für `status`, `update` und `configure` auf. Die Befehle sind unter [Konfiguration](./configuration) beschrieben.

## Protokolle {#logs}

Container schreiben in die JSON-Protokolldateien von Docker. Lesen Sie sie mit `"${compose[@]}" logs`. API und Worker schreiben pro Zeile einen JSON-Datensatz. Siehe [Monitoring](../operate/monitoring). Die Lebenszyklus-Befehle geben ihre Meldungen auf dem Terminal aus, und der Update-Timer schreibt ins Journal: `journalctl -u arkvory-update`.

## Updates in Compose {#updates-compose}

Aktualisieren Sie über die Konsole, das Fenster für automatische Updates oder den Befehl:

```bash
sudo "$node" "$root/manage.mjs" update --root "$root"
```

Das Update lädt das Release herunter und prüft es, baut das neue Image, stoppt dann `backup`, `worker` und `api` und startet sie mit dem neuen Image. Der Container `database` läuft weiter. Die Volumes bleiben unverändert. Ein Release, das das Datenbankschema ändert, wird nur nach einem verifizierten Backup installiert. Siehe [Updates](./updates).

Der Host-Updater läuft einmal pro Minute. Als `root` auf einem systemd-Host installiert, registriert der Installer ihn als `arkvory-update.timer`. Ohne `root` gibt der Installer eine Warnung aus. Planen Sie diesen Befehl jede Minute als der Benutzer, dem die Installation gehört und der Zugriff auf die Container-Engine hat, zum Beispiel mit cron:

```text
* * * * * /home/admin/arkvory/runtime/node-v24.21.0-linux-x64/bin/node /home/admin/arkvory/manage.mjs updates-poll --root /home/admin/arkvory
```

Geben Sie den Docker-Socket niemals an die Arkvory-Container weiter.

## Backup-Agent in Compose {#backup-agent}

Der Container `backup` läuft von Anfang an. Ohne Backup-Speicher läuft er und meldet, dass kein Backup-Speicher konfiguriert ist. Der Backup-Speicher ist ein Verzeichnis des Hosts, außerhalb des Installationsverzeichnisses, auf einem separaten Volume.

1. Hängen Sie das Volume für den Backup-Speicher ein und erstellen Sie ein leeres Verzeichnis, zum Beispiel `/mnt/backup/arkvory`. Das Verzeichnis muss existieren: Compose erstellt es nicht.
2. Verbinden Sie ihn:

   ```bash
   sudo "$node" "$root/manage.mjs" configure --root "$root" --backup-vault /mnt/backup/arkvory --vault-key-file /root/arkvory-agent.key
   ```

   Der Befehl prüft das Verzeichnis, schreibt `config/compose.vault.yml`, überträgt dem Benutzer 1000 den Besitz des Verzeichnisses, übergibt dem Backup-Container die Datei mit dem Agent-Schlüssel schreibgeschützt (`--vault-key-file`) und startet nur den Backup-Container neu. Er ist erfolgreich, wenn der Agent den Backup-Speicher als verfügbar meldet. Andernfalls stellt er die vorherige Konfiguration wieder her.

3. Um den Backup-Speicher zu trennen, führen Sie denselben Befehl mit `--backup-vault-off` aus. Der Backup-Speicher selbst wird nicht berührt.

Zeitpläne, Aufbewahrung und Wiederherstellungen sind unter [Backups](../operate/backups) beschrieben.

## Entfernen {#remove}

```bash
"${compose[@]}" down              # removes the containers, keeps the volumes
"${compose[@]}" down --volumes    # also deletes the catalog and all stored files
```

`down --volumes` löscht alle Daten. Führen Sie es niemals auf einer Installation aus, die Dateien enthält. Erstellen Sie zuerst ein Backup und bewahren Sie den Backup-Speicher auf.

Nach `down` können Sie entfernen, was übrig bleibt:

```bash
sudo systemctl disable --now arkvory-update.timer
sudo rm -f /etc/systemd/system/arkvory-update.service /etc/systemd/system/arkvory-update.timer
sudo systemctl daemon-reload
docker image rm "proanima-arkvory:$version"
sudo rm -rf /opt/proanima-arkvory
```

Löschen Sie das Installationsverzeichnis erst, wenn Sie die Konfiguration und den Wiederherstellungsschlüssel nicht mehr benötigen. Die Images früherer Versionen bleiben auf dem Host, bis Sie sie entfernen.

## Windows mit Docker Desktop {#docker-desktop}

Verwenden Sie Docker Desktop nur zur Evaluierung auf einem Arbeitsplatzrechner. Docker Desktop ist die Anwendung eines einzelnen Benutzers: Die Container laufen nur, solange dieser Benutzer angemeldet ist und Docker Desktop läuft. Nach einem Neustart des Computers ist Arkvory bis dahin nicht verfügbar. Aktivieren Sie **Settings > General > Start Docker Desktop when you sign in**. Der Installer und der Befehl `status` warnen, wenn diese Einstellung ausgeschaltet ist. Verwenden Sie für einen Server die [Windows-Dienste](./windows).

1. Starten Sie Docker Desktop im Modus für Linux-Container.
2. Laden Sie `install.ps1` aus dem Release herunter und prüfen Sie es.
3. Öffnen Sie Windows PowerShell als der Benutzer, der Docker Desktop ausführt, **ohne** Administratorrechte, und führen Sie aus:

   ```powershell
   .\install.ps1 -Mode compose
   ```

   Die Parameter `-Root`, `-Version`, `-Engine`, `-Artifact`, `-AutomaticUpdates` und `-Pin` sind unter [Windows](./windows#install-with-powershell-and-an-existing-postgresql) beschrieben. Geben Sie `-Root` und `-Artifact` als absolute Pfade an.

4. Öffnen Sie `http://127.0.0.1:8080/console/#onboarding`, lesen Sie den Wiederherstellungsschlüssel aus `C:\ProgramData\ProAnima\Arkvory\config\bootstrap-token.txt` und erstellen Sie den Besitzer, wie unter [Erster Start und Erste Schritte](#first-start) beschrieben.

Das Installationsverzeichnis `C:\ProgramData\ProAnima\Arkvory` gewährt SYSTEM, Administratoren und dem installierenden Benutzer Zugriff, ohne Vererbung, weil Docker Desktop die Bind-Mounts mit dem Token dieses Benutzers liest. Führen Sie den Installer für Compose nicht mit erhöhten Rechten aus.

Der Installer registriert die Update-Aufgabe `ProAnimaArkvoryUpdate` nur, wenn er als Administrator ausgeführt wird. Diese Aufgabe eignet sich für eine systemweite Engine, nicht für Docker Desktop. Registrieren Sie die Aufgabe für Docker Desktop als der Docker-Desktop-Benutzer. Sie funktioniert nur, solange dieser Benutzer angemeldet ist und Docker Desktop läuft:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
$node = "$root\runtime\node-v24.21.0-win-x64\node.exe"
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$root\manage.mjs`" updates-poll --root `"$root`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Action $action -Trigger $trigger -Settings $settings
```

Verwalten Sie das Projekt in PowerShell mit denselben Argumenten:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
$version = (Get-Content "$root\installation.json" -Raw | ConvertFrom-Json).current.version
$compose = @('compose', '--project-name', 'proanima-arkvory', '--project-directory', $root,
  '--env-file', "$root\config\compose.env", '-f', "$root\releases\$version\deploy\compose.yml")
foreach ($file in 'compose.vault.yml', 'compose.mirrors.yml') {
  if (Test-Path "$root\config\$file") { $compose += @('-f', "$root\config\$file") }
}
docker @compose ps
& "$root\runtime\node-v24.21.0-win-x64\node.exe" "$root\manage.mjs" status --root $root
```

Ein Backup-Speicher unter Windows muss ein lokales oder iSCSI-Volume sein. UNC- und SMB-Pfade werden abgelehnt. Um die Installation zu entfernen, führen Sie `docker @compose down --volumes` aus, heben Sie die Aufgabe mit `Unregister-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Confirm:$false` auf und löschen Sie das Installationsverzeichnis. Erstellen Sie zuerst ein Backup.
