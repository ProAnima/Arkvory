---
title: Container-Images
description: Docker- und OCI-Images, Helm-Charts und ORAS-Artefakte über die Registry pushen und pullen, die jedes Repository unter /v2 bereitstellt.
---

# Container-Images

Jedes Arkvory-Repository ist zugleich eine Container-Registry. Docker, Podman, Buildx, containerd, Helm und ORAS pushen mit dem OCI-Distribution-Protokoll dorthin und pullen von dort. Image-Layer und Manifeste werden als gewöhnliche Artefakte gespeichert. Repository-Berechtigungen, Kontingente, SHA-256-Prüfungen, Backups und Spiegel gelten für sie wie für jede andere Datei.

## Bevor Sie beginnen {#before-you-start}

Sie benötigen:

- Die Serveradresse mit HTTPS und einem vertrauenswürdigen Zertifikat, zum Beispiel `arkvory.example`. Siehe [HTTPS](../install/https).
- Ein Repository, zum Beispiel `releases`.
- Einen Schlüssel: ein persönliches Zugriffstoken oder einen Dienstschlüssel. Siehe [Konten und Schlüssel](../use/accounts).

Die Registry antwortet an der Wurzel des Hosts unter `/v2/`. Unter einem Pfadpräfix wie `https://example.com/arkvory/` kann sie nicht arbeiten, weil Docker keines unterstützt. Ein Reverse-Proxy muss `/v2/` unverändert durchreichen und darf Anfragekörper nicht puffern. Setzen Sie in nginx `client_max_body_size 0` und schalten Sie das Puffern von Anfragen aus.

## Image-Namen {#image-names}

Eine Image-Referenz hat diese Form:

```text
<host>/<repository>/<image>:<tag>
<host>/<repository>/<image>@sha256:<digest>
```

Das erste Pfadsegment ist das Arkvory-Repository. Es bildet die Zugriffsgrenze: Ein Schlüssel sieht nur die Repositorys, für die er berechtigt ist. Der Rest ist der Image-Name mit einer oder mehreren Komponenten.

| Referenz                                    | Repository | Image           | Referenzteil |
| ------------------------------------------- | ---------- | --------------- | ------------ |
| `arkvory.example/releases/web:1.4`          | `releases` | `web`           | Tag `1.4`    |
| `arkvory.example/releases/team/web:1.4`     | `releases` | `team/web`      | Tag `1.4`    |
| `arkvory.example/qa/tools/builder@sha256:…` | `qa`       | `tools/builder` | Digest       |

| Teil       | Regel                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository | Kleinbuchstaben, Ziffern, `_` und `-`. Beginnt mit einem Buchstaben oder einer Ziffer. Bis zu 64 Zeichen.                                                                 |
| Image      | Komponenten, getrennt durch `/`. Eine Komponente besteht aus Kleinbuchstaben und Ziffern, verbunden durch `.`, `_`, `__` oder Bindestriche. Insgesamt bis zu 200 Zeichen. |
| Tag        | Buchstaben, Ziffern, `_`, `.` und `-`. Beginnt mit einem Buchstaben, einer Ziffer oder `_`. Bis zu 128 Zeichen.                                                           |
| Digest     | `sha256:` und 64 hexadezimale Ziffern in Kleinbuchstaben. Andere Algorithmen werden abgelehnt.                                                                            |

Eine Referenz ohne Image-Teil, etwa `arkvory.example/web:1.4`, wird mit `NAME_INVALID` abgelehnt: `web` gilt als Repository, und der Image-Name ist leer.

## Anmelden {#log-in}

Die Registry nimmt den Arkvory-Schlüssel als Passwort der HTTP-Basic-Authentifizierung entgegen. Der Benutzername wird nicht geprüft: Verwenden Sie einen beliebigen Namen, zum Beispiel den Namen des CI-Jobs. Eine Anfrage kann den Schlüssel auch als `Authorization: Bearer <key>` senden. Einen separaten Token-Dienst brauchen Sie nicht.

```bash
docker login arkvory.example -u ci --password-stdin < ~/.arkvory/key
```

```powershell
Get-Content C:\Private\arkvory.key | docker login arkvory.example -u ci --password-stdin
```

Andere Clients melden sich auf dieselbe Weise an:

```bash
podman login arkvory.example -u ci --password-stdin < ~/.arkvory/key
helm registry login arkvory.example -u ci --password-stdin < ~/.arkvory/key
oras login arkvory.example -u ci --password-stdin < ~/.arkvory/key
```

| Schlüssel                                         | Verwendung                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Persönliches Zugriffstoken, Zugriff `read`        | Pull auf einem Arbeitsplatzrechner                                                   |
| Persönliches Zugriffstoken, Zugriff `read-write`  | Push von einem Arbeitsplatzrechner                                                   |
| Dienstschlüssel                                   | CI/CD und Deployment-Agents. Die einzige Art von Schlüssel, die Images löschen kann. |
| Dateischlüssel aus der Schlüsseldatei des Servers | Der Installationsbesitzer und ältere Integrationen (`read` oder `write`)             |

Ein persönliches Token läuft ab. Danach erhält jede Anfrage `401 UNAUTHORIZED`: Erstellen Sie ein neues Token und melden Sie sich erneut an. Docker speichert den Schlüssel in `~/.docker/config.json`, solange Sie keinen Credential-Helper konfigurieren. Schützen Sie diese Datei oder verwenden Sie einen Credential-Store.

## Push und Pull {#push-and-pull}

```bash
docker tag web:1.4 arkvory.example/releases/team/web:1.4
docker push arkvory.example/releases/team/web:1.4
docker pull arkvory.example/releases/team/web:1.4
docker pull arkvory.example/releases/team/web@sha256:<digest>
```

Das macht die Registry:

- Ein Layer, den das Repository bereits enthält, wird nicht erneut gespeichert, auch wenn ihn ein anderes Image verwendet.
- Layer werden nicht zwischen Repositorys geteilt. Eine Anfrage, einen Layer aus einem anderen Repository einzubinden (Mount), erhält eine gewöhnliche Upload-Sitzung, sodass der Client den Layer erneut sendet.
- Jeder Layer und jedes Manifest wird gegen seinen SHA-256-Digest geprüft. Bei einer Abweichung wird nichts gespeichert und `DIGEST_INVALID` zurückgegeben.
- Ein Manifest wird nur akzeptiert, wenn alles, worauf es verweist, bereits im Repository liegt: die Konfiguration und die Layer eines Images oder die Plattform-Manifeste eines Index. Plattform-Manifeste müssen im selben Image liegen wie ihr Index. Andernfalls lautet die Antwort `MANIFEST_BLOB_UNKNOWN`.
- Layer-Downloads unterstützen `Range`-Anfragen.

Die Registry akzeptiert diese Manifesttypen:

| Medientyp                                                   | Verwendung                                      |
| ----------------------------------------------------------- | ----------------------------------------------- |
| `application/vnd.oci.image.manifest.v1+json`                | OCI-Images, Helm-Charts, ORAS-Artefakte         |
| `application/vnd.oci.image.index.v1+json`                   | Multi-Plattform-Images, BuildKit-Registry-Cache |
| `application/vnd.docker.distribution.manifest.v2+json`      | Docker-Images (Schema 2)                        |
| `application/vnd.docker.distribution.manifest.list.v2+json` | Docker-Multi-Plattform-Images                   |

Ein Manifest hat `schemaVersion: 2` und ist höchstens 4 MiB groß. Docker Schema 1 wird nicht unterstützt. Der Typ stammt aus dem Header `Content-Type` oder aus dem Feld `mediaType` des Manifests, und beide müssen übereinstimmen. Ein Pull liefert das Manifest genau so zurück, wie es gepusht wurde, mit seinem eigenen Medientyp. Die Registry konvertiert nicht zwischen Formaten.

### Multi-Plattform-Images {#multi-platform-images}

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t arkvory.example/releases/team/web:1.4 --push .
```

Buildx pusht jedes Plattform-Manifest über seinen Digest und anschließend den Index unter dem Tag. Alle gehen an denselben Image-Namen, wie es die Registry verlangt.

### Build-Cache {#build-cache}

Ein BuildKit-Builder, der einen Cache exportieren kann, zum Beispiel ein `docker buildx`-Builder mit dem Treiber `docker-container`, kann seinen Registry-Cache in Arkvory ablegen:

```bash
docker buildx build \
  --cache-from type=registry,ref=arkvory.example/releases/team/web:cache \
  --cache-to type=registry,ref=arkvory.example/releases/team/web:cache,mode=max \
  -t arkvory.example/releases/team/web:1.4 --push .
```

Der Cache-Index listet Layer und eine Cache-Konfiguration auf. Arkvory speichert sie als Blobs des Images und schützt sie wie die Layer jedes gespeicherten Manifests.

### Helm-Charts {#helm-charts}

Helm speichert Charts als OCI-Artefakte. Nach `helm registry login`:

```bash
helm push web-1.4.0.tgz oci://arkvory.example/releases/charts
helm pull oci://arkvory.example/releases/charts/web --version 1.4.0
helm install web oci://arkvory.example/releases/charts/web --version 1.4.0
```

Das Chart wird zum Image `charts/web` mit dem Tag `1.4.0` im Repository `releases`. Arkvory hat kein klassisches Chart-Repository mit einer Datei `index.yaml`.

### ORAS-Artefakte {#oras-artifacts}

ORAS speichert beliebige Dateien als Layer eines OCI-Manifests:

```bash
oras push arkvory.example/releases/tools/settings:1.0 ./settings.json:application/json
oras pull arkvory.example/releases/tools/settings:1.0
```

Die Referrers-API ist nicht verfügbar: `/v2/<name>/referrers/<digest>` antwortet mit `404`. Clients, die der OCI-Spezifikation folgen, etwa ORAS, legen angehängte Artefakte dann stattdessen unter Tags ab, die nach dem Digest benannt sind.

## Tags und Digests {#tags-and-digests}

- Wird ein Manifest unter einem Tag gepusht, verschiebt sich das Tag. Das Manifest, das das Tag zuvor bezeichnete, bleibt in der Registry und kann weiterhin über seinen Digest gepullt werden.
- Ein Push über den Digest (`PUT /v2/<name>/manifests/sha256:…`) speichert das Manifest ohne Tag. Der Digest muss der SHA-256-Wert des Request-Bodys sein.
- Tags werden in Byte-Reihenfolge aufgelistet, Großbuchstaben stehen daher vor Kleinbuchstaben.

So listen Sie die Tags eines Images auf:

```bash
curl -fsS -u "ci:$ARKVORY_KEY" https://arkvory.example/v2/releases/team/web/tags/list
```

Die Antwort lautet `{"name": "releases/team/web", "tags": [...]}`. Mit `n` legen Sie die Seitengröße fest (standardmäßig 100, höchstens 1000), mit `last` das letzte Tag der vorherigen Seite. Gibt es weitere Tags, enthält der Header `Link` die Adresse der nächsten Seite.

So finden Sie den Digest eines Tags:

```bash
curl -fsSI -u "ci:$ARKVORY_KEY" \
  https://arkvory.example/v2/releases/team/web/manifests/1.4 | grep -i docker-content-digest
```

Einen Katalog aller Images (`/v2/_catalog`) gibt es nicht. In der Konsole erscheinen Layer und Manifeste unter den Artefakten des Repositorys mit dem Label `oci`, benannt nach ihrem Digest. Verwenden Sie [[ui:labelFilter]] in [[ui:catalog]], um sie anzuzeigen.

## Images löschen und Speicherplatz freigeben {#delete-images}

Images löschen Sie über die Registry-API. Die Docker-Kommandozeile hat dafür keinen Befehl: Verwenden Sie `curl`, `oras manifest delete` oder ein anderes Registry-Tool.

| Anfrage                                | Wirkung                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `DELETE /v2/<name>/manifests/<tag>`    | Entfernt nur das Tag. Das Manifest bleibt erhalten und kann über seinen Digest gepullt werden. |
| `DELETE /v2/<name>/manifests/<digest>` | Entfernt das Manifest und jedes Tag, das darauf zeigt                                          |
| `DELETE /v2/<name>/blobs/<digest>`     | Wird mit `405` abgelehnt. Layer verschwinden zusammen mit ihren Manifesten.                    |

Beide Löschungen benötigen einen Dienstschlüssel mit der Aktion `artifact.delete` im Repository. Persönliche Token, Konsolensitzungen und Dateischlüssel können keine Images löschen. Eine Löschung antwortet mit `202`.

```bash
curl -fsS -X DELETE -H "Authorization: Bearer $ARKVORY_CLEANUP_KEY" \
  https://arkvory.example/v2/releases/team/web/manifests/sha256:<digest>
```

So wird Speicherplatz freigegeben:

1. Solange ein Manifest gespeichert ist, mit oder ohne Tag, schützt Arkvory es und jeden Layer, auf den es verweist. Die Aufbewahrung überspringt sie mit der Blockierung `reference`.
2. Das Verschieben oder Löschen eines Tags gibt nichts frei. Alte Manifeste behalten ihre Layer, bis Sie diese Manifeste über den Digest löschen.
3. Wird ein Manifest über den Digest gelöscht, verlieren sein Artefakt und die Layer, die kein anderes Manifest verwendet, diesen Schutz. Sie bleiben gespeichert, bis jemand sie per Aufbewahrung entfernt oder als Artefakte löscht. Siehe [Speicher](../operate/storage).
4. Ein Layer, der ohne Manifest gepusht wurde, etwa durch einen fehlgeschlagenen Push, ist nicht geschützt.
5. Wird ein entfernter Layer wieder benötigt, meldet ihn die Registry als unbekannt, und der nächste Push lädt ihn erneut hoch.

## Berechtigungen {#permissions}

Persönliche Token und Dateischlüssel erhalten Lese- oder Schreibzugriff auf ein Repository. Dienstschlüssel erhalten genau festgelegte Aktionen.

| Vorgang                           | Aktionen des Dienstschlüssels                      | Persönliches Token oder Dateischlüssel                     |
| --------------------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| Manifeste und Layer pullen        | `content.read`                                     | Lesezugriff                                                |
| Tags auflisten                    | `artifact.list`                                    | Lesezugriff                                                |
| Push                              | `upload.create`, `upload.write`, `upload.complete` | Schreibzugriff; ein Token braucht den Zugriff `read-write` |
| Ein Tag oder ein Manifest löschen | `artifact.delete`                                  | Nicht möglich                                              |

Ein CI-Schlüssel, der pusht, pullt meist auch, zum Beispiel Basis-Images oder den Build-Cache. Geben Sie ihm auch `content.read` und `artifact.list`. Ein Repository, für das der Schlüssel nicht berechtigt ist, antwortet mit `403 DENIED`.

## Lese-Gateways und Spiegel {#read-gateways-and-mirrors}

- Ein [Lese-Gateway](../operate/read-gateways) bedient Pulls. Ein Push erhält `405`.
- Ein [Spiegel](../operate/mirrors) erhält die Images seiner Quelle zusammen mit ihren Tags und Löschungen. Clients pullen vom Spiegel unter dessen eigener Adresse. Ein Push erhält `409 DENIED` mit dem Grund `mirror_read_only`.

## Grenzen {#limits}

| Limit                    | Wert                                                                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifestgröße            | 4 MiB                                                                                                                                                                                                             |
| Layergröße               | Das größte Objekt der Installation, `ARKVORY_MAX_OBJECT_BYTES` (standardmäßig etwa 10 TiB)                                                                                                                        |
| Eine Upload-Anfrage      | Muss innerhalb von 30 Minuten abgeschlossen sein und darf nicht länger als 30 Sekunden pausieren (`ARKVORY_UPLOAD_DEADLINE_MS`, `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`). 30 Minuten ist auch der höchste erlaubte Wert. |
| Unfertiger Upload        | Wird nach 24 Stunden ohne Aktivität samt seinen Bytes entfernt                                                                                                                                                    |
| Temporärer Speicherplatz | Bis zum Doppelten der Layergröße, während er hochgeladen wird                                                                                                                                                     |
| Gleichzeitige Uploads    | Standardmäßig 1 pro Schlüssel und 2 pro Server (`ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`, `ARKVORY_MAX_UPLOADS`). Eine wartende Anfrage gibt nach 20 Sekunden auf (`ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS`).               |
| Gleichzeitige Downloads  | Standardmäßig 4 pro Schlüssel und 16 pro Server                                                                                                                                                                   |
| Tags pro Seite           | 1000                                                                                                                                                                                                              |
| Kontingent               | Layer, Manifeste und die Bytes unfertiger Uploads zählen auf das Kontingent des Repositorys und die Kapazität der Installation                                                                                    |

Docker sendet jeden Layer in einer einzigen Anfrage. Ein Layer muss daher innerhalb der Upload-Frist eintreffen, und ein fehlgeschlagener Layer-Upload beginnt wieder beim ersten Byte. Verwenden Sie für Dateien von vielen Gigabyte stattdessen [`arkvoryctl`](./cli): Es lädt in Teilen hoch und setzt nach einem Fehler fort. Die Variablen sind unter [Umgebungsvariablen](../reference/environment#transfers-and-bandwidth) beschrieben.

## Nicht unterstützt {#not-supported}

- Die Referrers-API. Sie antwortet mit `404`, und Clients weichen auf Tags aus.
- Der Katalog aller Images, `/v2/_catalog`.
- Das Einbinden (Mount) von Layern aus einem anderen Repository. Der Client lädt den Layer erneut hoch.
- Ein Token-Dienst für Bearer-Token. Senden Sie den Schlüssel selbst mit Basic oder Bearer.
- Ein Pull-Through-Cache für Docker Hub oder andere Registrys.
- Manifeste im Docker-Schema 1 und andere Digests als `sha256`.
- Das Löschen einzelner Layer.
- Ein Bereich für Images in der Konsole.

## Unverschlüsseltes HTTP für Tests {#plain-http-for-tests}

Docker lehnt eine Registry ohne HTTPS ab. Standardmäßig funktionieren nur Adressen des lokalen Rechners (`localhost`, `127.0.0.0/8`) über unverschlüsseltes HTTP. Tragen Sie einen Testserver auf einem anderen Host in `insecure-registries` in der Konfiguration des Docker-Daemons ein (`/etc/docker/daemon.json` unter Linux) und starten Sie Docker neu:

```json
{
  "insecure-registries": ["arkvory.test:8080"]
}
```

Podman verwendet die Option `--tls-verify=false`. Über unverschlüsseltes HTTP wird der Schlüssel im Klartext übertragen. Verwenden Sie dies nur in einem Testnetzwerk.

Für ein Zertifikat Ihrer eigenen Zertifizierungsstelle liest Docker unter Linux die CA aus `/etc/docker/certs.d/<host>/ca.crt` (mit dem Port, falls er nicht 443 ist). Docker Desktop verwendet den Zertifikatspeicher des Systems.

## Fehlerbehebung {#troubleshooting}

Docker gibt Registry-Fehlercodes in Kleinbuchstaben mit Leerzeichen aus, zum Beispiel `denied` oder `name invalid`, gefolgt von der Meldung des Servers. Jeder Fehler hat außerdem eine Anfrage-ID in `detail.requestId`. Geben Sie sie Ihrem Administrator: Damit findet er die Anfrage im Serverprotokoll.

| Fehler                                            | Ursache                                                                                                                                    | Was zu tun ist                                                                                                                                                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNAUTHORIZED` (401)                              | Der Schlüssel fehlt, ist falsch, abgelaufen oder widerrufen                                                                                | Melden Sie sich erneut mit einem gültigen Schlüssel an                                                                                                                                                                                          |
| `DENIED` (403)                                    | Der Schlüssel kann nicht schreiben oder sieht das Repository nicht. Ein Token mit Zugriff `read` erhält „Read-only personal access token“. | Verwenden Sie einen Schlüssel mit Schreibzugriff auf dieses Repository                                                                                                                                                                          |
| `DENIED` (409)                                    | Das Repository ist ein Spiegel                                                                                                             | Pushen Sie auf den Hauptserver                                                                                                                                                                                                                  |
| `DENIED` (507)                                    | Das Kontingent des Repositorys oder die Kapazität der Installation ist erreicht. Unfertige Uploads zählen mit.                             | Geben Sie Speicherplatz frei oder bitten Sie um ein größeres Kontingent                                                                                                                                                                         |
| `NAME_INVALID`                                    | Die Referenz hat nach dem Repository keinen Image-Teil oder enthält Großbuchstaben                                                         | Verwenden Sie `<host>/<repository>/<image>:<tag>` in Kleinbuchstaben                                                                                                                                                                            |
| `MANIFEST_UNKNOWN`                                | Das Tag oder der Digest existiert in diesem Image nicht                                                                                    | Prüfen Sie den Namen mit `tags/list`                                                                                                                                                                                                            |
| `MANIFEST_BLOB_UNKNOWN`                           | Ein Manifest verweist auf einen Layer oder ein Plattform-Manifest, das nicht in diesem Repository liegt                                    | Pushen Sie das ganze Image erneut, damit der Client die fehlenden Teile hochlädt                                                                                                                                                                |
| `DIGEST_INVALID`                                  | Die Bytes passen nicht zum Digest                                                                                                          | Pushen Sie erneut. Wiederholt sich der Fehler, prüfen Sie den Proxy.                                                                                                                                                                            |
| `TOOMANYREQUESTS` (503 oder 429)                  | Zu viele gleichzeitige Übertragungen dieses Schlüssels, oder der Server ist ausgelastet                                                    | Warten Sie und versuchen Sie es erneut. Verringern Sie die parallelen Uploads des Clients, zum Beispiel `"max-concurrent-uploads": 1` in der Docker-Daemon-Konfiguration, oder bitten Sie den Administrator, die Übertragungslimits zu erhöhen. |
| `http: server gave HTTP response to HTTPS client` | Der Server hat kein HTTPS                                                                                                                  | Richten Sie [HTTPS](../install/https) ein oder verwenden Sie `insecure-registries` für einen Testserver                                                                                                                                         |
| `x509: certificate signed by unknown authority`   | Docker vertraut dem Zertifikat nicht                                                                                                       | Installieren Sie das CA-Zertifikat wie oben beschrieben                                                                                                                                                                                         |
| `413 Request Entity Too Large`                    | Der Reverse-Proxy begrenzt die Anfragegröße                                                                                                | Setzen Sie `client_max_body_size 0` in nginx                                                                                                                                                                                                    |
| Ein großer Layer bricht nach 30 Minuten ab        | Die Upload-Frist einer Anfrage                                                                                                             | Verwenden Sie ein schnelleres Netzwerk oder halten Sie solche Dateien aus Images heraus und laden Sie sie mit `arkvoryctl` hoch                                                                                                                 |

## Verwandte Seiten {#related-pages}

- [Clients und Protokolle](./index)
- [Konten und Schlüssel](../use/accounts)
- [HTTPS](../install/https)
- [Speicher](../operate/storage)
- [Spiegel](../operate/mirrors) und [Lese-Gateways](../operate/read-gateways)
