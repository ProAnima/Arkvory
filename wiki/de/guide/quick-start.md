---
title: Schnellstart
---

# Schnellstart

Diese Seite zeigt den kürzesten Weg von null bis zu einem laufenden Arkvory-Server mit einer hochgeladenen Datei. Wählen Sie in Schritt 1 eine Installationsmethode und folgen Sie dann den übrigen Schritten der Reihe nach.

Laden Sie Installer nur von der [Releases-Seite](https://github.com/ProAnima/Arkvory/releases) des Projekts herunter und vergleichen Sie ihren SHA-256-Wert mit den Prüfsummendateien des Releases.

## Schritt 1: Server installieren {#step-1-install-the-server}

### Windows {#windows}

Sie benötigen Windows 10 Version 1809 oder neuer bzw. Windows Server 2019 oder neuer auf x64 sowie Administratorrechte. Eine Internetverbindung ist nicht nötig.

1. Führen Sie `Arkvory-Setup-x64.exe` aus und bestätigen Sie die Administratorabfrage.
2. Wählen Sie die Sprache und akzeptieren Sie die Lizenz.
3. Geben Sie auf der Seite für den Besitzer einen Namen (3–64 lateinische Buchstaben, Ziffern, `.`, `-` oder `_`) und ein Passwort mit mindestens 12 Zeichen ein. Das ist das erste Administratorkonto.
4. Beenden Sie den Assistenten. Er kann die Konsole für Sie öffnen.

Das Setup installiert das Programm in `C:\Program Files\ProAnima\Arkvory` und die Daten in `C:\ProgramData\ProAnima\Arkvory`. Es erstellt vier Windows-Dienste: `Arkvorydatabase`, `Arkvoryapi`, `Arkvoryworker` und `Arkvorybackup`. Sie laufen ohne angemeldeten Benutzer. Siehe [Windows](../install/windows).

### Linux {#linux}

Verwenden Sie das Paket für Ihre Distribution. Der Paketmanager installiert auch den PostgreSQL-Server (unterstützt werden die Versionen 16 bis 19).

```bash
# Debian, Ubuntu
sudo apt install ./Arkvory-amd64.deb

# Fedora, RHEL-kompatibel
sudo dnf install ./Arkvory-x86_64.rpm
```

Das Installationsverzeichnis ist `/opt/proanima-arkvory`. Das Paket erstellt die systemd-Dienste `arkvory-database`, `arkvory-api`, `arkvory-worker` und `arkvory-backup`. Prüfen Sie sie:

```bash
systemctl status arkvory-api arkvory-worker arkvory-backup
```

Siehe [Linux](../install/linux).

### Docker Compose {#docker-compose}

Sie benötigen Docker mit Compose. Verwenden Sie unter Windows Docker Desktop mit Linux-Containern. Das Skript lädt Node.js und das Release herunter und braucht daher Internetzugang.

Laden Sie `install.sh` oder `install.ps1` aus dem Release herunter und lesen Sie das Skript, bevor Sie es ausführen.

```bash
sudo bash ./install.sh --mode compose
```

Starten Sie unter Windows PowerShell mit demselben Benutzerkonto, unter dem Docker Desktop läuft, und ohne Administratorrechte:

```powershell
.\install.ps1 -Mode compose
```

Das Installationsverzeichnis ist unter Linux `/opt/proanima-arkvory` und unter Windows `C:\ProgramData\ProAnima\Arkvory`. Der Stack besteht aus API, Worker, Backup-Agent und PostgreSQL 18. Siehe [Docker](../install/docker).

## Schritt 2: Konsole öffnen {#step-2-open-the-console}

Öffnen Sie `http://127.0.0.1:8080/console/` in einem Browser auf dem Server.

Zunächst lauscht der Server nur auf der lokalen Adresse `127.0.0.1`. Um die Konsole von Ihrem eigenen Rechner aus zu öffnen, leiten Sie den Port über SSH weiter:

```bash
ssh -L 8080:127.0.0.1:8080 admin@arkvory.example
```

Öffnen Sie dann `http://127.0.0.1:8080/console/` auf Ihrem Rechner. Richten Sie zuerst [HTTPS](../install/https) ein, um anderen Rechnern Zugriff zu geben.

## Schritt 3: Besitzer erstellen {#step-3-create-the-owner}

Überspringen Sie diesen Schritt unter Windows: Das Setup hat den Besitzer bereits erstellt.

Unter Linux und Docker wird das erste Konto mit dem **Wiederherstellungsschlüssel** erstellt. Der Installer schreibt ihn nach `config/bootstrap-token.txt` im Installationsverzeichnis. Nur ein Administrator kann die Datei lesen.

```bash
sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
```

```powershell
Get-Content C:\ProgramData\ProAnima\Arkvory\config\bootstrap-token.txt
```

1. Öffnen Sie in der Konsole [[ui:navStart]] und erweitern Sie [[ui:welcomeOwner]].
2. Fügen Sie den Schlüssel in das Feld [[ui:welcomeRecovery]] ein.
3. Geben Sie den Namen des Besitzers und ein Passwort mit mindestens 12 Zeichen ein und wählen Sie dann [[ui:welcomeCreate]].
4. Melden Sie sich mit dem neuen Namen und Passwort in der Karte [[ui:connection]] an.

Halten Sie den Wiederherstellungsschlüssel geheim und löschen Sie die Datei nicht. Installations- und Update-Tools verwenden sie. Siehe [Sicherheit](../operate/security).

Der Besitzer ist ein Administrator und kann in das Repository `releases` schreiben. Um ein weiteres Repository zu erstellen, öffnen Sie [[ui:administration]], erweitern Sie [[ui:manageGrants]], geben Sie der Gruppe `arkvory-owners` den Zugriff [[ui:write]] auf einen neuen Namen, etwa `builds`, und wählen Sie [[ui:saveGrant]]. Ein Repository-Name besteht aus lateinischen Kleinbuchstaben, Ziffern, `-` und `_` und hat höchstens 64 Zeichen.

## Schritt 4: Schlüssel für Ihre Tools erstellen {#step-4-create-a-key-for-your-tools}

Skripte und der Kommandozeilen-Client benötigen einen Schlüssel. Verwenden Sie für einen ersten Test ein persönliches Zugriffstoken:

1. Erweitern Sie [[ui:personalAccessTokens]] in der Karte [[ui:connection]].
2. Geben Sie einen [[ui:tokenName]] ein, setzen Sie [[ui:tokenScope]] auf [[ui:tokenScopeReadWrite]] und wählen Sie [[ui:generateToken]].
3. Kopieren Sie das Token. Es wird nur einmal angezeigt.
4. Speichern Sie es in einer Datei, die nur Sie lesen können, zum Beispiel `~/.arkvory/key`.

Erstellen Sie für CI/CD und Deployment-Agents stattdessen ein Dienstkonto mit eigenem Schlüssel. Siehe [Konten und Zugriff](../use/accounts).

## Schritt 5: Upload und Download mit curl {#step-5-upload-and-download-with-curl}

Ein Dateipfad in einem Repository funktioniert wie eine Datei auf einem Webserver. `PUT` speichert eine neue Version des Pfads, `GET` liefert die aktuelle Version.

```bash
export ARKVORY_KEY="$(cat ~/.arkvory/key)"

# Upload
curl -T ./Setup.exe -H "Authorization: Bearer $ARKVORY_KEY" \
  http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe

# Download
curl -fL -H "Authorization: Bearer $ARKVORY_KEY" -o Setup-copy.exe \
  http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe
```

Der Upload gibt JSON in dieser Form zurück:

```json
{
  "path": "builds/game/1.0/Setup.exe",
  "revision": 1,
  "created": true,
  "artifact": { "id": "…", "size": "1048576", "sha256": "…" }
}
```

Laden Sie dieselben Bytes erneut hoch, lautet die Antwort `200` mit `"created": false`, und es entsteht keine neue Version. Eine neue Datei erhält den Status `201`.

In PowerShell:

```powershell
$headers = @{ Authorization = "Bearer $env:ARKVORY_KEY" }
$url = 'http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe'
Invoke-WebRequest -Method Put -InFile .\Setup.exe -Headers $headers -Uri $url
Invoke-WebRequest -Headers $headers -Uri $url -OutFile .\Setup-copy.exe
```

Eine `PUT`-Anfrage muss innerhalb von 30 Minuten abgeschlossen sein. Verwenden Sie bei sehr großen Dateien oder langsamen Netzwerken den Kommandozeilen-Client: Er lädt in Teilen hoch und setzt nach einem Fehler fort. Siehe [Raw-Dateien](../protocols/raw-files).

## Schritt 6: Kommandozeilen-Client verwenden {#step-6-use-the-command-line-client}

Installieren Sie `arkvoryctl` auf Ihrem eigenen Rechner: `Arkvory-CLI-Setup-x64.exe` unter Windows, `Arkvory-CLI-amd64.deb` oder `Arkvory-CLI-x86_64.rpm` unter Linux. Auf einem CI-Rechner mit Node.js 24 funktioniert auch `arkvoryctl.mjs`.

```bash
arkvoryctl profile add local --server http://127.0.0.1:8080 --token-file ~/.arkvory/key
arkvoryctl doctor
arkvoryctl put ./Setup.exe builds/game/1.0/Setup.exe
arkvoryctl get builds/game/1.0/Setup.exe ./Setup-copy.exe
```

Das Profil verwendet das Repository `releases`, sofern Sie nicht `--repository` angeben. Wird eine Übertragung unterbrochen, führen Sie denselben Befehl erneut aus: Er setzt an der Abbruchstelle fort und prüft am Ende den SHA-256-Wert. Der Client akzeptiert unverschlüsseltes HTTP nur für den lokalen Rechner; verwenden Sie für einen entfernten Server HTTPS. Siehe [Kommandozeilen-Client](../protocols/cli).

## Nächste Schritte {#next-steps}

- [Konzepte](./concepts): Repositorys, Artefakte, Stufen und Schlüssel.
- [HTTPS](../install/https): den Server sicher für andere Rechner öffnen.
- [Backups](../operate/backups): einen Backup-Speicher verbinden, bevor Sie wichtige Daten ablegen.
- [Pakete](../use/packages) und [Hochstufung](../use/promotion): versionierte Builds für das Deployment.
- [Die Webkonsole](./console): eine Tour durch alle Bereiche.
