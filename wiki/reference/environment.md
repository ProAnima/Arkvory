---
title: Environment variables
---

# Environment variables

Arkvory is configured with environment variables whose names start with `ARKVORY_`. This page lists every variable that the server processes, the command-line client and the installer scripts read.

## Where the values come from {#where-the-values-come-from}

The installers write the server settings into one file, `config/runtime.json`, in the installation root. The launcher of each service reads this file and passes its values to the API, the worker and the backup agent. Each key must start with `ARKVORY_`, and each value must be a string.

```json
{
  "ARKVORY_HOST": "127.0.0.1",
  "ARKVORY_PORT": "8080",
  "ARKVORY_CAPACITY_BYTES": "10995116277760",
  "ARKVORY_DATABASE_URL": "postgresql://arkvory:PASSWORD@127.0.0.1:54329/arkvory",
  "ARKVORY_DATA_DIR": "/opt/proanima-arkvory/data",
  "ARKVORY_KEYS_FILE": "/opt/proanima-arkvory/config/keys.json",
  "ARKVORY_MAX_DOWNLOADS": "32"
}
```

The file contains the database password. Keep its access rights as the installer set them.

To change a setting, edit `config/runtime.json` and restart the services. Prefer the `arkvory configure` command where it covers the setting (HTTPS, backup vault, mirrors, updates). It checks the change and restores the old file when the services do not start. See [Configuration](../install/configuration).

```bash
sudo systemctl restart arkvory-api arkvory-worker arkvory-backup
```

```powershell
Restart-Service Arkvoryapi, Arkvoryworker, Arkvorybackup
```

A value outside its allowed range stops the process at startup with a message that names the variable. Arkvory does not fall back to a default in that case.

The "Read by" column uses these names: **API** is the HTTP server (also a read gateway), **worker** is the background worker, **agent** is the backup agent, **CLI** is `arkvoryctl`.

## Core {#core}

| Variable                     | Read by                       | Default           | Meaning                                                                                                                                                      |
| ---------------------------- | ----------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ARKVORY_DATABASE_URL`       | API, worker, agent, migration | required          | PostgreSQL connection URL (`postgres://` or `postgresql://`). Use a separate database for each installation.                                                 |
| `ARKVORY_DATA_DIR`           | API, worker, agent            | required          | Local storage directory: staging, content and the `storage-id` file. Do not use a network share.                                                             |
| `ARKVORY_HOST`               | API                           | `127.0.0.1`       | Address to listen on. Installers write `127.0.0.1`; in Docker Compose it is `0.0.0.0` inside the container, and the port is published on host loopback only. |
| `ARKVORY_PORT`               | API                           | `8080`            | TCP port, 1–65535.                                                                                                                                           |
| `ARKVORY_WEB_DIR`            | API                           | `apps/web/public` | Directory with the web console files. The launcher sets it to the current release on every start.                                                            |
| `ARKVORY_DATABASE_POOL_SIZE` | API                           | `10`              | Size of the API connection pool, 4–200. Up to three connections are always in use.                                                                           |

## Storage and limits {#storage-and-limits}

| Variable                        | Read by            | Default      | Meaning                                                                                                                                                                                |
| ------------------------------- | ------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_CAPACITY_BYTES`        | API, worker        | 10 TiB       | Upper limit, in bytes, for all reserved content: published, unfinished uploads and content that waits for cleanup. It is not a disk check. The worker reads it only for mirror copies. |
| `ARKVORY_STORAGE_RESERVE_BYTES` | API, worker, agent | `1073741824` | Free space, in bytes, that uploads never use. It is kept for the database, logs and the system. `0` turns the reserve off.                                                             |
| `ARKVORY_MAX_OBJECT_BYTES`      | API                | about 10 TiB | Largest object, in bytes. The highest allowed value is 10 000 parts of 1 GiB. Set a lower value to limit file size.                                                                    |

## Transfers and bandwidth {#transfers-and-bandwidth}

These limits belong to one API process. Rates are in bytes per second: `0` means no limit, any other value must be from 65 536 to 1 TiB.

| Variable                                          | Read by | Default   | Meaning                                                                                                                                                                                              |
| ------------------------------------------------- | ------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_MAX_UPLOADS`                             | API     | `2`       | Uploads that run at the same time, 1–32.                                                                                                                                                             |
| `ARKVORY_MAX_DOWNLOADS`                           | API     | `16`      | Downloads that run at the same time, 1–256.                                                                                                                                                          |
| `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`               | API     | `1`       | Uploads of one account or key at the same time, up to the total upload limit.                                                                                                                        |
| `ARKVORY_MAX_DOWNLOADS_PER_PRINCIPAL`             | API     | `4`       | Downloads of one account or key at the same time, up to the total download limit.                                                                                                                    |
| `ARKVORY_TRANSFER_QUEUE_LIMIT`                    | API     | `64`      | Transfers that may wait for a free slot, 1–1024.                                                                                                                                                     |
| `ARKVORY_TRANSFER_QUEUE_PER_PRINCIPAL`            | API     | `8`       | Waiting transfers of one account or key, up to the queue limit.                                                                                                                                      |
| `ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS`               | API     | `20000`   | How long a transfer may wait in the queue, 1–120 000 ms.                                                                                                                                             |
| `ARKVORY_MAX_REQUESTS`                            | API     | `128`     | Authenticated requests at the same time, 1–4096. It must be greater than uploads plus downloads. When it is not set and the transfer limits are high, the default is uploads plus downloads plus 64. |
| `ARKVORY_UPLOAD_BYTES_PER_SECOND`                 | API     | `0`       | Total upload rate of the process.                                                                                                                                                                    |
| `ARKVORY_DOWNLOAD_BYTES_PER_SECOND`               | API     | `0`       | Total download rate of the process.                                                                                                                                                                  |
| `ARKVORY_UPLOAD_BYTES_PER_SECOND_PER_PRINCIPAL`   | API     | `0`       | Upload rate of one account or key, across all its connections.                                                                                                                                       |
| `ARKVORY_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL` | API     | `0`       | Download rate of one account or key, across all its connections.                                                                                                                                     |
| `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`                  | API     | `30000`   | An upload request that sends no data for this time is stopped, 1–1 800 000 ms.                                                                                                                       |
| `ARKVORY_UPLOAD_DEADLINE_MS`                      | API     | `1800000` | Longest time for one upload request, 1–1 800 000 ms. It cannot be shorter than the idle timeout.                                                                                                     |

## Network, HTTPS and browsers {#network-https-and-browsers}

| Variable                     | Read by | Default   | Meaning                                                                                                                                                                                                                                                      |
| ---------------------------- | ------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ARKVORY_TLS_CERT_FILE`      | API     | not set   | PEM certificate (with its chain) for built-in HTTPS. Set it together with the key file.                                                                                                                                                                      |
| `ARKVORY_TLS_KEY_FILE`       | API     | not set   | PEM private key without a password.                                                                                                                                                                                                                          |
| `ARKVORY_TLS_MIN_VERSION`    | API     | `TLSv1.2` | `TLSv1.2` or `TLSv1.3`.                                                                                                                                                                                                                                      |
| `ARKVORY_TLS_RELOAD_SECONDS` | API     | `300`     | How often renewed certificate files are read: 30–86 400 seconds, or `0` to read them only at startup.                                                                                                                                                        |
| `ARKVORY_CORS_ORIGINS`       | API     | empty     | Comma-separated list of up to 16 browser origins, for a console on another address. HTTPS only, or HTTP on loopback.                                                                                                                                         |
| `ARKVORY_TRUSTED_PROXIES`    | API     | empty     | Up to 32 reverse proxy addresses (IP or CIDR). Only these may set the client address with `X-Forwarded-For`, the request ID with `X-Request-Id`, and the host and protocol of absolute links (Git LFS, npm) with `X-Forwarded-Host` and `X-Forwarded-Proto`. |

Built-in HTTPS is for native installations. With Docker Compose, use a reverse proxy. See [HTTPS](../install/https).

## Identity and keys {#identity-and-keys}

| Variable                     | Read by     | Default  | Meaning                                                                                                                |
| ---------------------------- | ----------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_KEYS_FILE`          | API, worker | required | JSON file with file keys, such as the recovery key and the health check key. It stores SHA-256 hashes, never the keys. |
| `ARKVORY_ALLOW_REGISTRATION` | API         | off      | `true` lets people create their own accounts on the sign-in page. Any other value keeps it off.                        |

## Backups {#backups}

| Variable                          | Read by         | Default  | Meaning                                                                                                                                              |
| --------------------------------- | --------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_BACKUP_VAULT`            | agent           | not set  | Directory of an initialized vault. Without it, the agent runs and reports that no vault is configured. `arkvory configure --backup-vault` writes it. |
| `ARKVORY_BACKUP_BYTES_PER_SECOND` | agent           | no limit | Copy rate limit of a backup, at least 65 536.                                                                                                        |
| `ARKVORY_BACKUP_POLL_SECONDS`     | agent           | `15`     | How often the agent checks for new backup jobs, 1–3600 seconds.                                                                                      |
| `ARKVORY_BACKUP_LEASE_SECONDS`    | agent           | `60`     | Lease time that keeps a second agent from running at the same time, 2–3600 seconds.                                                                  |
| `ARKVORY_BACKUP_SNAPSHOT_SECONDS` | agent           | `1800`   | Time limit for the database snapshot part of a backup, 60–86 400 seconds.                                                                            |
| `ARKVORY_BACKUP_BARRIER_SECONDS`  | agent           | `30`     | How long a backup waits for a running cleanup step, 1–600 seconds.                                                                                   |
| `ARKVORY_RESTORE_DATABASE_URL`    | restore command | not set  | Target database of a restore. It is safer than `--database-url`, because other users cannot see it in the process list.                              |

See [Backups](../operate/backups).

## Mirrors {#mirrors}

| Variable                  | Read by     | Default | Meaning                                                                                                        |
| ------------------------- | ----------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_MIRRORS_FILE`    | API, worker | not set | JSON file that lists mirrored repositories (up to 64). `arkvory configure --mirror` writes it.                 |
| `ARKVORY_MIRRORS_CA_FILE` | worker      | not set | Absolute path to a PEM file with extra certificate authorities for the source servers. TLS is always verified. |

See [Mirrors](../operate/mirrors).

## Webhooks {#webhooks}

| Variable                         | Read by | Default | Meaning                                                                                                                                |
| -------------------------------- | ------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_WEBHOOKS_FILE`          | worker  | not set | JSON file that lists webhook subscriptions (up to 16). Without it, no webhooks are sent.                                               |
| `ARKVORY_WEBHOOKS_ALLOW_PRIVATE` | worker  | not set | Networks in CIDR form, separated by commas (up to 32), that may receive webhooks besides public addresses, for example `10.20.0.0/16`. |
| `ARKVORY_WEBHOOKS_CA_FILE`       | worker  | not set | Absolute path to a PEM file with extra certificate authorities for the receivers. TLS is always verified.                              |

See [Webhooks](../protocols/webhooks).

## Updates and the hub {#updates-and-the-hub}

| Variable                     | Read by | Default                    | Meaning                                                                                                                                                                                                                       |
| ---------------------------- | ------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_HUB_URL`            | API     | `https://hub.proanima.net` | Address of the ProAnimaStudio hub, used by console feedback only (the update hub is stored in `config/hub.json` and is changed with `arkvory configure`). An empty value turns feedback off. HTTPS only, or HTTP on loopback. |
| `ARKVORY_HUB_PROJECT`        | API     | `arkvory`                  | Project name at the hub.                                                                                                                                                                                                      |
| `ARKVORY_UPDATE_CONTROL_DIR` | API     | not set                    | Directory that the API shares with the host updater. Installers set it. Without it, the console cannot request updates.                                                                                                       |

See [Updates](../install/updates).

## Logging and shutdown {#logging-and-shutdown}

| Variable                   | Read by            | Default | Meaning                                                                   |
| -------------------------- | ------------------ | ------- | ------------------------------------------------------------------------- |
| `ARKVORY_LOG_LEVEL`        | API, worker, agent | `info`  | `debug`, `info`, `warning` or `error`.                                    |
| `ARKVORY_ACCESS_LOG`       | API                | `true`  | `true` writes one JSON line for each HTTP request; `false` turns it off.  |
| `ARKVORY_DRAIN_TIMEOUT_MS` | API                | `30000` | After a stop signal, time for running requests to finish, 0–3 600 000 ms. |

## Read gateways {#read-gateways}

When any of these variables is set, the slot, the number of slots and the shared rate are required. The writer uses role `api` and slot `0`. Each read gateway uses role `reader` and its own slot. See [Read gateways](../operate/read-gateways).

| Variable                                                 | Read by | Default | Meaning                                                                                                |
| -------------------------------------------------------- | ------- | ------- | ------------------------------------------------------------------------------------------------------ |
| `ARKVORY_ROLE`                                           | API     | `api`   | `api` (the writer) or `reader` (a read gateway).                                                       |
| `ARKVORY_GATEWAY_SLOTS`                                  | API     | not set | Number of processes that share the download budget, 2–16.                                              |
| `ARKVORY_GATEWAY_SLOT`                                   | API     | not set | Slot of this process, from `0` to slots minus one.                                                     |
| `ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND`               | API     | not set | Total download rate of all processes. Each slot gets an equal share, at least 65 536 bytes per second. |
| `ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL` | API     | `0`     | Total download rate of one account or key across all processes; `0` means no limit.                    |

## Watchdog {#watchdog}

| Variable                   | Read by            | Default | Meaning                                                                                                                                                        |
| -------------------------- | ------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_WATCHDOG_SECONDS` | API, worker, agent | `60`    | A process that stays blocked for this time ends itself, and the service manager starts it again. `0` turns it off (for a debugger); otherwise 10–3600 seconds. |

See [Self-healing](../operate/self-healing).

## Command-line client {#command-line-client}

| Variable              | Read by | Default                               | Meaning                                                                      |
| --------------------- | ------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| `ARKVORY_BASE_URL`    | CLI     | profile, then `http://127.0.0.1:8080` | Server address. When it is set, the key must also come from the environment. |
| `ARKVORY_TOKEN`       | CLI     | not set                               | The key itself. It has priority over a key file.                             |
| `ARKVORY_TOKEN_FILE`  | CLI     | profile key file                      | Path to a file that contains the key.                                        |
| `ARKVORY_CLI_HOME`    | CLI     | `~/.config/arkvory`                   | Directory of the `profiles.json` file.                                       |
| `ARKVORY_CLI_VERSION` | CLI     | `development`                         | Version that `--version` prints. Release packages contain it.                |

See [Command-line client](../protocols/cli).

## Installer scripts {#installer-scripts}

These variables are read by `install.sh` on Linux. On Windows, `install.ps1` uses parameters such as `-Root` and `-Artifact` instead.

| Variable                  | Default                 | Meaning                                                                                    |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| `ARKVORY_INSTALL_ROOT`    | `/opt/proanima-arkvory` | Installation root. Do not place a native installation in a home directory.                 |
| `ARKVORY_ARTIFACT_DIR`    | not set                 | Directory of an unpacked release. The script installs it instead of downloading a release. |
| `ARKVORY_RELEASE_VERSION` | latest stable           | Exact stable version to install, such as `1.2.3`.                                          |

## Set by the installer {#set-by-the-installer}

The installer sets these variables for its own helper processes. Do not set them yourself.

| Variable                  | Meaning                                                                       |
| ------------------------- | ----------------------------------------------------------------------------- |
| `ARKVORY_IMAGE`           | Container image of the current release, in `config/compose.env`.              |
| `ARKVORY_SERVICE_WRAPPER` | Path to the Windows backup service wrapper, used when the service is stopped. |
| `ARKVORY_PROTECT_ROOT`    | Installation root whose access rules are set on Windows.                      |
| `ARKVORY_ENGINE_USER`     | On Windows with Docker Desktop, gives the current user access to the root.    |

## Related pages {#related-pages}

- [Configuration](../install/configuration)
- [Monitoring](../operate/monitoring)
- [Security](../operate/security)
- [Storage](../operate/storage)
