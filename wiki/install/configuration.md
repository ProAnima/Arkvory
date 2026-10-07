---
title: Configuration
description: Where the Arkvory configuration lives, which lifecycle commands change it, the main settings by task, and how to apply a change.
---

# Configuration

Arkvory has two kinds of settings:

- **Server settings** are `ARKVORY_*` variables in the file `config/runtime.json`. They set the address, the limits, the storage and similar things. The API, the worker and the backup agent read them when they start.
- **Installation policy** is the update policy, the HTTPS files, the backup vault and the mirrors. You change it with the command `arkvory configure`. The command checks the change, restarts what it must and restores the old state when the services do not start.

This page shows where the files are, which commands exist and how the main settings work. The complete list of variables, with defaults and ranges, is in [Environment variables](../reference/environment).

## Where the configuration lives {#where-it-lives}

The installation root holds everything. It is `C:\ProgramData\ProAnima\Arkvory` on Windows and `/opt/proanima-arkvory` on Linux. A Compose installation uses the same root on the host. Paths below are relative to the root.

| File                                                                           | Content                                                                                                         | Change it                                                 |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `config/runtime.json`                                                          | The server settings. Keys start with `ARKVORY_`, and every value is a string. It contains the database password | By hand, or with `configure`                              |
| `config/keys.json`                                                             | SHA-256 hashes of the recovery key and of the readiness key. It never contains a key                            | Only to [replace the recovery key](#replace-recovery-key) |
| `config/bootstrap-token.txt`                                                   | The recovery key                                                                                                | Only to replace it                                        |
| `config/health-token.txt`                                                      | The key that the installation tools use for the readiness check                                                 | Do not change                                             |
| `config/hub.json`                                                              | The hub address, the update channel and the statistics setting                                                  | With `configure`                                          |
| `config/install-id`                                                            | A random installation ID, sent to the hub only with statistics on                                               | Do not change                                             |
| `config/mirrors/`                                                              | The mirror list and the keys the worker uses for the sources                                                    | With `configure --mirror`                                 |
| `config/webhooks/`                                                             | The subscription list, the signing secrets and the authorities of receivers that the worker uses                | With `configure --webhook`                                |
| `installation.json`                                                            | The mode, the engine, the automatic update setting, the version pin and the installed release                   | Only with commands                                        |
| `github-token.txt`                                                             | Optional GitHub token for release downloads. See [Updates](./updates#hub-unreachable)                           | By hand                                                   |
| `config/compose.env`, `config/compose.vault.yml`, `config/compose.mirrors.yml` | Compose only: the image, the vault mount and the mirror mount                                                   | Only with commands                                        |

On a native Linux installation, `runtime.json` and `keys.json` are `root:arkvory` with mode `0640`, and the credential files in `config/` are readable only by `root`. A Compose installation uses mode `0644` for the files that the containers read: see [Docker Compose](./docker#owners). Keep the owners and modes the installer set.

## Lifecycle commands {#lifecycle-commands}

All commands need administrator rights and the option `--root` with the installation root.

| Installation                 | How to run a command                                                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux package                | `sudo arkvory <command> --root /opt/proanima-arkvory`                                                                                                     |
| Windows, graphical installer | In an elevated PowerShell: `& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' <command> --root C:\ProgramData\ProAnima\Arkvory`                           |
| Script installation, Compose | `sudo <root>/runtime/node-v24.21.0-linux-x64/bin/node <root>/manage.mjs <command> --root <root>`. On Windows use `runtime\node-v24.21.0-win-x64\node.exe` |

`arkvory help` lists the commands without special rights. The examples on this site use the short form `arkvory <command>`.

| Command                         | Use                                                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `status`                        | Shows the installation mode, the engine, the automatic update setting, the pin and the installed release                      |
| `configure`                     | Changes a policy. See [The configure command](#configure-command)                                                             |
| `update`                        | Installs a newer stable release now. See [Updates](./updates)                                                                 |
| `upgrade`                       | Installs a release that changes the database schema with a backup record of your own. See [Updates](./updates#manual-upgrade) |
| `recover`                       | Finishes an interrupted update. See [Updates](./updates#recover-update)                                                       |
| `finish-install`                | Continues an interrupted first installation                                                                                   |
| `updates-connect`               | Connects the console and the update timer, and registers services that an old installation lacks                              |
| `updates-poll`, `updates-reset` | Run by the update timer and for recovery. See [Updates](./updates#recover-update)                                             |

Only one command runs at a time. A second command stops with `Installation is locked`. Never put a key or a password in a command option: use files.

### The configure command {#configure-command}

One call changes one kind of setting. The five kinds cannot be mixed in one call.

| Kind         | Options                                                                                                                                                                                                                                  | Effect                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| HTTPS        | `--tls-cert FILE --tls-key FILE [--listen-host ADDRESS]`, or `--tls-off [--listen-host ADDRESS]`                                                                                                                                         | Turns built-in HTTPS on or off. Restarts the services and checks readiness. See [HTTPS](./https)                                    |
| Backup vault | `--backup-vault DIRECTORY [--init-vault]`, or `--backup-vault-off`                                                                                                                                                                       | Connects or disconnects the vault. Restarts the backup agent only. See [Backups](../operate/backups)                                |
| Mirrors      | `--mirror REPOSITORY --mirror-upstream URL --mirror-token-file FILE [--mirror-source REPOSITORY] [--mirror-stages LIST] [--mirror-ca-file FILE]`, or `--mirror-detach REPOSITORY`                                                        | Makes a repository a mirror or an import target, or ordinary again. See [Mirrors](../operate/mirrors)                               |
| Webhooks     | `--webhook ID --webhook-repository REPOSITORY --webhook-url URL --webhook-secret-file FILE [--webhook-next-secret-file FILE] [--webhook-actions LIST] [--webhook-allow-private LIST] [--webhook-ca-file FILE]`, or `--webhook-detach ID` | Adds, replaces or removes a webhook subscription. Restarts the services and checks readiness. See [Webhooks](../protocols/webhooks) |
| Updates      | `--enable-updates`, `--disable-updates`, `--pin [--version X.Y.Z]`, `--unpin`, `--update-channel stable` or `beta`, `--statistics on` or `off`, `--hub-url URL`, `--hub-off`                                                             | Changes the update policy. See [Updates](./updates)                                                                                 |

HTTPS, vault and mirror changes restart services and restore the previous configuration when the change does not work. Update options only rewrite `installation.json` and `hub.json`; they restart nothing. File paths are absolute.

## Settings by task {#settings-by-task}

### Address and port {#address-and-port}

| Variable       | Default     | Meaning                        |
| -------------- | ----------- | ------------------------------ |
| `ARKVORY_HOST` | `127.0.0.1` | The address the API listens on |
| `ARKVORY_PORT` | `8080`      | The TCP port                   |

With the default, only programs on the server can connect. To accept other computers, choose one of two ways:

- **Built-in HTTPS.** `arkvory configure --tls-cert … --tls-key … --listen-host 0.0.0.0`. See [HTTPS](./https#built-in-tls).
- **A reverse proxy on another computer.** Set `ARKVORY_HOST` to the address of the network interface for the proxy and list the proxy in `ARKVORY_TRUSTED_PROXIES`. Edit `runtime.json`, or run `arkvory configure --tls-off --listen-host <address>`. Restrict the port with a firewall to the proxy.

`--listen-host` alone is refused: use it with the TLS files or with `--tls-off`. After `--tls-off`, add `--listen-host 127.0.0.1` to return to loopback, or the API keeps listening on the address that is set.

When the API listens on a non-loopback address without TLS and without a trusted proxy, it logs the warning `http.plaintext_exposed` at start. Never send keys over plain HTTP between computers.

On Linux the services run as an unprivileged account, which cannot normally listen on a port below 1024. The shortcuts to the console (Start menu, menu entry) keep pointing at port 8080. The lifecycle commands follow the address and the port in `runtime.json`. In a Compose installation the address and the port are fixed: see [Docker Compose](./docker#ports).

### Public address and forwarded headers {#public-address}

There is no setting for a public URL. The server builds absolute links, such as the links in Git LFS and npm answers, from the request: the scheme is `https` when the connection is TLS or when the proxy sends `X-Forwarded-Proto: https`, and the host is the `Host` header. A proxy listed in `ARKVORY_TRUSTED_PROXIES` can also set the host with `X-Forwarded-Host`. Your proxy must therefore forward the public name. See [HTTPS](./https#reverse-proxy).

`ARKVORY_TRUSTED_PROXIES` takes up to 32 addresses or CIDR ranges, separated by commas. Only these peers can set the client address with `X-Forwarded-For` and the request ID with `X-Request-Id`. Without the list, every client appears to come from the address of the proxy, and the sign-in limit counts them as one.

### Browsers on another address {#browsers}

`ARKVORY_CORS_ORIGINS` lists up to 16 origins of a console or another web application that runs on a different address, separated by commas. Each origin has a scheme, a host and an optional port, and no path. It must use HTTPS; plain HTTP is accepted only for `localhost`, `127.0.0.1` and `[::1]`. See [HTTPS](./https#console-api-address). `ARKVORY_ALLOW_REGISTRATION=true` lets people create their own accounts on the sign-in page; it is off by default.

### Database {#database}

| Variable                     | Default              | Meaning                                                                        |
| ---------------------------- | -------------------- | ------------------------------------------------------------------------------ |
| `ARKVORY_DATABASE_URL`       | set by the installer | The PostgreSQL connection URL. A managed database listens on `127.0.0.1:54329` |
| `ARKVORY_DATABASE_POOL_SIZE` | `10`                 | The size of the API connection pool, from 4 to 200                             |

Do not point an installation at another database. The stored files and the catalog belong together. Moving to a new database is a restore from a backup: see [Backups](../operate/backups). For an external PostgreSQL, set `max_connections` high enough for the API pool, one connection per concurrent upload for write locks, 5 for the worker and the connections of the backup agent.

### Storage directory and free space {#storage}

| Variable                        | Default       | Meaning                                                                                           |
| ------------------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| `ARKVORY_DATA_DIR`              | `<root>/data` | Where file content is stored. Set by the installer. Use a local disk                              |
| `ARKVORY_CAPACITY_BYTES`        | 10 TiB        | The most that all reserved content may use. It is a limit on reservations, not a disk measurement |
| `ARKVORY_STORAGE_RESERVE_BYTES` | 1 GiB         | Free space that uploads never use. `0` turns the reserve off                                      |
| `ARKVORY_MAX_OBJECT_BYTES`      | about 10 TiB  | The largest single object. Set a lower value to limit the file size                               |

Keep `ARKVORY_DATA_DIR` where the installer put it. The Linux units can write only to `data/`, `logs/` and `updates/inbox/` of the root, so another path is read-only for them. To use a bigger disk, stop the services, copy the content to the new disk, mount the disk at `data/` with the owner `arkvory`, and start the services. On Windows and Linux you can also choose the root itself when you install with a script (`-Root`, `ARKVORY_INSTALL_ROOT`). See [Storage](../operate/storage).

### Transfer limits {#limits}

The limits belong to one API process. A rate of `0` means no limit.

| Variable                              | Default   | Meaning                                                  |
| ------------------------------------- | --------- | -------------------------------------------------------- |
| `ARKVORY_MAX_UPLOADS`                 | `2`       | Uploads at the same time, 1 to 32                        |
| `ARKVORY_MAX_DOWNLOADS`               | `16`      | Downloads at the same time, 1 to 256                     |
| `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`   | `1`       | Uploads of one account or key at the same time           |
| `ARKVORY_MAX_DOWNLOADS_PER_PRINCIPAL` | `4`       | Downloads of one account or key at the same time         |
| `ARKVORY_UPLOAD_BYTES_PER_SECOND`     | `0`       | Total upload rate in bytes per second                    |
| `ARKVORY_DOWNLOAD_BYTES_PER_SECOND`   | `0`       | Total download rate in bytes per second                  |
| `ARKVORY_UPLOAD_DEADLINE_MS`          | `1800000` | The longest time of one upload request, 30 minutes       |
| `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`      | `30000`   | An upload request that sends no data for this time stops |

A proxy in front of the API must allow a request at least as long as `ARKVORY_UPLOAD_DEADLINE_MS`. See [HTTPS](./https#reverse-proxy). All other limits, such as the waiting queue and the per-account rates, are in [Environment variables](../reference/environment#transfers-and-bandwidth).

### Backups and mirrors {#backups-mirrors}

Use `configure` for both. `--backup-vault` writes `ARKVORY_BACKUP_VAULT`, grants the service account access to the directory, restarts the backup agent only, and keeps the change only when the agent reports the vault as available. The vault must be outside the installation root and outside the storage. `--mirror` writes `ARKVORY_MIRRORS_FILE` and the key files, restarts the API and the worker, and checks the source with your key before it changes anything.

### Updates and the hub {#updates-and-hub}

The update policy is in `installation.json` and `config/hub.json`. The options are in [The configure command](#configure-command), and their meaning is in [Updates](./updates). `ARKVORY_HUB_URL` in `runtime.json` is separate: it sets where the console sends feedback. `configure --hub-url` or `--hub-off` changes both, and the feedback address follows after the next restart of the services.

### Logs and shutdown {#logs-and-shutdown}

| Variable                   | Default | Meaning                                                                                          |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `ARKVORY_LOG_LEVEL`        | `info`  | `debug`, `info`, `warning` or `error`. The levels `warning` and `error` also hide the access log |
| `ARKVORY_ACCESS_LOG`       | `true`  | One JSON record for each HTTP request. The query string is never written                         |
| `ARKVORY_DRAIN_TIMEOUT_MS` | `30000` | After a stop request, the time for running requests to finish                                    |

The supervisors give a service 120 seconds to stop. If you set a drain time above about 90 seconds, also raise the stop timeout of the service manager: `TimeoutStopSec` in the systemd units, the stop timeout of the Windows services, and `stop_grace_period` in Compose. See [Monitoring](../operate/monitoring).

## Apply a change {#apply-change}

`configure` applies its own change. For anything you edit in `config/runtime.json`:

1. Make a copy of the file, for example `sudo cp -p /opt/proanima-arkvory/config/runtime.json /root/runtime.json.bak`. It contains the database password: keep the copy private.
2. Edit the file in place. Keep the JSON valid, with every value a string.
3. Check the owner and the mode. On Linux they must stay `root:arkvory` and `0640`. Repair them with `sudo chown root:arkvory runtime.json` and `sudo chmod 0640 runtime.json`.
4. Restart the services. The settings are read only at start.

   ```bash
   sudo systemctl restart arkvory-api arkvory-worker arkvory-backup
   ```

   ```powershell
   Restart-Service Arkvoryapi, Arkvoryworker, Arkvorybackup
   ```

   In a Compose installation, stop and start the containers with the `compose` command from [Docker Compose](./docker#manage):

   ```bash
   "${compose[@]}" stop --timeout 120 backup worker api
   "${compose[@]}" up -d --wait api worker
   "${compose[@]}" up -d backup
   ```

5. Check the result. A value outside its range stops the process at start with a message that names the variable, never its value. On Linux read it with `journalctl -u arkvory-api -n 50`. Arkvory does not fall back to a default in that case.

A restart interrupts running transfers. Clients resume them.

## Replace the recovery key {#replace-recovery-key}

Replace the recovery key if you suspect that someone has read `config/bootstrap-token.txt`. The key is stored in two places that must change together: the file `bootstrap-token.txt` holds the key, and the entry `bootstrap-owner` in `keys.json` holds its SHA-256. Keep the entry `deployment-health` as it is.

1. Make a copy of `config/keys.json`.
2. Save this script as `replace-recovery-key.mjs`:

   ```js
   import { createHash, randomBytes } from 'node:crypto';
   import { readFileSync, writeFileSync } from 'node:fs';

   const directory = process.argv[2];
   const token = randomBytes(32).toString('hex');
   const keys = JSON.parse(readFileSync(`${directory}/keys.json`, 'utf8'));
   const owner = keys.find((key) => key.id === 'bootstrap-owner');
   if (!owner) throw new Error('No bootstrap-owner entry');
   owner.sha256 = createHash('sha256').update(token).digest('hex');
   writeFileSync(`${directory}/keys.json`, JSON.stringify(keys, null, 2));
   writeFileSync(`${directory}/bootstrap-token.txt`, token);
   ```

3. Run it as `root` or Administrator with the Node.js of the installation. The script writes into the existing files, so the owners and the access rules stay as they are.

   ```bash
   sudo /opt/proanima-arkvory/runtime/node ./replace-recovery-key.mjs /opt/proanima-arkvory/config
   ```

   ```powershell
   & 'C:\ProgramData\ProAnima\Arkvory\runtime\node.exe' .\replace-recovery-key.mjs 'C:\ProgramData\ProAnima\Arkvory\config'
   ```

   After a script installation, use the Node.js under `runtime\node-v24.21.0-…` instead.

4. Restart the services as shown in [Apply a change](#apply-change).
5. Read the new key from `config/bootstrap-token.txt`, and delete the script and the copy of `keys.json`.

Accounts, personal tokens and service keys are not affected. They live in the database.
