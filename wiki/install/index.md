---
title: Choose an installation
---

# Choose an installation

Arkvory runs on one server. Every installation has the same parts:

- **API**: the HTTP API and the web console.
- **Worker**: finishes uploads and runs background jobs.
- **Backup agent**: makes scheduled backups into a backup vault.
- **PostgreSQL**: the database for the catalog.

File content is stored on a local disk of the server. A single server is not a high-availability system: an update or a server failure causes a short interruption, and clients resume their transfers. For two or three Linux servers that keep a synchronous copy and take over from each other, see [High availability cluster](../operate/cluster).

## Installation options {#installation-options}

| Option                                                                                         | Platform                                     | Starts after a reboot without sign-in                                     | Database                                                               | Automatic updates after installation                | Recommended for                                                        |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- |
| [Graphical installer](./windows) `Arkvory-Setup-x64.exe`                                       | Windows x64                                  | Yes (Windows services)                                                    | Bundled PostgreSQL 18.4, managed by Arkvory                            | Off                                                 | Windows servers and workstations, installation without internet access |
| [Linux package](./linux) `Arkvory-amd64.deb`, `Arkvory-x86_64.rpm`                             | Linux x64 with systemd                       | Yes (systemd units)                                                       | Dedicated PostgreSQL cluster from your distribution (version 16 to 19) | Off                                                 | Debian, Ubuntu and RPM-based servers                                   |
| Script, native services: `install.sh` ([Linux](./linux)), `install.ps1` ([Windows](./windows)) | Linux x64 or arm64 with systemd, Windows x64 | Yes                                                                       | Your existing PostgreSQL server                                        | Off, or on with `--automatic` / `-AutomaticUpdates` | Automation, an existing PostgreSQL server, Linux arm64                 |
| [Docker Compose](./docker)                                                                     | Linux with Docker Engine                     | Yes, if the container engine starts at boot                               | PostgreSQL 18.4 container                                              | Off, or on with `--automatic`                       | Container hosts                                                        |
| [Docker Desktop](./docker)                                                                     | Windows x64                                  | No. Containers run only after the user signs in and Docker Desktop starts | PostgreSQL 18.4 container                                              | Off, or on with `-AutomaticUpdates`                 | Evaluation on a workstation                                            |

All options install the same API, worker and backup agent. Built-in HTTPS is available only for native installations. A Compose installation needs a reverse proxy for HTTPS. See [HTTPS and reverse proxy](./https).

### Remote installation over SSH {#remote-installation-over-ssh}

**Arkvory Remote Setup** is part of the client packages. It runs on the administrator's computer, connects to a server over SSH and installs the native Linux or Windows package there. It then creates the owner account and opens the console through a private SSH tunnel.

| Server      | Requirements                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------- |
| Linux x64   | SSH and SFTP, systemd, `apt-get` or `dnf`, root or a user with `sudo -n` (no password prompt) |
| Windows x64 | OpenSSH Server with SFTP, Windows PowerShell, an administrator account                        |

The tunnel works only while Remote Setup runs. It does not publish Arkvory to other computers. Password-protected `sudo`, SSH agents, jump hosts and ARM servers are not supported.

## What a release contains {#what-a-release-contains}

Releases are published at [github.com/ProAnima/Arkvory/releases](https://github.com/ProAnima/Arkvory/releases).

| File                                                                                                                                      | Purpose                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Arkvory-Setup-x64.exe`                                                                                                                   | Windows graphical installer. Includes Node.js, PostgreSQL, WinSW and the Microsoft Visual C++ runtime                 |
| `Arkvory-amd64.deb`, `Arkvory-x86_64.rpm`                                                                                                 | Linux packages. Include Node.js                                                                                       |
| `install.sh`, `install.ps1`                                                                                                               | Command-line installers for native services or Docker Compose                                                         |
| `Arkvory-Linux.tar.gz`, `Arkvory-Windows.zip`                                                                                             | Automation kits: the command-line installer and the release files, for installation without access to GitHub Releases |
| `Arkvory-CLI-Setup-x64.exe`, `Arkvory-CLI-amd64.deb`, `Arkvory-CLI-x86_64.rpm`                                                            | Client packages: the `arkvoryctl` command-line client and Arkvory Remote Setup                                        |
| `arkvoryctl.mjs`, `arkvory-remote.mjs`                                                                                                    | The same client tools as single files for Node.js 24                                                                  |
| `arkvory-runtime.zip`, `arkvory-setup.mjs`, `arkvory-release.json`, `arkvory-release.json.sig`, `release-checksums.json`, `native-*.json` | Program files, manifests, checksums and the signature. Installers and the updater read them                           |

## Requirements {#requirements}

| Item                         | Requirement                                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Windows, graphical installer | x64, Windows build 10.0.17763 or later (Windows 10 version 1809, Windows Server 2019). Administrator rights                              |
| Windows, script              | x64, Windows PowerShell. Administrator rights for native services                                                                        |
| Linux packages               | x64, systemd, glibc 2.28 or later, Python 3. The package manager installs PostgreSQL 16 or later                                         |
| Linux, script                | x64 or arm64, systemd for native services, glibc, Bash, curl, Python 3, tar and xz                                                       |
| Docker Compose               | Docker Engine with the Compose plugin, or Docker Desktop in Linux containers mode. Podman with a compatible compose provider is possible |
| PostgreSQL                   | One database for one Arkvory installation. Never connect two installations to the same database                                          |
| File storage                 | A local file system that supports hard links. Do not use a network share for file storage                                                |
| Backup vault                 | A separate volume, mounted before the services start. See [Backups](../operate/backups)                                                  |

Arkvory does not define fixed processor or memory minimums. Plan disk space for your files, the database and the backup vault. By default Arkvory keeps 1 GiB of free space on the storage volume and accepts up to 10 TiB of reserved uploads. You can change both limits. See [Configuration](./configuration).

### Network access during installation and updates {#network-access-during-installation-and-updates}

The graphical installer works without internet access. Other options download files over HTTPS:

| Host                                                     | Used by                                                                             |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `nodejs.org`                                             | `install.sh` and `install.ps1` download Node.js 24.21.0 and check its SHA-256       |
| `api.github.com`, `github.com` and GitHub download hosts | Script installers, and updates when the update hub cannot be reached                |
| `hub.proanima.net`                                       | Update checks and downloads. See [Updates](./updates)                               |
| Docker Hub                                               | Compose builds its image from `node:24.21.0-bookworm-slim` and runs `postgres:18.4` |

Without internet access, install and update from a local copy of a release. See [Updates](./updates).

## Ports {#ports}

| Port      | Service                                                              | Default exposure                                                                                                                                                            |
| --------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8080/TCP  | API and console (HTTP, or HTTPS with built-in TLS)                   | `127.0.0.1` only. A native installation can listen on other addresses after you configure HTTPS, or behind a trusted proxy. Compose always publishes it on `127.0.0.1:8080` |
| 54329/TCP | Managed PostgreSQL of the graphical installer and the Linux packages | `127.0.0.1` only                                                                                                                                                            |
| 5432/TCP  | PostgreSQL container of a Compose installation                       | Not published. Reachable only inside the Compose network                                                                                                                    |

Open only the HTTPS port to client networks. Never open the database port.

## Installation directory {#installation-directory}

The installation root is `C:\ProgramData\ProAnima\Arkvory` on Windows and `/opt/proanima-arkvory` on Linux. Use a dedicated, empty directory outside home directories and user profiles.

| Path in the root                 | Content                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `installation.json`              | Installed version, installation mode, automatic update setting and version pin |
| `journal.json`, `operation.lock` | State of the last update, and the lock of a running operation                  |
| `launcher.mjs`, `manage.mjs`     | Start the services and the management commands                                 |
| `releases/<version>/`            | Program code of each installed version. Services do not write here             |
| `runtime/`                       | Node.js. The graphical installer also puts PostgreSQL and WinSW here           |
| `config/`                        | Settings, keys and the recovery key. See [Configuration](./configuration)      |
| `data/`                          | File storage of a native installation                                          |
| `database/`                      | Managed PostgreSQL cluster. On Windows also its logs                           |
| `logs/`                          | Windows service logs and the Windows updater log                               |
| `service/`                       | Windows service wrappers                                                       |
| `updates/`                       | Update requests from the console and the status of the updater                 |

A Compose installation keeps its data in the Docker volumes `proanima-arkvory_storage` (files) and `proanima-arkvory_catalog` (database), not in `data/`.

Old versions in `releases/` are not deleted automatically. After a successful update you can delete unused versions. Keep the current version and the previous version named in `journal.json`.

## Recovery key {#recovery-key}

The installer creates `config/bootstrap-token.txt`. This file holds the **recovery key**: a key with administrator rights. Only root or the Administrators group can read it.

- Use it once to create the first owner account if the installer did not create one. The console asks for it on the first start.
- Installation tools read it on the server: owner creation, `arkvory configure --backup-vault`, the backup check after an update, and the backup before a database schema change. **Do not delete this file.**
- Do not copy it to clients, CI systems or scripts. For daily work, create user accounts and service keys with limited rights. See [Accounts and access](../use/accounts).

To replace the recovery key, see [Configuration](./configuration).

## Next steps {#next-steps}

1. Install with the page for your platform: [Windows](./windows), [Linux](./linux) or [Docker Compose](./docker).
2. Sign in and publish a first file. See [Quick start](../guide/quick-start).
3. Configure [HTTPS](./https) before clients connect from other computers.
4. Connect a backup vault and run a first backup. See [Backups](../operate/backups).
5. Choose an [update policy](./updates).
