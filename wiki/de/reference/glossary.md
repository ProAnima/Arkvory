---
title: Glossar
description: 'Kurze Definitionen der Begriffe, die in Arkvory und seiner Dokumentation verwendet werden, in alphabetischer Reihenfolge, jeweils mit einem Link auf die Seite, auf der sie erklärt werden.'
---

# Glossar

Die Begriffe sind in alphabetischer Reihenfolge aufgeführt. Die Ideen dahinter finden Sie unter [Konzepte](../guide/concepts).

## A {#letter-a}

### Konto {#account}

Die Anmeldung einer Person am Server: ein Name mit 3 bis 64 Zeichen und ein Passwort mit 12 bis 128 Zeichen. Gruppen-Gewährungen geben einem Konto Zugriff auf Repositorys. Siehe [Konten und Zugriff](../use/accounts).

### Aktion {#action}

Ein genau festgelegtes Recht auf einem Repository, etwa `upload.create` oder `content.read`. Dienstschlüssel tragen Aktionen, und die API-Referenz nennt die Aktionen, die jeder Vorgang benötigt. Siehe [Authentifizierung](../api/authentication#repository-actions).

### Administrator {#administrator}

Ein Konto, das Konten, Gruppen, Updates und Backups verwaltet. Ein Administrator liest die Dateien eines Repositorys nur, wenn eine Gruppe ihm diesen Zugriff ebenfalls gewährt. Siehe [Konten und Zugriff](../use/accounts).

### Zulassung {#admission}

Die Grenze dafür, wie viele Anfragen und Übertragungen der Server gleichzeitig bearbeitet. Darüber wartet eine Übertragung kurz und der Server antwortet mit `503`, dem Code `busy` und einem `Retry-After`-Header. Siehe [Ratenlimits und ausgelastete Server](../api/index#rate-limits).

### Artefakt {#artifact}

Eine unveränderlich gespeicherte Datei mit ihrer SHA-256. Neuer Inhalt erzeugt ein neues Artefakt. Siehe [Konzepte](../guide/concepts#artifacts).

### Anhang {#attachment}

Eine Verknüpfung von einem Build zu einem anderen Artefakt desselben Repositorys: ein Manifest, ein SBOM, eine Signatur, ein Bericht oder eine andere Datei. Ein Build hat bis zu 32 Anhänge. Siehe [Konzepte](../guide/concepts#annotations).

## B {#letter-b}

### Backup {#backup}

Eine geplante Kopie der Datenbank und aller veröffentlichten Inhalte in den Backup-Speicher. Siehe [Backups](../operate/backups).

### Backup-Agent {#backup-agent}

Der Dienst, der die Kopien erstellt, sie prüft und die Aufbewahrung auf die Wiederherstellungspunkte anwendet. Siehe [Backups](../operate/backups).

### Bearer-Token {#bearer-token}

Die Art, wie jeder Client einen Nachweis an `/api/v1` sendet: der Header `Authorization: Bearer <credential>`. Siehe [Authentifizierung](../api/authentication#headers).

### Bindung {#binding}

Ein Eintrag einer Dienstrichtlinie: ein Repository und die darauf erlaubten Aktionen. Eine Richtlinie hat bis zu 64 Bindungen. Siehe [Authentifizierung](../api/authentication#service-accounts).

### Build {#build}

Die Ausgabe eines CI-Laufs, gespeichert als Artefakt oder als Paketversion. Siehe [Pakete](../use/packages).

## C {#letter-c}

### Katalog {#catalog}

Die Liste der Artefakte in einem Repository mit ihren Namen, Größen, Labels und Stufen. Siehe [Artefakt-Referenz](../api/reference/artifacts).

### Obergrenze {#ceiling}

Die Grenze einer Delegierung: die Repository-Aktionen, die ein Operator in die Richtlinien und Schlüssel der von ihm verwalteten Konten aufnehmen darf. Der Operator kann seine Obergrenze nicht überschreiten. Siehe [Authentifizierung](../api/authentication#delegation).

### Prüfsumme {#checksum}

Die SHA-256, die belegt, dass die Bytes die erwarteten sind. Uploads geben sie an, bevor die Bytes eintreffen, und der Server und die Clients prüfen sie. Siehe [Übertragungen](../use/transfers).

### Bereinigung {#cleanup}

Auch physische Bereinigung genannt. Sie gibt den Speicherplatz gelöschter Inhalte im Hintergrund in kleinen Stapeln frei. Siehe [Speicher](../operate/storage).

### Sammlung {#collection}

Eine benannte Menge von Artefakten. Eine Sammlung ist Teil der Annotationen eines Artefakts. Siehe [Konzepte](../guide/concepts#annotations).

### Compare-and-Swap {#compare-and-swap}

Eine Änderung, die die erwartete Revision nennt, etwa `expectedRevision`. Kam eine andere Änderung zuvor, antwortet der Server mit `409` und dem Grund `revision_mismatch` und ändert nichts. Siehe [HTTP-API-Überblick](../api/index#revisions).

### Abschlussjob {#completion-job}

Ein Hintergrundjob des Workers, der einen großen Upload prüft und veröffentlicht. Sie verfolgen ihn mit `GET /api/v1/jobs/{id}`. Sein Status ist `queued`, `running`, `completed` oder `failed`. Siehe [Upload-Referenz](../api/reference/uploads#getCompletionJob).

### Konsole {#console}

Die Weboberfläche von Arkvory, bereitgestellt unter `/console/`. Siehe [Die Webkonsole](../guide/console).

### CORS {#cors}

Die Browser-Regel für Seiten, die eine API unter einer anderen Adresse aufrufen. Eine Seite von einem anderen Ursprung funktioniert nur, wenn der Administrator diesen Ursprung in `ARKVORY_CORS_ORIGINS` auflistet. Siehe [Umgebungsvariablen](./environment).

### Cursor {#cursor}

Der Wert `next` in einer Ergebnisseite. Senden Sie ihn als `after` zurück, um die nächste Seite zu lesen; ist `next` `null`, ist die Liste vollständig. Siehe [HTTP-API-Überblick](../api/index#pagination).

## D {#letter-d}

### Delegierung {#delegation}

Eine Gewährung vom Wiederherstellungsschlüssel an einen Operatorschlüssel: Er darf benannte Dienstkonten mit benannten Verwaltungsaktionen innerhalb einer Obergrenze verwalten. Siehe [Authentifizierung](../api/authentication#delegation).

### Digest {#digest}

Die Inhaltsadresse eines Container-Images, geschrieben `sha256:…`. Siehe [Container-Images](../protocols/containers).

### Download-Link {#download-link}

Ein zeitlich begrenzter Link, der ein Artefakt ohne Schlüssel herunterlädt. Er gilt von 60 Sekunden bis 24 Stunden (standardmäßig 1 Stunde), und niemand kann ihn vor Ablauf widerrufen. Siehe [Authentifizierung](../api/authentication#download-links).

## E {#letter-e}

### ETag {#etag}

Der Validator eines Downloads: der starke Wert `"sha256:<hex>"` des Artefakts. Verwenden Sie ihn mit `If-Range`, um sicher fortzusetzen, und mit `If-None-Match`, um einen wiederholten Download zu überspringen. Siehe [HTTP-API-Überblick](../api/index#range-downloads).

## F {#letter-f}

### Failover {#failover}

Clients auf einen Spiegel umschalten, wenn die Quelle verloren geht. Der Operator trennt den Spiegel ab, und er wird zu einem gewöhnlichen Repository, das Änderungen annimmt. Nichts schaltet sich von selbst um. Siehe [Spiegel](../operate/mirrors).

### Feedback {#feedback}

Ein Bericht mit Screenshots und Protokollen, den ein angemeldeter Benutzer aus der Konsole an ProAnimaStudio sendet. Die Konsole zeigt, was angehängt ist, bevor sie etwas sendet. Siehe [Die Webkonsole](../guide/console#feedback).

### Datei nach Pfad {#file-by-path}

Eine Datei, die über einen Pfad im Repository angesprochen wird, etwa `builds/game/Setup.exe`, und ihre früheren Revisionen behält. Siehe [Dateien und Pfade](../use/files).

### Dateischlüssel {#file-key}

Ein Geheimnis, dessen SHA-256 in der Schlüsseldatei des Servers (`ARKVORY_KEYS_FILE`) aufgeführt ist. Der Wiederherstellungsschlüssel ist ein Dateischlüssel. Siehe [Authentifizierung](../api/authentication#recovery-key).

## G {#letter-g}

### Karenzzeit {#grace-period}

Die Zeit, die gelöschter Inhalt auf dem Datenträger bleibt, bevor die Bereinigung ihn entfernt: standardmäßig 24 Stunden. Siehe [Speicher](../operate/storage).

### Gruppe {#group}

Eine Menge von Konten, die sich den Repository-Zugriff teilen. Eine Gruppe erhält pro Repository `read`- oder `write`-Zugriff („Lesen und Schreiben"). Siehe [Konten und Zugriff](../use/accounts).

## H {#letter-h}

### Verlauf {#history}

Die früheren Revisionen einer Datei nach Pfad oder einer Anhangsmenge. Siehe [Dateien und Pfade](../use/files).

### Hub {#hub}

Der ProAnimaStudio-Dienst unter `https://hub.proanima.net`, der stabile Releases ankündigt und Feedback entgegennimmt. Siehe [Updates](../install/updates).

## I {#letter-i}

### Idempotenzschlüssel {#idempotency-key}

Der Header `Idempotency-Key`: ein Wert mit 1 bis 128 Zeichen, der eine wiederholte Anfrage nur einmal wirksam werden lässt. Siehe [HTTP-API-Überblick](../api/index#idempotency).

### Image {#image}

Ein Container-Image, das in der integrierten Registry gespeichert ist. Siehe [Container-Images](../protocols/containers).

### Installationsverzeichnis {#installation-root}

Der Ordner mit den Daten, der Konfiguration und den Protokollen: `C:\ProgramData\ProAnima\Arkvory` unter Windows und `/opt/proanima-arkvory` unter Linux. Siehe [Installation wählen](../install/index#installation-directory).

## L {#letter-l}

### Label {#label}

Ein kurzes Etikett an einem Artefakt, etwa `nightly` oder `tested`. Ein Artefakt hat bis zu 32 Labels. Siehe [Konzepte](../guide/concepts#annotations).

### Lease {#lease}

Ein Anspruch, den ein Prozess für kurze Zeit hält und erneuern muss, damit nur ein Prozess einen Job ausführt. Der Backup-Agent hält standardmäßig eine Lease von 60 Sekunden, sodass nie zwei Agents gleichzeitig laufen. Siehe [Umgebungsvariablen](./environment#backups).

### Lebendigkeit {#liveness}

Die Antwort von `GET /health/live`: Der Prozess läuft. Sie ist öffentlich. Siehe [System-Referenz](../api/reference/system).

### Sperre {#lock}

Eine Git-LFS-Dateisperre, die zwei Personen daran hindert, dieselbe Binärdatei zu ändern. Siehe [Git LFS](../protocols/git-lfs).

## M {#letter-m}

### Wartungsstunde {#maintenance-hour}

Die Stunde des Tages in UTC, in der automatische Updates installiert werden dürfen. Der Standard ist 03:00. Siehe [Updates](../install/updates).

### Metadaten {#metadata}

Textfelder eines Artefakts als Schlüssel/Wert: bis zu 32 Felder mit Werten bis zu 1.024 Zeichen. Siehe [Konzepte](../guide/concepts#annotations).

### Spiegel {#mirror}

Eine schreibgeschützte Kopie eines Repositorys, die eine zweite Installation pflegt, indem sie der Quelle folgt. Siehe [Spiegel](../operate/mirrors).

### Spiegelquelle {#mirror-source}

Die Installation, von der ein Spiegel kopiert. Der Spiegel meldet sich dort mit einem schreibgeschützten Schlüssel an. Siehe [Spiegel](../operate/mirrors).

### Verschieben {#move}

Eine Hochstufung, die den Build zusätzlich aus dem Quell-Repository entfernt. Siehe [Hochstufung](../use/promotion).

## O {#letter-o}

### Erste Schritte {#onboarding}

Die ersten Schritte nach der Installation, angezeigt in der Konsole im Abschnitt „Erste Schritte". Siehe [Schnellstart](../guide/quick-start).

### OpenAPI {#openapi}

Die maschinenlesbare Beschreibung der HTTP-API, bereitgestellt unter `/api/v1/openapi.json`. Siehe [HTTP-API-Überblick](../api/index#discovery).

### Besitzer {#owner}

Das erste Konto, das während der Installation erstellt wird. Es ist Administrator und Mitglied der Gruppe `arkvory-owners`, die in `releases` schreiben darf. Siehe [Konzepte](../guide/concepts#owner-and-recovery-key).

## P {#letter-p}

### Paket {#package}

Ein versioniertes UPack-Paket mit einer Gruppe, einem Namen und einer SemVer-Version. Siehe [Pakete](../use/packages).

### Paketgruppe {#package-group}

Der erste Teil des Namens eines Pakets. Pakete mit demselben Namen in verschiedenen Gruppen sind verschiedene Pakete. Siehe [Pakete](../use/packages).

### Teil {#part}

Ein Stück einer großen Datei, das als eigene Anfrage gesendet wird. Ein Teil ist mindestens 8 MiB groß, außer dem letzten, und höchstens 1 GiB. Siehe [Übertragungen](../use/transfers).

### Berechtigung {#permission}

Das Recht, eine Aktion auszuführen. Personen erhalten `read` oder `write` über Gruppen; Dienstschlüssel erhalten exakte Aktionen. Siehe [Authentifizierung](../api/authentication#access-rules).

### Persönliches Zugriffstoken {#personal-access-token}

Das Geheimnis einer Person für Skripte und die Kommandozeile. Es beginnt mit `pat_`, läuft standardmäßig nach 90 Tagen ab (höchstens 365) und ist entweder schreibgeschützt oder lesend und schreibend. Siehe [Authentifizierung](../api/authentication#personal-tokens).

### Anheften {#pin}

Etwas vor dem automatischen Löschen bewahren, etwa einen Wiederherstellungspunkt. Siehe [Backups](../operate/backups).

### Richtlinie {#policy}

Die gespeicherten Regeln eines Dienstkontos (seine Bindungen), eines Repositorys (seine Speicherrichtlinie) oder des Backup-Plans. Siehe [Authentifizierung](../api/authentication#service-accounts).

### Hochstufen {#promote}

Das Verb der Hochstufung: einen Build in einem anderen Repository veröffentlichen oder ihn mit einer Stufe markieren. Siehe [Hochstufung](../use/promotion).

### Hochstufung {#promotion}

Einen Build in einem anderen Repository veröffentlichen, ohne ihn erneut hochzuladen. Siehe [Hochstufung](../use/promotion).

## Q {#letter-q}

### Kontingent {#quota}

Der meiste Speicherplatz, den ein Repository verwenden darf. Ein neuer Upload, der ihn überschreiten würde, wird mit `507` und dem Grund `storage_quota` abgelehnt. Siehe [Speicher](../operate/storage).

## R {#letter-r}

### Range {#range}

Der HTTP-Header `Range: bytes=start-end`, der nach einem Teil einer Datei fragt. Downloads unterstützen einen Range pro Anfrage, was zum Fortsetzen nötig ist. Siehe [HTTP-API-Überblick](../api/index#range-downloads).

### Ratenlimit {#rate-limit}

Eine Grenze dafür, wie oft etwas versucht werden darf. Arkvory begrenzt Anmelde-, Registrierungs-, Passwort- und Feedback-Versuche und antwortet mit `429` und `Retry-After`. Siehe [Authentifizierung](../api/authentication#sign-in-limits).

### Lese-Gateway {#read-gateway}

Ein zusätzlicher reiner Download-API-Prozess auf demselben Speicher. Er beantwortet `GET` und `HEAD` und lehnt Änderungen mit `405` ab. Siehe [Lese-Gateways](../operate/read-gateways).

### Bereitschaft {#readiness}

Ob der Server seine Arbeit erledigen kann. `GET /health/status` ist öffentlich und antwortet mit `{"status":"ready"}` oder `unavailable`; `GET /health/ready` benötigt einen Nachweis und liefert Details. Siehe [System-Referenz](../api/reference/system).

### Wiederherstellungsschlüssel {#recovery-key}

Auch Bootstrap-Schlüssel genannt. Das Geheimnis der Installation in `config/bootstrap-token.txt`: Es erstellt den Besitzer, verwaltet Dienstkonten und stellt den Zugriff wieder her. Siehe [Authentifizierung](../api/authentication#recovery-key).

### Registry {#registry}

Ein Server, zu dem Clients wie Docker oder npm pushen und von dem sie pullen. Arkvory hat eine Container-Registry (`/v2/`) und eine npm-Registry (`/npm/`). Siehe [Clients und Protokolle](../protocols/index).

### Repository {#repository}

Ein benannter Raum für Inhalte mit eigenen Zugriffsregeln und eigener Speicherrichtlinie. Siehe [Repositorys](../use/repositories).

### Anfrage-ID {#request-id}

Die Kennung einer Anfrage, zurückgesendet im Header `X-Request-Id` und in jedem Fehler. Geben Sie sie dem Support. Siehe [HTTP-API-Überblick](../api/index#request-ids).

### Auflösen {#resolve}

Den Build finden, auf den eine Stufe und ein Versionsbereich zeigen. Siehe [Hochstufung](../use/promotion).

### Wiederherstellen {#restore}

Eine frühere Revision einer Datei wieder aktuell machen, was eine neue Revision hinzufügt. Auch: die gesamte Installation aus einem Wiederherstellungspunkt wiederherstellen. Siehe [Dateien und Pfade](../use/files) und [Backups](../operate/backups).

### Wiederherstellungspunkt {#restore-point}

Ein vollständiges Backup, das wiederhergestellt werden kann. Siehe [Backups](../operate/backups).

### Fortsetzen {#resume}

Einen unterbrochenen Upload oder Download von der Stelle aus fortsetzen, an der er gestoppt wurde. Siehe [Übertragungen](../use/transfers).

### Aufbewahrung {#retention}

Die Regeln dafür, wie lange Inhalte oder Backups aufbewahrt werden. Siehe [Speicher](../operate/storage).

### Aufbewahrungsrichtlinie {#retention-policy}

Die gespeicherten Aufbewahrungsregeln eines Repositorys: wie viele Builds behalten werden, welche Labels geschützt werden und wie alt ein Build vor der Entfernung sein muss. Sie ist aus, bis ein Administrator sie einschaltet. Siehe [Speicher](../operate/storage).

### Retry-After {#retry-after}

Der Header, und das Feld `retryAfterSeconds` eines Fehlers, der angibt, wie viele Sekunden nach einem `429` oder `503` bis zum nächsten Versuch zu warten sind. Siehe [HTTP-API-Überblick](../api/index#rate-limits).

### Revision {#revision}

Eine nummerierte Version einer Datei nach Pfad, der Annotationen eines Artefakts oder einer Einstellung. Revisionen zählen ab 1 hoch. Siehe [HTTP-API-Überblick](../api/index#revisions).

### Widerrufen {#revoke}

Einen Schlüssel oder ein Token endgültig ungültig machen. Siehe [Authentifizierung](../api/authentication#service-keys).

### Rollback {#rollback}

Die Rückkehr zur vorherigen Version nach einem Update, das nicht gestartet ist. Siehe [Updates](../install/updates).

### Rotieren {#rotate}

Einen Schlüssel durch einen neuen ersetzen, während der alte noch funktioniert. Das Aktivieren des neuen Schlüssels begrenzt den alten auf 24 Stunden. Siehe [Authentifizierung](../api/authentication#service-keys).

## S {#letter-s}

### SBOM {#sbom}

Eine Software-Stückliste: die Liste der Komponenten eines Builds. Sie können sie an einen Build anhängen. Siehe [Konzepte](../guide/concepts#annotations).

### Selbstheilung {#self-healing}

Die Dienste starten nach einem Absturz oder einem Stillstand von selbst neu. Siehe [Selbstheilung](../operate/self-healing).

### SemVer {#semver}

Semantic Versioning: `MAJOR.MINOR.PATCH`, mit einem optionalen Pre-Release-Teil, etwa `1.4.2` oder `2.0.0-rc.1`. Siehe [Pakete](../use/packages).

### Dienstkonto {#service-account}

Ein Konto für CI oder Automatisierung. Es hat eine Richtlinie und meldet sich mit Schlüsseln an. Siehe [Authentifizierung](../api/authentication#service-accounts).

### Dienstschlüssel {#service-key}

Das Geheimnis, mit dem sich ein Dienstkonto anmeldet. Es beginnt mit `arkvory_`, wird einmal angezeigt und muss aktiviert werden. Siehe [Authentifizierung](../api/authentication#service-keys).

### Sitzung {#session}

Eine angemeldete Konsolensitzung. Sie beginnt mit `dps_` und dauert 12 Stunden. Siehe [Authentifizierung](../api/authentication#sessions).

### SHA-256 {#sha-256}

Die Hashfunktion, die Arkvory für Artefakte, Teile und Releases verwendet. Sie wird als 64 hexadezimale Kleinbuchstaben geschrieben. Siehe [Übertragungen](../use/transfers).

### Stabiles Release {#stable-release}

Ein Release, das ProAnimaStudio für Installationen im stabilen Kanal freigegeben hat. Siehe [Updates](../install/updates).

### Stufe {#stage}

Eine Markierung an einem Build wie `qa`, `release` oder `prod`. Siehe [Hochstufung](../use/promotion).

### Oberfläche {#surface}

Eine der sechs Gruppen von API-Vorgängen: `discovery`, `identity`, `catalog`, `transfers`, `administration` und `operations`. Siehe [HTTP-API-Überblick](../api/index#surfaces).

## T {#letter-t}

### Tag {#tag}

Der Name eines Container-Images für eine Version, etwa `latest` oder `1.4`. Siehe [Container-Images](../protocols/containers).

## U {#letter-u}

### UPack {#upack}

Das Paketformat, das Arkvory registriert: ein Archiv mit einem Manifest namens `upack.json`, das die Gruppe, den Namen und die Version angibt. Siehe [Pakete](../use/packages).

### Update {#update}

Ein neueres stabiles Release von Arkvory und seine Installation. Siehe [Updates](../install/updates).

### Upload {#upload}

Das Senden einer Datei an den Server. Das Wort bezeichnet auch die Upload-Sitzung, die die Datei reserviert. Siehe [Übertragungen](../use/transfers).

### Upload-Sitzung {#upload-session}

Eine Reservierung für eine Datei. Sie lebt 7 Tage und wird abgeschlossen, sobald jedes Byte eingetroffen ist. Siehe [Upload-Referenz](../api/reference/uploads).

## V {#letter-v}

### Backup-Speicher {#vault}

Der Speicher für Backups: ein Ordner auf einem anderen Datenträger oder eine Netzwerkfreigabe. Siehe [Backups](../operate/backups).

### Version {#version}

Eine SemVer-Version eines Pakets, etwa `1.4.2`. Siehe [Pakete](../use/packages).

### Versionsbereich {#version-range}

Eine Menge von Versionen, etwa `^1.4`. Siehe [Pakete](../use/packages).

## W {#letter-w}

### Worker {#worker}

Der Dienst, der große Uploads abschließt und Spiegel synchronisiert. Siehe [Installation wählen](../install/index).

### Writer {#writer}

Der API-Prozess, der Änderungen annimmt, im Gegensatz zu einem Lese-Gateway. Siehe [Lese-Gateways](../operate/read-gateways).
