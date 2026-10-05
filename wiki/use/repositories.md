---
title: Repositories
description: What a repository is, how to see the repositories you may use, how to pick one in the console, and what read-only repositories are.
---

# Repositories

A repository is a named place in Arkvory where files are stored and where access is decided. Everything you publish goes into one repository, and every request names it.

## What a repository is {#what-it-is}

A repository has an ID: lowercase Latin letters, digits, `-` and `_`, starting with a letter or a digit, at most 64 characters. Examples are `releases`, `builds` and `game-prod`. The ID is part of every address:

| What                                          | Address                               |
| --------------------------------------------- | ------------------------------------- |
| Artifacts, packages, files by path (HTTP API) | `/api/v1/repositories/<repository>/…` |
| Container images                              | `/v2/<repository>/<image>/…`          |
| Git LFS                                       | `/lfs/<repository>`                   |
| npm and Unity packages                        | `/npm/<repository>/…`                 |

See [Container images](../protocols/containers), [Git LFS](../protocols/git-lfs) and [Unity and npm](../protocols/unity-npm).

A repository holds immutable artifacts. Two views of them exist: UPack packages with a version ([Packages](./packages)) and files by path with a history ([Files by path](./files)). Stages and promotion move builds between repositories ([Stages and promotion](./promotion)).

Today a repository has no display name, no description and no settings of its own beyond access, [storage settings](#settings) and, for a copy of another server, its [mirror state](#read-only). You cannot rename a repository. You cannot delete one: take access away and the files stay on disk.

## Create a repository {#create}

There is no command that creates a repository. A repository exists as soon as access to it is granted. The repository is empty until the first upload.

An administrator does one of these:

- Give a group access to the new name. In the console, open [[ui:administration]], expand [[ui:manageGrants]], choose the group, type the name in [[ui:repository]], choose [[ui:read]] or [[ui:write]] and select [[ui:saveGrant]]. The group `arkvory-owners`, to which the owner belongs, is a good choice for the first grant. See [Groups and repository access](./accounts#groups).
- Name the repository in the policy of a service account. See [Service accounts and keys for CI](./accounts#service-accounts).

With the API, `setGroupGrant` and `setServicePolicy` do the same. A typing error creates a new, wrong name: check the spelling. The name `releases` exists after installation, with write access for the group `arkvory-owners`.

## See the repositories you may use {#list}

You see only the repositories your credential has a right in. A repository you have no right in does not appear, and asking for it directly returns `404`. An empty repository you have access to appears too.

In the console, open [[ui:repositories]]. Each card shows the repository name and, under [[ui:repositoryRights]], the actions you hold there. The buttons are:

- [[ui:repositoryOpen]] opens the catalog of the repository. It appears when you may list artifacts.
- [[ui:repositoryStorage]] opens the catalog with the storage settings. It appears when you may read the storage policy or diagnostics.
- [[ui:repositoryAccess]] leads to user and service administration. It appears for administrators and service administrators.

The list shows 50 repositories at a time; [[ui:managementMore]] loads the next page and [[ui:managementReload]] refreshes it. A mirror shows the [[ui:mirrorBadge]] badge.

With `arkvoryctl`:

```bash
arkvoryctl repositories
arkvoryctl doctor
```

`repositories` prints each repository with its `formats` and your `permissions`. When the answer has a `next` value, pass it as `--after`. `doctor` shows the server, the capabilities and the permissions of the current key.

With the API, `listRepositories` takes `limit` (1 to 100, 50 by default) and `after`, the last ID of the previous page. `getRepository` returns one card.

```bash
curl -H "Authorization: Bearer $ARKVORY_KEY" "$ARKVORY/api/v1/repositories?limit=100"
```

```typescript
const page = await client.repositories({ limit: 50 });
const card = await client.repository('releases');
```

A card is `id`, `formats` (always `upack` and `assets`) and `permissions`. It tells nothing about the size or the number of files. See [Permissions](./accounts#permissions) for the action names.

## Choose a repository in the console {#choose}

The [[ui:connection]] card has the field [[ui:repository]] with a list of the repositories you may read. The field starts with `releases`. After you sign in, the console keeps it if you can read it, and otherwise picks the first repository you can read. To work in another one, type its name or choose it from the list. The catalog, packages, uploads and details then use that repository. [[ui:repositoryOpen]] on a card fills the field for you.

The address of an artifact in the console contains its repository: `#/artifact/<repository>/<id>`. A link to an artifact in a repository you cannot read shows a message and the catalog.

`arkvoryctl` uses the repository of the profile, `releases` unless you set another one when you add the profile. Override it for one command with `--repository`:

```bash
arkvoryctl profile add production --server https://arkvory.example --token-file ~/.arkvory/key --repository builds
arkvoryctl list --repository releases
```

In the SDK, `client.inRepository('builds')` returns a client bound to one repository. In HTTP, the repository is in the path.

## Repository settings {#settings}

What you can set for a repository today:

- **Access.** Who may read and write. See [Accounts and access](./accounts).
- **Storage.** A quota in GiB, warning and critical thresholds, retention (keep the last N builds of each package and channel, protected labels, a minimum age), automatic cleanup and physical cleanup. The settings need the actions `storage.read` to look and `storage.manage` to change; a person's group level does not give them, a service key does. In the console they are under [[ui:storageTitle]], which [[ui:repositoryStorage]] opens. With `arkvoryctl`, `storage usage` and `storage policy` read them. A new upload that would pass the quota is refused with `507 storage_quota`. See [Storage and retention](../operate/storage).
- **Mirror.** A server administrator can make the repository a copy of another server's repository. See the next section.

## Read-only repositories {#read-only}

A **mirror** is a read-only copy of a repository of another Arkvory server. The server keeps it in step by itself. Everyone with the right to read can list and download. Nobody can change it: upload, publish, change labels, add stages, assign paths and delete are all refused with `409 mirror_read_only`, whatever the person's group level or the key's actions are. To change the content, use the main server.

The console shows a mirror with a badge above the catalog and hides the upload button:

| Badge                | Meaning                                                 |
| -------------------- | ------------------------------------------------------- |
| [[ui:mirrorBadge]]   | The copy is up to date                                  |
| [[ui:mirrorBehind]]  | The server is still catching up                         |
| [[ui:mirrorFailing]] | The last synchronization failed; downloads keep working |

Select [[ui:mirrorHelpLabel]] next to the badge for the source, the time of the last synchronization and the error code.

A second kind is an **import**. It is an ordinary repository that takes over, automatically, the versions that carry certain stages in a repository of another server (for example from `dev` to `prod`). Its badge is [[ui:mirrorImport]]. Uploads to it stay possible, and later changes or deletions at the source do not affect what was copied.

With the API, `getRepositoryMirror` returns the state: `mode` (`mirror` or `import`), `phase` (`pending`, `seeding` or `following`), `caughtUp`, `syncedAt` and `errorCode`. It answers `404` for an ordinary repository.

Mirrors are set up by the server administrator. See [Mirrors](../operate/mirrors). A **read gateway** is a different thing: an address that only serves downloads for the same repositories. Changes through it are refused with `405 read_only`. See [Read gateways](../operate/read-gateways).

## Related pages {#related-pages}

- [Accounts and access](./accounts)
- [Files by path](./files) and [Packages](./packages)
- [Storage and retention](../operate/storage)
- API reference: [Repositories](../api/reference/repositories), [Mirrors](../api/reference/mirrors)
