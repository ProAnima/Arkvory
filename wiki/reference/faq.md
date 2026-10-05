---
title: FAQ
description: Short, exact answers to common questions about limits, availability, databases, updates, moving servers, access and the license.
---

# FAQ

## Size and availability {#size-and-availability}

### What is the largest file I can store? {#max-object-size}

10,000 GiB (10 737 418 240 000 bytes). An upload is at most 10,000 parts of at most 1 GiB each. The administrator can set a lower limit with `ARKVORY_MAX_OBJECT_BYTES`. A larger declared size is refused with `400`. In practice, the free disk space, the repository quota and the 1 GiB free-space reserve stop you first: they answer `507`. See [Concepts](../guide/concepts#uploads) and [Environment variables](./environment).

### How much can one server hold? {#capacity}

Arkvory reserves up to 10 TiB of content by default (`ARKVORY_CAPACITY_BYTES`), counting published files, unfinished uploads and content that waits for cleanup. It is a counter, not a disk check. The disk and the reserve are the real limit. A repository can have a quota of its own. See [Storage](../operate/storage).

### Is Arkvory highly available? {#high-availability}

No. One installation is one server with one PostgreSQL database and a local content directory. If the server stops, clients wait and then resume their transfers; the services restart by themselves after a crash or a hang. For protection against the loss of the server, use [backups](../operate/backups). For reading from a second site, use [mirrors](../operate/mirrors); switching to a mirror is a manual step, and changes the mirror had not yet received are lost.

### Does it work offline? {#offline}

The server works without internet access. The Windows installer includes Node.js and PostgreSQL and installs offline. The Linux packages include Node.js, and the package manager installs PostgreSQL. The script installers and Docker download files. Updates can be installed from a local copy of a release. If the update hub cannot be reached, the update check fails and is shown in the console; nothing else is affected. See [Choose an installation](../install/index) and [Updates](../install/updates).

## Storage and database {#storage-and-database}

### Which database does it use? {#database}

PostgreSQL, one database for each installation. The Windows installer includes PostgreSQL 18.4. The Linux packages use a dedicated cluster of a PostgreSQL 16 to 19 server from your distribution. The Docker Compose stack runs PostgreSQL 18.4 in a container. The script installers use your own server. Never connect two installations to one database. File content is not in the database: it is in the data directory.

### Can I use S3 or another object store? {#s3}

No. File content is stored in a local directory, which must be on a local file system that supports hard links, not on a network share. Arkvory does not store content in S3 and does not offer an S3 interface. The backup vault is a folder on another disk or on a mounted network share (on Windows, a local or iSCSI volume).

### Can I use my company's single sign-on? {#sso}

No. Accounts, groups and passwords belong to Arkvory. Automation signs in with service keys. See [Authentication](../api/authentication).

## Running the server {#running}

### How do I see which version is installed? {#version}

In the console, open [[ui:updates]]: [[ui:updateCurrent]] shows it. On the server, run `arkvory status --root <installation root>` and read `current`; on Windows with the graphical installer, run `& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' status --root 'C:\ProgramData\ProAnima\Arkvory'` in an elevated PowerShell. An administrator can also call `GET /api/v1/system/updates`, which returns `currentVersion`. The `arkvoryctl --version` command shows the version of the client, not of the server.

### How do I turn on automatic updates? {#automatic-updates}

In the console, open [[ui:updates]], select [[ui:updateAutomatic]], choose the [[ui:updateHour]] and select [[ui:updateSave]]. On the server, run `arkvory configure --root <installation root> --enable-updates`; `--disable-updates` turns them off. Installers leave them off unless you pass `--automatic`.

The server checks for a release every 6 hours even when automatic installation is off. With it on, a stable release installs once a day during the maintenance hour (03:00 UTC by default), unless the version is pinned. A release that changes the database schema installs only after the server has made and verified a fresh backup. See [Updates](../install/updates).

### What does Arkvory send to ProAnimaStudio? {#hub-traffic}

Your files and data stay on your server. The server contacts the ProAnimaStudio hub (`hub.proanima.net`), and GitHub when the hub cannot be reached, for three things:

- **Update checks.** The request carries the project name, the operating system, the processor architecture, the installed version and the update channel. With statistics on, it also carries a random installation ID.
- **Anonymous statistics.** One event after each installed update, with the installation ID, the version, the system, the architecture and the channel. No names, addresses, content or IP addresses are stored. Statistics are on by default; turn them off with [[ui:updateStatistics]] in [[ui:updates]] or with `arkvory configure --statistics off`. Without statistics, a new version reaches you only when it is rolled out to everyone.
- **Feedback.** Only when a signed-in person sends it from [[ui:reportOpen]]. It contains the message, an optional email address, up to 6 screenshots and the console log. An administrator can add the server log and a summary of versions and states without secrets. [[ui:reportShow]] shows exactly what will be sent.

`arkvory configure --hub-off` stops contacting the hub: releases then come from GitHub only, and feedback turns off after the services restart. An empty `ARKVORY_HUB_URL` turns off feedback alone. See [License](https://github.com/ProAnima/Arkvory/blob/main/LICENSE.md), section 7.

### Do backups run by themselves? {#automatic-backups}

Not until you set them up. Connect a vault with `arkvory configure --backup-vault <folder> --init-vault`, then turn on the daily schedule in [[ui:backupPlan]] in [[ui:backups]]. The plan starts at 02:00 UTC and keeps 7 daily, 4 weekly and 6 monthly restore points. Until the schedule is on, the console shows the warning that the daily schedule is off. See [Backups](../operate/backups).

### How do I move to another server? {#move-server}

1. Install Arkvory of the same or a newer version on the new server.
2. Restore the newest restore point from the vault into an empty database and an empty storage directory with the `arkvory-backup restore` command. It checks every file by SHA-256. See [Backups](../operate/backups).
3. Point `ARKVORY_DATABASE_URL` and `ARKVORY_DATA_DIR` in `config/runtime.json` at the restored database and directory, restart the services, and check the console, a download and an upload.
4. Move the address (DNS or the CI settings) to the new server.

The users, groups and passwords come back. Sessions are not carried over, personal tokens and service keys are revoked, so sign in again and issue new keys. Retention and cleanup policies come back switched off; turn them on on purpose. Uploads that were not finished are cancelled. For a repository that you want to move while the old server keeps running, you can also let the new server follow it as a [mirror](../operate/mirrors) and detach it when you switch; a mirror carries the files, packages and images, but not accounts, keys, attachments or policies.

### What happens to a transfer when the server restarts? {#interrupted-transfers}

The client continues. An upload session lives for 7 days and keeps the parts that arrived; the command-line client and the SDK ask the server what it has and send the rest. A download continues with a `Range` request. A single `PUT` request, such as a raw file or a Docker layer, starts again from the first byte. See [Resume interrupted transfers](../protocols/cli#resume-interrupted-transfers).

### Where do I look when something fails? {#logs}

Every error has a request ID, in the `requestId` field and the `X-Request-Id` header. Find it in the server's access log. The services write their logs to the `logs` folder on Windows and to the journal (`journalctl -u arkvory-api`) on Linux. Send a report with [[ui:reportOpen]] to include the logs. See [Troubleshooting](../operate/troubleshooting) and [Monitoring](../operate/monitoring).

## Access {#access}

### How do I reset the owner's password? {#reset-owner-password}

Another administrator can use [[ui:resetPassword]] in [[ui:administration]]. If nobody can sign in, use the recovery key from `config/bootstrap-token.txt`: find the account's ID with `GET /api/v1/users` and send `PATCH /api/v1/users/<id>` with `{"password": "…"}`. The new password has 12 to 128 characters. The reset ends all sessions and personal tokens of the account. See [Authentication](../api/authentication#recovery-key).

### What is the recovery key, and what if I lose it? {#lost-recovery-key}

It is a secret in `config/bootstrap-token.txt` in the installation root, readable only by the system administrator. It creates the first owner and administers service accounts. The installation tools read the file, so do not delete it. If the file is lost but you still have an administrator account, you can keep working with the account; to make a new recovery key, follow [Configuration](../install/configuration). See [Concepts](../guide/concepts#owner-and-recovery-key).

### Which key should my CI use? {#ci-key}

A service key of a service account whose policy has only the actions the job needs, for example `upload.create`, `upload.write`, `upload.complete`, `upload.read` and `job.read` to publish. The console presets [[ui:bindingRead]] and [[ui:bindingPublish]] fill typical sets. Do not use the recovery key or a person's token in CI. Keys last 90 days by default and are limited to 365, so plan a rotation. See [Authentication](../api/authentication#service-accounts).

### Why can't an administrator delete an artifact or change a storage policy? {#delete-forbidden}

The actions `artifact.delete`, `storage.read`, `storage.manage` and `diagnostics.read` exist only for service keys. A group grant, a personal token, a session and the recovery key never carry them. Create a service account that has these actions on the repository, issue a key, and use that key for the call (the API, `arkvoryctl`, or [[ui:keySignIn]] in the console). The error is `403` with the reason `permission_missing`. See [Authentication](../api/authentication#repository-actions).

### Do Docker, Git LFS and Unity work with it? {#protocols}

Yes. Arkvory serves a container registry at `/v2/`, a Git LFS server at `/lfs/<repository>` and an npm registry at `/npm/<repository>/` that the Unity Package Manager can use. They accept the Arkvory key as the password. See [Clients and protocols](../protocols/index).

## License {#license}

### Is Arkvory open source? {#open-source}

No. Arkvory is free of charge, and its source code is open for reading, but it is not open source. It is under the ProAnima Arkvory License 1.0 of Ian Panaev, which does not allow forks or copies to be distributed. Please do not call it "open source". The full text is in [LICENSE.md](https://github.com/ProAnima/Arkvory/blob/main/LICENSE.md); the Russian text prevails if the two differ.

### What may I do with it? {#license-allowed}

You may install and use any number of copies for any purpose, including in a company; read and study the source; change it; and use your changed version inside your organization. You may store and deliver your own artifacts through it, also to your own customers.

### What is not allowed? {#license-forbidden}

You may not distribute the software or changed versions to anyone outside your organization, publish forks, builds, container images or patches that contain its code, sell, rent or lend it or access to it, charge for it, or offer it to third parties as a hosted or managed service. You may not remove the copyright notices, the license or the names ProAnima Arkvory and ProAnimaStudio, or present a changed version as the original. When you describe a system built on Arkvory in public, name the source: "ProAnima Arkvory by ProAnimaStudio (Ian Panaev), https://github.com/ProAnima/Arkvory". Get copies only from the official sources. For other permissions, write to info@proanima.net.

### Where do I report a problem or a vulnerability? {#report}

For a problem with your installation, use [[ui:reportOpen]] in the console. For a security problem, follow [SECURITY.md](https://github.com/ProAnima/Arkvory/blob/main/SECURITY.md) in the repository and do not post it publicly.
