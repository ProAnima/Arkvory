---
title: Backups
description: Connect a backup vault, schedule and verify backups, restore a restore point into an empty server and test the restore regularly.
---

# Backups

The backup agent copies the database and the stored files of your installation into a **vault**: a directory on another disk or on a network share. It works while people keep uploading and downloading. Each finished backup is a **restore point** that you can verify and restore.

This page covers the vault, the schedule, retention, verification, the status screens and the restore procedure. Restoring is a command that you run on the server. The console has no restore button.

## How backups work {#how-backups-work}

The agent is the third service of an installation, next to the API and the worker. It is named `arkvory-backup` on Linux, `Arkvorybackup` on Windows and `backup` in Docker Compose. Only one agent works at a time. A second agent waits and takes over when the first one stops.

The agent does three things:

- It runs the daily plan when the plan is on.
- It runs jobs that you request in the console, with `arkvoryctl` or through the API.
- It checks each new restore point, and it applies retention.

A restore point holds the published state of the installation at a moment **T**, the snapshot time. Files that people publish after T go into the next backup. The console counts the age of a backup from T, not from the time the copy finished.

Keep these facts in mind:

- A backup does not stop uploads or downloads. While it runs, physical cleanup leaves the files that the backup needs and removes them in a later pass.
- A file is stored once in the vault, however many restore points contain it. The first backup copies everything, so with terabytes of content it takes a long time. Later backups copy only new files.
- A restore point appears only when its copy is complete. A failed or interrupted backup never damages the earlier restore points.
- A backup is not a point-in-time recovery system and not high availability. You restore the state as of one restore point, and you lose the changes after its T.

## What a backup contains {#contents}

A restore point contains:

- The catalog tables of the database: artifacts, packages, file paths and their history, labels and metadata, stages, attachments, accounts, groups and grants, service accounts and keys, the audit trails, storage and cleanup policies, container image, Git LFS and npm registry data, and the state of mirrors.
- The content of every published file.

A restore point does not contain:

- Sign-in sessions, download links and the runtime state of read gateways.
- Uploads that are not finished. A restore cancels them, and the clients start them again.
- The backup plan and the agent state. A restored installation starts with backups switched off.
- The `config/` directory of the installation: settings, TLS files, mirror keys, the recovery key. Keep copies of these files yourself.
- The Arkvory programs. Install a release first, then restore.

## Prepare the vault {#vault}

### Requirements {#vault-requirements}

| Requirement                                                                                                         | Why                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| A new or empty directory, mounted before the services start                                                         | The agent writes `vault.json` and the restore points there                                                        |
| Outside the installation directory and outside the storage directory, also through links, junctions and short names | A vault inside the storage is lost with it. The check refuses a path that contains or is inside them              |
| Writable by the service account                                                                                     | On Linux, `arkvory`. On Windows, `NT AUTHORITY\LocalService`. `arkvory configure` sets the rights for you         |
| At least 1 GiB of free space beyond the data being copied                                                           | The vault keeps this reserve. A full volume ends the backup with `vault_full`, and the earlier points stay intact |
| On Linux, not under `/home`, `/root`, `/run/user`, `/tmp` or `/var/tmp`                                             | The service sandbox hides these trees                                                                             |
| On Windows, a local or iSCSI volume with a drive letter                                                             | `LocalService` cannot sign in to SMB shares, so paths like `\\nas\share` are refused                              |

Use a volume on another disk, or on a NAS, so that a failed storage disk does not take the backups with it. A vault on the same physical disk as the storage protects against mistakes, not against a disk failure.

**The vault is not encrypted.** It holds the catalog, the password hashes and every published file. Put it on an encrypted volume (LUKS, BitLocker, NAS encryption) and allow access only to the service account and to the backup administrator.

### Connect the vault {#connect-vault}

Run the command as root or as an administrator, on the server. It checks the directory before it changes anything.

```bash
sudo arkvory configure --root /opt/proanima-arkvory --backup-vault /mnt/backup/arkvory --init-vault
```

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' configure --root $root --backup-vault D:\Backup\Arkvory --init-vault
```

For a script installation on Windows, start `manage.mjs` as described in [Windows](../install/windows#manage-the-services).

1. The command checks the path: absolute, an existing writable directory, outside the installation and the storage, and visible to the service.
2. With `--init-vault`, it creates `vault.json` in an **empty** directory. It never initializes a directory twice. Without `vault.json` and without the option, it refuses, so that a NAS that is not mounted is not taken for an empty vault.
3. It gives the service account access, writes `ARKVORY_BACKUP_VAULT` into `config/runtime.json` and restarts only the agent.
4. It waits up to 150 seconds until the agent reports this vault as available. This check reads `config/bootstrap-token.txt`, so do not delete that file.
5. If anything fails, it restores the previous settings and the previous access, and it restarts the agent.

To use a vault that already exists, for example on a new server, leave out `--init-vault`. To disconnect the vault, use `--backup-vault-off`. This leaves the directory and its files unchanged. A restart interrupts a backup that is running, and the agent repeats it.

In Docker Compose, the vault is a bind mount from `config/compose.vault.yml`. When you run Compose commands yourself, add `-f config/compose.vault.yml`. Without it, `up` creates the agent container without the vault.

### Vault on a network share {#network-share}

On Linux, a NAS works over SMB 3 and NFS 4. Mount the share so that the files belong to the service account, otherwise the agent cannot write, and `configure` refuses and restores the old settings.

```bash
sudo mount -t cifs //nas/arkvory /mnt/backup/arkvory \
  -o credentials=/etc/arkvory/smb.credentials,uid=$(id -u arkvory),gid=$(id -g arkvory),file_mode=0600,dir_mode=0700,vers=3.1.1
```

- Give the credentials file the mode `0600`.
- For NFS, map the owners so that the files belong to `arkvory`. Use `no_root_squash` on the export, or the same user ID on both sides.
- Add the mount to `/etc/fstab` with `_netdev`. For SMB add `nofail` when the NAS may be unavailable at boot.
- If the NAS drops out, the agent reports `vault_unavailable`. It does not write into the empty mount point, because the vault identity is stored in `vault.json`.

## Schedule and retention {#schedule}

### Set the schedule {#set-schedule}

Open [[ui:backups]] and use [[ui:backupPlan]]. You need the right to manage backups. Without it, the form shows [[ui:backupReadOnly]].

| Setting                                                       | Meaning                                                                                                                | Default |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------- |
| [[ui:backupEnabled]]                                          | Turns the daily plan on. Turning it on does not start a backup at once                                                 | Off     |
| [[ui:backupTime]]                                             | Local time of the daily backup, to the minute                                                                          | 02:00   |
| [[ui:backupTimezone]]                                         | The IANA time zone of that local time, for example `Europe/Moscow` or `UTC`. Offsets such as `+03:00` are not accepted | `UTC`   |
| [[ui:backupDaily]], [[ui:backupWeekly]], [[ui:backupMonthly]] | How many days, weeks and months of restore points to keep. See [Retention](#retention). Limits: 0–366, 0–260, 0–120    | 7, 4, 6 |

Select [[ui:backupPlanSave]]. If someone else changed the plan in the meantime, the console loads the current plan, and you review it and save again.

The schedule follows these rules:

- A local time that does not exist on the day of a clock change runs at the moment of the change. A local time that occurs twice runs once, the first time.
- After a downtime, the agent makes one catch-up backup, not one for every missed day. Changing the schedule does not trigger a catch-up for earlier times.
- The default update window of an installation is 03:00 UTC. An update stops the agent, and a running backup is interrupted and repeated later. Pick a backup time that does not fall into the update window. See [Updates](../install/updates).

### Retention {#retention}

Retention keeps the newest restore point of each of the last N local days, of each of the last N ISO weeks and of each of the last N months, counted in the time zone of the plan. The three groups are united, so 7, 4 and 6 keep at most 17 points, and usually fewer.

Retention always keeps:

- Pinned points.
- The newest point, so at least one point always remains.

Retention never deletes a point that failed verification, and never touches points of another installation in the same vault.

After each backup, the agent queues retention as a separate job. You can also select [[ui:backupRetentionApply]]. The console first shows which points stay and which are removed. A removal cannot be undone. The agent then deletes the point and, afterwards, the files that no remaining point needs. If the vault contains a damaged point (a point directory without `COMMITTED` or with an invalid manifest), removal stops with `invalid_manifest`. Leave the vault as it is, find the cause, then remove the damaged directory by hand.

Backup retention does not change the retention of builds in your repositories. See [Storage](./storage).

### Pin a restore point {#pin}

A pinned point is kept beyond the retention rules. For example, pin the point from before a big migration.

- Console: select [[ui:backupPin]] in the row of the point in [[ui:backupPoints]]. [[ui:backupUnpin]] releases it.
- CLI: `arkvoryctl backup pin POINT_ID`, and `arkvoryctl backup pin POINT_ID --off`.
- API: [setBackupPointPin](../api/reference/backups#setBackupPointPin).

## Verification {#verification}

There are two kinds of verification:

| Kind                                                   | What it checks                                                                                                   | When it runs                                                                                                                                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Quick (the console says [[ui:backupVerifyStructural]]) | Every file of the point against the digest in its manifest, and that each stored file exists with the right size | Automatically after every backup                                                                                                                                                     |
| Full ([[ui:backupVerifyDeep]])                         | The quick checks, and it reads every stored file and checks its SHA-256                                          | Automatically once every 7 days for the newest point. On request with [[ui:backupVerifyDeepAction]], with `arkvoryctl backup verify POINT_ID` or with `arkvory-backup verify --deep` |

A full verification reads the whole point, so with a large vault it needs time and disk throughput. If a point fails, the console shows [[ui:backupVerifyFailed]] with an error code, and the warning `verify_failed` becomes active. Do not change the vault until you know the cause.

A point that was not checked yet shows [[ui:backupVerifyNone]]. A full verification of the newest point is also the best regular check that the vault is readable.

## Run a backup now {#run-now}

Use any of these:

- Console: [[ui:backupRun]] in [[ui:backups]].
- CLI: `arkvoryctl backup run`.
- API: [requestBackupRun](../api/reference/backups#requestBackupRun) answers 202 with the queued job.

The agent checks its queue every 15 seconds (`ARKVORY_BACKUP_POLL_SECONDS`), so the job starts shortly after. Jobs run one at a time, and closing the console does not stop them. A job that stops because of a restart or a conflict is repeated, up to 5 attempts. See [Environment variables](../reference/environment#backups) for the agent settings, including the copy rate limit `ARKVORY_BACKUP_BYTES_PER_SECOND`.

A backup goes through these phases, which the console shows in [[ui:backupJobPhase]]: [[ui:backupPhasePreparing]], [[ui:backupPhaseCatalog]], [[ui:backupPhaseTransfer]], [[ui:backupPhaseFinishing]] and [[ui:backupPhaseDone]]. A quick check shows [[ui:backupPhaseStructural]], and a full one [[ui:backupPhaseDeep]].

Do not run database migrations or the offline tools `gc` and `scrub` during a backup. They wait for it or refuse with `busy`.

## Watch the status {#status}

### In the console {#status-console}

[[ui:backups]] is visible to administrators and to the recovery key. Service keys and personal access tokens never see it. The page shows:

- The state: [[ui:backupStateOk]], [[ui:backupStateWarning]] or [[ui:backupStateCritical]].
- [[ui:backupNewest]] with its age from T, [[ui:backupNextRun]] with [[ui:backupOverdue]] when a run is late, [[ui:backupAgent]] with its last signal and [[ui:backupVault]] with the free space.
- The job that runs now, then the warnings, each with a hint about what to do.
- [[ui:backupPoints]], with [[ui:backupSnapshot]], [[ui:backupCompleted]], [[ui:backupSize]], [[ui:backupFiles]], [[ui:backupVerification]] and pinning.
- [[ui:backupJobs]], with the kind ([[ui:backupKindCapture]], [[ui:backupKindVerify]], [[ui:backupKindRetention]]), the state, the phase, the times, the error code and the progress.

A job has one of these states: [[ui:backupJobQueued]], [[ui:backupJobRunning]], [[ui:backupJobCommitting]], [[ui:backupJobCompleted]], [[ui:backupJobFailed]] or [[ui:backupJobInterrupted]]. The page refreshes while a job runs. Use [[ui:backupRefresh]] at any time.

### Warnings {#warnings}

| Code                   | Level    | What to do                                                                                                               |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `vault_not_configured` | Warning  | Connect a vault. See [Connect the vault](#connect-vault)                                                                 |
| `agent_offline`        | Critical | No signal for 2 minutes. Start the agent service and read its log                                                        |
| `schedule_disabled`    | Warning  | Turn the plan on if you need daily backups                                                                               |
| `no_backup_yet`        | Warning  | Create the first backup                                                                                                  |
| `backup_stale`         | Critical | The newest point is older than 26 hours while the plan is on. Read the error codes of the jobs and the agent log         |
| `last_run_failed`      | Warning  | The last backup failed. The error code is in the job list                                                                |
| `vault_unavailable`    | Critical | The volume is not mounted, `vault.json` is missing or the vault is not writable                                          |
| `vault_low_space`      | Warning  | Less than 10% of the volume is free, or less than twice the new data of the last backup. Free space or keep fewer points |
| `verify_failed`        | Critical | A point failed verification. Do not change the vault; investigate                                                        |
| `never_deep_verified`  | Warning  | No full verification for more than 8 days. Check that the agent runs, or start a full verification                       |

### With the CLI and the API {#status-cli}

```bash
arkvoryctl backup status
arkvoryctl backup jobs
arkvoryctl backup points
arkvoryctl backup status --json || echo "backup problem"
```

`backup status` ends with exit code 9 while a critical warning is active, so you can use it in a monitor. These commands need the owner file key or an account administrator session. See [Command-line client](../protocols/cli#backups) and [TypeScript SDK](../protocols/sdk#backups). The HTTP operations are in the [Backups API reference](../api/reference/backups).

For Prometheus, the API exposes `arkvory_backup_last_success_timestamp_seconds` (the T of the newest point), `arkvory_backup_agent_last_seen_timestamp_seconds` and `arkvory_backup_warnings` with a `code` label. See [Monitoring](./monitoring).

## Restore {#restore}

A restore writes into an **empty** database and an **empty** storage directory. It never overwrites a running installation. After the restore, you start a separate instance on the restored data, check it, and only then decide whether it replaces the old server.

### Before you start {#restore-prepare}

- **The program.** The restore command is the program `arkvory-backup` of the installed release. Start it with the Node.js of the installation:
  - Linux packages: `/opt/proanima-arkvory/runtime/node /opt/proanima-arkvory/releases/VERSION/apps/backup/dist/main.js COMMAND`
  - Windows graphical installer: `& "$root\runtime\node.exe" "$root\releases\VERSION\apps\backup\dist\main.js" COMMAND`

  `VERSION` is the installed version from `installation.json`. In the rest of this page, `arkvory-backup` stands for this whole command line. Docker Compose users run the same program from a container of the release image. For a script installation, use the Node.js folder under `runtime/`.

- **The release.** Use the release that made the point or a newer one. A point from a newer release is refused with `schema_mismatch`.
- **The account.** Run the command as an account that can read the vault. On Linux, the vault belongs to `arkvory` and has mode 0700, so use `sudo -u arkvory`. On Windows, use an elevated PowerShell. The new storage directory must end up owned by the account that will run the API.
- **The target.** Create an empty database, for example `CREATE DATABASE arkvory_restore OWNER arkvory;`. Choose a storage directory that does not exist or is empty, on a different volume from the vault and not inside the source storage.
- **The database URL.** Pass it in the environment, not as an argument, because arguments are visible in the process list.

### Restore step by step {#restore-steps}

1. List the restore points and choose one. Copy the point ID.

   ```bash
   arkvoryctl backup points
   arkvory-backup list --vault /mnt/backup/arkvory
   ```

2. Verify the point fully.

   ```bash
   arkvory-backup verify --vault /mnt/backup/arkvory --point POINT_ID --deep
   ```

3. Set the target database in the environment.

   ```bash
   export ARKVORY_RESTORE_DATABASE_URL='postgresql://arkvory@db.example/arkvory_restore'
   ```

4. Run the restore **without** `--yes`. This is a dry run. It checks the point, the file hashes, the schema version and that the target is empty, and it writes nothing.

   ```bash
   arkvory-backup restore --vault /mnt/backup/arkvory --point POINT_ID --storage /srv/arkvory-restore
   ```

   A passed check ends with exit code 0 and the log line `backup.restore.planned`.

5. Run the same command with `--yes`. Add `--report` to keep a report file. The file must not exist yet.

   ```bash
   arkvory-backup restore --vault /mnt/backup/arkvory --point POINT_ID --storage /srv/arkvory-restore --yes --report /root/restore-report.json
   ```

   The restore goes through the phases `verify`, `content`, `schema`, `tables`, `migrate` and `done`. It copies every file and checks its SHA-256, creates the schema, loads all tables in one transaction, applies the normalization and then runs the remaining migrations. The report holds identifiers and counts only, never paths or credentials.

6. Start a separate API instance on the restored data: `ARKVORY_DATABASE_URL` of the new database, `ARKVORY_DATA_DIR` of the new directory, its own `ARKVORY_KEYS_FILE` and another port. Check that `/health/ready` answers, that you can sign in, that the catalog is complete and that a control file downloads with the same SHA-256.

If a restore fails, delete the target database and directory and create them again. A non-empty target is refused with `target_not_empty`, which protects existing data.

### What a restore changes {#after-restore}

The restore applies a fixed set of changes, so that the new instance continues nothing that was in flight and activates no old credential:

- Unfinished uploads are cancelled and release their quota. Queued and running completion jobs end as failed with the code `conflict`. Unfinished promotions are dropped.
- No session is restored. Everyone signs in again.
- All personal access tokens are revoked, and all service keys become `revoked`. Issue new keys.
- Storage retention and physical cleanup are switched off in every repository. Switch them on again on purpose.
- Backups are off, and no vault is configured. Download links and read gateway settings are not carried over.
- Accounts, groups and grants stay, with the password hashes as of T. A password that you changed after T works again in its old form, so reset passwords by your own policy.
- The recovery key and file keys come from the key file of the installation that runs the restored data.
- Mirrors keep their position, but the mirror settings are in `config/`. Connect them again. See [Mirrors](./mirrors).
- A security audit entry `backup.restored` records the point and the counts.

### Move to another server {#move-server}

You can use a backup to move an installation to another server:

1. Install Arkvory on the new server with the same release or a newer one. See [Choose an installation](../install/index).
2. Connect the same vault, or a copy of it, to the new server. Do not use `--init-vault` for an existing vault.
3. Restore the newest point into a new empty database and an empty directory, as described above, and test the result.
4. Point the installation to the restored data: set `ARKVORY_DATABASE_URL` and `ARKVORY_DATA_DIR` in `config/runtime.json` and restart the services. See [Configuration](../install/configuration).
5. Issue new keys, set the retention and cleanup policies again, connect the mirrors and the backup plan, and tell the clients the new address.

The last two steps are manual and are not part of a guided switch-over. Rehearse the whole sequence on a spare server first. Changes made on the old server after T are lost, so stop the old server before clients move.

## Test a restore regularly {#test-restore}

A backup that you never restored is only a hope. The product verifies the bytes of a point, but it does not record a test restore. Keep the date and the result yourself.

Test at least:

- After the first backup.
- After every update that changes the database schema.
- On a schedule of your own, for example every quarter.

Each test follows [Restore step by step](#restore-steps) on a spare server or a scratch database, and it ends with a sign-in, a look at the catalog and a download of a control file. Delete the scratch database and the directory afterwards.

## Exit codes and log lines {#exit-codes}

### Exit codes {#exit-codes-table}

The program `arkvory-backup` writes one JSON object per line to its standard output, and on a failure one hint line to the standard error.

| Code | Meaning                                                                                                                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Success. For `restore` without `--yes`, the check passed                                                                           |
| 1    | The run failed: database or disk unavailable, lease or snapshot lost, vault or target full. Restore points are not damaged         |
| 2    | Wrong arguments or environment variables                                                                                           |
| 3    | A safety check refused: no `vault.json`, overlapping directories, a target that is not empty, an unsupported schema, no such point |
| 4    | Integrity failure: a hash, a missing file or a changed manifest. Leave the vault unchanged until you understand it                 |
| 5    | Busy: another backup or maintenance runs, or a deletion did not finish in time. Try again later                                    |

### Log lines {#log-lines}

Every line has `component` set to `backup`. Paths, URLs and secrets are never written. The most useful lines:

| Code                                                                                        | Meaning                                                                                                                  |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `backup.phase`                                                                              | A backup moves to a phase: `barrier`, `pins`, `tables`, `blobs`, `manifest`, `commit`, `done`                            |
| `backup.capture.completed`                                                                  | A backup is done. Fields: `pointId`, `outcome`, `blobs`, `copied`, `reused`, `copiedBytes`, `contentBytes`, `durationMs` |
| `backup.point`                                                                              | One restore point in the output of `list`                                                                                |
| `backup.verify.point`, `backup.verify.problem`                                              | The result of a verification, and each problem with its `errorCode`                                                      |
| `backup.restore.phase`, `backup.restore.planned`, `backup.restore.completed`                | Restore progress and result, with counts of rows and of the changes listed above                                         |
| `backup.failed`                                                                             | A command failed. Read `errorCode`                                                                                       |
| `backup.agent.started`, `.standby`, `.lease_acquired`, `.lease_lost`, `.stopped`, `.failed` | The life of the agent                                                                                                    |
| `backup.request.started`, `.done`, `.failed`, `.requeued`                                   | A job of the agent, with `kind` and `errorCode`                                                                          |
| `backup.schedule.due`                                                                       | The plan started a backup                                                                                                |
| `backup.retention.applied`                                                                  | Retention finished. Fields: `forgotten`, `blobs`, `freedBytes`                                                           |

Read the agent log with `journalctl -u arkvory-backup` on Linux, in `logs\` of the installation root on Windows, and with `docker compose logs backup` in Compose.

### Error codes {#error-codes}

| `errorCode`                                              | Exit | What to do                                                                                         |
| -------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------- |
| `vault_missing`                                          | 3    | The directory has no `vault.json`. Mount the volume, or run `vault init` once                      |
| `unsafe_path`                                            | 3    | Keep the vault, the storage and the restore target in separate directory trees                     |
| `target_not_empty`                                       | 3    | Restore writes only into an empty database and an empty directory                                  |
| `schema_mismatch`                                        | 3    | The point is newer than the release, or older than the supported restore. Use another release      |
| `upgrade_required`                                       | 3    | Update every API and maintenance process of the installation                                       |
| `point_not_found`, `storage_mismatch`                    | 3    | Wrong point ID, or `ARKVORY_DATA_DIR` is not an initialized storage directory of this installation |
| `integrity_mismatch`, `invalid_manifest`, `blob_missing` | 4    | Keep the vault unchanged. Run `verify --deep` and investigate                                      |
| `busy`, `barrier_timeout`                                | 5    | Another operation runs. Try again later                                                            |
| `vault_full`, `storage_full`                             | 1    | Free space. Earlier points are intact                                                              |
| `attempts_exhausted`                                     | 3    | This request used its 5 attempts. Start a new backup                                               |

## Limits {#limits}

- One plan and one vault per installation. The vault is a directory on a disk or on a mounted share, with no S3 and no offsite or immutable profile.
- The vault is not encrypted by Arkvory.
- You cannot pause or cancel a backup job, and the console has no restore wizard or restore test status.
- Restore needs an empty target, and the switch-over to restored data is a manual step.
- The backup agent is not a high availability system. A second agent only waits as a spare.

## Related pages {#related-pages}

- [Choose an installation](../install/index)
- [Updates](../install/updates)
- [Storage](./storage)
- [Mirrors](./mirrors) for a second site
- [Monitoring](./monitoring)
- [Self-healing](./self-healing)
- [Troubleshooting](./troubleshooting)
- [Environment variables](../reference/environment#backups)
