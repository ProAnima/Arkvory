---
title: Linux
description: Install Arkvory on Linux from the .deb or .rpm package, start it, operate the systemd services, upgrade and remove it.
---

# Linux

There are two ways to run Arkvory on Linux:

- **Package** `Arkvory-amd64.deb` or `Arkvory-x86_64.rpm`. Recommended. It installs systemd services and a dedicated PostgreSQL cluster that Arkvory manages. Your package manager supplies the PostgreSQL programs.
- **Script** `install.sh`. It installs the same services, but uses an existing PostgreSQL server. It also supports arm64. See [Use an existing PostgreSQL](#existing-postgresql).

For Docker, see [Docker Compose](./docker). For a first walk through the console, see the [Quick start](../guide/quick-start).

## Requirements {#requirements}

| Item                       | Requirement                                                                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Processor                  | x64 for the packages. There are no arm64 packages: use `install.sh` on arm64                                                                                                                                                                                             |
| Init system                | systemd. OpenRC, runit and other init systems are not supported                                                                                                                                                                                                          |
| C library                  | glibc 2.28 or later. Alpine Linux (musl) is not supported                                                                                                                                                                                                                |
| Tested distributions       | Ubuntu 24.04 for the `.deb`, Fedora 44 for the `.rpm`. Other systemd distributions that meet the dependencies below are not tested                                                                                                                                       |
| Dependencies of the `.deb` | `postgresql` 16 or later, `systemd`, `python3`, `ca-certificates`, `libc6` 2.28 or later, `libstdc++6`, `libgcc-s1`, `libatomic1`                                                                                                                                        |
| Dependencies of the `.rpm` | `postgresql-server` 16 or later, `systemd`, `python3`, `ca-certificates`, `glibc` 2.28 or later, `libstdc++`, `libatomic`                                                                                                                                                |
| PostgreSQL programs        | Version 16 to 19. The installation step searches `/usr/lib/postgresql/*/bin`, `/usr/pgsql-*/bin`, `/usr/bin` and `/usr/lib/pgsql/bin` and takes the highest version it finds. If your distribution offers only an older version, add a newer PostgreSQL repository first |
| Account                    | `root`, or a user that can run `sudo`                                                                                                                                                                                                                                    |
| Free ports                 | 8080 and 54329 on `127.0.0.1`                                                                                                                                                                                                                                            |
| File storage               | A local file system that supports hard links. Do not use a network share                                                                                                                                                                                                 |

The package contains Node.js 24. Installing it needs no internet access beyond what your package manager uses for the dependencies.

The package never changes an existing PostgreSQL cluster or service. Arkvory starts its own cluster from the PostgreSQL programs.

## Install the package {#install-package}

1. Download the package for your distribution from [GitHub Releases](https://github.com/ProAnima/Arkvory/releases), together with `native-linux.json` of the same release.
2. Compare the SHA-256 of the package with the value in `native-linux.json`. The packages are not signed with a publisher key, so this check is the only proof of what you downloaded.
3. Install the package. Keep the `./` in front of the file name: it tells the package manager that the file is local. On Debian and Ubuntu:

```bash
sudo apt install ./Arkvory-amd64.deb
```

On Fedora and RPM-compatible systems:

```bash
sudo dnf install ./Arkvory-x86_64.rpm
```

The package manager installs the dependencies, then Arkvory configures itself. It:

1. copies Node.js to `/opt/proanima-arkvory/runtime/node`,
2. creates the two service accounts, the configuration, the keys and the recovery key,
3. creates and starts the PostgreSQL cluster and runs the database migrations,
4. registers and starts the services and the update timer,
5. waits until the API answers its readiness check three times in a row.

At the end it prints the console address and the path of the recovery key. If a step fails, the installation stops with an error. See [Troubleshooting](#troubleshooting).

Automatic updates are off after installation. To turn them on, see [Updates](./updates).

## What the package creates {#what-package-creates}

### Files and directories {#files}

| Path                                                            | Content                                                                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/usr/lib/proanima-arkvory/`                                    | Package payload: Node.js, the release files and the installer. Owned by the package                                                                                |
| `/usr/bin/arkvory`                                              | The management command. See [The arkvory command](#arkvory-command)                                                                                                |
| `/usr/share/applications/arkvory.desktop`                       | Menu entry that opens the console on a desktop. A server without a desktop does not use it                                                                         |
| `/opt/proanima-arkvory/`                                        | The installation root: configuration, data, database, program code of each version. Its layout is described in [Choose an installation](./#installation-directory) |
| `/etc/systemd/system/arkvory-*.service`, `arkvory-update.timer` | The service units and the update timer                                                                                                                             |

The root is `root:arkvory` with mode `0711`. Inside it, `config/` is `0750 root:arkvory`, `data/` and `logs/` belong to `arkvory`, and `database/` belongs to `arkvory-db` with mode `0700`. The recovery key and the database password files are readable only by `root`.

### Accounts {#accounts}

| Account      | Runs                      | Notes                                                                          |
| ------------ | ------------------------- | ------------------------------------------------------------------------------ |
| `arkvory`    | API, worker, backup agent | System account, no login shell, home `/opt/proanima-arkvory/data`              |
| `arkvory-db` | The database              | System account, no login shell. The API account cannot read the database files |

### Services {#services}

| Unit                   | Runs as                                   | Restart policy                                                |
| ---------------------- | ----------------------------------------- | ------------------------------------------------------------- |
| `arkvory-database`     | `arkvory-db`                              | `on-failure`, after 10 seconds                                |
| `arkvory-api`          | `arkvory`                                 | `always`, after 10 seconds                                    |
| `arkvory-worker`       | `arkvory`                                 | `always`, after 10 seconds                                    |
| `arkvory-backup`       | `arkvory`                                 | `always`, after 10 seconds                                    |
| `arkvory-update.timer` | starts `arkvory-update.service` as `root` | Every minute. The job checks for update requests and releases |

All units start at boot (`multi-user.target`). They allow 120 seconds to stop. They run with `NoNewPrivileges`, a private `/tmp`, a read-only file system outside their own directories and no access to `/home`. The API and the worker can write only to `data/`, `logs/` and `updates/inbox/` of the root. The backup agent reads the storage and writes only to the backup vault. Because `/home` is hidden from the units, never place certificates, vaults or the data directory under a home directory.

A service that stops without your request starts again after 10 seconds. A process whose main thread hangs for 60 seconds ends itself and starts again. A failed readiness check alone does not restart a service. See [Self-healing](../operate/self-healing).

### Ports {#ports}

| Port      | Use                            | Exposure                                               |
| --------- | ------------------------------ | ------------------------------------------------------ |
| 8080/TCP  | API and console                | `127.0.0.1` only, until you configure [HTTPS](./https) |
| 54329/TCP | The managed PostgreSQL cluster | `127.0.0.1` only. The number is fixed                  |

## First start and onboarding {#first-start}

1. Check that the services run:

   ```bash
   systemctl status arkvory-database arkvory-api arkvory-worker arkvory-backup
   ```

2. Read the recovery key. Only `root` can read it.

   ```bash
   sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
   ```

3. Open `http://127.0.0.1:8080/console/#onboarding`. On a remote server, forward the port first and open the address on your own computer:

   ```bash
   ssh -L 8080:127.0.0.1:8080 admin@arkvory.example
   ```

4. In the console, open [[ui:navStart]] and expand [[ui:welcomeOwner]]. Paste the key into [[ui:welcomeRecovery]], enter the owner name and a password of at least 12 characters, and select [[ui:welcomeCreate]]. The name has 3 to 64 characters: Latin letters, digits, dot, dash or underscore.
5. Sign in with the new name and password.

The owner is the first administrator. The recovery key stays on the server: do not delete the file, and do not copy it to clients or CI systems. The installation tools read it. For daily work, create accounts and service keys. See [Accounts and access](../use/accounts) and [Security](../operate/security).

Before clients connect from other computers, configure [HTTPS](./https). Then connect a backup vault and run a first backup: see [Backups](../operate/backups).

To install on a server from your own computer, you can use Arkvory Remote Setup instead. See [Choose an installation](./#remote-installation-over-ssh).

## The arkvory command {#arkvory-command}

The package installs `/usr/bin/arkvory`. `arkvory help` lists all commands and needs no special rights. Every other command needs `root` and the installation root:

```bash
sudo arkvory status --root /opt/proanima-arkvory
```

`status` prints the installation mode, the installed version, the automatic update setting and the version pin.

| Command           | Use                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `status`          | Show the installed version and the update policy                                                 |
| `update`          | Install a newer stable release now. See [Updates](./updates)                                     |
| `configure`       | HTTPS, backup vault, mirrors, update policy and hub. See [Configuration](./configuration)        |
| `recover`         | Finish an interrupted update. See [Updates](./updates#recover-update)                            |
| `finish-install`  | Continue an interrupted installation                                                             |
| `updates-connect` | Connect the console and the update timer of an installation that was updated from an old release |

## Logs {#logs}

The services write to the system journal. API and worker write one JSON record per line.

```bash
sudo journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup -u arkvory-database
sudo journalctl -u arkvory-api -f
sudo journalctl -u arkvory-update --since today
```

`arkvory-update` holds the output of the update timer. The journal size and retention are settings of your operating system. For the record fields and the metrics, see [Monitoring](../operate/monitoring). Deploy commands print lines in the form `<ISO-8601 time> INFO|WARN|ERROR <text>`. Secrets are removed from them.

## Upgrade {#upgrade}

Install a newer package over the old one, or update from the console or with `arkvory update`. Running services keep serving until the update switches to the new code. See [Updates](./updates) for the policies, the backup before a database schema change and the recovery steps.

There is no apt or dnf repository for Arkvory. Download each new package from the release page.

## Remove {#remove}

### Remove the package and keep the data {#remove-package}

On Debian and Ubuntu:

```bash
sudo apt remove proanima-arkvory
```

On Fedora and RPM-compatible systems:

```bash
sudo dnf remove proanima-arkvory
```

Removal stops and disables the services and the update timer. It deletes `/usr/lib/proanima-arkvory`, `/usr/bin/arkvory` and the menu entry. It intentionally **keeps**:

- `/opt/proanima-arkvory`: the database, all files, the configuration and the recovery key,
- the unit files in `/etc/systemd/system`, the accounts `arkvory` and `arkvory-db`,
- the backup vault and its systemd drop-in. It never touches the vault.

`apt purge` removes no more than `apt remove`. If you install the package again, it continues with the kept data and starts the services.

### Remove everything {#remove-all}

This deletes all stored files and the catalog. Make a backup first and keep the vault.

```bash
sudo systemctl disable --now arkvory-update.timer arkvory-backup arkvory-worker arkvory-api arkvory-database
sudo rm -rf /opt/proanima-arkvory
sudo rm -f /etc/systemd/system/arkvory-*.service /etc/systemd/system/arkvory-update.timer
sudo rm -rf /etc/systemd/system/arkvory-backup.service.d
sudo systemctl daemon-reload
sudo userdel arkvory
sudo userdel arkvory-db
```

Remove the package first, as described above. After a script installation there is no package: the first command stops the services, and the commands that name `arkvory-database` and `arkvory-db` report that these do not exist.

## Use an existing PostgreSQL {#existing-postgresql}

The package always creates its own cluster. To use a PostgreSQL server that your organization runs, install with `install.sh`. It creates the same three services and the update timer, but no `arkvory-database` unit and no `/usr/bin/arkvory` command.

Use a PostgreSQL version from 16 to 19. Use one database for one Arkvory installation. Never connect two installations to the same database.

1. Ask your database administrator for an empty database and a role that owns it. Arkvory runs its migrations with this role.
2. Download `install.sh` from the release and read it. It needs `bash`, `curl`, `python3`, `tar` and `xz`, systemd and `root`.
3. Run it. The script asks for the connection URL; the input is hidden.

   ```bash
   sudo bash ./install.sh --automatic
   ```

   To pass the URL in a file instead, create a file that only `root` can read:

   ```json
   { "ARKVORY_DATABASE_URL": "postgresql://arkvory:<password>@db.example:5432/arkvory" }
   ```

   ```bash
   sudo bash ./install.sh --config /root/arkvory.json
   ```

4. Delete the scratch directory `/opt/proanima-arkvory/bootstrap.*` when the installation has finished. If you typed the URL at the prompt, the directory holds it in `native.json`.
5. Create the owner as described in [First start and onboarding](#first-start).

The script downloads Node.js 24.21.0 from `nodejs.org`, checks its SHA-256 and installs the latest stable release. Leave out `--automatic` to keep automatic updates off. Environment variables change the defaults:

| Variable                  | Meaning                                                             | Default                 |
| ------------------------- | ------------------------------------------------------------------- | ----------------------- |
| `ARKVORY_INSTALL_ROOT`    | Installation root. Use a dedicated, empty directory outside `/home` | `/opt/proanima-arkvory` |
| `ARKVORY_RELEASE_VERSION` | Install this stable version instead of the latest one               | latest stable           |
| `ARKVORY_ARTIFACT_DIR`    | Install from an unpacked `Arkvory-Linux.tar.gz` instead of GitHub   | not set                 |

Pass them through `sudo env`, for example `sudo env ARKVORY_INSTALL_ROOT=/srv/arkvory bash ./install.sh`.

Without the `arkvory` command, call the management program with the Node.js that the script installed. Use `linux-arm64` on arm64:

```bash
root=/opt/proanima-arkvory
sudo "$root/runtime/node-v24.21.0-linux-x64/bin/node" "$root/manage.mjs" status --root "$root"
```

You back up and maintain the PostgreSQL server yourself. The Arkvory backup agent copies the database content into the vault through the connection URL. See [Backups](../operate/backups).

## Troubleshooting {#troubleshooting}

| Problem                                                                  | What to do                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PostgreSQL 16–19 server binaries are required`                          | The PostgreSQL programs are missing or too old. Install a PostgreSQL server of version 16 to 19 and install the package again                                                                                                                                                                                                                                                                    |
| `Use a dedicated empty installation directory`                           | `/opt/proanima-arkvory` holds files from a first installation that stopped before it saved `installation.json`. The installer never overwrites a configuration. Read the journal and the package manager output and fix the cause. A directory that holds no data yet can be moved away so that you can install again. Do not delete `config/` or `database/` of an installation that holds data |
| `Installation is locked`                                                 | An operation is running or crashed. Stop the update timer, read `journal.json` in the root and do not delete `operation.lock` before you know the state. See [Updates](./updates#recover-update)                                                                                                                                                                                                 |
| `database/bootstrap-started` exists, but `database/initialized` does not | Database creation was interrupted. Do not delete the cluster and do not repeat SQL by hand. Fix the cause and run `sudo arkvory finish-install --root /opt/proanima-arkvory`                                                                                                                                                                                                                     |
| A service does not start                                                 | `journalctl -u arkvory-api -n 100`. A start failure prints one JSON record with a `reason` that names the setting, never its value                                                                                                                                                                                                                                                               |
| Port 8080 is taken                                                       | Another program uses it. Free the port, or set `ARKVORY_PORT` in `config/runtime.json`. See [Configuration](./configuration#address-and-port). The database port 54329 cannot be changed                                                                                                                                                                                                         |

If the installation stopped after it wrote `installation.json`, you can also repeat the configuration step of the package: `sudo dpkg --configure -a` on Debian and Ubuntu, or install the same package again on RPM systems.

More hints are in [Troubleshooting](../operate/troubleshooting).
