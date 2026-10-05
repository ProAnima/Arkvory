---
title: Unity and npm packages
description: Use a repository as a scoped registry for the Unity Package Manager and as an npm registry for publishing and installing packages.
---

# Unity and npm packages

Every Arkvory repository is an npm-compatible registry at `https://<host>/npm/<repository>/`. The Unity Package Manager reads it as a scoped registry, and `npm` publishes to it and installs from it. Studios use it for SDKs, tools and modules that several Unity projects share, each with its own version.

Package tarballs are ordinary artifacts, so repository permissions, quotas, SHA-256 checks, backups and mirrors apply to them.

## Before you start {#before-you-start}

You need:

- The server address with HTTPS (see [HTTPS](../install/https)).
- A repository, for example `games`. Its registry address is `https://arkvory.example/npm/games/`.
- A key. Developers use a personal access token with the scope `read`. Build agents that publish use a personal token with the scope `read-write` or a service key. See [Accounts and keys](../use/accounts).

Arkvory sends the address of each tarball to the client in the package data. The address is built from the host name with which the client came. When a reverse proxy ends HTTPS, it must pass the `Host` header and send `X-Forwarded-Proto: https`, as in the nginx example of the installation. Otherwise the client receives `http://` addresses of tarballs.

## Add the registry to a Unity project {#unity-manifest}

1. Open `Packages/manifest.json` of the project and add a scoped registry:

```json
{
  "scopedRegistries": [
    {
      "name": "Arkvory",
      "url": "https://arkvory.example/npm/games/",
      "scopes": ["com.proanima"]
    }
  ],
  "dependencies": {
    "com.proanima.tools": "1.2.0"
  }
}
```

2. Give Unity the key. Do not put it in the project. Create the file `.upmconfig.toml` in your user folder (`%USERPROFILE%\.upmconfig.toml` on Windows, `~/.upmconfig.toml` on macOS and Linux):

```toml
[npmAuth."https://arkvory.example/npm/games/"]
token = "<your Arkvory key>"
alwaysAuth = true
```

3. Restart Unity. In the Package Manager window, open **My Registries** to see the packages of the registry.

Notes:

- `scopes` are prefixes of package names. Unity takes the packages whose names start with a scope from Arkvory, and all other packages from the Unity registry.
- The address in `.upmconfig.toml` must be the same as `url` in the manifest, including the final slash.
- `alwaysAuth = true` is required. The registry does not send a login challenge, so Unity must send the token with every request.
- Unity package names are reverse domain names in lowercase, such as `com.company.package`. Unity does not support names with `@scope/`.

Commit `Packages/manifest.json` with the project. Each developer keeps their own `.upmconfig.toml`.

## Publish a package {#publish}

A package is a folder with a `package.json` at the top. Publish it with `npm`.

1. In the folder of the package, create an `.npmrc` file:

```ini
registry=https://arkvory.example/npm/games/
//arkvory.example/npm/games/:_authToken=${ARKVORY_TOKEN}
```

2. Set the key in the environment and publish:

```bash
export ARKVORY_TOKEN="$(cat ~/.arkvory/key)"
npm publish
```

```powershell
$env:ARKVORY_TOKEN = (Get-Content C:\Private\arkvory.key -Raw).Trim()
npm publish
```

The line with `_authToken` must start with the address of the registry without `https:`. Keep the key out of `.npmrc`: npm replaces `${ARKVORY_TOKEN}` from the environment.

Instead of the `registry` line in `.npmrc`, you can set the registry in the `package.json` of the package:

```json
{
  "name": "com.proanima.tools",
  "version": "1.2.0",
  "publishConfig": { "registry": "https://arkvory.example/npm/games/" }
}
```

What the registry checks:

- **Name and version.** `name` and `version` in the `package.json` inside the tarball must match the published ones. The version follows SemVer 2.0.0, for example `1.2.0` or `2.0.0-beta.1`. The registry reads the data of the version from this file, not from the JSON that the client sends.
- **Checksums.** The length, `shasum` and `integrity` that the client declares must match the bytes. A mismatch returns `422 integrity_mismatch`.
- **The tarball.** It must contain `<folder>/package.json`, as `npm pack` makes it. A second `package.json` in the archive is refused, because npm and the registry could read different files.
- **A version is immutable.** The same tarball published again succeeds and changes nothing (`200`). Other content for an existing version returns `409` with the reason `version_exists`. Publish the fix as the next version.

`npm publish` reads the package from the registry before it publishes, so give a publishing key `content.read` and `artifact.list` as well as `upload.create`. See [Permissions](#permissions).

The version is available as soon as `npm publish` returns. The tarball of a version is stored as the artifact `<name>-<version>.tgz` with the label `npm`. For a name with a scope, `@team/util` becomes `util-<version>.tgz`.

## Install packages {#install}

In Unity, add the dependency in the manifest or choose the package in the Package Manager window under **My Registries**.

For npm, set the registry in the `.npmrc` of the project or of your user. A registry for one scope is the usual choice, because Arkvory does not forward requests to the public npm registry:

```ini
@team:registry=https://arkvory.example/npm/games/
//arkvory.example/npm/games/:_authToken=${ARKVORY_TOKEN}
```

```bash
npm install @team/util
npm view @team/util versions
npm search tools
```

If you set `registry=` to Arkvory for the whole project, npm looks for every package there, including public ones such as `lodash`, and fails with `404`. Use a scoped registry or a project that holds only your own packages.

npm checks `dist.integrity` while it installs and writes the registry address into `package-lock.json`.

## Versions and dist-tags {#versions-and-tags}

A dist-tag is a movable name for a version. `npm publish` sets `latest` to the new version. Other tags help to separate release channels.

```bash
npm publish --tag beta
npm dist-tag add com.proanima.tools@1.3.0 latest
npm dist-tag ls com.proanima.tools
npm dist-tag rm com.proanima.tools beta
```

```bash
npm install com.proanima.tools@beta
```

| Rule           | Value                                                                         |
| -------------- | ----------------------------------------------------------------------------- |
| Tag name       | Starts with a letter. Letters, digits, `.`, `_` and `-`. Up to 64 characters. |
| Forbidden tags | A name that looks like a version (`v1`, `v2.0`), and `x` or `X`               |
| `latest`       | Always points to a version. It can be moved, not removed (`409`).             |
| Moving a tag   | `npm dist-tag add`, or publishing with `--tag`. The new version must exist.   |

A tag is only a name: it does not delete or hide other versions.

There is no way to remove a published version. See [Not supported](#not-supported).

## Search {#search}

The list of **My Registries** in Unity and `npm search` use the search address `/-/v1/search`. The search finds packages whose name or description contains the text, in any case, and packages that have the text as a whole keyword. Without text, it lists all packages.

- It returns one line per package: the version with the tag `latest`, or else the newest version.
- The results are sorted by name. There is no ranking by popularity.
- `size` is 20 by default and at most 250. `from` is the offset.

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_TOKEN" \
  "https://arkvory.example/npm/games/-/v1/search?text=tools&from=0&size=20"
```

To read a package directly, request its name. `@scope/name` can be sent as `@scope%2fname`:

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_TOKEN" https://arkvory.example/npm/games/com.proanima.tools
```

The answer lists every version with the content of its `package.json` (including the fields `unity` and `displayName` that Unity reads), the dist-tags and the publication times. `dist` has `tarball`, `shasum` (SHA-1) and `integrity` (SHA-512).

## Names and limits {#limits}

| Item                            | Rule                                                                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package name                    | Lowercase letters, digits, `.`, `_`, `~` and `-`, starting with a letter or a digit. Up to 214 characters. `@scope/name` is allowed for npm.                                 |
| Version                         | SemVer 2.0.0, up to 256 characters                                                                                                                                           |
| `package.json` in the tarball   | Up to 256 KiB. The data of all versions come in one answer, so keep it small.                                                                                                |
| Tarball                         | Up to the maximum object size of the installation, `ARKVORY_MAX_OBJECT_BYTES` (about 10 TiB by default). An archive that expands more than 100 times plus 64 MiB is refused. |
| The rest of the publish request | Up to 8 MiB of JSON, nested at most 64 levels. The tarball is read as a stream and is not kept in memory.                                                                    |
| One publish request             | Must finish within 30 minutes and must not pause for more than 30 seconds (`ARKVORY_UPLOAD_DEADLINE_MS`, `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`)                                   |
| Uploads at the same time        | 2 per server and 1 per key by default. A waiting request gives up after 20 seconds.                                                                                          |
| Search text                     | Up to 256 characters                                                                                                                                                         |

`npm publish` is one request, and it starts again from the first byte after a failure. For packages of many gigabytes, upload the file with [`arkvoryctl`](./cli) as an artifact or a [raw file](./raw-files). Large binary assets that change often are better placed in [Git LFS](./git-lfs); keep code and stable resources in packages.

The limits of the server are in [Environment variables](../reference/environment#transfers-and-bandwidth).

## Permissions {#permissions}

Personal tokens and file keys get read or write access to the repository. Service keys get exact actions.

| Operation                                      | Service key actions | Personal token or file key             |
| ---------------------------------------------- | ------------------- | -------------------------------------- |
| Install: read a package and download a tarball | `content.read`      | Read access                            |
| Search, list dist-tags                         | `artifact.list`     | Read access                            |
| Publish, add and remove dist-tags              | `upload.create`     | Write access, token scope `read-write` |

A developer who only installs packages needs a token with the scope `read`. A build agent that publishes needs `upload.create`, `content.read` and `artifact.list`. Nobody can delete a published version.

## Read gateways and mirrors {#read-gateways-and-mirrors}

- A [read gateway](../operate/read-gateways) serves installation and search, because they are `GET` requests. A publish gets `405`.
- A [mirror](../operate/mirrors) holds the versions and tags of its source. Installation and search work. Publishing is refused with `409` and the reason `mirror_read_only`. The tarball addresses in the data of a mirror point to the mirror.

To use a mirror in Unity, put the address of the mirror in `url` and its key in `.upmconfig.toml`.

## Not supported {#not-supported}

- Removing a version (`npm unpublish`). Projects pin versions, and a removal would break their builds. Publish a corrected version and move the tag instead.
- `npm deprecate`, `npm login`, `npm owner`, `npm access` and other management commands. Requests that change data on other paths answer `405` with "This registry supports publish, install and dist-tags". Create a token in the console and put it in `.npmrc` instead of `npm login`.
- The list of all packages at `/-/all`, and `npm audit`.
- A proxy to the public registries. Arkvory stores your own packages. Packages from npmjs.com or the Unity registry are fetched from there.
- Ranking of search results.
- A section for packages in the console. Tarballs appear in [[ui:catalog]] as artifacts with the label `npm`.

## Troubleshooting {#troubleshooting}

Errors have the form `{"error": "...", "code": "...", "request_id": "..."}`. `npm` prints `error`. Give the `request_id` to your administrator to find the request in the server log.

| Symptom                                               | Cause                                                                               | What to do                                                                                                                                                                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401` in Unity or npm                                 | The client did not send the key, or the key is wrong, expired or revoked            | In Unity, check that the address in `.upmconfig.toml` equals `url` in the manifest and that `alwaysAuth = true`. In npm, check that the `_authToken` line starts with the same host and path as `registry`. |
| `403` when publishing                                 | The token has the scope `read`, or the key lacks `upload.create`                    | Use a key with write access                                                                                                                                                                                 |
| `404` for a package                                   | There is no such package in this repository, or the key does not see the repository | Check the repository in the address and the name. For a Unity package, check that its name starts with a scope from `scopes`.                                                                               |
| `404` for a public package                            | `registry=` points to Arkvory for all packages                                      | Use `@scope:registry=`                                                                                                                                                                                      |
| `409` with `version_exists`                           | The version exists with other content                                               | Publish a new version                                                                                                                                                                                       |
| `409` with `state_conflict`                           | You tried to remove `latest`                                                        | Move `latest` to another version instead                                                                                                                                                                    |
| `409` with `mirror_read_only`                         | The repository is a mirror                                                          | Publish to the main server                                                                                                                                                                                  |
| `422` with `integrity_mismatch`                       | The bytes differ from the declared `shasum` or `integrity`                          | Pack and publish again. Check that no proxy changes the body.                                                                                                                                               |
| `400` "package.json names another package or version" | The `package.json` inside the tarball differs from the published name or version    | Run `npm publish` from a clean build of the package                                                                                                                                                         |
| `400` "Only publishing a new version is supported"    | The command sent a changed package, for example `npm deprecate`                     | These commands are not supported                                                                                                                                                                            |
| `405`                                                 | The command is not supported by this registry                                       | See [Not supported](#not-supported)                                                                                                                                                                         |
| `507`                                                 | The repository quota or the capacity of the installation is reached                 | Free space or ask for a larger quota                                                                                                                                                                        |
| `503`                                                 | Too many uploads at the same time                                                   | Wait and retry                                                                                                                                                                                              |
| Tarball downloads from `http://` and fails            | The proxy does not send `X-Forwarded-Proto: https`                                  | Fix the proxy as described in [Before you start](#before-you-start)                                                                                                                                         |

## Related pages {#related-pages}

- [Clients and protocols](./index)
- [Git LFS](./git-lfs)
- [Accounts and keys](../use/accounts)
- [HTTPS](../install/https)
- [Mirrors](../operate/mirrors)
