---
title: Read gateways
description: Run extra download-only API processes on the same server and storage, share one download budget between them and monitor them.
---

# Read gateways

A **read gateway** is an extra API process that serves downloads only. It runs on the same server as the main API (the **writer**), uses the same PostgreSQL database and the same storage directory, and shares one download budget with the writer and the other gateways.

Use gateways to spread many parallel downloads over several processes while the total download rate stays under one limit that you set. A gateway does not copy data. It reads the files that the writer published, so a gateway never lags behind. It also does not protect you from the loss of the server or of the disk. For that, see [Backups](./backups) and [Mirrors](./mirrors).

## How it works {#how-it-works}

- The installation has one writer and up to 15 read gateways. Together they are at most 16 **slots**. The writer always uses slot 0. Each gateway uses its own slot from 1 to the number of slots minus one.
- All processes use one PostgreSQL database and one storage directory. A gateway checks that the storage exists and belongs to the database. It never creates it.
- You set one total download rate for all processes. Each process gets an equal fixed share: the total divided by the number of slots, rounded down.
- A process holds its slot with a lease in the database. If it loses the lease, it stops serving new payload and must be restarted. This keeps the sum of all shares under the total.

The writer keeps its normal job. It takes uploads, the console, the background cleanup and all changes. A gateway never runs cleanup.

## What a gateway refuses {#refusals}

A gateway accepts only `GET` and `HEAD`. Every request that changes something gets HTTP 405 with the header `Allow: GET, HEAD` and the code `read_only`, even when the key has write rights. This includes sign-in and self-registration. The console is part of the writer only, so it is not available on a gateway.

Repository permissions are checked on every read, as on the writer. Sessions, personal tokens and service keys work on a gateway for reading.

## Requirements {#requirements}

- **The same server.** The gateway must see exactly the files that the writer published, without a delay. Independent disks with `rsync` or another asynchronous copy do not fit. No network file system is certified yet, so use gateways for several processes on one server.
- **The same service keys.** Give every process the same `ARKVORY_KEYS_FILE` content, so the file keys and their IDs match. Managed service keys live in the database, so they match by themselves.
- **Own port.** Every process on the same host needs its own `ARKVORY_PORT`.
- **A read-only view of the files.** Where you can, mount the storage directory read-only for the gateway. The HTTP refusal does not replace operating system rights. Note that the gateway still writes to the database: leases, storage diagnostics, the last-use time of personal tokens and the locks that protect files being read.
- **Database connections.** Every gateway needs one more connection than `ARKVORY_DATABASE_POOL_SIZE`. Count them in `max_connections` of PostgreSQL.

## Run a gateway {#run}

The installers register the API, the worker and the backup agent. They do not register a gateway, and `arkvory status` does not manage it. You start a gateway yourself, as one more instance of the API program of the installed release, with its own environment and under your own service manager.

Settings that are the same for all processes, for two processes in total with 64 MiB/s overall and 16 MiB/s for one account or key:

```dotenv
ARKVORY_GATEWAY_SLOTS=2
ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND=67108864
ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL=16777216
```

The writer adds:

```dotenv
ARKVORY_ROLE=api
ARKVORY_GATEWAY_SLOT=0
```

A gateway adds:

```dotenv
ARKVORY_ROLE=reader
ARKVORY_GATEWAY_SLOT=1
ARKVORY_PORT=8081
```

The gateway needs the rest of the API settings too: `ARKVORY_DATABASE_URL` of the same database, `ARKVORY_DATA_DIR` that leads to the same storage (the path may differ, the storage identity must match), `ARKVORY_KEYS_FILE`, and the HTTPS settings if the gateway is reachable from other computers. See [Environment variables](../reference/environment#read-gateways).

| Variable                                                 | Rule                                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_GATEWAY_SLOTS`                                  | The number of processes including the writer, 2–16                                                                |
| `ARKVORY_GATEWAY_SLOT`                                   | The slot of this process, from 0 to the number of slots minus one. The writer is 0, a gateway is not 0            |
| `ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND`               | Required. The total rate of all processes, at least 65 536 times the number of slots, at most 1 TiB per second    |
| `ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL` | The total rate for one account or key across all processes. `0` means no limit. Otherwise the same range as above |

If you set any of these variables, set the slot, the number of slots and the total rate on every process. An invalid value stops the process at startup with a message that names the variable. A gateway without a shared download configuration refuses to start.

1. Decide the number of slots and the rates.
2. Add the three common variables and the writer's own two variables to the writer, and restart the writer. It saves the policy in the database.
3. Start the gateway with its own variables. If its numbers differ from the saved policy, it does not start.
4. Check the readiness of every process, and test a range download on each one. See [Monitor gateways](#monitoring).
5. Only then add the gateway to your load balancer.

Some rules protect the profile:

- A gateway can start only after the writer saved the policy.
- Once the policy exists in the database, a writer without these variables does not start. It stops with the message that the database requires the shared download configuration.
- You cannot change the rates or the number of slots on a running installation. See [Change the configuration](#change).

## The download budget {#budget}

Each process gets `total / slots`, rounded down. The same applies to the rate for one account or key. For example, with 64 MiB/s and 2 slots, each process serves up to 32 MiB/s, and one account gets up to 8 MiB/s in each process.

- A process cannot use the share of another. If one of two processes is stopped, you get half of the total. This keeps the limit simple and checkable.
- The local settings `ARKVORY_DOWNLOAD_BYTES_PER_SECOND` and `ARKVORY_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL` can lower a share, not raise it.
- The upload budgets stay on the writer, because gateways take no uploads.
- The queue of waiting transfers and the limit of active transfers stay local to each process, so the capacities of all processes add up.

The limit applies to the payload of the application, with a small burst. It is not a limit on the network interface. See [Environment variables](../reference/environment#transfers-and-bandwidth).

## Leases and failures {#leases}

The database reserves a slot for 10 seconds. A process renews it every 2 seconds, and it trusts the lease locally for at most 8 seconds. A lease whose time has run out is never revived, even when a late reply arrives.

- **Lease lost.** The process stops giving out new payload, answers new authorized requests with 503 and needs a restart. A download that was cut can continue with a retry or a range request. This applies to the writer too.
- **Restart of the same slot.** The new process waits until the old reservation expires, up to 10 seconds after its last renewal, and up to 15 seconds in total. If a running gateway still holds the slot, the new process stops with `busy`.
- **Clocks.** The leases rely on steady clocks. A jump of the clock of the database server, or a stopped virtual machine, can leave a process serving beyond its lease. Stop the old processes before you start a replacement in such a case.
- **Database failure.** The database is the weak point. If it becomes unreachable, the leases expire and all processes stop serving payload.

The server can notice a dead process that lost its network only through TCP keepalive. Set `tcp_keepalives_idle`, `tcp_keepalives_interval` and `tcp_keepalives_count` on PostgreSQL, for example to 10, 5 and 3 seconds, or set `tcp_user_timeout`. Without them, a new writer or worker may wait for the long default timeout of the operating system.

## Monitor gateways {#monitoring}

- `GET /health/status` is public and returns only `ready`, `unavailable` or `draining`, with 503 when the process cannot serve (lost slot or lease, draining). Use it for your load balancer.
- `GET /health/ready` needs a key. It returns `role`, `writable` (always `false` on a gateway), `sharedDownloads` with `slot`, `slots`, `active` and `leaseSeconds`, and the numbers of the local transfer queues. It answers 503 when the slot is lost. For a standalone installation, `sharedDownloads` is `null`.
- `GET /health/live` shows only that the HTTP process runs. It does not tell whether a gateway can serve.
- `GET /health/metrics` of each process shows that process only. Scrape every gateway and use the process-level HTTP and transfer metrics.

Check each process separately. A gateway with `writable` false is normal. See [Monitoring](./monitoring).

## Route requests {#routing}

The load balancer is yours. Arkvory ships no balancer.

- Send every request that changes data, and `/console/`, to the writer.
- You can spread the byte reads between the writer and the gateways: `GET` and `HEAD` for `/api/v1/repositories/NAME/artifacts/ID/content`, for `.../packages/content` and for `.../asset/content`. Keep the other requests on the writer.
- Pass the `Authorization`, `Range`, `If-Range` and `ETag` headers. Stream the body without buffering the whole file. Do not redirect a client to a URL that carries a key.
- Add a backend to the balancer only when its authenticated readiness is ok.

The TypeScript SDK can continue an interrupted download through another healthy backend behind the same address. A running TCP connection does not move between servers.

## Change the configuration {#change}

You cannot change the rates or the number of slots while the installation runs, and you cannot go back to a single process while the policy exists. Even if all gateways are stopped, the saved policy prevents a start without limits.

1. Stop incoming traffic. Stop the writer, every gateway and the worker, and confirm that they are really stopped.
2. Wait until the leases in the database have expired.
3. Make a backup. See [Backups](./backups).
4. An administrator of the Arkvory database deletes all rows of the tables `arkvory_gateway_leases` and `arkvory_download_policy` in one transaction. This resets only the coordination state, not the catalog.
5. Start the writer with the new settings, then the gateways.

Never do this while any process may still run.

An update needs the same care. Stop every gateway before the installation updates, and start them from the new release afterwards. A gateway that keeps running old code against a newer database schema reports itself as not ready. The offline repair tools for cleanup need all gateways stopped too. The online cleanup of the writer does not.

## Gateways or mirrors {#gateways-or-mirrors}

|                                        | Read gateways                                      | Mirrors                                                              |
| -------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| What it is                             | More API processes on the same server and storage  | A second, independent installation with a copy of the data           |
| Data                                   | One copy, read live                                | A second copy, pulled with a delay                                   |
| Accounts and keys                      | The same as the writer                             | Its own                                                              |
| Extra disk                             | None                                               | Yes, as much as the repositories need                                |
| Needs                                  | The same database and the same file system         | An HTTPS link to the source and a read-only key                      |
| Protects against a lost server or disk | No                                                 | Partly: it serves while the source is down, and you can switch to it |
| Use it for                             | More parallel downloads with one shared rate limit | A second site, an office closer to the users, a standby              |

Both are additions to backups, not replacements.

## Limits {#limits}

- All processes must share one server and one storage directory. Different machines need a file system that was tested for this, and none has been tested yet.
- There is no installer support, no automatic failover and no built-in balancer.
- One database and one writer remain a single point of failure.
- The budget is fixed per slot and is not redistributed, and there is no priority scheduling.
- You cannot change the policy on a running installation.

## Related pages {#related-pages}

- [Mirrors](./mirrors)
- [Monitoring](./monitoring)
- [Self-healing](./self-healing)
- [Environment variables](../reference/environment#read-gateways)
- [Updates](../install/updates)
