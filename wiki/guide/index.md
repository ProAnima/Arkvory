---
title: Overview
description: 'ProAnima Arkvory is a self-hosted repository for build artifacts and files: what it stores, what it can do and how it runs.'
---

# Overview

ProAnima Arkvory is a self-hosted repository for build artifacts and files. You install it on your own server. It stores the files that your builds produce and delivers them to the people and systems that need them: deployment agents, CI/CD pipelines, test machines and developers.

Arkvory is free for everyone, including companies. Its source code is open for reading, but it is not open source. You may use and change it inside your organization. You may not distribute copies, sell it or offer it as a service. See the [license](https://github.com/ProAnima/Arkvory/blob/main/LICENSE.md).

## Who it is for {#who-it-is-for}

- **CI/CD engineers** who need one place to publish builds, find a build by version or stage, and download it in a deployment job.
- **Administrators** who want a storage service that runs on one server, restarts by itself, makes its own backups and updates itself.
- **Game studios** that work with Unity or Unreal Engine. Arkvory stores large binary assets through Git LFS, Unity packages through an npm registry, and build outputs of tens of gigabytes.
- **Teams with several sites** that want a read-only copy of a repository near the people who download from it.

## What it stores {#what-it-stores}

Everything is kept in **repositories**. A repository can hold several kinds of content at the same time:

| Content                | How you work with it                                                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Artifacts (any file)   | Upload with the console, the [command-line client](../protocols/cli), the [SDK](../protocols/sdk) or the HTTP API                                         |
| UPack packages         | Versioned packages with a group, a name and a SemVer version. See [Packages](../use/packages).                                                            |
| Files by path          | A path such as `builds/game/1.4/Setup.exe` that keeps every earlier version. See [Files and paths](../use/files) and [Raw files](../protocols/raw-files). |
| Container images       | An OCI registry for Docker, Podman, Helm and ORAS. See [Container images](../protocols/containers).                                                       |
| Git LFS objects        | A Git LFS server with file locking. See [Git LFS](../protocols/git-lfs).                                                                                  |
| npm and Unity packages | An npm registry that the Unity Package Manager can use. See [Unity and npm](../protocols/unity-npm).                                                      |

Each stored file is an immutable **artifact** with a SHA-256 checksum. New content never replaces old bytes; it creates a new artifact. See [Concepts](./concepts).

## Main capabilities {#main-capabilities}

- **Large files.** Uploads are sent in parts and can continue after a network failure or a restart. One object can be up to about 10 TiB. Downloads support HTTP ranges, so they can continue too.
- **Access control.** User accounts, groups, personal access tokens and service accounts with keys. Each key gets only the repository actions it needs.
- **Stages and promotion.** Mark a build as `qa`, `release` or `prod`, or publish it in another repository without a new upload. A deployment agent can ask for "the newest `release` build in range `^1.4`".
- **Metadata.** Labels, text metadata, collections and attached files such as manifests, SBOMs and signatures.
- **Retention.** Keep the last N builds of each package, set quotas, and remove old content in the background.
- **Backups.** A backup agent copies the database and all content into a vault on another disk or NAS, on a daily schedule that an administrator turns on, and verifies the copies.
- **Mirrors.** A second installation can keep a read-only copy of a repository and serve it when the main server is not available.
- **Read gateways.** Extra download processes on the same shared storage share one download budget.
- **Self-healing.** The services restart after a crash or a hang. Long transfers can continue after the restart.
- **Updates.** The server checks for signed stable releases that ProAnimaStudio approves in its hub. It installs them by hand or automatically in a maintenance hour, and can return to the previous version.
- **Web console.** Light and dark themes, in eleven languages: English, Russian, Spanish, French, German, Portuguese, Chinese, Japanese, Korean, Hindi and Arabic (right to left). This documentation is in the same languages. See [The web console](./console).

## How it runs {#how-it-runs}

Arkvory runs on one server. It uses PostgreSQL for the catalog and a local directory for the content. Three services work together:

| Service      | Purpose                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| API          | The HTTP server: the API, the console and the registries. It also runs retention and physical cleanup. |
| Worker       | Background jobs: finishing large uploads and synchronizing mirrors                                     |
| Backup agent | Scheduled backups into the vault                                                                       |

You can install it in three ways:

| Platform                      | Installer                                 | Details                                                                                                                                                      |
| ----------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows 10/11, Windows Server | `Arkvory-Setup-x64.exe`                   | A setup wizard. It includes Node.js and PostgreSQL and works without internet. The services run without a signed-in user. See [Windows](../install/windows). |
| Linux                         | `Arkvory-amd64.deb`, `Arkvory-x86_64.rpm` | Packages for apt and dnf, with systemd services. See [Linux](../install/linux).                                                                              |
| Docker                        | Docker Compose                            | The API, worker, backup agent and PostgreSQL in containers. See [Docker](../install/docker).                                                                 |

By default, the server listens only on `127.0.0.1:8080`. Before other machines connect, set up [HTTPS](../install/https).

One installation is one server. It is not a high-availability cluster: if the server stops, clients wait until it is back. Use [backups](../operate/backups) and, if needed, [mirrors](../operate/mirrors) on a second site.

## Where to go next {#where-to-go-next}

1. [Quick start](./quick-start): install Arkvory and upload your first file.
2. [Concepts](./concepts): the words that the rest of the documentation uses.
3. [Installation](../install/index): requirements and options for each platform.
4. [Command-line client](../protocols/cli): use Arkvory from scripts and CI.
5. [Backups](../operate/backups): protect your data before you go to production.
