---
title: Hochverfügbarkeits-Cluster
description: Arkvory auf zwei oder drei Linux-Servern eines Standorts betreiben, mit einer synchronen Kopie aller Daten, automatischem Failover und verpflichtendem Fencing.
---

# Hochverfügbarkeits-Cluster

Ein Arkvory-Cluster arbeitet weiter, wenn ein Server eines Standorts ausfällt. Zwei oder drei Linux-Server halten dieselbe Kopie eines Block-Volumes. Ein Server ist **aktiv** und führt Arkvory aus. Fällt er aus, isoliert ihn der Cluster-Manager (Fencing) und startet Arkvory auf einem anderen Server mit denselben Daten.

Der Cluster schützt vor dem Verlust eines Servers, eines Datenträgers oder einer Netzwerkverbindung innerhalb eines Standorts. Vor dem Verlust des gesamten Standorts schützt er nicht. Halten Sie dafür [Spiegel](./mirrors) an einem anderen Standort und [Backups](./backups) außerhalb des Clusters vor.

## So funktioniert es {#how-it-works}

- **Ein Volume, synchrone Kopien.** DRBD 9 kopiert jeden Schreibvorgang des Volumes auf die anderen Server, bevor der Schreibvorgang abgeschlossen wird (Protokoll C). Die gesamte Installation liegt auf dem Volume: die Datenbank, der Speicher, die Konfiguration und die Releases. Katalog und Dateibytes laufen nie auseinander.
- **Pacemaker entscheidet, wo Arkvory läuft.** Corosync und Pacemaker halten das Quorum, wählen den aktiven Server und starten der Reihe nach: das Volume, das Dateisystem, die Datenbank, `arkvory-replica`, die API, den Worker, den Backup-Agent, den Update-Timer und eine virtuelle IP-Adresse. Arkvory hat keine eigene Wahl.
- **Fencing ist verpflichtend.** Bevor ein anderer Server übernimmt, schaltet Pacemaker den ausgefallenen Server über ein Power-Gerät (IPMI, iDRAC, iLO, Redfish, eine PDU) oder einen Hypervisor aus. Ohne Fencing könnten zwei Server gleichzeitig schreiben. Ein Cluster ohne Fencing startet nicht.
- **Zwei Kopien für jeden bestätigten Schreibvorgang.** Arkvory beantwortet einen Schreibvorgang nur dann mit Erfolg, wenn er auf mindestens zwei vollständigen Kopien liegt (siehe [Schreibvorgänge und Kopien](#writes)). Fehlt eine Kopie, stoppen die Schreibvorgänge, und das Lesen geht weiter.

| Profil | Datenserver | Zeuge                                                                                                | Wenn ein Datenserver ausfällt                                                     |
| ------ | ----------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `ha-2` | 2           | erforderlich: ein kleiner Server ohne Daten, der `corosync-qnetd` und einen DRBD-Tiebreaker ausführt | Schreibvorgänge stoppen, bis der Server zurückkehrt oder ein Operator entscheidet |
| `ha-3` | 3           | nicht verwendet: die drei Server entscheiden per Mehrheit                                            | Schreibvorgänge laufen weiter: zwei Kopien bleiben                                |

`ha-3` ist das empfohlene Profil. `ha-2` kostet weniger und stoppt Schreibvorgänge ehrlich, statt Daten in nur einer Kopie zu halten.

Der Cluster ist für die nativen Linux-Pakete gedacht. Windows-Installationen und Docker Compose bleiben eigenständige Server mit Spiegeln und Backups.

## Schreibvorgänge und Kopien {#writes}

Eine **vollständige Kopie** ist der lokale Datenträger des aktiven Servers, wenn er aktuell ist, plus jeder weitere Datenserver, der verbunden ist, repliziert und aktuell ist. Ein Server, der gerade neu synchronisiert, zählt nicht, bis er aktuell ist. Der Zeuge hat keine Daten und zählt nie.

Jede Anfrage, die Daten ändert (die HTTP-API, die Container-Registry, Git LFS, npm), wird zweimal geprüft:

- **bevor** sie ausgeführt wird, anhand der Kopien der letzten Sekunde;
- **nachdem** die Daten festgeschrieben und synchronisiert sind, anhand einer frischen Messung des Volumes.

Gibt es weniger vollständige Kopien, als Schreibvorgänge benötigen, erhält der Client HTTP 503 mit dem Code `unavailable`, dem Grund `replication_degraded` und einem `Retry-After`-Header, niemals ein 2xx. Der Status eines Abschluss-Jobs für Uploads (`GET /api/v1/jobs/{id}`) wird auf dieselbe Weise geprüft, denn er teilt dem Client mit, dass ein großer Upload veröffentlicht ist.

Ein 503 nach dem Festschreiben bedeutet, dass die Operation möglicherweise nur in einer Kopie existiert. Wiederholen Sie die Anfrage mit demselben `Idempotency-Key`: Die Wiederholung liefert das vorhandene Ergebnis, und ihr 2xx bestätigt es, sobald wieder zwei Kopien existieren.

Lesezugriffe, Downloads, die Konsole, An- und Abmeldung, Feedback und die Batch-Anfrage von Git LFS funktionieren, während Schreibvorgänge gestoppt sind.

Ein in der Konsole angemeldeter Administrator sieht ein Banner, solange Schreibvorgänge gestoppt sind oder eine Entscheidung für eine einzelne Kopie aktiv ist.

## Anforderungen {#requirements}

- Zwei oder drei Datenserver mit derselben Linux-Distribution, derselben Version des Arkvory-Pakets und auf jedem einem Datenträger (oder logischen Volume) in voller Größe für das Volume. Planen Sie den gesamten Speicher plus die Datenbank ein.
- Für `ha-2` ein dritter kleiner Server als Zeuge. Er braucht keinen Datenträger für Daten und führt Arkvory nicht aus.
- Ein Netzwerk mit niedriger Latenz zwischen den Servern. Jeder Schreibvorgang wartet auf die anderen Server, die Latenz addiert sich also zu jedem Schreibvorgang. Nutzen Sie nach Möglichkeit eine dedizierte Verbindung.
- DRBD 9 (das Kernelmodul und `drbd-utils` 9; viele Distributionen liefern das ältere Modul 8.4, nutzen Sie daher die LINBIT-Pakete), `pacemaker`, `pcs`, `corosync`, `resource-agents` (unter Ubuntu `resource-agents-base` und `resource-agents-extra`), die Fence-Agents für Ihre Hardware. Für `ha-2`: `corosync-qdevice` auf den Datenservern und `corosync-qnetd` auf dem Zeugen.
- Ein Fence-Gerät für jeden Datenserver und die Zugangsdaten dafür.
- Eine freie IP-Adresse im Netzwerk der Server. Clients verbinden sich mit dieser virtuellen Adresse.
- Ein TLS-Zertifikat für die virtuelle Adresse. Legen Sie Zertifikat und Schlüssel auf dem Volume ab, damit jeder Server sie unter demselben Pfad findet.

## Einen Cluster aufbauen {#build}

Die folgenden Befehle verwenden den Standard-Ressourcennamen `arkvory`, das Installationsverzeichnis `/opt/proanima-arkvory` und `/dev/vg0/arkvory` als zugrunde liegenden Datenträger. Führen Sie sie als root aus.

1. Entpacken Sie auf jedem Datenserver das Arkvory-Paket, ohne es zu installieren. Das fügt die Dateien und den Befehl `arkvory` hinzu und legt in `/opt/proanima-arkvory` nichts an:

   ```bash
   dpkg --unpack Arkvory-amd64.deb
   ```

2. Erstellen Sie auf einem Datenserver den Plan. Er schreibt die DRBD-Ressource und die Pacemaker-Befehle in ein Verzeichnis, das Sie prüfen können:

   ```bash
   arkvory cluster-plan --cluster ha-2 \
     --nodes node-a=10.0.0.11,node-b=10.0.0.12 --witness witness=10.0.0.13 \
     --disk /dev/vg0/arkvory --fence-agent fence_ipmilan \
     --virtual-ip 10.0.0.100/24 --output /root/arkvory-plan
   ```

   Für `ha-3` geben Sie in `--nodes` drei Server an und lassen `--witness` weg. Optional: `--cluster-resource`, `--drbd-minor` (Standard 0), `--drbd-port` (Standard 7789), `--filesystem` (`xfs` oder `ext4`, Standard `xfs`). Die Namen müssen die Hostnamen der Server sein.

3. Kopieren Sie `arkvory.res` auf jedem Server, den Zeugen eingeschlossen, nach `/etc/drbd.d/`. Erstellen Sie die Metadaten auf den Datenservern und fahren Sie die Ressource überall hoch:

   ```bash
   drbdadm create-md arkvory   # data servers only
   drbdadm up arkvory          # every server
   ```

   Führen Sie auf dem Zeugen zusätzlich `systemctl enable drbd@arkvory.service` aus, damit der Tiebreaker nach einem Neustart zurückkommt.

   Der Plan lässt eine zurückkehrende Kopie mit mindestens 20 MB/s neu synchronisieren, auch unter Schreiblast, und mit höchstens 1 GB/s. Stellen Sie `c-min-rate` und `c-max-rate` im Abschnitt `disk` auf das ein, was Ihre Replikationsverbindung trägt.

4. Machen Sie den ersten Datenserver zum Primary, erstellen Sie das Dateisystem und hängen Sie es ein. Bei neuen leeren Datenträgern überspringen Sie zuvor die erste Synchronisation:

   ```bash
   drbdadm new-current-uuid --clear-bitmap arkvory/0
   drbdadm primary arkvory
   mkfs.xfs /dev/drbd0
   mkdir -p /opt/proanima-arkvory && mount /dev/drbd0 /opt/proanima-arkvory
   ```

5. Installieren Sie Arkvory in das eingehängte Volume, legen Sie die TLS-Dateien auf dem Volume ab und schalten Sie den Cluster-Modus ein:

   ```bash
   dpkg --configure proanima-arkvory
   install -d -m 0750 -o root -g arkvory /opt/proanima-arkvory/config/tls
   install -m 0644 tls.crt /opt/proanima-arkvory/config/tls/tls.crt
   install -m 0640 -g arkvory tls.key /opt/proanima-arkvory/config/tls/tls.key
   arkvory configure --root /opt/proanima-arkvory --tls-cert /opt/proanima-arkvory/config/tls/tls.crt --tls-key /opt/proanima-arkvory/config/tls/tls.key --listen-host 0.0.0.0
   arkvory configure --root /opt/proanima-arkvory --cluster ha-2
   ```

   `configure --cluster` prüft, dass das Installationsverzeichnis das eingehängte DRBD-Gerät ist, dass dieser Server Primary ist und dass jede Kopie vollständig ist. Es startet `arkvory-replica`, sorgt dafür, dass Arkvory Schreibvorgänge nur mit zwei vollständigen Kopien bestätigt, und schaltet den automatischen Start der Arkvory-Dienste ab: Ab jetzt startet sie Pacemaker. Schlägt ein Schritt fehl, wird die eigenständige Konfiguration wiederhergestellt.

6. Stoppen Sie Arkvory auf dem ersten Server und geben Sie das Volume frei:

   ```bash
   systemctl stop arkvory-update.timer arkvory-backup arkvory-worker arkvory-api arkvory-replica arkvory-database
   umount /opt/proanima-arkvory && drbdadm secondary arkvory
   ```

7. Übernehmen Sie auf jedem weiteren Datenserver nacheinander das Volume, bereiten Sie den Server vor und geben Sie das Volume wieder frei:

   ```bash
   drbdadm primary arkvory
   mkdir -p /opt/proanima-arkvory && mount /dev/drbd0 /opt/proanima-arkvory
   arkvory cluster-node --root /opt/proanima-arkvory --cluster-resource arkvory
   dpkg --configure proanima-arkvory
   systemctl stop arkvory-update.timer arkvory-backup arkvory-worker arkvory-api arkvory-replica arkvory-database
   umount /opt/proanima-arkvory && drbdadm secondary arkvory
   ```

   `cluster-node` legt die Dienstkonten mit denselben Benutzer- und Gruppen-IDs wie auf dem ersten Server an (die Dateien auf dem Volume gehören ihnen) und installiert dieselben Dienste, von denen keiner automatisch startet. Existiert bereits ein Konto mit anderen IDs, bricht der Befehl ab und nennt Ihnen die zu setzenden IDs.

8. Richten Sie den Corosync-Cluster mit `pcs` auf den Datenservern ein (`pcs host auth`, `pcs cluster setup`, `pcs cluster start --all`). Führen Sie unter Debian und Ubuntu zuerst `pcs cluster destroy` auf jedem Datenserver aus: Die Pakete installieren eine Corosync-Beispielkonfiguration, die `pcs` für einen bestehenden Cluster hält. Führen Sie `pcs cluster enable` nicht aus: Ein Server, der per Fencing isoliert wurde, soll sich erst wieder anschließen, wenn Sie ihn starten. Authentifizieren Sie für `ha-2` auch den Zeugen und führen Sie auf ihm `pcs qdevice setup model net --enable --start` aus. Unter Debian und Ubuntu hat das Paket das Quorum-Gerät bereits für sein eigenes Dienstkonto eingerichtet: Führen Sie dort stattdessen `systemctl enable --now corosync-qnetd` aus.

9. Öffnen Sie `/root/arkvory-plan/pacemaker.sh`. Ersetzen Sie jedes `<agent parameters: …>` durch die Parameter Ihres Fence-Geräts: seine Adresse, den Login, die Passwortdatei oder den Schlüssel sowie den Anschluss oder Port dieses Servers. Führen Sie das Skript dann auf einem Datenserver aus:

   ```bash
   sh /root/arkvory-plan/pacemaker.sh
   ```

   Das Skript baut die gesamte Konfiguration in einer Datei auf und überträgt sie auf einmal: Fencing, Quorum-Richtlinie, die DRBD-Ressource, die Arkvory-Gruppe und ihre Constraints.

10. Prüfen Sie den Cluster auf dem aktiven Server:

    ```bash
    arkvory cluster-check --root /opt/proanima-arkvory
    ```

    Der Befehl prüft das Quorum, dass Fencing aktiviert ist, dass jeder Server ein Fence-Gerät hat, die Quorum- und Fencing-Einstellungen von DRBD, dass jede Kopie vollständig ist und dass Arkvory auf genau einem Server läuft. Er endet mit einem Fehler, wenn eine Prüfung fehlschlägt.

11. Beweisen Sie das Fencing einmal: Isolieren Sie jeden Standby-Server per Fencing und lassen Sie ihn zurückkommen (siehe [Fencing-Test](#fence-test)).

Richten Sie Ihre Clients und den DNS-Namen auf die virtuelle Adresse.

## Täglicher Betrieb {#operation}

Führen Sie diese Befehle als root aus. `cluster-status` und `cluster-single-copy` lesen das Volume, führen Sie sie daher auf dem aktiven Server aus; die übrigen funktionieren auf jedem Datenserver.

| Befehl                                                                    | Was er tut                                                                                                        |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `arkvory cluster-status --root <dir>`                                     | Profil, Rolle dieses Servers, vollständige und erforderliche Kopien und jede Operator-Entscheidung, als JSON      |
| `arkvory cluster-check --root <dir>`                                      | Alle Prüfungen eines gesunden Clusters; endet mit einem Fehler, wenn eine fehlschlägt                             |
| `arkvory cluster-switchover --root <dir> --to <server>`                   | Geplanter Umzug von Arkvory auf einen anderen Datenserver; abgelehnt, solange nicht jede Kopie vollständig ist    |
| `arkvory cluster-fence-test --root <dir> --node <standby>`                | Isoliert einen Standby-Server per Fencing, um sein Fence-Gerät zu beweisen; der aktive Server wird abgelehnt      |
| `arkvory cluster-single-copy --root <dir> --until <time> --reason <text>` | Akzeptiert Schreibvorgänge mit einer einzelnen Kopie bis zu einem Zeitpunkt; siehe [Einzelne Kopie](#single-copy) |

`pcs status` zeigt den Cluster so, wie Pacemaker ihn sieht.

### Geplanter Switchover {#switchover}

`cluster-switchover` bittet Pacemaker, die Gruppe zu verschieben, wartet bis zu 5 Minuten, bis Arkvory auf dem Ziel läuft, und entfernt dann die temporäre Platzierungsregel. Verbindungen zum alten Server brechen während des Umzugs ab; Clients wiederholen ihre Anfragen. Arkvory wechselt nie von selbst zurück.

### Fencing-Test {#fence-test}

`cluster-fence-test` startet einen Standby-Server über sein Fence-Gerät neu. Starten Sie nach dem Neustart den Cluster auf diesem Server mit `pcs cluster start`. Die Cluster-Dienste starten nach einem Neustart nicht von selbst (Schritt 8 von [Einen Cluster aufbauen](#build)), ein per Fencing isolierter Server schließt sich also nie ohne Ihr Zutun wieder an.

### Updates {#updates}

Installieren Sie ein neues Paket auf jedem Datenserver. Auf Standby-Servern ersetzt das Paket nur die Programmdateien, weil das Release auf dem Volume liegt. Auf dem aktiven Server wendet das Paket das Release an: Arkvory weist Pacemaker an, die Gruppe in Ruhe zu lassen, stoppt die Dienste, migriert, startet sie, wartet, bis sie bereit sind, und gibt die Gruppe zurück. Automatische Updates funktionieren auf dem aktiven Server genauso.

Starten oder stoppen Sie die Arkvory-Dienste auf einem Cluster-Server nicht mit `systemctl`. Pacemaker würde das als Ausfall werten. Verwenden Sie `pcs resource disable arkvory` und `pcs resource enable arkvory` für einen geplanten Stopp des gesamten Dienstes.

## Ausfälle {#failures}

| Was passiert                                                               | `ha-2`                                                                                                                      | `ha-3`                                                                                |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Ein Standby-Server fällt aus                                               | Isoliert. Lesen geht weiter, Schreibvorgänge erhalten 503 `replication_degraded`                                            | Isoliert. Lesen und Schreiben gehen weiter                                            |
| Der aktive Server fällt aus                                                | Isoliert, Arkvory startet auf dem anderen Server. Lesen kehrt zurück, Schreibvorgänge warten auf die zweite Kopie           | Isoliert, Arkvory startet auf einem anderen Server. Lesen und Schreiben kehren zurück |
| Netzwerktrennung zwischen Datenservern                                     | Der Zeuge gibt einer Seite das Quorum; die andere Seite wird isoliert. Nie zwei Schreiber                                   | Die Mehrheitsseite arbeitet weiter; der andere Server wird isoliert                   |
| Zwei von drei Mitgliedern fallen aus (ha-2: ein Datenserver und der Zeuge) | Der letzte Server hat kein Quorum: Arkvory stoppt. Nie ein Schreiber ohne Quorum. Holen Sie die Server zurück (siehe unten) | Dasselbe bei zwei Datenservern                                                        |
| Fencing funktioniert nicht                                                 | Kein Failover. Arkvory bleibt gestoppt, bis das Fencing gelingt                                                             | Dasselbe                                                                              |

So holen Sie einen isolierten Server zurück:

1. Beheben Sie die Ursache und starten Sie den Server.
2. Führen Sie darauf `pcs cluster start` aus.
3. Das Volume synchronisiert die geänderten Blöcke neu. Schreibvorgänge setzen von selbst wieder ein, sobald alle benötigten Kopien wieder vollständig sind; `arkvory cluster-status` zeigt den Fortschritt.

Starten Sie nach einem Quorum-Verlust den Cluster auf jedem Server, der zurück ist. Pacemaker führt Arkvory wieder auf dem Server mit der neuesten Kopie aus. Der Server, der das Quorum zuletzt verloren hat, kann auf dem Rückweg noch einmal isoliert werden, weil er nicht sauber stoppen konnte: Starten Sie den Cluster nach seinem Neustart erneut auf ihm.

Ist das Fencing fehlgeschlagen und haben Sie es repariert, löschen Sie die fehlgeschlagenen Versuche auf einem laufenden Server, damit Pacemaker es erneut versucht: `pcs stonith history cleanup <server>` und `pcs resource cleanup`.

### Einzelne Kopie {#single-copy}

Bleibt ein Datenserver lange aus (zum Beispiel bei einem Datenträgertausch) und kosten gestoppte Schreibvorgänge mehr als das Risiko, kann ein Operator für begrenzte Zeit Schreibvorgänge mit einer Kopie akzeptieren:

```bash
arkvory cluster-single-copy --root /opt/proanima-arkvory --until 2026-10-12T18:00:00Z --reason "disk replacement on node-b"
```

- Der Zeitpunkt muss innerhalb der nächsten 7 Tage liegen. Der Befehl funktioniert nur, solange Kopien fehlen.
- Solange die Entscheidung aktiv ist, gehen beim Ausfall des aktiven Servers die danach bestätigten Schreibvorgänge verloren.
- Das Konsolen-Banner, die Metrik `arkvory_replication_required_copies` und der Alarm `ArkvorySingleCopyWrites` zeigen die Entscheidung an.
- Sie endet zu ihrem Zeitpunkt, mit `--off` oder von selbst, sobald alle Kopien wieder vollständig sind. Ein späterer Verlust stoppt die Schreibvorgänge erneut.

## Monitoring {#monitoring}

`GET /health/ready` bleibt auf dem aktiven Server 200, während Schreibvorgänge gestoppt sind, damit ein Monitor einen gesunden Server nicht verschiebt. Sein Feld `writable` ist `false`, und das Feld `replication` zeigt `copies`, `required` und `singleCopyUntil`; `replication` ist `null`, wenn die Kopien nicht gelesen werden können. Eigenständige Server haben kein Feld `replication`.

| Metrik                                     | Bedeutung                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `arkvory_replication_copies`               | Vollständige Kopien bei der letzten Prüfung                                          |
| `arkvory_replication_required_copies`      | Kopien, die ein Schreibvorgang braucht: 2, oder 1 bei einer Einzelkopie-Entscheidung |
| `arkvory_replication_writes_refused_total` | Schreibvorgänge, die mit 503 `replication_degraded` beantwortet wurden               |
| `arkvory_replication_check_failures_total` | Fehlgeschlagene Messungen des Kopie-Zustands                                         |

Die Alarmregeln in `deploy/monitoring/arkvory-alerts.yml` enthalten `ArkvoryReplicationDegraded`, `ArkvorySingleCopyWrites` und `ArkvoryReplicationCheckFailing`. Beobachten Sie auch den Cluster selbst: Führen Sie `arkvory cluster-check` regelmäßig aus und alarmieren Sie auf seinen Exit-Code, oder nutzen Sie das Monitoring Ihrer Pacemaker-Installation. Siehe [Monitoring](./monitoring).

## Backups {#backups}

Der Backup-Agent läuft nur auf dem aktiven Server, als Teil der Gruppe. Halten Sie den Backup-Speicher außerhalb des Cluster-Volumes vor, zum Beispiel auf einem NAS. Siehe [Backups](./backups).
