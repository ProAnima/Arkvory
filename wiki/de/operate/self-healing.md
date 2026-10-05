---
title: Selbstheilung
description: Was Arkvory nach einem Absturz, einem Hänger oder einer verlorenen Datenbanksitzung selbst neu startet und fortsetzt und was noch einen Operator braucht.
---

# Selbstheilung

Arkvory startet einen ausgefallenen Dienst selbst neu und setzt unterbrochene Arbeit ohne Operator fort. Diese Seite listet auf, was neu gestartet wird, wie lange jede Wiederherstellung dauert und welche Probleme noch Sie brauchen. Ein Server ist kein Hochverfügbarkeitssystem: Ein Neustart unterbricht Verbindungen für kurze Zeit, und die Clients setzen ihre Übertragungen fort.

## Was sich selbst neu startet {#overview}

Jeder Dienst läuft unter dem Dienstmanager der Plattform. Die API, der Worker und der Backup-Agent beenden ihren eigenen Prozess, wenn sie nicht sicher fortfahren können. Der Dienstmanager startet dann einen neuen Prozess.

| Situation                                        | Linux (systemd)                               | Windows-Dienste                                                | Docker Compose                                                                     |
| ------------------------------------------------ | --------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Absturz, Kill, Speichermangel                    | Neustart nach 10 s                            | Neustart nach 10 s                                             | Die Engine startet den Container mit wachsender Pause neu                          |
| Exit ohne Stoppanforderung, auch mit Exit-Code 0 | Neustart                                      | Der Launcher wandelt den Exit in Code 1 um, Neustart nach 10 s | Neustart                                                                           |
| Verlorener Speicherbesitz oder Lease             | Exit 1, Neustart                              | Exit 1, Neustart                                               | Exit 1, Neustart                                                                   |
| Hängender Hauptthread                            | Der Watchdog beendet den Prozess, Neustart    | Dasselbe                                                       | Dasselbe                                                                           |
| Datenbank beim Start nicht erreichbar            | Exit 1, Wiederholung alle 10 s                | Exit 1, Wiederholung alle 10 s                                 | Exit 1, Wiederholung mit wachsender Pause                                          |
| Der Rechner startet neu                          | Dienste sind in `multi-user.target` aktiviert | Automatisch (Verzögerter Start)                                | Mit der Container-Engine. Docker Desktop: nachdem der Benutzer sich angemeldet hat |
| Sie stoppen den Dienst                           | Er bleibt gestoppt bis zum nächsten Boot      | Er bleibt gestoppt bis zum nächsten Boot                       | `docker compose stop` bleibt gestoppt                                              |

Eine Bereitschaftsprüfung, die von selbst fehlschlägt, startet keinen Dienst neu. Sie kann fehlschlagen, weil der Prozess vor einem Stopp ausläuft oder weil ein Ordner des Speicherverzeichnisses fehlt. Ein Neustart würde diese Ursachen nicht beheben.

## Windows-Dienste {#windows}

Der grafische Installer und `install.ps1` registrieren `Arkvoryapi`, `Arkvoryworker` und `Arkvorybackup`, die sich das Konto `NT AUTHORITY\LocalService` teilen, sowie den Datenbankdienst `Arkvorydatabase` für die verwaltete Datenbank. Siehe [Windows](../install/windows#services).

- **Starttyp.** Die API, der Worker und der Backup-Agent verwenden Automatisch (Verzögerter Start). Die Datenbank verwendet Automatisch. Ein verzögerter Start bedeutet, dass die Dienste einige Zeit nach dem Boot hochkommen, nicht im selben Moment.
- **Wiederherstellungsaktionen.** Nach einem Fehler startet Windows den Dienst nach 10 Sekunden neu. Dieselbe Aktion wiederholt sich für jeden folgenden Fehler. Der Fehlerzähler wird nach einer Stunde zurückgesetzt. Die Wiederherstellungsaktionen gelten auch, wenn der Prozess mit einem Fehlercode endet.
- **Stopp-Timeout.** 120 Sekunden, damit eine laufende Anforderung fertig werden kann.
- **Logs.** Die Ausgabe jedes Dienstes geht nach `logs\` und rotiert bei 20 MiB mit 5 alten Dateien.

Zeigen Sie die Wiederherstellungsaktionen eines Dienstes:

```powershell
sc.exe qfailure Arkvoryapi
```

Das erneute Ausführen des grafischen Installers stellt die Starttypen und die Wiederherstellungsaktionen wieder her. Ein Dienst, den Sie selbst gestoppt haben, bleibt gestoppt.

## Linux-systemd-Units {#linux}

Die Pakete und `install.sh` erstellen `arkvory-api`, `arkvory-worker` und `arkvory-backup` sowie `arkvory-database`, wenn die Datenbank verwaltet wird.

- `Restart=always` mit `RestartSec=10` startet die API, den Worker und den Backup-Agent nach jedem Exit neu, den Sie nicht angefordert haben, einschließlich Exit-Code 0.
- `StartLimitIntervalSec=0` entfernt die Grenze der Neustartversuche, sodass systemd einen fehlerhaften Dienst nie aufgibt. Ein dauerhafter Fehler wie eine falsche Einstellung führt zu einem Neustart alle 10 Sekunden, bis Sie ihn beheben.
- Die Datenbank-Unit verwendet `Restart=on-failure` mit denselben 10 Sekunden.
- `TimeoutStopSec=120` gibt einem stoppenden Dienst zwei Minuten.
- Die Units sind für `multi-user.target` aktiviert.

```bash
systemctl is-enabled arkvory-api arkvory-worker arkvory-backup
systemctl status arkvory-api arkvory-worker arkvory-backup
```

Nur systemd wird für native Dienste unterstützt. Verwenden Sie auf einem System mit einem anderen Init-System Docker Compose.

## Docker Compose {#compose}

Alle Dienste des Projekts `proanima-arkvory` verwenden `restart: unless-stopped`. Die einmaligen Schritte `initialize` und `migrate` starten nicht neu.

- Der API-Container hat eine Health-Prüfung: alle 10 Sekunden fragt er `/health/ready` mit dem Health-Schlüssel ab, mit einer Startphase von 20 Sekunden. Ein ungesunder Container wird markiert, aber nicht von Docker neu gestartet. Der Worker wartet beim Start auf eine gesunde API.
- Die Container bekommen 120 Sekunden zum Stoppen.
- Die Container-Engine muss beim Boot starten. Prüfen Sie unter Linux `systemctl is-enabled docker`. Arkvory ändert die Engine nicht.
- Docker Desktop unter Windows ist eine Anwendung eines Benutzers. Kein Container läuft, bevor der Benutzer sich anmeldet und Docker Desktop startet. Schalten Sie **Start Docker Desktop when you sign in** ein. Der Installer und `arkvory status` warnen, wenn es aus ist. Verwenden Sie für einen Server, der ohne Anmeldung starten muss, die nativen Windows-Dienste.

## Neustart nach einem Hänger {#hang}

Ein Prozess kann aufhören zu arbeiten, ohne zu enden: eine Endlosschleife, ein blockierender Aufruf oder ein Hänger im nativen Code. Der Dienstmanager sieht das nicht, weil der Prozess noch existiert. Deshalb hat jeder von API, Worker und Backup-Agent einen Watchdog.

1. Der Hauptthread erhöht einen Zähler einmal pro Sekunde.
2. Ein zweiter Thread prüft den Zähler einmal pro Sekunde.
3. Wenn sich der Zähler `ARKVORY_WATCHDOG_SECONDS` Prüfungen in Folge nicht bewegt hat (standardmäßig 60), schreibt der Watchdog den Datensatz `process.stalled` mit dem Feld `stalledSeconds` auf die Standardfehlerausgabe und beendet den Prozess.
4. Der Dienstmanager startet den Prozess wie nach einem Absturz neu.

Der Watchdog zählt seine eigenen Ticks, nicht die Uhrzeit. Wenn der Host schläft oder eine virtuelle Maschine pausiert wird, stoppen beide Threads, und nach dem Aufwachen wird kein Stillstand erfunden. Ein Hänger kostet daher bis zu 60 Sekunden plus die 10 Sekunden des Neustarts.

`ARKVORY_WATCHDOG_SECONDS` akzeptiert 10 bis 3600. Der Wert `0` schaltet den Watchdog ab. Verwenden Sie ihn nur, wenn ein Debugger den Prozess pausiert, weil ein länger als das Limit pausierter Prozess neu gestartet wird. Eine lange blockierende Operation zählt ebenfalls als Hänger. Wenn der Watchdog selbst nicht starten kann, schreibt der Dienst `process.watchdog_failed` und läuft ohne ihn weiter. Das verwaltete PostgreSQL hat keinen Watchdog. Sein Dienstmanager startet es nach einem Absturz neu. Siehe [Umgebungsvariablen](../reference/environment#watchdog).

## Verlorene Datenbanksitzung oder Speicherbesitz {#ownership}

Die API belegt mit einer Datenbanksitzung, dass sie die einzige Schreiberin des Speicherverzeichnisses ist. Die Sitzung wird alle 2 Sekunden geprüft, und eine Prüfung, die nicht innerhalb von 8 Sekunden antwortet, zählt als verloren. Der Worker belegt seine Rolle auf dieselbe Weise. Der Besitz wird nie innerhalb eines laufenden Prozesses wiederhergestellt, weil ein zweiter Prozess ihn übernommen haben könnte.

Wenn der Besitz verloren geht, zum Beispiel nach einem PostgreSQL-Neustart, tut der Prozess Folgendes:

1. schreibt `api.ownership_lost` oder `worker.ownership_lost`,
2. hört auf, Arbeit anzunehmen, und bricht die Übertragungen ab,
3. endet mit Code 1.

Der Dienstmanager startet einen neuen Prozess, der alles von Anfang an erneut prüft. Solange die Datenbank ausgefallen ist, kann der neue Prozess nicht starten, und die API endet und startet alle 10 Sekunden neu, bis PostgreSQL antwortet. Das ist zu erwarten. Clients erhalten in der Zwischenzeit 503 `unavailable` mit `Retry-After`. Ein laufender Backup-Agent endet nicht, wenn die Datenbank weg ist. Er protokolliert den Fehler und versucht es nach seinem Abfrageintervall (standardmäßig 15 Sekunden) erneut.

## Was mit laufender Arbeit passiert {#work}

Ein Absturz bricht offene Verbindungen ab. Die Daten, die bestätigt wurden, bleiben. Was als Nächstes passiert, hängt von der Art der Arbeit ab.

| Arbeit                                         | Nach einem Neustart                                                                                                                                                                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Download                                       | Der Client setzt mit einer Bereichsanforderung fort. Das SDK und der Kommandozeilen-Client tun dies von selbst                                                                                                                    |
| Multipart-Upload                               | Die aufgezeichneten Teile bleiben auf dem Server. Der Client fragt, welche Teile existieren, und sendet die fehlenden. Die Sitzung bleibt 7 Tage ab ihrer Erstellung offen                                                        |
| Upload einer ganzen Datei in einer Anforderung | Der Client sendet die Datei ab dem ersten Byte erneut                                                                                                                                                                             |
| Upload-Abschluss durch den Worker              | Siehe unten                                                                                                                                                                                                                       |
| Backup                                         | Siehe unten                                                                                                                                                                                                                       |
| Spiegel-Synchronisation                        | Der Worker speichert seine Position nach jeder angewendeten Änderung und kopiert eine Datei ab dem ersten fehlenden Teil. Nach einem Fehler wartet er 2 Sekunden, was sich zwischen den Versuchen auf bis zu 5 Minuten verdoppelt |
| Update                                         | Der Installer behält seine Sperre und sein Journal. Er fährt nicht von selbst fort. Siehe [Fehlerbehebung](./troubleshooting#update-failed)                                                                                       |

Das SDK und der Kommandozeilen-Client wiederholen Netzwerkfehler und die Antworten 408, 429, 502, 503 und 504 eine begrenzte Anzahl von Malen. Andere Clients brauchen ihre eigene Wiederholung. Siehe [Übertragungen](../use/transfers).

**Abschlussaufträge.** Ein großer Upload wird vom Worker abgeschlossen (das SDK und der Kommandozeilen-Client tun dies ab 16 GiB). Der Worker hält ein Lease von 30 Sekunden auf einen Auftrag und erneuert es alle 2 Sekunden. Wenn der Worker abstürzt, läuft das Lease innerhalb von 30 Sekunden ab, und der neu gestartete Worker übernimmt den Auftrag erneut. Ein Auftrag läuft höchstens 5 Mal. Nach einem Fehler wartet er 2 Sekunden, was sich auf bis zu 60 Sekunden verdoppelt. Diese Fehler beenden einen Auftrag sofort: `forbidden`, `invalid_input`, `integrity_mismatch` und `not_found`. Ein Auftrag, der alle Versuche verbraucht hat, erhält den Datensatz `completion.attempts_exhausted`. Wenn Sie erneut bitten, denselben Upload abzuschließen, wird der Auftrag erneut eingereiht. Der Abschluss prüft die gespeicherten Bytes, daher ist es sicher, ihn zu wiederholen.

Ein zweiter Worker auf derselben Datenbank wartet als Standby (`worker.standby`) und prüft alle 5 Sekunden, ob der erste weg ist.

**Backup-Agent.** Der Agent hält ein Lease von 60 Sekunden (`ARKVORY_BACKUP_LEASE_SECONDS`) und erneuert es alle 20 Sekunden. Nach einem Absturz übernimmt ein anderer Agent oder der neu gestartete das Lease, wenn es abläuft, sodass ein Backup bis zu einer Minute wartet. Der unterbrochene Auftrag läuft mit demselben Schlüssel erneut, bis zu 5 Mal. Eine neue Aufnahme gibt die Sperren einer toten frei. Die Warnung `agent_offline` erscheint nach 2 Minuten ohne Heartbeat. Während eines Updates stoppt der Installer zuerst den Agent, und das laufende Backup endet als `interrupted` und wird erneut eingereiht.

**Ratenbegrenzungen.** Die Anmeldezähler pro Adresse leben im Prozess und werden bei einem Neustart zurückgesetzt. Der Backoff eines Kontos steht in der Datenbank und bleibt.

## Prüfungen beim Start {#startup-checks}

Jeder Prozess prüft seine Umgebung, bevor er dient. Eine fehlgeschlagene Prüfung beendet den Prozess mit Exit-Code 1 und einer Zeile `startup.failed` (API) oder `worker.unavailable` (Worker). `reason` nennt die Ursache ohne Geheimnisse.

| Prozess      | Was geprüft wird                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API          | Jede Einstellung hat einen gültigen Wert; die Meldung nennt die Variable, nie ihren Wert. Die Schlüsseldatei liest sich als JSON bis zu 1 MiB. Integriertes TLS: das Zertifikat und der Schlüssel lesen sich, passen zusammen und sind nicht abgelaufen; es gibt keinen Rückfall auf HTTP. Das Speicherverzeichnis ist beschreibbar. Die Datenbank antwortet und hat jede Migration dieses Releases und keine aus einem neueren. Die Datei `storage-id` im Speicherverzeichnis entspricht der in der Datenbank gespeicherten Identität. Kein anderer Schreiber hält die Datenbank |
| Worker       | Dieselben Einstellungen, die Datenbank, die Speicheridentität und die Sperre des einzigen Workers. Ein zweiter Worker wartet als Standby                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Backup-Agent | Die Speicheridentität, die Schemanummer und dass der Backup-Speicher das Speicherverzeichnis nicht überlappt. Ein fehlender oder nicht eingebundener Backup-Speicher ist nicht fatal. Der Agent meldet ihn als Warnung                                                                                                                                                                                                                                                                                                                                                            |

Nach einem Update wartet der Installer auf drei erfolgreiche Bereitschaftsantworten in Folge und auf einen laufenden Worker. Dann wartet er etwa 90 Sekunden auf den Heartbeat des Backup-Agents. Ein fehlender Agent ist nur eine Warnung und setzt nie ein Update zurück.

## Was noch Sie braucht {#operator}

Selbstheilung deckt Ausfälle eines Prozesses ab. Diese brauchen einen Operator:

- **Ein dauerhafter Fehler.** Eine falsche Einstellung, eine nicht erreichbare Datenbank, eine volle Festplatte oder falsche Berechtigungen lassen den Dienst alle 10 Sekunden ohne Erfolg neu starten. Lesen Sie `startup.failed` und beheben Sie die Ursache. Siehe [Fehlerbehebung](./troubleshooting).
- **Ein fehlgeschlagenes Update.** Ein unterbrochenes Update behält seine Sperre und sein Journal, bis Sie `recover` ausführen.
- **Beschädigte Backups.** `verify_failed` und `vault_unavailable` brauchen eine Person. Der Agent lässt den Backup-Speicher unverändert.
- **Zertifikate.** Arkvory liest erneuerte Zertifikatsdateien ohne Neustart (standardmäßig alle 300 Sekunden), aber Ihre Werkzeuge müssen sie erneuern.
- **Ein gestoppter Dienst.** Ein Dienst, den Sie gestoppt haben, bleibt gestoppt.
- **Die Plattform.** Docker muss beim Boot starten. PostgreSQL-Hauptversionen, Node.js und das Betriebssystem aktualisieren Sie.
- **Ein verlorener Server oder Datenträger.** Es gibt kein Failover. Stellen Sie aus einem Backup wieder her. Siehe [Backups](./backups).

## Verwandte Seiten {#related-pages}

- [Monitoring](./monitoring)
- [Fehlerbehebung](./troubleshooting)
- [Windows](../install/windows)
- [Umgebungsvariablen](../reference/environment)
