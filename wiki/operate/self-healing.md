---
title: Self-healing
description: What Arkvory restarts and resumes by itself after a crash, a hang or a lost database session, and what still needs an operator.
---

# Self-healing

Arkvory restarts a failed service by itself and resumes interrupted work without an operator. This page lists what is restarted, how long each recovery takes, and which problems still need you. One server is not a high-availability system: a restart interrupts connections for a short time, and clients resume their transfers.

## What restarts by itself {#overview}

Every service runs under the service manager of the platform. The API, the worker and the backup agent end their own process when they cannot continue safely. The service manager then starts a new process.

| Situation                                          | Linux (systemd)                             | Windows services                                            | Docker Compose                                                     |
| -------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| Crash, kill, out of memory                         | Restart after 10 s                          | Restart after 10 s                                          | The engine restarts the container with a growing pause             |
| Exit without a stop request, also with exit code 0 | Restart                                     | The launcher turns the exit into code 1, restart after 10 s | Restart                                                            |
| Lost storage ownership or lease                    | Exit 1, restart                             | Exit 1, restart                                             | Exit 1, restart                                                    |
| Hung main thread                                   | The watchdog ends the process, restart      | Same                                                        | Same                                                               |
| Database unreachable at start                      | Exit 1, retry every 10 s                    | Exit 1, retry every 10 s                                    | Exit 1, retry with a growing pause                                 |
| The machine restarts                               | Services are enabled in `multi-user.target` | Automatic (Delayed Start)                                   | With the container engine. Docker Desktop: after the user signs in |
| You stop the service                               | It stays stopped until the next boot        | It stays stopped until the next boot                        | `docker compose stop` stays stopped                                |

A readiness check that fails by itself does not restart a service. It can fail because the process drains before a stop, or because a folder of the storage directory is missing. A restart would not fix these causes.

## Windows services {#windows}

The graphical installer and `install.ps1` register `Arkvoryapi`, `Arkvoryworker` and `Arkvorybackup`, which share the account `NT AUTHORITY\LocalService`, and the database service `Arkvorydatabase` for the managed database. See [Windows](../install/windows#services).

- **Start type.** The API, the worker and the backup agent use Automatic (Delayed Start). The database uses Automatic. A delayed start means that the services come up some time after the boot, not at the same moment.
- **Recovery actions.** After a failure Windows restarts the service after 10 seconds. The same action repeats for every following failure. The failure counter resets after one hour. The recovery actions also apply when the process exits with an error code.
- **Stop timeout.** 120 seconds, to let a running request finish.
- **Logs.** Output of every service goes to `logs\` and rotates at 20 MiB with 5 old files.

Show the recovery actions of a service:

```powershell
sc.exe qfailure Arkvoryapi
```

Running the graphical installer again restores the start types and the recovery actions. A service that you stopped yourself stays stopped.

## Linux systemd units {#linux}

The packages and `install.sh` create `arkvory-api`, `arkvory-worker` and `arkvory-backup`, and `arkvory-database` when the database is managed.

- `Restart=always` with `RestartSec=10` restarts the API, the worker and the backup agent after every exit that you did not request, including exit code 0.
- `StartLimitIntervalSec=0` removes the limit of restart attempts, so systemd never gives up on a failing service. A permanent fault such as a wrong setting leads to a restart every 10 seconds, until you fix it.
- The database unit uses `Restart=on-failure` with the same 10 seconds.
- `TimeoutStopSec=120` gives a stopping service two minutes.
- The units are enabled for `multi-user.target`.

```bash
systemctl is-enabled arkvory-api arkvory-worker arkvory-backup
systemctl status arkvory-api arkvory-worker arkvory-backup
```

Only systemd is supported for native services. On a system with another init system, use Docker Compose.

## Docker Compose {#compose}

All services of the project `proanima-arkvory` use `restart: unless-stopped`. The one-time steps `initialize` and `migrate` do not restart.

- The API container has a health check: every 10 seconds it asks `/health/ready` with the health key, with a start period of 20 seconds. An unhealthy container is marked, but not restarted by Docker. The worker waits for a healthy API at start.
- The containers get 120 seconds to stop.
- The container engine must start at boot. On Linux check `systemctl is-enabled docker`. Arkvory does not change the engine.
- Docker Desktop on Windows is an application of one user. No container runs before the user signs in and Docker Desktop starts. Turn on **Start Docker Desktop when you sign in**. The installer and `arkvory status` warn when it is off. For a server that must start without a sign-in, use the native Windows services.

## Restart after a hang {#hang}

A process can stop working without ending: an endless loop, a blocking call or a hang in native code. The service manager does not see this, because the process still exists. Each of the API, the worker and the backup agent therefore has a watchdog.

1. The main thread raises a counter once per second.
2. A second thread checks the counter once per second.
3. When the counter has not moved for `ARKVORY_WATCHDOG_SECONDS` checks in a row (60 by default), the watchdog writes the record `process.stalled` with the field `stalledSeconds` to standard error and ends the process.
4. The service manager restarts the process like after a crash.

The watchdog counts its own ticks, not clock time. When the host sleeps or a virtual machine is paused, both threads stop, and no stall is invented after the wake-up. A hang therefore costs up to 60 seconds plus the 10 seconds of the restart.

`ARKVORY_WATCHDOG_SECONDS` accepts 10 to 3600. The value `0` turns the watchdog off. Use it only when a debugger pauses the process, because a paused process longer than the limit is restarted. A long blocking operation counts as a hang too. If the watchdog itself cannot start, the service writes `process.watchdog_failed` and keeps running without it. The managed PostgreSQL has no watchdog. Its service manager restarts it after a crash. See [Environment variables](../reference/environment#watchdog).

## Lost database session or storage ownership {#ownership}

The API proves with a database session that it is the only writer of the storage directory. The session is checked every 2 seconds, and a check that does not answer within 8 seconds counts as lost. The worker proves its role in the same way. The ownership is never restored inside a running process, because a second process could have taken over.

When the ownership is lost, for example after a PostgreSQL restart, the process:

1. writes `api.ownership_lost` or `worker.ownership_lost`,
2. stops accepting work and cancels the transfers,
3. exits with code 1.

The service manager starts a new process, which checks everything again from the start. While the database is down, the new process cannot start, and the API exits and restarts every 10 seconds until PostgreSQL answers. This is expected. Clients get 503 `unavailable` with `Retry-After` meanwhile. A running backup agent does not exit when the database is away. It logs the error and tries again after its polling interval (15 seconds by default).

## What happens to work in progress {#work}

A crash breaks open connections. The data that was acknowledged stays. What happens next depends on the kind of work.

| Work                                  | After a restart                                                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Download                              | The client resumes with a range request. The SDK and the command-line client do this by themselves                                                                                    |
| Multipart upload                      | The recorded parts stay on the server. The client asks which parts exist and sends the missing ones. The session stays open for 7 days from its creation                              |
| Single-request upload of a whole file | The client sends the file from the first byte again                                                                                                                                   |
| Upload completion by the worker       | See below                                                                                                                                                                             |
| Backup                                | See below                                                                                                                                                                             |
| Mirror synchronization                | The worker saves its position after every applied change and copies a file from the first missing part. After a failure it waits 2 seconds, doubling up to 5 minutes between attempts |
| Update                                | The installer keeps its lock and its journal. It does not continue by itself. See [Troubleshooting](./troubleshooting#update-failed)                                                  |

The SDK and the command-line client repeat network failures and the answers 408, 429, 502, 503 and 504 a limited number of times. Other clients need their own retry. See [Transfers](../use/transfers).

**Completion jobs.** A large upload is finished by the worker (the SDK and the command-line client do this from 16 GiB). The worker holds a lease of 30 seconds on a job and renews it every 2 seconds. When the worker crashes, the lease expires within 30 seconds, and the restarted worker takes the job again. A job runs at most 5 times. After a failure it waits 2 seconds, doubling up to 60 seconds. These errors end a job at once: `forbidden`, `invalid_input`, `integrity_mismatch` and `not_found`. A job that used all attempts gets the record `completion.attempts_exhausted`. Asking again to complete the same upload queues the job again. The completion checks the stored bytes, so it is safe to repeat.

A second worker on the same database waits as standby (`worker.standby`) and checks every 5 seconds whether the first one is gone.

**Backup agent.** The agent holds a lease of 60 seconds (`ARKVORY_BACKUP_LEASE_SECONDS`) and renews it every 20 seconds. After a crash another agent, or the restarted one, takes the lease when it expires, so a backup waits up to a minute. The interrupted job runs again with the same key, up to 5 times. A new capture releases the locks of a dead one. The warning `agent_offline` appears after 2 minutes without a heartbeat. During an update the installer stops the agent first, and the running backup ends as `interrupted` and is queued again.

**Rate limits.** The sign-in counters per address live in the process and reset at a restart. The backoff of an account is in the database and stays.

## Checks at start {#startup-checks}

Each process checks its environment before it serves. A failed check ends the process with exit code 1 and one line `startup.failed` (API) or `worker.unavailable` (worker). `reason` names the cause without secrets.

| Process      | What is checked                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API          | Every setting has a valid value; the message names the variable, never its value. The key file reads as JSON up to 1 MiB. Built-in TLS: the certificate and the key read, match and have not expired; there is no fallback to HTTP. The storage directory is writable. The database answers and has every migration of this release and none from a newer one. The file `storage-id` in the storage directory equals the identity stored in the database. No other writer holds the database |
| Worker       | The same settings, the database, the storage identity, and the lock of the single worker. A second worker waits as standby                                                                                                                                                                                                                                                                                                                                                                   |
| Backup agent | The storage identity, the schema number, and that the vault does not overlap the storage directory. A missing or unmounted vault is not fatal. The agent reports it as a warning                                                                                                                                                                                                                                                                                                             |

After an update the installer waits for three successful readiness answers in a row and for a running worker. It then waits about 90 seconds for the heartbeat of the backup agent. A missing agent is only a warning and never rolls an update back.

## What still needs you {#operator}

Self-healing covers failures of a process. These need an operator:

- **A permanent fault.** A wrong setting, an unreachable database, a full disk or wrong permissions make the service restart every 10 seconds without success. Read `startup.failed` and fix the cause. See [Troubleshooting](./troubleshooting).
- **A failed update.** An interrupted update keeps its lock and its journal until you run `recover`.
- **Damaged backups.** `verify_failed` and `vault_unavailable` need a person. The agent keeps the vault unchanged.
- **Certificates.** Arkvory reads renewed certificate files without a restart (every 300 seconds by default), but your tools must renew them.
- **A stopped service.** A service that you stopped stays stopped.
- **The platform.** Docker must start at boot. PostgreSQL major versions, Node.js and the operating system are updated by you.
- **A lost server or disk.** There is no failover. Restore from a backup. See [Backups](./backups).

## Related pages {#related-pages}

- [Monitoring](./monitoring)
- [Troubleshooting](./troubleshooting)
- [Windows](../install/windows)
- [Environment variables](../reference/environment)
