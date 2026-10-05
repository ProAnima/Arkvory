---
title: Git LFS
description: 'Speichern Sie die großen Dateien eines Git-Repositorys in Arkvory und sperren Sie Binär-Assets, zum Beispiel für Unity- und Unreal-Projekte.'
---

# Git LFS

Jedes Arkvory-Repository ist ein Git-LFS-Server. Ihr Git-Repository bleibt, wo es ist, zum Beispiel auf GitHub, GitLab oder Gitea. Nur die großen Dateien, die Git LFS verfolgt, und die Dateisperren gehen an Arkvory. LFS-Objekte sind gewöhnliche Artefakte, daher gelten Repository-Berechtigungen, Kontingente, SHA-256-Prüfungen, Backups und Spiegel für sie.

## Ein Git-Repository einrichten {#set-up}

Sie brauchen die Adresse des Servers mit HTTPS (siehe [HTTPS](../install/https)), ein Arkvory-Repository, zum Beispiel `games`, und einen Schlüssel (siehe [Konten und Schlüssel](../use/accounts)).

1. Installieren Sie Git LFS auf jedem Rechner, der das Repository verwendet, und führen Sie `git lfs install` einmal pro Benutzer aus.
2. Erstellen Sie die Datei `.lfsconfig` im Stammverzeichnis des Git-Repositorys und committen Sie sie. Sie sorgt dafür, dass das ganze Team Arkvory verwendet:

```ini
[lfs]
	url = https://arkvory.example/lfs/games
```

3. Verfolgen Sie die Dateimuster. Dadurch wird `.gitattributes` geschrieben, das Sie ebenfalls committen:

```bash
git lfs track "*.psd" "*.fbx" "*.wav" "*.uasset" "*.umap"
git add .gitattributes .lfsconfig
```

4. Committen und pushen Sie wie gewohnt. Die erste Anfrage fragt nach Anmeldedaten: siehe [Anmelden](#sign-in).

Die LFS-Adresse eines Repositorys ist immer `https://<host>/lfs/<repository>`.

Um Dateien zu verschieben, die bereits in LFS auf einem anderen Server liegen, laden Sie zuerst alle Objekte vom alten Server herunter, wechseln Sie dann `lfs.url` und laden Sie sie hoch:

```bash
git lfs fetch --all origin
git config lfs.url https://arkvory.example/lfs/games
git lfs push --all origin
```

## Anmelden {#sign-in}

Arkvory nimmt seinen Schlüssel als Passwort der HTTP-Basic-Authentifizierung. Der Benutzername wird nicht geprüft: Verwenden Sie einen beliebigen Namen. Der Schlüssel kann auch als Bearer-Token kommen.

Git fragt nach Benutzername und Passwort über seinen Credential-Helper, wenn der Server zum ersten Mal `401` antwortet. Der Helper speichert sie: Git Credential Manager unter Windows und macOS, `credential.helper store` oder `cache` unter Linux.

| Wer              | Schlüssel                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| Entwickler       | Ein persönliches Zugriffstoken. Scope `read-write` für Push und Sperren, Scope `read` nur für Clone und Pull. |
| Build-Server, CI | Ein Dienstschlüssel mit den Aktionen in [Berechtigungen](#permissions)                                        |

Git speichert Anmeldedaten pro Host. Der Schlüssel für Arkvory ersetzt nicht die Anmeldedaten für den Host Ihres Git-Repositorys, zum Beispiel GitHub.

Auf einem CI-Runner ohne Credential-Helper legen Sie den Schlüssel in die lokale Konfiguration des Checkouts. Der Schlüssel liegt dann nur in `.git/config` dieses Arbeitsbereichs, niemals in `.lfsconfig`:

```bash
git config lfs.url "https://ci:${ARKVORY_KEY}@arkvory.example/lfs/games"
```

Committen Sie keinen Schlüssel. Geben Sie ihn nicht in Protokollen aus. Entfernen Sie den Arbeitsbereich nach dem Job.

## Tägliche Arbeit {#daily-work}

Git LFS funktioniert wie mit jedem LFS-Server. Die Befehle, die Sie verwenden:

| Befehl                                  | Wirkung                                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `git push`                              | Lädt neue LFS-Objekte nach Arkvory hoch, bevor es die Commits pusht                             |
| `git clone`, `git pull`, `git checkout` | Laden die Objekte herunter, die der Arbeitsbaum braucht                                         |
| `git lfs fetch --all`                   | Lädt die Objekte aller Branches herunter                                                        |
| `git lfs ls-files`                      | Listet verfolgte Dateien und ihre kurzen IDs auf                                                |
| `git lfs push --all origin`             | Lädt alle lokalen Objekte erneut hoch. Objekte, die Arkvory bereits hat, werden nicht gesendet. |

Ein Objekt, das Arkvory bereits hat, mit derselben ID und Größe, wird nicht erneut gesendet. Ein nach einer Unterbrechung wiederholter Push sendet nur, was fehlt.

## Dateien sperren {#locks}

Binär-Assets lassen sich nicht zusammenführen. Eine Sperre teilt dem Team mit, dass eine Person eine Datei bearbeitet. Sperren gehören zum Arkvory-Repository, nicht zu einem Branch.

```bash
git lfs lock Content/Maps/Level01.umap
git lfs locks
git lfs unlock Content/Maps/Level01.umap
```

- Ein zweites `git lfs lock` auf demselben Pfad schlägt mit „already created lock“ fehl und nennt den Besitzer.
- Der Besitzer wird durch den Namen des Benutzers oder des Dienstkontos angezeigt, der die Sperre gesetzt hat. Ein Dateischlüssel zeigt seine ID.
- Nur der Besitzer entsperrt eine Datei. `git lfs unlock --force` bei einer Sperre einer anderen Person benötigt einen Dienstschlüssel mit der Aktion `artifact.delete` im Repository. Persönliche Token können keine Sperren brechen.
- Ein Sperrpfad ist ein Pfad des Git-Repositorys: bis zu 1024 Zeichen, mit `/` zwischen Ordnern und ohne leere Segmente, `.` oder `..`, einen Backslash oder einen Doppelpunkt.
- `git lfs locks` zeigt 100 Sperren pro Seite.

Aktivieren Sie die Prüfung vor dem Push, damit Git das Pushen von Änderungen an Dateien verweigert, die andere gesperrt haben. Die Einstellung gilt pro Serveradresse:

```bash
git config lfs.https://arkvory.example/lfs/games.locksverify true
```

Markieren Sie die Dateitypen, die vor der Bearbeitung gesperrt werden sollen. Git LFS hält sie dann schreibgeschützt, bis Sie sie sperren:

```bash
git lfs track --lockable "*.umap" "*.uasset"
```

Die Sperrprüfung beim Push benötigt Schreibzugriff, daher kann ein schreibgeschütztes Token sie nicht verwenden. Verwenden Sie `git lfs locks`, um Sperren aufzulisten, was der Lesezugriff erlaubt.

## Tipps für Unity und Unreal {#game-engines}

- Unity: Behalten Sie die Text-Assets (`.unity`, `.prefab`, `.asset`) in Git und stellen Sie die Asset-Serialisierung auf Force Text ein. Verfolgen Sie die großen Binärdateien in LFS, zum Beispiel `*.png`, `*.psd`, `*.fbx`, `*.wav`, `*.mp4`, `*.exr`. Textdateien, die Sie in LFS verfolgen, werden ebenfalls akzeptiert.
- Unreal Engine: Verfolgen Sie `*.uasset`, `*.umap` und die großen Quelldateien und markieren Sie `*.uasset` und `*.umap` als sperrbar.
- Editor-Integrationen, die die LFS-Sperrbefehle aufrufen, verwenden das Standard-Dateisperrprotokoll von Git LFS. Arkvory ist mit den Kommandozeilen-Clients `git` und `git-lfs` getestet.
- Legen Sie sich ändernde Build-Ausgaben von mehreren zehn Gigabyte nicht in LFS ab. Laden Sie sie als Artefakte oder [Raw-Dateien](./raw-files) mit [`arkvoryctl`](./cli) hoch. LFS-Objekte werden nie durch die Aufbewahrung gelöscht, daher bleiben sie für immer.
- Großer wiederverwendbarer Code oder Werkzeuge, die Unity-Projekte gemeinsam nutzen, werden besser über [Unity-Pakete](./unity-npm) bereitgestellt.

## Was gespeichert wird {#what-is-stored}

- Ein LFS-Objekt ist ein Artefakt im Arkvory-Repository. Sein Name und seine Identität sind der SHA-256 seines Inhalts (die `oid` von LFS), und es trägt das Label `lfs`. Sie sehen diese Artefakte in der Konsole unter [[ui:catalog]].
- Arkvory prüft die Größe und den SHA-256, während es das Objekt empfängt. Wenn sie von der `oid` abweichen, schlägt der Upload mit `422` fehl und nichts wird gespeichert.
- Ein Objekt gehört zum Repository. Zwei Arkvory-Repositorys halten ihre eigenen Kopien derselben Datei.
- Die Aufbewahrung entfernt nie LFS-Objekte, weil der Server nicht sehen kann, welche Commits sie noch brauchen. Es gibt keinen Befehl zum Löschen eines LFS-Objekts. Planen Sie das Kontingent des Repositorys für die gesamte Historie der Assets.
- Sperren sind Zeilen in der Datenbank. Backups enthalten sie.

## Berechtigungen {#permissions}

Persönliche Token und Dateischlüssel erhalten Lese- oder Schreibzugriff auf das Repository. Dienstschlüssel erhalten exakte Aktionen.

| Vorgang                                                | Aktionen des Dienstschlüssels | Persönliches Token oder Dateischlüssel   |
| ------------------------------------------------------ | ----------------------------- | ---------------------------------------- |
| Download (`clone`, `fetch`, `pull`)                    | `content.read`                | Lesezugriff                              |
| Upload (`push`)                                        | `upload.create`               | Schreibzugriff, Token-Scope `read-write` |
| Sperren auflisten                                      | `artifact.list`               | Lesezugriff                              |
| Eigene Sperren erstellen, prüfen und freigeben         | `upload.create`               | Schreibzugriff, Token-Scope `read-write` |
| Eine Sperre einer anderen Person freigeben (`--force`) | `artifact.delete`             | Nicht möglich                            |

Ein CI-Job, der pusht und pullt, benötigt `content.read`, `upload.create` und `artifact.list`. Ein Schlüssel, der nur pushen darf, erfährt trotzdem, dass ein Objekt existiert, damit er es nicht zweimal hochlädt.

Ein schreibgeschütztes persönliches Token kann klonen und pullen, obwohl die Anforderung der Download-Liste ein `POST` ist. Es kann nicht pushen oder sperren. Ein Spiegel und ein Lese-Gateway werden in [Spiegel und Lese-Gateways](#mirrors-and-read-gateways) behandelt.

## Wie die Übertragung funktioniert {#how-it-works}

Sie brauchen diese Details nicht für die tägliche Arbeit. Sie helfen, wenn Sie einen Proxy oder eine Firewall debuggen.

1. Git LFS sendet ein `POST /lfs/<repository>/objects/batch` mit dem Vorgang (`download` oder `upload`) und der Liste der Objekte. Bis zu 1000 Objekte pro Anfrage. Git LFS sendet standardmäßig höchstens 100.
2. Arkvory antwortet mit einem Link für jedes Objekt, das übertragen werden muss, gültig für eine Stunde. Bei einem Upload lässt es die Objekte weg, die es bereits hat.
3. Git LFS sendet jedes Objekt mit `PUT` oder lädt es mit `GET` von `/lfs/<repository>/objects/<oid>` herunter. Die Anfrage trägt denselben Schlüssel wie die Batch-Anfrage.
4. Ein `PUT` benötigt einen `Content-Length`-Header. Ein chunked Upload wird mit `422` abgelehnt.

Unterstützt:

| Element             | Wert                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Übertragungsadapter | nur `basic`                                                                                                       |
| Hash-Algorithmus    | nur `sha256`. Ein Client, der einen anderen anfordert, erhält `409`.                                              |
| Authentifizierung   | Basic (Schlüssel als Passwort) oder Bearer                                                                        |
| Download            | `GET` und `HEAD` mit `Range`-Anfragen                                                                             |
| Medientyp           | `application/vnd.git-lfs+json` für die JSON-Anfragen. Objektkörper jedes Medientyps werden als Bytes gespeichert. |

Fehler sind JSON-Dokumente mit `message` und `request_id`. Geben Sie die `request_id` an, wenn Sie Ihren Administrator um Hilfe bitten.

Die Links zeigen auf die Adresse, mit der der Client den Server erreicht hat. Wenn ein Reverse-Proxy HTTPS beendet, muss er den `Host`-Header weitergeben und `X-Forwarded-Proto: https` senden, wie im nginx-Beispiel der Installation, damit die Links `https` verwenden. Arkvory legt den Schlüssel nur dann in einen Link, wenn der Link `https` ist oder auf den lokalen Rechner zeigt. Über einfaches HTTP zu einem anderen Host kann Git den Schlüssel nicht mit dem Objekt senden und die Übertragung schlägt fehl.

## Große Dateien und Fortsetzen {#large-files}

- Git LFS sendet jedes Objekt in einer `PUT`-Anfrage. Nach einem Fehler beginnt es das Objekt wieder beim ersten Byte. Der `tus`-Adapter, der innerhalb eines Objekts fortsetzt, wird nicht unterstützt.
- Eine Upload-Anfrage muss innerhalb von 30 Minuten abgeschlossen sein und darf nicht länger als 30 Sekunden pausieren (`ARKVORY_UPLOAD_DEADLINE_MS`, `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`). Eine Datei von vielen Gigabyte braucht ein schnelles und stabiles Netzwerk. Verwenden Sie für größere Dateien [`arkvoryctl`](./cli), das in Teilen hochlädt.
- Downloads akzeptieren `Range`-Anfragen.
- Ein Objekt kann so groß sein wie die maximale Objektgröße der Installation (`ARKVORY_MAX_OBJECT_BYTES`, standardmäßig etwa 10 TiB). Ein größeres Objekt wird in der Batch-Antwort mit `422` abgelehnt.

Standardmäßig führt der Server 2 Uploads gleichzeitig und 1 pro Schlüssel aus (`ARKVORY_MAX_UPLOADS`, `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`). Git LFS sendet standardmäßig 8 Objekte gleichzeitig. Die anderen Uploads warten auf einen freien Platz und geben nach 20 Sekunden (`ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS`) mit `503` auf. Git LFS wiederholt ein fehlgeschlagenes Objekt einige Male, aber ein Push großer Dateien ist mit weniger parallelen Übertragungen zuverlässiger:

```bash
git config lfs.concurrenttransfers 1
```

Sie können den Administrator auch bitten, die Limits zu erhöhen. Sie sind in [Umgebungsvariablen](../reference/environment#transfers-and-bandwidth) beschrieben.

## Spiegel und Lese-Gateways {#mirrors-and-read-gateways}

| Ort                                      | Klonen und Abrufen                                                                       | Push und Sperren                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Hauptserver                              | Ja                                                                                       | Ja                                                                                           |
| [Spiegel](../operate/mirrors)            | Ja. Der Spiegel hat die Objekte seiner Quelle, richten Sie `lfs.url` also auf ihn.       | Abgelehnt (`409`, Grund `mirror_read_only`). Sperren werden nicht auf einen Spiegel kopiert. |
| [Lese-Gateway](../operate/read-gateways) | Nein. Die Download-Liste ist eine `POST`-Anfrage, die ein Lese-Gateway nicht akzeptiert. | Nein                                                                                         |

Richten Sie `lfs.url` immer auf den Hauptserver oder auf einen Spiegel für schreibgeschützte Rechner.

## Fehlerbehebung {#troubleshooting}

| Meldung oder Symptom                                           | Ursache                                                                                       | Vorgehen                                                                                                                    |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `401` oder ein Autorisierungsfehler                            | Kein Schlüssel, ein falscher Schlüssel oder ein abgelaufenes oder widerrufenes Token          | Entfernen Sie die gespeicherten Anmeldedaten in Ihrem Credential-Manager und pushen Sie erneut mit einem gültigen Schlüssel |
| `403` mit „Read-only personal access token“                    | Das Token hat den Scope `read`                                                                | Erstellen Sie ein Token mit dem Scope `read-write`                                                                          |
| `403`                                                          | Dem Schlüssel fehlt der Zugriff für diesen Vorgang, oder das Repository ist ihm nicht gewährt | Fügen Sie die Aktionen aus [Berechtigungen](#permissions) hinzu                                                             |
| `Lock failed: already created lock`                            | Jemand hält die Sperre                                                                        | Bitten Sie den Besitzer zu entsperren oder einen Administrator, `--force` zu verwenden                                      |
| `422` „Object exceeds the maximum size“                        | Das Objekt ist größer als das Limit der Installation                                          | Verwenden Sie `arkvoryctl` für solche Dateien                                                                               |
| `422` beim Upload                                              | Der Inhalt stimmt nicht mit der `oid` überein; die Datei hat sich während des Push geändert   | Führen Sie `git lfs push` erneut aus                                                                                        |
| `503` oder `Retry-After`                                       | Zu viele Übertragungen gleichzeitig                                                           | Verringern Sie `lfs.concurrenttransfers` und wiederholen Sie                                                                |
| `507`                                                          | Das Repository-Kontingent oder die Kapazität der Installation ist erreicht                    | Geben Sie Speicher frei oder bitten Sie um ein größeres Kontingent                                                          |
| `409` beim Upload                                              | Das Repository ist ein Spiegel                                                                | Pushen Sie zum Hauptserver                                                                                                  |
| Dateien im Arbeitsbaum sind kleine Textdateien mit einer `oid` | Die Objekte wurden nicht heruntergeladen, oder `git lfs install` wurde nicht ausgeführt       | Führen Sie `git lfs install` und dann `git lfs pull` aus                                                                    |
| `x509: certificate signed by unknown authority`                | Der Client vertraut dem Zertifikat nicht                                                      | Fügen Sie die Zertifizierungsstelle zum Truststore des Systems hinzu oder setzen Sie `http.sslCAInfo`                       |

Schalten Sie die TLS-Prüfung nicht aus (`GIT_SSL_NO_VERIFY`): Der Schlüssel wird bei jeder Anfrage gesendet.

## Verwandte Seiten {#related-pages}

- [Clients und Protokolle](./index)
- [Konten und Schlüssel](../use/accounts)
- [HTTPS](../install/https)
- [Spiegel](../operate/mirrors)
- [Unity- und npm-Pakete](./unity-npm)
