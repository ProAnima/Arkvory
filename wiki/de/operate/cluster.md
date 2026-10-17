---
title: Hochverfügbarkeits-Cluster
description: Arkvory auf zwei oder drei Linux-Servern eines Standorts betreiben, mit einer synchronen Kopie aller Daten, automatischem Failover und verpflichtendem Fencing.
---

# Hochverfügbarkeits-Cluster

Ein Arkvory-Cluster arbeitet weiter, wenn ein Server eines Standorts ausfällt. Zwei oder drei Linux-Server halten dieselbe Kopie eines Block-Volumes. Ein Server ist **aktiv** und führt Arkvory aus. Fällt er aus, isoliert ihn der Cluster-Manager (Fencing) und startet Arkvory auf einem anderen Server mit denselben Daten.

Der Cluster schützt vor dem Verlust eines Servers, eines Datenträgers oder einer Netzwerkverbindung innerhalb eines Standorts. Vor dem Verlust des gesamten Standorts schützt er nicht. Halten Sie dafür [Spiegel](./mirrors) an einem anderen Standort und [Backups](./backups) außerhalb des Clusters vor.

## So funktioniert es {#how-it-works}

- **Ein Volume, synchrone Kopien.** DRBD 9 kopiert jeden Schreibvorgang des Volumes auf die anderen Server, bevor der Schreibvorgang abgeschlossen wird (Protokoll C). Die gesamte Installation liegt auf dem Volume: die Datenbank, der Speicher, die Konfiguration und die Releases. Katalog und Dateibytes laufen nie auseinander.
- **Pacemaker entscheidet, wo Arkvory läuft.** Corosync und Pacemaker halten das Quorum, wählen den aktiven Server und starten der Reihe nach: das Volume, das Dateisystem, die Dienste so, wie das Volume sie hält (`arkvory-units`), die Datenbank, `arkvory-replica`, die API, den Worker, den Backup-Agent, den Update-Timer und eine virtuelle IP-Adresse. Arkvory hat keine eigene Wahl.
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

   Mit dem RPM-Paket installieren Sie die Dateien, ohne seine Skripte auszuführen: `rpm -i --noscripts Arkvory-x86_64.rpm`. Auf dem ersten Server installieren Sie das Paket stattdessen in Schritt 5 regulär; erstellen Sie den Plan in Schritt 2 daher auf einem anderen Datenserver.

2. Erstellen Sie auf einem Datenserver den Plan. Er schreibt die DRBD-Ressource und die Pacemaker-Befehle in ein Verzeichnis, das Sie prüfen können:

   ```bash
   arkvory cluster-plan --cluster ha-2 \
     --nodes node-a=10.0.0.11,node-b=10.0.0.12 --witness witness=10.0.0.13 \
     --disk /dev/vg0/arkvory --fence-agent fence_ipmilan \
     --virtual-ip 10.0.0.100/24 --output /root/arkvory-plan
   ```

   Für `ha-3` geben Sie in `--nodes` drei Server an und lassen `--witness` weg. Optional: `--cluster-resource`, `--drbd-minor` (Standard 0), `--drbd-port` (Standard 7789), `--filesystem` (`xfs` oder `ext4`, Standard `xfs`). Die Namen müssen die Hostnamen der Server sein. Adressen sind IPv4.

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

5. Installieren Sie Arkvory in das eingehängte Volume (mit RPM: `rpm -i Arkvory-x86_64.rpm` statt `dpkg --configure`), legen Sie die TLS-Dateien auf dem Volume ab und schalten Sie den Cluster-Modus ein:

   ```bash
   dpkg --configure proanima-arkvory
   install -d -m 0750 -o root -g arkvory /opt/proanima-arkvory/config/tls
   install -m 0644 tls.crt /opt/proanima-arkvory/config/tls/tls.crt
   install -m 0640 -g arkvory tls.key /opt/proanima-arkvory/config/tls/tls.key
   arkvory configure --root /opt/proanima-arkvory --tls-cert /opt/proanima-arkvory/config/tls/tls.crt --tls-key /opt/proanima-arkvory/config/tls/tls.key --listen-host 0.0.0.0
   arkvory configure --root /opt/proanima-arkvory --cluster ha-2
   ```

   `configure --cluster` prüft, dass das Installationsverzeichnis das eingehängte DRBD-Gerät ist, dass dieser Server Primary ist und dass mindestens zwei Kopien vollständig sind. Es startet `arkvory-replica`, sorgt dafür, dass Arkvory Schreibvorgänge nur mit zwei vollständigen Kopien bestätigt, und schaltet den automatischen Start der Arkvory-Dienste ab: Ab jetzt startet sie Pacemaker. Schlägt ein Schritt fehl, wird die eigenständige Konfiguration wiederhergestellt.

6. Stoppen Sie Arkvory auf dem ersten Server und geben Sie das Volume frei:

   ```bash
   arkvory cluster-release --root /opt/proanima-arkvory
   ```

   Der Befehl stoppt die Arkvory-Dienste in der richtigen Reihenfolge, hängt das Volume aus und macht diesen Server zum Secondary.

7. Bereiten Sie nacheinander jeden weiteren Datenserver vor:

   ```bash
   arkvory cluster-node --root /opt/proanima-arkvory
   dpkg --configure proanima-arkvory   # nur .deb; mit RPM ist nichts weiter nötig
   ```

   `cluster-node` übernimmt das Volume, bereitet den Server vor und gibt das Volume wieder frei, auch wenn ein Schritt fehlschlägt; gemeldet wird der erste Fehler. `--cluster-resource` ist nur nötig, wenn die Ressource nicht `arkvory` heißt. Der Befehl wird auf einem Server abgelehnt, der den Cluster bereits mit eingehängtem Volume bedient (geben Sie es zuerst mit `cluster-release` frei), und solange Pacemaker die Arkvory-Gruppe verwaltet, weil das Volume dann dem Cluster gehört: Fügen Sie einen Server einem laufenden Cluster so hinzu, wie in [Einen Server ersetzen](#replace-node) beschrieben. `cluster-node` legt die Dienstkonten mit denselben Benutzer- und Gruppen-IDs wie auf dem ersten Server an (die Dateien auf dem Volume gehören ihnen) und installiert dieselben Dienste, von denen keiner automatisch startet. Existiert bereits ein Konto mit anderen IDs, bricht der Befehl ab und nennt Ihnen die zu setzenden IDs. Jedes Mal, wenn ein Server aktiv wird, übernimmt `arkvory-units` zuerst die Dienste vom Volume, sodass später auf dem aktiven Server geänderte Einstellungen (zum Beispiel ein Backup-Speicher) auch nach einem Failover gelten.

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

    Der Befehl prüft das Quorum, dass Fencing aktiviert ist, dass jeder Server ein Fence-Gerät hat, die Quorum- und Fencing-Einstellungen von DRBD, dass mindestens zwei Kopien vollständig sind und dass Arkvory auf genau einem Server läuft. Er endet mit einem Fehler, wenn eine Prüfung fehlschlägt.

11. Beweisen Sie das Fencing einmal: Isolieren Sie jeden Standby-Server per Fencing und lassen Sie ihn zurückkommen (siehe [Fencing-Test](#fence-test)).

Richten Sie Ihre Clients und den DNS-Namen auf die virtuelle Adresse.

## Täglicher Betrieb {#operation}

Führen Sie diese Befehle als root aus. `cluster-status`, `cluster-single-copy` und `cluster-kit` lesen das Volume, führen Sie sie daher auf dem aktiven Server aus; `cluster-check`, `cluster-switchover` und `cluster-fence-test` funktionieren auf jedem Datenserver.

| Befehl                                                                    | Was er tut                                                                                                                  |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `arkvory cluster-status --root <dir>`                                     | Profil, Rolle dieses Servers, vollständige und erforderliche Kopien und jede Operator-Entscheidung, als JSON                |
| `arkvory cluster-check --root <dir>`                                      | Alle Prüfungen eines gesunden Clusters; endet mit einem Fehler, wenn eine fehlschlägt                                       |
| `arkvory cluster-switchover --root <dir> --to <server>`                   | Geplanter Umzug von Arkvory auf einen anderen Datenserver; abgelehnt, solange das Ziel keine vollständige Kopie hält        |
| `arkvory cluster-fence-test --root <dir> --node <standby> [--yes]`        | Isoliert einen Standby-Server per Fencing, um sein Fence-Gerät zu beweisen; der aktive Server wird abgelehnt                |
| `arkvory cluster-single-copy --root <dir> --until <time> --reason <text>` | Akzeptiert Schreibvorgänge mit einer einzelnen Kopie bis zu einem Zeitpunkt; siehe [Einzelne Kopie](#single-copy)           |
| `arkvory cluster-kit --root <dir> --output <file>`                        | Auf dem aktiven Server: die Datei, die ein neuer Server zum Beitreten braucht; siehe [Einen Server ersetzen](#replace-node) |
| `arkvory cluster-node --root <dir> --kit <file>`                          | Auf einem neuen Server: lässt ihn mit dieser Datei beitreten, ohne das Volume zu übernehmen                                 |

`pcs status` zeigt den Cluster so, wie Pacemaker ihn sieht.

### In der Konsole {#console}

Administratoren finden [[ui:cluster]] im Menü einer Cluster-Installation. Die Seite zeigt den Aufbau, den Server, der gerade bedient, die vollständigen Kopien, ob Schreibvorgänge angenommen werden, und jeden weiteren Server mit seiner Verbindung und seiner Kopie ([[ui:clusterCopyComplete]], [[ui:clusterCopySyncing]] oder [[ui:clusterCopyMissing]]). Darunter nennt [[ui:clusterNextStep]] den einen Schritt, der zum aktuellen Zustand passt, mit seinem Befehl: einen geplanten Switchover, solange alles vollständig ist, das Zurückholen oder Ersetzen eines Servers, solange eine Kopie fehlt (auch in `ha-3`, während Schreibvorgänge mit zwei Kopien weiterlaufen), und wie eine Einzelkopie-Entscheidung beendet wird. Die Seite aktualisiert sich alle 15 Sekunden von selbst.

Wenn Schreibvorgänge stoppen, weist ein Banner auf jeder Seite darauf hin; Administratoren können die Seite von dort aus öffnen. Personen ohne Administrationsrechte sehen nur, dass Uploads pausieren, während Downloads weiter funktionieren.

### Geplanter Switchover {#switchover}

`cluster-switchover` bittet Pacemaker, die Gruppe zu verschieben, wartet bis zu 5 Minuten, bis Arkvory auf dem Ziel läuft, und entfernt dann die temporäre Platzierungsregel. Der Befehl wird abgelehnt, solange das Ziel keine eigene vollständige Kopie hat, zum Beispiel während es resynchronisiert. Verbindungen zum alten Server brechen während des Umzugs ab; Clients wiederholen ihre Anfragen. Arkvory wechselt nie von selbst zurück.

### Fencing-Test {#fence-test}

`cluster-fence-test` führt zuerst die Prüfungen von `cluster-check` aus und lehnt ab, wenn eine fehlschlägt. In `ha-2` stoppt das Fencing des einzigen Standby-Servers die Schreibvorgänge, bis er zurück ist, deshalb verlangt der Befehl zusätzlich `--yes`. Er startet den Standby-Server über sein Fence-Gerät neu. Starten Sie nach dem Neustart den Cluster auf diesem Server mit `pcs cluster start`. Die Cluster-Dienste starten nach einem Neustart nicht von selbst (Schritt 8 von [Einen Cluster aufbauen](#build)), ein per Fencing isolierter Server schließt sich also nie ohne Ihr Zutun wieder an.

### Updates {#updates}

Installieren Sie ein neues Paket auf jedem Datenserver. Auf Standby-Servern ersetzt das Paket nur die Programmdateien, weil das Release auf dem Volume liegt. Auf dem aktiven Server wendet das Paket das Release an: Arkvory weist Pacemaker an, die Gruppe in Ruhe zu lassen, stoppt die Dienste, migriert, startet sie, wartet, bis sie bereit sind, und gibt die Gruppe zurück. Automatische Updates funktionieren auf dem aktiven Server genauso. Schlagen sowohl das Update als auch sein Rollback fehl, bleibt die Gruppe unverwaltet und Pacemaker führt kein Failover aus: Beheben Sie die Ursache und führen Sie dann `pcs resource cleanup arkvory` und `pcs resource manage arkvory` aus.

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

### Einen Server ersetzen {#replace-node}

Ist ein Datenserver endgültig verloren, ersetzen Sie ihn durch einen neuen mit demselben Namen und derselben Adresse. Arkvory bedient die ganze Zeit über weiter vom aktiven Server; Schreibvorgänge setzen wieder ein, sobald die neue Kopie vollständig ist.

1. Installieren Sie auf dem neuen Server dieselbe Linux-Distribution, DRBD, Pacemaker und die Fence-Agenten und entpacken Sie dieselbe Arkvory-Paketversion wie in Schritt 1 von [Einen Cluster aufbauen](#build). Installieren Sie für `ha-2` zusätzlich `corosync-qdevice`.
2. Schreiben Sie auf dem aktiven Server die Datei, die der neue Server braucht: den Ressourcennamen, die IDs der Dienstkonten und die Dienste.

   ```bash
   arkvory cluster-kit --root /opt/proanima-arkvory --output /root/arkvory-node.kit
   ```

   Kopieren Sie sie über einen sicheren Kanal auf den neuen Server. Sie enthält kein Geheimnis, beschreibt aber den Cluster.

3. Treten Sie auf dem neuen Server mit der Datei bei. Das Volume wird dafür nicht gebraucht:

   ```bash
   arkvory cluster-node --root /opt/proanima-arkvory --kit /root/arkvory-node.kit
   dpkg --configure proanima-arkvory   # nur .deb
   ```

4. Kopieren Sie `/etc/drbd.d/arkvory.res` von einem anderen Datenserver, erstellen Sie dann die Metadaten und fahren Sie die Ressource hoch. Die neue Kopie beginnt, sich vom aktiven Server aus zu füllen:

   ```bash
   drbdadm create-md arkvory
   drbdadm up arkvory
   ```

5. Ersetzen Sie das Cluster-Mitglied: Führen Sie auf dem aktiven Server `pcs host auth <server>`, `pcs cluster node remove <server>` und dann `pcs cluster node add <server> addr=<address> --start` aus. Das Fence-Gerät des Servers behält seine Konfiguration, wenn der neue Server auf dieselben Geräteeinstellungen antwortet; andernfalls aktualisieren Sie es mit `pcs stonith update`.
6. Beobachten Sie [[ui:cluster]] in der Konsole oder `arkvory cluster-status`: Der Server zeigt [[ui:clusterCopySyncing]], bis seine Kopie vollständig ist. Dann setzen Schreibvorgänge von selbst wieder ein.
7. Beweisen Sie das Fence-Gerät des neuen Servers mit `arkvory cluster-fence-test --node <server> --yes` und führen Sie `arkvory cluster-check` aus.

### Einzelne Kopie {#single-copy}

Bleibt ein Datenserver lange aus (zum Beispiel bei einem Datenträgertausch) und kosten gestoppte Schreibvorgänge mehr als das Risiko, kann ein Operator für begrenzte Zeit Schreibvorgänge mit einer Kopie akzeptieren:

```bash
arkvory cluster-single-copy --root /opt/proanima-arkvory --until 2026-10-12T18:00:00Z --reason "disk replacement on node-b"
```

- Der Zeitpunkt muss innerhalb der nächsten 7 Tage liegen und seine Zeitzone angeben: `Z` für UTC oder einen Versatz wie `+03:00`. Ohne Zeitzone lehnt der Befehl ab, weil der aktive Server den Zeitpunkt sonst in seiner eigenen Ortszeit lesen würde. Der Befehl funktioniert nur, solange Kopien fehlen.
- Solange die Entscheidung aktiv ist, gehen beim Ausfall des aktiven Servers die danach bestätigten Schreibvorgänge verloren.
- Das Konsolen-Banner, die Metrik `arkvory_replication_required_copies` und der Alarm `ArkvorySingleCopyWrites` zeigen die Entscheidung an.
- Sie endet zu ihrem Zeitpunkt, mit `--off` oder von selbst, sobald alle Kopien wieder vollständig sind. Ein späterer Verlust stoppt die Schreibvorgänge erneut.

## Monitoring {#monitoring}

`GET /health/ready` bleibt auf dem aktiven Server 200, während Schreibvorgänge gestoppt sind, damit ein Monitor einen gesunden Server nicht verschiebt. Sein Feld `writable` ist `false`, und das Feld `replication` zeigt `copies`, `required` und `singleCopyUntil`; `replication` ist `null`, wenn die Kopien nicht gelesen werden können. Für Administratoren enthält es außerdem `node` (den antwortenden Server), `profile` und `peers`, die übrigen Server mit ihrer Verbindung und Kopie, die die [Konsolenseite](#console) anzeigt. Eigenständige Server haben kein Feld `replication`.

| Metrik                                     | Bedeutung                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `arkvory_replication_copies`               | Vollständige Kopien bei der letzten Prüfung                                          |
| `arkvory_replication_required_copies`      | Kopien, die ein Schreibvorgang braucht: 2, oder 1 bei einer Einzelkopie-Entscheidung |
| `arkvory_replication_writes_refused_total` | Schreibvorgänge, die mit 503 `replication_degraded` beantwortet wurden               |
| `arkvory_replication_check_failures_total` | Fehlgeschlagene Messungen des Kopie-Zustands                                         |

Die Alarmregeln in `deploy/monitoring/arkvory-alerts.yml` enthalten `ArkvoryReplicationDegraded`, `ArkvorySingleCopyWrites` und `ArkvoryReplicationCheckFailing`. Beobachten Sie auch den Cluster selbst: Führen Sie `arkvory cluster-check` regelmäßig aus und alarmieren Sie auf seinen Exit-Code, oder nutzen Sie das Monitoring Ihrer Pacemaker-Installation. Siehe [Monitoring](./monitoring).

## Backups {#backups}

Der Backup-Agent läuft nur auf dem aktiven Server, als Teil der Gruppe. Halten Sie den Backup-Speicher außerhalb des Cluster-Volumes vor, zum Beispiel auf einem NAS. Siehe [Backups](./backups).

## Grenzen {#limits}

- Nur Linux mit den nativen Paketen. Windows-Installationen und Docker Compose können keinem Cluster beitreten.
- Fencing ist verpflichtend. Ein Cluster ohne Fence-Gerät für jeden Datenserver startet nicht, und Pacemaker verschiebt Arkvory nie ohne bestätigtes Fencing. Einen Server per SSH anzuhalten ist kein Fencing.
- `ha-2` braucht seinen Zeugen auf einer eigenen Maschine, die weder die Stromversorgung noch den Host mit den Datenservern teilt. Ein Zeuge auf einem Datenserver oder auf demselben Hypervisor macht aus einem Ausfall einen Quorumverlust. `ha-3` braucht keinen Zeugen.
- Jedes Release wird auf virtuellen Maschinen mit `fence_virsh` getestet. Ihr Fence-Agent und Ihr Fence-Gerät (IPMI, iDRAC, iLO, Redfish, eine PDU oder ein Hypervisor) nicht: Beweisen Sie sie vor Ort mit `arkvory cluster-fence-test` für jeden Datenserver, bevor Sie sich auf den Cluster verlassen, und erneut, nachdem Sie einen Server ersetzt oder ein Fence-Gerät geändert haben.
- Nur ein Standort. Der Cluster schützt weder vor dem Verlust des Standorts noch vor einer Löschung oder Beschädigung, die das Volume auf alle Server kopiert: Halten Sie [Spiegel](./mirrors) an einem anderen Standort und [Backups](./backups) vor.
- Solange eine [Ein-Kopie-Entscheidung](#single-copy) aktiv ist, verliert ein Ausfall des aktiven Servers die danach bestätigten Schreibvorgänge.
- Jeder Schreibvorgang wartet auf die anderen Datenserver, daher kommt die Latenz der Verbindung zu jedem Schreibvorgang hinzu.
- Arkvory wechselt nie von selbst auf einen reparierten Server zurück.
