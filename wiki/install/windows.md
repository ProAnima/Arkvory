---
title: Windows
---

# Windows

There are three ways to run Arkvory on Windows:

- **Graphical installer** `Arkvory-Setup-x64.exe`. Recommended. It installs Windows services and a dedicated PostgreSQL database. It needs no internet access.
- **PowerShell script** `install.ps1`. It installs the same Windows services, but uses your existing PostgreSQL server.
- **Docker Desktop** with `install.ps1 -Mode compose`. For evaluation only. See [Docker Compose](./docker).

## Requirements {#requirements}

- Windows x64, build 10.0.17763 or later (Windows 10 version 1809, Windows Server 2019 or later).
- An account in the Administrators group.
- A local NTFS volume for the data. Network shares are not supported for file storage.
- An installation directory outside user profiles and `AppData`. The service account must be able to read every parent directory.

## Install with the graphical installer {#install-with-the-graphical-installer}

1. Download `Arkvory-Setup-x64.exe` from [GitHub Releases](https://github.com/ProAnima/Arkvory/releases).
2. Run the file and confirm the User Account Control prompt.
3. Select English or Russian and accept the license.
4. Enter the owner account. The name has 3 to 64 characters: Latin letters, digits, dot, dash or underscore. The password has 12 to 128 characters.
5. Wait while Setup prepares the database, the services and the owner account.
6. On the last page, keep **Open Arkvory and finish onboarding** selected and click **Finish**. The console opens at `http://127.0.0.1:8080/console/#onboarding`.

Setup also creates two Start menu shortcuts: **Arkvory** (the console) and **API and CLI** (the help page of the console).

If Setup reports that the Microsoft runtime requires a restart, restart Windows and run Setup again. Existing Arkvory data is kept.

Automatic updates are off after installation. To turn them on, see [Updates](./updates).

### Silent installation {#silent-installation}

For automated deployment, put the owner account into a JSON file. Protect the file so that only SYSTEM and Administrators can read it.

```json
{ "name": "admin", "password": "<at least 12 characters>" }
```

```powershell
.\Arkvory-Setup-x64.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /OWNERFILE="C:\secure\owner.json"
```

The installer deletes the owner file after it creates the account. Never pass a password as a command argument. Without `/OWNERFILE`, create the owner later in the console with the recovery key. Setup exits with a non-zero code when the configuration did not finish. Do not run Setup while an update is running.

## What the graphical installer creates {#what-the-graphical-installer-creates}

| Item                         | Location or value                                                      |
| ---------------------------- | ---------------------------------------------------------------------- |
| Program files                | `C:\Program Files\ProAnima\Arkvory`                                    |
| Data, configuration and logs | `C:\ProgramData\ProAnima\Arkvory` (the installation root)              |
| Database                     | PostgreSQL 18.4 in `database\` of the root, on `127.0.0.1:54329`       |
| Console                      | `http://127.0.0.1:8080/console/`                                       |
| Recovery key                 | `config\bootstrap-token.txt` in the root                               |
| Update task                  | `ProAnimaArkvoryUpdate` in Task Scheduler. Runs every minute as SYSTEM |

### Services {#services}

| Service name      | Display name              | Account                       | Startup type              |
| ----------------- | ------------------------- | ----------------------------- | ------------------------- |
| `Arkvoryapi`      | ProAnima Arkvory api      | `NT AUTHORITY\LocalService`   | Automatic (Delayed Start) |
| `Arkvoryworker`   | ProAnima Arkvory worker   | `NT AUTHORITY\LocalService`   | Automatic (Delayed Start) |
| `Arkvorybackup`   | ProAnima Arkvory backup   | `NT AUTHORITY\LocalService`   | Automatic (Delayed Start) |
| `Arkvorydatabase` | ProAnima Arkvory database | `NT AUTHORITY\NetworkService` | Automatic                 |

The services run without a signed-in user. API, worker and backup agent share the LocalService account. The database runs under NetworkService, so the API account cannot read the database files.

The root grants full control to SYSTEM and Administrators only. LocalService can read the root and can change only `data\`, `logs\` and the update inbox. The recovery key and the other credential files of the installer are readable only by SYSTEM and Administrators.

## Install with PowerShell and an existing PostgreSQL {#install-with-powershell-and-an-existing-postgresql}

Use this method if your organization already runs PostgreSQL. It creates no managed database service and no entry in **Apps**.

1. Ask your database administrator for an empty database and a role that owns it. Arkvory runs its migrations with this role.
2. Download `install.ps1` from the release and review it.
3. Open Windows PowerShell **as Administrator** and run:

```powershell
.\install.ps1 -AutomaticUpdates
```

The script asks for the PostgreSQL connection URL. The input is hidden. It then downloads Node.js 24.21.0 from `nodejs.org`, checks its SHA-256, and installs the latest stable release.

Instead of the prompt, you can pass a protected JSON file:

```json
{ "ARKVORY_DATABASE_URL": "postgresql://arkvory:<password>@db.example:5432/arkvory" }
```

```powershell
.\install.ps1 -Config C:\secure\arkvory.json
```

If PowerShell blocks scripts, run `powershell -ExecutionPolicy Bypass -File .\install.ps1`. This changes the policy only for this process.

| Parameter                    | Meaning                                                           |
| ---------------------------- | ----------------------------------------------------------------- |
| `-Root <path>`               | Installation root. Default: `C:\ProgramData\ProAnima\Arkvory`     |
| `-Version <x.y.z>`           | Install this stable version instead of the latest one             |
| `-Mode windows` or `compose` | Windows services (default) or [Docker Compose](./docker)          |
| `-Engine docker` or `podman` | Container engine for Compose                                      |
| `-Config <file>`             | JSON file with `ARKVORY_*` settings, including the database URL   |
| `-Artifact <directory>`      | Install from an extracted `Arkvory-Windows.zip` instead of GitHub |
| `-AutomaticUpdates`          | Turn on automatic updates                                         |
| `-Pin`                       | Pin the installed version                                         |

Give `-Root`, `-Config` and `-Artifact` as absolute paths, for example `-Artifact $PWD.Path`.

The script does not create an owner account. Open `http://127.0.0.1:8080/console/` on the server, select **[[ui:welcomeOwner]]** and enter the recovery key from `config\bootstrap-token.txt`.

## Manage the services {#manage-the-services}

```powershell
Get-Service Arkvoryapi, Arkvoryworker, Arkvorybackup, Arkvorydatabase
Restart-Service Arkvoryapi, Arkvoryworker
sc.exe qfailure Arkvoryapi
```

The management command needs an elevated PowerShell and always the `--root` option:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
# Graphical installer
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' status --root $root
# Script installation
& "$root\runtime\node-v24.21.0-win-x64\node.exe" "$root\manage.mjs" status --root $root
```

Run `arkvory.ps1 help` to see all commands. The commands are described in [Configuration](./configuration) and [Updates](./updates).

## Recovery after a failure {#recovery-after-a-failure}

- When a service process stops without a request, Windows starts it again after 10 seconds. The failure count resets after one hour.
- A process whose main thread hangs for 60 seconds ends itself, and Windows starts it again. See [Self-healing](../operate/self-healing).
- A failed readiness check alone does not restart a service (for example while the server drains). But when the database stops answering, the API and the worker cannot confirm that they own the storage: after about 8 seconds they end themselves, and Windows starts them again every 10 seconds until the database is back.
- A service that you stop yourself stays stopped until you start it or Windows restarts.

Running the graphical installer again restores the startup type and the recovery actions of the services.

## Logs {#logs}

| Location in the root | Content                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `logs\`              | Output of the API, worker and backup agent. Files rotate at 20 MiB; 5 old files are kept |
| `logs\updater.log`   | Output of the update task, with the same rotation                                        |
| `database\`          | Logs of the database service (`arkvory-database*.log`)                                   |
| `bootstrap.log`      | Output of the configuration step of the graphical installer                              |

Setup also writes its own log to the temporary folder of the user who ran it. API and worker write one JSON record per line. See [Monitoring](../operate/monitoring).

## Uninstall {#uninstall}

Open **Settings > Apps**, select **ProAnima Arkvory** and click **Uninstall**. The uninstaller:

1. Removes the `ProAnimaArkvoryUpdate` task.
2. Stops and removes `Arkvorybackup`, `Arkvoryworker`, `Arkvoryapi` and `Arkvorydatabase`.
3. Removes the program files.

It intentionally **keeps** `C:\ProgramData\ProAnima\Arkvory`: the database, all files, the configuration and the recovery key. It never touches the backup vault. If you run Setup of the same or a newer version later, it continues with the kept data. To remove the data, make a backup first and then delete the folder yourself.

A script installation has no uninstaller. To remove its services, run in an elevated PowerShell:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
Unregister-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Confirm:$false
foreach ($role in 'backup', 'worker', 'api') {
  $exe = "$root\service\arkvory-$role.exe"
  if ((Get-Service "Arkvory$role").Status -ne 'Stopped') { & $exe stopwait }
  & $exe uninstall
}
```

## Docker Desktop {#docker-desktop}

Docker Desktop is an application of one user. Its containers run only after this user signs in and Docker Desktop starts. After a restart of the computer, Arkvory is not available until then. If you install with Docker Desktop, enable **Settings > General > Start Docker Desktop when you sign in**. The installer and the `status` command warn when this setting is off. For a server that must start without sign-in, use the native services described on this page.

## Troubleshooting {#troubleshooting}

| Problem                                                                  | What to do                                                                                                                                     |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup says that the configuration did not finish                         | Read `bootstrap.log`, the Setup log and the database logs. Do not delete the database folder                                                   |
| `database\bootstrap-started` exists, but `database\initialized` does not | Database creation was interrupted. Do not delete the cluster and do not repeat SQL by hand. Fix the cause and run the `finish-install` command |
| `Run installer as Administrator`                                         | Start PowerShell with **Run as administrator**                                                                                                 |
| `Use a dedicated directory`                                              | The root already contains files. Use an empty directory. Manage an existing installation with its commands                                     |
| `Node.js runtime is incomplete after extraction`                         | Check the quarantine of your antivirus software                                                                                                |
| `Another installation owns this service`                                 | Services of an installation in another root exist. Remove them first                                                                           |

To finish an interrupted installation without deleting data:

```powershell
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' finish-install --root C:\ProgramData\ProAnima\Arkvory
```

More hints are in [Troubleshooting](../operate/troubleshooting).
