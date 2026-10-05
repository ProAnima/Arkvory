---
title: Git LFS
description: Store the large files of a git repository in Arkvory and lock binary assets, for example for Unity and Unreal projects.
---

# Git LFS

Every Arkvory repository is a Git LFS server. Your git repository stays where it is, for example on GitHub, GitLab or Gitea. Only the large files that Git LFS tracks, and the file locks, go to Arkvory. LFS objects are ordinary artifacts, so repository permissions, quotas, SHA-256 checks, backups and mirrors apply to them.

## Set up a git repository {#set-up}

You need the address of the server with HTTPS (see [HTTPS](../install/https)), an Arkvory repository, for example `games`, and a key (see [Accounts and keys](../use/accounts)).

1. Install Git LFS on every machine that uses the repository, and run `git lfs install` once per user.
2. Create the file `.lfsconfig` in the root of the git repository and commit it. It makes the whole team use Arkvory:

```ini
[lfs]
	url = https://arkvory.example/lfs/games
```

3. Track the file patterns. This writes `.gitattributes`, which you commit too:

```bash
git lfs track "*.psd" "*.fbx" "*.wav" "*.uasset" "*.umap"
git add .gitattributes .lfsconfig
```

4. Commit and push as usual. The first request asks for credentials: see [Sign in](#sign-in).

The LFS address of a repository is always `https://<host>/lfs/<repository>`.

To move files that already are in LFS on another server, first download all objects from the old server, then switch `lfs.url` and upload them:

```bash
git lfs fetch --all origin
git config lfs.url https://arkvory.example/lfs/games
git lfs push --all origin
```

## Sign in {#sign-in}

Arkvory takes its key as the password of HTTP Basic authentication. The user name is not checked: use any name. The key can also come as a Bearer token.

Git asks for the user name and password through its credential helper the first time the server answers `401`. The helper saves them: Git Credential Manager on Windows and macOS, `credential.helper store` or `cache` on Linux.

| Who              | Key                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| Developer        | A personal access token. Scope `read-write` for push and locks, scope `read` for clone and pull only. |
| Build server, CI | A service key with the actions in [Permissions](#permissions)                                         |

Git keeps credentials per host. The key for Arkvory does not replace the credential for the host of your git repository, for example GitHub.

On a CI runner without a credential helper, put the key in the local configuration of the checkout. The key then lives only in `.git/config` of that workspace, never in `.lfsconfig`:

```bash
git config lfs.url "https://ci:${ARKVORY_KEY}@arkvory.example/lfs/games"
```

Do not commit a key. Do not print it in logs. Remove the workspace after the job.

## Daily work {#daily-work}

Git LFS works as with any LFS server. The commands you use:

| Command                                 | What it does                                                            |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `git push`                              | Uploads new LFS objects to Arkvory before it pushes the commits         |
| `git clone`, `git pull`, `git checkout` | Download the objects the working tree needs                             |
| `git lfs fetch --all`                   | Downloads the objects of all branches                                   |
| `git lfs ls-files`                      | Lists tracked files and their short IDs                                 |
| `git lfs push --all origin`             | Uploads all local objects again. Objects that Arkvory has are not sent. |

An object that Arkvory already has, with the same ID and size, is not sent again. A push repeated after an interruption sends only what is missing.

## Lock files {#locks}

Binary assets cannot be merged. A lock tells the team that one person edits a file. Locks belong to the Arkvory repository, not to a branch.

```bash
git lfs lock Content/Maps/Level01.umap
git lfs locks
git lfs unlock Content/Maps/Level01.umap
```

- A second `git lfs lock` on the same path fails with "already created lock" and names the owner.
- The owner is shown by the name of the user or of the service account when the lock was made. A file key shows its ID.
- Only the owner unlocks a file. `git lfs unlock --force` on a lock of someone else needs a service key with the action `artifact.delete` in the repository. Personal tokens cannot break locks.
- A lock path is a path of the git repository: up to 1024 characters, with `/` between folders, and without empty segments, `.` or `..`, a backslash or a colon.
- `git lfs locks` shows 100 locks per page.

Turn on the check before push, so that git refuses to push changes to files that others locked. The setting is per server address:

```bash
git config lfs.https://arkvory.example/lfs/games.locksverify true
```

Mark the file types that should be locked before editing. Git LFS then keeps them read-only until you lock them:

```bash
git lfs track --lockable "*.umap" "*.uasset"
```

The lock check at push needs write access, so a read-only token cannot use it. Use `git lfs locks` to list locks, which read access allows.

## Unity and Unreal tips {#game-engines}

- Unity: keep the text assets (`.unity`, `.prefab`, `.asset`) in git and set the asset serialization to Force Text. Track the large binaries in LFS, for example `*.png`, `*.psd`, `*.fbx`, `*.wav`, `*.mp4`, `*.exr`. Text files that you do track in LFS are accepted too.
- Unreal Engine: track `*.uasset`, `*.umap` and the large source files, and mark `*.uasset` and `*.umap` as lockable.
- Editor integrations that call the LFS locking commands use the standard file locking protocol of Git LFS. Arkvory is tested with the `git` and `git-lfs` command-line clients.
- Do not put changing build outputs of tens of gigabytes in LFS. Upload them as artifacts or [raw files](./raw-files) with [`arkvoryctl`](./cli). LFS objects are never deleted by retention, so they stay forever.
- Large reusable code or tools that Unity projects share are better served by [Unity packages](./unity-npm).

## What is stored {#what-is-stored}

- An LFS object is an artifact in the Arkvory repository. Its name and its identity are the SHA-256 of its content (the `oid` of LFS), and it has the label `lfs`. You see these artifacts in the console under [[ui:catalog]].
- Arkvory verifies the size and the SHA-256 while it receives the object. If they differ from the `oid`, the upload fails with `422` and nothing is stored.
- An object belongs to the repository. Two Arkvory repositories hold their own copies of the same file.
- Retention never removes LFS objects, because the server cannot see which commits still need them. There is no command to delete an LFS object. Plan the quota of the repository for the whole history of the assets.
- Locks are rows in the database. Backups include them.

## Permissions {#permissions}

Personal tokens and file keys get read or write access to the repository. Service keys get exact actions.

| Operation                                  | Service key actions | Personal token or file key             |
| ------------------------------------------ | ------------------- | -------------------------------------- |
| Download (`clone`, `fetch`, `pull`)        | `content.read`      | Read access                            |
| Upload (`push`)                            | `upload.create`     | Write access, token scope `read-write` |
| List locks                                 | `artifact.list`     | Read access                            |
| Create, verify and release own locks       | `upload.create`     | Write access, token scope `read-write` |
| Release a lock of someone else (`--force`) | `artifact.delete`   | Not possible                           |

A CI job that pushes and pulls needs `content.read`, `upload.create` and `artifact.list`. A key that may only push still learns that an object exists, so it does not upload it twice.

A read-only personal token can clone and pull although the request for the download list is a `POST`. It cannot push or lock. A mirror and a read gateway are covered in [Mirrors and read gateways](#mirrors-and-read-gateways).

## How the transfer works {#how-it-works}

You do not need these details for daily work. They help when you debug a proxy or a firewall.

1. Git LFS sends one `POST /lfs/<repository>/objects/batch` with the operation (`download` or `upload`) and the list of objects. Up to 1000 objects per request. Git LFS sends at most 100 by default.
2. Arkvory answers with a link for each object that must be transferred, valid for one hour. For an upload it leaves out the objects it already has.
3. Git LFS sends each object with `PUT`, or downloads it with `GET`, to `/lfs/<repository>/objects/<oid>`. The request carries the same key as the batch request.
4. A `PUT` needs a `Content-Length` header. A chunked upload is refused with `422`.

Supported:

| Item             | Value                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| Transfer adapter | `basic` only                                                                                               |
| Hash algorithm   | `sha256` only. A client that asks for another one gets `409`.                                              |
| Authentication   | Basic (key as password) or Bearer                                                                          |
| Download         | `GET` and `HEAD` with `Range` requests                                                                     |
| Media type       | `application/vnd.git-lfs+json` for the JSON requests. Object bodies of any media type are stored as bytes. |

Errors are JSON documents with `message` and `request_id`. Quote the `request_id` when you ask your administrator for help.

The links point to the address with which the client reached the server. When a reverse proxy ends HTTPS, it must pass the `Host` header and send `X-Forwarded-Proto: https`, as in the nginx example of the installation, so that the links use `https`. Arkvory puts the key into a link only when the link is `https` or points to the local computer. Over plain HTTP to another host, git cannot send the key with the object and the transfer fails.

## Large files and resuming {#large-files}

- Git LFS sends each object in one `PUT` request. After a failure it starts the object again from the first byte. The `tus` adapter, which resumes inside an object, is not supported.
- An upload request must finish within 30 minutes and must not pause for more than 30 seconds (`ARKVORY_UPLOAD_DEADLINE_MS`, `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`). A file of many gigabytes needs a fast and stable network. For larger files use [`arkvoryctl`](./cli), which uploads in parts.
- Downloads accept `Range` requests.
- An object can be as large as the maximum object size of the installation (`ARKVORY_MAX_OBJECT_BYTES`, about 10 TiB by default). A larger object is refused in the batch answer with `422`.

By default the server runs 2 uploads at the same time and 1 per key (`ARKVORY_MAX_UPLOADS`, `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`). Git LFS sends 8 objects at the same time by default. The other uploads wait for a free slot and give up after 20 seconds (`ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS`) with `503`. Git LFS repeats a failed object a few times, but a push of large files is more reliable with fewer parallel transfers:

```bash
git config lfs.concurrenttransfers 1
```

You can also ask the administrator to raise the limits. They are described in [Environment variables](../reference/environment#transfers-and-bandwidth).

## Mirrors and read gateways {#mirrors-and-read-gateways}

| Place                                    | Clone and fetch                                                                  | Push and locks                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Main server                              | Yes                                                                              | Yes                                                                           |
| [Mirror](../operate/mirrors)             | Yes. The mirror has the objects of its source, so point `lfs.url` at it.         | Refused (`409`, reason `mirror_read_only`). Locks are not copied to a mirror. |
| [Read gateway](../operate/read-gateways) | No. The download list is a `POST` request, which a read gateway does not accept. | No                                                                            |

Always point `lfs.url` at the main server, or at a mirror for read-only machines.

## Troubleshooting {#troubleshooting}

| Message or symptom                                           | Cause                                                                               | What to do                                                                              |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `401` or an authorization error                              | No key, a wrong key, or an expired or revoked token                                 | Remove the saved credential in your credential manager and push again with a valid key  |
| `403` with "Read-only personal access token"                 | The token has the scope `read`                                                      | Create a token with the scope `read-write`                                              |
| `403`                                                        | The key lacks the access for this operation, or the repository is not granted to it | Add the actions from [Permissions](#permissions)                                        |
| `Lock failed: already created lock`                          | Someone holds the lock                                                              | Ask the owner to unlock, or an administrator to use `--force`                           |
| `422` "Object exceeds the maximum size"                      | The object is larger than the limit of the installation                             | Use `arkvoryctl` for such files                                                         |
| `422` on upload                                              | The content does not match the `oid`; the file changed during the push              | Run `git lfs push` again                                                                |
| `503` or `Retry-After`                                       | Too many transfers at the same time                                                 | Lower `lfs.concurrenttransfers` and retry                                               |
| `507`                                                        | The repository quota or the capacity of the installation is reached                 | Free space or ask for a larger quota                                                    |
| `409` on upload                                              | The repository is a mirror                                                          | Push to the main server                                                                 |
| Files in the working tree are small text files with an `oid` | The objects were not downloaded, or `git lfs install` was not run                   | Run `git lfs install`, then `git lfs pull`                                              |
| `x509: certificate signed by unknown authority`              | The client does not trust the certificate                                           | Add the certificate authority to the trust store of the system, or set `http.sslCAInfo` |

Do not turn off TLS verification (`GIT_SSL_NO_VERIFY`): the key is sent with every request.

## Related pages {#related-pages}

- [Clients and protocols](./index)
- [Accounts and keys](../use/accounts)
- [HTTPS](../install/https)
- [Mirrors](../operate/mirrors)
- [Unity and npm packages](./unity-npm)
