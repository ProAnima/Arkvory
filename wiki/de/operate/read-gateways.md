---
title: Lese-Gateways
description: 'Führen Sie zusätzliche reine Download-API-Prozesse auf demselben Server und Speicher aus, teilen Sie ein Download-Budget zwischen ihnen und überwachen Sie sie.'
---

# Lese-Gateways

Ein **Lese-Gateway** ist ein zusätzlicher API-Prozess, der nur Downloads ausliefert. Er läuft auf demselben Server wie die Haupt-API (der **Writer**), verwendet dieselbe PostgreSQL-Datenbank und dasselbe Speicherverzeichnis und teilt sich ein Download-Budget mit dem Writer und den anderen Gateways.

Verwenden Sie Gateways, um viele parallele Downloads auf mehrere Prozesse zu verteilen, während die Gesamtdownloadrate unter einer von Ihnen festgelegten Grenze bleibt. Ein Gateway kopiert keine Daten. Es liest die Dateien, die der Writer veröffentlicht hat, ein Gateway hinkt also nie hinterher. Es schützt Sie auch nicht vor dem Verlust des Servers oder des Datenträgers. Dafür siehe [Backups](./backups) und [Spiegel](./mirrors).

## So funktioniert es {#how-it-works}

- Die Installation hat einen Writer und bis zu 15 Lese-Gateways. Zusammen sind sie höchstens 16 **Slots**. Der Writer verwendet immer Slot 0. Jedes Gateway verwendet seinen eigenen Slot von 1 bis zur Anzahl der Slots minus eins.
- Alle Prozesse verwenden eine PostgreSQL-Datenbank und ein Speicherverzeichnis. Ein Gateway prüft, dass der Speicher existiert und zur Datenbank gehört. Es erstellt ihn nie.
- Sie legen eine Gesamtdownloadrate für alle Prozesse fest. Jeder Prozess erhält einen gleichen festen Anteil: die Gesamtrate geteilt durch die Anzahl der Slots, abgerundet.
- Ein Prozess hält seinen Slot mit einem Lease in der Datenbank. Wenn er den Lease verliert, liefert er keine neuen Nutzdaten mehr aus und muss neu gestartet werden. So bleibt die Summe aller Anteile unter der Gesamtrate.

Der Writer behält seine normale Aufgabe. Er nimmt Uploads, die Konsole, die Hintergrundbereinigung und alle Änderungen an. Ein Gateway führt nie die Bereinigung aus.

## Was ein Gateway ablehnt {#refusals}

Ein Gateway akzeptiert nur `GET` und `HEAD`. Jede Anfrage, die etwas ändert, erhält HTTP 405 mit dem Header `Allow: GET, HEAD` und dem Code `read_only`, auch wenn der Schlüssel Schreibrechte hat. Dazu gehören Anmeldung und Selbstregistrierung. Die Konsole gehört nur zum Writer, sie ist auf einem Gateway also nicht verfügbar.

Repository-Berechtigungen werden bei jedem Lesezugriff geprüft, wie auf dem Writer. Sitzungen, persönliche Token und Dienstschlüssel funktionieren auf einem Gateway zum Lesen.

## Anforderungen {#requirements}

- **Derselbe Server.** Das Gateway muss genau die Dateien sehen, die der Writer veröffentlicht hat, ohne Verzögerung. Unabhängige Datenträger mit `rsync` oder einer anderen asynchronen Kopie passen nicht. Es ist noch kein Netzwerkdateisystem zertifiziert, verwenden Sie Gateways also für mehrere Prozesse auf einem Server.
- **Dieselben Dienstschlüssel.** Geben Sie jedem Prozess denselben Inhalt von `ARKVORY_KEYS_FILE`, damit die Dateischlüssel und ihre IDs übereinstimmen. Verwaltete Dienstschlüssel liegen in der Datenbank und stimmen von selbst überein.
- **Eigener Port.** Jeder Prozess auf demselben Host braucht seinen eigenen `ARKVORY_PORT`.
- **Eine schreibgeschützte Sicht auf die Dateien.** Binden Sie das Speicherverzeichnis, wo möglich, für das Gateway schreibgeschützt ein. Die HTTP-Ablehnung ersetzt keine Betriebssystemrechte. Beachten Sie, dass das Gateway weiterhin in die Datenbank schreibt: Leases, Speicherdiagnosen, die letzte Verwendungszeit persönlicher Token und die Sperren, die Dateien während des Lesens schützen.
- **Datenbankverbindungen.** Jedes Gateway braucht eine Verbindung mehr als `ARKVORY_DATABASE_POOL_SIZE`. Zählen Sie sie in `max_connections` von PostgreSQL ein.

## Ein Gateway ausführen {#run}

Die Installationsprogramme registrieren die API, den Worker und den Backup-Agent. Sie registrieren kein Gateway, und `arkvory status` verwaltet es nicht. Sie starten ein Gateway selbst, als eine weitere Instanz des API-Programms des installierten Release, mit eigener Umgebung und unter Ihrem eigenen Dienstmanager.

Einstellungen, die für alle Prozesse gleich sind, für insgesamt zwei Prozesse mit 64 MiB/s gesamt und 16 MiB/s für ein Konto oder einen Schlüssel:

```dotenv
ARKVORY_GATEWAY_SLOTS=2
ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND=67108864
ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL=16777216
```

Der Writer ergänzt:

```dotenv
ARKVORY_ROLE=api
ARKVORY_GATEWAY_SLOT=0
```

Ein Gateway ergänzt:

```dotenv
ARKVORY_ROLE=reader
ARKVORY_GATEWAY_SLOT=1
ARKVORY_PORT=8081
```

Das Gateway braucht außerdem die übrigen API-Einstellungen: `ARKVORY_DATABASE_URL` derselben Datenbank, `ARKVORY_DATA_DIR`, das zum selben Speicher führt (der Pfad darf abweichen, die Speicheridentität muss übereinstimmen), `ARKVORY_KEYS_FILE` und die HTTPS-Einstellungen, wenn das Gateway von anderen Rechnern erreichbar ist. Siehe [Umgebungsvariablen](../reference/environment#read-gateways).

| Variable                                                 | Regel                                                                                                                              |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_GATEWAY_SLOTS`                                  | Die Anzahl der Prozesse einschließlich des Writer, 2–16                                                                            |
| `ARKVORY_GATEWAY_SLOT`                                   | Der Slot dieses Prozesses, von 0 bis zur Anzahl der Slots minus eins. Der Writer ist 0, ein Gateway ist nicht 0                    |
| `ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND`               | Erforderlich. Die Gesamtrate aller Prozesse, mindestens 65 536 mal die Anzahl der Slots, höchstens 1 TiB pro Sekunde               |
| `ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL` | Die Gesamtrate für ein Konto oder einen Schlüssel über alle Prozesse. `0` bedeutet kein Limit. Ansonsten derselbe Bereich wie oben |

Wenn Sie eine dieser Variablen setzen, setzen Sie den Slot, die Anzahl der Slots und die Gesamtrate auf jedem Prozess. Ein ungültiger Wert stoppt den Prozess beim Start mit einer Meldung, die die Variable nennt. Ein Gateway ohne eine gemeinsame Download-Konfiguration weigert sich zu starten.

1. Legen Sie die Anzahl der Slots und die Raten fest.
2. Fügen Sie die drei gemeinsamen Variablen und die beiden eigenen Variablen des Writer zum Writer hinzu und starten Sie den Writer neu. Er speichert die Richtlinie in der Datenbank.
3. Starten Sie das Gateway mit seinen eigenen Variablen. Wenn seine Zahlen von der gespeicherten Richtlinie abweichen, startet es nicht.
4. Prüfen Sie die Bereitschaft jedes Prozesses und testen Sie auf jedem einen Bereichsdownload. Siehe [Gateways überwachen](#monitoring).
5. Fügen Sie das Gateway erst dann Ihrem Load Balancer hinzu.

Einige Regeln schützen das Profil:

- Ein Gateway kann erst starten, nachdem der Writer die Richtlinie gespeichert hat.
- Sobald die Richtlinie in der Datenbank existiert, startet ein Writer ohne diese Variablen nicht. Er stoppt mit der Meldung, dass die Datenbank die gemeinsame Download-Konfiguration erfordert.
- Sie können die Raten oder die Anzahl der Slots auf einer laufenden Installation nicht ändern. Siehe [Die Konfiguration ändern](#change).

## Das Download-Budget {#budget}

Jeder Prozess erhält `total / slots`, abgerundet. Dasselbe gilt für die Rate für ein Konto oder einen Schlüssel. Bei 64 MiB/s und 2 Slots liefert jeder Prozess beispielsweise bis zu 32 MiB/s, und ein Konto erhält bis zu 8 MiB/s in jedem Prozess.

- Ein Prozess kann den Anteil eines anderen nicht nutzen. Wenn einer von zwei Prozessen gestoppt ist, erhalten Sie die Hälfte der Gesamtrate. Das hält die Grenze einfach und überprüfbar.
- Die lokalen Einstellungen `ARKVORY_DOWNLOAD_BYTES_PER_SECOND` und `ARKVORY_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL` können einen Anteil senken, nicht erhöhen.
- Die Upload-Budgets bleiben beim Writer, weil Gateways keine Uploads annehmen.
- Die Warteschlange wartender Übertragungen und das Limit aktiver Übertragungen bleiben lokal pro Prozess, die Kapazitäten aller Prozesse addieren sich also.

Die Grenze gilt für die Nutzdaten der Anwendung, mit einem kleinen Burst. Sie ist keine Grenze der Netzwerkschnittstelle. Siehe [Umgebungsvariablen](../reference/environment#transfers-and-bandwidth).

## Leases und Fehler {#leases}

Die Datenbank reserviert einen Slot für 10 Sekunden. Ein Prozess erneuert ihn alle 2 Sekunden und vertraut dem Lease lokal höchstens 8 Sekunden. Ein abgelaufener Lease wird nie wiederbelebt, auch wenn eine verspätete Antwort eintrifft.

- **Lease verloren.** Der Prozess liefert keine neuen Nutzdaten mehr aus, beantwortet neue autorisierte Anfragen mit 503 und muss neu gestartet werden. Ein abgebrochener Download kann mit einem neuen Versuch oder einer Bereichsanfrage fortgesetzt werden. Das gilt auch für den Writer.
- **Neustart desselben Slots.** Der neue Prozess wartet, bis die alte Reservierung abläuft, bis zu 10 Sekunden nach ihrer letzten Erneuerung und insgesamt bis zu 15 Sekunden. Wenn ein laufendes Gateway den Slot noch hält, stoppt der neue Prozess mit `busy`.
- **Uhren.** Die Leases verlassen sich auf stabile Uhren. Ein Sprung der Uhr des Datenbankservers oder eine angehaltene virtuelle Maschine können dazu führen, dass ein Prozess über seinen Lease hinaus ausliefert. Stoppen Sie in einem solchen Fall die alten Prozesse, bevor Sie einen Ersatz starten.
- **Datenbankausfall.** Die Datenbank ist der schwache Punkt. Wird sie unerreichbar, laufen die Leases ab, und alle Prozesse stellen die Auslieferung von Nutzdaten ein.

Der Server kann einen toten Prozess, der sein Netzwerk verloren hat, nur über TCP-Keepalive bemerken. Setzen Sie `tcp_keepalives_idle`, `tcp_keepalives_interval` und `tcp_keepalives_count` in PostgreSQL, zum Beispiel auf 10, 5 und 3 Sekunden, oder setzen Sie `tcp_user_timeout`. Ohne sie wartet ein neuer Writer oder Worker möglicherweise auf den langen Standard-Timeout des Betriebssystems.

## Gateways überwachen {#monitoring}

- `GET /health/status` ist öffentlich und gibt nur `ready`, `unavailable` oder `draining` zurück, mit 503, wenn der Prozess nicht ausliefern kann (verlorener Slot oder Lease, Draining). Verwenden Sie es für Ihren Load Balancer.
- `GET /health/ready` braucht einen Schlüssel. Es gibt `role`, `writable` (auf einem Gateway immer `false`), `sharedDownloads` mit `slot`, `slots`, `active` und `leaseSeconds` sowie die Zahlen der lokalen Übertragungswarteschlangen zurück. Es antwortet 503, wenn der Slot verloren ist. Bei einer eigenständigen Installation ist `sharedDownloads` `null`.
- `GET /health/live` zeigt nur, dass der HTTP-Prozess läuft. Es sagt nicht, ob ein Gateway ausliefern kann.
- `GET /health/metrics` jedes Prozesses zeigt nur diesen Prozess. Scrapen Sie jedes Gateway und verwenden Sie die HTTP- und Übertragungsmetriken auf Prozessebene.

Prüfen Sie jeden Prozess einzeln. Ein Gateway mit `writable` false ist normal. Siehe [Monitoring](./monitoring).

## Anfragen weiterleiten {#routing}

Der Load Balancer gehört Ihnen. Arkvory liefert keinen Balancer mit.

- Senden Sie jede Anfrage, die Daten ändert, und `/console/` an den Writer.
- Sie können die Byte-Lesezugriffe zwischen dem Writer und den Gateways verteilen: `GET` und `HEAD` für `/api/v1/repositories/NAME/artifacts/ID/content`, für `.../packages/content` und für `.../asset/content`. Behalten Sie die anderen Anfragen beim Writer.
- Leiten Sie die Header `Authorization`, `Range`, `If-Range` und `ETag` weiter. Streamen Sie den Body, ohne die ganze Datei zu puffern. Leiten Sie einen Client nicht auf eine URL um, die einen Schlüssel enthält.
- Fügen Sie dem Balancer ein Backend erst hinzu, wenn seine authentifizierte Bereitschaft in Ordnung ist.

Das TypeScript-SDK kann einen unterbrochenen Download über ein anderes gesundes Backend hinter derselben Adresse fortsetzen. Eine laufende TCP-Verbindung wechselt nicht zwischen Servern.

## Die Konfiguration ändern {#change}

Sie können die Raten oder die Anzahl der Slots nicht ändern, während die Installation läuft, und Sie können nicht zu einem einzelnen Prozess zurückkehren, solange die Richtlinie existiert. Selbst wenn alle Gateways gestoppt sind, verhindert die gespeicherte Richtlinie einen Start ohne Limits.

1. Stoppen Sie den eingehenden Datenverkehr. Stoppen Sie den Writer, jedes Gateway und den Worker und bestätigen Sie, dass sie wirklich gestoppt sind.
2. Warten Sie, bis die Leases in der Datenbank abgelaufen sind.
3. Erstellen Sie ein Backup. Siehe [Backups](./backups).
4. Ein Administrator der Arkvory-Datenbank löscht alle Zeilen der Tabellen `arkvory_gateway_leases` und `arkvory_download_policy` in einer Transaktion. Das setzt nur den Koordinationszustand zurück, nicht den Katalog.
5. Starten Sie den Writer mit den neuen Einstellungen, dann die Gateways.

Tun Sie dies nie, solange noch ein Prozess laufen könnte.

Ein Update erfordert dieselbe Sorgfalt. Stoppen Sie jedes Gateway, bevor die Installation aktualisiert, und starten Sie sie danach aus dem neuen Release. Ein Gateway, das mit altem Code gegen ein neueres Datenbankschema weiterläuft, meldet sich als nicht bereit. Die Offline-Reparaturwerkzeuge für die Bereinigung erfordern ebenfalls, dass alle Gateways gestoppt sind. Die Online-Bereinigung des Writer nicht.

## Gateways oder Spiegel {#gateways-or-mirrors}

|                                                      | Lese-Gateways                                                  | Spiegel                                                                                      |
| ---------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Was es ist                                           | Mehrere API-Prozesse auf demselben Server und Speicher         | Eine zweite, unabhängige Installation mit einer Kopie der Daten                              |
| Daten                                                | Eine Kopie, live gelesen                                       | Eine zweite Kopie, mit Verzögerung gezogen                                                   |
| Konten und Schlüssel                                 | Dieselben wie der Writer                                       | Eigene                                                                                       |
| Zusätzlicher Datenträger                             | Keiner                                                         | Ja, so viel, wie die Repositorys brauchen                                                    |
| Benötigt                                             | Dieselbe Datenbank und dasselbe Dateisystem                    | Eine HTTPS-Verbindung zur Quelle und einen schreibgeschützten Schlüssel                      |
| Schützt vor einem verlorenen Server oder Datenträger | Nein                                                           | Teilweise: er liefert, während die Quelle ausgefallen ist, und Sie können auf ihn umschalten |
| Verwenden Sie es für                                 | Mehr parallele Downloads mit einer gemeinsamen Ratenbegrenzung | Einen zweiten Standort, ein Büro näher an den Benutzern, einen Standby                       |

Beide sind Ergänzungen zu Backups, kein Ersatz.

## Grenzen {#limits}

- Alle Prozesse müssen einen Server und ein Speicherverzeichnis gemeinsam nutzen. Verschiedene Maschinen benötigen ein dafür getestetes Dateisystem, und noch keines wurde getestet.
- Es gibt keine Installer-Unterstützung, kein automatisches Failover und keinen eingebauten Balancer.
- Eine Datenbank und ein Writer bleiben ein Single Point of Failure.
- Das Budget ist pro Slot fest und wird nicht umverteilt, und es gibt keine Prioritätsplanung.
- Sie können die Richtlinie auf einer laufenden Installation nicht ändern.

## Verwandte Seiten {#related-pages}

- [Spiegel](./mirrors)
- [Monitoring](./monitoring)
- [Selbstheilung](./self-healing)
- [Umgebungsvariablen](../reference/environment#read-gateways)
- [Updates](../install/updates)
