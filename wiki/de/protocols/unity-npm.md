---
title: Unity- und npm-Pakete
description: 'Verwenden Sie ein Repository als Scoped Registry für den Unity Package Manager und als npm-Registry zum Veröffentlichen und Installieren von Paketen.'
---

# Unity- und npm-Pakete

Jedes Arkvory-Repository ist eine npm-kompatible Registry unter `https://<host>/npm/<repository>/`. Der Unity Package Manager liest sie als Scoped Registry, und `npm` veröffentlicht in sie und installiert aus ihr. Studios verwenden sie für SDKs, Werkzeuge und Module, die mehrere Unity-Projekte gemeinsam nutzen, jeweils mit eigener Version.

Paket-Tarballs sind gewöhnliche Artefakte, daher gelten Repository-Berechtigungen, Kontingente, SHA-256-Prüfungen, Backups und Spiegel für sie.

## Bevor Sie beginnen {#before-you-start}

Sie brauchen:

- Die Serveradresse mit HTTPS (siehe [HTTPS](../install/https)).
- Ein Repository, zum Beispiel `games`. Seine Registry-Adresse ist `https://arkvory.example/npm/games/`.
- Einen Schlüssel. Entwickler verwenden ein persönliches Zugriffstoken mit dem Scope `read`. Build-Agenten, die veröffentlichen, verwenden ein persönliches Token mit dem Scope `read-write` oder einen Dienstschlüssel. Siehe [Konten und Schlüssel](../use/accounts).

Arkvory sendet die Adresse jedes Tarballs in den Paketdaten an den Client. Die Adresse wird aus dem Hostnamen gebildet, mit dem der Client gekommen ist. Wenn ein Reverse-Proxy HTTPS beendet, muss er den `Host`-Header weitergeben und `X-Forwarded-Proto: https` senden, wie im nginx-Beispiel der Installation. Andernfalls erhält der Client `http://`-Adressen der Tarballs.

## Die Registry zu einem Unity-Projekt hinzufügen {#unity-manifest}

1. Öffnen Sie `Packages/manifest.json` des Projekts und fügen Sie eine Scoped Registry hinzu:

```json
{
  "scopedRegistries": [
    {
      "name": "Arkvory",
      "url": "https://arkvory.example/npm/games/",
      "scopes": ["com.proanima"]
    }
  ],
  "dependencies": {
    "com.proanima.tools": "1.2.0"
  }
}
```

2. Geben Sie Unity den Schlüssel. Legen Sie ihn nicht in das Projekt. Erstellen Sie die Datei `.upmconfig.toml` in Ihrem Benutzerordner (`%USERPROFILE%\.upmconfig.toml` unter Windows, `~/.upmconfig.toml` unter macOS und Linux):

```toml
[npmAuth."https://arkvory.example/npm/games/"]
token = "<your Arkvory key>"
alwaysAuth = true
```

3. Starten Sie Unity neu. Öffnen Sie im Package-Manager-Fenster **My Registries**, um die Pakete der Registry zu sehen.

Hinweise:

- `scopes` sind Präfixe von Paketnamen. Unity bezieht die Pakete, deren Namen mit einem Scope beginnen, von Arkvory und alle anderen Pakete aus der Unity-Registry.
- Die Adresse in `.upmconfig.toml` muss dieselbe sein wie `url` im Manifest, einschließlich des abschließenden Schrägstrichs.
- `alwaysAuth = true` ist erforderlich. Die Registry sendet keine Login-Aufforderung, daher muss Unity das Token bei jeder Anfrage senden.
- Unity-Paketnamen sind umgekehrte Domainnamen in Kleinbuchstaben, wie `com.company.package`. Unity unterstützt keine Namen mit `@scope/`.

Committen Sie `Packages/manifest.json` mit dem Projekt. Jeder Entwickler behält seine eigene `.upmconfig.toml`.

## Ein Paket veröffentlichen {#publish}

Ein Paket ist ein Ordner mit einer `package.json` an der Spitze. Veröffentlichen Sie es mit `npm`.

1. Erstellen Sie im Ordner des Pakets eine Datei `.npmrc`:

```ini
registry=https://arkvory.example/npm/games/
//arkvory.example/npm/games/:_authToken=${ARKVORY_TOKEN}
```

2. Setzen Sie den Schlüssel in der Umgebung und veröffentlichen Sie:

```bash
export ARKVORY_TOKEN="$(cat ~/.arkvory/key)"
npm publish
```

```powershell
$env:ARKVORY_TOKEN = (Get-Content C:\Private\arkvory.key -Raw).Trim()
npm publish
```

Die Zeile mit `_authToken` muss mit der Adresse der Registry ohne `https:` beginnen. Halten Sie den Schlüssel aus `.npmrc` heraus: npm ersetzt `${ARKVORY_TOKEN}` aus der Umgebung.

Statt der `registry`-Zeile in `.npmrc` können Sie die Registry in der `package.json` des Pakets festlegen:

```json
{
  "name": "com.proanima.tools",
  "version": "1.2.0",
  "publishConfig": { "registry": "https://arkvory.example/npm/games/" }
}
```

Was die Registry prüft:

- **Name und Version.** `name` und `version` in der `package.json` innerhalb des Tarballs müssen mit den veröffentlichten übereinstimmen. Die Version folgt SemVer 2.0.0, zum Beispiel `1.2.0` oder `2.0.0-beta.1`. Die Registry liest die Daten der Version aus dieser Datei, nicht aus dem JSON, das der Client sendet.
- **Prüfsummen.** Die Länge, `shasum` und `integrity`, die der Client angibt, müssen mit den Bytes übereinstimmen. Eine Abweichung gibt `422 integrity_mismatch` zurück.
- **Das Tarball.** Es muss `<folder>/package.json` enthalten, so wie `npm pack` es erzeugt. Eine zweite `package.json` im Archiv wird abgelehnt, weil npm und die Registry unterschiedliche Dateien lesen könnten.
- **Eine Version ist unveränderlich.** Dasselbe Tarball, erneut veröffentlicht, ist erfolgreich und ändert nichts (`200`). Anderer Inhalt für eine bestehende Version gibt `409` mit dem Grund `version_exists` zurück. Veröffentlichen Sie die Korrektur als nächste Version.

`npm publish` liest das Paket aus der Registry, bevor es veröffentlicht, geben Sie einem Veröffentlichungsschlüssel daher `content.read` und `artifact.list` sowie `upload.create`. Siehe [Berechtigungen](#permissions).

Die Version ist verfügbar, sobald `npm publish` zurückkehrt. Das Tarball einer Version wird als Artefakt `<name>-<version>.tgz` mit dem Label `npm` gespeichert. Bei einem Namen mit Scope wird `@team/util` zu `util-<version>.tgz`.

## Pakete installieren {#install}

Fügen Sie in Unity die Abhängigkeit im Manifest hinzu oder wählen Sie das Paket im Package-Manager-Fenster unter **My Registries**.

Legen Sie für npm die Registry in der `.npmrc` des Projekts oder Ihres Benutzers fest. Eine Registry für einen Scope ist die übliche Wahl, weil Arkvory Anfragen nicht an die öffentliche npm-Registry weiterleitet:

```ini
@team:registry=https://arkvory.example/npm/games/
//arkvory.example/npm/games/:_authToken=${ARKVORY_TOKEN}
```

```bash
npm install @team/util
npm view @team/util versions
npm search tools
```

Wenn Sie `registry=` für das ganze Projekt auf Arkvory setzen, sucht npm dort nach jedem Paket, auch nach öffentlichen wie `lodash`, und schlägt mit `404` fehl. Verwenden Sie eine Scoped Registry oder ein Projekt, das nur Ihre eigenen Pakete enthält.

npm prüft `dist.integrity`, während es installiert, und schreibt die Registry-Adresse in `package-lock.json`.

## Versionen und Dist-Tags {#versions-and-tags}

Ein Dist-Tag ist ein beweglicher Name für eine Version. `npm publish` setzt `latest` auf die neue Version. Andere Tags helfen, Release-Kanäle zu trennen.

```bash
npm publish --tag beta
npm dist-tag add com.proanima.tools@1.3.0 latest
npm dist-tag ls com.proanima.tools
npm dist-tag rm com.proanima.tools beta
```

```bash
npm install com.proanima.tools@beta
```

| Regel                 | Wert                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------- |
| Tag-Name              | Beginnt mit einem Buchstaben. Buchstaben, Ziffern, `.`, `_` und `-`. Bis zu 64 Zeichen. |
| Verbotene Tags        | Ein Name, der wie eine Version aussieht (`v1`, `v2.0`), sowie `x` oder `X`              |
| `latest`              | Zeigt immer auf eine Version. Er kann verschoben, nicht entfernt werden (`409`).        |
| Einen Tag verschieben | `npm dist-tag add` oder Veröffentlichen mit `--tag`. Die neue Version muss existieren.  |

Ein Tag ist nur ein Name: Er löscht oder verbirgt keine anderen Versionen.

Es gibt keine Möglichkeit, eine veröffentlichte Version zu entfernen. Siehe [Nicht unterstützt](#not-supported).

## Suche {#search}

Die Liste **My Registries** in Unity und `npm search` verwenden die Suchadresse `/-/v1/search`. Die Suche findet Pakete, deren Name oder Beschreibung den Text enthält, unabhängig von der Groß-/Kleinschreibung, sowie Pakete, die den Text als ganzes Schlüsselwort haben. Ohne Text listet sie alle Pakete auf.

- Sie gibt eine Zeile pro Paket zurück: die Version mit dem Tag `latest` oder andernfalls die neueste Version.
- Die Ergebnisse sind nach Namen sortiert. Es gibt kein Ranking nach Beliebtheit.
- `size` ist standardmäßig 20 und höchstens 250. `from` ist der Offset.

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_TOKEN" \
  "https://arkvory.example/npm/games/-/v1/search?text=tools&from=0&size=20"
```

Um ein Paket direkt zu lesen, fordern Sie seinen Namen an. `@scope/name` kann als `@scope%2fname` gesendet werden:

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_TOKEN" https://arkvory.example/npm/games/com.proanima.tools
```

Die Antwort listet jede Version mit dem Inhalt ihrer `package.json` (einschließlich der Felder `unity` und `displayName`, die Unity liest), die Dist-Tags und die Veröffentlichungszeiten auf. `dist` enthält `tarball`, `shasum` (SHA-1) und `integrity` (SHA-512).

## Namen und Limits {#limits}

| Element                               | Regel                                                                                                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paketname                             | Kleinbuchstaben, Ziffern, `.`, `_`, `~` und `-`, beginnend mit einem Buchstaben oder einer Ziffer. Bis zu 214 Zeichen. `@scope/name` ist für npm erlaubt.                                    |
| Version                               | SemVer 2.0.0, bis zu 256 Zeichen                                                                                                                                                             |
| `package.json` im Tarball             | Bis zu 256 KiB. Die Daten aller Versionen kommen in einer Antwort, halten Sie sie daher klein.                                                                                               |
| Tarball                               | Bis zur maximalen Objektgröße der Installation, `ARKVORY_MAX_OBJECT_BYTES` (standardmäßig etwa 10 TiB). Ein Archiv, das sich um mehr als das 100-Fache plus 64 MiB entpackt, wird abgelehnt. |
| Der Rest der Veröffentlichungsanfrage | Bis zu 8 MiB JSON, höchstens 64 Ebenen verschachtelt. Das Tarball wird als Stream gelesen und nicht im Speicher gehalten.                                                                    |
| Eine Veröffentlichungsanfrage         | Muss innerhalb von 30 Minuten abgeschlossen sein und darf nicht länger als 30 Sekunden pausieren (`ARKVORY_UPLOAD_DEADLINE_MS`, `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`)                            |
| Uploads gleichzeitig                  | Standardmäßig 2 pro Server und 1 pro Schlüssel. Eine wartende Anfrage gibt nach 20 Sekunden auf.                                                                                             |
| Suchtext                              | Bis zu 256 Zeichen                                                                                                                                                                           |

`npm publish` ist eine Anfrage und beginnt nach einem Fehler wieder beim ersten Byte. Laden Sie die Datei für Pakete von vielen Gigabyte mit [`arkvoryctl`](./cli) als Artefakt oder [Raw-Datei](./raw-files) hoch. Große Binär-Assets, die sich oft ändern, gehören besser in [Git LFS](./git-lfs); behalten Sie Code und stabile Ressourcen in Paketen.

Die Limits des Servers stehen in [Umgebungsvariablen](../reference/environment#transfers-and-bandwidth).

## Berechtigungen {#permissions}

Persönliche Token und Dateischlüssel erhalten Lese- oder Schreibzugriff auf das Repository. Dienstschlüssel erhalten exakte Aktionen.

| Vorgang                                                     | Aktionen des Dienstschlüssels | Persönliches Token oder Dateischlüssel   |
| ----------------------------------------------------------- | ----------------------------- | ---------------------------------------- |
| Installieren: ein Paket lesen und ein Tarball herunterladen | `content.read`                | Lesezugriff                              |
| Suchen, Dist-Tags auflisten                                 | `artifact.list`               | Lesezugriff                              |
| Veröffentlichen, Dist-Tags hinzufügen und entfernen         | `upload.create`               | Schreibzugriff, Token-Scope `read-write` |

Ein Entwickler, der nur Pakete installiert, benötigt ein Token mit dem Scope `read`. Ein Build-Agent, der veröffentlicht, benötigt `upload.create`, `content.read` und `artifact.list`. Niemand kann eine veröffentlichte Version löschen.

## Lese-Gateways und Spiegel {#read-gateways-and-mirrors}

- Ein [Lese-Gateway](../operate/read-gateways) bedient Installation und Suche, weil dies `GET`-Anfragen sind. Eine Veröffentlichung erhält `405`.
- Ein [Spiegel](../operate/mirrors) hält die Versionen und Tags seiner Quelle. Installation und Suche funktionieren. Veröffentlichen wird mit `409` und dem Grund `mirror_read_only` abgelehnt. Die Tarball-Adressen in den Daten eines Spiegels zeigen auf den Spiegel.

Um einen Spiegel in Unity zu verwenden, setzen Sie die Adresse des Spiegels in `url` und seinen Schlüssel in `.upmconfig.toml`.

## Nicht unterstützt {#not-supported}

- Das Entfernen einer Version (`npm unpublish`). Projekte binden Versionen, und ein Entfernen würde ihre Builds brechen. Veröffentlichen Sie stattdessen eine korrigierte Version und verschieben Sie den Tag.
- `npm deprecate`, `npm login`, `npm owner`, `npm access` und andere Verwaltungsbefehle. Anfragen, die Daten auf anderen Pfaden ändern, antworten mit `405` und „This registry supports publish, install and dist-tags“. Erstellen Sie stattdessen ein Token in der Konsole und legen Sie es in `.npmrc` statt `npm login` ab.
- Die Liste aller Pakete unter `/-/all` und `npm audit`.
- Ein Proxy zu den öffentlichen Registrys. Arkvory speichert Ihre eigenen Pakete. Pakete von npmjs.com oder der Unity-Registry werden von dort geholt.
- Ein Ranking der Suchergebnisse.
- Einen Abschnitt für Pakete in der Konsole. Tarballs erscheinen in [[ui:catalog]] als Artefakte mit dem Label `npm`.

## Fehlerbehebung {#troubleshooting}

Fehler haben die Form `{"error": "...", "code": "...", "request_id": "..."}`. `npm` gibt `error` aus. Geben Sie die `request_id` Ihrem Administrator, um die Anfrage im Serverprotokoll zu finden.

| Symptom                                               | Ursache                                                                                                | Vorgehen                                                                                                                                                                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401` in Unity oder npm                               | Der Client hat den Schlüssel nicht gesendet, oder der Schlüssel ist falsch, abgelaufen oder widerrufen | Prüfen Sie in Unity, dass die Adresse in `.upmconfig.toml` gleich `url` im Manifest ist und dass `alwaysAuth = true` gilt. Prüfen Sie in npm, dass die `_authToken`-Zeile mit demselben Host und Pfad wie `registry` beginnt. |
| `403` beim Veröffentlichen                            | Das Token hat den Scope `read`, oder dem Schlüssel fehlt `upload.create`                               | Verwenden Sie einen Schlüssel mit Schreibzugriff                                                                                                                                                                              |
| `404` für ein Paket                                   | Es gibt kein solches Paket in diesem Repository, oder der Schlüssel sieht das Repository nicht         | Prüfen Sie das Repository in der Adresse und den Namen. Prüfen Sie bei einem Unity-Paket, dass sein Name mit einem Scope aus `scopes` beginnt.                                                                                |
| `404` für ein öffentliches Paket                      | `registry=` zeigt für alle Pakete auf Arkvory                                                          | Verwenden Sie `@scope:registry=`                                                                                                                                                                                              |
| `409` mit `version_exists`                            | Die Version existiert mit anderem Inhalt                                                               | Veröffentlichen Sie eine neue Version                                                                                                                                                                                         |
| `409` mit `state_conflict`                            | Sie haben versucht, `latest` zu entfernen                                                              | Verschieben Sie stattdessen `latest` auf eine andere Version                                                                                                                                                                  |
| `409` mit `mirror_read_only`                          | Das Repository ist ein Spiegel                                                                         | Veröffentlichen Sie auf dem Hauptserver                                                                                                                                                                                       |
| `422` mit `integrity_mismatch`                        | Die Bytes weichen vom angegebenen `shasum` oder `integrity` ab                                         | Packen und veröffentlichen Sie erneut. Prüfen Sie, dass kein Proxy den Body ändert.                                                                                                                                           |
| `400` „package.json names another package or version“ | Die `package.json` innerhalb des Tarballs weicht vom veröffentlichten Namen oder der Version ab        | Führen Sie `npm publish` aus einem sauberen Build des Pakets aus                                                                                                                                                              |
| `400` „Only publishing a new version is supported“    | Der Befehl hat ein geändertes Paket gesendet, zum Beispiel `npm deprecate`                             | Diese Befehle werden nicht unterstützt                                                                                                                                                                                        |
| `405`                                                 | Der Befehl wird von dieser Registry nicht unterstützt                                                  | Siehe [Nicht unterstützt](#not-supported)                                                                                                                                                                                     |
| `507`                                                 | Das Repository-Kontingent oder die Kapazität der Installation ist erreicht                             | Geben Sie Speicher frei oder bitten Sie um ein größeres Kontingent                                                                                                                                                            |
| `503`                                                 | Zu viele Uploads gleichzeitig                                                                          | Warten Sie und wiederholen Sie                                                                                                                                                                                                |
| Tarball-Downloads von `http://` schlagen fehl         | Der Proxy sendet `X-Forwarded-Proto: https` nicht                                                      | Korrigieren Sie den Proxy wie in [Bevor Sie beginnen](#before-you-start) beschrieben                                                                                                                                          |

## Verwandte Seiten {#related-pages}

- [Clients und Protokolle](./index)
- [Git LFS](./git-lfs)
- [Konten und Schlüssel](../use/accounts)
- [HTTPS](../install/https)
- [Spiegel](../operate/mirrors)
