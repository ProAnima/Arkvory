---
title: Concepts
description: The ideas the rest of the documentation uses, from installation and repositories to access, retention, backups and mirrors.
---

# Concepts

This page explains the words that the other pages use. Each section is short and links to the page that covers the subject in full. For one-line definitions, see the [Glossary](../reference/glossary).

## Installation and its services {#installation}

One installation is one server. It runs three Arkvory services next to one PostgreSQL database:

| Part         | What it does                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API          | The HTTP server: the HTTP API, the [web console](./console), and the registries for containers, Git LFS and npm. It also runs retention and physical cleanup. |
| Worker       | Background jobs: it finishes large uploads and synchronizes mirrors.                                                                                          |
| Backup agent | Scheduled backups into the vault.                                                                                                                             |
| PostgreSQL   | The catalog: artifacts, packages, revisions, accounts, keys and jobs.                                                                                         |

File content lives in a local directory of the server, not in the database. All parts live in the **installation root** (`C:\ProgramData\ProAnima\Arkvory` on Windows, `/opt/proanima-arkvory` on Linux). The services start without a signed-in user and restart after a crash or a hang ([Self-healing](../operate/self-healing)).

A single-server installation is not highly available. If the server stops, clients wait and then continue their transfers. See [Choose an installation](../install/index). On Linux, two or three servers can form a [high availability cluster](../operate/cluster).

## Repositories {#repositories}

A **repository** is a named space for content. It has its own access rules, its own storage policy (quota and retention) and, optionally, a mirror source. A repository name has 1 to 64 characters: lowercase Latin letters, digits, `-` and `_`, starting with a letter or a digit.

You do not create a repository with a separate command. A repository exists as soon as a group is granted access to its name or a service account policy names it. A new installation has a place for the first one, `releases`. See [Repositories](../use/repositories).

## Artifacts {#artifacts}

An **artifact** is one stored file. It is **immutable**: its bytes never change. It has a UUID, a name (up to 240 characters, without `/` or `\`), a size and a SHA-256 checksum. New content makes a new artifact; it never replaces an old one.

An artifact becomes visible only after the server has checked that the bytes match the declared size and SHA-256. A download returns the same bytes, with the checksum as a strong `ETag`. Everything else on Arkvory sits on artifacts: a package version, a revision of a path, a container layer and a Git LFS object are all artifacts.

## Uploads {#uploads}

An **upload** reserves a future artifact. You create an **upload session** with the name, the size and the SHA-256 of the file, and with an `Idempotency-Key` that makes the request safe to repeat. Then you send the bytes:

- in one request, for small and medium files; or
- in **parts**, for large files. The server chooses the part size: 8 MiB at least, doubled for very large files so that the upload never needs more than 10,000 parts. A part never exceeds 1 GiB. Each part carries its own SHA-256, and a repeated part is harmless.

Then you **complete** the upload. The server checks the whole file and publishes it. For large files the worker completes the upload in a **completion job** that the client follows; the SDK and the command-line client choose this for files of 16 GiB and more. An upload session lives for 7 days. An interrupted upload continues from the parts that the server already has. The largest object is 10,000 GiB unless the administrator sets a lower `ARKVORY_MAX_OBJECT_BYTES`.

The [command-line client](../protocols/cli) and the [SDK](../protocols/sdk) do all of this for you. See [Transfers](../use/transfers) and the [Uploads reference](../api/reference/uploads).

## Packages {#packages}

A **package** is a UPack archive that Arkvory has registered. Its identity is a **group**, a **name** and a **SemVer version**, for example `acme` / `game-server` / `1.4.2`. The group is part of the identity: two packages with the same name in different groups are different packages. A published version never changes; publishing the same version with other content is refused.

A deployment agent asks for a package by exact version, by a **version range** such as `^1.4`, or by the newest version at a **stage**. Pre-release versions appear only when you ask for them. See [Packages](../use/packages).

## Files by path {#files-by-path}

A **file by path** has an address such as `builds/game/1.4/Setup.exe` and points at an artifact. When you store new bytes at the path, the path gets a new **revision** (1, 2, 3 and so on). Earlier revisions stay in the **history**, and you can **restore** one: restoring adds a new revision with the old content. Storing the same bytes again adds nothing.

A path has at most 1,024 characters, uses `/` as separator, and has no empty, `.` or `..` segments and no `:`. A change names the revision it expects; if another change came first, the server answers `409`. Use `0` for a path that does not exist yet. See [Files and paths](../use/files) and [Raw files](../protocols/raw-files).

## Labels, metadata, collections and attachments {#annotations}

You can describe an artifact without touching its bytes:

| Item        | Rule                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Labels      | Up to 32 short tags such as `nightly` or `tested`.                                                                                   |
| Metadata    | Up to 32 text fields; a key has up to 64 characters, a value up to 1,024.                                                            |
| Collections | Named sets that group artifacts.                                                                                                     |
| Attachments | Up to 32 links from a build to other artifacts of the same repository: a manifest, an SBOM, a signature, a report or any other file. |

Labels, metadata and collections change as one revisioned set. Attachments have their own revision and history.

## Stages and promotion {#stages-and-promotion}

A **stage** is a controlled mark on a build, such as `qa`, `release` or `prod`. A stage name uses lowercase letters, digits, `.`, `_` and `-` (up to 32 characters), and an artifact can have up to 16 stages. Changing a stage needs its own permission, `artifact.promote`, and each change is recorded with the actor, the time and a comment.

**Promotion** publishes a build in another repository without sending the bytes again. `copy` keeps the source; `move` also removes the build from the source repository. Repeating a promotion returns the copy that exists. **Resolve** finds the build that a stage and a version range point to. See [Promotion](../use/promotion).

## Accounts, groups and permissions {#access}

People use **accounts**. An account has a name (3 to 64 characters) and a password (12 to 128 characters). An **administrator** account manages accounts and groups. Accounts belong to **groups**, and a group is granted `read` or `write` ("Read and write") access to a repository. Rights are recalculated on every request, so a change applies at once.

Automation uses a **service account** instead. Its **policy** lists exact **actions** per repository, such as `upload.create` or `content.read`, and its keys can only narrow that policy. The server checks every action; hiding a button in the console is not a protection. See [Accounts and access](../use/accounts) and [Authentication](../api/authentication).

## Keys and tokens {#keys-and-tokens}

Every request carries a credential. There are four kinds you create, and one built in:

| Credential                | For                                           | Lifetime                                   |
| ------------------------- | --------------------------------------------- | ------------------------------------------ |
| Console **session**       | A person signed in with a name and password   | 12 hours                                   |
| **Personal access token** | One person's scripts and tools                | 90 days by default, at most 365            |
| **Service key**           | CI/CD and deployment agents                   | 90 days by default, at most 365            |
| **Download link**         | Handing one artifact to someone without a key | 60 seconds to 24 hours (1 hour by default) |
| **Recovery key**          | The installation itself                       | Does not expire                            |

A service key is issued once, shown once, and becomes usable only after it is **activated**. You can **rotate** it (issue a new one, then retire the old one) and **revoke** it for good. See [Authentication](../api/authentication).

## The owner and the recovery key {#owner-and-recovery-key}

The **owner** is the first account. It is an administrator and a member of the group `arkvory-owners`, which has `write` access to `releases`. The Windows installer creates it; on Linux and Docker you create it in the console with the recovery key.

The **recovery key** is a secret that the installer writes to `config/bootstrap-token.txt` in the installation root. It can create the first owner and accounts, manage service accounts and their delegations, run backups, and request updates. The installation tools read it on the server. It is not for CI or daily work: keep it on the server and do not copy it. See [Choose an installation](../install/index#recovery-key) and [Security](../operate/security).

## Retention, quotas and cleanup {#retention}

A **storage policy** belongs to a repository. It can keep the last N builds of each package (or of each package and channel), protect labels and stages from removal, wait a minimum age before removing anything, and set a **quota** with warning and critical thresholds. It is off until an administrator turns it on. Removing an artifact is logical first: the bytes stay on disk for a **grace period** (24 hours by default) and then **physical cleanup** frees the space in the background, in small batches, without stopping the server.

The server also keeps a reserve of free disk space (1 GiB by default) that uploads never use. See [Storage](../operate/storage).

## Backups {#backups}

The **backup agent** copies the database and all published content into the **vault**, a folder on another disk or a network share. One complete copy is a **restore point**. The agent verifies every point, applies retention to the points (7 daily, 4 weekly and 6 monthly by default) and lets you **pin** a point so that retention keeps it. The daily schedule is off until an administrator turns it on in [[ui:backupPlan]].

Restoring is a command on the server. It writes into an empty database and an empty storage directory. See [Backups](../operate/backups).

## Mirrors and read gateways {#mirrors-and-gateways}

A **mirror** is a read-only copy of a repository that a second installation keeps by following the first, the **source**. It refuses changes and serves downloads. If the source is lost, an operator detaches the mirror and it becomes an ordinary repository; the switch is manual and is not an automatic failover. See [Mirrors](../operate/mirrors).

A **read gateway** is an extra API process on the same storage that answers only `GET` and `HEAD`. The writer and the gateways share one download bandwidth budget. See [Read gateways](../operate/read-gateways).

## Where to go next {#next}

1. [Quick start](./quick-start): install Arkvory and upload a first file.
2. [Accounts and access](../use/accounts): people, groups, tokens and service keys.
3. [HTTP API overview](../api/index): the rules every integration needs.
4. [Glossary](../reference/glossary): short definitions of every term.
