# ProAnima Arkvory

<img src="branding/icons/arkvory.svg" alt="Arkvory" width="72" height="72">

**English** | [Русский](README.ru.md)

**Your own repository for builds, packages, container images and large files.**

[Documentation](https://proanima.github.io/Arkvory/) · [Download](https://github.com/ProAnima/Arkvory/releases/latest) · [HTTP API](https://proanima.github.io/Arkvory/api/) · [License](LICENSE.md)

A **ProAnimaStudio** product. **Ian Panaev** is the author, copyright holder and owner of the Arkvory and ProAnimaStudio brands. [Brand assets](branding/README.md) · [Product identity](docs/PRODUCT_IDENTITY.md)

## What it is

Arkvory is a self-hosted repository for the files your builds produce. You install it on your own server; it stores builds, packages and large assets and delivers them to the people and systems that need them: deployment agents, CI/CD pipelines, test machines, developers and game teams.

It is a standalone product with its own HTTP API, command-line client and TypeScript SDK, and it also speaks the protocols your tools already use: an OCI registry for Docker and Podman, a Git LFS server and an npm registry for the Unity Package Manager.

## Features

- **Files of any size.** Uploads go in parts and continue after a lost connection or a restart; downloads resume with HTTP ranges. One object can be up to about 10 TiB. Every file is checked by SHA-256.
- **Everything in repositories.** Versioned UPack packages, files by path with their history, container images, Git LFS objects, npm and Unity packages — each stored as an immutable artifact.
- **Access you can explain.** Accounts, groups, personal access tokens and service accounts whose keys get only the repository actions they need. Sign-ins and access changes are audited.
- **Stages and promotion.** Mark a build `qa`, `release` or `prod`, publish it in another repository without a new upload, and let a deployment agent ask for "the newest `release` build in range `^1.4`".
- **Metadata.** Labels, text metadata, collections and attachments: manifests, SBOMs, signatures, reports.
- **Retention.** Keep the last N builds of each package, set quotas and warnings, and free disk space in the background without stopping the server.
- **Backups.** A backup agent copies the database and all content to another disk or a network share on a schedule, verifies the copies and restores into an empty target.
- **Mirrors and read gateways.** A second installation keeps a read-only copy of repositories and serves it when the first site is lost; extra download processes share one bandwidth budget.
- **Runs by itself.** Windows services, Linux packages or Docker Compose. Services restart after a crash or a hang; signed stable updates install by hand or in a maintenance hour, behind a fresh verified backup, with rollback.
- **A console in eleven languages.** English, Russian, Spanish, French, German, Portuguese, Chinese, Japanese, Korean, Hindi and Arabic, light and dark. The documentation is in the same languages.

## Install

| Platform                                  | Package                                                                                | Guide                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Windows 10/11, Windows Server 2019+ (x64) | `Arkvory-Setup-x64.exe` — a wizard with Node.js and PostgreSQL included; works offline | [Windows](https://proanima.github.io/Arkvory/install/windows) |
| Debian, Ubuntu, Fedora, RHEL-compatible   | `Arkvory-amd64.deb`, `Arkvory-x86_64.rpm` with systemd services                        | [Linux](https://proanima.github.io/Arkvory/install/linux)     |
| Any host with Docker                      | Docker Compose: API, worker, backup agent and PostgreSQL                               | [Docker](https://proanima.github.io/Arkvory/install/docker)   |

Download only from [GitHub Releases](https://github.com/ProAnima/Arkvory/releases) and compare the SHA-256 checksums. The server listens on `127.0.0.1:8080` until you set up [HTTPS](https://proanima.github.io/Arkvory/install/https). The console is at `/console/`.

## First steps

1. Install the server and open `http://127.0.0.1:8080/console/`.
2. Create the owner account (the Windows wizard does it for you).
3. Create a personal access token or a service account key.
4. Upload a file and download it:

```bash
curl -T ./Setup.exe -H "Authorization: Bearer $ARKVORY_KEY" \
  http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe
curl -fL -H "Authorization: Bearer $ARKVORY_KEY" -o Setup.exe \
  http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe
```

The full walkthrough: [Quick start](https://proanima.github.io/Arkvory/guide/quick-start).

## Clients and protocols

| Way                                                                           | Use it for                                                                                 |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [Web console](https://proanima.github.io/Arkvory/guide/console)               | Browse, upload and download in a browser; manage users, keys, storage, backups and updates |
| [`arkvoryctl`](https://proanima.github.io/Arkvory/protocols/cli)              | CI scripts: resumable transfers, packages, promotion, backups; `--json` output             |
| [TypeScript SDK](https://proanima.github.io/Arkvory/protocols/sdk)            | Your own tools in Node.js or a browser                                                     |
| [HTTP API](https://proanima.github.io/Arkvory/api/)                           | Integrations in any language; OpenAPI at `/api/v1/openapi.json`                            |
| [Container registry](https://proanima.github.io/Arkvory/protocols/containers) | Docker, Podman, Helm charts, ORAS                                                          |
| [Git LFS](https://proanima.github.io/Arkvory/protocols/git-lfs)               | Large files of git repositories, file locking for Unity and Unreal                         |
| [npm registry](https://proanima.github.io/Arkvory/protocols/unity-npm)        | Unity Package Manager scoped registries, `npm publish`                                     |
| [Raw files](https://proanima.github.io/Arkvory/protocols/raw-files)           | One `curl -T` or PowerShell request by path                                                |

## Documentation

**[proanima.github.io/Arkvory](https://proanima.github.io/Arkvory/)** — installation, everyday work, clients and protocols, operation (backups, mirrors, storage, monitoring, security, troubleshooting) and the HTTP API reference generated from the contract the server enforces. With search, in the eleven languages of the console. The engineering documents (architecture, contracts, decisions) are in Russian in [`docs/`](docs/) and in the site's developers' section.

## Limits

One installation is one server with PostgreSQL and a local content directory: it is not a high-availability cluster. If the server stops, clients wait until it is back; use backups and, where needed, a mirror on a second site. Content storage is a local directory; S3 and encryption of the backup vault are not implemented.

## For developers

Requires Node.js 24 LTS, npm 11 and PostgreSQL 18 (Docker is optional).

```bash
git clone https://github.com/ProAnima/Arkvory.git
cd Arkvory
npm ci
npm run build
npm run gate -- quick
```

Running from source is for development; servers are installed from the release packages. Rules for changes: [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md); layers and boundaries: [ARCHITECTURE](docs/ARCHITECTURE.md); checks: [ENGINEERING_GATES](docs/ENGINEERING_GATES.md); decisions: [ADR](docs/adr/README.md); the documentation site and languages: [WIKI](docs/WIKI.md), [LOCALIZATION](docs/LOCALIZATION.md). Security reports: [SECURITY.md](SECURITY.md).

## License and ownership

**© 2026 Ian Panaev (Ян Панаев), ProAnimaStudio.**

ProAnima Arkvory is free of charge for everyone, companies included, and its source code is open for reading. It is not open source: you may use it and change it within your organization, but you may not distribute copies or forks, sell it or offer it as a service. When you publicly describe a system built on Arkvory, name the source: "ProAnima Arkvory by ProAnimaStudio (Ian Panaev), https://github.com/ProAnima/Arkvory". Copies come only from official sources.

Terms: [license](LICENSE.md) ([на русском](LICENSE.ru.md); the Russian text prevails), notice: [NOTICE.md](NOTICE.md), model: [LICENSING](docs/LICENSING.md). Third-party components retain their own licenses.
