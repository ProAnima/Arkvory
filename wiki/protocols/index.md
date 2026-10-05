---
title: Clients and protocols
---

# Clients and protocols

Arkvory has one storage and one access model, but several ways to reach it. Each way is a client or a protocol that a tool already speaks. All of them store data as Arkvory artifacts. So the same permissions, quotas, SHA-256 checks, retention rules, backups and mirrors apply, whichever way you use.

This page lists every way to talk to Arkvory, what each way is for and which credentials it accepts. Use it to choose the right tool for a task.

## Overview {#overview}

| Way                       | Address                                        | Use it for                                                                            | Credentials                                                                       |
| ------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Web console               | `https://arkvory.example/console/`             | Browse repositories, upload and download in a browser, manage users, keys and backups | Sign-in with a user name and password, or a service key                           |
| `arkvoryctl` command line | `/api/v1`                                      | CI scripts, resumable uploads and downloads, files by path, promotion, backups        | Key from a file or an environment variable (sent as Bearer)                       |
| TypeScript SDK            | `/api/v1`                                      | Your own tools in TypeScript or JavaScript, in Node.js or a browser                   | Key from a callback (sent as Bearer)                                              |
| REST API                  | `/api/v1/...`                                  | Integrations in any language                                                          | `Authorization: Bearer <key>` only                                                |
| Container registry (OCI)  | `/v2/`                                         | Docker, Podman, Buildx, containerd, Helm charts, ORAS artifacts                       | Basic with the key as the password (`docker login`), or Bearer                    |
| Git LFS                   | `/lfs/<repository>`                            | Large files of a git repository, file locking for Unity and Unreal                    | Basic with the key as the password (git credential helper), or Bearer             |
| npm registry              | `/npm/<repository>/`                           | Unity Package Manager scoped registries, `npm publish` and `npm install`              | Bearer (`_authToken` in `.npmrc`, `token` in `.upmconfig.toml`), or Basic `_auth` |
| Raw files by path         | `/api/v1/repositories/<repository>/raw/<path>` | One request with `curl -T` or PowerShell                                              | `Authorization: Bearer <key>` only                                                |

The routes under `/v2`, `/lfs` and `/npm` follow the specifications of their protocols. They are not part of the OpenAPI document of `/api/v1`, and they report errors in the format that their clients expect.

## Credentials {#credentials}

Every request needs a credential, except public health checks. Arkvory accepts these kinds:

| Kind                  | Looks like         | Where it comes from                                                                                                   | Typical use                                     |
| --------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Personal access token | `pat_...`          | Created by a user in the console. Scope `read` or `read-write`. Expires (90 days by default, at most 365).            | Developers: Unity, git, Docker on a workstation |
| Service key           | `arkvory_...`      | Issued for a service account, with exact actions per repository, with the recovery key or by a delegated operator key | CI/CD, deploy agents, build servers             |
| File key              | any secret         | The server keys file (`ARKVORY_KEYS_FILE`), with `read` or `write` per repository; the owner key also administers     | Installation owner, legacy integrations         |
| Session               | `dps_...`          | Console sign-in; valid for 12 hours                                                                                   | Interactive console work                        |
| Download link         | URL with `?token=` | Created for one artifact; 60 seconds to 24 hours                                                                      | Handing one file to someone without a key       |

The protocols differ only in how they send the key:

- `/api/v1`, the CLI, the SDK and raw files use `Authorization: Bearer <key>`.
- `/v2`, `/lfs` and `/npm` also accept HTTP Basic. The user name is not checked. The password is the Arkvory key. This is how `docker login`, git credential helpers and npm `_auth` send credentials.
- A read-only personal token never changes data. It can still download Git LFS objects, because the Git LFS batch request is a `POST` for downloads too.

How to create tokens and keys: [Accounts and keys](../use/accounts). Header details: [Authentication](../api/authentication).

## Which one should I use? {#which-one-should-i-use}

| Task                                                                               | Recommended way                                                      |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Upload a build artifact from CI and resume it after a network failure              | [`arkvoryctl upload`](./cli) or [`arkvoryctl put`](./cli)            |
| Publish a UPack package from CI                                                    | [`arkvoryctl packages publish`](./cli)                               |
| Deploy "the newest 1.4 release" to a server                                        | [`arkvoryctl packages download --range ^1.4 --stage release`](./cli) |
| Put a small or medium file by path from a shell script without installing anything | [Raw files](./raw-files) with `curl -T` or PowerShell                |
| Store container images or Helm charts                                              | [Container images](./containers)                                     |
| Keep textures, models and levels of a game outside the git host                    | [Git LFS](./git-lfs)                                                 |
| Share Unity packages between projects                                              | [Unity and npm packages](./unity-npm)                                |
| Build your own tool or web interface                                               | [TypeScript SDK](./sdk)                                              |
| Integrate from Python, Go, C# or another language                                  | [REST API](../api/index)                                             |
| Look around, manage users, keys and backups                                        | [Web console](../guide/console)                                      |

Rules of thumb:

- **Large files (many gigabytes):** use `arkvoryctl` or the SDK. They upload in parts and continue after an interruption. A single `PUT` request (raw files, Git LFS objects, npm publish, a Docker layer) starts again from byte zero after a failure.
- **Tool already speaks a protocol:** use that protocol. Docker, git and Unity need no extra software.
- **Machine reads only:** give it a read-only token or a service key with read actions only.

## Shared rules {#shared-rules}

**HTTPS.** Use HTTPS for every client. The CLI and the SDK refuse plain HTTP except on loopback (`localhost`, `127.0.0.1`, `[::1]`). Docker needs a trusted certificate. Git sends the key with every request. See [HTTPS](../install/https).

**Same storage.** An image layer, a Git LFS object, an npm tarball and a raw file are all artifacts. They count against repository quotas and installation capacity. They are verified by SHA-256 when they are stored. They are included in backups.

**Read gateways and mirrors.** A read gateway accepts only `GET` and `HEAD`. A mirror is a read-only copy of a repository on another installation.

| Way                 | On a read gateway                             | On a mirror                                         |
| ------------------- | --------------------------------------------- | --------------------------------------------------- |
| `/api/v1`, CLI, SDK | Reads only                                    | Reads; changes are refused (`409 mirror_read_only`) |
| Container registry  | Pull                                          | Pull; push is refused                               |
| Git LFS             | Not supported (the batch request is a `POST`) | Clone and fetch; push and locks are refused         |
| npm registry        | Install and search                            | Install and search; publish is refused              |
| Raw files           | `GET` and `HEAD`                              | `GET` and `HEAD`                                    |

See [Read gateways](../operate/read-gateways) and [Mirrors](../operate/mirrors).

## Related pages {#related-pages}

- [Command line (arkvoryctl)](./cli)
- [TypeScript SDK](./sdk)
- [Container images](./containers)
- [Git LFS](./git-lfs)
- [Unity and npm packages](./unity-npm)
- [Raw files](./raw-files)
- [API overview](../api/index) and [Errors](../api/errors)
