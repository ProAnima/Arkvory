---
title: Updates
description: How Arkvory finds, verifies and installs new releases, with manual and automatic updates, the backup before a schema change, rollback, pinning and offline updates.
---

# Updates

ProAnimaStudio announces each stable release of Arkvory through a hub. Your server asks the hub which version it may install, downloads the release, checks its signature and installs it. Nothing is installed unless you start it, or you turn on automatic updates. Automatic updates are off by default.

An update is not a rolling update. The services stop for a short time, and running transfers are interrupted. Clients that can resume continue their transfers. Update in a maintenance window.

## How updates work {#how-it-works}

- **Releases.** Only published, stable releases with a version `x.y.z` are installed. Prereleases, branches, arbitrary addresses and older versions are refused.
- **The hub decides.** Every 6 hours the server asks the hub for the version that is approved for it. The hub holds a new version back or releases it step by step. The files themselves come from GitHub through short-lived links that the hub issues. The server needs no GitHub token for this.
- **Signature.** Each release manifest is signed by ProAnimaStudio. The server checks the signature with a public key that is built into the installed program, and then the SHA-256 of the archive. A release that is unsigned or altered is not installed, whether it comes from the hub or from GitHub. The hub is not trusted for integrity.
- **The host updater.** A timer on the server (`arkvory-update.timer` on Linux, the task `ProAnimaArkvoryUpdate` on Windows) runs the updater every minute. It picks up requests from the console, checks for releases when 6 hours have passed since the last check, and starts the automatic update in its hour. Checks run even when automatic installation is off.

### What an update does {#what-an-update-does}

1. While the services keep running, it downloads the release, checks the signature and the SHA-256, and unpacks the files into `releases/<version>/` in the installation root. For Compose, it builds the new image.
2. If the release changes the database schema, it takes and verifies a fresh backup first. See [The backup before an update](#backup).
3. It stops the backup agent, the worker and the API. Each gets up to 120 seconds to finish.
4. It switches the installation to the new version. A schema change runs its migration now.
5. It starts the API and the worker and waits until the API reports ready three times in a row. Then it starts the backup agent. The agent is not part of the check: if it does not report within about 90 seconds, the update prints a warning and stays.
6. It sends the anonymous `updated` event to the hub, if statistics are on. A failure here never undoes the update.

The old version stays in `releases/`. All data, keys and configuration stay as they were.

## Check for updates {#check}

Sign in to the console as an administrator and open [[ui:updates]]. The page shows [[ui:updateCurrent]], [[ui:updateLatest]] and [[ui:updateChecked]]. Select [[ui:updateCheck]] to ask the hub now. After you sign in, a banner with [[ui:updateOpen]] tells you when a newer release exists.

If a check fails, for example without network access, the page keeps the last release it found and marks it as possibly outdated. The check is tried again after 6 hours, or when you select [[ui:updateCheck]].

On the server, `arkvory status --root <root>` shows the installed version, the automatic update setting and the pin.

If the page says that the host updater is not connected, run `arkvory updates-connect --root <root>`. It connects the console and the update timer of an installation that was updated from an old release. If the page says that the updater has stopped reporting, the timer or the task has not run for 5 minutes. See [Troubleshooting](#troubleshooting).

## Install by hand {#manual}

### In the console {#manual-console}

1. Open [[ui:updates]] and check that [[ui:updateLatest]] shows the version you want.
2. Select [[ui:updateInstall]]. The dialog names the version and warns that transfers can be interrupted.
3. Select [[ui:updateConfirmButton]]. The console sends the version and the SHA-256 that you saw. If the published bytes have changed since, the request is refused.
4. Wait. The request is accepted at once; the host updater picks it up within a minute. The page may lose the connection while the services restart and reconnects by itself. Do not send a second request.

The console refuses an installation when the version is pinned. See [Pin a version](#pin).

### With a command {#manual-command}

```bash
sudo arkvory update --root /opt/proanima-arkvory
sudo arkvory update --root /opt/proanima-arkvory --version 1.2.3
```

Without `--version`, the command installs the version the hub approves for this server. With `--version`, it installs that exact stable version, which must be newer than the installed one. The command exits with an error code when the update fails. How to run the command on each platform is in [Configuration](./configuration#lifecycle-commands).

## Automatic updates {#automatic}

Turn automatic updates on in one of three ways:

- In the console, open [[ui:updates]], select [[ui:updateAutomatic]] under [[ui:updateSettings]], choose [[ui:updateHour]] and select [[ui:updateSave]].
- On the server: `arkvory configure --root <root> --enable-updates`.
- When you install with a script: `--automatic` for `install.sh`, `-AutomaticUpdates` for `install.ps1`.

Turn them off with the console or `arkvory configure --root <root> --disable-updates`.

| Rule         | Value                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| Window       | The chosen UTC hour. The default is 03:00 to 03:59 UTC. Only the console sets the hour                 |
| Attempts     | At most one per UTC day, whether it succeeds or fails. A missed window is not made up later in the day |
| Skipped when | The version is pinned, the last check failed, or no newer release is known                             |
| Release      | The newest release that the hub approved at the last check                                             |

Schedule your backups outside the update window. An update stops the backup agent, and a running backup is interrupted and queued again.

## The backup before an update {#backup}

An update that does not change the database schema takes no backup. Rely on your scheduled backups.

A release that changes the database schema installs only behind a fresh, verified backup. The updater does this while the services still run:

1. It asks the backup agent for a new backup and waits until the backup is made and checked. It waits up to 6 hours. The console shows that the release is installing during this time.
2. Only then it stops the services, migrates the database and starts the new version.

The backup needs three things: a connected backup vault that is available, a backup agent that is online, and at least one backup that has completed earlier. The first full backup of terabytes is planned work, never a side effect of an update. If one of the three is missing, the update is **refused before anything changes**. The services keep running, the console shows that the installation was refused, and an automatic update tries again on the next day. Connect the vault and run the first backup: see [Backups](../operate/backups).

Changes that arrive after the snapshot and before the services stop are not in that backup. The backup matters only if the new version fails after its migration: see [Roll back and recover](#rollback).

### Upgrade with a backup of your own {#manual-upgrade}

Without a built-in vault, make and verify your own backup of the database and of the whole storage, then give the updater a file that records it:

```bash
sudo arkvory upgrade --root /opt/proanima-arkvory --version 1.2.3 --backup-record /secure/backup-record.txt
```

The file is your own note. The updater only checks that it exists; it does not prove that the backup is complete. The journal and the rollback are the same as for `update`. This command works only forward and is refused when the version is pinned to another version.

## Roll back and recover {#rollback}

### Automatic rollback {#automatic-rollback}

- **No schema change.** If the new version does not become ready, the updater stops it, restores the previous release, waits for readiness and reports `Update failed; previous release restored`.
- **Schema change, failed migration.** The migration runs in one transaction. A failed migration rolls back, and the previous release starts again on the unchanged schema.
- **Schema change, new version does not start after the migration.** The previous release cannot read the new schema, so there is no automatic way back. The updater marks the journal `maintenance-required` and names the backup point. Fix the cause and run `recover`, which finishes the update. Or restore the backup point named in `journal.json` and run the previous version.

Arkvory has no downgrade command. The command refuses an older version. The previous version stays in `releases/` for the automatic rollback only.

### Recover an interrupted update {#recover-update}

A crash or a power loss during an update leaves two things: the lock `operation.lock` and the record `journal.json` in the installation root. New updates and most commands refuse to run until you recover. Never delete the lock before you know the state.

1. Stop the update timer, so that no new run starts. On Linux: `sudo systemctl stop arkvory-update.timer`. On Windows: `Disable-ScheduledTask -TaskName ProAnimaArkvoryUpdate`. In a Compose installation without the timer, stop your scheduled job.
2. Make sure that no updater process runs. Save `journal.json` and the logs.
3. Only then delete `operation.lock`.
4. Run `arkvory recover --root <root>`. It moves in the direction the journal allows:
   - for an update without a schema change, or before the migration started, it returns to the previous version,
   - after the migration started, it goes forward: it repeats the migration, which is safe to repeat, and starts the new version.
5. Check that the services are ready and that a test download works. Start the timer again: `sudo systemctl start arkvory-update.timer`, or `Enable-ScheduledTask -TaskName ProAnimaArkvoryUpdate`.

If the console request that started the update is still stored, `arkvory updates-reset --root <root>` removes it. Run it only after you have checked the state. It does not remove the lock.

## Pin a version {#pin}

Pin a version to stop every update to another version.

```bash
sudo arkvory configure --root <root> --pin                  # pin the installed version
sudo arkvory configure --root <root> --pin --version 1.2.3  # pin another stable version
sudo arkvory configure --root <root> --unpin
```

While a version is pinned:

- automatic updates do nothing,
- the console refuses to install a release and asks you to remove the pin on the server,
- `arkvory update` installs the pinned version, and refuses another `--version`,
- checks still run, so the console still shows newer releases.

To install a newer version after you have pinned an older one, pin the newer version and run `arkvory update`. You can also pin while installing with a script: `--pin` for `install.sh`, `-Pin` for `install.ps1`.

## The hub, the channel and statistics {#hub}

### What the server sends to the hub {#hub-data}

| When                                      | What is sent                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Update check, every 6 hours or on request | A request for the update of the project `arkvory` with the installed version, the operating system (`linux` or `windows`), the processor (`x86_64` or `aarch64`) and the channel. With statistics on, the header `X-Install-Id` with a random installation ID is added |
| An update finished, with statistics on    | One `updated` event with the installation ID, the new version, the operating system, the processor and the channel                                                                                                                                                     |
| Download of a release                     | The hub answers with a link to GitHub. The files come from there                                                                                                                                                                                                       |

No key, account, host name or stored content is sent, and no credential reaches the hub. The installation ID is a random value that identifies nothing but the installation. According to the project, the hub stores no IP addresses, names or content. The hub also receives feedback that a user sends from the console. That is a separate action of the user.

With statistics off, the server sends no installation ID and no events. The hub then offers a version only when it has released it to all installations.

### Options {#hub-options}

| Setting     | Default                    | Change it                                                                                                           |
| ----------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Statistics  | on                         | Console: [[ui:updateStatistics]] under [[ui:updateSettings]]. Command: `--statistics off` or `--statistics on`      |
| Channel     | `stable`                   | `--update-channel beta` to receive versions that ProAnimaStudio offers earlier, `--update-channel stable` to return |
| Hub address | `https://hub.proanima.net` | `--hub-url https://hub.example` for a hub of your own, `--hub-off` to use GitHub only. The address must use HTTPS   |

All of them are `arkvory configure --root <root>` options and take effect without a restart. The settings are stored in `config/hub.json`. A change of the hub address also changes where the console sends feedback, after the next restart of the services.

### When the hub is unreachable {#hub-unreachable}

If the hub does not answer (network failure, timeout or a server error), the updater reads the latest stable release on GitHub instead and logs a warning. It makes the same signature and SHA-256 checks. A refusal from the hub (status 4xx), a missing file or a bad signature is an error, and there is no fallback.

If the releases on GitHub need authentication, create the file `github-token.txt` in the installation root with a token that can read the repository contents. Only administrators may read the file. The updater uses it, the services do not, and it is never passed as a command option. With `--hub-off`, the updater always uses GitHub.

The server needs HTTPS access to `hub.proanima.net`, `api.github.com`, `github.com` and the GitHub download hosts.

## Offline installations {#offline}

A server without internet access cannot check for releases. The page [[ui:updates]] then shows that the check failed. This does not affect the services. Update from files instead.

1. On a computer with internet access, download the kit for the platform of your server: `Arkvory-Linux.tar.gz` or `Arkvory-Windows.zip`. Compare their SHA-256 with `release-checksums.json` of the release.
2. Copy the kit to the server and unpack it. The directory contains `arkvory-release.json`, `arkvory-runtime.zip` and `arkvory-setup.mjs`. The kit has no signature file. Download `arkvory-release.json.sig` from the same release page and put it next to `arkvory-release.json`: the updater then verifies the signature too.
3. Run the update with the absolute path of the directory:

   ```bash
   sudo arkvory update --root /opt/proanima-arkvory --artifact /media/release
   ```

   ```powershell
   & 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' update --root C:\ProgramData\ProAnima\Arkvory --artifact D:\release
   ```

The updater checks the SHA-256 of the archive against the manifest. It checks the signature only when `arkvory-release.json.sig` is next to the manifest. A local directory is your own choice, so the update does not require the signature. Without it, the comparison of the kit with `release-checksums.json` in step 1 is your only proof of origin. The same rules for a schema change apply: you need a verified backup first.

A native package or `Arkvory-Setup-x64.exe` carries its release and needs no internet access. A Compose update builds the image on the host. It needs Docker Hub only when the base image `node:24.21.0-bookworm-slim` is not on the host yet.

## Update by platform {#platforms}

### Windows {#platform-windows}

Run a newer `Arkvory-Setup-x64.exe` over the installed one. Setup finds the data and does not ask for the owner again. It updates the programs, the services and the database release in the same way as an update from the console. Setup of an older version is refused, and Setup of the same version repairs the services. Do not start Setup while an update is running. The installer is available in English and Russian only. You can also update from the console or with the command.

### Linux packages {#platform-linux}

Download the newer package from the release page and install it like the first one: `sudo apt install ./Arkvory-amd64.deb` or `sudo dnf install ./Arkvory-x86_64.rpm`. There is no apt or dnf repository, so `apt upgrade` and `dnf upgrade` do not find new versions. The configuration step of the package runs the same update as the command, with the release inside the package. The running services keep serving until the switch.

If the update is refused, for example because a schema change needs a backup that does not exist, the old version keeps running and the configuration step fails. Fix the cause, then repeat the step with `sudo dpkg --configure -a` on Debian and Ubuntu, or by installing the same package again on RPM systems.

After an update from the console, the version shown by the package manager can be older than the running version. A package older than the running version is refused.

### Script installation {#platform-script}

A script installation has no `arkvory` command. Update from the console, or run `manage.mjs update` with the Node.js of the installation. See [Configuration](./configuration#lifecycle-commands).

### Docker Compose {#platform-compose}

Update from the console or with `manage.mjs update`. The updater builds the image of the new version, replaces the `backup`, `worker` and `api` containers and keeps the volumes. A Compose installation without `root` needs a scheduled `updates-poll`. See [Docker Compose](./docker#updates-compose).

## After the update {#after}

- Check `arkvory status --root <root>` and sign in to the console.
- Delete versions you no longer need from `releases/`. Keep the current version and the previous one named in `journal.json`. Old versions, download files and staging are never deleted by the updater.
- An update does not upgrade the Node.js of a script installation, the PostgreSQL programs, the operating system or the container engine. Update them separately. A change of the PostgreSQL major version is a migration of its own: back up first.

## Troubleshooting {#troubleshooting}

| What you see                                                             | What to do                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The page says the host updater is not connected                          | Run `arkvory updates-connect --root <root>` in a maintenance window                                                                                                                                                                  |
| The page says the updater has stopped reporting                          | Check the timer or the task. On Linux: `systemctl status arkvory-update.timer` and `journalctl -u arkvory-update`. On Windows: the task `ProAnimaArkvoryUpdate` and `logs\updater.log`. Check that `operation.lock` is not left over |
| The release check failed                                                 | Check access to the hub and GitHub from the server. The services are not affected                                                                                                                                                    |
| The installation was refused because a backup is needed                  | Connect the vault, wait for the first backup, check the status again. See [The backup before an update](#backup)                                                                                                                     |
| The update failed                                                        | Read `journal.json`, the updater log and the service logs before you try again                                                                                                                                                       |
| Manual recovery is required                                              | Follow [Recover an interrupted update](#recover-update)                                                                                                                                                                              |
| The settings changed while the request was waiting                       | Refresh the page and send the request again                                                                                                                                                                                          |
| `Installation is locked`                                                 | Another operation runs, or one crashed. See [Recover an interrupted update](#recover-update)                                                                                                                                         |
| `Interrupted deployment; use recover after inspecting journal.json`      | An earlier update did not finish. Recover first                                                                                                                                                                                      |
| `Downgrades are forbidden`                                               | The version is not newer than the installed one                                                                                                                                                                                      |
| `Version is pinned`                                                      | Remove the pin, or install the pinned version                                                                                                                                                                                        |
| `Interrupted update request; inspect installation and use updates-reset` | A request from the console was accepted but not finished. Check the state, then run `updates-reset`                                                                                                                                  |

More hints are in [Troubleshooting](../operate/troubleshooting) and [Self-healing](../operate/self-healing).
