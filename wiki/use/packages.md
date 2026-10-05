---
title: UPack packages
description: Publish versioned UPack packages, list and filter them, and download a version by exact number, range, latest or stage.
---

# UPack packages

A UPack package is a ZIP archive with a name and a SemVer version. Arkvory registers each version once and never changes it. A deployment job asks for "app, version `^1.4`, stage `release`" and gets exactly one file.

## What a package is {#what-it-is}

A UPack is a ZIP file with a file `upack.json` in its root. The manifest names the package:

```json
{
  "group": "acme/game",
  "name": "game-client",
  "version": "1.4.2"
}
```

| Field     | Rule                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------ |
| `name`    | Required. 1 to 128 letters, digits, `.`, `_` or `-`                                                                |
| `version` | Required. SemVer: `1.4.2`, `1.5.0-rc.1`, `2.0.0+build.7`. At most 128 characters                                   |
| `group`   | Optional. Segments of letters, digits, `.`, `_` or `-`, separated by `/`. At most 128 characters. Empty by default |

Other fields stay as you wrote them and come back in the package list. The manifest is at most 64 KiB. The archive must not contain absolute paths, `..`, symbolic links, encrypted entries or duplicate names, and it has at most 100 000 entries. Arkvory stores the archive byte for byte and does not unpack it.

The identity of a package is its group, name and version, compared without regard to letter case. Within one repository an identity belongs to one archive for good. Registering a different archive under an existing identity is refused with `409 version_exists`. Registering the same archive again is safe and changes nothing. Publish a fix as a new version.

## Publish a package {#publish}

Publishing is an upload followed by a registration. The registration reads `upack.json` and records the identity. You need the actions `package.publish` and `artifact.read`, besides the upload actions. See [Permissions](./accounts#permissions).

### In the console {#publish-console}

1. Upload the archive in [[ui:upload]]. See [Uploads and downloads](./transfers).
2. Open the artifact in [[ui:catalog]] with [[ui:open]].
3. In [[ui:metadata]] select [[ui:register]]. The console shows the name and the version it registered.

The package now appears in [[ui:packages]].

### With arkvoryctl {#publish-cli}

```bash
arkvoryctl packages publish ./build.upack --label test --state ./job-state/build.json --json
arkvoryctl packages register 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`packages publish` uploads the archive with resume and registers it. If the registration fails after the upload, the error holds the `artifactId` and the stage `register`. Run the same command again: the upload is not repeated, and registering twice is safe. `packages register ID` registers an artifact that is already uploaded. See [Command line](../protocols/cli#packages-and-promotion).

### With the HTTP API and the SDK {#publish-api}

Upload the archive as in [Uploads and downloads](./transfers#upload-http), then register it:

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/package" \
  -H "Authorization: Bearer $ARKVORY_KEY"
```

```typescript
const entry = await releases.packages.register(uploaded.id);
console.log(entry.group, entry.name, entry.version);
```

The operation is `registerPackage`. A broken archive, a missing `upack.json` or a wrong version gives `400 invalid_input`.

## List and filter {#list}

In the console open [[ui:packages]]. Type a [[ui:packageGroup]] or a [[ui:packageName]]: both match exactly, ignoring letter case. Pick a column in [[ui:sortBy]], an order in [[ui:direction]] ([[ui:ascending]] or [[ui:descending]]) and a grouping in [[ui:groupBy]] ([[ui:packageGroup]], [[ui:packageName]] or [[ui:noGrouping]]), then select [[ui:apply]]. [[ui:clearFilters]] resets the form. The table shows the group, the name, the version and the stages of each version. [[ui:open]] shows the artifact. [[ui:previousPage]] and [[ui:nextPage]] move between pages.

```bash
arkvoryctl packages list --group acme/game --name game-client
arkvoryctl packages list --after <next from the previous answer>
```

With the API, `listPackages` takes `group`, `name`, `sort` (`group`, `name` or `version`), `direction` (`asc` or `desc`), `groupBy` (`none`, `group` or `package`), `after` and `limit` (1 to 100, 50 by default). The answer has `items` (group, name, version, `artifactId` and the whole manifest), `groups` and `next`. A cursor belongs to the filters it came from. Use it only with the same filters.

```typescript
const page = await releases.packages.list({
  name: 'game-client',
  sort: 'version',
  direction: 'desc',
});
```

Listing needs `package.read`. To search by labels or metadata instead, see [Files by path](./files#labels).

## Versions and ranges {#versions}

Arkvory compares versions by SemVer precedence. `1.10.0` is newer than `1.9.0`. A version with a prerelease part, such as `1.5.0-rc.1`, is older than `1.5.0`.

A selection takes a package `name` and, optionally, these filters:

| Filter        | Meaning                                                                                |
| ------------- | -------------------------------------------------------------------------------------- |
| `group`       | The group. Empty by default: a package that has a group is found only when you give it |
| exact version | One version. Case is ignored                                                           |
| range         | A SemVer range                                                                         |
| `stage`       | Only versions that carry this stage (see [Stages and promotion](./promotion))          |
| prerelease    | Include prereleases. Off by default                                                    |
| order         | `version` (default) or `promoted`                                                      |

Ranges can be written as `1.2.3`, `^1.2`, `~1.2.3`, `1.x`, `>=1.0.0 <2.0.0`, `1.0.0 - 1.4.0` and `^1 || ^3`. A range is at most 256 characters. An exact version and a range cannot be combined.

Without an exact version or range, the selection returns the highest stable version, which is the latest. Prereleases are chosen only with the prerelease filter on, or when the exact version or the range itself names a prerelease of the same `major.minor.patch`. `order promoted` picks the version that was staged last, not the highest, and needs a stage. If nothing matches, the server answers `404 not_found`.

## Download a package {#download}

Resolve first if you want to see what you get, or download directly.

```bash
arkvoryctl packages resolve game-client --group acme/game --range ^1.4 --stage release
arkvoryctl packages download game-client ./game-client.upack --group acme/game --range ^1.4 --stage release
arkvoryctl packages download game-client ./game-client.upack --exact 1.4.2 --group acme/game
arkvoryctl packages download game-client ./game-client.upack --group acme/game
```

The options are `--group`, `--exact`, `--range`, `--stage`, `--prerelease` and `--order promoted`. Use `--exact` for an exact version, because `--version` prints the client version. `resolve` prints the group, name, version, `artifactId`, `sha256`, `size`, `publishedAt`, `stagedAt` and the stages. `download` resolves, then downloads that artifact with resume and a SHA-256 check, as in [Uploads and downloads](./transfers#download-cli). The client needs `package.read`, `artifact.read` and `content.read`.

With HTTP there are two operations. `resolvePackage` needs `package.read` and returns the same facts as `resolve`. `downloadPackageContent` sends the bytes of the chosen version and needs only `content.read`. It adds the headers `X-Arkvory-Artifact-Id` and `X-Arkvory-Package-Version`.

```bash
curl -fL -G -H "Authorization: Bearer $ARKVORY_KEY" -o game-client.upack \
  --data-urlencode "name=game-client" --data-urlencode "group=acme/game" \
  --data-urlencode "range=^1.4" --data-urlencode "stage=release" \
  "$ARKVORY/api/v1/repositories/prod/packages/content"
```

The by-name address resolves on every request. If you resume a download with a range, the file may have changed between the two calls. Download the `artifactId` from `resolve` instead, or send the `ETag` in `If-Range`.

```typescript
const found = await prod.packages.resolve({
  name: 'game-client',
  group: 'acme/game',
  range: '^1.4',
  stage: 'release',
});
const stream = await prod.artifacts.downloadVerified(found.artifactId);
```

A deployment agent that must only fetch builds gets a service key with `content.read` alone for the HTTP address, or the read preset for `arkvoryctl`. See [Service accounts and keys for CI](./accounts#service-accounts).

## Labels, metadata and attachments {#labels}

A package version is an ordinary artifact, so everything on [Files by path](./files#labels) applies to it: labels such as `test`, `staging` and `release`, text metadata such as `git.commit`, collections, and attachments like an SBOM or a signature. Set the first labels at upload time with `--label test`. Labels change nothing about the archive. They are free text, not a controlled status. For an approval that a deployment can rely on, use a stage. See [Stages and promotion](./promotion).

## Keeping old versions {#retention}

Registered packages are what the retention policy of a repository counts. By default, when enabled, it keeps the last 10 builds of each package and channel. A channel is the label `test`, `staging` or `release`. A version with a stage, a protected label, a file path or an attachment link is never removed by retention. Retention is off until an administrator turns it on and agrees to deletion. See [Storage and retention](../operate/storage).

## Errors {#errors}

| Answer                          | Meaning                                                                                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400 invalid_input` on register | Not a valid UPack ZIP, no `upack.json` in the root, or a wrong name or version                                                                             |
| `409 version_exists`            | The identity already belongs to another archive. Publish a new version. Promoting to a repository that has the version with other bytes fails the same way |
| `404 not_found` on resolve      | Nothing matches the filters. Check the group, the range and the stage                                                                                      |
| `403 permission_missing`        | The key lacks `package.read`, `package.publish` or `content.read`                                                                                          |

## Related pages {#related-pages}

- [Uploads and downloads](./transfers)
- [Stages and promotion](./promotion)
- [Command line (arkvoryctl)](../protocols/cli)
- API reference: [Packages](../api/reference/packages), [Stages and promotion](../api/reference/promotion)
