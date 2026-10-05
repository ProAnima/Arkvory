---
title: UPack-Pakete
description: 'Veröffentlichen Sie versionierte UPack-Pakete, listen und filtern Sie sie, und laden Sie eine Version nach exakter Nummer, Bereich, neuester oder Stufe herunter.'
---

# UPack-Pakete

Ein UPack-Paket ist ein ZIP-Archiv mit einem Namen und einer SemVer-Version. Arkvory registriert jede Version einmal und ändert sie nie. Ein Deployment-Job fragt nach „app, Version `^1.4`, Stufe `release`“ und erhält genau eine Datei.

## Was ein Paket ist {#what-it-is}

Ein UPack ist eine ZIP-Datei mit einer Datei `upack.json` in ihrem Wurzelverzeichnis. Das Manifest benennt das Paket:

```json
{
  "group": "acme/game",
  "name": "game-client",
  "version": "1.4.2"
}
```

| Feld      | Regel                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `name`    | Erforderlich. 1 bis 128 Buchstaben, Ziffern, `.`, `_` oder `-`                                                               |
| `version` | Erforderlich. SemVer: `1.4.2`, `1.5.0-rc.1`, `2.0.0+build.7`. Höchstens 128 Zeichen                                          |
| `group`   | Optional. Segmente aus Buchstaben, Ziffern, `.`, `_` oder `-`, getrennt durch `/`. Höchstens 128 Zeichen. Standardmäßig leer |

Andere Felder bleiben so, wie Sie sie geschrieben haben, und kommen in der Paketliste zurück. Das Manifest hat höchstens 64 KiB. Das Archiv darf keine absoluten Pfade, `..`, symbolischen Verknüpfungen, verschlüsselten Einträge oder doppelten Namen enthalten und hat höchstens 100 000 Einträge. Arkvory speichert das Archiv Byte für Byte und entpackt es nicht.

Die Identität eines Pakets ist seine Gruppe, sein Name und seine Version, verglichen ohne Beachtung der Groß-/Kleinschreibung. Innerhalb eines Repositorys gehört eine Identität endgültig zu einem Archiv. Das Registrieren eines anderen Archivs unter einer vorhandenen Identität wird mit `409 version_exists` abgelehnt. Dasselbe Archiv erneut zu registrieren ist sicher und ändert nichts. Veröffentlichen Sie eine Korrektur als neue Version.

## Ein Paket veröffentlichen {#publish}

Das Veröffentlichen ist ein Upload, gefolgt von einer Registrierung. Die Registrierung liest `upack.json` und zeichnet die Identität auf. Sie brauchen die Aktionen `package.publish` und `artifact.read`, zusätzlich zu den Upload-Aktionen. Siehe [Berechtigungen](./accounts#permissions).

### In der Konsole {#publish-console}

1. Laden Sie das Archiv in [[ui:upload]] hoch. Siehe [Uploads und Downloads](./transfers).
2. Öffnen Sie das Artefakt in [[ui:catalog]] mit [[ui:open]].
3. Wählen Sie in [[ui:metadata]] [[ui:register]]. Die Konsole zeigt den Namen und die Version, die sie registriert hat.

Das Paket erscheint jetzt in [[ui:packages]].

### Mit arkvoryctl {#publish-cli}

```bash
arkvoryctl packages publish ./build.upack --label test --state ./job-state/build.json --json
arkvoryctl packages register 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`packages publish` lädt das Archiv mit Fortsetzung hoch und registriert es. Schlägt die Registrierung nach dem Upload fehl, enthält der Fehler die `artifactId` und die Stufe `register`. Führen Sie denselben Befehl erneut aus: Der Upload wird nicht wiederholt, und zweimaliges Registrieren ist sicher. `packages register ID` registriert ein bereits hochgeladenes Artefakt. Siehe [Kommandozeile](../protocols/cli#packages-and-promotion).

### Mit der HTTP-API und dem SDK {#publish-api}

Laden Sie das Archiv wie in [Uploads und Downloads](./transfers#upload-http) hoch und registrieren Sie es dann:

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/package" \
  -H "Authorization: Bearer $ARKVORY_KEY"
```

```typescript
const entry = await releases.packages.register(uploaded.id);
console.log(entry.group, entry.name, entry.version);
```

Der Vorgang ist `registerPackage`. Ein beschädigtes Archiv, eine fehlende `upack.json` oder eine falsche Version ergeben `400 invalid_input`.

## Auflisten und filtern {#list}

Öffnen Sie in der Konsole [[ui:packages]]. Geben Sie eine [[ui:packageGroup]] oder einen [[ui:packageName]] ein: Beide stimmen exakt überein, ohne Beachtung der Groß-/Kleinschreibung. Wählen Sie eine Spalte in [[ui:sortBy]], eine Reihenfolge in [[ui:direction]] ([[ui:ascending]] oder [[ui:descending]]) und eine Gruppierung in [[ui:groupBy]] ([[ui:packageGroup]], [[ui:packageName]] oder [[ui:noGrouping]]) und wählen Sie dann [[ui:apply]]. [[ui:clearFilters]] setzt das Formular zurück. Die Tabelle zeigt die Gruppe, den Namen, die Version und die Stufen jeder Version. [[ui:open]] zeigt das Artefakt. [[ui:previousPage]] und [[ui:nextPage]] wechseln zwischen den Seiten.

```bash
arkvoryctl packages list --group acme/game --name game-client
arkvoryctl packages list --after <next from the previous answer>
```

Mit der API nimmt `listPackages` `group`, `name`, `sort` (`group`, `name` oder `version`), `direction` (`asc` oder `desc`), `groupBy` (`none`, `group` oder `package`), `after` und `limit` (1 bis 100, standardmäßig 50). Die Antwort enthält `items` (Gruppe, Name, Version, `artifactId` und das ganze Manifest), `groups` und `next`. Ein Cursor gehört zu den Filtern, aus denen er stammt. Verwenden Sie ihn nur mit denselben Filtern.

```typescript
const page = await releases.packages.list({
  name: 'game-client',
  sort: 'version',
  direction: 'desc',
});
```

Das Auflisten braucht `package.read`. Um stattdessen nach Labels oder Metadaten zu suchen, siehe [Dateien nach Pfad](./files#labels).

## Versionen und Bereiche {#versions}

Arkvory vergleicht Versionen nach der SemVer-Rangfolge. `1.10.0` ist neuer als `1.9.0`. Eine Version mit einem Vorabveröffentlichungsteil, etwa `1.5.0-rc.1`, ist älter als `1.5.0`.

Eine Auswahl nimmt einen Paket-`name` und optional diese Filter:

| Filter         | Bedeutung                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `group`        | Die Gruppe. Standardmäßig leer: Ein Paket mit einer Gruppe wird nur gefunden, wenn Sie sie angeben |
| exakte Version | Eine Version. Groß-/Kleinschreibung wird ignoriert                                                 |
| Bereich        | Ein SemVer-Bereich                                                                                 |
| `stage`        | Nur Versionen, die diese Stufe tragen (siehe [Stufen und Hochstufung](./promotion))                |
| prerelease     | Vorabversionen einschließen. Standardmäßig aus                                                     |
| Reihenfolge    | `version` (Standard) oder `promoted`                                                               |

Bereiche können als `1.2.3`, `^1.2`, `~1.2.3`, `1.x`, `>=1.0.0 <2.0.0`, `1.0.0 - 1.4.0` und `^1 || ^3` geschrieben werden. Ein Bereich hat höchstens 256 Zeichen. Eine exakte Version und ein Bereich können nicht kombiniert werden.

Ohne exakte Version oder Bereich gibt die Auswahl die höchste stabile Version zurück, also die neueste. Vorabversionen werden nur mit eingeschaltetem prerelease-Filter gewählt oder wenn die exakte Version oder der Bereich selbst eine Vorabversion derselben `major.minor.patch` nennt. `order promoted` wählt die zuletzt hochgestufte Version, nicht die höchste, und braucht eine Stufe. Passt nichts, antwortet der Server mit `404 not_found`.

## Ein Paket herunterladen {#download}

Lösen Sie zuerst auf, wenn Sie sehen möchten, was Sie bekommen, oder laden Sie direkt herunter.

```bash
arkvoryctl packages resolve game-client --group acme/game --range ^1.4 --stage release
arkvoryctl packages download game-client ./game-client.upack --group acme/game --range ^1.4 --stage release
arkvoryctl packages download game-client ./game-client.upack --exact 1.4.2 --group acme/game
arkvoryctl packages download game-client ./game-client.upack --group acme/game
```

Die Optionen sind `--group`, `--exact`, `--range`, `--stage`, `--prerelease` und `--order promoted`. Verwenden Sie `--exact` für eine exakte Version, denn `--version` gibt die Client-Version aus. `resolve` gibt die Gruppe, den Namen, die Version, `artifactId`, `sha256`, `size`, `publishedAt`, `stagedAt` und die Stufen aus. `download` löst auf und lädt dann dieses Artefakt mit Fortsetzung und einer SHA-256-Prüfung herunter, wie in [Uploads und Downloads](./transfers#download-cli). Der Client braucht `package.read`, `artifact.read` und `content.read`.

Mit HTTP gibt es zwei Vorgänge. `resolvePackage` braucht `package.read` und gibt dieselben Angaben wie `resolve` zurück. `downloadPackageContent` sendet die Bytes der gewählten Version und braucht nur `content.read`. Es fügt die Header `X-Arkvory-Artifact-Id` und `X-Arkvory-Package-Version` hinzu.

```bash
curl -fL -G -H "Authorization: Bearer $ARKVORY_KEY" -o game-client.upack \
  --data-urlencode "name=game-client" --data-urlencode "group=acme/game" \
  --data-urlencode "range=^1.4" --data-urlencode "stage=release" \
  "$ARKVORY/api/v1/repositories/prod/packages/content"
```

Die Adresse nach Namen löst bei jeder Anfrage auf. Setzen Sie einen Download mit einem Bereich fort, kann sich die Datei zwischen den beiden Aufrufen geändert haben. Laden Sie stattdessen die `artifactId` aus `resolve` herunter, oder senden Sie den `ETag` in `If-Range`.

```typescript
const found = await prod.packages.resolve({
  name: 'game-client',
  group: 'acme/game',
  range: '^1.4',
  stage: 'release',
});
const stream = await prod.artifacts.downloadVerified(found.artifactId);
```

Ein Deployment-Agent, der nur Builds abrufen darf, erhält einen Dienstschlüssel mit `content.read` allein für die HTTP-Adresse oder die Lesevoreinstellung für `arkvoryctl`. Siehe [Dienstkonten und Schlüssel für CI](./accounts#service-accounts).

## Labels, Metadaten und Anhänge {#labels}

Eine Paketversion ist ein gewöhnliches Artefakt, daher gilt alles aus [Dateien nach Pfad](./files#labels) auch für sie: Labels wie `test`, `staging` und `release`, Textmetadaten wie `git.commit`, Sammlungen und Anhänge wie ein SBOM oder eine Signatur. Setzen Sie die ersten Labels beim Upload mit `--label test`. Labels ändern nichts am Archiv. Sie sind freier Text, kein kontrollierter Status. Für eine Freigabe, auf die sich ein Deployment verlassen kann, verwenden Sie eine Stufe. Siehe [Stufen und Hochstufung](./promotion).

## Alte Versionen behalten {#retention}

Registrierte Pakete sind das, was die Aufbewahrungsrichtlinie eines Repositorys zählt. Standardmäßig behält sie, wenn aktiviert, die letzten 10 Builds jedes Pakets und Kanals. Ein Kanal ist das Label `test`, `staging` oder `release`. Eine Version mit einer Stufe, einem geschützten Label, einem Dateipfad oder einer Anhangsverknüpfung wird nie von der Aufbewahrung entfernt. Die Aufbewahrung ist aus, bis ein Administrator sie einschaltet und der Löschung zustimmt. Siehe [Speicher und Aufbewahrung](../operate/storage).

## Fehler {#errors}

| Antwort                               | Bedeutung                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `400 invalid_input` beim Registrieren | Kein gültiges UPack-ZIP, keine `upack.json` im Wurzelverzeichnis oder ein falscher Name oder eine falsche Version                                                                          |
| `409 version_exists`                  | Die Identität gehört bereits zu einem anderen Archiv. Veröffentlichen Sie eine neue Version. Das Hochstufen in ein Repository, das die Version mit anderen Bytes hat, schlägt genauso fehl |
| `404 not_found` beim Auflösen         | Nichts passt zu den Filtern. Prüfen Sie die Gruppe, den Bereich und die Stufe                                                                                                              |
| `403 permission_missing`              | Dem Schlüssel fehlt `package.read`, `package.publish` oder `content.read`                                                                                                                  |

## Verwandte Seiten {#related-pages}

- [Uploads und Downloads](./transfers)
- [Stufen und Hochstufung](./promotion)
- [Kommandozeile (arkvoryctl)](../protocols/cli)
- API-Referenz: [Pakete](../api/reference/packages), [Stufen und Hochstufung](../api/reference/promotion)
