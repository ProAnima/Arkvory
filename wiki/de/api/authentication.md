---
title: 'Authentifizierung'
description: 'Jede Möglichkeit, sich an der Arkvory HTTP-API zu authentifizieren, was jede Art von Anmeldedaten tun darf und wie Zugriffsregeln und Repository-Aktionen funktionieren.'
---

# Authentifizierung

Jeder Aufruf von `/api/v1` benötigt Anmeldedaten, außer den öffentlichen Health-Checks, den Anmeldeoptionen, der Anmeldung und der Registrierung. Diese Seite listet die Arten von Anmeldedaten auf, wie Sie jede erhalten und senden, und was die Zugriffsregeln in der [API-Referenz](./index#reference-pages) bedeuten. Zu den Regeln für die Personen, die Zugriff verwalten, siehe [Konten und Zugriff](../use/accounts).

## Anmeldedaten auf einen Blick {#credentials}

| Anmeldedaten                | Sieht aus wie           | Sie erhalten sie durch                                       | Lebensdauer                          | Verwenden Sie sie für                                                            |
| --------------------------- | ----------------------- | ------------------------------------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------- |
| Konsolensitzung             | `dps_…`                 | Anmeldung mit einem Namen und einem Passwort                 | 12 Stunden                           | Eine Person in der Konsole oder ein Skript, das sich anmeldet                    |
| Persönliches Zugriffstoken  | `pat_…`                 | Erstellen aus einer Sitzung                                  | standardmäßig 90 Tage, höchstens 365 | Skripte und Werkzeuge einer Person                                               |
| Dienstschlüssel             | `arkvory_…`             | Ausgabe für ein Dienstkonto, dann Aktivierung                | standardmäßig 90 Tage, höchstens 365 | CI/CD, Deployment-Agents, andere Systeme                                         |
| Wiederherstellungsschlüssel | 64 hexadezimale Ziffern | Der Installer schreibt ihn nach `config/bootstrap-token.txt` | Läuft nicht ab                       | Anlegen des Besitzers, Verwalten von Dienstkonten, Wiederherstellen des Zugriffs |
| Download-Link               | `dtl_…`                 | Erstellen für ein Artefakt                                   | 60 Sekunden bis 24 Stunden           | Ein Artefakt an jemanden geben, der keinen Schlüssel hat                         |

Verwenden Sie einen Dienstschlüssel für die Automatisierung und ein persönliches Zugriffstoken für die Werkzeuge einer Person. Verwenden Sie den Wiederherstellungsschlüssel nicht für die tägliche Arbeit.

## Header-Formate {#headers}

`/api/v1` akzeptiert Anmeldedaten in einem Header:

```http
Authorization: Bearer <credential>
```

- Anmeldedaten sind 32 bis 512 Zeichen lang. Alles andere ist sofort `credential_invalid`.
- Die Container-Registry (`/v2`), Git LFS (`/lfs`) und die npm-Registry (`/npm`) akzeptieren auch HTTP Basic, weil `docker login`, git und npm Anmeldedaten so senden. Der Benutzername wird nicht geprüft; das Passwort sind die Anmeldedaten. Siehe [Clients und Protokolle](../protocols/index#credentials).
- Ein Download-Link kommt in den Query-String, als `?token=dtl_…`, und funktioniert nur auf der Inhaltsroute eines Artefakts. Siehe [Download-Links](#download-links). Ein Header `Authorization` gewinnt immer gegen den Query.
- Eine Anfrage ohne gültige Anmeldedaten erhält `401` mit `WWW-Authenticate: Bearer` und einem Grund: `credential_missing`, `credential_invalid`, `session_expired` oder `token_expired`. Nur der Inhaber des exakten Geheimnisses abgelaufener Anmeldedaten erfährt, dass sie abgelaufen sind.
- **Keine Cookies.** Arkvory setzt keine und liest keine, sodass ein Browser niemals von selbst Anmeldedaten anhängt und es keine Cross-Site-Request-Forgery gibt, gegen die man sich verteidigen müsste. Ein Skript sendet den Header bei jedem Aufruf. Die Konsole behält ihr Sitzungstoken im Speicher des Browser-Tabs und vergisst es, wenn Sie den Tab schließen.
- **Andere Ursprünge.** Eine Seite unter derselben Adresse wie Arkvory braucht nichts. Eine Seite unter einer anderen Adresse wird mit `403` und dem Grund `origin_not_allowed` abgelehnt, es sei denn, der Administrator hat ihren Ursprung in `ARKVORY_CORS_ORIGINS` aufgeführt, selbst mit gültigen Anmeldedaten. Verwenden Sie HTTPS: Anmeldedaten in reinem HTTP sind im Netzwerk lesbar. Siehe [HTTPS](../install/https).

Prüfen Sie, was Anmeldedaten sind und was sie dürfen:

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_KEY" "$ARKVORY_URL/api/v1/auth/me"
curl -fsS -H "Authorization: Bearer $ARKVORY_KEY" "$ARKVORY_URL/api/v1/auth/permissions"
```

## Konsolen-Anmeldesitzungen {#sessions}

Eine Person meldet sich mit einem Namen und einem Passwort an und erhält eine Sitzung. Die Konsole erledigt das für Sie; ein Skript kann dasselbe tun.

1. Legen Sie den Namen und das Passwort in eine private Datei, `login.json`, damit sie nie in einer Kommandozeile oder einer Prozessliste erscheinen:

   ```json
   { "name": "alice", "password": "a long password of 12 to 128 characters" }
   ```

2. Rufen Sie `login` auf:

   ```bash
   curl -fsS -X POST "$ARKVORY_URL/api/v1/auth/login" \
     -H "Content-Type: application/json" -d @login.json
   ```

3. Die Antwort enthält das Sitzungstoken und seine Endzeit:

   ```json
   {
     "token": "dps_…",
     "expiresAt": "2026-10-05T21:30:00.000Z",
     "account": { "id": "…", "name": "alice", "administrator": false, "enabled": true }
   }
   ```

4. Senden Sie das Token als `Authorization: Bearer dps_…`.

Regeln einer Sitzung:

- Sie dauert 12 Stunden und verlängert sich nicht. Danach gibt jeder Aufruf `401` mit dem Grund `session_expired` zurück. Melden Sie sich erneut an.
- Ein Konto hat höchstens 32 Sitzungen. Eine neue Anmeldung beendet die ältesten darüber hinaus.
- `POST /api/v1/auth/logout` beendet die Sitzung. Das Ändern Ihres Passworts oder das Zurücksetzen durch einen Administrator beendet alle Sitzungen und alle persönlichen Token des Kontos. Das Deaktivieren des Kontos stoppt sie.
- Eine Sitzung trägt die volle Vollmacht des Kontos, einschließlich des Administrator-Flags. Nur eine Sitzung kann persönliche Token erstellen und widerrufen und das eigene Passwort des Kontos ändern.
- Namen werden ohne Rücksicht auf Groß- und Kleinschreibung verglichen. Ein falscher Name, ein falsches Passwort und ein deaktiviertes Konto ergeben dasselbe `401` mit dem Grund `invalid_credentials`.
- Ein Lese-Gateway meldet niemanden an; verwenden Sie den Writer.

### Selbstregistrierung {#self-registration}

`GET /api/v1/auth/options` ist öffentlich und sagt, ob Personen eigene Konten anlegen dürfen. Die Selbstregistrierung ist aus, es sei denn, der Administrator setzt `ARKVORY_ALLOW_REGISTRATION=true`; dann legt `POST /api/v1/auth/register` mit demselben Body wie die Anmeldung ein einfaches Konto an (kein Administrator, ohne Zugriff auf ein Repository) und gibt mit `201` eine Sitzung zurück. Andernfalls antwortet es `403` mit dem Grund `registration_disabled`. Die Selbstregistrierung stoppt bei 900 Konten, damit Administratoren noch Konten bis zur Grenze von 1.000 anlegen können.

## Persönliche Zugriffstoken {#personal-tokens}

Ein persönliches Zugriffstoken lässt ein Skript als Sie handeln, ohne Ihr Passwort. Nur eine angemeldete Sitzung kann eines erstellen.

```bash
curl -fsS -X POST "$ARKVORY_URL/api/v1/auth/tokens" \
  -H "Authorization: Bearer $SESSION" -H "Content-Type: application/json" \
  -d '{"name":"laptop-cli","scope":"read-write","expiresAt":"2026-12-31T00:00:00Z"}'
```

In der Konsole öffnen Sie [[ui:personalAccessTokens]] in der Karte [[ui:connection]], geben einen [[ui:tokenName]] ein, wählen [[ui:tokenScope]] und [[ui:tokenExpiry]] und wählen [[ui:generateToken]].

| Feld        | Regel                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `name`      | 1 bis 64 Zeichen.                                                                                                                 |
| `scope`     | `read` oder `read-write`. Die API verwendet `read-write`, wenn Sie es weglassen; die Konsole bietet zuerst [[ui:tokenScopeRead]]. |
| `expiresAt` | Eine RFC-3339-Zeit in der Zukunft, höchstens 365 Tage entfernt. Der Standard ist 90 Tage. Es gibt keine Token ohne Ende.          |

Die `201`-Antwort enthält das Token einmal, als `token`. Speichern Sie es dann: Der Server behält nur einen Hash, und die Liste zeigt ein kurzes Präfix. Dann:

- Ein Token hat den Repository-Zugriff seines Kontos und nichts weiter. Es hat nie das Administrator-Flag, sodass es keine Konten, Gruppen, Updates oder Backups verwalten kann.
- Ein `read`-Token kann nur lesen. Jede Anfrage, die etwas ändert, außer `logout`, wird mit `403` und dem Grund `read_only_token` abgelehnt, bevor der Vorgang läuft.
- Ein Token kann keine Token erstellen oder ein Passwort ändern; dafür ist eine Sitzung nötig.
- Ein Konto hat höchstens 50 aktive Token. `GET /api/v1/auth/tokens` listet sie mit ihrem Präfix, Umfang, Ende und letzter Verwendung auf. `DELETE /api/v1/auth/tokens/{id}` widerruft eines sofort ([[ui:revokeToken]] in der Konsole). Ein Administrator kann die Token jedes Kontos auflisten und widerrufen.
- Ein abgelaufenes Token gibt `401` mit dem Grund `token_expired` zurück.

## Dienstkonten und Schlüssel {#service-accounts}

Ein **Dienstkonto** ist eine Identität für ein Werkzeug, etwa einen Build-Agent. Es hat eine **Richtlinie**: eine Liste von **Bindungen**, von denen jede ein Repository und die dort erlaubten exakten **Aktionen** nennt (siehe [Repository-Aktionen](#repository-actions)). Eine Richtlinie hat höchstens 64 Bindungen. Das Konto besitzt die Uploads und Aufträge, die seine Schlüssel starten, sodass das Rotieren eines Schlüssels nichts verliert. Ein Server hat höchstens 1.000 Dienstkonten.

Nur der [Wiederherstellungsschlüssel](#recovery-key) legt ein Dienstkonto an. Er oder ein Operator mit einer [Delegierung](#delegation) ändert die vorhandenen Konten. Verwenden Sie in der Konsole [[ui:services]]: [[ui:serviceCreate]], dann legen Sie [[ui:servicePolicy]] fest. [[ui:bindingRead]] füllt die sieben Leseaktionen, und [[ui:bindingPublish]] fügt die Aktionen hinzu, die zum Hochladen und Registrieren von Paketen nötig sind.

```bash
curl -fsS -X POST "$ARKVORY_URL/api/v1/service-accounts" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" \
  -d '{"name":"ci-release","bindings":[{"resource":{"kind":"repository","id":"releases"},
       "actions":["repository.read","artifact.read","upload.create","upload.read","upload.write",
                  "upload.complete","upload.cancel","job.read","package.publish"]}]}'
```

Namen verwenden 3 bis 64 Buchstaben, Ziffern, `_`, `.` und `-`. Um die Richtlinie zu ändern, senden Sie `PUT /api/v1/service-accounts/{id}/policy` mit der gelesenen `expectedRevision` ([Compare-and-Swap](./index#revisions)). Um das Konto abzuschalten, senden Sie `PATCH /api/v1/service-accounts/{id}` mit `{"expectedRevision": n, "enabled": false}`; alle seine Schlüssel funktionieren nicht mehr, bis Sie es wieder einschalten.

### Dienstschlüssel {#service-keys}

Ein Schlüssel ist das Geheimnis, mit dem sich ein Dienstkonto anmeldet. Er sieht aus wie `arkvory_<uuid>.<secret>`. Ein Schlüssel durchläuft drei Zustände: `pending`, `active` und `revoked`.

1. **Ausgeben.** Senden Sie `POST /api/v1/service-accounts/{id}/keys` mit einem `Idempotency-Key`, einem `name`, den `bindings`, die der Schlüssel verwenden darf, und, wenn Sie möchten, einem `expiresAt` (UTC, innerhalb von 365 Tagen; der Standard ist 90). Die Bindungen des Schlüssels müssen innerhalb der Richtlinie des Kontos liegen. Die Antwort, `201`, enthält die Metadaten des Schlüssels und, nur dieses eine Mal, sein `secret`. Eine Wiederholung mit demselben Idempotenzschlüssel gibt `200` mit den Metadaten und ohne Geheimnis zurück.
2. **Aktivieren.** Der neue Schlüssel ist `pending` und unbrauchbar, außer für einen Aufruf, `POST /api/v1/auth/activate-key`, mit dem neuen Geheimnis als Anmeldedaten. Die Antwort ist `204`. Tun Sie dies innerhalb von 15 Minuten; danach läuft der Schlüssel ungenutzt ab. Kopieren Sie in der Konsole das Geheimnis, wählen Sie [[ui:keySaved]] und dann [[ui:keyActivate]]. Ein erneutes Aktivieren ist unschädlich.
3. **Verwenden.** Der Schlüssel funktioniert bis zu seinem `expiresAt` oder bis er widerrufen wird oder sein Konto deaktiviert wird.

```bash
curl -fsS -X POST "$ARKVORY_URL/api/v1/service-accounts/$ACCOUNT/keys" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Idempotency-Key: ci-release-2026-10" \
  -H "Content-Type: application/json" \
  -d '{"name":"ci-release-2026-10","bindings":[{"resource":{"kind":"repository","id":"releases"},
       "actions":["upload.create","upload.read","upload.write","upload.complete","job.read"]}]}'
curl -fsS -X POST "$ARKVORY_URL/api/v1/auth/activate-key" -H "Authorization: Bearer $NEW_SECRET"
```

Grenzen: Ein Konto hat höchstens 3 aktive Schlüssel und 2 ausstehende Schlüssel gleichzeitig (`507` mit dem Grund `key_limit`).

**Rotieren.** `POST /api/v1/api-keys/{id}/rotate` gibt einen neuen ausstehenden Schlüssel für dasselbe Konto aus, mit demselben Body wie bei der Ausgabe und einem `Idempotency-Key`. Seine Bindungen müssen innerhalb derer des alten Schlüssels liegen. Wenn Sie den neuen Schlüssel aktivieren, wird das Ende des alten Schlüssels auf höchstens 24 Stunden ab dann gekürzt. Verschieben Sie Ihre Werkzeuge auf den neuen Schlüssel und widerrufen Sie dann den alten. In der Konsole: [[ui:keyRotate]].

**Widerrufen.** `POST /api/v1/api-keys/{id}/revoke` beendet einen Schlüssel endgültig; die Wiederholung ist unschädlich. In der Konsole: [[ui:keyRevoke]]. Das Widerrufen eines Schlüssels stoppt keine Übertragung, die bereits begonnen hat. Das Geheimnis eines ausstehenden Schlüssels verloren? Widerrufen Sie ihn und geben Sie einen weiteren mit einem neuen Idempotenzschlüssel aus.

### Delegierung {#delegation}

Der Wiederherstellungsschlüssel kann einen Teil der Administration an einen **Operator** übergeben: ein Dienstkonto, dessen Schlüssel andere Dienstkonten verwalten darf. Eine **Delegierung** nennt den Schlüssel des Operators, das Zielkonto, die **Administrationsaktionen**, die der Operator darauf verwenden darf, und eine **Obergrenze**, die Repository-Aktionen, die er vergeben darf. Die sieben Administrationsaktionen sind:

| Aktion                   | Erlaubt                                                       |
| ------------------------ | ------------------------------------------------------------- |
| `service-account.read`   | Das Konto in Listen sehen und seine Karte lesen.              |
| `service-account.manage` | Das Konto ein- oder ausschalten.                              |
| `policy.read`            | Die Richtlinie des Kontos lesen.                              |
| `policy.manage`          | Die Richtlinie des Kontos ersetzen.                           |
| `credential.read`        | Die Schlüssel des Kontos auflisten und einen Schlüssel lesen. |
| `credential.manage`      | Schlüssel ausgeben, rotieren und widerrufen.                  |
| `service-audit.read`     | Den Schlüsselverlauf des Kontos lesen.                        |

Regeln: Der Schlüssel des Operators muss einer sein, den der Wiederherstellungsschlüssel ausgegeben hat; ein Operator verwaltet nie sein eigenes Konto; er kann nichts außerhalb seiner Obergrenze oder über die Richtlinie des Kontos hinaus vergeben; ein von ihm ausgegebener Schlüssel kann seinen eigenen Schlüssel nicht überleben; und das Beenden einer Delegierung widerruft keine Schlüssel, die bereits aktiviert wurden. Nur der Wiederherstellungsschlüssel legt Konten an und setzt Delegierungen (`PUT` und `DELETE /api/v1/api-keys/{id}/delegations/{accountId}`). Ein Operator-Schlüssel kann bis zu 64 Delegierungen haben. Verwenden Sie in der Konsole [[ui:delegations]]. Ein Operator, der etwas außerhalb seiner Delegierung braucht, erhält `404` für ein Konto, das er nicht verwaltet, oder `403`.

## Der Wiederherstellungsschlüssel {#recovery-key}

Der Installer erstellt den **Wiederherstellungsschlüssel** einmal und schreibt ihn nach `config/bootstrap-token.txt` im [Installationsverzeichnis](../install/index#installation-directory). Nur die Gruppe Administrators unter Windows oder root unter Linux kann die Datei lesen. Sein Hash steht in der Schlüsseldatei des Servers (`ARKVORY_KEYS_FILE`) unter dem Namen `bootstrap-owner`. Der Installer erstellt auch `config/health-token.txt`, einen zweiten Schlüssel ohne Repository-Rechte, der die authentifizierten Health-Checks und die Metriken aufrufen kann.

Was der Wiederherstellungsschlüssel darf:

- Das erste Konto und jedes weitere anlegen, Passwörter zurücksetzen, Konten deaktivieren und Gruppen und ihre Repository-Gewährungen verwalten.
- Das Sicherheitsaudit lesen und die persönlichen Token jedes Kontos widerrufen.
- Dienstkonten anlegen, ihre Richtlinien setzen, ihre Schlüssel ausgeben und widerrufen und Delegierungen setzen.
- Backups und Updates lesen und anfordern und das Serverprotokoll für Feedback herunterladen.
- Das Repository `releases` wie ein Mitglied einer Gruppe mit [[ui:write]]-Zugriff lesen und schreiben.

Was er nicht kann: Er hat keinen Zugriff auf andere Repositorys als `releases`, kann keine Artefakte löschen und keine Speicherrichtlinien verwalten (diese Aktionen gibt es nur für Dienstschlüssel) und ist keine Sitzung, sodass er keine persönlichen Token erstellen oder ein Passwort ändern kann. Bewahren Sie ihn auf dem Server auf. Installationstools lesen ihn dort. Legen Sie ihn nicht in CI und fügen Sie ihn nicht in Werkzeuge ein; legen Sie stattdessen einen Dienstschlüssel an. Zum Ersetzen siehe [Konfiguration](../install/configuration).

Das Formular [[ui:welcomeOwner]] der Konsole (unter [[ui:navStart]]) verwendet den Wiederherstellungsschlüssel, um den ersten Besitzer anzulegen. Es funktioniert nur, solange kein Konto existiert. Um das Passwort eines bestehenden Kontos ohne Sitzung zurückzusetzen, finden Sie seine ID mit `GET /api/v1/users`, legen Sie das neue Passwort (12 bis 128 Zeichen) in eine private Datei und senden Sie es mit dem Wiederherstellungsschlüssel. Das Zurücksetzen beendet alle Sitzungen und Token dieses Kontos.

```bash
echo '{"password": "a new password of 12 to 128 characters"}' > reset.json
curl -fsS -X PATCH "$ARKVORY_URL/api/v1/users/$USER_ID" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" -d @reset.json
rm reset.json
```

Andere Dateischlüssel kann ein Administrator in der Schlüsseldatei hinzufügen. Jeder Eintrag hat eine `id`, den `sha256` des Geheimnisses, die `repositories` und `permissions` (`read` und `write`), die er erhält, und optional die Flags `administrator` und `serviceAdministrator`. Die Datei wird beim Start gelesen, starten Sie daher die API und den Worker nach einer Änderung neu.

## Download-Links {#download-links}

`POST /api/v1/repositories/{repository}/artifacts/{id}/links` gibt ein `token` (`dtl_…`) und eine `url` für ein Artefakt zurück. Fordern Sie eine Lebensdauer mit `ttlSeconds` an: 60 bis 86.400, standardmäßig 3.600. Der Aufrufer benötigt `content.read`.

Der Link funktioniert nur als `GET` oder `HEAD` von `/api/v1/repositories/{repository}/artifacts/{id}/content?token=…`, für dieses Artefakt in diesem Repository und nur zum Lesen. Er ist ein Geheimnis. Der Server kann ihn nicht vor dem Ablauf widerrufen, und er erscheint nicht in den Protokollen. Erstellen Sie Links mit der kürzesten Lebensdauer, die Sie brauchen.

## Was eine Zugriffsregel bedeutet {#access-rules}

Jeder Vorgang in der Referenz hat eine **Access**-Zeile. Dies sind die Arten von Regeln:

| Regel in der Referenz                                              | Was sie verlangt                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jeder, ohne Schlüssel                                              | Nichts. Liveness, Bereitschaftsstatus, Anmeldeoptionen, Anmeldung und Registrierung.                                                                                                                                                                                          |
| Jeder gültige Schlüssel oder jede Sitzung                          | Jede gültige Anmeldedaten. Beispiele: Fähigkeiten, die Vorgangsliste, Ihre eigene Identität, Bereitschaftsdetails und Metriken.                                                                                                                                               |
| Eine angemeldete Kontositzung (kein Schlüssel)                     | Eine Sitzung einer Person. Persönliche Token und Schlüssel werden abgelehnt (`session_required`). Beispiele: Erstellen und Widerrufen eigener Token, Ändern Ihres Passworts.                                                                                                  |
| Administrator                                                      | Die Sitzung eines Administratorkontos oder ein Dateischlüssel mit dem Administrator-Flag, etwa der Wiederherstellungsschlüssel. Persönliche Token und Dienstschlüssel werden abgelehnt (`administrator_required`). Beispiele: Konten, Gruppen, das Sicherheitsaudit, Updates. |
| Bootstrap-Schlüssel (Wiederherstellungsschlüssel der Installation) | Ein Dateischlüssel mit dem Dienstadministrations-Flag. Der Wiederherstellungsschlüssel hat ihn. Beispiele: Anlegen von Dienstkonten und Setzen von Delegierungen.                                                                                                             |
| Bootstrap-Schlüssel oder der Schlüssel selbst                      | Der Wiederherstellungsschlüssel oder der Schlüssel, dessen Delegierungen aufgelistet werden.                                                                                                                                                                                  |
| Der ausgegebene Schlüssel, vor oder nach der Aktivierung           | Der einzige Vorgang, der einen ausstehenden Schlüssel akzeptiert: die Aktivierung.                                                                                                                                                                                            |
| Repositorys, die der Aufrufer sehen darf                           | Die Aktion `repository.read` auf diesem Repository oder jeder Zugriff darauf für eine Sitzung oder einen Dateischlüssel. Ein Repository, das der Aufrufer nicht sehen kann, wird aus Listen weggelassen und antwortet `404`.                                                  |
| Systemberechtigung `backup.read` oder `backup.manage`              | Gehalten von Administrator-Sitzungen und von Dateischlüsseln mit einem Administrator-Flag. Dienstschlüssel und persönliche Token haben sie nie. `backup.manage` schließt `backup.read` ein.                                                                                   |
| Dienstadministrationsberechtigung                                  | Eine der sieben [Administrationsaktionen](#delegation) auf dem Zielkonto, aus einer Delegierung oder dem Wiederherstellungsschlüssel.                                                                                                                                         |
| Repository-Berechtigung                                            | **Alle** der aufgelisteten Repository-Aktionen auf dem im Pfad genannten Repository. Mehrere Zugriffsregeln fügen Bedingungen hinzu: der Upload, der Auftrag oder die Referenz muss dem Aufrufer gehören.                                                                     |

Der zweite Teil einer Repository-Zeile, etwa „file keys: `read`, `write`“, ist die grobe Gewährung, die Personen und Dateischlüssel anstelle der exakten Aktionen brauchen. Siehe [Gruppenzuweisungen](#group-grants).

Jenseits der Zugriffsregel lehnt der Server auch eine Änderung in einem Repository ab, das ein Spiegel ist (`409`, `mirror_read_only`), und ein Lese-Gateway lehnt jede Änderung ab (`405`, `read_only`).

## Repository-Berechtigungen {#repository-permissions}

### Gruppenzuweisungen {#group-grants}

Personen erhalten Repository-Zugriff über **Gruppen**. Ein Administrator gewährt einer Gruppe `read` oder `write` (angezeigt als „Read and write“) auf einem Repository und fügt Konten zur Gruppe hinzu. In der Konsole: [[ui:administration]], dann [[ui:manageGrants]] und [[ui:saveGrant]]. Die API-Aufrufe sind `PUT /api/v1/access-groups/{id}/grants/{repository}` mit `{"access": "read"}` oder `{"access": "write"}` und `PUT /api/v1/access-groups/{id}/members/{userId}`. Rechte werden bei jeder Anfrage neu berechnet, sodass eine Änderung sofort wirkt.

Eine `read`-Zuweisung gibt diese Aktionen: `repository.read`, `artifact.read`, `artifact.list`, `content.read`, `package.read`, `asset.read` und `annotation.read`. Eine `write`-Zuweisung fügt `upload.create`, `upload.read`, `upload.write`, `upload.complete`, `upload.cancel`, `job.read`, `package.publish`, `asset.write`, `asset.restore`, `annotation.write`, `reference.write`, `artifact.promote` und `audit.read` hinzu. Die Aktionen `artifact.delete`, `storage.read`, `storage.manage` und `diagnostics.read` können nicht aus einer Gruppe kommen: Nur ein Dienstschlüssel kann sie haben.

### Repository-Aktionen {#repository-actions}

Ein Dienstschlüssel trägt exakte Aktionen, Repository für Repository. Es gibt 24:

| Aktion             | Erlaubt                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `repository.read`  | Das Repository und seinen Spiegelstatus sehen.                                                                                             |
| `artifact.read`    | Details, Stufen und Hochstufungen eines Artefakts lesen. Wird auch bei jeder Änderung an einem Artefakt benötigt.                          |
| `artifact.list`    | Artefakte auflisten und durchsuchen, bereitgestellte Artefakte auflisten, das Hochstufungsjournal und den Änderungsfeed lesen.             |
| `artifact.promote` | Stufen setzen und entfernen und in ein anderes Repository hochstufen (kopieren oder verschieben).                                          |
| `artifact.delete`  | Artefakte löschen, Aufbewahrung vorschauen und anwenden sowie Container-Images entfernen und Git-LFS-Dateien zwangsweise entsperren.       |
| `content.read`     | Bytes nach ID, nach Paket oder nach Pfad herunterladen und Download-Links erstellen.                                                       |
| `upload.create`    | Upload-Sitzungen anlegen. Push in die Registrys und Git LFS verwenden es.                                                                  |
| `upload.read`      | Eigene Upload-Sitzungen und ihre Teile lesen.                                                                                              |
| `upload.write`     | Die Teile oder den ganzen Inhalt des eigenen Uploads senden.                                                                               |
| `upload.complete`  | Den eigenen Upload abschließen oder seinen Abschluss einreihen.                                                                            |
| `upload.cancel`    | Den eigenen ausstehenden Upload abbrechen.                                                                                                 |
| `job.read`         | Eigene Abschlussaufträge lesen.                                                                                                            |
| `package.read`     | Pakete auflisten, Versionen auflösen und Pakete herunterladen.                                                                             |
| `package.publish`  | Ein UPack-Archiv als Paket registrieren.                                                                                                   |
| `asset.read`       | Dateien nach Pfad auflisten und ihre Zeiger, ihren Verlauf und ihre Revisionen lesen. Das Herunterladen der Bytes benötigt `content.read`. |
| `asset.write`      | Einen Pfad auf ein Artefakt zeigen lassen oder eine Raw-Datei speichern.                                                                   |
| `asset.restore`    | Eine frühere Revision eines Pfads wiederherstellen.                                                                                        |
| `annotation.read`  | Labels, Metadaten, Sammlungen und Anhänge lesen.                                                                                           |
| `annotation.write` | Labels, Metadaten, Sammlungen und Anhänge ersetzen.                                                                                        |
| `reference.write`  | Referenzen hinzufügen und entfernen, die ein Artefakt schützen.                                                                            |
| `audit.read`       | Das Katalogaudit des Repositorys lesen.                                                                                                    |
| `storage.read`     | Kontingent, Nutzung, die Speicherrichtlinie und die Bereinigungseinstellungen lesen.                                                       |
| `storage.manage`   | Die Speicherrichtlinie und die Bereinigungseinstellungen ändern und die Bereinigung ausführen.                                             |
| `diagnostics.read` | Speichereignisse lesen.                                                                                                                    |

Die exakte Menge, die ein Vorgang benötigt, steht auf seiner Zeile in der Referenz, zum Beispiel `upload.write` und `upload.complete` für `putUploadContent`. Eine Änderung an einem Repository benötigt auch die passende `read`-Aktion, etwa `artifact.read` zusammen mit `annotation.write`.

Besitzerbedingungen gelten für Uploads und Aufträge: Sie handeln nur an den Upload-Sitzungen und Abschlussaufträgen, die Ihr Konto erstellt hat. Alle Schlüssel eines Dienstkontos und alle Sitzungen und Token einer Person zählen als derselbe Besitzer. Mehrere Dienste in einem Repository werden daher durch Konten und Repositorys getrennt, nicht durch Präfixe eines Pfads.

### Administrations- und Systemberechtigungen {#administration-permissions}

Zwei andere Arten von Berechtigungen sind keine Repository-Aktionen. Die sieben Administrationsaktionen sind unter [Delegierung](#delegation) aufgeführt. Die zwei Systemberechtigungen, `backup.read` und `backup.manage`, gehören nur Administratoren und dem Wiederherstellungsschlüssel.

## Anmeldegrenzen {#sign-in-limits}

Der Server verlangsamt das Erraten von Passwörtern, bevor er ein Passwort prüft. Die Zähler leben im Speicher jedes API-Prozesses und beginnen nach einem Neustart von vorn. Sie gelten pro Client-Adresse, wobei eine IPv6-Adresse nach ihrem /64-Präfix gezählt wird. Legen Sie hinter einem Reverse-Proxy `ARKVORY_TRUSTED_PROXIES` fest, sonst erscheint jeder Client als der Proxy.

| Grenze                               | Wert                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anmeldeversuche pro Adresse          | Ein Burst von 10, dann alle 15 Sekunden einer mehr. Eine erfolgreiche Anmeldung verbraucht keinen Versuch.                                                                                                                                                                                                                                                 |
| Fehlgeschlagene Passwörter pro Konto | Jedes falsche Passwort addiert 1 zu einer Schuld, die alle 6 Sekunden um 1 sinkt. Über 20 verweigert das Konto Versuche für 1 Sekunde, wobei sich die Zeit mit jedem weiteren Fehlschlag bis auf 2 Minuten verdoppelt; während dieser Zeit erhält selbst das richtige Passwort `429`. Eine erfolgreiche Anmeldung oder ein Zurücksetzen löscht die Schuld. |
| Registrierungen pro Adresse          | 3, dann alle 20 Minuten eine mehr.                                                                                                                                                                                                                                                                                                                         |
| Registrierungen pro Server           | 20, dann alle 3 Minuten eine mehr.                                                                                                                                                                                                                                                                                                                         |
| Laufende Anmeldeanfragen             | 16 pro API-Prozess, und der Body hat 10 Sekunden Zeit anzukommen. Mehr gibt `503` mit dem Code `busy` zurück.                                                                                                                                                                                                                                              |

Ein abgelehnter Versuch gibt `429` mit dem Code `rate_limited`, dem Grund `login_attempts`, `registration_attempts` oder `password_attempts` und `Retry-After` in Sekunden zurück. Warten Sie so lange; wiederholen Sie nicht in einer Schleife. Das Ändern oder Zurücksetzen eines Passworts hat sein eigenes Gate und den Grund `password_attempts`. Alle Anmeldungen, Registrierungen, Passwortänderungen und Tokenänderungen werden im Sicherheitsaudit (`GET /api/v1/security/audit`, nur Administratoren) aufgezeichnet, das 365 Tage lang aufbewahrt wird.

## Verwandte Seiten {#related}

- [HTTP-API-Übersicht](./index)
- [Fehler](./errors)
- [Konten und Zugriff](../use/accounts)
- [Sicherheit](../operate/security)
- [Clients und Protokolle](../protocols/index)
- Referenz: [Konten und Anmeldung](./reference/accounts), [Dienstkonten und Schlüssel](./reference/services)
