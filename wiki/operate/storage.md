---
title: Storage
description: Plan disk space, set quotas and retention policies per repository, free space without stopping the server and react when the disk fills.
---

# Storage

Arkvory keeps every published file once, unchanged, in a storage directory on a local disk of the server, and optionally on [more volumes](#volumes). This page explains what takes disk space, how to limit it with quotas and retention policies, how deleted files leave the disk, and what to do when the disk is full.

## Where the content lives {#location}

The storage directory is set by `ARKVORY_DATA_DIR`. The installers use these locations:

| Installation   | Storage                                      |
| -------------- | -------------------------------------------- |
| Windows        | `data\` in `C:\ProgramData\ProAnima\Arkvory` |
| Linux          | `data/` in `/opt/proanima-arkvory`           |
| Docker Compose | The Docker volume `proanima-arkvory_storage` |

Inside it, `blobs/` holds the finished files, `staging/` and `parts/` hold uploads in progress, and the file `storage-id` ties the directory to the database. The catalog, with all names, labels, versions and permissions, is in PostgreSQL. Files and database belong together.

- Use a local file system that supports hard links. Do not use a network share for the storage.
- Do not add, change or delete files in the directory by hand. Arkvory removes files itself, as described below.
- A published file is never changed. New content is a new file with a new ID.

## Several volumes {#volumes}

You can give Arkvory more storage directories, for example on a second disk, instead of growing one volume. Each extra directory is an instance of the built-in module `local-storage` with its own ID. The storage directory of `ARKVORY_DATA_DIR` is always the instance `default`.

Configure the instances in the modules file (`ARKVORY_MODULES_FILE`, see [Environment variables](../reference/environment)):

```json
{
  "format": 1,
  "modules": {
    "local-storage": {
      "enabled": true,
      "config": {
        "instances": {
          "volume-2": { "directory": "/srv/arkvory-volume-2" }
        }
      }
    }
  }
}
```

| Field           | Meaning                                                                                                                               | Default                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `directory`     | Absolute path of the directory. It must not contain, or lie inside, the storage directory or another instance                         | Required                        |
| `acceptsWrites` | `false` stops new uploads to this volume. Its files stay readable, and uploads that already started on it can finish                  | `true`                          |
| `mode`          | `read-only` serves downloads and checks only, and refuses every write and removal, for example for a volume that is mounted read-only | `full`                          |
| `enabled`       | `false` closes the volume: its files cannot be downloaded until you enable it again                                                   | `true`                          |
| `reserveBytes`  | Free space kept on this volume, in bytes                                                                                              | `ARKVORY_STORAGE_RESERVE_BYTES` |

An ID has lowercase letters, digits and `-`, starts with a letter and is not `default`. You can add up to 16 instances. Every process (the API, the read gateways, the worker and the backup agent) must read the same modules file: a process that plans other instances is not ready. Restart all services after a change.

To add a volume:

1. Mount the volume and create the directory. It must belong to the account that runs the services. Arkvory does not create this directory. If it is missing, for example because the volume is not mounted, the volume stays unavailable and nothing is written beneath the mount point.
2. Mark the directory as a new volume: `arkvory volume-init --directory /srv/arkvory-volume-2`. The command needs no `--root`. It refuses a directory that does not exist or is not empty (only `lost+found` may be there) and writes the identity file `storage-id`. On Linux it also refuses a directory that is not a mount point, such as the empty directory of a volume that is not mounted. For a directory inside a mounted volume, add `--no-expect-mount`. On Windows, `--expect-mount` turns this check on. The services never create the file: a volume without it stays unavailable.
3. Add the instance to the modules file and restart the services. At its first start, the API records the identity of the volume, the file `storage-id` in the directory. From then on, every process checks this file. A volume that is not mounted, or another volume at the same path, is never written to. Every write and removal on the volume checks this file again first.
4. Choose which uploads go to the volume with a [placement policy](#placement).

### Placement of new uploads {#placement}

The placement policy of a repository chooses the storage of each new upload. A rule has an ID, a storage (`backendId`) and two optional conditions: a package group (`models/*`, `tools` or `*`) and a minimum size in bytes. The first rule whose conditions hold wins. Without a match, the upload goes to `default`. A repository can have up to 32 rules.

Read and change the policy with `arkvoryctl` or the API operations [getStoragePlacement](../api/reference/storage#getStoragePlacement) and [setStoragePlacement](../api/reference/storage#setStoragePlacement):

```bash
arkvoryctl storage placement --repository releases
arkvoryctl storage placement --repository releases --revision 0 --file rules.json
```

The file `rules.json` holds the list of rules, for example all files of 1 GiB or more on `volume-2`:

```json
[{ "id": "large", "backendId": "volume-2", "packageGroup": null, "minSizeBytes": "1073741824" }]
```

- Reading the policy needs `storage.read`, changing it needs `storage.manage`. The answer also lists every storage with its state: `accepting`, `not_accepting`, `read_only`, `disabled`, `unavailable` or `not_loaded`.
- A rule can only name a configured storage. Another name is refused with 400 `backend_unknown`.
- The policy saves with a revision. If someone else changed it, read it again and save again.
- A change applies to new uploads only. Files that are already stored stay where they are; to move them, see [Move stored files to another volume](#rehome).

### When a volume takes no new uploads {#placement-fallback}

Publication never fails because of placement. If the chosen storage does not accept uploads at that moment, because of `acceptsWrites: false`, `read-only`, `enabled: false`, a missing instance or a volume that is not available (not mounted, a failed identity check, no answer), the new upload is created in `default` instead. The upload shows its storage in `storageBackend`, the metric `arkvory_storage_placement_fallback_total` counts it, and the log has the line `storage.placement_fallback`.

- **Uploads in progress are not moved.** If a volume stops taking data while an upload in parts runs on it, new parts are refused with 409 `backend_read_only`, and the client starts a new upload. If all parts are already there, completing the upload writes the file to `default`. The parts are read from the volume where they are. A file that an interrupted attempt already stored completely on the volume stays there.
- **An unavailable volume** makes downloads of its files fail with 503 `unavailable` until it is back. The server keeps running, and readiness and `writable` follow `default` only. Every process checks its volumes again every 30 seconds.
- **Cleanup** removes each file on the volume that holds it, the parts left on another volume included. On a volume that is unavailable or read-only, cleanup skips the file and tries again later.
- **Quotas and limits.** Quotas and `ARKVORY_CAPACITY_BYTES` count all volumes together. The reserve applies to each volume.
- **Temporary files** of raw, OCI and mirror uploads stay in the storage directory `default`.
- **Cluster.** In a [high availability cluster](./cluster), every volume must be a directory on the replicated volume, like the storage directory: another disk is not copied to the other servers. Otherwise the API does not start.
- **A volume removed from the configuration.** Arkvory remembers every volume that held data. If one is no longer in the modules file, its files cannot be downloaded, cleaned up or backed up: a backup fails with `blob_missing`. Every process reports it with the metric `arkvory_storage_backend_unconfigured`, the log line `storage.backend_unconfigured` and the alert `ArkvoryStorageVolumeUnconfigured`, and the placement answer lists it as `not_loaded`. Configure it again to fix this. To retire a volume, set `acceptsWrites: false`, [move its files](#rehome) to another volume and keep it configured until the moves are done.

Watch `arkvory_storage_backend_up` and `arkvory_storage_backend_accepting`, see [Monitoring](./monitoring#metrics). Backups copy every volume. A restore needs an empty directory for each volume, see [Restore several volumes](./backups#restore-volumes).

### Move stored files to another volume {#rehome}

To move files that are already stored, for example to retire a volume or to fill a new one, plan the moves on the server. The services keep running.

```bash
arkvory storage rehome --root /opt/proanima-arkvory --from volume-2 --to default
arkvory storage moves --root /opt/proanima-arkvory
```

1. `rehome` plans a move for every published file of the `--from` storage and prints how many it planned and the moves by state. `--repository <name>` limits it to one repository, `--limit <n>` to a number of files (10 000 by default, 100 000 at most). A file that already has a move in progress is not planned again. Both storages must be configured. The target must take new uploads, otherwise the command fails with `backend_read_only`. The source may be read-only.
2. The worker performs the moves, two at a time. For each file it copies the bytes to the target and checks the size and SHA-256, switches the file to the target, then removes the copy in the source. The file keeps its ID: links, paths, stages and references stay valid.
3. `moves` prints the moves by state: `planned`, `copied`, `switched`, `released` (done), `skipped` (the file was deleted meanwhile; its copy in the target was removed) and `failed`.

- **Downloads and backups.** A download that started before the switch reads to its end from the source. The source copy is removed only after that download and after any backup that includes the file. The removal waits; it never blocks a download.
- **Failures.** A failed step is repeated with a growing pause. After 5 failed attempts, or when the target stops taking uploads, the move is `failed` and the file stays where it is. Run `rehome` again to plan a new move. The next move checks and reuses a copy that a failed move left in the target. This applies until the switch: after it the move is never `failed`, and removing the source copy is retried until it succeeds. While a storage is unavailable or read-only, for example the source of an evacuation, the step waits for it and is checked again every 5 minutes.
- **Speed.** `ARKVORY_REHOME_BYTES_PER_SECOND` limits how fast the worker copies. By default there is no limit.
- **Quotas** count each file once, during and after the move.
- With Docker Compose, the command runs a one-off worker container.

The worker writes the log lines `storage.move_completed`, `storage.move_skipped` and `storage.move_failed`.

## Plan the disk {#disk}

The following uses disk space on the storage volume:

| What                               | Notes                                                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Published files                    | All versions that you keep                                                                                                               |
| Uploads in progress                | The parts and the staging files, until the upload ends                                                                                   |
| Files of finished uploads in parts | The temporary parts stay next to the finished file until a physical cleanup pass removes them. See [Physical cleanup](#physical-cleanup) |
| Deleted files                      | They stay on disk until the grace period ends and a cleanup pass removes them                                                            |
| Mirror copies                      | A part in `mirror-staging` while a mirror copies a file. See [Mirrors](./mirrors)                                                        |

Besides the storage, plan the PostgreSQL database, the logs and the backup vault on their own volumes if you can. See [Backups](./backups).

Arkvory keeps a **reserve** of free space on the storage volume. By default it is 1 GiB (`ARKVORY_STORAGE_RESERVE_BYTES`). An upload that would use the reserve is refused with HTTP 507 and the reason `storage_full`. Downloads keep working. `GET /health/ready` shows `writable: false` while there is no room for new data.

Arkvory also keeps 100 000 inodes free on each volume (`ARKVORY_STORAGE_RESERVE_INODES`): every stored file and every part is a file, so a volume can run out of inodes before it runs out of bytes. A write that would use them is refused the same way. File systems without an inode count, such as NTFS, are checked for bytes only.

Two limits work independently of the disk:

- `ARKVORY_CAPACITY_BYTES` limits all reserved content of the installation. The default is 10 TiB. It is a logical limit, not a check of the disk. When it is reached, uploads fail with HTTP 507 and the reason `catalog_limit`.
- `ARKVORY_MAX_OBJECT_BYTES` limits the size of one file.

See [Environment variables](../reference/environment#storage-and-limits). Arkvory has no metric for the free space of the storage or of the database. Watch the volumes with your operating system tools or a node exporter.

## Who can manage storage {#permissions}

Storage settings are not part of the normal read and write rights. A service key needs explicit actions on the repository:

| Action             | Allows                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| `storage.read`     | See the policy, the usage, the cleanup settings and the placement                                 |
| `storage.manage`   | Change the policy, the quota, the cleanup settings and the placement, and request a cleanup batch |
| `artifact.delete`  | Preview deletions, delete artifacts, and switch an automatic retention policy on                  |
| `diagnostics.read` | Read the storage events                                                                           |

Accounts with a password and the recovery key do not have these rights by themselves. To manage storage in the console:

1. Create a service account with a policy for the repository that includes the four actions. See [Accounts and access](../use/accounts).
2. Issue and activate a key for it.
3. In the console, open [[ui:keySignIn]], paste the key and select [[ui:connect]].
4. Open [[ui:repositories]], and on the card of the repository select [[ui:repositoryStorage]].

The panel [[ui:storageTitle]] appears above the catalog. Without the rights, the panel stays hidden.

An enabled retention policy is tied to the **key that enabled it**. Each automatic run checks again that this key is still active, not expired, and still has `storage.manage` and `artifact.delete`. If you revoke the key or narrow its rights, deletion stops and the event `retention.failed` appears. After you rotate the key, save the policy again with the new key.

## Quotas and warning thresholds {#quotas}

A repository can have a quota. Without a quota, only the global limit applies.

| Setting            | Console field                 | Meaning                                                                                                                    | Default  |
| ------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------- |
| Quota              | [[ui:storageQuota]]           | The most space the repository may use. The API takes exact bytes, from 1 to 9 007 199 254 740 991, and `null` for no limit | No limit |
| Warning threshold  | [[ui:storageWarningPercent]]  | The share of the quota that raises a warning. 1–98                                                                         | 80       |
| Critical threshold | [[ui:storageCriticalPercent]] | The share that raises an error. 2–99, higher than the warning threshold                                                    | 95       |

The usage that counts against the quota is the size of all files of the repository that are not yet removed from disk: published files, unfinished uploads and deleted files that wait for cleanup. A deleted file therefore still uses quota until a cleanup pass removes it.

- **Check.** The server checks the quota when an upload starts. A new upload that would exceed the quota fails with HTTP 507 and the reason `storage_quota`. A retry with the same idempotency key does not reserve space twice.
- **Lowering.** You can set a quota below the current use. Running uploads can finish. New uploads over the limit are refused.
- **No automatic freeing.** The quota never causes deletion. Retention does not remove extra builds to meet a quota.
- **States.** The state is `unlimited`, `normal`, `warning`, `critical` or `exceeded`. A change of state is recorded once as a storage event.
- **Monitor.** The server rechecks the states of up to 20 repositories every minute, also when automatic deletion is off.

The numbers are logical reservations, not free disk space. A repository can be under its quota while the disk is full, because the disk also holds staging files and other repositories.

## Retention policy {#retention}

A retention policy deletes old **registered UPack builds** automatically and keeps the last N of them. It does not delete other files: plain files by path, container images, Git LFS objects and npm packages are outside it. Without a policy, nothing is deleted automatically.

### The settings {#retention-settings}

| Setting          | Console field           | Meaning                                                                                                  | Default                               |
| ---------------- | ----------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Enable           | [[ui:storageEnabled]]   | Switches automatic deletion on                                                                           | Off                                   |
| Grouping         | [[ui:storageGrouping]]  | The unit that is counted: [[ui:storagePerChannel]], [[ui:storagePerPackage]] or [[ui:storageGlobal]]     | Package and channel                   |
| Last N           | [[ui:storageKeep]]      | How many builds to keep per counter, 1–100 000                                                           | 10                                    |
| Channels         | [[ui:storageChannels]]  | Own N for a label, as `label=N`, one per line, up to 32. Used only with the grouping package and channel | `test=10`, `staging=10`, `release=10` |
| Minimum age      | [[ui:storageAge]]       | A build younger than this is kept, in hours, 0–87 600                                                    | 24                                    |
| Protected labels | [[ui:storageProtected]] | Builds with one of these labels are never deleted, up to 32, comma separated                             | `bse`, `release`                      |
| Interval         | [[ui:storageInterval]]  | Minutes between runs, 1–10 080                                                                           | 60                                    |

A label is 1 to 64 letters, digits or the characters `_ . : -`.

### How builds are chosen {#retention-rules}

1. The server ranks the builds of each counter by **publication time**, newest first. The order is not the SemVer order of the versions.
2. The counter depends on the grouping. With package and channel, a build is counted separately for each configured channel label that it carries, per package (`group/name`). A build with no configured label goes into one shared counter of the package, with the default N. With package, every package has one counter. With the whole repository, all builds share one counter. Package names ignore case, labels do not.
3. A build stays if it is among the last N of **any** counter that it belongs to.
4. A build younger than the minimum age stays.
5. A build with a protected label stays. Its labels come from the current annotation, or from the upload when it has no annotation. Protected builds still take part in the ranking, so the number kept can be higher than N.

A build is never deleted while something still needs it:

- An external service holds a reference to it.
- A file path, current or from the history, uses it.
- Another build lists it as an attachment, now or in the history.
- It is promoted to a stage. Remove the stage first.
- A container image, Git LFS or npm entry uses it.

Deleting a build is logical: it leaves the lists and new downloads fail with 404. The bytes leave the disk later, in [Physical cleanup](#physical-cleanup). The package version stays reserved, so the same version cannot be published again with other content.

### Enable a policy safely {#retention-enable}

Preview first, then enable. A preview shows what the saved policy would delete, and it does not delete anything.

1. Connect with a key that has the four actions, and open the storage panel of the repository.
2. Set the fields and leave [[ui:storageEnabled]] off. Select [[ui:storageSave]].
3. Select [[ui:storagePreview]]. The list shows up to 100 builds that the saved policy would delete in one batch. If more candidates remain, the console says so.
4. If the list is right, tick [[ui:storageEnabled]] and the acknowledgement [[ui:storageAcknowledge]], then save again. This needs `artifact.delete`.

Notes:

- The preview shows a moment in time. When the policy runs, it ranks again and checks the dependencies again.
- The policy saves with a revision. If someone else changed it, reload and save again.
- [[ui:storageRefresh]] reloads the settings and the usage.

### How it runs {#retention-run}

The API process that writes (not a read gateway) checks every 60 seconds and handles up to 20 policies that are due. One batch deletes at most 100 builds. If candidates remain, the next batch starts after a minute. Otherwise the next run comes after the interval. The schedule is saved in the database and survives a restart.

You can also run one batch yourself with the API operation [runStoragePolicy](../api/reference/storage#runStoragePolicy). The usage, the preview and the events have operations in the same [Storage API reference](../api/reference/storage).

## Physical cleanup {#physical-cleanup}

Deleting an artifact, by a person or by a policy, only removes it from the catalog. **Physical cleanup** removes its bytes from the disk, in the background and without stopping the API, the worker or the read gateways. It also:

- Cancels uploads that expired without being finished, and removes their parts.
- Removes the temporary parts of finished uploads.

It does not choose builds to delete. It only removes what is already deleted or cancelled.

**Physical cleanup is off by default, and it is set per repository.** Turn it on in every repository that you use. Until then, deleted files, expired uploads and the parts of finished uploads stay on disk, and the quota counts the deleted files.

### Settings {#cleanup-settings}

In the panel of the repository, open [[ui:cleanupTitle]]:

| Setting      | Console field          | Meaning                                         | Default | Range    |
| ------------ | ---------------------- | ----------------------------------------------- | ------- | -------- |
| Enable       | [[ui:cleanupEnabled]]  | Switches background cleanup on                  | Off     |          |
| Grace period | [[ui:cleanupGrace]]    | How long a deleted file stays on disk, in hours | 24      | 0–8760   |
| Batch        | [[ui:cleanupBatch]]    | Files handled in one batch                      | 25      | 1–100    |
| Interval     | [[ui:cleanupInterval]] | Seconds between batches                         | 60      | 5–86 400 |
| Delay        | [[ui:cleanupDelay]]    | Milliseconds of pause between files             | 50      | 0–1000   |

Select [[ui:cleanupSave]] to apply them. The change works at once. If you switch cleanup off, it stops after the current file. [[ui:cleanupRun]] asks for a batch soon, it does not delete at once. Select [[ui:cleanupRefresh]] to see the result of the last batch.

The grace period is not a recycle bin. With the value 0, a file can go right after it is deleted and no reader has it open. Arkvory cannot restore a deleted artifact.

### What cleanup does and what it skips {#cleanup-rules}

- It removes only files that are cancelled or deleted, past the grace period. It checks again that nothing uses them: no reference, file path history or attachment history.
- A download that is open, an upload that is being written and a file that a running backup needs make cleanup **skip** that file. The next batch tries again. The last result shows how many files it processed, skipped and failed, and how many bytes it freed.
- The quota and the logical capacity are released only after the files are removed from disk.
- A batch is limited by the batch size and the delay, which lowers the disk load. It does not guarantee a strict disk throughput, and it cannot promise zero influence on the latency of other requests.
- Cleanup runs in the writer API, once per database. The writer checks one repository that is due every 5 seconds. Without a running writer, nothing is cleaned.
- Enable cleanup only after you updated every Arkvory process, including gateways and the worker. An old process without the cleanup protocol makes cleanup postpone its work.

## Delete an artifact {#delete-artifacts}

You can delete one published artifact by hand. You need `artifact.delete` on the repository.

1. Open the artifact in [[ui:metadata]], and find [[ui:deletionTitle]].
2. Select [[ui:deletionInspect]]. The console shows what still uses the artifact. If something blocks the deletion, you must remove that dependency first.
3. Paste the ID of the artifact to confirm it, then select [[ui:deletionSubmit]].

Deleting this way does not check protected labels, because you choose the object yourself. Dependencies are always checked. After the deletion:

- The artifact leaves the lists and searches. A new download fails with 404. A download that already runs can finish.
- The package version stays reserved.
- The bytes stay on disk until [physical cleanup](#physical-cleanup) removes them after the grace period.
- You cannot undo it in the console or the API.

For many artifacts, the API offers [previewRetention](../api/reference/storage#previewRetention) and [applyRetention](../api/reference/storage#applyRetention). A preview lists candidates published before a date with their blocking reasons. Apply deletes only the IDs you pass, up to 100 per call, and returns an outcome for each ID: `deleted`, `already_deleted`, `protected`, `changed`, `not_eligible` or `not_found`. Check every outcome, not only the HTTP status.

## Storage diagnostics and events {#diagnostics}

The section [[ui:storageEvents]] lists what happened in the repository, oldest first, 100 per page. Select [[ui:storageMore]] for the next page. Reading it needs `diagnostics.read`. The API operation is [getStorageEvents](../api/reference/storage#getStorageEvents), with a filter by level (`info`, `warning`, `error`).

| Event                                                                                                 | Level                  | Meaning                                                                                                        |
| ----------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| `storage.policy_updated`                                                                              | info                   | The retention policy was saved                                                                                 |
| `retention.completed`                                                                                 | info                   | A batch deleted builds. The event holds the count                                                              |
| `retention.failed`                                                                                    | error                  | Automatic deletion stopped, for example because the authorizing key was revoked                                |
| `cleanup.configured`                                                                                  | info                   | The cleanup settings were saved                                                                                |
| `storage.placement_updated`                                                                           | info                   | The placement policy was saved                                                                                 |
| `cleanup.completed`                                                                                   | info or error          | A cleanup batch processed, skipped or failed on files. It lists the counts and the freed bytes                 |
| `capacity.normal`, `capacity.warning`, `capacity.critical`, `capacity.exceeded`, `capacity.unlimited` | info, warning or error | The quota state changed                                                                                        |
| HTTP error codes                                                                                      | warning or error       | A request of a managed key to this repository failed. The event keeps the request ID, the route and the status |

The history is bounded: 1000 events per repository and 20 000 in total, and the oldest are dropped. It is best-effort diagnostics, not a log with guaranteed delivery. Export what you need in time, and use the server log for long-term evidence. See [Monitoring](./monitoring).

The panel also shows the usage: published bytes, unfinished uploads, the bytes that await cleanup, and the total against the quota. The API operation is [getStorageUsage](../api/reference/storage#getStorageUsage).

## When the disk is full {#disk-full}

Signs: uploads fail with HTTP 507 and the reason `storage_full`, `GET /health/ready` shows `writable: false`, or the operating system reports no free space. Downloads keep working. Clients can resume their uploads after you free space.

1. **Find the cause.** Check the free space of the storage volume, the database volume and the vault volume. Compare the usage figures in the storage panel. Large "awaiting cleanup" figures mean that deleted data is still on disk. A large "unfinished uploads" figure means abandoned uploads.
2. **Run cleanup.** If cleanup is off, turn it on in every repository, with a short grace period such as 0 if you accept that deleted files go at once. Select [[ui:cleanupRun]]. It also removes the temporary parts of finished uploads and the expired uploads. Wait for the batches and read the last result. Cleanup skips files that are in use, so repeat it.
3. **Delete what you do not need.** Apply a retention policy, or delete artifacts. This frees space only after cleanup removes the bytes.
4. **Add space.** Extend the volume or the disk. Move the vault or other data off the volume if they share it. You can also [add a volume](#volumes) and place new uploads there.
5. **Check recovery.** After space is free, `writable` returns to `true` and uploads work again.

Do not delete files in `blobs/`, `staging/` or `parts/` by hand: this breaks the link between the database and the disk. If the reserve is too small for your logs and database on the same volume, raise `ARKVORY_STORAGE_RESERVE_BYTES`.

If an upload fails with the reason `storage_quota` or `catalog_limit` instead, the disk is not the problem. Raise the quota or the global limit, or delete data.

## Limits {#limits}

- The retention policy handles registered UPack builds only. It never removes other files.
- The retention order is the publication time, not the version number.
- Storage, quotas and cleanup need explicit service key actions. Password accounts and the recovery key do not have them.
- Physical cleanup is off by default and is set for each repository.
- A deleted artifact cannot be restored. Restore data from a backup. See [Backups](./backups).
- Mirrored repositories run no storage policy. See [Mirrors](./mirrors).
- The storage must be a local file system. There is no support for network shares. Extra [volumes](#volumes) are local directories too. Stored files move between them only by the command on the server, [`arkvory storage rehome`](#rehome), not through the API.
- On Windows, Arkvory syncs each file to disk but cannot sync the directory entry that publishes it: Node.js has no directory sync there. A power loss shortly after an upload can leave a published file missing from the disk. Use a UPS and keep [backups](./backups) or a [mirror](./mirrors). On Linux, the directory entries are synced too.

Signed storage modules remain available to offline `scrub` in read-only mode. Keep the installed modules and their configuration in place. `storage rehome` can plan moves from a configured module storage to ordinary storage; the worker checks the target before copying. The installed module plan must match the writer. Stop API and worker before `scrub`.

## Related pages {#related-pages}

- [Backups](./backups)
- [Mirrors](./mirrors)
- [Monitoring](./monitoring)
- [Troubleshooting](./troubleshooting)
- [Environment variables](../reference/environment)
- [Repositories](../use/repositories)
