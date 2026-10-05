---
title: Mirrors and a second site
description: Keep a read-only copy of repositories on a second installation, watch its synchronization and switch to it when the source is lost.
---

# Mirrors and a second site

A **mirror** is a repository on one Arkvory installation that is a read-only copy of a repository on another installation, the **source**. The mirror installation pulls changes from the source over HTTPS. It keeps its own database, its own storage, its own accounts and its own keys.

Use a mirror to serve downloads from a second location, and to keep a second site that can take over when the source is lost. A mirror is not a backup of the source, and it is not automatic high availability. You do the switch yourself. For other protections see [Backups](./backups) and [Read gateways](./read-gateways).

## What a mirror is {#what-a-mirror-is}

For a mirrored repository, the mirror installation copies:

- The published files, with their bytes and the **same artifact IDs** as on the source.
- Labels, metadata and collections.
- The UPack registration, the stages and the current file paths.
- Container images, Git LFS objects and npm packages of the repository.
- Deletions. A file deleted on the source is deleted on the mirror.

Downloads by ID, by package (version, range, stage) and by file path answer on the mirror as they did on the source at the last synchronization. They keep working when the source is down.

A mirror does not copy:

- Accounts, groups, keys and grants. The mirror has its own, and they are independent: revoking a key on the source does not affect the mirror.
- References that protect files from cleanup, attachments of builds, audit trails and storage policies.
- The history of file paths from before the first synchronization. Revision numbers of labels and paths on the mirror are its own.

Clients cannot write into a mirrored repository. Uploads, label changes, file paths, stages, deletion and promotion into it get HTTP 409 with the reason `mirror_read_only`. Other repositories of the mirror installation work as usual. Storage policies do not run in a mirrored repository, and only the synchronization deletes there.

## Set up a mirror {#set-up}

You need a key on the source and one command on the mirror.

### Create a key on the source {#source-key}

The mirror needs a key that can only read the source repository. A write key is not needed.

1. On the source, open [[ui:services]] with the recovery key or an operator key.
2. Select [[ui:serviceCreate]], and in [[ui:servicePolicy]] add the repository. Select [[ui:bindingRead]] to fill the permissions that a mirror needs. They include `artifact.list`, `artifact.read`, `content.read`, `annotation.read`, `asset.read` and `package.read`.
3. Select [[ui:keyIssue]], copy the secret, confirm [[ui:keySaved]] and select [[ui:keyActivate]]. A key that is not activated expires after 15 minutes.
4. Save the secret in a file on the mirror server. The file holds only the key, on one line, 16 to 4000 printable characters. Only root or the Administrators group may read it.

The source must be a release with the change feed. The command in the next step checks this.

### Attach the repository on the mirror {#attach}

Use a **new, empty** repository name on the mirror. The synchronization makes the repository equal to the source, but it never deletes what the source never had.

```bash
sudo arkvory configure --root /opt/proanima-arkvory \
  --mirror releases \
  --mirror-upstream https://arkvory.example \
  --mirror-token-file /root/mirror-releases.key
```

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' configure --root $root `
  --mirror releases --mirror-upstream https://arkvory.example `
  --mirror-token-file C:\secure\mirror-releases.key
```

| Option                     | Meaning                                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--mirror NAME`            | The repository on this installation. 1–64 characters: lowercase letters, digits, `_` and `-`, starting with a letter or digit                                  |
| `--mirror-upstream URL`    | The origin of the source: `https://host`, with no path, no credentials and no query. Plain `http://` is accepted only for `localhost`, `127.0.0.1` and `[::1]` |
| `--mirror-token-file FILE` | An absolute path to the key file                                                                                                                               |
| `--mirror-source NAME`     | The repository on the source. Default: the same name as `--mirror`                                                                                             |
| `--mirror-ca-file FILE`    | A PEM file with the certificate authority of the source. See [HTTPS with your own certificate authority](#ca-file)                                             |

Give one repository to one command. You cannot combine a mirror change with changes of HTTPS, the vault or updates in the same call.

1. The command checks the source with the key before it changes anything. The source must report the mirror change feed, and the feed of the source repository must answer.
2. It stores the key in `config/mirrors/NAME.token`, writes `config/mirrors/mirrors.json` and sets `ARKVORY_MIRRORS_FILE` in `config/runtime.json`.
3. It restarts the API and the worker and waits until they are ready. If anything fails, it restores the previous files and restarts again.

In Docker Compose, the command also writes `config/compose.mirrors.yml`, which mounts the mirror files into the API and worker containers. Add it to Compose commands that you run yourself.

Repeat the command with a new `--mirror-token-file` to replace the key of a repository. The worker reads the key file again after every failure, so a new key works without a restart. A repository that already mirrors one source refuses another source with the message `NAME mirrors another source; detach it first`.

On the mirror installation, give people and tools access to the repository. A repository exists as soon as a grant or a service policy names it. Use [[ui:manageGrants]] in [[ui:administration]] for people, and a service policy for tools. The permissions of the source do not carry over.

### HTTPS with your own certificate authority {#ca-file}

If the source uses a certificate from a corporate or self-signed authority, add `--mirror-ca-file /path/ca.pem` to the `--mirror` command. The command checks that each certificate can be read and has not expired, and it stores 1 to 64 certificates in `config/mirrors/ca.pem` (the file may not exceed 1 MiB). The worker then trusts them in addition to the standard ones.

- The file serves every mirror of the installation. A new `--mirror-ca-file` adds to it, and a certificate that is already there is kept once. Detaching the last mirror removes the file.
- The worker trusts the whole set for all its connections, not only for one mirror.
- Certificate checking is never switched off.

## What is copied and how often {#sync}

The worker of the mirror installation does the synchronization. There is no separate service. For each mirrored repository it runs these steps:

1. **First fill.** The worker notes the current position of the change feed of the source. It then reads the list of artifacts, packages and file paths page by page and makes the mirror equal to it.
2. **Following.** The worker reads the feed of the source. When it is caught up, it checks again every 10 seconds. It saves its position after every change that it applied.
3. **Copying files.** A file is copied in parts. The worker checks the SHA-256 of each part and of the whole file. After an interruption it continues with the first missing part. A part waits in `mirror-staging` inside the storage directory of the mirror.
4. **After an error.** The worker repeats the step after a pause that starts at 2 seconds and doubles up to 5 minutes. One failing mirror does not stop the others.

An installation can have up to 64 mirrored repositories. The copies count against the capacity limit and the disk of the mirror, so plan the same space as the source repository needs. See [Storage](./storage).

If the source key is revoked or the source is unreachable, the mirror keeps serving what it already has and shows the error in its status.

## Check the sync status {#status}

### In the console {#status-console}

Connect the console of the mirror installation to the mirrored repository. Above the catalog a badge shows the state:

- [[ui:mirrorBadge]] means the mirror is caught up.
- [[ui:mirrorBehind]] means it is still copying, or it has not started yet.
- [[ui:mirrorFailing]] means the last attempt failed. Downloads keep working.

Open the help of the badge ([[ui:mirrorHelpLabel]]) to see the source, the time of the last synchronization and the error code. The console hides the upload and change buttons in a mirrored repository.

### With the API {#status-api}

[getRepositoryMirror](../api/reference/mirrors#getRepositoryMirror) returns the status of a repository. It needs the right to read the repository. For an ordinary repository the answer is 404.

| Field                            | Meaning                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `mode`                           | `mirror` or `import`                                                                                       |
| `phase`                          | `pending` (the worker has not started), `seeding` (first fill) or `following`                              |
| `caughtUp`                       | `true` when the saved position equals the newest position of the source. `null` before the first fill ends |
| `checkedAt`, `syncedAt`          | When the worker last read the feed, and when it was last caught up                                         |
| `copiedArtifacts`, `copiedBytes` | Totals copied so far (`copiedBytes` is a decimal string)                                                   |
| `errorCode`, `errorAt`           | The last failure of a step, or `null`                                                                      |

### Error codes {#error-codes}

| `errorCode`             | Meaning and what to do                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mirror_mismatch`       | The same artifact ID has different content on the source. The mirror keeps its file. Investigate the artifact; do not delete either copy before you know the cause                                       |
| `mirror_source_changed` | The repository already holds a copy of another source. Detach it, or mirror the new source into a new repository                                                                                         |
| `mirror_source_behind`  | The source was restored or reinstalled, and its feed is behind the mirror. The mirror reads it again, and the code clears when it has caught up. Files that the restored source lacks stay on the mirror |
| `mirror_delete_blocked` | The source deleted a file that the mirror cannot delete, because something here still uses it, such as a reference or a file path history                                                                |
| `mirror_failed`         | A failure without a more specific code. Read the worker log                                                                                                                                              |
| other codes             | The code of the failed request, for example `unauthorized` when the key was revoked or `capacity_exceeded` when the mirror is full                                                                       |

The worker log (`component` is `mirror`) has `mirror.started`, `mirror.step_failed` with `errorCode` and `attempts`, `mirror.recovered` and `mirror.stopped`.

## Monitor mirrors {#monitoring}

The API of the mirror installation exposes three metrics for each mirrored repository, with the labels `repository` and `mode`:

- `arkvory_mirror_last_sync_timestamp_seconds`: the last time the mirror was caught up.
- `arkvory_mirror_last_check_timestamp_seconds`: the last time it read the feed.
- `arkvory_mirror_failing`: 1 while the last attempt failed.

The ready-made Prometheus rules are `ArkvoryMirrorStale` (not caught up for more than an hour) and `ArkvoryMirrorFailing` (the failure lasts 15 minutes). See [Monitoring](./monitoring). A mirror that the worker has not reached yet has no sync time, so the stale rule does not fire before its first synchronization.

## Import by stage {#import}

With `--mirror-stages`, the repository on the second installation is **not** a mirror. It is an ordinary writable repository that takes over the versions that carry one of the stages on the source. Use it to move builds from a development server to a production server.

```bash
sudo arkvory configure --root /opt/proanima-arkvory \
  --mirror releases --mirror-upstream https://dev.example \
  --mirror-token-file /root/dev.key --mirror-stages release
```

- You list 1 to 16 different stage names, separated by commas.
- A version is copied once, with the same ID, bytes, labels and UPack registration, and with the matching stages.
- After that it belongs to this installation. Changes, stage removal and deletion on the source do not reach it. A version that you delete here is never imported again.
- Uploads and the storage policy of the repository work as usual.
- Container image, Git LFS and npm registry data are not carried over.
- A change of stages starts a new first fill. It only adds, and it skips what is already there.

The console shows the badge [[ui:mirrorImport]], or [[ui:mirrorImportFailing]] when the last attempt failed. The key on the source needs the same read-only permissions as for a mirror.

## Fail over when the source is lost {#failover}

This is a manual switch for two independent installations on two sites. It is not automatic. Changes that the mirror had not yet pulled are lost.

### Prepare in advance {#failover-prepare}

1. Install the second site with the same release as the source when you can, with its own PostgreSQL and its own disk. The two sites share nothing.
2. Create a read-only key on the source and attach every repository as a mirror. A repository created on the source later does not appear on the mirror by itself, so attach it the same way.
3. On the mirror, issue the keys that your consumers will use, including keys that can write after the switch. The permissions of the source do not carry over, so a compromised source does not give access to the mirror.
4. Set up the consumers (CI, deployment agents) with the address of the mirror as a fallback for downloads. This also takes load off the link to the source.
5. Back up the source into a vault outside its site. See [Backups](./backups). A mirror does not replace this.
6. Monitor the mirror with the rules above.

### Switch {#failover-switch}

1. Make sure that the source is really unavailable for clients and will not return by itself. Two sites that both accept writes to one logical repository cannot be merged later. If the source is partly reachable, stop its services or close its port.
2. On the mirror, read `syncedAt` of each repository. Changes on the source after that time are not on the mirror.
3. Detach each mirrored repository on the mirror. It becomes an ordinary writable repository with the same artifact IDs and all its data.

   ```bash
   sudo arkvory configure --root /opt/proanima-arkvory --mirror-detach releases
   ```

   The command restarts the API and the worker, so expect a short interruption.

4. Point the clients that write at the mirror, through DNS or the configuration of your CI.
5. Upload and download a control file on the mirror.

What clients see:

- Before the switch, downloads from the mirror work, and writes get 409 `mirror_read_only`.
- After the detach, writes work. The badge disappears.
- The keys and passwords of the source do not work on the mirror unless you created the same accounts there.

There is no way back. Do not attach a detached repository as a mirror again. To bring the old source back, clear it or install it anew and attach the repositories of the new primary as mirrors. Never run the old source and the new primary side by side with writes enabled.

### Rehearse {#failover-rehearse}

Rehearse the switch every quarter and after updates. Detach one repository on a spare copy, check `syncedAt`, a download and an upload, and write down the date and the result. Test the restore of a backup of the source into an empty installation separately. See [Test a restore regularly](./backups#test-restore).

## Limits {#limits}

- A mirror is read-only until you detach it. A detached repository cannot return to being a mirror.
- The mirror is not a backup. It has no copy of accounts, keys or grants, and it does not copy references, attachments, audit trails or storage policies.
- Import mode does not copy container images, Git LFS or npm data.
- A synchronization only adds and updates. After a restore of the source, files that the source lost stay on the mirror.
- Both installations are updated on their own. The source must offer the mirror change feed.
- The set of trusted authorities of the source applies to the whole worker.
- There is no automatic failover, no fencing of the old source and no reverse synchronization.

## Related pages {#related-pages}

- [Backups](./backups)
- [Read gateways](./read-gateways)
- [Storage](./storage)
- [Monitoring](./monitoring)
- [Environment variables](../reference/environment#mirrors)
- [Accounts and access](../use/accounts)
