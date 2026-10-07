---
title: Docker Compose
description: Run Arkvory as a Docker Compose project, with its containers, volumes, ports, updates, backup agent and removal.
---

# Docker Compose

A Compose installation runs the API, the worker, the backup agent and PostgreSQL as containers on one host. The installer builds the Arkvory image from the release and starts the project `proanima-arkvory`. Use it on container hosts. On Windows, Docker Desktop is for evaluation only: see [Windows with Docker Desktop](#docker-desktop).

Compose has no built-in HTTPS. Put a reverse proxy in front of it before clients connect from other computers: see [HTTPS and reverse proxy](./https).

## Requirements {#requirements}

| Item          | Requirement                                                                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine        | Docker Engine with the Compose plugin (`docker compose`). Podman with a compatible compose provider is possible with `--engine podman`, but it is not tested                             |
| Account       | `root`, or a user in the `docker` group                                                                                                                                                  |
| Start at boot | The container engine must start at boot, or Arkvory does not come back after a restart. Check with `systemctl is-enabled docker`                                                         |
| Host          | One Arkvory installation per container host. The project name and the port are fixed                                                                                                     |
| Free port     | 8080 on `127.0.0.1`                                                                                                                                                                      |
| Containers    | Linux containers only. Windows containers are not supported                                                                                                                              |
| Internet      | `nodejs.org` (the installer downloads Node.js 24.21.0 and checks its SHA-256), the update hub or GitHub (the release), and Docker Hub (`node:24.21.0-bookworm-slim` and `postgres:18.4`) |

The installer does not install or change the container engine, the hypervisor or WSL.

## The bundle {#bundle}

The installer takes a verified release and unpacks it to `releases/<version>/` in the installation root. The Compose file is `releases/<version>/deploy/compose.yml` and the build file is `releases/<version>/deploy/Dockerfile`. The image `proanima-arkvory:<version>` is built on your host from `node:24.21.0-bookworm-slim`. Nothing is pulled from an Arkvory registry.

The installation root is `/opt/proanima-arkvory` on Linux. Its layout is described in [Choose an installation](./#installation-directory). In a Compose installation the data is not in `data/`: it is in the volumes described below.

## Containers {#containers}

| Service       | Image                        | Role                                                                                         |
| ------------- | ---------------------------- | -------------------------------------------------------------------------------------------- |
| `database`    | `postgres:18.4`              | PostgreSQL. Reports ready with `pg_isready` every 5 seconds                                  |
| `api`         | `proanima-arkvory:<version>` | HTTP API and console. Published on `127.0.0.1:8080`. Health check every 10 seconds           |
| `worker`      | `proanima-arkvory:<version>` | Finishes uploads and runs background jobs. Starts after the API is healthy                   |
| `backup`      | `proanima-arkvory:<version>` | Backup agent. Reads the storage volume read-only. Publishes no port                          |
| `initialize`  | `proanima-arkvory:<version>` | One-shot, as root: gives user 1000 ownership of the storage volume                           |
| `migrate`     | `proanima-arkvory:<version>` | One-shot: runs the database migrations                                                       |
| `vault-owner` | `proanima-arkvory:<version>` | One-shot, only with the `maintenance` profile: gives user 1000 ownership of the backup vault |

The long-running services restart unless you stop them. The containers of Arkvory run as the `node` user (user 1000) of the image, with a read-only root file system, a 64 MiB `/tmp` in memory, all capabilities dropped, `no-new-privileges` and 120 seconds to stop. Docker keeps up to five JSON log files of 20 MiB for each container.

## Volumes and bind mounts {#volumes}

### Docker volumes {#docker-volumes}

| Volume                     | Mounted at                          | Content                                                               |
| -------------------------- | ----------------------------------- | --------------------------------------------------------------------- |
| `proanima-arkvory_storage` | `/var/lib/arkvory`                  | File content and upload staging. The backup agent mounts it read-only |
| `proanima-arkvory_catalog` | `/var/lib/postgresql` in `database` | The PostgreSQL data                                                   |

The volumes survive updates and `docker compose down`. Only `down --volumes` deletes them.

### Bind mounts from the installation root {#bind-mounts}

| Host path                 | In the container                | Mode       | Mounted in                                               |
| ------------------------- | ------------------------------- | ---------- | -------------------------------------------------------- |
| `config/runtime.json`     | `/run/arkvory/runtime.json`     | read-only  | api, worker, backup                                      |
| `config/keys.json`        | `/run/arkvory/keys.json`        | read-only  | api, worker                                              |
| `config/health-token.txt` | `/run/arkvory/health-token.txt` | read-only  | api, worker                                              |
| `config/postgres.env`     | environment file                |            | database                                                 |
| `updates/status`          | `/run/arkvory-updates/status`   | read-only  | api, worker                                              |
| `updates/inbox`           | `/run/arkvory-updates/inbox`    | read-write | api, worker                                              |
| the backup vault          | `/srv/arkvory-vault`            | read-write | backup, `vault-owner` (only while a vault is configured) |
| `config/mirrors`          | `/run/arkvory/mirrors`          | read-only  | api, worker (only while a repository is mirrored)        |

### Owners and modes {#owners}

| Path                                                   | Owner and mode              | Why                                                                                                                                            |
| ------------------------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| The installation root                                  | The installing user, `0700` | The root holds the recovery key and the database password. Only the installing user can enter it                                               |
| `config/runtime.json`, `keys.json`, `health-token.txt` | `0644`                      | User 1000 in the container must read them. `runtime.json` holds the database password; the `0700` root keeps other users away from these files |
| `updates/inbox`                                        | `0777`                      | The only directory the container writes on the host. The container user and the host updater can have different user IDs                       |
| `updates/status`                                       | `0755`                      | Written by the host updater; the container only reads it                                                                                       |
| Storage volume                                         | User 1000                   | `initialize` sets it at install and update                                                                                                     |
| Backup vault                                           | User 1000                   | `vault-owner` sets it when you connect the vault. The vault then belongs to the host user with ID 1000                                         |

## Ports {#ports}

| Port     | Service         | Exposure                                                 |
| -------- | --------------- | -------------------------------------------------------- |
| 8080/TCP | API and console | `127.0.0.1:8080` on the host. The address is fixed       |
| 5432/TCP | PostgreSQL      | Not published. Reachable only inside the Compose network |

The Compose file belongs to the release directory, which updates replace, so you cannot change the published address there. To reach the console from other computers, install a reverse proxy on the host that forwards to `127.0.0.1:8080`.

## Environment {#environment}

The Compose file sets no Arkvory settings. The services read `/run/arkvory/runtime.json`, which is `config/runtime.json` on the host. The installer writes these values and you must not change them: `ARKVORY_HOST` (`0.0.0.0` inside the container), `ARKVORY_PORT` (`8080`), `ARKVORY_DATABASE_URL` (the `database` container with a generated password), `ARKVORY_DATA_DIR` (`/var/lib/arkvory`), `ARKVORY_KEYS_FILE` and `ARKVORY_UPDATE_CONTROL_DIR`.

You can add other settings, such as `ARKVORY_TRUSTED_PROXIES`, the limits or `ARKVORY_LOG_LEVEL`. Add them to `config/runtime.json`, then stop and start the services as shown in [Manage the project](#manage). The full list is in [Environment variables](../reference/environment). `config/compose.env` holds `ARKVORY_IMAGE`. The installer maintains it; do not edit it.

## Install on Linux {#install}

1. Download `install.sh` from [GitHub Releases](https://github.com/ProAnima/Arkvory/releases) and read it.
2. Run it as `root`:

   ```bash
   sudo bash ./install.sh --mode compose
   ```

   Add `--automatic` to turn on automatic updates, or `--engine podman` for Podman. With `ARKVORY_RELEASE_VERSION=1.2.3` the script installs that stable version. Without internet access to GitHub, unpack `Arkvory-Linux.tar.gz` and run `sudo env ARKVORY_ARTIFACT_DIR="$PWD" bash ./install.sh --mode compose` in the unpacked directory. Node.js is still downloaded.

3. Wait for the installer to finish. It checks and unpacks the release, builds the image, starts the database, runs `initialize` and `migrate`, starts the API and the worker, waits until the API reports ready three times in a row, starts the backup agent and registers the update timer.

A user in the `docker` group can install without `root` into a directory the user owns:

```bash
ARKVORY_INSTALL_ROOT="$HOME/arkvory" bash ./install.sh --mode compose
```

The installer then registers no update timer. The console cannot request updates until you schedule the updater yourself. See [Updates in Compose](#updates-compose).

## First start and onboarding {#first-start}

1. Check that the containers run. See [Manage the project](#manage) for the `compose` command.

   ```bash
   "${compose[@]}" ps
   ```

2. Read the recovery key:

   ```bash
   sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
   ```

3. Open `http://127.0.0.1:8080/console/#onboarding` on the server. From your own computer, forward the port: `ssh -L 8080:127.0.0.1:8080 admin@arkvory.example`.
4. In the console, open [[ui:navStart]] and expand [[ui:welcomeOwner]]. Paste the key into [[ui:welcomeRecovery]], enter the owner name and a password of at least 12 characters, and select [[ui:welcomeCreate]].

Keep the recovery key on the server. See [Security](../operate/security).

## Manage the project {#manage}

Open a root shell (`sudo -i`) and define the `compose` command once. Compose needs the project name, the project directory, the environment file and every Compose file of the installation:

```bash
root=/opt/proanima-arkvory
node="$root/runtime/node-v24.21.0-linux-x64/bin/node"   # linux-arm64 on arm64
version=$("$node" -p "require('$root/installation.json').current.version")
compose=(docker compose --project-name proanima-arkvory --project-directory "$root"
  --env-file "$root/config/compose.env" -f "$root/releases/$version/deploy/compose.yml")
for file in compose.vault.yml compose.mirrors.yml; do
  if [[ -f "$root/config/$file" ]]; then compose+=(-f "$root/config/$file"); fi
done
```

If you leave out a file that exists, `up` re-creates the container without the vault or the mirror mount.

| Task                | Command                                                                           |
| ------------------- | --------------------------------------------------------------------------------- |
| Show the containers | `"${compose[@]}" ps`                                                              |
| Read logs           | `"${compose[@]}" logs --tail 100 api worker backup`                               |
| Stop Arkvory        | `"${compose[@]}" stop --timeout 120 backup worker api`                            |
| Start Arkvory       | `"${compose[@]}" up -d --wait api worker` and then `"${compose[@]}" up -d backup` |

Stopping with `stop` keeps a container stopped after a restart of the engine. Start it again with `up -d`.

The lifecycle commands run with the Node.js that the installer put into the root:

```bash
sudo "$node" "$root/manage.mjs" status --root "$root"
```

`arkvory` is not installed on a Compose host, so call `manage.mjs` for `status`, `update` and `configure`. The commands are described in [Configuration](./configuration).

## Logs {#logs}

Containers write to Docker's JSON log files. Read them with `"${compose[@]}" logs`. API and worker write one JSON record per line. See [Monitoring](../operate/monitoring). The lifecycle commands print their messages to the terminal, and the update timer writes to the journal: `journalctl -u arkvory-update`.

## Updates in Compose {#updates-compose}

Update with the console, the automatic update window or the command:

```bash
sudo "$node" "$root/manage.mjs" update --root "$root"
```

The update downloads and checks the release, builds the new image, then stops `backup`, `worker` and `api` and starts them with the new image. The `database` container keeps running. The volumes stay as they are. A release that changes the database schema is installed only after a verified backup. See [Updates](./updates).

The host updater runs once a minute. Installed as `root` on a systemd host, the installer registers it as `arkvory-update.timer`. Without `root`, the installer prints a warning. Schedule this command every minute as the user that owns the installation and has access to the container engine, for example with cron:

```text
* * * * * /home/admin/arkvory/runtime/node-v24.21.0-linux-x64/bin/node /home/admin/arkvory/manage.mjs updates-poll --root /home/admin/arkvory
```

Never give the Docker socket to the Arkvory containers.

## Backup agent in Compose {#backup-agent}

The `backup` container runs from the start. Without a vault it runs and reports that no vault is configured. The vault is a directory of the host, outside the installation root, on a separate volume.

1. Mount the vault volume and create an empty directory, for example `/mnt/backup/arkvory`. The directory must exist: Compose does not create it.
2. Connect it:

   ```bash
   sudo "$node" "$root/manage.mjs" configure --root "$root" --backup-vault /mnt/backup/arkvory --vault-key-file /root/arkvory-agent.key
   ```

   The command checks the directory, writes `config/compose.vault.yml`, gives user 1000 ownership of the directory, passes the agent key file to the backup container read-only (`--vault-key-file`) and restarts only the backup container. It succeeds when the agent reports the vault as available. Otherwise it restores the previous configuration.

3. To disconnect the vault, run the same command with `--backup-vault-off`. The vault itself is not touched.

Schedules, retention and restores are described in [Backups](../operate/backups).

## Remove {#remove}

```bash
"${compose[@]}" down              # removes the containers, keeps the volumes
"${compose[@]}" down --volumes    # also deletes the catalog and all stored files
```

`down --volumes` deletes all data. Never run it on an installation that holds files. Make a backup first, and keep the vault.

After `down`, you can remove what is left:

```bash
sudo systemctl disable --now arkvory-update.timer
sudo rm -f /etc/systemd/system/arkvory-update.service /etc/systemd/system/arkvory-update.timer
sudo systemctl daemon-reload
docker image rm "proanima-arkvory:$version"
sudo rm -rf /opt/proanima-arkvory
```

Delete the root only after you no longer need the configuration and the recovery key. The images of earlier versions stay on the host until you remove them.

## Windows with Docker Desktop {#docker-desktop}

Use Docker Desktop for evaluation on a workstation only. Docker Desktop is an application of one user: the containers run only while this user is signed in and Docker Desktop runs. After a restart of the computer, Arkvory is unavailable until then. Enable **Settings > General > Start Docker Desktop when you sign in**. The installer and the `status` command warn when this setting is off. For a server, use the [Windows services](./windows).

1. Start Docker Desktop in Linux containers mode.
2. Download `install.ps1` from the release and read it.
3. Open Windows PowerShell as the user that runs Docker Desktop, **without** administrator rights, and run:

   ```powershell
   .\install.ps1 -Mode compose
   ```

   The parameters `-Root`, `-Version`, `-Engine`, `-Artifact`, `-AutomaticUpdates` and `-Pin` are described in [Windows](./windows#install-with-powershell-and-an-existing-postgresql). Give `-Root` and `-Artifact` as absolute paths.

4. Open `http://127.0.0.1:8080/console/#onboarding`, read the recovery key from `C:\ProgramData\ProAnima\Arkvory\config\bootstrap-token.txt` and create the owner as described in [First start and onboarding](#first-start).

The installation root `C:\ProgramData\ProAnima\Arkvory` grants access to SYSTEM, Administrators and the installing user, without inheritance, because Docker Desktop reads the bind mounts with the token of this user. Do not run the installer elevated for Compose.

The installer registers the update task `ProAnimaArkvoryUpdate` only when it runs as administrator. That task suits a system-wide engine, not Docker Desktop. For Docker Desktop, register the task as the Docker Desktop user. It works only while this user is signed in and Docker Desktop runs:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
$node = "$root\runtime\node-v24.21.0-win-x64\node.exe"
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$root\manage.mjs`" updates-poll --root `"$root`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Action $action -Trigger $trigger -Settings $settings
```

Manage the project in PowerShell with the same arguments:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
$version = (Get-Content "$root\installation.json" -Raw | ConvertFrom-Json).current.version
$compose = @('compose', '--project-name', 'proanima-arkvory', '--project-directory', $root,
  '--env-file', "$root\config\compose.env", '-f', "$root\releases\$version\deploy\compose.yml")
foreach ($file in 'compose.vault.yml', 'compose.mirrors.yml') {
  if (Test-Path "$root\config\$file") { $compose += @('-f', "$root\config\$file") }
}
docker @compose ps
& "$root\runtime\node-v24.21.0-win-x64\node.exe" "$root\manage.mjs" status --root $root
```

A backup vault on Windows must be a local or iSCSI volume. UNC and SMB paths are refused. To remove the installation, run `docker @compose down --volumes`, unregister the task with `Unregister-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Confirm:$false`, and delete the root. Back up first.
