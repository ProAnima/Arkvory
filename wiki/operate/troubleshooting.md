---
title: Troubleshooting
description: Symptoms, causes and fixes for the failures that happen on an Arkvory server, and how to find the logs and the request ID.
---

# Troubleshooting

Find your symptom, read the cause and apply the fix. Every section names the log event or the error that you should see. For the meaning of an error code, see [Errors](../api/errors).

## First steps {#first-steps}

1. Ask the status endpoint: `curl -fsS http://127.0.0.1:8080/health/status`. `{"status":"ready"}` means that the API reaches its database and storage.
2. Read the newest log lines of the failing service. See [Logs and feedback](#logs-and-feedback).
3. Look for the event `startup.failed` or `worker.unavailable`. Its field `reason` names the cause.
4. If a client reports an error, ask for the request ID and search the log for it.

## The server does not start {#server-does-not-start}

The service manager starts a failing service again every 10 seconds. The log then repeats `startup.failed`. Read the field `reason`, and the fields `errno` and `sqlstate`.

### The port is busy {#port-busy}

**Cause.** `startup.failed` has `errno` `EADDRINUSE`. Another program listens on port 8080 (`ARKVORY_PORT`), or an old Arkvory process still runs.

**Fix.** Find the owner of the port and stop it, or change the port.

```bash
sudo ss -ltnp 'sport = :8080'
```

```powershell
Get-NetTCPConnection -LocalPort 8080 | Select-Object LocalAddress, OwningProcess
```

To change the port, edit `ARKVORY_PORT` in `config/runtime.json` and restart the services. The address of the console changes with it.

### The database is unreachable or rejects the login {#database-problems}

**Cause.** The log shows one of these reasons:

| `reason`                                                             | Meaning                                                           |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `dependency unavailable`, with `errno` `ECONNREFUSED` or `ETIMEDOUT` | PostgreSQL is stopped, listens elsewhere, or a firewall blocks it |
| `database authentication failed`                                     | The user or the password in `ARKVORY_DATABASE_URL` is wrong       |
| `database does not exist`                                            | The database named in the URL is missing                          |
| `database role lacks a required privilege`                           | The role cannot create or change the tables                       |

**Fix.** Start PostgreSQL, or correct `ARKVORY_DATABASE_URL` in `config/runtime.json` and restart the services. The managed database listens on `127.0.0.1:54329` (service `Arkvorydatabase` on Windows, `arkvory-database` on Linux). The services come up by themselves when the database answers. Do not delete the folder `database/`.

### The database and the program disagree {#migrations}

**Cause.** The reason starts with `unavailable:` and says `Database migrations 1 through N are required; run migrate`, or `Database schema is newer than this release`, or `database schema is missing; run migrations`. This happens after an update that stopped half way, or after an old version was started on a newer database.

**Fix.** Do not start an older version on a newer database. Check the state with `arkvory status --root <root>` and finish or undo the update with `recover`. See [An update failed](#update-failed). To keep the data safe, restore from a backup only when `recover` cannot finish.

### Another process owns the storage {#storage-identity}

**Cause.** The reason is `busy: Another writer or maintenance process owns this database`, or `conflict: Database belongs to a different storage directory`. A second API runs against the same database, or the data directory is not the one that this database was used with. Each storage directory has a file `storage-id`, and the database records it.

**Fix.** Stop the other process. Use the data directory that belongs to this database. Never copy `storage-id` into another directory, and never connect two installations to the same database.

### Permissions on the root or the data directory {#root-permissions}

**Cause.** `errno` is `EACCES` or `EPERM`, or the reason is `Cannot read ARKVORY_KEYS_FILE (EACCES)`. The service account cannot read the configuration or write the data directory. Typical causes are an installation in a user profile, a folder that was copied by hand, or a changed owner.

**Fix.**

- Linux: the root and `config/` belong to `root:arkvory` with modes 0750. `config/runtime.json` and `config/keys.json` have mode 0640. `data/` and `logs/` belong to `arkvory:arkvory`.
- Windows: the account `NT AUTHORITY\LocalService` must read every parent folder of the root, and change `data\`, `logs\` and the update inbox. Run the graphical installer again to restore the access rules.
- Install into a dedicated folder outside home directories and user profiles.

### A setting or a certificate is rejected {#invalid-configuration}

**Cause.** The reason names a variable, for example `Invalid ARKVORY_PORT`, or a certificate problem: `TLS certificate has expired`, `TLS certificate and key do not match`, `TLS key is not an unencrypted PEM private key`. The server never starts in plain HTTP when the certificate is wrong.

**Fix.** Correct the named variable in `config/runtime.json`. A value outside its range stops the start. Renew or replace the certificate files. Use `arkvory configure --tls-off` to return to plain HTTP while you fix the files. See [Environment variables](../reference/environment).

## The console cannot reach the API {#console-unreachable}

| Message in the console      | Cause                                                                                                                                                                                       | Fix                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [[ui:errorNetwork]]         | The browser gets no answer: the service is down, the address or the port is wrong, a firewall blocks it, the server listens only on `127.0.0.1`, or the certificate does not match the name | Test `/health/status` from the same computer as the browser. Check the service, the listen address and the firewall    |
| [[ui:errorGateway]]         | A reverse proxy answers, but the API behind it does not                                                                                                                                     | Check that the API runs and that the proxy points to its port. Raise the read timeout of the proxy for large transfers |
| [[ui:errorTimeout]]         | The server did not answer in time                                                                                                                                                           | Look for `upload.deadline` or a busy database in the log                                                               |
| [[ui:errorUnavailable]]     | A dependency such as the database is away for a moment                                                                                                                                      | Wait and try again. See [Busy and unavailable](#retry-after)                                                           |
| [[ui:errorOriginForbidden]] | An external console runs on an address that `ARKVORY_CORS_ORIGINS` does not list                                                                                                            | Add the exact origin (scheme, host and port) and restart the API                                                       |
| [[ui:sessionEnded]]         | You signed out elsewhere, the password changed, or the access was revoked                                                                                                                   | Sign in again                                                                                                          |

During an update, the console reconnects by itself. Do not send the installation request again. If Docker Desktop is used, the server is away until Docker Desktop runs. See [Docker](#docker).

## Sign-in problems {#sign-in}

### Wrong name or password {#wrong-password}

**Cause.** The message is [[ui:signInFailed]] (401 `invalid_credentials`). The server gives the same answer for a wrong name, a wrong password and a disabled account, so that nobody can find out which names exist.

**Fix.** An administrator can check the account in [[ui:administration]] and use [[ui:enableUser]] if it is disabled, or [[ui:resetPassword]] to set a new password.

### Too many attempts {#too-many-attempts}

**Cause.** The answer is 429 `rate_limited` with `login_attempts` and `Retry-After`. The address has used its 10 attempts, or the account is in its wait after many wrong passwords (up to 2 minutes). Even the correct password waits during this time.

**Fix.** Wait for the number of seconds in `Retry-After`. An administrator can clear the wait of an account by resetting the password. A restart of the API clears the counters of the addresses but not the wait of an account.

### Everybody is blocked behind a proxy {#blocked-behind-proxy}

**Cause.** The server sees the address of the proxy as the address of every client, so all clients share one budget.

**Fix.** Set `ARKVORY_TRUSTED_PROXIES` to the addresses of the proxy and restart the API. The proxy must send `X-Forwarded-For`. See [Security](./security#sign-in-limits).

### The owner is lost {#owner-lost}

**Cause.** Nobody remembers an administrator password.

**Fix.** Use the recovery key on the server:

1. Read the key from `config/bootstrap-token.txt` as root or Administrator.
2. In the console open [[ui:keySignIn]], paste the key and select [[ui:connect]].
3. Open [[ui:administration]]. Use [[ui:resetPassword]] for the account, or [[ui:createUser]] to create a new administrator.
4. Select [[ui:disconnect]] and sign in with the account.

The form [[ui:welcomeOwner]] works only while the server has no accounts at all.

### The recovery key is lost {#recovery-key-lost}

**Cause.** The file `config/bootstrap-token.txt` was deleted or never saved. The server holds only the hash of the key.

**Fix.** With root or Administrator rights on the server, write a new key and its hash. See [Configuration](../install/configuration). Do not delete the file again: the installation tools read it.

## Uploads {#uploads}

### An upload does not finish {#upload-stuck}

**Cause.** There are several possible causes:

- The client lost the connection. A multipart upload keeps its recorded parts for 7 days.
- A large upload waits for the worker. The worker is stopped, or it fails. A second worker waits as standby.
- Too many uploads run at once. By default 2 run, 1 per account, and others wait 20 seconds, then get 503 `busy`.
- A reverse proxy refuses a large body (413) or stops a slow request (502 or 504).

**Fix.**

1. Ask for the state of the upload: `arkvoryctl uploads status <id>`. Resume with the same file and the same state file. See [Command line](../protocols/cli#resume-interrupted-transfers).
2. Check the worker: `systemctl status arkvory-worker`, `Get-Service Arkvoryworker`. Look for `completion.failed` and `completion.attempts_exhausted` with the `uploadId`. The metric `arkvory_completion_oldest_queued_seconds` shows a waiting job.
3. Raise the limits of the proxy for the body size and the read time. An upload request stops after 30 seconds without data and after 30 minutes in total.
4. A session that is older than 7 days is gone (409 `upload_expired`). Start a new upload.

### integrity_mismatch {#integrity-mismatch}

**Cause.** The answer is 422 `integrity_mismatch`, or the client exits with code 5. The bytes do not match the declared size or SHA-256. The file changed while it was sent, the declared hash was computed for another file, or a proxy or a network device changed the body.

**Fix.** Send the file again from an unchanged copy. The session stays open, so a corrected file can be sent into it. If a download fails its check again and again, download it once more through another path, then report the request ID. See [Logs and feedback](#logs-and-feedback).

## Busy, rate limited, unavailable {#retry-after}

The codes `busy`, `unavailable` and `rate_limited` are temporary. The answer has the header `Retry-After` and the field `retryAfterSeconds`. Wait that long. The SDK and the command-line client repeat these answers a limited number of times.

| Answer                             | Cause                                                                                                                                    | What to do                                                                                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 503 `busy`, reason `request_limit` | The server handles `ARKVORY_MAX_REQUESTS` requests at once (128 by default)                                                              | Wait. Raise the limit only with enough memory. Check `arkvory_http_requests_in_flight`                                                                     |
| 503 `busy`                         | The transfer queue is full, a transfer waited longer than `ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS` (20 s), or the server drains before a stop | Wait and repeat. Raise `ARKVORY_MAX_UPLOADS` or `ARKVORY_MAX_DOWNLOADS` if it is frequent. `arkvory_transfer_admission_failures_total` counts the refusals |
| 503 `unavailable`                  | The database restarts, the process lost its storage ownership, or the hub is unreachable (`hub_unreachable`)                             | Wait. The services restart by themselves. See [Self-healing](./self-healing)                                                                               |
| 429 `rate_limited`                 | Too many sign-in, registration, password or feedback attempts                                                                            | Wait. See [Too many attempts](#too-many-attempts)                                                                                                          |

A 500 `internal` has no `Retry-After`. Do not repeat it blindly. Search the log for its request ID and report it.

## Disk full and quota {#disk-full}

| Answer, reason      | Cause                                                                                                                                             | Fix                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 507 `storage_full`  | The free space of the storage volume is below the reserve `ARKVORY_STORAGE_RESERVE_BYTES` (1 GiB by default), or the disk of the database is full | Free space on the volume. Check `df -h` or `Get-PSDrive`, and the volume of PostgreSQL         |
| 507 `storage_quota` | The repository quota is used up                                                                                                                   | Delete old builds, change the retention policy, or raise the quota in [[ui:repositoryStorage]] |
| 507 `catalog_limit` | The sum of all reserved content would pass `ARKVORY_CAPACITY_BYTES` (10 TiB by default)                                                           | Delete content, or raise the value in `config/runtime.json`                                    |
| 507 `queue_full`    | An account has 100 open completion jobs, or the server has 10,000                                                                                 | Wait for the worker to finish them                                                             |

While the disk is full, downloads and the console keep working. `/health/ready` shows `"writable": false`. Deleting an artifact in Arkvory does not free the disk at once: the file waits for the physical cleanup after its grace period. See [Storage](./storage). Do not lower the reserve to squeeze in more data, because the database and the logs need it.

## Backups fail {#backups-failing}

Start with the warning in [[ui:backups]] or `arkvoryctl backup status`, and the log events `backup.request.failed` and `backup.agent.failed` with their `errorCode`. See [Backups](./backups).

| Warning or message                                                                  | Cause                                                                                           | Fix                                                                                                                                           |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_offline`                                                                     | The backup service is stopped, or it fails to start                                             | Start `arkvory-backup` or `Arkvorybackup`. Read its log                                                                                       |
| `vault_unavailable`                                                                 | The vault volume is not mounted, has no `vault.json`, or the service account cannot write to it | Mount the volume before the service starts. Check the owner and the permissions. On Windows restart the agent if the volume was mounted later |
| `The vault directory does not exist; create it or mount its volume first`           | The path is wrong or the volume is missing                                                      | Create or mount the directory                                                                                                                 |
| `The vault directory is not writable`                                               | The service account has no write access                                                         | On Linux mount a share with `uid` and `gid` of the user `arkvory`. On Windows use a local or iSCSI volume                                     |
| `The directory has no vault.json: mount the vault volume, or pass --init-vault ...` | An empty directory could be an unmounted share, so the command refuses it                       | Mount the right volume, or pass `--init-vault` for a new empty vault                                                                          |
| `The vault must be outside the installation root and the storage directory`         | The vault overlaps the data                                                                     | Choose a separate directory on another volume                                                                                                 |
| `Network share paths are not supported ...`                                         | A UNC path on Windows. `LocalService` cannot sign in to SMB shares                              | Use a drive letter of a local or iSCSI volume                                                                                                 |
| `The backup service cannot reach /home, /root, /run/user, /tmp or /var/tmp`         | The systemd sandbox hides these folders                                                         | Choose another directory                                                                                                                      |
| `vault_full`, `vault_low_space`                                                     | The vault volume is nearly full                                                                 | Free space or keep fewer points. Earlier points stay intact                                                                                   |
| `last_run_failed`                                                                   | The newest backup failed                                                                        | Read the `errorCode` with `arkvoryctl backup jobs`                                                                                            |
| `verify_failed`                                                                     | A point failed its check                                                                        | Do not change the vault. Keep it for analysis and report it                                                                                   |

`arkvory configure --backup-vault` restores the old settings when the agent does not report the new vault within 150 seconds. An update stops the backup agent, so a backup that runs at that moment is repeated later. When automatic updates are on, keep the backup time outside the update hour (03:00 UTC by default).

## A mirror does not synchronize {#mirror-not-syncing}

Look at the badge [[ui:mirrorFailing]] on the repository, at `GET /api/v1/repositories/{repository}/mirror` and at the worker events `mirror.step_failed`. Downloads keep working from what is copied. See [Mirrors](./mirrors).

| `errorCode`                                                                    | Cause                                                                           | Fix                                                                                                                                                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mirror_failed`, or a code of the source such as `unauthorized` or `forbidden` | The source is unreachable, its key is wrong or has expired, or it lacks a right | Test the source with the key. Replace the key with `arkvory configure --mirror ... --mirror-token-file`. The worker reads the key again after every failure |
| `mirror_mismatch`                                                              | The same ID has other content at the source                                     | The copy is kept. Investigate the artifact                                                                                                                  |
| `mirror_source_changed`                                                        | The repository already holds a copy of another source                           | Detach with `--mirror-detach`, and mirror the new source into a new repository                                                                              |
| `mirror_source_behind`                                                         | The source was restored or reinstalled                                          | It seeds again by itself and the code disappears                                                                                                            |
| A certificate error                                                            | The source uses a company or self-signed certificate                            | Pass `--mirror-ca-file` to `arkvory configure`. The check is never turned off                                                                               |

The source needs a release with the mirror feed. The worker waits 2 seconds after a failure, doubling up to 5 minutes. `ArkvoryMirrorStale` fires after an hour without a catch-up.

## An update failed {#update-failed}

1. Read the failure. In the console, [[ui:updates]] shows a message. The updater writes `logs\updater.log` on Windows, and `journalctl -u arkvory-update` on Linux.
2. Check the installed version: `arkvory status --root <root>`.
3. Find your case.

| Case                                                             | What happened                                                                                       | What to do                                                                                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Same database schema, normal failure                             | The installer started the previous version again                                                    | Fix the cause and update again                                                                                                              |
| The console shows [[ui:updateMaintenance]]                       | A release with a schema change needs a verified backup, and the installer refused before any change | Connect a vault, wait for the first backup, check again                                                                                     |
| The migration failed                                             | Its transaction rolled back, and the previous version runs on the previous schema                   | Fix the cause and update again                                                                                                              |
| The new version did not start after a good migration             | The journal says `maintenance-required` and names a backup point                                    | Fix the cause and run `recover`, which finishes the update. Or restore the point with the previous version                                  |
| The updater was killed or the machine lost power                 | The lock `operation.lock` and the journal stay. Nothing continues by itself                         | The procedure below                                                                                                                         |
| The console shows [[ui:updateStale]] or [[ui:updateUnavailable]] | The host scheduler is not running or not connected                                                  | Check the task `ProAnimaArkvoryUpdate` (Windows) or `arkvory-update.timer` (Linux). Connect it with `arkvory updates-connect --root <root>` |

After an interrupted updater:

1. Stop the scheduler and make sure that no updater runs. Save `journal.json` and the logs.
2. Only then delete the file `operation.lock` in the installation root. Never delete it while an update runs.
3. Run `recover`:

   ```bash
   sudo arkvory recover --root /opt/proanima-arkvory
   ```

   ```powershell
   & 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' recover --root C:\ProgramData\ProAnima\Arkvory
   ```

   Before the migration began, it restores the previous version. After the migration began, it repeats the migration and starts the new version.

4. Check `/health/ready`, the completion queue and one test download. Then turn the scheduler on again.

`arkvory updates-reset --root <root>` clears an accepted update request after you reconciled the state. A downgrade is not possible. See [Updates](../install/updates).

## Docker {#docker}

- **Nothing runs after a restart of Windows.** Docker Desktop starts when the user signs in. Turn on **Start Docker Desktop when you sign in**, or use the native services.
- **Nothing runs after a restart of a Linux host.** Check that the engine starts at boot: `systemctl is-enabled docker`.
- **A container cannot read a file in `config/`.** The containers run as the user `node` (uid 1000). The installer makes `runtime.json`, `keys.json` and `health-token.txt` readable for it. If a manual edit changed the owner or the mode to 0600, the API stops with `Cannot read ARKVORY_KEYS_FILE (EACCES)`. Restore the mode 0644 of these three files. The folder `config/` itself stays closed.
- **The vault is not writable.** The agent runs as uid 1000, so the vault must belong to it. `arkvory configure --backup-vault` sets this up with the file `config/compose.vault.yml`. A share that you mount yourself needs `uid=1000`. Include `-f config/compose.vault.yml` in every manual Compose command, or `up` creates the backup container without the vault.
- **A container is `unhealthy`.** The health check calls `/health/ready` every 10 seconds. Docker marks the container but does not restart it. Read the log of the API container.

Show the log of a container:

```bash
docker logs --tail 100 proanima-arkvory-api-1
```

## A Windows service does not start {#windows-service}

1. Read the state and the error output:

   ```powershell
   Get-Service Arkvoryapi, Arkvoryworker, Arkvorybackup, Arkvorydatabase
   Get-Content C:\ProgramData\ProAnima\Arkvory\logs\arkvory-api.err.log -Tail 50
   ```

2. Open the Windows Event Viewer, **Windows Logs > System**, and look for events of the Service Control Manager.
3. Find your cause:

| Cause                                                                            | Fix                                                                   |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| The root is inside a user profile, or `LocalService` cannot read a parent folder | Install into a dedicated folder. See [Permissions](#root-permissions) |
| The port is busy                                                                 | See [The port is busy](#port-busy)                                    |
| The database service is not running                                              | Start `Arkvorydatabase`. The API retries every 10 seconds             |
| The services started "late" after a boot                                         | Their start type is Automatic (Delayed Start). Wait a few minutes     |
| Antivirus software quarantined Node.js                                           | Allow the files in `runtime\`                                         |
| `Another installation owns this service`                                         | Services of an installation in another root exist. Remove them first  |
| A service stays stopped                                                          | You or an update stopped it. Start it with `Start-Service`            |

Run the graphical installer again to restore the start types and the recovery actions of the services. See [Windows](../install/windows).

## Logs, request IDs and feedback {#logs-and-feedback}

**Find the logs.** Linux: `journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup`. Windows: `logs\` in the installation root. Compose: `docker logs <container>`. The formats and the events are in [Monitoring](./monitoring#logs).

**Find the request ID.** Every response has the header `X-Request-Id`. Every error body has `requestId`. The console shows it as [[ui:requestIdLabel]] under the message, and the command-line client prints it in the error line. Search the logs of the API and the worker for this value to see the request and the jobs that it started.

**Send feedback with logs.**

1. Sign in and select [[ui:reportOpen]] in the top bar.
2. Describe the problem and add the request ID. You can add up to 6 screenshots.
3. If you are an administrator, turn on [[ui:reportServerLog]]. This attaches the newest log lines of the API (about 1.5 MiB) and a summary of the system without addresses and secrets.
4. Select [[ui:reportShow]] to see exactly what will be sent, then [[ui:reportSend]].

The server sends the report to the ProAnimaStudio hub. If the hub cannot be reached or feedback is off, the console shows the address `info@proanima.net` to write to. See [Security](./security#hub) for what is sent.

## Related pages {#related-pages}

- [Monitoring](./monitoring)
- [Self-healing](./self-healing)
- [Security](./security)
- [Errors](../api/errors)
- [Windows](../install/windows)
