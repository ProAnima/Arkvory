---
title: Repositorys
description: 'Was ein Repository ist, wie Sie die Repositorys sehen, die Sie verwenden dürfen, wie Sie eines in der Konsole auswählen und was schreibgeschützte Repositorys sind.'
---

# Repositorys

Ein Repository ist ein benannter Ort in Arkvory, an dem Dateien gespeichert und Zugriffe entschieden werden. Alles, was Sie veröffentlichen, geht in ein Repository, und jede Anfrage nennt es.

## Was ein Repository ist {#what-it-is}

Ein Repository hat eine ID: lateinische Kleinbuchstaben, Ziffern, `-` und `_`, beginnend mit einem Buchstaben oder einer Ziffer, höchstens 64 Zeichen. Beispiele sind `releases`, `builds` und `game-prod`. Die ID ist Teil jeder Adresse:

| Was                                             | Adresse                               |
| ----------------------------------------------- | ------------------------------------- |
| Artefakte, Pakete, Dateien nach Pfad (HTTP-API) | `/api/v1/repositories/<repository>/…` |
| Container-Images                                | `/v2/<repository>/<image>/…`          |
| Git LFS                                         | `/lfs/<repository>`                   |
| npm- und Unity-Pakete                           | `/npm/<repository>/…`                 |

Siehe [Container-Images](../protocols/containers), [Git LFS](../protocols/git-lfs) und [Unity und npm](../protocols/unity-npm).

Ein Repository enthält unveränderliche Artefakte. Es gibt zwei Sichten darauf: UPack-Pakete mit einer Version ([Pakete](./packages)) und Dateien nach Pfad mit einem Verlauf ([Dateien nach Pfad](./files)). Stufen und Hochstufung bewegen Builds zwischen Repositorys ([Stufen und Hochstufung](./promotion)).

Heute hat ein Repository keinen Anzeigenamen, keine Beschreibung und keine eigenen Einstellungen außer Zugriff, [Speichereinstellungen](#settings) und, bei einer Kopie eines anderen Servers, seinem [Spiegelzustand](#read-only). Sie können ein Repository nicht umbenennen. Sie können keines löschen: Nehmen Sie den Zugriff weg, und die Dateien bleiben auf dem Datenträger.

## Ein Repository erstellen {#create}

Es gibt keinen Befehl, der ein Repository erstellt. Ein Repository existiert, sobald Zugriff darauf gewährt wird. Das Repository ist leer bis zum ersten Upload.

Ein Administrator tut eines von beidem:

- Einer Gruppe Zugriff auf den neuen Namen geben. Öffnen Sie in der Konsole [[ui:administration]], erweitern Sie [[ui:manageGrants]], wählen Sie die Gruppe, geben Sie den Namen in [[ui:repository]] ein, wählen Sie [[ui:read]] oder [[ui:write]] und wählen Sie [[ui:saveGrant]]. Die Gruppe `arkvory-owners`, zu der der Besitzer gehört, ist eine gute Wahl für die erste Berechtigung. Siehe [Gruppen und Repository-Zugriff](./accounts#groups).
- Das Repository in der Richtlinie eines Dienstkontos benennen. Siehe [Dienstkonten und Schlüssel für CI](./accounts#service-accounts).

Mit der API tun `setGroupGrant` und `setServicePolicy` dasselbe. Ein Tippfehler erstellt einen neuen, falschen Namen: Prüfen Sie die Schreibweise. Der Name `releases` existiert nach der Installation, mit Schreibzugriff für die Gruppe `arkvory-owners`.

## Die Repositorys sehen, die Sie verwenden dürfen {#list}

Sie sehen nur die Repositorys, in denen Ihre Anmeldedaten ein Recht haben. Ein Repository, in dem Sie kein Recht haben, erscheint nicht, und eine direkte Anfrage dafür liefert `404`. Ein leeres Repository, auf das Sie Zugriff haben, erscheint ebenfalls.

Öffnen Sie in der Konsole [[ui:repositories]]. Jede Karte zeigt den Repository-Namen und unter [[ui:repositoryRights]] die Aktionen, die Sie dort besitzen. Die Schaltflächen sind:

- [[ui:repositoryOpen]] öffnet den Katalog des Repositorys. Sie erscheint, wenn Sie Artefakte auflisten dürfen.
- [[ui:repositoryStorage]] öffnet den Katalog mit den Speichereinstellungen. Sie erscheint, wenn Sie die Speicherrichtlinie oder die Diagnose lesen dürfen.
- [[ui:repositoryAccess]] führt zur Benutzer- und Dienstverwaltung. Sie erscheint für Administratoren und Dienstadministratoren.

Die Liste zeigt 50 Repositorys auf einmal; [[ui:managementMore]] lädt die nächste Seite und [[ui:managementReload]] aktualisiert sie. Ein Spiegel zeigt das Badge [[ui:mirrorBadge]].

Mit `arkvoryctl`:

```bash
arkvoryctl repositories
arkvoryctl doctor
```

`repositories` gibt jedes Repository mit seinen `formats` und Ihren `permissions` aus. Hat die Antwort einen `next`-Wert, übergeben Sie ihn als `--after`. `doctor` zeigt den Server, die Funktionen und die Berechtigungen des aktuellen Schlüssels.

Mit der API nimmt `listRepositories` `limit` (1 bis 100, standardmäßig 50) und `after`, die letzte ID der vorherigen Seite. `getRepository` gibt eine Karte zurück.

```bash
curl -H "Authorization: Bearer $ARKVORY_KEY" "$ARKVORY/api/v1/repositories?limit=100"
```

```typescript
const page = await client.repositories({ limit: 50 });
const card = await client.repository('releases');
```

Eine Karte ist `id`, `formats` (immer `upack` und `assets`) und `permissions`. Sie sagt nichts über die Größe oder die Anzahl der Dateien. Siehe [Berechtigungen](./accounts#permissions) für die Aktionsnamen.

## Ein Repository in der Konsole auswählen {#choose}

Die Karte [[ui:connection]] hat das Feld [[ui:repository]] mit einer Liste der Repositorys, die Sie lesen dürfen. Das Feld beginnt mit `releases`. Nach der Anmeldung behält die Konsole es, wenn Sie es lesen können, und wählt andernfalls das erste Repository, das Sie lesen können. Um in einem anderen zu arbeiten, geben Sie seinen Namen ein oder wählen Sie es aus der Liste. Katalog, Pakete, Uploads und Details verwenden dann dieses Repository. [[ui:repositoryOpen]] auf einer Karte füllt das Feld für Sie.

Die Adresse eines Artefakts in der Konsole enthält sein Repository: `#/artifact/<repository>/<id>`. Ein Link zu einem Artefakt in einem Repository, das Sie nicht lesen können, zeigt eine Meldung und den Katalog.

`arkvoryctl` verwendet das Repository des Profils, `releases`, sofern Sie beim Hinzufügen des Profils kein anderes festlegen. Überschreiben Sie es für einen Befehl mit `--repository`:

```bash
arkvoryctl profile add production --server https://arkvory.example --token-file ~/.arkvory/key --repository builds
arkvoryctl list --repository releases
```

Im SDK gibt `client.inRepository('builds')` einen an ein Repository gebundenen Client zurück. In HTTP steht das Repository im Pfad.

## Repository-Einstellungen {#settings}

Was Sie heute für ein Repository festlegen können:

- **Zugriff.** Wer lesen und schreiben darf. Siehe [Konten und Zugriff](./accounts).
- **Speicher.** Ein Kontingent in GiB, Warn- und kritische Schwellen, Aufbewahrung (die letzten N Builds jedes Pakets und Kanals behalten, geschützte Labels, ein Mindestalter), automatische Bereinigung und physische Bereinigung. Die Einstellungen brauchen die Aktionen `storage.read` zum Ansehen und `storage.manage` zum Ändern; die Gruppenstufe einer Person gibt sie nicht, ein Dienstschlüssel schon. In der Konsole stehen sie unter [[ui:storageTitle]], das [[ui:repositoryStorage]] öffnet. Mit `arkvoryctl` lesen `storage usage` und `storage policy` sie. Ein neuer Upload, der das Kontingent überschreiten würde, wird mit `507 storage_quota` abgelehnt. Siehe [Speicher und Aufbewahrung](../operate/storage).
- **Spiegel.** Ein Serveradministrator kann das Repository zu einer Kopie des Repositorys eines anderen Servers machen. Siehe den nächsten Abschnitt.

## Schreibgeschützte Repositorys {#read-only}

Ein **Spiegel** ist eine schreibgeschützte Kopie eines Repositorys eines anderen Arkvory-Servers. Der Server hält sie von selbst aktuell. Jeder mit Leserecht kann auflisten und herunterladen. Niemand kann sie ändern: Upload, Veröffentlichen, Labels ändern, Stufen hinzufügen, Pfade zuweisen und Löschen werden alle mit `409 mirror_read_only` abgelehnt, was auch immer die Gruppenstufe der Person oder die Aktionen des Schlüssels sind. Um den Inhalt zu ändern, verwenden Sie den Hauptserver.

Die Konsole zeigt einen Spiegel mit einem Badge über dem Katalog und blendet die Upload-Schaltfläche aus:

| Badge                | Bedeutung                                                                      |
| -------------------- | ------------------------------------------------------------------------------ |
| [[ui:mirrorBadge]]   | Die Kopie ist aktuell                                                          |
| [[ui:mirrorBehind]]  | Der Server holt noch auf                                                       |
| [[ui:mirrorFailing]] | Die letzte Synchronisierung ist fehlgeschlagen; Downloads funktionieren weiter |

Wählen Sie [[ui:mirrorHelpLabel]] neben dem Badge für die Quelle, die Zeit der letzten Synchronisierung und den Fehlercode.

Eine zweite Art ist ein **Import**. Es ist ein gewöhnliches Repository, das automatisch die Versionen übernimmt, die bestimmte Stufen in einem Repository eines anderen Servers tragen (zum Beispiel von `dev` nach `prod`). Sein Badge ist [[ui:mirrorImport]]. Uploads dorthin bleiben möglich, und spätere Änderungen oder Löschungen an der Quelle betreffen das Kopierte nicht.

Mit der API gibt `getRepositoryMirror` den Zustand zurück: `mode` (`mirror` oder `import`), `phase` (`pending`, `seeding` oder `following`), `caughtUp`, `syncedAt` und `errorCode`. Es antwortet mit `404` für ein gewöhnliches Repository.

Spiegel werden vom Serveradministrator eingerichtet. Siehe [Spiegel](../operate/mirrors). Ein **Lese-Gateway** ist etwas anderes: eine Adresse, die nur Downloads für dieselben Repositorys bedient. Änderungen darüber werden mit `405 read_only` abgelehnt. Siehe [Lese-Gateways](../operate/read-gateways).

## Verwandte Seiten {#related-pages}

- [Konten und Zugriff](./accounts)
- [Dateien nach Pfad](./files) und [Pakete](./packages)
- [Speicher und Aufbewahrung](../operate/storage)
- API-Referenz: [Repositorys](../api/reference/repositories), [Spiegel](../api/reference/mirrors)
