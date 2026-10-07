---
title: Backups
description: 'Verbinden Sie einen Backup-Speicher, planen und prüfen Sie Backups, stellen Sie einen Wiederherstellungspunkt in einem leeren Server wieder her und testen Sie die Wiederherstellung regelmäßig.'
---

# Backups

Der Backup-Agent kopiert die Datenbank und die gespeicherten Dateien Ihrer Installation in einen **Backup-Speicher**: ein Verzeichnis auf einem anderen Datenträger oder auf einer Netzwerkfreigabe. Er arbeitet, während weiter hochgeladen und heruntergeladen wird. Jedes abgeschlossene Backup ist ein **Wiederherstellungspunkt**, den Sie prüfen und wiederherstellen können.

Diese Seite behandelt den Backup-Speicher, den Zeitplan, die Aufbewahrung, die Prüfung, die Statusseiten und das Wiederherstellungsverfahren. Die Wiederherstellung ist ein Befehl, den Sie auf dem Server ausführen. Die Konsole hat keine Schaltfläche zum Wiederherstellen.

## So funktionieren Backups {#how-backups-work}

Der Agent ist der dritte Dienst einer Installation, neben der API und dem Worker. Unter Linux heißt er `arkvory-backup`, unter Windows `Arkvorybackup` und in Docker Compose `backup`. Es arbeitet immer nur ein Agent. Ein zweiter Agent wartet und übernimmt, wenn der erste stoppt.

Der Agent erledigt drei Aufgaben:

- Er führt den täglichen Plan aus, wenn der Plan aktiviert ist.
- Er führt Aufträge aus, die Sie in der Konsole, mit `arkvoryctl` oder über die API anfordern.
- Er prüft jeden neuen Wiederherstellungspunkt und wendet die Aufbewahrung an.

Ein Wiederherstellungspunkt enthält den veröffentlichten Zustand der Installation zu einem Zeitpunkt **T**, dem Snapshot-Zeitpunkt. Dateien, die nach T veröffentlicht werden, kommen in das nächste Backup. Die Konsole zählt das Alter eines Backups ab T, nicht ab dem Zeitpunkt, an dem die Kopie abgeschlossen wurde.

Behalten Sie diese Fakten im Blick:

- Ein Backup stoppt weder Uploads noch Downloads. Während es läuft, lässt die physische Bereinigung die Dateien, die das Backup braucht, in Ruhe und entfernt sie in einem späteren Durchlauf.
- Eine Datei wird einmal im Backup-Speicher abgelegt, egal in wie vielen Wiederherstellungspunkten sie enthalten ist. Das erste Backup kopiert alles und dauert bei Terabytes an Inhalt lange. Spätere Backups kopieren nur neue Dateien.
- Ein Wiederherstellungspunkt erscheint erst, wenn seine Kopie vollständig ist. Ein fehlgeschlagenes oder unterbrochenes Backup beschädigt nie die früheren Wiederherstellungspunkte.
- Ein Backup ist kein Point-in-Time-Recovery-System und keine Hochverfügbarkeit. Sie stellen den Stand eines Wiederherstellungspunkts wieder her und verlieren die Änderungen nach dessen T.

## Was ein Backup enthält {#contents}

Ein Wiederherstellungspunkt enthält:

- Die Katalogtabellen der Datenbank: Artefakte, Pakete, Dateipfade und ihr Verlauf, Labels und Metadaten, Stufen, Anhänge, Konten, Gruppen und Berechtigungen, Dienstkonten und Schlüssel, die Audit-Trails, Speicher- und Bereinigungsrichtlinien, Container-Image-, Git-LFS- und npm-Registry-Daten sowie den Zustand der Spiegel.
- Den Inhalt jeder veröffentlichten Datei.

Ein Wiederherstellungspunkt enthält nicht:

- Anmeldesitzungen, Download-Links und den Laufzeitzustand der Lese-Gateways.
- Nicht abgeschlossene Uploads. Eine Wiederherstellung bricht sie ab, und die Clients starten sie erneut.
- Den Backup-Plan und den Agent-Zustand. Eine wiederhergestellte Installation startet mit ausgeschalteten Backups.
- Das Verzeichnis `config/` der Installation: Einstellungen, TLS-Dateien, Spiegelschlüssel, den Wiederherstellungsschlüssel. Bewahren Sie selbst Kopien dieser Dateien auf.
- Die Arkvory-Programme. Installieren Sie zuerst ein Release und stellen Sie dann wieder her.

## Den Backup-Speicher vorbereiten {#vault}

### Anforderungen {#vault-requirements}

| Anforderung                                                                                                                  | Warum                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Ein neues oder leeres Verzeichnis, eingebunden, bevor die Dienste starten                                                    | Der Agent schreibt `vault.json` und die Wiederherstellungspunkte dorthin                                                                   |
| Außerhalb des Installationsverzeichnisses und außerhalb des Speicherverzeichnisses, auch über Links, Junctions und Kurznamen | Ein Backup-Speicher innerhalb des Speichers geht mit diesem verloren. Die Prüfung lehnt einen Pfad ab, der sie enthält oder in ihnen liegt |
| Beschreibbar durch das Dienstkonto                                                                                           | Unter Linux `arkvory`. Unter Windows `NT AUTHORITY\LocalService`. `arkvory configure` setzt die Rechte für Sie                             |
| Mindestens 1 GiB freier Speicherplatz zusätzlich zu den kopierten Daten                                                      | Der Backup-Speicher hält diese Reserve. Ein volles Volume beendet das Backup mit `vault_full`, und die früheren Punkte bleiben unversehrt  |
| Unter Linux nicht unter `/home`, `/root`, `/run/user`, `/tmp` oder `/var/tmp`                                                | Die Dienst-Sandbox verbirgt diese Verzeichnisbäume                                                                                         |
| Unter Windows ein lokales oder iSCSI-Volume mit Laufwerksbuchstaben                                                          | `LocalService` kann sich nicht an SMB-Freigaben anmelden, daher werden Pfade wie `\\nas\share` abgelehnt                                   |

Verwenden Sie ein Volume auf einem anderen Datenträger oder auf einem NAS, damit ein ausgefallener Speicherdatenträger die Backups nicht mitnimmt. Ein Backup-Speicher auf demselben physischen Datenträger wie der Speicher schützt vor Fehlern, nicht vor einem Datenträgerausfall.

**Das Vault ist standardmäßig verschlüsselt.** Arkvory verschlüsselt die Dateien, den Katalog und die Beschreibungen der Punkte (siehe [Das Vault verschlüsseln](#encryption)). Ein Vault ohne Verschlüsselung enthält den Katalog, die Passwort-Hashes und alle veröffentlichten Dateien im Klartext: Legen Sie es auf ein verschlüsseltes Laufwerk (LUKS, BitLocker, NAS-Verschlüsselung) und erlauben Sie den Zugriff nur dem Dienstkonto und dem Backup-Administrator.

### Das Vault verschlüsseln {#encryption}

Ein Vault wird bei der Erstellung verschlüsselt und bleibt es. Arkvory verschlüsselt den Inhalt der Dateien, den Katalog und die Beschreibungen der Punkte mit AES-256-GCM und erkennt beim Lesen eine geänderte, abgeschnittene oder ausgetauschte Datei. Es verbirgt weder die Dateinamen noch ihre Größen noch die Anzahl der Punkte.

Erstellen Sie das Vault auf dem Server mit dem Programm `arkvory-backup` (siehe [Bevor Sie beginnen](#restore-prepare)). Beide Dateien müssen neu sein und außerhalb von Vault und Speicher liegen:

```bash
arkvory-backup vault init /mnt/backup/arkvory \
  --kit-file /root/arkvory-recovery-kit.txt \
  --agent-key-file /root/arkvory-agent.key
```

1. Der Befehl erstellt das Vault mit zwei Schlüsseln: dem Agent-Schlüssel (`arkvory-agent.key`) und dem Wiederherstellungsschlüssel im Recovery-Kit. Vor der Erfolgsmeldung öffnet er das Vault mit jedem von ihnen.
2. Bringen Sie das Recovery-Kit jetzt von diesem Server weg: in einen Passwortmanager oder einen Tresor. Ohne das Kit oder den Agent-Schlüssel kann niemand die Backups lesen, und niemand kann sie für Sie wiederherstellen. Wer das Kit und eine Kopie des Vaults hat, kann jedes darin enthaltene Backup lesen.
3. Verbinden Sie das Vault mit dem Agent-Schlüssel, wie der nächste Abschnitt zeigt, und löschen Sie Ihre Kopie der Schlüsseldatei. Die Installation behält eine eigene Kopie in `config/backup/vault.key`, lesbar nur für das Dienstkonto.

Der Wiederherstellungsschlüssel im Kit öffnet nur dieses Vault. Er ist nicht der Wiederherstellungsschlüssel der Installation (`config/bootstrap-token.txt`).

Prüfen Sie jetzt, dass das Kit das Vault öffnet, und nach jeder Änderung der Schlüssel erneut:

```bash
arkvory-backup vault key verify --vault /mnt/backup/arkvory --key-file /root/arkvory-recovery-kit.txt
```

Ein Schlüssel gehört zu einem Slot, und jeder Slot öffnet das Vault mit seinem eigenen Schlüssel. Diese Befehle ändern die Slots. Keiner zeigt einen Schlüssel:

| Befehl                                                                   | Wirkung                                                                                                                             |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `vault key list --vault DIR`                                             | Listet die Slots: ID, Art (`agent` oder `recovery`) und Erstellungszeit. Braucht keinen Schlüssel.                                  |
| `vault key add-recovery --vault DIR --key-file KEY --kit-file NEW`       | Fügt einen Recovery-Slot hinzu und schreibt dessen Kit, für eine andere Person oder einen anderen Tresor.                           |
| `vault key rotate-agent --vault DIR --key-file KEY --agent-key-file NEW` | Erzeugt einen neuen Agent-Schlüssel und entfernt den alten. Führen Sie danach `arkvory configure` mit der neuen Schlüsseldatei aus. |
| `vault key remove --vault DIR --key-file KEY --slot ID`                  | Entfernt einen Slot. Der letzte Slot und der letzte Recovery-Slot bleiben.                                                          |

Das Entfernen eines Slots sperrt das Vault für jeden, der nur diesen Schlüssel hat. Es verschlüsselt die früheren Punkte nicht neu: Wer das Vault und einen Schlüssel früher kopiert hat, liest diese Kopie weiterhin. Wenn ein Schlüssel abgeflossen sein könnte, erstellen Sie ein neues Vault mit neuen Schlüsseln und beginnen dort neue Punkte.

Ein Vault ohne Verschlüsselung ist möglich: `arkvory-backup vault init DIR --no-encryption`. Es enthält den Katalog, die Passwort-Hashes und alle Dateien im Klartext und braucht daher ein verschlüsseltes Laufwerk und Zugriff nur für das Dienstkonto.

### Den Backup-Speicher verbinden {#connect-vault}

Führen Sie den Befehl als root oder als Administrator auf dem Server aus. Er prüft das Verzeichnis, bevor er etwas ändert.

```bash
sudo arkvory configure --root /opt/proanima-arkvory --backup-vault /mnt/backup/arkvory --vault-key-file /root/arkvory-agent.key
```

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' configure --root $root --backup-vault D:\Backup\Arkvory --vault-key-file C:\Private\arkvory-agent.key
```

Bei einer Skript-Installation unter Windows starten Sie `manage.mjs` wie in [Windows](../install/windows#manage-the-services) beschrieben.

1. Der Befehl prüft den Pfad: absolut, ein vorhandenes beschreibbares Verzeichnis, außerhalb der Installation und des Speichers und für den Dienst sichtbar.
2. Ein verschlüsseltes Vault, die Voreinstellung, existiert bereits: Sie haben es mit `arkvory-backup vault init` erstellt, und `--vault-key-file` gibt dem Dienst seinen Schlüssel (einen `AK1-…`-Schlüssel, nie den Wiederherstellungsschlüssel). Mit `--init-vault --vault-no-encryption` erstellt der Befehl stattdessen ein Vault ohne Verschlüsselung in einem **leeren** Verzeichnis. Ein Verzeichnis wird nie zweimal initialisiert. Ohne `vault.json` und ohne `--init-vault` verweigert er, damit ein nicht eingebundenes NAS nicht für ein leeres Vault gehalten wird.
3. Er gibt dem Dienstkonto Zugriff, kopiert den Schlüssel nach `config/backup/vault.key`, schreibt `ARKVORY_BACKUP_VAULT` und `ARKVORY_BACKUP_VAULT_KEY_FILE` in `config/runtime.json` und startet nur den Agenten neu.
4. Er wartet bis zu 150 Sekunden, bis der Agent diesen Backup-Speicher als verfügbar meldet. Diese Prüfung liest `config/bootstrap-token.txt`, löschen Sie diese Datei also nicht.
5. Wenn etwas fehlschlägt, stellt er die vorherigen Einstellungen und den vorherigen Zugriff wieder her und startet den Agent neu.

Um ein bereits vorhandenes Vault zu verwenden, zum Beispiel auf einem neuen Server, geben Sie seinen Schlüssel mit `--vault-key-file` an und lassen `--init-vault` weg. Zum Trennen des Vaults verwenden Sie `--backup-vault-off`: Das Verzeichnis und seine Dateien bleiben unverändert, die Schlüsseldatei der Installation wird entfernt. Ein Neustart unterbricht ein laufendes Backup, und der Agent wiederholt es.

In Docker Compose ist der Backup-Speicher ein Bind-Mount aus `config/compose.vault.yml`. Wenn Sie Compose-Befehle selbst ausführen, fügen Sie `-f config/compose.vault.yml` hinzu. Ohne die Datei erstellt `up` den Agent-Container ohne den Backup-Speicher.

### Backup-Speicher auf einer Netzwerkfreigabe {#network-share}

Unter Linux funktioniert ein NAS über SMB 3 und NFS 4. Binden Sie die Freigabe so ein, dass die Dateien dem Dienstkonto gehören, sonst kann der Agent nicht schreiben, und `configure` lehnt ab und stellt die alten Einstellungen wieder her.

```bash
sudo mount -t cifs //nas/arkvory /mnt/backup/arkvory \
  -o credentials=/etc/arkvory/smb.credentials,uid=$(id -u arkvory),gid=$(id -g arkvory),file_mode=0600,dir_mode=0700,vers=3.1.1
```

- Geben Sie der Credentials-Datei den Modus `0600`.
- Ordnen Sie bei NFS die Eigentümer so zu, dass die Dateien `arkvory` gehören. Verwenden Sie `no_root_squash` auf dem Export oder dieselbe Benutzer-ID auf beiden Seiten.
- Fügen Sie den Mount mit `_netdev` zu `/etc/fstab` hinzu. Fügen Sie bei SMB `nofail` hinzu, wenn das NAS beim Start möglicherweise nicht verfügbar ist.
- Wenn das NAS ausfällt, meldet der Agent `vault_unavailable`. Er schreibt nicht in den leeren Einhängepunkt, weil die Identität des Backup-Speichers in `vault.json` gespeichert ist.

## Zeitplan und Aufbewahrung {#schedule}

### Den Zeitplan festlegen {#set-schedule}

Öffnen Sie [[ui:backups]] und verwenden Sie [[ui:backupPlan]]. Sie brauchen das Recht, Backups zu verwalten. Ohne dieses Recht zeigt das Formular [[ui:backupReadOnly]].

| Einstellung                                                   | Bedeutung                                                                                                                                        | Standard |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| [[ui:backupEnabled]]                                          | Schaltet den täglichen Plan ein. Das Einschalten startet nicht sofort ein Backup                                                                 | Aus      |
| [[ui:backupTime]]                                             | Lokale Uhrzeit des täglichen Backups, auf die Minute genau                                                                                       | 02:00    |
| [[ui:backupTimezone]]                                         | Die IANA-Zeitzone dieser lokalen Uhrzeit, zum Beispiel `Europe/Moscow` oder `UTC`. Verschiebungen wie `+03:00` werden nicht akzeptiert           | `UTC`    |
| [[ui:backupDaily]], [[ui:backupWeekly]], [[ui:backupMonthly]] | Wie viele Tage, Wochen und Monate an Wiederherstellungspunkten aufbewahrt werden. Siehe [Aufbewahrung](#retention). Grenzen: 0–366, 0–260, 0–120 | 7, 4, 6  |

Wählen Sie [[ui:backupPlanSave]]. Wenn jemand anderes den Plan zwischenzeitlich geändert hat, lädt die Konsole den aktuellen Plan, und Sie prüfen ihn und speichern erneut.

Für den Zeitplan gelten diese Regeln:

- Eine lokale Uhrzeit, die am Tag einer Zeitumstellung nicht existiert, läuft im Moment der Umstellung. Eine lokale Uhrzeit, die zweimal vorkommt, läuft einmal, zum ersten Mal.
- Nach einer Ausfallzeit macht der Agent ein nachholendes Backup, nicht eines für jeden verpassten Tag. Das Ändern des Zeitplans löst kein Nachholen für frühere Zeiten aus.
- Das standardmäßige Update-Fenster einer Installation ist 03:00 UTC. Ein Update stoppt den Agent, und ein laufendes Backup wird unterbrochen und später wiederholt. Wählen Sie eine Backup-Zeit, die nicht in das Update-Fenster fällt. Siehe [Updates](../install/updates).

### Aufbewahrung {#retention}

Die Aufbewahrung behält den neuesten Wiederherstellungspunkt jedes der letzten N lokalen Tage, jeder der letzten N ISO-Wochen und jedes der letzten N Monate, gezählt in der Zeitzone des Plans. Die drei Gruppen werden vereinigt, sodass 7, 4 und 6 höchstens 17 Punkte behalten, meist weniger.

Die Aufbewahrung behält immer:

- Angeheftete Punkte.
- Den neuesten Punkt, sodass mindestens ein Punkt immer erhalten bleibt.

Die Aufbewahrung löscht nie einen Punkt, der die Prüfung nicht bestanden hat, und berührt nie Punkte einer anderen Installation im selben Backup-Speicher.

Nach jedem Backup stellt der Agent die Aufbewahrung als separaten Auftrag in die Warteschlange. Sie können auch [[ui:backupRetentionApply]] wählen. Die Konsole zeigt zuerst, welche Punkte bleiben und welche entfernt werden. Ein Entfernen kann nicht rückgängig gemacht werden. Der Agent löscht dann den Punkt und danach die Dateien, die kein verbleibender Punkt mehr braucht. Wenn der Backup-Speicher einen beschädigten Punkt enthält (ein Punktverzeichnis ohne `COMMITTED` oder mit einem ungültigen Manifest), stoppt das Entfernen mit `invalid_manifest`. Lassen Sie den Backup-Speicher unverändert, finden Sie die Ursache und entfernen Sie dann das beschädigte Verzeichnis von Hand.

Die Backup-Aufbewahrung ändert nicht die Aufbewahrung von Builds in Ihren Repositorys. Siehe [Speicher](./storage).

### Einen Wiederherstellungspunkt anheften {#pin}

Ein angehefteter Punkt wird über die Aufbewahrungsregeln hinaus behalten. Heften Sie zum Beispiel den Punkt von vor einer großen Migration an.

- Konsole: Wählen Sie [[ui:backupPin]] in der Zeile des Punkts in [[ui:backupPoints]]. [[ui:backupUnpin]] gibt ihn frei.
- Kommandozeile: `arkvoryctl backup pin POINT_ID` und `arkvoryctl backup pin POINT_ID --off`.
- API: [setBackupPointPin](../api/reference/backups#setBackupPointPin).

## Prüfung {#verification}

Es gibt zwei Arten der Prüfung:

| Art                                                       | Was sie prüft                                                                                                              | Wann sie läuft                                                                                                                                                                            |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schnell (die Konsole zeigt [[ui:backupVerifyStructural]]) | Jede Datei des Punkts gegen den Digest in seinem Manifest und ob jede gespeicherte Datei mit der richtigen Größe existiert | Automatisch nach jedem Backup                                                                                                                                                             |
| Vollständig ([[ui:backupVerifyDeep]])                     | Die schnellen Prüfungen, und sie liest jede gespeicherte Datei und prüft ihren SHA-256                                     | Automatisch einmal alle 7 Tage für den neuesten Punkt. Auf Anforderung mit [[ui:backupVerifyDeepAction]], mit `arkvoryctl backup verify POINT_ID` oder mit `arkvory-backup verify --deep` |

Eine vollständige Prüfung liest den ganzen Punkt und braucht daher bei einem großen Backup-Speicher Zeit und Datenträgerdurchsatz. Wenn ein Punkt fehlschlägt, zeigt die Konsole [[ui:backupVerifyFailed]] mit einem Fehlercode, und die Warnung `verify_failed` wird aktiv. Ändern Sie den Backup-Speicher nicht, bis Sie die Ursache kennen.

Ein noch nicht geprüfter Punkt zeigt [[ui:backupVerifyNone]]. Eine vollständige Prüfung des neuesten Punkts ist zugleich die beste regelmäßige Prüfung, dass der Backup-Speicher lesbar ist.

## Jetzt ein Backup ausführen {#run-now}

Verwenden Sie eine dieser Möglichkeiten:

- Konsole: [[ui:backupRun]] in [[ui:backups]].
- Kommandozeile: `arkvoryctl backup run`.
- API: [requestBackupRun](../api/reference/backups#requestBackupRun) antwortet mit 202 und dem eingereihten Auftrag.

Der Agent prüft seine Warteschlange alle 15 Sekunden (`ARKVORY_BACKUP_POLL_SECONDS`), der Auftrag startet also kurz darauf. Aufträge laufen nacheinander, und das Schließen der Konsole stoppt sie nicht. Ein Auftrag, der wegen eines Neustarts oder eines Konflikts stoppt, wird wiederholt, bis zu 5 Versuche. Siehe [Umgebungsvariablen](../reference/environment#backups) für die Einstellungen des Agent, einschließlich der Kopierratenbegrenzung `ARKVORY_BACKUP_BYTES_PER_SECOND`.

Ein Backup durchläuft diese Phasen, die die Konsole in [[ui:backupJobPhase]] zeigt: [[ui:backupPhasePreparing]], [[ui:backupPhaseCatalog]], [[ui:backupPhaseTransfer]], [[ui:backupPhaseFinishing]] und [[ui:backupPhaseDone]]. Eine schnelle Prüfung zeigt [[ui:backupPhaseStructural]], eine vollständige [[ui:backupPhaseDeep]].

Führen Sie während eines Backups keine Datenbankmigrationen oder die Offline-Werkzeuge `gc` und `scrub` aus. Sie warten darauf oder lehnen mit `busy` ab.

## Den Status beobachten {#status}

### In der Konsole {#status-console}

[[ui:backups]] ist für Administratoren und den Wiederherstellungsschlüssel sichtbar. Dienstschlüssel und persönliche Zugriffstoken sehen sie nie. Die Seite zeigt:

- Den Zustand: [[ui:backupStateOk]], [[ui:backupStateWarning]] oder [[ui:backupStateCritical]].
- [[ui:backupNewest]] mit seinem Alter ab T, [[ui:backupNextRun]] mit [[ui:backupOverdue]], wenn ein Lauf überfällig ist, [[ui:backupAgent]] mit seinem letzten Signal und [[ui:backupVault]] mit dem freien Speicherplatz und der Angabe, ob es verschlüsselt ist ([[ui:backupVaultEncrypted]] oder [[ui:backupVaultPlain]]). Ein unverschlüsseltes Vault erhält einen Hinweis, keine Warnung.
- Den Auftrag, der gerade läuft, dann die Warnungen, jede mit einem Hinweis, was zu tun ist.
- [[ui:backupPoints]] mit [[ui:backupSnapshot]], [[ui:backupCompleted]], [[ui:backupSize]], [[ui:backupFiles]], [[ui:backupVerification]] und dem Anheften.
- [[ui:backupJobs]] mit der Art ([[ui:backupKindCapture]], [[ui:backupKindVerify]], [[ui:backupKindRetention]]), dem Zustand, der Phase, den Zeiten, dem Fehlercode und dem Fortschritt.

Ein Auftrag hat einen dieser Zustände: [[ui:backupJobQueued]], [[ui:backupJobRunning]], [[ui:backupJobCommitting]], [[ui:backupJobCompleted]], [[ui:backupJobFailed]] oder [[ui:backupJobInterrupted]]. Die Seite aktualisiert sich, während ein Auftrag läuft. Verwenden Sie jederzeit [[ui:backupRefresh]].

### Warnungen {#warnings}

| Code                   | Ebene    | Was zu tun ist                                                                                                                                                                                                            |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vault_not_configured` | Warnung  | Verbinden Sie einen Backup-Speicher. Siehe [Den Backup-Speicher verbinden](#connect-vault)                                                                                                                                |
| `agent_offline`        | Kritisch | Seit 2 Minuten kein Signal. Starten Sie den Agent-Dienst und lesen Sie sein Log                                                                                                                                           |
| `schedule_disabled`    | Warnung  | Schalten Sie den Plan ein, wenn Sie tägliche Backups brauchen                                                                                                                                                             |
| `no_backup_yet`        | Warnung  | Erstellen Sie das erste Backup                                                                                                                                                                                            |
| `backup_stale`         | Kritisch | Der neueste Punkt ist älter als 26 Stunden, während der Plan aktiv ist. Lesen Sie die Fehlercodes der Aufträge und das Agent-Log                                                                                          |
| `last_run_failed`      | Warnung  | Das letzte Backup ist fehlgeschlagen. Der Fehlercode steht in der Auftragsliste                                                                                                                                           |
| `vault_unavailable`    | Kritisch | Das Laufwerk ist nicht eingebunden, `vault.json` fehlt, das Vault ist nicht beschreibbar, oder ein verschlüsseltes Vault hat keinen gültigen Schlüssel (das Agent-Log nennt `vault_key_missing` oder `vault_key_invalid`) |
| `vault_low_space`      | Warnung  | Weniger als 10 % des Volumes sind frei oder weniger als das Doppelte der neuen Daten des letzten Backups. Geben Sie Speicherplatz frei oder behalten Sie weniger Punkte                                                   |
| `verify_failed`        | Kritisch | Ein Punkt hat die Prüfung nicht bestanden. Ändern Sie den Backup-Speicher nicht; untersuchen Sie die Ursache                                                                                                              |
| `never_deep_verified`  | Warnung  | Seit mehr als 8 Tagen keine vollständige Prüfung. Prüfen Sie, ob der Agent läuft, oder starten Sie eine vollständige Prüfung                                                                                              |

### Mit der Kommandozeile und der API {#status-cli}

```bash
arkvoryctl backup status
arkvoryctl backup jobs
arkvoryctl backup points
arkvoryctl backup status --json || echo "backup problem"
```

`backup status` endet mit Exit-Code 9, solange eine kritische Warnung aktiv ist, sodass Sie es in einem Monitor verwenden können. Diese Befehle brauchen den Dateischlüssel des Besitzers oder die Sitzung eines Konto-Administrators. Siehe [Kommandozeilen-Client](../protocols/cli#backups) und [TypeScript-SDK](../protocols/sdk#backups). Die HTTP-Vorgänge stehen in der [API-Referenz zu Backups](../api/reference/backups).

Für Prometheus stellt die API `arkvory_backup_last_success_timestamp_seconds` (das T des neuesten Punkts), `arkvory_backup_agent_last_seen_timestamp_seconds` und `arkvory_backup_warnings` mit einem `code`-Label bereit. Siehe [Monitoring](./monitoring).

## Wiederherstellen {#restore}

Eine Wiederherstellung schreibt in eine **leere** Datenbank und ein **leeres** Speicherverzeichnis. Sie überschreibt nie eine laufende Installation. Nach der Wiederherstellung starten Sie eine separate Instanz auf den wiederhergestellten Daten, prüfen sie und entscheiden erst dann, ob sie den alten Server ersetzt.

### Bevor Sie beginnen {#restore-prepare}

- **Das Programm.** Der Wiederherstellungsbefehl ist das Programm `arkvory-backup` des installierten Release. Starten Sie es mit dem Node.js der Installation:
  - Linux-Pakete: `/opt/proanima-arkvory/runtime/node /opt/proanima-arkvory/releases/VERSION/apps/backup/dist/main.js COMMAND`
  - Windows-Grafikinstaller: `& "$root\runtime\node.exe" "$root\releases\VERSION\apps\backup\dist\main.js" COMMAND`

  `VERSION` ist die installierte Version aus `installation.json`. Im Rest dieser Seite steht `arkvory-backup` für diese ganze Kommandozeile. Nutzer von Docker Compose führen dasselbe Programm aus einem Container des Release-Images aus. Verwenden Sie bei einer Skript-Installation den Node.js-Ordner unter `runtime/`.

- **Das Release.** Verwenden Sie das Release, das den Punkt erzeugt hat, oder ein neueres. Ein Punkt aus einem neueren Release wird mit `schema_mismatch` abgelehnt.
- **Das Konto.** Führen Sie den Befehl als ein Konto aus, das den Backup-Speicher lesen kann. Unter Linux gehört der Backup-Speicher `arkvory` und hat den Modus 0700, verwenden Sie also `sudo -u arkvory`. Unter Windows verwenden Sie eine erhöhte PowerShell. Das neue Speicherverzeichnis muss am Ende dem Konto gehören, das die API ausführen wird.
- **Der Schlüssel.** Ein verschlüsseltes Vault braucht seinen Schlüssel. Geben Sie das Recovery-Kit oder eine Schlüsseldatei als `--key-file FILE` an jeden folgenden Befehl, oder setzen Sie `ARKVORY_BACKUP_VAULT_KEY_FILE`. Der Schlüssel ist immer eine Datei, nie ein Argument.
- **Das Ziel.** Erstellen Sie eine leere Datenbank, zum Beispiel `CREATE DATABASE arkvory_restore OWNER arkvory;`. Wählen Sie ein Speicherverzeichnis, das nicht existiert oder leer ist, auf einem anderen Volume als der Backup-Speicher und nicht innerhalb des Quellspeichers.
- **Die Datenbank-URL.** Übergeben Sie sie in der Umgebung, nicht als Argument, weil Argumente in der Prozessliste sichtbar sind.

### Schritt für Schritt wiederherstellen {#restore-steps}

1. Listen Sie die Wiederherstellungspunkte auf und wählen Sie einen. Kopieren Sie die Punkt-ID.

   ```bash
   arkvoryctl backup points
   arkvory-backup list --vault /mnt/backup/arkvory
   ```

2. Prüfen Sie den Punkt vollständig.

   ```bash
   arkvory-backup verify --vault /mnt/backup/arkvory --point POINT_ID --deep
   ```

3. Legen Sie die Zieldatenbank in der Umgebung fest.

   ```bash
   export ARKVORY_RESTORE_DATABASE_URL='postgresql://arkvory@db.example/arkvory_restore'
   ```

4. Führen Sie die Wiederherstellung **ohne** `--yes` aus. Das ist ein Probelauf. Er prüft den Punkt, die Datei-Hashes, die Schema-Version und ob das Ziel leer ist, und schreibt nichts.

   ```bash
   arkvory-backup restore --vault /mnt/backup/arkvory --point POINT_ID --storage /srv/arkvory-restore
   ```

   Eine bestandene Prüfung endet mit Exit-Code 0 und der Log-Zeile `backup.restore.planned`.

5. Führen Sie denselben Befehl mit `--yes` aus. Fügen Sie `--report` hinzu, um eine Berichtsdatei zu behalten. Die Datei darf noch nicht existieren.

   ```bash
   arkvory-backup restore --vault /mnt/backup/arkvory --point POINT_ID --storage /srv/arkvory-restore --yes --report /root/restore-report.json
   ```

   Die Wiederherstellung durchläuft die Phasen `verify`, `content`, `schema`, `tables`, `migrate` und `done`. Sie kopiert jede Datei und prüft ihren SHA-256, erstellt das Schema, lädt alle Tabellen in einer Transaktion, wendet die Normalisierung an und führt dann die verbleibenden Migrationen aus. Der Bericht enthält nur Bezeichner und Zählwerte, niemals Pfade oder Anmeldedaten.

6. Starten Sie eine separate API-Instanz auf den wiederhergestellten Daten: `ARKVORY_DATABASE_URL` der neuen Datenbank, `ARKVORY_DATA_DIR` des neuen Verzeichnisses, eine eigene `ARKVORY_KEYS_FILE` und einen anderen Port. Prüfen Sie, ob `/health/ready` antwortet, ob Sie sich anmelden können, ob der Katalog vollständig ist und ob eine Kontrolldatei mit demselben SHA-256 heruntergeladen wird.

Wenn eine Wiederherstellung fehlschlägt, löschen Sie die Zieldatenbank und das Verzeichnis und erstellen Sie sie neu. Ein nicht leeres Ziel wird mit `target_not_empty` abgelehnt, was vorhandene Daten schützt.

### Was eine Wiederherstellung ändert {#after-restore}

Die Wiederherstellung wendet eine feste Menge von Änderungen an, damit die neue Instanz nichts fortsetzt, was im Gange war, und keine alten Anmeldedaten aktiviert:

- Unfertige Uploads werden abgebrochen und geben ihr Kontingent frei. Eingereihte und laufende Abschlussaufträge enden als fehlgeschlagen mit dem Code `conflict`. Unfertige Hochstufungen werden verworfen.
- Keine Sitzung wird wiederhergestellt. Alle melden sich erneut an.
- Alle persönlichen Zugriffstoken werden widerrufen, und alle Dienstschlüssel werden `revoked`. Stellen Sie neue Schlüssel aus.
- Speicher-Aufbewahrung und physische Bereinigung werden in jedem Repository ausgeschaltet. Schalten Sie sie bewusst wieder ein.
- Backups sind aus, und kein Backup-Speicher ist konfiguriert. Download-Links und Lese-Gateway-Einstellungen werden nicht übernommen.
- Konten, Gruppen und Berechtigungen bleiben, mit den Passwort-Hashes zum Zeitpunkt T. Ein Passwort, das Sie nach T geändert haben, funktioniert wieder in seiner alten Form; setzen Sie Passwörter nach Ihrer eigenen Richtlinie zurück.
- Der Wiederherstellungsschlüssel und die Dateischlüssel stammen aus der Schlüsseldatei der Installation, die die wiederhergestellten Daten ausführt.
- Spiegel behalten ihre Position, aber die Spiegeleinstellungen liegen in `config/`. Verbinden Sie sie erneut. Siehe [Spiegel](./mirrors).
- Ein Sicherheits-Audit-Eintrag `backup.restored` zeichnet den Punkt und die Zählwerte auf.

### Auf einen anderen Server umziehen {#move-server}

Sie können ein Backup verwenden, um eine Installation auf einen anderen Server umzuziehen:

1. Installieren Sie Arkvory auf dem neuen Server mit demselben oder einem neueren Release. Siehe [Eine Installation wählen](../install/index).
2. Verbinden Sie denselben Backup-Speicher oder eine Kopie davon mit dem neuen Server. Verwenden Sie `--init-vault` nicht für einen vorhandenen Backup-Speicher.
3. Stellen Sie den neuesten Punkt in eine neue leere Datenbank und ein leeres Verzeichnis wieder her, wie oben beschrieben, und testen Sie das Ergebnis.
4. Richten Sie die Installation auf die wiederhergestellten Daten aus: Setzen Sie `ARKVORY_DATABASE_URL` und `ARKVORY_DATA_DIR` in `config/runtime.json` und starten Sie die Dienste neu. Siehe [Konfiguration](../install/configuration).
5. Stellen Sie neue Schlüssel aus, legen Sie die Aufbewahrungs- und Bereinigungsrichtlinien erneut fest, verbinden Sie die Spiegel und den Backup-Plan und nennen Sie den Clients die neue Adresse.

Die letzten beiden Schritte sind manuell und nicht Teil einer geführten Umschaltung. Üben Sie die ganze Abfolge zuerst auf einem Ersatzserver. Änderungen, die nach T auf dem alten Server vorgenommen wurden, gehen verloren; stoppen Sie den alten Server daher, bevor die Clients umziehen.

## Testen Sie eine Wiederherstellung regelmäßig {#test-restore}

Ein Backup, das Sie nie wiederhergestellt haben, ist nur eine Hoffnung. Das Produkt prüft die Bytes eines Punkts, zeichnet aber keine Test-Wiederherstellung auf. Notieren Sie Datum und Ergebnis selbst.

Testen Sie mindestens:

- Nach dem ersten Backup.
- Nach jedem Update, das das Datenbankschema ändert.
- Nach Ihrem eigenen Zeitplan, zum Beispiel jedes Quartal.

Jeder Test folgt [Schritt für Schritt wiederherstellen](#restore-steps) auf einem Ersatzserver oder einer Testdatenbank und endet mit einer Anmeldung, einem Blick in den Katalog und einem Download einer Kontrolldatei. Löschen Sie danach die Testdatenbank und das Verzeichnis.

## Exit-Codes und Log-Zeilen {#exit-codes}

### Exit-Codes {#exit-codes-table}

Das Programm `arkvory-backup` schreibt ein JSON-Objekt pro Zeile auf seine Standardausgabe und bei einem Fehler eine Hinweiszeile auf die Standardfehlerausgabe.

| Code | Bedeutung                                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Erfolg. Bei `restore` ohne `--yes` hat die Prüfung bestanden                                                                                                                          |
| 1    | Der Lauf ist fehlgeschlagen: Datenbank oder Datenträger nicht verfügbar, Lease oder Snapshot verloren, Backup-Speicher oder Ziel voll. Wiederherstellungspunkte sind nicht beschädigt |
| 2    | Falsche Argumente oder Umgebungsvariablen                                                                                                                                             |
| 3    | Eine Sicherheitsprüfung hat abgelehnt: kein `vault.json`, überlappende Verzeichnisse, ein nicht leeres Ziel, ein nicht unterstütztes Schema, kein solcher Punkt                       |
| 4    | Integritätsfehler: ein Hash, eine fehlende Datei oder ein geändertes Manifest. Lassen Sie den Backup-Speicher unverändert, bis Sie ihn verstehen                                      |
| 5    | Ausgelastet: ein anderes Backup oder eine Wartung läuft, oder eine Löschung wurde nicht rechtzeitig abgeschlossen. Versuchen Sie es später erneut                                     |

### Log-Zeilen {#log-lines}

Jede Zeile hat `component` auf `backup` gesetzt. Pfade, URLs und Geheimnisse werden nie geschrieben. Die nützlichsten Zeilen:

| Code                                                                                        | Bedeutung                                                                                                                     |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `backup.phase`                                                                              | Ein Backup wechselt in eine Phase: `barrier`, `pins`, `tables`, `blobs`, `manifest`, `commit`, `done`                         |
| `backup.capture.completed`                                                                  | Ein Backup ist fertig. Felder: `pointId`, `outcome`, `blobs`, `copied`, `reused`, `copiedBytes`, `contentBytes`, `durationMs` |
| `backup.point`                                                                              | Ein Wiederherstellungspunkt in der Ausgabe von `list`                                                                         |
| `backup.verify.point`, `backup.verify.problem`                                              | Das Ergebnis einer Prüfung und jedes Problem mit seinem `errorCode`                                                           |
| `backup.restore.phase`, `backup.restore.planned`, `backup.restore.completed`                | Fortschritt und Ergebnis der Wiederherstellung, mit Zählwerten der Zeilen und der oben aufgeführten Änderungen                |
| `backup.failed`                                                                             | Ein Befehl ist fehlgeschlagen. Lesen Sie `errorCode`                                                                          |
| `backup.agent.started`, `.standby`, `.lease_acquired`, `.lease_lost`, `.stopped`, `.failed` | Der Lebenszyklus des Agent                                                                                                    |
| `backup.request.started`, `.done`, `.failed`, `.requeued`                                   | Ein Auftrag des Agent, mit `kind` und `errorCode`                                                                             |
| `backup.schedule.due`                                                                       | Der Plan hat ein Backup gestartet                                                                                             |
| `backup.retention.applied`                                                                  | Die Aufbewahrung ist abgeschlossen. Felder: `forgotten`, `blobs`, `freedBytes`                                                |

Lesen Sie das Agent-Log unter Linux mit `journalctl -u arkvory-backup`, unter Windows in `logs\` des Installationsverzeichnisses und in Compose mit `docker compose logs backup`.

### Fehlercodes {#error-codes}

| `errorCode`                                              | Exit | Was zu tun ist                                                                                                                                                        |
| -------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vault_missing`                                          | 3    | Das Verzeichnis hat kein `vault.json`. Binden Sie das Volume ein, oder führen Sie einmal `vault init` aus                                                             |
| `vault_key_missing`                                      | 3    | Das Vault ist verschlüsselt, und es wurde kein Schlüssel angegeben. Verwenden Sie `--key-file FILE` oder `ARKVORY_BACKUP_VAULT_KEY_FILE`                              |
| `vault_key_invalid`                                      | 3    | Der Schlüssel öffnet dieses Vault nicht: Prüfen Sie die Datei, das Vault oder ob der Slot entfernt wurde. Ein Tippfehler wird an der Prüfsumme des Schlüssels erkannt |
| `unsafe_path`                                            | 3    | Halten Sie den Backup-Speicher, den Speicher und das Wiederherstellungsziel in getrennten Verzeichnisbäumen                                                           |
| `target_not_empty`                                       | 3    | Eine Wiederherstellung schreibt nur in eine leere Datenbank und ein leeres Verzeichnis                                                                                |
| `schema_mismatch`                                        | 3    | Der Punkt ist neuer als das Release oder älter als die unterstützte Wiederherstellung. Verwenden Sie ein anderes Release                                              |
| `upgrade_required`                                       | 3    | Aktualisieren Sie jeden API- und Wartungsprozess der Installation                                                                                                     |
| `point_not_found`, `storage_mismatch`                    | 3    | Falsche Punkt-ID, oder `ARKVORY_DATA_DIR` ist kein initialisiertes Speicherverzeichnis dieser Installation                                                            |
| `integrity_mismatch`, `invalid_manifest`, `blob_missing` | 4    | Lassen Sie den Backup-Speicher unverändert. Führen Sie `verify --deep` aus und untersuchen Sie die Ursache                                                            |
| `busy`, `barrier_timeout`                                | 5    | Eine andere Operation läuft. Versuchen Sie es später erneut                                                                                                           |
| `vault_full`, `storage_full`                             | 1    | Geben Sie Speicherplatz frei. Frühere Punkte sind unversehrt                                                                                                          |
| `attempts_exhausted`                                     | 3    | Diese Anfrage hat ihre 5 Versuche verbraucht. Starten Sie ein neues Backup                                                                                            |

## Grenzen {#limits}

- Ein Plan und ein Backup-Speicher pro Installation. Der Backup-Speicher ist ein Verzeichnis auf einem Datenträger oder auf einer eingebundenen Freigabe, ohne S3 und ohne Offsite- oder Immutable-Profil.
- Die Verschlüsselung verbirgt Inhalt und Katalog, nicht die Dateinamen, ihre Größen oder die Anzahl der Punkte. Verlorene Schlüssel bedeuten verlorene Backups. Das Entfernen eines Schlüssel-Slots verschlüsselt frühere Punkte nicht neu.
- Sie können einen Backup-Auftrag weder pausieren noch abbrechen, und die Konsole hat keinen Assistenten für die Wiederherstellung und keinen Status für Wiederherstellungstests.
- Eine Wiederherstellung braucht ein leeres Ziel, und die Umschaltung auf wiederhergestellte Daten ist ein manueller Schritt.
- Der Backup-Agent ist kein Hochverfügbarkeitssystem. Ein zweiter Agent wartet nur als Ersatz.

## Verwandte Seiten {#related-pages}

- [Eine Installation wählen](../install/index)
- [Updates](../install/updates)
- [Speicher](./storage)
- [Spiegel](./mirrors) für einen zweiten Standort
- [Monitoring](./monitoring)
- [Selbstheilung](./self-healing)
- [Fehlerbehebung](./troubleshooting)
- [Umgebungsvariablen](../reference/environment#backups)
