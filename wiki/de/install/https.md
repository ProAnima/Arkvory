---
title: HTTPS und Reverse-Proxy
description: 'Machen Sie Arkvory von anderen Computern aus sicher erreichbar, mit eingebautem TLS oder einem Reverse-Proxy, und richten Sie die Konsole und CORS für eine andere Adresse ein.'
---

# HTTPS und Reverse-Proxy

Eine neue Installation lauscht auf `127.0.0.1:8080` über unverschlüsseltes HTTP. Nur Programme auf dem Server können sie erreichen. Bevor sich Clients von anderen Computern verbinden, setzen Sie HTTPS davor. Schlüssel, Passwörter und Download-Links werden in Anfragen übertragen: Senden Sie sie niemals über unverschlüsseltes HTTP zwischen Computern.

## Eine Methode wählen {#choose}

|                           | Eingebautes TLS                                  | Reverse-Proxy                                                 |
| ------------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| Installationen            | Windows-Dienste und Linux (nativ). Nicht Compose | Alle, und die einzige Methode für Compose                     |
| Einrichtung               | Ein Befehl `arkvory configure` mit Rollback      | Proxy-Konfiguration plus `ARKVORY_TRUSTED_PROXIES` in Arkvory |
| Port                      | Der API-Port, standardmäßig 8080                 | Beliebig, etwa 443                                            |
| Zertifikatserneuerung     | Die API liest erneuerte Dateien selbst           | Wird vom Proxy erledigt                                       |
| Client-Zertifikate (mTLS) | Nicht unterstützt                                | Im Proxy möglich                                              |

## Bevor Sie beginnen {#before-you-start}

- Besorgen Sie sich ein Zertifikat für den Namen, den die Clients verwenden, bei einer Zertifizierungsstelle, der die Clients vertrauen, zum Beispiel mit certbot, win-acme oder Ihrer Unternehmens-CA. Sie brauchen das Zertifikat mit seiner Kette und den privaten Schlüssel, beide als PEM-Dateien. Der Schlüssel darf kein Passwort haben.
- Erstellen Sie einen DNS-Namen, der auf den Server zeigt.
- Öffnen Sie in der Firewall nur den HTTPS-Port und nur für die Netzwerke Ihrer Clients. Öffnen Sie niemals den Datenbankport 54329.

## Eingebautes TLS {#built-in-tls}

### Die Dateien vorbereiten {#tls-files}

Die Dateien müssen diese Regeln erfüllen. Der Befehl prüft alle, bevor er etwas ändert.

- Die Pfade sind absolut.
- Jede Datei ist eine PEM-Datei mit höchstens 1 MiB. Die Zertifikatsdatei enthält das Zertifikat und danach die Kette.
- Der Schlüssel ist ein unverschlüsselter privater PEM-Schlüssel, der zum Zertifikat passt.
- Das Zertifikat ist nicht abgelaufen.
- Das Dienstkonto kann beide Dateien lesen: `arkvory` unter Linux, `LocalService` unter Windows.

Arkvory verweist auf die Dateien und kopiert sie nicht. Legen Sie sie dort ab, wo sie bleiben, wenn Sie sie erneuern. Unter Linux nicht unter `/home`: Die Units können es nicht sehen. Verzeichnisse mancher Zertifikatswerkzeuge kann nur `root` lesen; kopieren Sie die erneuerten Dateien in ein Verzeichnis, das die Dienstgruppe lesen kann, zum Beispiel mit einem Erneuerungs-Hook. Beispiel für Linux:

```bash
sudo install -d -m 0750 -o root -g arkvory /etc/arkvory/tls
sudo install -m 0644 -o root -g arkvory fullchain.pem /etc/arkvory/tls/fullchain.pem
sudo install -m 0640 -o root -g arkvory privkey.pem /etc/arkvory/tls/privkey.pem
```

Unter Windows legen Sie die Dateien in einen Ordner, den `LocalService` lesen kann, und lassen Sie nur SYSTEM, Administratoren und `LocalService` den Schlüssel lesen.

### Eingebautes TLS einschalten {#tls-enable}

1. Führen Sie den Befehl mit den Pfaden und der Adresse zum Lauschen aus. `0.0.0.0` lauscht auf allen IPv4-Schnittstellen, `::` auf allen Schnittstellen, oder geben Sie die Adresse einer Schnittstelle an.

   ```bash
   sudo arkvory configure --root /opt/proanima-arkvory \
     --tls-cert /etc/arkvory/tls/fullchain.pem \
     --tls-key /etc/arkvory/tls/privkey.pem \
     --listen-host 0.0.0.0
   ```

   ```powershell
   & 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' configure --root C:\ProgramData\ProAnima\Arkvory `
     --tls-cert C:\ProgramData\ProAnima\Arkvory\tls\fullchain.pem `
     --tls-key C:\ProgramData\ProAnima\Arkvory\tls\privkey.pem `
     --listen-host 0.0.0.0
   ```

   Der Befehl schreibt `ARKVORY_TLS_CERT_FILE`, `ARKVORY_TLS_KEY_FILE` und `ARKVORY_HOST` in `config/runtime.json`, startet die Dienste neu und wartet, bis die API ihre Bereitschaftsprüfung über HTTPS beantwortet. Die Prüfung akzeptiert nur das konfigurierte Zertifikat. Wenn sie erfolgreich ist, gibt der Befehl den Tag aus, an dem das Zertifikat abläuft. Wenn etwas fehlschlägt, stellt er die vorherige `runtime.json` wieder her, startet die Dienste damit neu und meldet den Grund.

2. Öffnen Sie den API-Port in der Firewall für Ihre Client-Netzwerke.
3. Testen Sie von einem Client-Computer. Der Port bleibt 8080, sofern Sie `ARKVORY_PORT` nicht ändern:

   ```bash
   curl https://arkvory.example.com:8080/health/status
   ```

   Die Antwort ist Status 200 mit `{"status":"ready"}`. Die Konsole liegt unter `https://arkvory.example.com:8080/console/`.

Unter Linux kann das Dienstkonto normalerweise nicht auf einem Port unter 1024 lauschen. Um HTTPS auf Port 443 anzubieten, verwenden Sie einen [Reverse-Proxy](#reverse-proxy).

Wenn das Zertifikat beim Start ungültig ist, beendet sich die API mit einem Fehler. Sie fällt niemals auf unverschlüsseltes HTTP zurück.

### Einstellungen {#tls-settings}

`configure` setzt die Dateien und die Adresse. Zwei weitere Einstellungen kommen von Hand in `runtime.json`. Starten Sie die Dienste nach der Änderung neu: siehe [Eine Änderung anwenden](./configuration#apply-change).

| Variable                     | Standard  | Bedeutung                                                                                                            |
| ---------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_TLS_MIN_VERSION`    | `TLSv1.2` | `TLSv1.2` oder `TLSv1.3`                                                                                             |
| `ARKVORY_TLS_RELOAD_SECONDS` | `300`     | Wie oft die API die Zertifikatsdateien erneut liest: 30 bis 86400 Sekunden, oder `0`, um sie nur beim Start zu lesen |

Jede Antwort trägt `Strict-Transport-Security: max-age=31536000`.

### Das Zertifikat erneuern {#tls-renewal}

Schreiben Sie das erneuerte Zertifikat und den Schlüssel in dieselben Pfade. Sie brauchen keinen Befehl und keinen Neustart.

- Die API vergleicht die Dateien alle `ARKVORY_TLS_RELOAD_SECONDS`. Neue Verbindungen verwenden das neue Zertifikat. Offene Verbindungen behalten das alte, bis sie enden.
- Eine fehlerhafte Erneuerung (unlesbare Dateien, ein nicht passender Schlüssel, ein abgelaufenes Zertifikat) ersetzt nie das funktionierende Zertifikat. Die API protokolliert `tls.reload_failed` und versucht es im nächsten Intervall erneut.
- In den letzten 14 Tagen vor dem Ablauf protokolliert die API einmal täglich `tls.expiring`. Die Metrik `arkvory_tls_certificate_expiry_timestamp_seconds` eignet sich für einen Alarm. Siehe [Monitoring](../operate/monitoring).

### Eingebautes TLS ausschalten {#tls-off}

```bash
sudo arkvory configure --root /opt/proanima-arkvory --tls-off --listen-host 127.0.0.1
```

`--tls-off` allein lässt die Lauschadresse unverändert. Ohne `--listen-host 127.0.0.1` würde die API dann auf jeder Schnittstelle, die Sie geöffnet haben, unverschlüsseltes HTTP anbieten.

## Reverse-Proxy {#reverse-proxy}

Der Proxy nimmt HTTPS von Clients entgegen und leitet unverschlüsseltes HTTP an die API weiter. Lassen Sie die API auf `127.0.0.1:8080` und installieren Sie den Proxy auf demselben Host. Eine Compose-Installation veröffentlicht immer nur `127.0.0.1:8080`, daher passt ein Proxy auf dem Host direkt dazu.

1. Installieren Sie den Proxy und besorgen Sie ein Zertifikat dafür.
2. Konfigurieren Sie den Proxy, wie unter [Was der Proxy tun muss](#proxy-requirements) beschrieben.
3. Fügen Sie die Adresse des Proxys zu `ARKVORY_TRUSTED_PROXIES` hinzu. Siehe [Vertrauenswürdige Proxys](#trusted-proxies).
4. Stellen Sie sicher, dass der API-Port von anderen Computern nicht erreichbar ist.
5. Test: `curl https://arkvory.example.com/health/status` gibt `{"status":"ready"}` zurück.

### Was der Proxy tun muss {#proxy-requirements}

| Anforderung                                                                                      | Grund                                                                                                        |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Anfragekörper beliebiger Größe akzeptieren (`client_max_body_size 0` in nginx)                   | Dateien sind mehrere zehn Gigabyte groß oder mehr. Ein Teil kann bis zu 1 GiB groß sein                      |
| Anfrage- oder Antwortkörper nicht puffern (`proxy_request_buffering off`, `proxy_buffering off`) | Die Bytes werden gestreamt. Puffern füllt die Festplatte des Proxys und verzögert die Übertragung            |
| Anfragen von mindestens 1900 Sekunden zulassen (`proxy_read_timeout`, `proxy_send_timeout`)      | Eine Upload-Anfrage kann bis zu 30 Minuten dauern (`ARKVORY_UPLOAD_DEADLINE_MS`, standardmäßig 1 800 000 ms) |
| HTTP/1.1 mit der API sprechen und die Verbindung halten                                          | Für Streaming erforderlich                                                                                   |
| Den öffentlichen Namen in `Host` weiterleiten                                                    | Der Server erzeugt daraus absolute Links, etwa die Links in Git-LFS- und npm-Antworten                       |
| `X-Forwarded-For` und `X-Forwarded-Proto: https` senden                                          | Die Client-Adresse für Protokolle und das Anmeldelimit sowie das Schema absoluter Links                      |
| `X-Request-Id` mit einer eigenen ID überschreiben                                                | Die API behält die ID von einem vertrauenswürdigen Proxy. Ein Client darf sie nicht wählen                   |
| Die Query-Zeichenkette nicht ins Zugriffsprotokoll schreiben                                     | Download-Links tragen ein Geheimnis in `?token=`                                                             |
| `Strict-Transport-Security` selbst setzen, wenn Sie es wollen                                    | Die API sendet es nur vom eingebauten Listener                                                               |

### nginx {#nginx}

Setzen Sie dies in den `http`-Kontext eines vorhandenen nginx. Ersetzen Sie den Namen und die Zertifikatspfade. Das `log_format` schreibt den Pfad ohne die Query-Zeichenkette.

```nginx
log_format arkvory_path '$remote_addr [$time_local] "$request_method $uri $server_protocol" '
                        '$status $body_bytes_sent $request_time $request_id';
server {
    listen 443 ssl;
    server_name arkvory.example.com;
    ssl_certificate /etc/arkvory/tls/fullchain.pem;
    ssl_certificate_key /etc/arkvory/tls/privkey.pem;
    access_log /var/log/nginx/arkvory.access.log arkvory_path;
    client_max_body_size 0;
    client_body_timeout 60s;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Request-Id $request_id;
        proxy_set_header Connection "";
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 1900s;
        proxy_send_timeout 1900s;
    }
}
```

Listen Sie mit dieser Konfiguration den Proxy in `ARKVORY_TRUSTED_PROXIES` auf, zum Beispiel `127.0.0.1`. Die Direktive `proxy_set_header X-Request-Id $request_id` muss bleiben: Sie überschreibt eine ID, die ein Client senden könnte.

### Caddy {#caddy}

```caddyfile
arkvory.example.com {
    reverse_proxy 127.0.0.1:8080 {
        header_up X-Request-Id {http.request.uuid}
        flush_interval -1
    }
}
```

Caddy besorgt das Zertifikat selbst, streamt Anfragekörper, hat standardmäßig kein Limit für die Körpergröße und kein Upstream-Timeout und setzt `X-Forwarded-For`, `X-Forwarded-Proto` und `X-Forwarded-Host`. Caddy schreibt kein Zugriffsprotokoll, sofern Sie `log` nicht aktivieren. Wenn Sie es aktivieren, entfernen Sie die Query-Zeichenkette aus der protokollierten Adresse.

### IIS und andere Proxys {#iis}

Die Referenzkonfiguration des Projekts ist die obige nginx-Datei. Dies sind die entsprechenden Einstellungen für IIS mit Application Request Routing und URL Rewrite. Das Projekt testet sie nicht. Prüfen Sie die Namen gegen Ihre IIS-Version.

- Erhöhen Sie das Timeout des Server-Proxys auf mindestens 1900 Sekunden und setzen Sie die Schwelle des Antwortpuffers auf `0`.
- Erhöhen Sie `maxAllowedContentLength` in der Anfragefilterung auf ihren Höchstwert, 4 294 967 295 Bytes. IIS kann keinen Anfragekörper von 4 GiB oder mehr annehmen, daher schlägt ein einzelner `curl -T`-Upload einer solchen Datei fehl. `arkvoryctl` sendet große Dateien in Teilen.
- Senden Sie den ursprünglichen Host, `X-Forwarded-Proto: https` und die Client-Adresse in `X-Forwarded-For`. Setzen Sie eine neue `X-Request-Id` in einer URL-Rewrite-Regel.
- Halten Sie die Query-Zeichenkette aus dem IIS-Protokoll heraus.

### Vertrauenswürdige Proxys {#trusted-proxies}

`ARKVORY_TRUSTED_PROXIES` akzeptiert bis zu 32 Adressen oder CIDR-Bereiche, durch Kommas getrennt. Hostnamen und Wildcards werden abgelehnt. Nur eine Anfrage, die von einer dieser Adressen kommt, darf setzen:

- die Client-Adresse mit `X-Forwarded-For`. Die API nimmt die nächste Adresse, der nicht vertraut wird,
- die Anfrage-ID mit `X-Request-Id`,
- den Host absoluter Links mit `X-Forwarded-Host`.

Ohne die Liste scheint jeder Client von der Adresse des Proxys zu kommen. Das Anmeldelimit zählt dann alle Personen als einen Client, und das Zugriffsprotokoll zeigt die Proxy-Adresse in `clientIp`. Listen Sie nur Proxys auf, die Sie kontrollieren.

Auf einem Compose-Host sieht die API den Proxy möglicherweise unter der Adresse des Compose-Netzwerk-Gateways und nicht unter `127.0.0.1`. Senden Sie eine Anfrage durch den Proxy, suchen Sie `clientIp` im Datensatz `http.access` im API-Protokoll und listen Sie diese Adresse auf.

Bearbeiten Sie `config/runtime.json` und starten Sie die Dienste neu. Siehe [Eine Änderung anwenden](./configuration#apply-change).

```json
{ "ARKVORY_TRUSTED_PROXIES": "127.0.0.1,::1" }
```

Wenn die API auf einer Nicht-Loopback-Adresse ohne TLS und ohne vertrauenswürdigen Proxy lauscht, protokolliert sie beim Start `http.plaintext_exposed`. Eine korrekte Proxy-Einrichtung löst es nicht aus.

## Die Konsole und ihre API-Adresse {#console-api-address}

Die Konsole, die Arkvory ausliefert, verwendet die Adresse, von der sie geöffnet wurde. Sie spricht nur mit ihrem eigenen Server: Ihre Content-Security-Policy erlaubt keine andere Adresse. Hinter einem Proxy funktioniert sie unverändert unter `https://arkvory.example.com/console/`.

Um die Konsole auf einem anderen Webserver zu hosten, zum Beispiel neben einem Portal:

1. Kopieren Sie die Konsolendateien aus `releases/<version>/apps/web/public/` im Installationsverzeichnis auf den anderen Server. Liefern Sie sie unter dem Pfad `/console/` über HTTPS mit den korrekten MIME-Typen für `.js` und `.css` aus. Kopieren Sie sie nach jedem Arkvory-Update erneut.
2. Setzen Sie in der kopierten `index.html` die Adresse von Arkvory:

   ```html
   <meta name="arkvory-api-base-url" content="https://arkvory.example.com/" />
   ```

3. Wenn der andere Server eine Content-Security-Policy setzt, erlauben Sie `connect-src` auf die Arkvory-Adresse und erlauben Sie den lokalen Skript-Worker.
4. Erlauben Sie den Origin der Konsole in Arkvory. Siehe [CORS](#cors).

### CORS {#cors}

Setzen Sie die Origins von Webanwendungen auf anderen Adressen in `ARKVORY_CORS_ORIGINS` und starten Sie die API neu.

```json
{ "ARKVORY_CORS_ORIGINS": "https://portal.example.com,https://tools.example.com" }
```

- Die Liste enthält bis zu 16 Origins, jeder mit einem Schema, einem Host und einem optionalen Port, aber keinem Pfad. HTTPS ist erforderlich. Unverschlüsseltes HTTP wird nur für `localhost`, `127.0.0.1` und `[::1]` akzeptiert.
- CORS gilt für `/api/v1/*` und `/health/ready`. Eine Anfrage von einem nicht aufgeführten Origin erhält Status 403 mit dem Grund `origin_not_allowed`. Eine Anfrage von der eigenen Adresse des Servers braucht keinen Eintrag.
- Ein Origin in der Liste erhält keine Rechte. Jede Anfrage braucht weiterhin einen Schlüssel oder eine Sitzung und durchläuft die Zugriffsprüfungen des Servers. Die Webanwendung sendet den Schlüssel im Header `Authorization`, nicht in einem Cookie.
- Die erlaubten Methoden sind GET, HEAD, POST, PUT, PATCH und DELETE. Browser dürfen die Antwort auf eine Preflight-Anfrage 10 Minuten lang zwischenspeichern.

Testen Sie eine Preflight-Anfrage. Die Antwort muss Status 204 sein, mit Ihrem Origin in `Access-Control-Allow-Origin`:

```bash
curl -i -X OPTIONS https://arkvory.example.com/api/v1/auth/me \
  -H 'Origin: https://portal.example.com' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'
```

## Die Einrichtung prüfen {#check}

1. `curl https://arkvory.example.com/health/status` gibt Status 200 und `{"status":"ready"}` zurück. Die Zertifikatskette wird ohne Ausnahmen verifiziert.
2. Öffnen Sie die Konsole, melden Sie sich an und laden Sie eine große Datei über dieselbe Adresse hoch.
3. Führen Sie `arkvoryctl doctor` mit einem Profil aus, das die HTTPS-Adresse verwendet. Schalten Sie die Zertifikatsprüfung auf Clients nicht aus: Der Kommandozeilen-Client kann das nicht, und er akzeptiert unverschlüsseltes HTTP nur für den lokalen Computer. Siehe [Kommandozeilen-Client](../protocols/cli).
4. Nach einem Neustart der API enthält das Protokoll keinen Datensatz `http.plaintext_exposed`.

## Fehlerbehebung {#troubleshooting}

| Problem                                                                      | Ursache und Lösung                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HTTPS was not enabled; the previous configuration is restored`              | Der Grund folgt in der Meldung: Die Dateien sind kein PEM, der Schlüssel hat ein Passwort, der Schlüssel passt nicht, das Zertifikat ist abgelaufen, oder das Dienstkonto kann eine Datei nicht lesen. Beheben Sie es und führen Sie den Befehl erneut aus |
| `TLS files must be given as absolute paths`                                  | Geben Sie vollständige Pfade an                                                                                                                                                                                                                            |
| `Built-in TLS is for native installations; use a reverse proxy with Compose` | Compose hat kein eingebautes TLS. Verwenden Sie einen [Reverse-Proxy](#reverse-proxy)                                                                                                                                                                      |
| Status 413 vom Proxy                                                         | Das Körperlimit ist zu niedrig. Verwenden Sie `client_max_body_size 0` in nginx                                                                                                                                                                            |
| Status 502 oder 504 oder ein abgebrochener Upload nach Minuten               | Der Proxy puffert den Körper, oder seine Timeouts sind kürzer als 1900 Sekunden                                                                                                                                                                            |
| Alle werden bei der Anmeldung begrenzt, oder `clientIp` ist immer der Proxy  | Der Proxy steht nicht in `ARKVORY_TRUSTED_PROXIES`                                                                                                                                                                                                         |
| Links in Git-LFS- oder npm-Antworten zeigen `http` oder einen internen Namen | Der Proxy leitet `Host` oder `X-Forwarded-Proto: https` nicht weiter                                                                                                                                                                                       |
| Eine Browseranwendung erhält 403 `origin_not_allowed`                        | Fügen Sie ihren Origin zu `ARKVORY_CORS_ORIGINS` hinzu und starten Sie neu                                                                                                                                                                                 |

Weitere Hinweise stehen unter [Fehlerbehebung](../operate/troubleshooting) und [Sicherheit](../operate/security).
