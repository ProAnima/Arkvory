---
title: Monitoring
description: Health-Endpunkte, Metriken, Logs, Konsolendiagnose und eine vorgeschlagene Alarmliste für einen Arkvory-Server.
---

# Monitoring

Arkvory liefert Ihnen vier Faktenquellen: Health-Endpunkte, die die Frage „läuft es“ beantworten, Prometheus-Metriken, JSON-Logzeilen und die Diagnose der Konsole. Diese Seite listet auf, was jede Quelle enthält, und endet mit einer Reihe von Alarmen, mit denen Sie beginnen können.

Die Metriken, die Health-Endpunkte und die Log-Ereignisse beschreiben einen API-Prozess. Der Worker und der Backup-Agent haben keinen HTTP-Port. Sie sehen sie über Logzeilen, über die Metriken der Abschlusswarteschlange und über den Backup-Status.

## Einen Server jetzt prüfen {#quick-check}

1. Fragen Sie den öffentlichen Status-Endpunkt ab. Er braucht keinen Schlüssel:

   ```bash
   curl -fsS http://127.0.0.1:8080/health/status
   ```

   `{"status":"ready"}` mit HTTP 200 bedeutet, dass die API ihre Datenbank und ihr Speicherverzeichnis erreicht.

2. Fragen Sie die vollständige Bereitschaftsantwort mit dem Health-Schlüssel ab, den der Installer erstellt hat:

   ```bash
   sudo sh -c 'curl -fsS -H "Authorization: Bearer $(cat /opt/proanima-arkvory/config/health-token.txt)" http://127.0.0.1:8080/health/ready'
   ```

   ```powershell
   $root = 'C:\ProgramData\ProAnima\Arkvory'
   $key = (Get-Content "$root\config\health-token.txt" -Raw).Trim()
   Invoke-RestMethod -Headers @{ Authorization = "Bearer $key" } http://127.0.0.1:8080/health/ready
   ```

3. Prüfen Sie die Backups:

   ```bash
   arkvoryctl backup status
   ```

   Der Befehl benötigt den Wiederherstellungsschlüssel oder die Sitzung eines Administrators. Er endet mit Code 9, wenn eine kritische Warnung aktiv ist. Verwenden Sie für unbeaufsichtigte Prüfungen die Prometheus-Alarme weiter unten. Siehe [Kommandozeile](../protocols/cli).

4. Prüfen Sie die Dienste und die neuesten Logzeilen. Siehe [Logs](#logs).

`arkvory status --root <root>` gibt die installierte Version, den Installationsmodus und die Update-Richtlinie aus. Es prüft den Server nicht. `arkvoryctl doctor` zeigt den Server, das Repository, die Funktionen und die Berechtigungen eines Schlüssels. Es ist eine Client-Prüfung, keine Health-Prüfung.

## Health und Bereitschaft {#health}

Drei Endpunkte antworten auf dem API-Port. Keiner von ihnen zählt gegen das Anforderungsbudget `ARKVORY_MAX_REQUESTS`, sodass eine Übertragungslast einen Server nicht als tot erscheinen lassen kann. Alle drei antworten weiter, während der Server vor einem Stopp ausläuft.

| Pfad             | Schlüssel                     | Antwort                                                                                                         | Wofür Sie es verwenden                              |
| ---------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `/health/live`   | Nein                          | 200 `{"status":"ok"}`, solange der Prozess antwortet                                                            | Eine Prozessprüfung                                 |
| `/health/status` | Nein                          | 200 `{"status":"ready"}`, oder 503 `{"status":"unavailable"}` oder `{"status":"draining"}` mit `Retry-After: 2` | Lastverteiler und Uptime-Sonden                     |
| `/health/ready`  | Beliebiger gültiger Schlüssel | 200 mit den Details unten, oder 503 mit dem Fehler-Umschlag und `Retry-After`                                   | Deployment-Prüfungen und die Compose-Health-Prüfung |

`/health/status` und `/health/ready` prüfen drei Dinge: die Datenbank antwortet und hat genau die Migrationen dieses Releases, der Ordner `blobs` des Speicherverzeichnisses existiert, und der Prozess hält noch seine Speichersperre. Das Ergebnis von `/health/status` wird eine Sekunde lang zwischengespeichert, sodass öffentliche Sonden die Abfragen der Datenbank nicht vervielfachen können. Ein auslaufender Server antwortet sofort mit `draining`.

Ohne einen Schlüssel gibt `/health/ready` 401 zurück. Der Schlüssel `deployment-health`, den der Installer erstellt, hat keine Repository-Rechte und keine Administratorrechte. Sein Geheimnis liegt in `config/health-token.txt`.

Eine 200-Antwort von `/health/ready` hat diese Felder:

| Feld              | Bedeutung                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`          | In einer 200-Antwort immer `ready`                                                                                                                                                                                                                                                                                                           |
| `writable`        | `false`, wenn der freie Platz des Speicherdatenträgers unter `ARKVORY_STORAGE_RESERVE_BYTES` liegt, und bei einem Lese-Gateway. Lesevorgänge funktionieren weiterhin                                                                                                                                                                         |
| `role`            | `api`, oder `reader` für ein Lese-Gateway                                                                                                                                                                                                                                                                                                    |
| `sharedDownloads` | Das Lease eines Lese-Gateways (`slot`, `slots`, `active`, `leaseSeconds`), oder `null`                                                                                                                                                                                                                                                       |
| `transfers`       | Für `uploads` und `downloads`: `admission` (`active`, `waiting`, `capacity`, `perPrincipalCapacity`, `waitingCapacity`, `perPrincipalWaitingCapacity`, `timeoutMs`, `rejected`, `timedOut`, `cancelled`) und `bandwidth` (`bytesPerSecond`, `perPrincipalBytesPerSecond`, `burstBytes`, `perPrincipalBurstBytes`, `waiting`, `grantedBytes`) |

Eine fehlgeschlagene Bereitschaftsprüfung allein startet keinen Dienst neu. Siehe [Selbstheilung](./self-healing).

## Metriken {#metrics}

`GET /health/metrics` gibt die Metriken des API-Prozesses im Prometheus-Textformat (Version 0.0.4) zurück. Jeder gültige Schlüssel darf es lesen, und es funktioniert, während der Server ausläuft. Erstellen Sie einen Dienstschlüssel mit den wenigsten Rechten für den Scraper und bewahren Sie ihn in einer Datei auf, die nur Prometheus liest.

```yaml
scrape_configs:
  - job_name: arkvory
    metrics_path: /health/metrics
    scheme: https
    authorization:
      credentials_file: /etc/prometheus/arkvory.key
    static_configs:
      - targets: ['arkvory.example:443']
```

Der Job muss `arkvory` heißen: die mitgelieferten Alarmregeln wählen ihn nach Namen aus.

Werte gehören zum Prozess und beginnen nach einem Neustart bei null. `arkvory_process_start_time_seconds` ändert sich, wenn das passiert. Labels sind begrenzt: `route` ist die Routenvorlage, nie die URL, und `status_class` ist `2xx`, `5xx` und so weiter.

| Metrik                                                                                      | Labels                                                     | Bedeutung                                                                                             |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `arkvory_http_requests_total`                                                               | `method`, `route`, `status_class`                          | Geschlossene Antworten                                                                                |
| `arkvory_http_request_duration_seconds`                                                     | dieselben                                                  | Dauer-Histogramm von 5 ms bis 1800 s. Abgebrochene Übertragungen sind enthalten                       |
| `arkvory_http_request_bytes_total`, `arkvory_http_response_bytes_total`                     | `method`, `route`                                          | Socket-Bytes, Header eingeschlossen                                                                   |
| `arkvory_http_requests_in_flight`                                                           |                                                            | Zugelassene Anforderungen, deren Antworten noch offen sind                                            |
| `arkvory_transfer_active`, `arkvory_transfer_queue_depth`                                   | `direction`                                                | Zugelassene Übertragungen und Übertragungen, die auf einen Platz warten                               |
| `arkvory_transfer_admission_failures_total`                                                 | `direction`, `reason`                                      | Von der Zulassung abgelehnte Übertragungen: `rejected` (Warteschlange voll), `timed_out`, `cancelled` |
| `arkvory_completion_jobs`                                                                   | `state` (`queued`, `running`)                              | Abschlussaufträge für Uploads in der Datenbank                                                        |
| `arkvory_completion_oldest_queued_seconds`                                                  |                                                            | Wartezeit des ältesten ausführbaren eingereihten Auftrags                                             |
| `arkvory_diagnostic_records_total`                                                          | `outcome` (`written`, `dropped`, `truncated`, `oversized`) | Logzeilen nach Ergebnis                                                                               |
| `arkvory_metrics_collection_failures_total`                                                 | `collector` (`jobs`, `backup`, `mirror`)                   | Fehlgeschlagene Lesevorgänge datenbankgestützter Metriken                                             |
| `arkvory_backup_last_success_timestamp_seconds`                                             |                                                            | Snapshot-Zeit des neuesten abgeschlossenen Backup-Punkts                                              |
| `arkvory_backup_agent_last_seen_timestamp_seconds`                                          |                                                            | Letzter Heartbeat des Backup-Agents                                                                   |
| `arkvory_backup_warnings`                                                                   | `code`                                                     | 1, solange die Warnung aktiv ist, sonst 0                                                             |
| `arkvory_mirror_last_sync_timestamp_seconds`, `arkvory_mirror_last_check_timestamp_seconds` | `repository`, `mode`                                       | Letzter Abgleich mit der Quelle und letztes Lesen ihres Feeds                                         |
| `arkvory_mirror_failing`                                                                    | `repository`, `mode`                                       | 1, solange der letzte Synchronisationsversuch fehlgeschlagen ist                                      |
| `arkvory_tls_certificate_expiry_timestamp_seconds`                                          |                                                            | Ablauf des integrierten HTTPS-Zertifikats. Nur mit integriertem HTTPS vorhanden                       |
| `arkvory_build_info`                                                                        | `service`, `version`                                       | Immer 1                                                                                               |
| `arkvory_process_start_time_seconds`, `arkvory_process_resident_memory_bytes`               |                                                            | Startzeit und residenter Speicher                                                                     |

Die datenbankgestützten Metriken (Abschluss, Backup, Spiegel) werden höchstens alle 5 Sekunden gelesen. Wenn ein Lesevorgang fehlschlägt, lässt der Server diese Metriken weg, statt alte Werte zu zeigen, und `arkvory_metrics_collection_failures_total` wächst.

Das 99. Perzentil der Steueranforderungen, ohne Dateiübertragungen:

```text
histogram_quantile(0.99, sum by (le) (rate(arkvory_http_request_duration_seconds_bucket{route!~".*(content|parts).*"}[10m])))
```

Arkvory exportiert nicht den freien Platz des Speicherdatenträgers oder der Datenbank. Verwenden Sie `node_exporter` für die Datenträger und `postgres_exporter` für PostgreSQL.

## Logs {#logs}

Die API, der Worker, der Backup-Agent und die Wartungswerkzeuge schreiben ein JSON-Objekt pro Zeile auf die Standardausgabe. Der Server schreibt selbst keine Logdateien. Der Dienstmanager Ihrer Plattform sammelt die Zeilen.

| Installation                 | Wo zu lesen                                                                                                                                                                                                                                                         | Rotation                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Linux (Pakete, `install.sh`) | `journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup`. Die verwaltete Datenbank ist `arkvory-database`, der Updater ist `arkvory-update`                                                                                                                  | Von journald festgelegt                           |
| Windows                      | `logs\arkvory-api.out.log`, `arkvory-worker.out.log`, `arkvory-backup.out.log` im Installationsverzeichnis. Fehlerausgaben gehen in die danebenliegenden `.err.log`-Dateien. Der Updater schreibt `logs\updater.log`, der Datenbankdienst schreibt nach `database\` | 20 MiB pro Datei, 5 alte Dateien bleiben erhalten |
| Docker Compose               | `docker logs --tail 100 proanima-arkvory-api-1`, und dasselbe für `-worker-1` und `-backup-1`                                                                                                                                                                       | 20 MiB pro Datei, 5 Dateien pro Container         |

Ein Hänger beendet einen Prozess mit dem Datensatz `process.stalled` auf der Standardfehlerausgabe, also sehen Sie auch in die `.err.log`-Datei oder ins Journal. Siehe [Windows](../install/windows#logs) für die anderen Dateien in `logs\`.

Jede Zeile beginnt mit denselben Feldern:

| Feld                         | Wert                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `timestamp`                  | UTC-Zeit im ISO-8601-Format                                                                                    |
| `level`                      | `debug`, `info`, `warning` oder `error`                                                                        |
| `service`                    | `api`, `worker`, `backup`, `migrate`, `gc` oder `scrub`                                                        |
| `version`, `pid`, `hostname` | Release, Prozess und Host                                                                                      |
| `component`                  | `api`, `http`, `storage`, `worker`, `maintenance`, `backup`, `mirror`, `migrate`, `process` oder `diagnostics` |
| `code`                       | Der Ereignisname                                                                                               |

Andere Felder stammen aus einer festen Liste: Bezeichner (`requestId`, `traceId`, `jobId`, `uploadId`, `artifactId`, `repository`, `principal`, `clientIp`), Zahlen (`status`, `durationMs`, `bytesSent`, `bytesReceived`, `attempts`) und Grundfelder (`errorCode`, `errorName`, `errno`, `sqlstate`, `reason`). `ARKVORY_LOG_LEVEL` legt die niedrigste Stufe fest, die geschrieben wird.

### Wichtige Ereignisse {#log-events}

| Ereignis (`code`)                                                                                     | Stufe                          | Bedeutung und erster Schritt                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `api.listening`                                                                                       | info                           | Die API bedient Anforderungen. Felder `address`, `port` und `tls`                                                                                            |
| `startup.failed`                                                                                      | error                          | Die API ist nicht gestartet. `reason` nennt die Ursache. Siehe [Fehlerbehebung](./troubleshooting#server-does-not-start)                                     |
| `worker.unavailable`                                                                                  | error                          | Der Worker ist nicht gestartet oder mit einem Fehler abgebrochen                                                                                             |
| `http.plaintext_exposed`                                                                              | warning                        | Die API lauscht auf einer Nicht-Loopback-Adresse ohne TLS und ohne vertrauenswürdigen Proxy                                                                  |
| `http.access`                                                                                         | info                           | Eine Zeile pro beendeter oder abgebrochener Anforderung                                                                                                      |
| der Fehlercode einer Anforderung, zum Beispiel `unavailable` oder `internal`                          | warning für 4xx, error für 5xx | Eine fehlgeschlagene Anforderung mit `requestId`, `route`, `status` und bei Systemfehlern `errorName`, `errno` oder `sqlstate`                               |
| `upload.input_timeout`, `upload.deadline`                                                             | warning                        | Ein Upload hat aufgehört, Daten zu senden, oder hat länger als `ARKVORY_UPLOAD_DEADLINE_MS` gedauert                                                         |
| `api.ownership_lost`, `worker.ownership_lost`                                                         | error                          | Die Datenbanksitzung, die den Besitz des Speichers belegt, ist abgebrochen. Der Prozess beendet sich und startet neu                                         |
| `process.stalled`                                                                                     | error                          | Der Watchdog hat einen hängenden Prozess beendet. Feld `stalledSeconds`                                                                                      |
| `process.unhandled`                                                                                   | error                          | Ein unerwarteter Fehler hat den Prozess beendet                                                                                                              |
| `process.watchdog_failed`                                                                             | warning                        | Der Watchdog konnte nicht starten. Der Dienst läuft ohne ihn                                                                                                 |
| `drain.started`, `drain.settled`, `drain.timeout`, `api.stopped`                                      | info oder warning              | Ein sauberer Stopp. `drain.timeout` bedeutet, dass Anfragen abgeschnitten wurden                                                                             |
| `tls.reloaded`, `tls.reload_failed`, `tls.expiring`                                                   | info oder warning              | Zertifikatsdateien wurden erneut gelesen, konnten nicht gelesen werden oder laufen in weniger als 14 Tagen ab. `tls.expiring` wiederholt sich einmal pro Tag |
| `completion.completed`, `completion.failed`, `completion.lease_lost`, `completion.attempts_exhausted` | info oder error                | Das Ergebnis eines Upload-Abschlussauftrags, mit `jobId`, `uploadId` und `errorCode`                                                                         |
| `backup.agent.started`, `backup.agent.standby`, `backup.agent.lease_lost`                             | info oder warning              | Zustand des Backup-Agents                                                                                                                                    |
| `backup.request.failed`, `backup.request.requeued`, `backup.failed`                                   | error oder warning             | Ein Backup-Auftrag ist fehlgeschlagen oder läuft erneut. Feld `errorCode`                                                                                    |
| `mirror.step_failed`, `mirror.recovered`                                                              | warning oder info              | Ein Spiegel-Synchronisationsschritt ist fehlgeschlagen (`errorCode`, `attempts`) oder funktioniert wieder                                                    |
| `migrate.started`, `migrate.completed`, `migrate.failed`                                              | info oder error                | Die Datenbankmigration eines Updates                                                                                                                         |
| `diagnostics.dropped`, `diagnostics.oversized`                                                        | warning                        | Zeilen wurden verworfen, weil der Log-Leser zu langsam ist, oder eine Zeile war zu lang                                                                      |

Ein langsamer Log-Leser bremst nie eine Übertragung. Wenn die Ausgabe blockiert ist, verwirft der Server Zeilen, zählt sie und schreibt `diagnostics.dropped` mit der Anzahl, nachdem die Ausgabe wieder frei ist. Eine Zeile, die länger als 4096 Zeichen ist, wird durch `diagnostics.oversized` ersetzt. Textfelder werden bei 256 Zeichen abgeschnitten.

### Anfrage-IDs {#request-ids}

Jede Antwort trägt den Header `X-Request-Id`, und jeder Fehler-Body hat das Feld `requestId`. Derselbe Wert steht in der Zeile `http.access`, in der Fehlerzeile, in den Zeilen des Abschlussauftrags, den die Anforderung gestartet hat, und in den Audit-Datensätzen. Ein Client, der ein Problem meldet, muss Ihnen nur diesen Wert geben.

```bash
journalctl -u arkvory-api -u arkvory-worker --since "1 hour ago" -o cat | grep 'REQUEST_ID'
```

```powershell
Select-String -Path "$root\logs\*.log" -Pattern 'REQUEST_ID'
```

Hinter einem Reverse-Proxy übernimmt der Server eine eingehende `X-Request-Id` nur von einer Adresse in `ARKVORY_TRUSTED_PROXIES`, und nur wenn es ein einzelner Wert von 8 bis 128 Zeichen ist (Buchstaben, Ziffern, `.`, `_`, `:` und `-`). Lassen Sie den Proxy den Header überschreiben, zum Beispiel mit `proxy_set_header X-Request-Id $request_id;` in nginx. Ein gültiger W3C-`traceparent`-Header eines beliebigen Clients wird zum Feld `traceId`. Er dient nur zum Suchen und gewährt nie etwas.

### Was nie protokolliert wird {#never-logged}

Das Log enthält keine Passwörter, Schlüssel, Token, `Authorization`-Header, Request-Bodies, Query-Strings, URLs oder Ausnahmetexte. Download-Links tragen ein Geheimnis im Query-String, daher wird nur die Routenvorlage protokolliert. Das Feld `reason` ist der einzige freie Text. Es wird redigiert und bei 240 Zeichen abgeschnitten. Die Zeile zeigt den `principal` (die ID eines Kontos oder Schlüssels) und die `clientIp`. Behandeln Sie das Log als personenbezogene Daten.

`ARKVORY_ACCESS_LOG=false` schaltet `http.access` ab. Erfolgreiche Anforderungen an `/health/live` und `/health/status` werden nie protokolliert. Die Stufen `warning` und `error` verbergen auch die Zugriffszeilen.

## Diagnose in der Konsole {#console}

Administratoren sehen den Zustand des Servers in der Konsole ohne Shell. Siehe [Die Webkonsole](../guide/console).

| Wo                                         | Was Sie sehen                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [[ui:backups]]                             | Die Überschrift nennt [[ui:backupStateOk]], [[ui:backupStateWarning]] und [[ui:backupStateCritical]]. Darunter stehen das [[ui:backupNewest]]-Backup, die [[ui:backupNextRun]], der [[ui:backupAgent]], das [[ui:backupVault]] und die Liste der Warnungen mit der Aktion für jede |
| [[ui:updates]]                             | Die installierte und die neueste Version, die Zeit der letzten Prüfung und der Zustand des Host-Updaters                                                                                                                                                                           |
| [[ui:repositoryStorage]] eines Repositorys | Die Nutzung des Kontingents mit den Zuständen [[ui:storageWarning]] und [[ui:storageCritical]] und die Liste [[ui:storageEvents]]                                                                                                                                                  |
| [[ui:serviceAudit]] eines Dienstkontos     | Wer was erstellt, geändert, ausgegeben oder widerrufen hat                                                                                                                                                                                                                         |
| Die Repository-Karte                       | Das Badge [[ui:mirrorBadge]] mit dem Zustand [[ui:mirrorFailing]], wenn die letzte Synchronisation fehlgeschlagen ist                                                                                                                                                              |

Die Liste [[ui:storageEvents]] benötigt die Berechtigung, Diagnosen zu lesen. Unter anderem enthält sie die fehlgeschlagenen Anforderungen von Dienstschlüsseln in diesem Repository, mit der Anfrage-ID, der Route und dem Status.

Kontingentschwellen liegen bei 80 % für die Warnung und 95 % für den kritischen Zustand, sofern ein Administrator sie nicht geändert hat. Ein Repository ohne Kontingent hat keine Schwellen.

## Speicher- und Datenträgerwarnungen {#storage}

Der Server hält `ARKVORY_STORAGE_RESERVE_BYTES` (standardmäßig 1 GiB) freien Platz auf dem Speicherdatenträger für die Datenbank, die Logs und das System. Unterhalb dieser Reserve:

- `/health/ready` meldet `"writable": false`, antwortet aber weiterhin mit 200.
- Uploads schlagen mit 507 und dem Grund `storage_full` fehl. Downloads und die Konsole funktionieren weiter.

Der Server misst den freien Platz nicht für Sie. Überwachen Sie den Speicherdatenträger, den Datenbankdatenträger und den Backup-Datenträger mit Ihren eigenen Werkzeugen und alarmieren Sie, bevor die Reserve erreicht ist. Die Reserve ist kein Kontingent. `ARKVORY_CAPACITY_BYTES` begrenzt die Summe des reservierten Inhalts und ist keine Datenträgerprüfung. Siehe [Speicher](./storage).

## Backup-Zustand {#backup-health}

Der Backup-Agent sendet bei jeder Lease-Erneuerung einen Heartbeat. Die API verwandelt den Heartbeat und den Verlauf der Backup-Aufträge in Warnungen mit festen Codes. Siehe [Backups](./backups), was jeder Code von Ihnen verlangt.

| Code                                                                            | Schweregrad | Bedingung                                                                                                      |
| ------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| `agent_offline`                                                                 | kritisch    | 2 Minuten kein Heartbeat                                                                                       |
| `backup_stale`                                                                  | kritisch    | Der neueste Punkt ist älter als 26 Stunden und der Plan ist an                                                 |
| `vault_unavailable`                                                             | kritisch    | Der Backup-Speicherdatenträger ist nicht eingebunden, hat keine `vault.json` oder ist nicht beschreibbar       |
| `verify_failed`                                                                 | kritisch    | Ein Wiederherstellungspunkt hat seine Prüfung nicht bestanden                                                  |
| `vault_not_configured`, `schedule_disabled`, `no_backup_yet`, `last_run_failed` | Warnung     | Kein Backup-Speicher, Plan aus, kein erstes Backup, letztes Backup fehlgeschlagen                              |
| `vault_low_space`                                                               | Warnung     | Der Backup-Speicher hat weniger als 10 % frei oder weniger als das Doppelte der neuen Bytes des letzten Punkts |
| `never_deep_verified`                                                           | Warnung     | Keine vollständige Prüfung für mehr als 8 Tage                                                                 |

Die Metrik `arkvory_backup_warnings` trägt dieselben Codes. Das Alter eines Backups zählt ab seiner Snapshot-Zeit, nicht ab dem Moment, in dem es fertig wurde.

## Vorgeschlagene Alarme {#alerts}

Das Release enthält fertige Prometheus-Regeln in `releases/<version>/deploy/monitoring/arkvory-alerts.yml`. Fügen Sie die Datei zu `rule_files` in `prometheus.yml` hinzu. Die Schwellen sind Ausgangspunkte. Stimmen Sie sie mit dem Verkehr ab, den Sie messen.

| Alarm                                                           | Bedingung                                                                                      | Schweregrad       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------- |
| `ArkvoryDown`                                                   | Das Scraping schlägt 2 Minuten lang fehl                                                       | Kritisch          |
| `ArkvoryHighServerErrorRate`                                    | Mehr als 5 % der Antworten sind 10 Minuten lang 5xx                                            | Warnung           |
| `ArkvorySlowMetadataRequests`                                   | Das 99. Perzentil der Steueranforderungen liegt 15 Minuten lang über 2 s                       | Warnung           |
| `ArkvoryCompletionBacklog`                                      | Der älteste eingereihte Abschlussauftrag wartet mehr als 10 Minuten                            | Warnung           |
| `ArkvoryTransferAdmissionRejections`                            | Mehr als 0,1 abgelehnte oder zeitlich überschrittene Übertragungen pro Sekunde über 15 Minuten | Warnung           |
| `ArkvoryDiagnosticsDropped`                                     | In den letzten 15 Minuten wurden Logzeilen verworfen                                           | Warnung           |
| `ArkvoryMetricsCollectionFailing`                               | Eine datenbankgestützte Metrik konnte nicht gelesen werden                                     | Warnung           |
| `ArkvoryTlsCertificateExpiring`, `ArkvoryTlsCertificateExpired` | Das integrierte Zertifikat läuft in weniger als 14 Tagen ab oder ist abgelaufen                | Warnung, kritisch |
| `ArkvoryBackupStale`                                            | Der neueste Punkt ist älter als 26 Stunden                                                     | Kritisch          |
| `ArkvoryBackupAgentOffline`                                     | Mehr als 2 Minuten kein Heartbeat, über 5 Minuten                                              | Kritisch          |
| `ArkvoryBackupWarning`                                          | `vault_unavailable` oder `verify_failed` über 10 Minuten                                       | Kritisch          |
| `ArkvoryMirrorStale`                                            | Ein Spiegel hat eine Stunde lang nicht mit seiner Quelle aufgeholt                             | Warnung           |
| `ArkvoryMirrorFailing`                                          | Die letzte Synchronisation eines Spiegels ist fehlgeschlagen, über 15 Minuten                  | Warnung           |

Fügen Sie diese Alarme selbst hinzu, weil Arkvory die Daten nicht exportiert:

| Alarm                                                         | Quelle                                                                    | Warum                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Freier Platz der Speicher-, Datenbank- und Backup-Datenträger | `node_exporter`                                                           | Eine volle Festplatte stoppt Uploads, die Datenbank und die Backups     |
| PostgreSQL ist ausgefallen oder hat zu viele Verbindungen     | `postgres_exporter`                                                       | Die API beendet sich und startet neu, solange die Datenbank weg ist     |
| Ein Dienst startet immer wieder neu                           | Änderung von `arkvory_process_start_time_seconds`, oder der Dienstmanager | Ein wiederholtes `startup.failed` oder `process.stalled`                |
| Der öffentliche Status ist nicht `ready`                      | Eine externe Sonde von `/health/status`                                   | Der Netzwerkpfad, der Proxy und das Zertifikat, aus Sicht eines Clients |

Testen Sie einen Alarm einmal. Stoppen Sie zum Beispiel `arkvory-backup`: `ArkvoryBackupAgentOffline` löst etwa 7 bis 8 Minuten später aus (2 Minuten ohne Heartbeat, 5 Minuten in der Regel, plus das Scrape-Intervall).

## Verwandte Seiten {#related-pages}

- [Selbstheilung](./self-healing)
- [Fehlerbehebung](./troubleshooting)
- [Backups](./backups)
- [Umgebungsvariablen](../reference/environment)
- [Fehler](../api/errors)
