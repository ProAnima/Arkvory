---
title: 'Webhooks'
description: 'Erhalten Sie eine HTTP-Anfrage, wenn sich ein Repository ändert: Abonnement einrichten, Signatur prüfen und wiederholte Zustellungen behandeln.'
---

# Webhooks

Ein Webhook meldet Ihrem System, dass sich in einem Repository etwas geändert hat, sodass es nicht abfragen muss. Der Arkvory-Worker sendet für jedes Ereignis des [Änderungs-Feeds](../api/reference/artifacts#listCatalogChanges) des Repositorys ein HTTP-`POST` an Ihre URL. Damit starten Sie ein Deployment, wenn ein Build veröffentlicht wird, oder aktualisieren einen Cache, wenn ein Pfad eine neue Version bekommt.

Der Administrator legt die Abonnements in einer Datei fest. Eine API oder Konsolenseite dafür gibt es noch nicht. Den Feed können Sie auch selbst lesen: `GET /api/v1/repositories/<repository>/changes`.

## So funktioniert die Zustellung {#how-it-works}

- **Ein Abonnement folgt einem Repository** und sendet an eine URL.
- **Ereignisse kommen der Reihe nach, eines nach dem anderen.** Das nächste wartet, bis der Empfänger mit einem `2xx`-Status geantwortet hat.
- **Die Zustellung erfolgt mindestens einmal.** Nach einem Absturz oder einer verlorenen Antwort kann dasselbe Ereignis erneut eintreffen. Jedes Ereignis hat eine stabile `id`: Entdoppeln Sie damit.
- **Ein neues Abonnement erhält nur neue Ereignisse.** Ereignisse vor seiner Erstellung werden nicht gesendet.
- **Ein ausgefallener Empfänger verzögert nur sein eigenes Abonnement.** Das Ereignis wartet. Arkvory versucht es nach 12 Sekunden erneut, verdoppelt die Pause bis auf eine Stunde und sendet die Ereignisse der Reihe nach, sobald der Empfänger wieder antwortet. Uploads und Downloads warten nie auf einen Webhook.

## Ein Abonnement einrichten {#set-up}

Sie brauchen Zugriff auf die Serverdateien und das Recht, den Worker neu zu starten. Siehe [Konfiguration](../install/configuration).

1. Erstellen Sie eine Datei mit dem Signatur-Secret: mindestens 16 zufällige druckbare Zeichen, zum Beispiel `/root/ci.secret`. Der Empfänger braucht dasselbe Secret.
2. Führen Sie `configure` mit dem Abonnement aus. Der Befehl prüft Ihre Eingaben, kopiert das Secret nach `config/webhooks`, schreibt die Abonnement-Datei und die Einstellung, startet die Dienste neu und stellt die frühere Konfiguration wieder her, wenn sie nicht bereit werden. Der Empfänger wird nicht kontaktiert.

```bash
sudo arkvory configure --root /opt/proanima-arkvory \
  --webhook ci --webhook-repository releases \
  --webhook-url https://ci.example.com/hooks/arkvory \
  --webhook-secret-file /root/ci.secret \
  --webhook-actions artifact.publish
```

3. Suchen Sie `webhook.started` im Worker-Log, veröffentlichen Sie eine Datei und beobachten Sie Ihren Empfänger.

Der Befehl schreibt `config/webhooks/webhooks.json`; Sie können die Datei auch von Hand schreiben und in `ARKVORY_WEBHOOKS_FILE` angeben. Um ein Abonnement zu ändern, führen Sie den Befehl mit demselben Namen erneut aus. `--webhook-detach ci` entfernt es: Seine Dateien werden gelöscht, seine Position wird vergessen. Ein Aufruf ändert ein Abonnement und lässt sich nicht mit anderen `configure`-Optionen mischen.

Die Datei hat diese Felder:

```json
{
  "webhooks": [
    {
      "id": "ci",
      "repository": "releases",
      "url": "https://ci.example.com/hooks/arkvory",
      "secretFile": "/opt/proanima-arkvory/config/webhooks/ci.secret",
      "actions": ["artifact.publish"]
    }
  ]
}
```

| Feld             | Bedeutung                                                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | Name des Abonnements: 1 bis 64 Zeichen `a-z`, `0-9`, `_` und `-`. Unter diesem Namen wird sein Fortschritt gespeichert.                                                                            |
| `repository`     | Das Repository, dessen Feed gesendet wird.                                                                                                                                                         |
| `url`            | Der Empfänger. HTTPS, ohne Benutzername, Query und Fragment, höchstens 2048 Zeichen. Unverschlüsseltes HTTP ist nur für `localhost`, `127.0.0.1` und `[::1]` erlaubt.                              |
| `secretFile`     | Absoluter Pfad der Datei mit dem Signatur-Secret.                                                                                                                                                  |
| `nextSecretFile` | Optionales zweites Secret für eine [Rotation](#rotate-the-secret).                                                                                                                                 |
| `actions`        | Optionale Liste der zu sendenden Feed-Aktionen, zum Beispiel `artifact.publish`, `artifact.delete`, `asset.replace`, `stage.added` und `package.register`. Ohne sie werden alle Aktionen gesendet. |

Eine fehlerhafte Datei stoppt den Worker beim Start mit `worker.unavailable`. Erlaubt sind bis zu 16 Abonnements. Bei einer Compose-Installation bindet der Befehl `config/webhooks` auch in den Worker-Container ein.

## Die Anfrage {#request}

| Header                | Wert                                                                               |
| --------------------- | ---------------------------------------------------------------------------------- |
| `Content-Type`        | `application/json`                                                                 |
| `X-Arkvory-Delivery`  | Die `id` des Ereignisses. Sie ist bei jeder Wiederholung eines Ereignisses gleich. |
| `X-Arkvory-Event`     | Die Feed-Aktion, zum Beispiel `artifact.publish`.                                  |
| `X-Arkvory-Timestamp` | Unix-Zeit in Sekunden, zu der die Anfrage signiert wurde.                          |
| `X-Arkvory-Signature` | `sha256=<hex>`. Während einer Rotation gibt es zwei Werte, durch Komma getrennt.   |

Der Body ist JSON:

```json
{
  "id": "releases:128",
  "repository": "releases",
  "sequence": "128",
  "action": "artifact.publish",
  "artifactId": "00000000-0000-4000-8000-000000000001",
  "detail": null
}
```

`sequence` ist die Position im Feed, eine Dezimalzeichenfolge. `detail` ist bei Aktionen, die einen haben, der Dateipfad oder die Stufe. Der Body enthält keinen Autor, keinen Dateiinhalt und keine Metadaten: Lesen Sie mit `artifactId` den aktuellen Zustand über die [API](../api/index).

Antworten Sie innerhalb von 10 Sekunden mit einem beliebigen `2xx`-Status. Ein `3xx`-Status (Weiterleitungen werden nicht verfolgt), `4xx`, `5xx`, ein Verbindungsfehler oder ein Timeout zählt als Fehlschlag. Arkvory liest höchstens 4 KiB der Antwort und ignoriert sie.

## Die Signatur prüfen {#verify}

Die Signatur ist HMAC-SHA256 mit Ihrem Secret über den Text `<timestamp>.<body>`, geschrieben als `sha256=` und der Hex-Digest. Prüfen Sie sie, bevor Sie einer Anfrage trauen:

1. Lesen Sie den rohen Body, vor jedem JSON-Parsen.
2. Lehnen Sie die Anfrage ab, wenn der Zeitstempel um mehr als 5 Minuten von Ihrer Uhr abweicht.
3. Berechnen Sie die Signatur und vergleichen Sie sie mit einer Funktion mit konstanter Laufzeit. Hat der Header zwei Werte, akzeptieren Sie beide.

Node.js:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(secret, headers, rawBody) {
  const timestamp = headers['x-arkvory-timestamp'];
  if (!/^\d{1,12}$/.test(timestamp ?? '')) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = Buffer.from(
    'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex'),
  );
  return String(headers['x-arkvory-signature'] ?? '')
    .split(',')
    .some((given) => {
      const actual = Buffer.from(given.trim());
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    });
}
```

Python:

```python
import hashlib, hmac, time

def verify(secret: bytes, headers, raw_body: bytes) -> bool:
    timestamp = headers.get("X-Arkvory-Timestamp", "")
    if not timestamp.isdigit() or abs(time.time() - int(timestamp)) > 300:
        return False
    digest = hmac.new(secret, timestamp.encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    expected = "sha256=" + digest
    given = headers.get("X-Arkvory-Signature", "").split(",")
    return any(hmac.compare_digest(part.strip(), expected) for part in given)
```

## Wiederholte Zustellungen behandeln {#repeats}

- Speichern Sie die `id` jedes verarbeiteten Ereignisses und ignorieren Sie eine Wiederholung.
- Antworten Sie schnell: Stellen Sie die Arbeit in eine Warteschlange und geben Sie `204` zurück. Ein langsamer Empfänger verzögert alle späteren Ereignisse seines Abonnements.
- Eine Wiederholung heißt nicht, dass die Operation zweimal stattfand. Behandeln Sie ein Ereignis als Hinweis und lesen Sie den aktuellen Zustand aus der API.

## Das Secret rotieren {#rotate-the-secret}

1. Führen Sie denselben Befehl mit `--webhook-secret-file` für das aktuelle und `--webhook-next-secret-file` für das neue Secret aus. Jede Anfrage trägt nun zwei Signaturen.
2. Stellen Sie den Empfänger auf das neue Secret um. Ein Empfänger, der beide Signaturen akzeptiert, funktioniert in der Zwischenzeit weiter.
3. Führen Sie den Befehl erneut aus, mit der neuen Secret-Datei als `--webhook-secret-file` und ohne `--webhook-next-secret-file`.

## Private Empfänger und Zertifikate {#private-receivers}

- Arkvory lehnt Empfänger auf Loopback-, privaten, Link-Local- und Cloud-Metadaten-Adressen ab, ebenso Namen, die darauf auflösen. So lässt sich der Server nicht nutzen, um interne Dienste zu erreichen.
- Um an einen Empfänger in Ihrem Netzwerk zu senden, fügen Sie das Netz mit `--webhook-allow-private` hinzu, zum Beispiel `--webhook-allow-private 10.20.0.0/16` (`ARKVORY_WEBHOOKS_ALLOW_PRIVATE`). Es bleibt, bis das letzte Abonnement entfernt wird.
- Stammt das Zertifikat des Empfängers von Ihrer eigenen Zertifizierungsstelle, fügen Sie mit `--webhook-ca-file` eine PEM-Datei mit dieser Stelle hinzu (`ARKVORY_WEBHOOKS_CA_FILE`). Das Zertifikat wird immer geprüft.

## Webhooks überwachen {#monitor}

Der Worker schreibt `webhook.step_failed` mit einem `errorCode`, wenn eine Zustellung fehlschlägt, und `webhook.recovered`, wenn sie wieder funktioniert. Die Metriken `arkvory_webhook_failing` und `arkvory_webhook_last_success_timestamp_seconds` und der Alarm `ArkvoryWebhookFailing` sind unter [Überwachung](../operate/monitoring) beschrieben. `webhook.stopped` markiert das Ende der Schleife eines Abonnements: beim Herunterfahren oder wenn der Worker den Besitz des Speichers verliert. `webhook.prune_failed` bedeutet, dass der Worker entfernte Abonnements beim Start nicht vergessen konnte; er versucht es beim nächsten Start erneut. Die Codes `unavailable` und `internal` erscheinen nur im Protokoll, nicht in `arkvory_webhook_failing`.

## Ein Abonnement, das nicht weiterkommt {#stuck}

Arkvory überspringt nie ein Ereignis: Darauf beruht die Zuverlässigkeit der Zustellung. Ein Empfänger, der ein Ereignis immer wieder ablehnt, zum Beispiel mit `400`, weil er es nicht lesen kann, hält deshalb sein ganzes Abonnement an. Kein späteres Ereignis dieses Abonnements wird gesendet; andere Abonnements laufen weiter. Der Worker schreibt `webhook.step_failed` mit `http_4xx` und wiederholt mit Pausen bis zu einer Stunde, `arkvory_webhook_failing` ist `1`, und der Alarm `ArkvoryWebhookFailing` löst nach 15 Minuten aus.

1. Korrigieren Sie den Empfänger, sodass er das Ereignis mit `2xx` beantwortet. Arkvory sendet es beim nächsten Versuch, spätestens etwa eine Stunde später, und danach alle wartenden Ereignisse der Reihe nach. Ein erneutes `configure` mit demselben Namen und Repository behält die Position.
2. Kann das Ereignis nie angenommen werden, entfernen Sie das Abonnement mit `--webhook-detach` und fügen Sie es erneut hinzu. Es beginnt am Ende des Feeds: Die wartenden Ereignisse werden **nicht** gesendet. Lesen Sie sie aus dem [Änderungsfeed](../api/reference/artifacts#listCatalogChanges) nach der letzten `sequence`, die Ihr Empfänger verarbeitet hat.

## Fehlerbehebung {#troubleshooting}

| `errorCode`   | Ursache und was zu tun ist                                                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blocked`     | Die Empfängeradresse ist nicht erlaubt (Loopback, privat, Link-Local oder Metadaten). Verwenden Sie eine öffentliche Adresse oder tragen Sie das Netz in `ARKVORY_WEBHOOKS_ALLOW_PRIVATE` ein. |
| `timeout`     | Keine Antwort innerhalb von 10 Sekunden. Antworten Sie schneller und stellen Sie die Arbeit in eine Warteschlange.                                                                             |
| `network`     | Verbindung abgelehnt, Name nicht gefunden oder Verbindung zurückgesetzt. Prüfen Sie URL, DNS und Firewall vom Server aus.                                                                      |
| `tls`         | Das Zertifikat ist nicht vertrauenswürdig, abgelaufen oder hat den falschen Namen. Beheben Sie das oder setzen Sie `ARKVORY_WEBHOOKS_CA_FILE`.                                                 |
| `redirect`    | Der Empfänger antwortete `3xx`. Weiterleitungen werden nicht verfolgt: Verwenden Sie die endgültige URL.                                                                                       |
| `http_4xx`    | Der Empfänger hat die Anfrage abgelehnt. Prüfen Sie seine Signaturprüfung, seinen Pfad und seinen Schlüssel.                                                                                   |
| `http_5xx`    | Der Empfänger ist ausgefallen. Arkvory versucht es weiter, mit bis zu einer Stunde Abstand.                                                                                                    |
| `secret`      | Die Secret-Datei fehlt, ist nicht lesbar oder kürzer als 16 Bytes.                                                                                                                             |
| `unavailable` | Der Worker konnte den Feed oder den Zustand des Abonnements nicht aus der Datenbank lesen. Nichts wurde gesendet; er versucht es nach 5 Sekunden erneut. Prüfen Sie die Datenbank.             |
| `internal`    | Ein unerwarteter Fehler im Worker. Nichts wurde gesendet; er versucht es nach 5 Sekunden erneut. Melden Sie ihn mit dem Worker-Protokoll.                                                      |

Es kommt nichts an? Prüfen Sie, ob `webhook.started` im Worker-Log steht, ob `ARKVORY_WEBHOOKS_FILE` gesetzt ist, den Namen des Repositorys und den Filter `actions`. Ein neues Abonnement sendet nur Ereignisse nach seinem ersten Schritt.

## Verwandte Seiten {#related-pages}

- [Konfiguration](../install/configuration)
- [Überwachung](../operate/monitoring)
- [Der Änderungs-Feed in der API-Referenz](../api/reference/artifacts#listCatalogChanges)
