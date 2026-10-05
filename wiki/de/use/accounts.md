---
title: Konten und Zugriff
description: 'Erstellen Sie Benutzer und Gruppen, geben Sie ihnen Zugriff auf Repositorys und stellen Sie persönliche Token und Dienstschlüssel für CI aus.'
---

# Konten und Zugriff

Arkvory kennt vier Arten von Anmeldedaten. Personen melden sich mit einem Passwort an. Ihre eigenen Werkzeuge verwenden persönliche Zugriffstoken. CI-Systeme und Deployment-Agents verwenden Dienstschlüssel. Der Installer erzeugt einen weiteren Schlüssel, den Wiederherstellungsschlüssel, für die Einrichtung und Notfälle. Der Server prüft jede Anfrage gegen die Anmeldedaten, mit denen sie eingeht.

## Wer darf was {#overview}

| Anmeldedaten                | Erstellt von                                                  | Lebensdauer                          | Verwaltung                                                 | Repository-Zugriff                                                 |
| --------------------------- | ------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| Passwort-Sitzung            | Anmeldung                                                     | 12 Stunden                           | Benutzer und Gruppen, wenn das Konto ein Administrator ist | Lesen oder Schreiben je Repository, über Gruppen                   |
| Persönliches Zugriffstoken  | Sie, aus einer Passwort-Sitzung                               | 90 Tage standardmäßig, höchstens 365 | Nie                                                        | Ihre Gruppen, optional schreibgeschützt                            |
| Dienstschlüssel             | Der Wiederherstellungsschlüssel oder ein delegierter Operator | 90 Tage standardmäßig, höchstens 365 | Nur was der Besitzer delegiert hat                         | Die Richtlinie des Dienstkontos, eingeschränkt durch den Schlüssel |
| Wiederherstellungsschlüssel | Der Installer                                                 | Bis Sie ihn ersetzen                 | Benutzer, Gruppen, Dienstkonten, Backups                   | Lesen und Schreiben auf `releases`                                 |

Drei Dinge werden leicht übersehen:

- Ein Administratorkonto verwaltet Benutzer und Gruppen. Es gewährt keinen Zugriff auf Dateien. Dateien sind nur über Gruppen-Berechtigungen erreichbar.
- Ein Dienstschlüssel wird vom Wiederherstellungsschlüssel oder von einem Operator-Schlüssel erstellt, nicht von einer Passwort-Sitzung. Ein Administrator, der sich mit einem Passwort angemeldet hat, kann keine Dienstkonten erstellen.
- Ein persönliches Token oder ein Dienstschlüssel kann niemals Benutzer, Gruppen oder andere Token erstellen.

## Der Besitzer und der Wiederherstellungsschlüssel {#owner}

Das erste Konto ist der Besitzer. Es ist ein Administrator. Der Windows-Setup-Assistent erstellt es. Unter Linux und Docker erstellen Sie es in der Konsole mit dem Wiederherstellungsschlüssel, wie [Die Webkonsole](../guide/console#the-first-owner) beschreibt.

Der Besitzer ist Mitglied der Gruppe `arkvory-owners`, die Schreibzugriff auf das Repository `releases` hat. Für jedes andere Repository geben Sie selbst einer Gruppe Zugriff. Siehe [Gruppen und Repository-Zugriff](#groups).

Der Wiederherstellungsschlüssel ist die Datei `config/bootstrap-token.txt` im Installationsverzeichnis. Nur ein Administrator des Servers kann sie lesen. Kopieren Sie sie nicht nach CI oder auf Client-Rechner. Installations- und Update-Werkzeuge lesen sie, löschen Sie sie also nicht. Siehe [Sicherheit](../operate/security).

## Benutzer erstellen {#users}

Nur Administratoren erstellen Benutzer. Ein Name hat 3 bis 64 Buchstaben, Ziffern, `.`, `_` oder `-`. Ein Passwort hat 12 bis 128 Zeichen. Eine Installation fasst höchstens 1000 Konten.

In der Konsole:

1. Melden Sie sich als Administrator an und öffnen Sie [[ui:administration]].
2. Erweitern Sie [[ui:createUser]].
3. Geben Sie [[ui:accountName]] und [[ui:password]] ein. Kreuzen Sie [[ui:administrator]] nur für Personen an, die Benutzer verwalten.
4. Wählen Sie [[ui:createUser]].

Die Tabelle [[ui:accountsHeading]] listet die Konten auf. [[ui:disableUser]] sperrt ein Konto: Seine Sitzungen enden sofort, und seine persönlichen Token funktionieren nicht mehr, bis Sie [[ui:enableUser]] wählen. Um für jemanden ein neues Passwort festzulegen, erweitern Sie [[ui:resetPassword]]. Das beendet die Sitzungen des Kontos und widerruft alle seine persönlichen Token.

Mit der API rufen eine Administrator-Sitzung oder der Wiederherstellungsschlüssel diese Vorgänge auf: `createUser`, `updateUser` und `listUsers`.

```bash
curl -X POST "$ARKVORY/api/v1/users" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"anna","password":"a long password here","administrator":false}'
```

```typescript
await client.administration.users.create('anna', 'a long password here', false);
```

`arkvoryctl` hat keine Befehle für Konten. Verwenden Sie die Konsole oder die API.

Die Selbstregistrierung ist standardmäßig aus. Der Serveradministrator schaltet sie mit `ARKVORY_ALLOW_REGISTRATION=true` ein (siehe [Umgebungsvariablen](../reference/environment)). Dann erscheint [[ui:signUp]] auf der Anmeldekarte. Ein neues Konto hat keinen Zugriff auf ein Repository, bis ein Administrator es einer Gruppe hinzufügt. Die Selbstregistrierung endet bei 900 Konten, sodass 100 Plätze für Administratoren frei bleiben.

## Gruppen und Repository-Zugriff {#groups}

Personen erhalten Zugriff über Gruppen. Eine Gruppe hat Mitglieder und, für jedes Repository, eine Zugriffsstufe:

| Stufe in der Konsole | Bedeutung                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| [[ui:read]]          | Sehen und herunterladen                                                                            |
| [[ui:write]]         | Alles aus Lesen, und hochladen, veröffentlichen, Metadaten ändern, hochstufen und wiederherstellen |

Ein Repository hat keinen eigenen Erstellungsschritt. Es existiert, sobald eine Berechtigung oder eine Dienstrichtlinie seinen Namen nennt. Ein Name verwendet lateinische Kleinbuchstaben, Ziffern, `-` und `_`, beginnt mit einem Buchstaben oder einer Ziffer und hat höchstens 64 Zeichen. Siehe [Repositorys](./repositories).

Öffnen Sie in der Konsole [[ui:administration]]:

1. Erweitern Sie [[ui:createGroup]], geben Sie einen Namen für [[ui:accessGroup]] ein (2 bis 64 Buchstaben, Ziffern, `.`, `_` oder `-`) und wählen Sie [[ui:createGroup]].
2. Erweitern Sie [[ui:manageMembers]], wählen Sie die Gruppe und das Konto, und wählen Sie dann [[ui:addMember]]. [[ui:removeMember]] nimmt das Konto aus der Gruppe.
3. Erweitern Sie [[ui:manageGrants]], wählen Sie die Gruppe, geben Sie den Namen [[ui:repository]] ein, wählen Sie die Stufe [[ui:access]] und wählen Sie [[ui:saveGrant]]. [[ui:removeGrant]] nimmt den Zugriff weg.

Die Tabelle unter den Formularen zeigt die [[ui:members]] und [[ui:grants]] jeder Gruppe. Das Entfernen eines Mitglieds oder einer Berechtigung wirkt bei der nächsten Anfrage des Kontos. Die Dateien bleiben, wo sie sind.

Eine Installation fasst höchstens 100 Gruppen, 10 000 Mitgliedschaften und 10 000 Berechtigungen insgesamt.

Mit der API heißen die Vorgänge `createAccessGroup`, `addGroupMember`, `removeGroupMember`, `setGroupGrant` und `removeGroupGrant`:

```bash
curl -X PUT "$ARKVORY/api/v1/access-groups/$GROUP_ID/grants/builds" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"access":"write"}'
```

```typescript
await client.administration.groups.setGrant(groupId, 'builds', 'write');
```

## Berechtigungen {#permissions}

Hinter den beiden Stufen Lesen und Schreiben stehen 24 Repository-Aktionen. Ein Dienstschlüssel benennt diese Aktionen einzeln. `arkvoryctl doctor` und `GET /api/v1/auth/permissions` zeigen die Aktionen, die die aktuellen Anmeldedaten je Repository besitzen.

| Aktion             | Konsolen-Label                     | Er erlaubt                                                                             |
| ------------------ | ---------------------------------- | -------------------------------------------------------------------------------------- |
| `repository.read`  | [[ui:permission.repository.read]]  | Repositorys auflisten und die eigenen Rechte sehen. Kein Dateizugriff.                 |
| `artifact.list`    | [[ui:permission.artifact.list]]    | Artefakte auflisten und durchsuchen, die Stufenliste und das Hochstufungsjournal lesen |
| `artifact.read`    | [[ui:permission.artifact.read]]    | Artefaktdetails, Stufen und Hochstufungsverlauf eines Artefakts                        |
| `content.read`     | [[ui:permission.content.read]]     | Bytes herunterladen, Download-Links erstellen, ein Paket zum Download auflösen         |
| `upload.create`    | [[ui:permission.upload.create]]    | Einen Upload starten                                                                   |
| `upload.read`      | [[ui:permission.upload.read]]      | Zustand und Teile des eigenen Uploads lesen                                            |
| `upload.write`     | [[ui:permission.upload.write]]     | Die Bytes des eigenen Uploads senden                                                   |
| `upload.complete`  | [[ui:permission.upload.complete]]  | Den eigenen Upload abschließen, einen Abschlussauftrag starten                         |
| `upload.cancel`    | [[ui:permission.upload.cancel]]    | Den eigenen Upload abbrechen                                                           |
| `job.read`         | [[ui:permission.job.read]]         | Den eigenen Abschlussauftrag lesen                                                     |
| `package.read`     | [[ui:permission.package.read]]     | UPack-Pakete auflisten und eine Version auflösen                                       |
| `package.publish`  | [[ui:permission.package.publish]]  | Ein hochgeladenes Archiv als Paket registrieren                                        |
| `asset.read`       | [[ui:permission.asset.read]]       | Dateipfade, ihren Verlauf und ihre Revisionen lesen                                    |
| `asset.write`      | [[ui:permission.asset.write]]      | Ein Artefakt zum aktuellen Inhalt eines Pfads machen                                   |
| `asset.restore`    | [[ui:permission.asset.restore]]    | Eine frühere Revision eines Pfads wiederherstellen                                     |
| `annotation.read`  | [[ui:permission.annotation.read]]  | Labels, Metadaten, Sammlungen und Anhänge lesen                                        |
| `annotation.write` | [[ui:permission.annotation.write]] | Labels, Metadaten, Sammlungen und Anhänge ändern                                       |
| `artifact.promote` | [[ui:permission.artifact.promote]] | Stufen hinzufügen und entfernen, in das Repository hochstufen                          |
| `reference.write`  | [[ui:permission.reference.write]]  | Eine eigene externe Referenz an einem Artefakt hinzufügen und entfernen                |
| `audit.read`       | [[ui:permission.audit.read]]       | Das Katalog-Audit des Repositorys lesen                                                |
| `artifact.delete`  | [[ui:permission.artifact.delete]]  | Artefakte prüfen und löschen, Aufbewahrung als Vorschau anzeigen und anwenden          |
| `storage.read`     | [[ui:permission.storage.read]]     | Die Speicherrichtlinie, Belegung und Bereinigungseinstellungen lesen                   |
| `storage.manage`   | [[ui:permission.storage.manage]]   | Die Speicherrichtlinie und Bereinigungseinstellungen ändern und ausführen              |
| `diagnostics.read` | [[ui:permission.diagnostics.read]] | Speicherereignisse lesen                                                               |

Wie die Stufen einer Gruppe auf Aktionen abgebildet werden:

- **Lesen** gibt `repository.read`, `artifact.list`, `artifact.read`, `content.read`, `package.read`, `asset.read` und `annotation.read`.
- **Schreiben** gibt alles aus Lesen, und `upload.create`, `upload.read`, `upload.write`, `upload.complete`, `upload.cancel`, `job.read`, `package.publish`, `asset.write`, `asset.restore`, `annotation.write`, `artifact.promote`, `reference.write` und `audit.read`.
- **Keine Gruppenstufe gibt** `artifact.delete`, `storage.read`, `storage.manage` und `diagnostics.read`. Das Löschen von Artefakten und die Speicherverwaltung sind für Dienstschlüssel, die diese Aktionen benennen. Siehe [Speicher und Aufbewahrung](../operate/storage).

Ein Spiegel ist eine schreibgeschützte Kopie eines anderen Repositorys ([Spiegel](../operate/mirrors)). Jede Aktion, die ihn ändert, wird mit `409 mirror_read_only` abgelehnt, was auch immer die Berechtigungen sagen.

## Passwörter und Sitzungen {#passwords}

Melden Sie sich mit [[ui:accountName]] und [[ui:password]] in der Karte [[ui:connection]] an. Eine Sitzung dauert 12 Stunden. [[ui:disconnect]] beendet sie.

Um Ihr eigenes Passwort zu ändern, verwenden Sie [[ui:changeOwnPassword]] in derselben Karte. Geben Sie [[ui:currentPassword]] und [[ui:newPassword]] ein. Alle Ihre Sitzungen und persönlichen Token enden, Sie melden sich also erneut an und erstellen neue Token. Ein Administrator kann das Passwort eines anderen Kontos zurücksetzen, ohne das alte zu kennen.

Der Server verlangsamt das Raten:

- Eine Netzwerkadresse darf 10 Anmeldungen in einem Schub versuchen, danach eine weitere alle 15 Sekunden.
- Nach vielen falschen Passwörtern für ein Konto wartet das Konto immer länger, bis zu 2 Minuten. Auch das richtige Passwort wird während dieser Wartezeit abgelehnt. Die Antwort ist `429 rate_limited` mit `Retry-After`.
- Hinter einem Reverse-Proxy trägt der Administrator den Proxy in `ARKVORY_TRUSTED_PROXIES` ein. Andernfalls teilen sich alle Personen eine Adresse.

Mit der API tauscht `login` einen Namen und ein Passwort gegen eine Bearer-Sitzung, und `changeOwnPassword` ändert das Passwort:

```bash
curl -X POST "$ARKVORY/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"name":"anna","password":"a long password here"}'
```

## Persönliche Zugriffstoken {#tokens}

Ein persönliches Zugriffstoken ist ein Schlüssel für Ihre eigenen Werkzeuge: ein Skript auf Ihrem Rechner, `arkvoryctl` oder das SDK. Es handelt als Sie, mit den Repositorys Ihrer Gruppen.

Nur eine Passwort-Sitzung erstellt Token. Ein Token kann kein weiteres Token erstellen und hat keine Administratorrechte.

1. Melden Sie sich mit Ihrem Passwort an.
2. Erweitern Sie in der Karte [[ui:connection]] den Bereich [[ui:personalAccessTokens]].
3. Geben Sie einen [[ui:tokenName]] ein. Wählen Sie [[ui:tokenExpiry]]: [[ui:tokenDays30]], [[ui:tokenDays90]] oder [[ui:tokenDays365]].
4. Wählen Sie [[ui:tokenScope]]: [[ui:tokenScopeRead]] oder [[ui:tokenScopeReadWrite]]. Ein Lese-Token lehnt jede Änderung mit `403 read_only_token` ab.
5. Wählen Sie [[ui:generateToken]], dann [[ui:copyToken]]. Das Token wird einmal angezeigt. Es beginnt mit `pat_`.

Die Tabelle zeigt für jedes Token [[ui:tokenPrefix]], [[ui:tokenCreated]], [[ui:tokenExpires]], [[ui:tokenLastUsed]] und [[ui:tokenStatus]]: [[ui:tokenActive]], [[ui:tokenExpired]] oder [[ui:tokenRevokedState]]. Um ein Token zu stoppen, wählen Sie [[ui:revokeToken]] und bestätigen mit [[ui:tokenRevokeConfirmSubmit]]. Clients, die es verwenden, verlieren sofort den Zugriff.

Ein Konto darf 50 aktive Token halten. Ein Administrator kann die Token jedes Kontos mit `listAccountTokens` und `revokeAccountToken` auflisten und widerrufen.

Mit der API hat ein Token einen Namen und optional ein Ablaufdatum (bis zu 365 Tage ab jetzt) und einen Bereich:

```bash
curl -X POST "$ARKVORY/api/v1/auth/tokens" \
  -H "Authorization: Bearer $SESSION" \
  -H "Content-Type: application/json" \
  -d '{"name":"laptop","scope":"read-write","expiresAt":"2027-01-31T00:00:00Z"}'
```

```typescript
const created = await client.identity.createToken('laptop', { scope: 'read-write' });
console.log(created.token); // shown once
```

Der Standardbereich der API ist `read-write`. Die Konsole wählt [[ui:tokenScopeRead]] vor.

Geben Sie das Token `arkvoryctl` in einer privaten Datei. Siehe [Kommandozeile](../protocols/cli#connect-to-a-server).

## Dienstkonten und Schlüssel für CI {#service-accounts}

Ein Dienstkonto ist eine Identität für ein Werkzeug, nicht für eine Person. Es hat eine **Richtlinie**: die Repositorys und Aktionen, die es verwenden darf. Ein Dienstkonto hat Schlüssel. Auch ein Schlüssel hat seine eigene Liste von Repositorys und Aktionen. Die wirksamen Rechte sind die Schnittmenge der beiden Listen, Aktion für Aktion. Eine leere Richtlinie gewährt keinen Dateizugriff.

Sie verwalten den Dienstzugriff mit dem Wiederherstellungsschlüssel oder mit einem Operator-Schlüssel, dem der Besitzer Rechte delegiert hat. In der Konsole:

1. Wählen Sie [[ui:disconnect]], wenn Sie angemeldet sind. Öffnen Sie dann [[ui:keySignIn]], fügen Sie den Wiederherstellungsschlüssel in [[ui:serviceKey]] ein und wählen Sie [[ui:connect]].
2. Öffnen Sie [[ui:services]]. Der Bereich erscheint nur für den Wiederherstellungsschlüssel und für Operator-Schlüssel.

### Ein Konto und seine Richtlinie erstellen {#service-policy}

1. Erweitern Sie in [[ui:services]] den Bereich [[ui:serviceCreate]].
2. Geben Sie einen [[ui:serviceName]] ein (3 bis 64 Buchstaben, Ziffern, `.`, `_` oder `-`).
3. Wählen Sie unter [[ui:servicePolicy]] [[ui:bindingAdd]] und geben Sie den Namen [[ui:repository]] ein.
4. Füllen Sie die Berechtigungen aus: [[ui:bindingRead]] und [[ui:bindingPublish]] setzen typische Sätze, [[ui:bindingNone]] löscht sie, und [[ui:bindingPermissions]] listet jede Aktion. Wählen Sie [[ui:bindingRemove]], um ein Repository zu entfernen.
5. Wählen Sie [[ui:serviceCreate]].

Die beiden Voreinstellungen sind:

| Voreinstellung        | Aktionen                                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [[ui:bindingRead]]    | `repository.read`, `artifact.read`, `artifact.list`, `content.read`, `package.read`, `asset.read`, `annotation.read`                                                    |
| [[ui:bindingPublish]] | Der Lesesatz sowie `upload.create`, `upload.read`, `upload.write`, `upload.complete`, `upload.cancel`, `job.read`, `package.publish`, `asset.write`, `annotation.write` |

Keine der beiden Voreinstellungen enthält Hochstufung, Wiederherstellung oder Löschung. Fügen Sie `artifact.promote` für einen Hochstufungsauftrag hinzu. Ein Deployment-Agent, der nur herunterlädt, braucht den Lesesatz für `arkvoryctl`. Für einen einfachen HTTP-Download eines Pakets nach Namen genügt `content.read` allein.

Eine Richtlinie hat höchstens 64 Repositorys, und eine Installation hat höchstens 1000 Dienstkonten. Eine gespeicherte Richtlinie hat eine Version. Ändert jemand sie zwischenzeitlich, zeigt die Konsole einen Konflikt und behält Ihren Entwurf: Wählen Sie [[ui:serviceRefresh]] und wenden Sie Ihre Änderung erneut an. [[ui:serviceDisable]] sperrt jeden Schlüssel des Kontos. Übertragungen, die bereits laufen, dürfen noch abschließen.

### Einen Schlüssel ausstellen, speichern und aktivieren {#service-key-issue}

1. Öffnen Sie das Konto und seine [[ui:serviceKeys]].
2. Erweitern Sie [[ui:keyIssue]]. Geben Sie einen [[ui:keyName]] ein. Legen Sie den Ablauf in [[ui:keyExpiry]] fest, oder lassen Sie das Feld für 90 Tage leer. Der längste Ablauf ist 365 Tage.
3. Verengen Sie die Berechtigungen, wenn der Schlüssel weniger als das Konto braucht. Wählen Sie [[ui:keyIssue]].
4. Das Fenster [[ui:keySecret]] zeigt das Geheimnis einmal. Wählen Sie [[ui:keyCopy]] und speichern Sie es in Ihrem CI-Secret-Speicher. Das Geheimnis beginnt mit `arkvory_`.
5. Kreuzen Sie [[ui:keySaved]] an und wählen Sie [[ui:keyActivate]].

Ein Schlüssel, der nicht aktiviert wird, ist nutzlos und läuft nach 15 Minuten ab. Er erscheint als [[ui:keyPending]], bis Sie ihn aktivieren. Ein Konto darf gleichzeitig 3 aktive und 2 ausstehende Schlüssel halten. Die Zustände sind [[ui:keyPending]], [[ui:keyActive]], [[ui:keyRevoked]] und [[ui:keyExpired]]; [[ui:keyDetails]] listet die ID und die Berechtigungen eines Schlüssels.

Geht die Antwort verloren, bevor Sie das Geheimnis kopieren, kann der Server es nicht erneut anzeigen. Widerrufen Sie den Schlüssel und stellen Sie einen neuen aus.

Mit der API erstellt der Wiederherstellungsschlüssel das Konto und stellt dann den Schlüssel aus. Der Header `Idempotency-Key` (1 bis 128 Buchstaben, Ziffern, `.`, `_`, `:` oder `-`) macht eine wiederholte Anfrage sicher, aber eine Wiederholung liefert kein Geheimnis. Der Schlüssel aktiviert sich selbst, wenn er `activateServiceKey` aufruft:

```bash
curl -X POST "$ARKVORY/api/v1/service-accounts" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" \
  -d '{"name":"ci-prod","bindings":[{"resource":{"kind":"repository","id":"releases"},"actions":["repository.read","artifact.read","artifact.list","content.read","package.read","upload.create","upload.read","upload.write","upload.complete","job.read","package.publish","asset.read","asset.write"]}]}'

curl -X POST "$ARKVORY/api/v1/service-accounts/$ACCOUNT_ID/keys" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: ci-prod-2026-10" \
  -d '{"name":"pipeline-2026","bindings":[{"resource":{"kind":"repository","id":"releases"},"actions":["content.read","package.read","artifact.read"]}]}'

curl -X POST "$ARKVORY/api/v1/auth/activate-key" -H "Authorization: Bearer $NEW_SECRET"
```

Dieselben Schritte im SDK:

```typescript
const account = await root.administration.services.create('ci-prod', bindings);
const issued = await root.administration.credentials.issue(account.id, requestId, {
  name: 'pipeline-2026',
  bindings,
});
if (!issued.secret) throw new Error('Lost response: revoke the key and issue another');
await saveToSecretStore(issued.secret);
await new ArkvoryClient(url, () => issued.secret ?? '').identity.activateKey();
```

Geben Sie dem Job den aktivierten Schlüssel als `ARKVORY_TOKEN_FILE` oder `ARKVORY_TOKEN`. Siehe das [CI-Beispiel](../protocols/cli#ci-example).

### Rotieren und widerrufen {#service-key-rotate}

Rotieren Sie einen Schlüssel vor seinem Ablauf, ohne Lücke:

1. Wählen Sie neben dem Schlüssel [[ui:keyRotate]]. Das Formular ist mit den Berechtigungen des alten Schlüssels gefüllt. Sie dürfen sie nur behalten oder verringern.
2. Stellen Sie den neuen Schlüssel aus, speichern Sie sein Geheimnis und aktivieren Sie ihn.
3. Stellen Sie Ihre Jobs auf das neue Geheimnis um.
4. Wählen Sie [[ui:keyRevoke]] beim alten Schlüssel.

Das Aktivieren des neuen Schlüssels begrenzt den alten auf höchstens 24 weitere Stunden, damit ein vergessener alter Schlüssel nicht weiterlebt. Das Widerrufen ist endgültig und fragt nach dem Schlüsselnamen. Neue Anfragen mit dem Schlüssel werden sofort abgelehnt. Übertragungen, die bereits laufen, dürfen noch abschließen. Mit der API heißen die Vorgänge `rotateServiceKey` und `revokeServiceKey`.

[[ui:serviceAudit]] am Konto zeigt, wer Schlüssel ausgestellt, aktiviert, rotiert und widerrufen hat, mit der Uhrzeit. Er speichert keine Geheimnisse. Der Server behält die letzten 100 000 Ereignisse aller Konten.

### Delegierte Verwaltung {#delegation}

Verwenden Sie im Alltag nicht den Wiederherstellungsschlüssel. Der Besitzer kann Teile der Dienstverwaltung an einen **Operator-Schlüssel** übergeben und den Wiederherstellungsschlüssel offline halten.

1. Erstellen Sie mit dem Wiederherstellungsschlüssel ein Dienstkonto für den Operator mit einer leeren Richtlinie, und stellen und aktivieren Sie einen Schlüssel dafür aus.
2. Öffnen Sie [[ui:serviceKeys]] dieses Kontos und wählen Sie [[ui:delegations]] beim Schlüssel.
3. Erweitern Sie [[ui:delegationNew]]. Geben Sie [[ui:delegationTarget]] ein, das Konto, das der Operator verwalten wird.
4. Kreuzen Sie die [[ui:delegationActions]] an und legen Sie die [[ui:delegationCeiling]] fest, das Höchste, was der Operator in Repositorys gewähren darf.
5. Wählen Sie [[ui:delegationSave]].

Die sieben Aktionen sind:

| Aktion                   | Konsolen-Label                           | Der Operator darf                                   |
| ------------------------ | ---------------------------------------- | --------------------------------------------------- |
| `service-account.read`   | [[ui:permission.service-account.read]]   | Das Konto sehen                                     |
| `service-account.manage` | [[ui:permission.service-account.manage]] | Es aktivieren und deaktivieren                      |
| `policy.read`            | [[ui:permission.policy.read]]            | Seine Richtlinie lesen                              |
| `policy.manage`          | [[ui:permission.policy.manage]]          | Seine Richtlinie ersetzen                           |
| `credential.read`        | [[ui:permission.credential.read]]        | Seine Schlüssel auflisten                           |
| `credential.manage`      | [[ui:permission.credential.manage]]      | Seine Schlüssel ausstellen, rotieren und widerrufen |
| `service-audit.read`     | [[ui:permission.service-audit.read]]     | Sein Aktivitätsprotokoll lesen                      |

Regeln:

- Alles, was der Operator festlegt, muss innerhalb der Obergrenze bleiben. Ein von ihm ausgestellter Schlüssel läuft nicht später ab als sein eigener Schlüssel.
- Ein Operator darf Schlüssel für das Zielkonto ausstellen; behandeln Sie die Delegierung daher als Vertrauen in alles, was die Obergrenze erlaubt.
- Ein Operator kann sein eigenes Konto nicht verwalten und nicht weiter delegieren. Ein Konto kann nicht zugleich Ziel und Operator sein.
- Das Entfernen einer Delegierung mit [[ui:delegationRemove]] widerruft nicht die Schlüssel, die der Operator bereits aktiviert hat. Widerrufen Sie sie selbst.
- Der Operator sieht seine eigenen Zuweisungen in [[ui:delegationOwn]].

Nur der Wiederherstellungsschlüssel setzt Delegierungen. Die Vorgänge sind `listServiceDelegations`, `setServiceDelegation` und `removeServiceDelegation`.

## Audit {#audit}

Administratoren können das Sicherheitsjournal der Installation lesen: Anmeldungen und Fehlschläge, Registrierungen, Passwortänderungen und -zurücksetzungen, Änderungen an Benutzern, Gruppen und Berechtigungen sowie die Erstellung und den Widerruf von Token. Jeder Eintrag enthält die Uhrzeit, den Akteur, die Art der Anmeldedaten, die Client-Adresse, das Ziel und das Ergebnis (`success`, `failure` oder `denied`). Er enthält keine Passwörter oder Geheimnisse. Der Server behält Einträge 365 Tage oder 1 000 000 Einträge, je nachdem, was zuerst eintritt.

Die Konsole hat keinen Bereich für dieses Journal. Lesen Sie es mit der API, mit einer Administrator-Sitzung oder dem Wiederherstellungsschlüssel. Seiten enthalten standardmäßig 50 Einträge, höchstens 100, neueste zuerst. Übergeben Sie `next` als `after` für die nächste Seite.

```bash
curl -H "Authorization: Bearer $ADMIN_KEY" "$ARKVORY/api/v1/security/audit?limit=20"
```

```typescript
const page = await client.administration.security.audit({ limit: 20 });
```

Das Aktivitätsprotokoll eines Dienstkontos ist getrennt. Siehe [Einen Schlüssel ausstellen, speichern und aktivieren](#service-key-issue).

## Wenn der Besitzer ausgesperrt ist {#recovery}

Wenn sich niemand als Administrator anmelden kann, verwenden Sie den Wiederherstellungsschlüssel:

1. Lesen Sie den Schlüssel auf dem Server: `config/bootstrap-token.txt` im Installationsverzeichnis. Nur ein Serveradministrator kann das.
2. Öffnen Sie in der Konsole [[ui:keySignIn]], fügen Sie den Schlüssel in [[ui:serviceKey]] ein und wählen Sie [[ui:connect]].
3. Öffnen Sie [[ui:administration]]. Erweitern Sie [[ui:resetPassword]], wählen Sie das Konto, geben Sie ein [[ui:newPassword]] ein und wählen Sie [[ui:resetPassword]]. Wird das Konto als deaktiviert angezeigt, wählen Sie [[ui:enableUser]].
4. Melden Sie sich mit dem neuen Passwort an.

Sie können auch einen neuen Administrator mit [[ui:createUser]] erstellen und [[ui:administrator]] ankreuzen.

Das Formular [[ui:welcomeOwner]] funktioniert nur, solange die Installation keine Konten hat. Verwenden Sie den Wiederherstellungsschlüssel später, um Konten zu reparieren, nicht um von vorn zu beginnen.

Geht der Wiederherstellungsschlüssel selbst verloren, ersetzt der Serveradministrator den SHA-256 des Schlüssels in `config/keys.json` und startet die API neu. Siehe [Sicherheit](../operate/security).

## Verwandte Seiten {#related-pages}

- [Die Webkonsole](../guide/console)
- [Repositorys](./repositories)
- [Kommandozeile (arkvoryctl)](../protocols/cli)
- [Authentifizierung](../api/authentication) und die API-Referenz: [Konten und Anmeldung](../api/reference/accounts), [Dienstkonten und Schlüssel](../api/reference/services)
- [Sicherheit](../operate/security)
