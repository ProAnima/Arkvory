---
title: Fehlerbehebung
description: Symptome, Ursachen und Korrekturen für die Fehler, die auf einem Arkvory-Server auftreten, und wie Sie die Logs und die Anfrage-ID finden.
---

# Fehlerbehebung

Finden Sie Ihr Symptom, lesen Sie die Ursache und wenden Sie die Korrektur an. Jeder Abschnitt nennt das Log-Ereignis oder den Fehler, den Sie sehen sollten. Zur Bedeutung eines Fehlercodes siehe [Fehler](../api/errors).

## Erste Schritte {#first-steps}

1. Fragen Sie den Status-Endpunkt ab: `curl -fsS http://127.0.0.1:8080/health/status`. `{"status":"ready"}` bedeutet, dass die API ihre Datenbank und ihren Speicher erreicht.
2. Lesen Sie die neuesten Logzeilen des fehlerhaften Dienstes. Siehe [Logs und Feedback](#logs-and-feedback).
3. Suchen Sie das Ereignis `startup.failed` oder `worker.unavailable`. Sein Feld `reason` nennt die Ursache.
4. Wenn ein Client einen Fehler meldet, bitten Sie um die Anfrage-ID und suchen Sie im Log nach ihr.

## Der Server startet nicht {#server-does-not-start}

Der Dienstmanager startet einen fehlerhaften Dienst alle 10 Sekunden erneut. Das Log wiederholt dann `startup.failed`. Lesen Sie das Feld `reason` sowie die Felder `errno` und `sqlstate`.

### Der Port ist belegt {#port-busy}

**Ursache.** `startup.failed` hat `errno` `EADDRINUSE`. Ein anderes Programm lauscht auf Port 8080 (`ARKVORY_PORT`), oder ein alter Arkvory-Prozess läuft noch.

**Korrektur.** Finden Sie den Besitzer des Ports und stoppen Sie ihn, oder ändern Sie den Port.

```bash
sudo ss -ltnp 'sport = :8080'
```

```powershell
Get-NetTCPConnection -LocalPort 8080 | Select-Object LocalAddress, OwningProcess
```

Um den Port zu ändern, bearbeiten Sie `ARKVORY_PORT` in `config/runtime.json` und starten Sie die Dienste neu. Die Adresse der Konsole ändert sich mit ihm.

### Die Datenbank ist nicht erreichbar oder lehnt die Anmeldung ab {#database-problems}

**Ursache.** Das Log zeigt einen dieser Gründe:

| `reason`                                                              | Bedeutung                                                                  |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `dependency unavailable`, mit `errno` `ECONNREFUSED` oder `ETIMEDOUT` | PostgreSQL ist gestoppt, lauscht anderswo, oder eine Firewall blockiert es |
| `database authentication failed`                                      | Der Benutzer oder das Passwort in `ARKVORY_DATABASE_URL` ist falsch        |
| `database does not exist`                                             | Die in der URL genannte Datenbank fehlt                                    |
| `database role lacks a required privilege`                            | Die Rolle kann die Tabellen nicht erstellen oder ändern                    |

**Korrektur.** Starten Sie PostgreSQL, oder korrigieren Sie `ARKVORY_DATABASE_URL` in `config/runtime.json` und starten Sie die Dienste neu. Die verwaltete Datenbank lauscht auf `127.0.0.1:54329` (Dienst `Arkvorydatabase` unter Windows, `arkvory-database` unter Linux). Die Dienste kommen von selbst hoch, wenn die Datenbank antwortet. Löschen Sie nicht den Ordner `database/`.

### Die Datenbank und das Programm sind sich uneinig {#migrations}

**Ursache.** Der Grund beginnt mit `unavailable:` und sagt `Database migrations 1 through N are required; run migrate`, oder `Database schema is newer than this release`, oder `database schema is missing; run migrations`. Das passiert nach einem Update, das auf halbem Weg gestoppt wurde, oder nachdem eine alte Version mit einer neueren Datenbank gestartet wurde.

**Korrektur.** Starten Sie keine ältere Version mit einer neueren Datenbank. Prüfen Sie den Zustand mit `arkvory status --root <root>` und beenden oder machen Sie das Update mit `recover` rückgängig. Siehe [Ein Update ist fehlgeschlagen](#update-failed). Um die Daten zu sichern, stellen Sie nur aus einem Backup wieder her, wenn `recover` nicht abschließen kann.

### Ein anderer Prozess besitzt den Speicher {#storage-identity}

**Ursache.** Der Grund ist `busy: Another writer or maintenance process owns this database`, oder `conflict: Database belongs to a different storage directory`. Eine zweite API läuft gegen dieselbe Datenbank, oder das Datenverzeichnis ist nicht das, mit dem diese Datenbank verwendet wurde. Jedes Speicherverzeichnis hat eine Datei `storage-id`, und die Datenbank zeichnet sie auf.

**Korrektur.** Stoppen Sie den anderen Prozess. Verwenden Sie das Datenverzeichnis, das zu dieser Datenbank gehört. Kopieren Sie `storage-id` nie in ein anderes Verzeichnis, und verbinden Sie nie zwei Installationen mit derselben Datenbank.

### Berechtigungen am Stammverzeichnis oder am Datenverzeichnis {#root-permissions}

**Ursache.** `errno` ist `EACCES` oder `EPERM`, oder der Grund ist `Cannot read ARKVORY_KEYS_FILE (EACCES)`. Das Dienstkonto kann die Konfiguration nicht lesen oder das Datenverzeichnis nicht beschreiben. Typische Ursachen sind eine Installation in einem Benutzerprofil, ein von Hand kopierter Ordner oder ein geänderter Besitzer.

**Korrektur.**

- Linux: das Stammverzeichnis und `config/` gehören `root:arkvory` mit den Modi 0750. `config/runtime.json` und `config/keys.json` haben den Modus 0640. `data/` und `logs/` gehören `arkvory:arkvory`.
- Windows: das Konto `NT AUTHORITY\LocalService` muss jeden übergeordneten Ordner des Stammverzeichnisses lesen und `data\`, `logs\` und den Update-Eingang ändern können. Führen Sie den grafischen Installer erneut aus, um die Zugriffsregeln wiederherzustellen.
- Installieren Sie in einen eigenen Ordner außerhalb von Home-Verzeichnissen und Benutzerprofilen.

### Eine Einstellung oder ein Zertifikat wird abgelehnt {#invalid-configuration}

**Ursache.** Der Grund nennt eine Variable, zum Beispiel `Invalid ARKVORY_PORT`, oder ein Zertifikatsproblem: `TLS certificate has expired`, `TLS certificate and key do not match`, `TLS key is not an unencrypted PEM private key`. Der Server startet nie in einfachem HTTP, wenn das Zertifikat falsch ist.

**Korrektur.** Korrigieren Sie die genannte Variable in `config/runtime.json`. Ein Wert außerhalb seines Bereichs stoppt den Start. Erneuern oder ersetzen Sie die Zertifikatsdateien. Verwenden Sie `arkvory configure --tls-off`, um zu einfachem HTTP zurückzukehren, während Sie die Dateien reparieren. Siehe [Umgebungsvariablen](../reference/environment).

## Die Konsole kann die API nicht erreichen {#console-unreachable}

| Meldung in der Konsole      | Ursache                                                                                                                                                                                                             | Korrektur                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [[ui:errorNetwork]]         | Der Browser bekommt keine Antwort: der Dienst ist ausgefallen, die Adresse oder der Port ist falsch, eine Firewall blockiert ihn, der Server lauscht nur auf `127.0.0.1`, oder das Zertifikat passt nicht zum Namen | Testen Sie `/health/status` vom selben Computer wie der Browser. Prüfen Sie den Dienst, die Listenadresse und die Firewall              |
| [[ui:errorGateway]]         | Ein Reverse-Proxy antwortet, aber die API dahinter nicht                                                                                                                                                            | Prüfen Sie, dass die API läuft und dass der Proxy auf ihren Port zeigt. Erhöhen Sie das Lese-Timeout des Proxys für große Übertragungen |
| [[ui:errorTimeout]]         | Der Server hat nicht rechtzeitig geantwortet                                                                                                                                                                        | Suchen Sie im Log nach `upload.deadline` oder einer beschäftigten Datenbank                                                             |
| [[ui:errorUnavailable]]     | Eine Abhängigkeit wie die Datenbank ist für einen Moment weg                                                                                                                                                        | Warten Sie und versuchen Sie es erneut. Siehe [Beschäftigt und nicht verfügbar](#retry-after)                                           |
| [[ui:errorOriginForbidden]] | Eine externe Konsole läuft auf einer Adresse, die `ARKVORY_CORS_ORIGINS` nicht aufführt                                                                                                                             | Fügen Sie den genauen Origin hinzu (Schema, Host und Port) und starten Sie die API neu                                                  |
| [[ui:sessionEnded]]         | Sie haben sich anderswo abgemeldet, das Passwort hat sich geändert, oder der Zugriff wurde widerrufen                                                                                                               | Melden Sie sich erneut an                                                                                                               |

Während eines Updates verbindet sich die Konsole von selbst neu. Senden Sie die Installationsanforderung nicht erneut. Wenn Docker Desktop verwendet wird, ist der Server weg, bis Docker Desktop läuft. Siehe [Docker](#docker).

## Anmeldeprobleme {#sign-in}

### Falscher Name oder falsches Passwort {#wrong-password}

**Ursache.** Die Meldung ist [[ui:signInFailed]] (401 `invalid_credentials`). Der Server gibt dieselbe Antwort für einen falschen Namen, ein falsches Passwort und ein deaktiviertes Konto, damit niemand herausfinden kann, welche Namen existieren.

**Korrektur.** Ein Administrator kann das Konto in [[ui:administration]] prüfen und [[ui:enableUser]] verwenden, wenn es deaktiviert ist, oder [[ui:resetPassword]], um ein neues Passwort zu setzen.

### Zu viele Versuche {#too-many-attempts}

**Ursache.** Die Antwort ist 429 `rate_limited` mit `login_attempts` und `Retry-After`. Die Adresse hat ihre 10 Versuche verbraucht, oder das Konto ist in seiner Wartezeit nach vielen falschen Passwörtern (bis zu 2 Minuten). Auch das korrekte Passwort wartet während dieser Zeit.

**Korrektur.** Warten Sie die Anzahl Sekunden in `Retry-After` ab. Ein Administrator kann die Wartezeit eines Kontos durch Zurücksetzen des Passworts löschen. Ein Neustart der API löscht die Zähler der Adressen, aber nicht die Wartezeit eines Kontos.

### Alle sind hinter einem Proxy blockiert {#blocked-behind-proxy}

**Ursache.** Der Server sieht die Adresse des Proxys als die Adresse jedes Clients, sodass alle Clients ein Budget teilen.

**Korrektur.** Setzen Sie `ARKVORY_TRUSTED_PROXIES` auf die Adressen des Proxys und starten Sie die API neu. Der Proxy muss `X-Forwarded-For` senden. Siehe [Sicherheit](./security#sign-in-limits).

### Der Besitzer ist verloren {#owner-lost}

**Ursache.** Niemand erinnert sich an ein Administratorpasswort.

**Korrektur.** Verwenden Sie den Wiederherstellungsschlüssel auf dem Server:

1. Lesen Sie den Schlüssel als root oder Administrator aus `config/bootstrap-token.txt`.
2. Öffnen Sie in der Konsole [[ui:keySignIn]], fügen Sie den Schlüssel ein und wählen Sie [[ui:connect]].
3. Öffnen Sie [[ui:administration]]. Verwenden Sie [[ui:resetPassword]] für das Konto oder [[ui:createUser]], um einen neuen Administrator zu erstellen.
4. Wählen Sie [[ui:disconnect]] und melden Sie sich mit dem Konto an.

Das Formular [[ui:welcomeOwner]] funktioniert nur, solange der Server überhaupt keine Konten hat.

### Der Wiederherstellungsschlüssel ist verloren {#recovery-key-lost}

**Ursache.** Die Datei `config/bootstrap-token.txt` wurde gelöscht oder nie gespeichert. Der Server hält nur den Hash des Schlüssels.

**Korrektur.** Schreiben Sie mit root- oder Administratorrechten auf dem Server einen neuen Schlüssel und seinen Hash. Siehe [Konfiguration](../install/configuration). Löschen Sie die Datei nicht erneut: die Installationswerkzeuge lesen sie.

## Uploads {#uploads}

### Ein Upload wird nicht fertig {#upload-stuck}

**Ursache.** Es gibt mehrere mögliche Ursachen:

- Der Client hat die Verbindung verloren. Ein Multipart-Upload behält seine aufgezeichneten Teile 7 Tage lang.
- Ein großer Upload wartet auf den Worker. Der Worker ist gestoppt, oder er schlägt fehl. Ein zweiter Worker wartet als Standby.
- Zu viele Uploads laufen gleichzeitig. Standardmäßig laufen 2, 1 pro Konto, und andere warten 20 Sekunden, dann erhalten sie 503 `busy`.
- Ein Reverse-Proxy lehnt einen großen Body ab (413) oder stoppt eine langsame Anforderung (502 oder 504).

**Korrektur.**

1. Fragen Sie den Zustand des Uploads ab: `arkvoryctl uploads status <id>`. Setzen Sie mit derselben Datei und derselben Zustandsdatei fort. Siehe [Kommandozeile](../protocols/cli#resume-interrupted-transfers).
2. Prüfen Sie den Worker: `systemctl status arkvory-worker`, `Get-Service Arkvoryworker`. Suchen Sie nach `completion.failed` und `completion.attempts_exhausted` mit der `uploadId`. Die Metrik `arkvory_completion_oldest_queued_seconds` zeigt einen wartenden Auftrag.
3. Erhöhen Sie die Limits des Proxys für die Body-Größe und die Lesezeit. Eine Upload-Anforderung stoppt nach 30 Sekunden ohne Daten und nach insgesamt 30 Minuten.
4. Eine Sitzung, die älter als 7 Tage ist, ist weg (409 `upload_expired`). Starten Sie einen neuen Upload.

### integrity_mismatch {#integrity-mismatch}

**Ursache.** Die Antwort ist 422 `integrity_mismatch`, oder der Client endet mit Code 5. Die Bytes passen nicht zur deklarierten Größe oder SHA-256. Die Datei hat sich während des Sendens geändert, der deklarierte Hash wurde für eine andere Datei berechnet, oder ein Proxy oder ein Netzwerkgerät hat den Body verändert.

**Korrektur.** Senden Sie die Datei erneut aus einer unveränderten Kopie. Die Sitzung bleibt offen, sodass eine korrigierte Datei hineingesendet werden kann. Wenn ein Download seine Prüfung immer wieder nicht besteht, laden Sie ihn einmal über einen anderen Pfad herunter und melden Sie dann die Anfrage-ID. Siehe [Logs und Feedback](#logs-and-feedback).

## Beschäftigt, ratenbegrenzt, nicht verfügbar {#retry-after}

Die Codes `busy`, `unavailable` und `rate_limited` sind vorübergehend. Die Antwort hat den Header `Retry-After` und das Feld `retryAfterSeconds`. Warten Sie so lange. Das SDK und der Kommandozeilen-Client wiederholen diese Antworten eine begrenzte Anzahl von Malen.

| Antwort                           | Ursache                                                                                                                                                                | Was zu tun ist                                                                                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 503 `busy`, Grund `request_limit` | Der Server bearbeitet `ARKVORY_MAX_REQUESTS` Anforderungen gleichzeitig (standardmäßig 128)                                                                            | Warten Sie. Erhöhen Sie das Limit nur mit genügend Speicher. Prüfen Sie `arkvory_http_requests_in_flight`                                                                                  |
| 503 `busy`                        | Die Übertragungswarteschlange ist voll, eine Übertragung hat länger als `ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS` (20 s) gewartet, oder der Server läuft vor einem Stopp aus | Warten Sie und wiederholen Sie. Erhöhen Sie `ARKVORY_MAX_UPLOADS` oder `ARKVORY_MAX_DOWNLOADS`, wenn es häufig vorkommt. `arkvory_transfer_admission_failures_total` zählt die Ablehnungen |
| 503 `unavailable`                 | Die Datenbank startet neu, der Prozess hat seinen Speicherbesitz verloren, oder der Hub ist nicht erreichbar (`hub_unreachable`)                                       | Warten Sie. Die Dienste starten von selbst neu. Siehe [Selbstheilung](./self-healing)                                                                                                      |
| 429 `rate_limited`                | Zu viele Anmelde-, Registrierungs-, Passwort- oder Feedback-Versuche                                                                                                   | Warten Sie. Siehe [Zu viele Versuche](#too-many-attempts)                                                                                                                                  |

Ein 500 `internal` hat kein `Retry-After`. Wiederholen Sie es nicht blind. Suchen Sie im Log nach seiner Anfrage-ID und melden Sie es.

## Volle Festplatte und Kontingent {#disk-full}

| Antwort, Grund      | Ursache                                                                                                                                                            | Korrektur                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 507 `storage_full`  | Der freie Platz des Speicherdatenträgers liegt unter der Reserve `ARKVORY_STORAGE_RESERVE_BYTES` (standardmäßig 1 GiB), oder die Festplatte der Datenbank ist voll | Geben Sie Platz auf dem Datenträger frei. Prüfen Sie `df -h` oder `Get-PSDrive` und den Datenträger von PostgreSQL           |
| 507 `storage_quota` | Das Repository-Kontingent ist aufgebraucht                                                                                                                         | Löschen Sie alte Builds, ändern Sie die Aufbewahrungsrichtlinie, oder erhöhen Sie das Kontingent in [[ui:repositoryStorage]] |
| 507 `catalog_limit` | Die Summe des gesamten reservierten Inhalts würde `ARKVORY_CAPACITY_BYTES` überschreiten (standardmäßig 10 TiB)                                                    | Löschen Sie Inhalt, oder erhöhen Sie den Wert in `config/runtime.json`                                                       |
| 507 `queue_full`    | Ein Konto hat 100 offene Abschlussaufträge, oder der Server hat 10.000                                                                                             | Warten Sie, bis der Worker sie beendet                                                                                       |

Solange die Festplatte voll ist, funktionieren Downloads und die Konsole weiter. `/health/ready` zeigt `"writable": false`. Das Löschen eines Artefakts in Arkvory gibt den Datenträger nicht sofort frei: die Datei wartet nach ihrer Karenzzeit auf die physische Bereinigung. Siehe [Speicher](./storage). Senken Sie die Reserve nicht, um mehr Daten hineinzupressen, weil die Datenbank und die Logs sie brauchen.

## Backups schlagen fehl {#backups-failing}

Beginnen Sie mit der Warnung in [[ui:backups]] oder `arkvoryctl backup status` und den Log-Ereignissen `backup.request.failed` und `backup.agent.failed` mit ihrem `errorCode`. Siehe [Backups](./backups).

| Warnung oder Meldung                                                                | Ursache                                                                                                                       | Korrektur                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent_offline`                                                                     | Der Backup-Dienst ist gestoppt, oder er kann nicht starten                                                                    | Starten Sie `arkvory-backup` oder `Arkvorybackup`. Lesen Sie sein Log                                                                                                                            |
| `vault_unavailable`                                                                 | Der Backup-Speicherdatenträger ist nicht eingebunden, hat keine `vault.json`, oder das Dienstkonto kann nicht hineinschreiben | Binden Sie den Datenträger ein, bevor der Dienst startet. Prüfen Sie den Besitzer und die Berechtigungen. Starten Sie unter Windows den Agent neu, wenn der Datenträger später eingebunden wurde |
| `The vault directory does not exist; create it or mount its volume first`           | Der Pfad ist falsch oder der Datenträger fehlt                                                                                | Erstellen oder binden Sie das Verzeichnis ein                                                                                                                                                    |
| `The vault directory is not writable`                                               | Das Dienstkonto hat keinen Schreibzugriff                                                                                     | Binden Sie unter Linux eine Freigabe mit `uid` und `gid` des Benutzers `arkvory` ein. Verwenden Sie unter Windows einen lokalen oder iSCSI-Datenträger                                           |
| `The directory has no vault.json: mount the vault volume, or pass --init-vault ...` | Ein leeres Verzeichnis könnte eine nicht eingebundene Freigabe sein, daher lehnt der Befehl es ab                             | Binden Sie den richtigen Datenträger ein, oder übergeben Sie `--init-vault` für einen neuen leeren Backup-Speicher                                                                               |
| `The vault must be outside the installation root and the storage directory`         | Der Backup-Speicher überlappt die Daten                                                                                       | Wählen Sie ein separates Verzeichnis auf einem anderen Datenträger                                                                                                                               |
| `Network share paths are not supported ...`                                         | Ein UNC-Pfad unter Windows. `LocalService` kann sich nicht an SMB-Freigaben anmelden                                          | Verwenden Sie einen Laufwerksbuchstaben eines lokalen oder iSCSI-Datenträgers                                                                                                                    |
| `The backup service cannot reach /home, /root, /run/user, /tmp or /var/tmp`         | Die systemd-Sandbox verbirgt diese Ordner                                                                                     | Wählen Sie ein anderes Verzeichnis                                                                                                                                                               |
| `vault_full`, `vault_low_space`                                                     | Der Backup-Speicherdatenträger ist fast voll                                                                                  | Geben Sie Platz frei oder behalten Sie weniger Punkte. Frühere Punkte bleiben intakt                                                                                                             |
| `last_run_failed`                                                                   | Das neueste Backup ist fehlgeschlagen                                                                                         | Lesen Sie den `errorCode` mit `arkvoryctl backup jobs`                                                                                                                                           |
| `verify_failed`                                                                     | Ein Punkt hat seine Prüfung nicht bestanden                                                                                   | Ändern Sie den Backup-Speicher nicht. Bewahren Sie ihn für die Analyse auf und melden Sie ihn                                                                                                    |

`arkvory configure --backup-vault` stellt die alten Einstellungen wieder her, wenn der Agent den neuen Backup-Speicher nicht innerhalb von 150 Sekunden meldet. Ein Update stoppt den Backup-Agent, sodass ein Backup, das in diesem Moment läuft, später wiederholt wird. Wenn automatische Updates an sind, halten Sie die Backup-Zeit außerhalb der Update-Stunde (standardmäßig 03:00 UTC).

## Ein Spiegel synchronisiert nicht {#mirror-not-syncing}

Schauen Sie auf das Badge [[ui:mirrorFailing]] am Repository, auf `GET /api/v1/repositories/{repository}/mirror` und auf die Worker-Ereignisse `mirror.step_failed`. Downloads funktionieren weiter aus dem kopierten Bestand. Siehe [Spiegel](./mirrors).

| `errorCode`                                                                   | Ursache                                                                                            | Korrektur                                                                                                                                                                             |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mirror_failed`, oder ein Code der Quelle wie `unauthorized` oder `forbidden` | Die Quelle ist nicht erreichbar, ihr Schlüssel ist falsch oder abgelaufen, oder es fehlt ein Recht | Testen Sie die Quelle mit dem Schlüssel. Ersetzen Sie den Schlüssel mit `arkvory configure --mirror ... --mirror-token-file`. Der Worker liest den Schlüssel nach jedem Fehler erneut |
| `mirror_mismatch`                                                             | Dieselbe ID hat an der Quelle anderen Inhalt                                                       | Die Kopie bleibt erhalten. Untersuchen Sie das Artefakt                                                                                                                               |
| `mirror_source_changed`                                                       | Das Repository hält bereits eine Kopie einer anderen Quelle                                        | Lösen Sie es mit `--mirror-detach`, und spiegeln Sie die neue Quelle in ein neues Repository                                                                                          |
| `mirror_source_behind`                                                        | Die Quelle wurde wiederhergestellt oder neu installiert                                            | Es füllt sich von selbst wieder auf, und der Code verschwindet                                                                                                                        |
| Ein Zertifikatsfehler                                                         | Die Quelle verwendet ein Firmen- oder selbstsigniertes Zertifikat                                  | Übergeben Sie `--mirror-ca-file` an `arkvory configure`. Die Prüfung wird nie abgeschaltet                                                                                            |

Die Quelle braucht ein Release mit dem Spiegel-Feed. Der Worker wartet nach einem Fehler 2 Sekunden, was sich auf bis zu 5 Minuten verdoppelt. `ArkvoryMirrorStale` löst nach einer Stunde ohne Aufholen aus.

## Ein Update ist fehlgeschlagen {#update-failed}

1. Lesen Sie den Fehler. In der Konsole zeigt [[ui:updates]] eine Meldung. Der Updater schreibt `logs\updater.log` unter Windows und `journalctl -u arkvory-update` unter Linux.
2. Prüfen Sie die installierte Version: `arkvory status --root <root>`.
3. Finden Sie Ihren Fall.

| Fall                                                               | Was passiert ist                                                                                                      | Was zu tun ist                                                                                                                                              |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dasselbe Datenbankschema, normaler Fehler                          | Der Installer hat die vorherige Version erneut gestartet                                                              | Beheben Sie die Ursache und aktualisieren Sie erneut                                                                                                        |
| Die Konsole zeigt [[ui:updateMaintenance]]                         | Ein Release mit einer Schemaänderung braucht ein geprüftes Backup, und der Installer hat vor jeder Änderung abgelehnt | Verbinden Sie einen Backup-Speicher, warten Sie auf das erste Backup, prüfen Sie erneut                                                                     |
| Die Migration ist fehlgeschlagen                                   | Ihre Transaktion wurde zurückgerollt, und die vorherige Version läuft auf dem vorherigen Schema                       | Beheben Sie die Ursache und aktualisieren Sie erneut                                                                                                        |
| Die neue Version ist nach einer guten Migration nicht gestartet    | Das Journal sagt `maintenance-required` und nennt einen Backup-Punkt                                                  | Beheben Sie die Ursache und führen Sie `recover` aus, was das Update beendet. Oder stellen Sie den Punkt mit der vorherigen Version wieder her              |
| Der Updater wurde beendet oder der Rechner hat den Strom verloren  | Die Sperre `operation.lock` und das Journal bleiben. Nichts fährt von selbst fort                                     | Das Verfahren unten                                                                                                                                         |
| Die Konsole zeigt [[ui:updateStale]] oder [[ui:updateUnavailable]] | Der Host-Scheduler läuft nicht oder ist nicht verbunden                                                               | Prüfen Sie die Aufgabe `ProAnimaArkvoryUpdate` (Windows) oder `arkvory-update.timer` (Linux). Verbinden Sie sie mit `arkvory updates-connect --root <root>` |

Nach einem unterbrochenen Updater:

1. Stoppen Sie den Scheduler und stellen Sie sicher, dass kein Updater läuft. Speichern Sie `journal.json` und die Logs.
2. Löschen Sie erst dann die Datei `operation.lock` im Installationsverzeichnis. Löschen Sie sie nie, während ein Update läuft.
3. Führen Sie `recover` aus:

   ```bash
   sudo arkvory recover --root /opt/proanima-arkvory
   ```

   ```powershell
   & 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' recover --root C:\ProgramData\ProAnima\Arkvory
   ```

   Bevor die Migration begann, stellt es die vorherige Version wieder her. Nachdem die Migration begann, wiederholt es die Migration und startet die neue Version.

4. Prüfen Sie `/health/ready`, die Abschlusswarteschlange und einen Testdownload. Schalten Sie dann den Scheduler wieder ein.

`arkvory updates-reset --root <root>` löscht eine akzeptierte Update-Anforderung, nachdem Sie den Zustand abgeglichen haben. Ein Downgrade ist nicht möglich. Siehe [Updates](../install/updates).

## Docker {#docker}

- **Nach einem Neustart von Windows läuft nichts.** Docker Desktop startet, wenn der Benutzer sich anmeldet. Schalten Sie **Start Docker Desktop when you sign in** ein, oder verwenden Sie die nativen Dienste.
- **Nach einem Neustart eines Linux-Hosts läuft nichts.** Prüfen Sie, dass die Engine beim Boot startet: `systemctl is-enabled docker`.
- **Ein Container kann keine Datei in `config/` lesen.** Die Container laufen als Benutzer `node` (uid 1000). Der Installer macht `runtime.json`, `keys.json` und `health-token.txt` für ihn lesbar. Wenn eine manuelle Bearbeitung den Besitzer oder den Modus auf 0600 geändert hat, stoppt die API mit `Cannot read ARKVORY_KEYS_FILE (EACCES)`. Stellen Sie den Modus 0644 dieser drei Dateien wieder her. Der Ordner `config/` selbst bleibt geschlossen.
- **Der Backup-Speicher ist nicht beschreibbar.** Der Agent läuft als uid 1000, daher muss der Backup-Speicher ihm gehören. `arkvory configure --backup-vault` richtet dies mit der Datei `config/compose.vault.yml` ein. Eine Freigabe, die Sie selbst einbinden, braucht `uid=1000`. Fügen Sie `-f config/compose.vault.yml` in jeden manuellen Compose-Befehl ein, sonst erstellt `up` den Backup-Container ohne den Backup-Speicher.
- **Ein Container ist `unhealthy`.** Die Health-Prüfung ruft alle 10 Sekunden `/health/ready` auf. Docker markiert den Container, startet ihn aber nicht neu. Lesen Sie das Log des API-Containers.

Zeigen Sie das Log eines Containers:

```bash
docker logs --tail 100 proanima-arkvory-api-1
```

## Ein Windows-Dienst startet nicht {#windows-service}

1. Lesen Sie den Zustand und die Fehlerausgabe:

   ```powershell
   Get-Service Arkvoryapi, Arkvoryworker, Arkvorybackup, Arkvorydatabase
   Get-Content C:\ProgramData\ProAnima\Arkvory\logs\arkvory-api.err.log -Tail 50
   ```

2. Öffnen Sie die Windows-Ereignisanzeige, **Windows Logs > System**, und suchen Sie nach Ereignissen des Service Control Managers.
3. Finden Sie Ihre Ursache:

| Ursache                                                                                                              | Korrektur                                                                                         |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Das Stammverzeichnis liegt in einem Benutzerprofil, oder `LocalService` kann einen übergeordneten Ordner nicht lesen | Installieren Sie in einen eigenen Ordner. Siehe [Berechtigungen](#root-permissions)               |
| Der Port ist belegt                                                                                                  | Siehe [Der Port ist belegt](#port-busy)                                                           |
| Der Datenbankdienst läuft nicht                                                                                      | Starten Sie `Arkvorydatabase`. Die API wiederholt alle 10 Sekunden                                |
| Die Dienste starteten „spät“ nach einem Boot                                                                         | Ihr Starttyp ist Automatisch (Verzögerter Start). Warten Sie ein paar Minuten                     |
| Antivirensoftware hat Node.js in Quarantäne gestellt                                                                 | Erlauben Sie die Dateien in `runtime\`                                                            |
| `Another installation owns this service`                                                                             | Dienste einer Installation in einem anderen Stammverzeichnis existieren. Entfernen Sie sie zuerst |
| Ein Dienst bleibt gestoppt                                                                                           | Sie oder ein Update haben ihn gestoppt. Starten Sie ihn mit `Start-Service`                       |

Führen Sie den grafischen Installer erneut aus, um die Starttypen und die Wiederherstellungsaktionen der Dienste wiederherzustellen. Siehe [Windows](../install/windows).

## Logs, Anfrage-IDs und Feedback {#logs-and-feedback}

**Finden Sie die Logs.** Linux: `journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup`. Windows: `logs\` im Installationsverzeichnis. Compose: `docker logs <container>`. Die Formate und die Ereignisse stehen in [Monitoring](./monitoring#logs).

**Finden Sie die Anfrage-ID.** Jede Antwort hat den Header `X-Request-Id`. Jeder Fehler-Body hat `requestId`. Die Konsole zeigt sie als [[ui:requestIdLabel]] unter der Meldung, und der Kommandozeilen-Client gibt sie in der Fehlerzeile aus. Durchsuchen Sie die Logs der API und des Workers nach diesem Wert, um die Anforderung und die Aufträge zu sehen, die sie gestartet hat.

**Senden Sie Feedback mit Logs.**

1. Melden Sie sich an und wählen Sie [[ui:reportOpen]] in der oberen Leiste.
2. Beschreiben Sie das Problem und fügen Sie die Anfrage-ID hinzu. Sie können bis zu 6 Screenshots hinzufügen.
3. Wenn Sie Administrator sind, schalten Sie [[ui:reportServerLog]] ein. Dies hängt die neuesten Logzeilen der API (etwa 1,5 MiB) und eine Zusammenfassung des Systems ohne Adressen und Geheimnisse an.
4. Wählen Sie [[ui:reportShow]], um genau zu sehen, was gesendet wird, dann [[ui:reportSend]].

Der Server sendet den Bericht an den Hub von ProAnimaStudio. Wenn der Hub nicht erreichbar ist oder Feedback aus ist, zeigt die Konsole die Adresse `info@proanima.net` zum Schreiben. Siehe [Sicherheit](./security#hub), was gesendet wird.

## Verwandte Seiten {#related-pages}

- [Monitoring](./monitoring)
- [Selbstheilung](./self-healing)
- [Sicherheit](./security)
- [Fehler](../api/errors)
- [Windows](../install/windows)
