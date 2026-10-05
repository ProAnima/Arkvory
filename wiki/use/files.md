---
title: Files by path
description: Keep a file at a path with a full history, restore earlier revisions, and add labels, metadata, collections and attachments.
---

# Files by path

A file by path is a name in a repository, such as `builds/game/1.4/GameSetup.exe`, that points to one stored file. When you put new content at the same path, the path points to the new file. The old one stays, and you can go back to it. Use a path when people and scripts need a stable address for "the current Setup.exe".

## What a path is {#what-it-is}

Every stored file is an immutable **artifact** with an ID and a SHA-256. A path is a pointer to an artifact. Each change of the pointer is a **revision**, numbered from 1. Revisions are never deleted or edited.

A path has 1 to 1024 characters. It is made of segments separated by `/`. A segment is not empty, is not `.` or `..` and has no control characters. A path cannot contain `\` or `:`. Letter case matters.

A path and a package are two views of the same artifacts: a UPack archive can also have a path. See [UPack packages](./packages).

## Put a file at a path {#put}

You need the actions `upload.create`, `upload.write` and `upload.complete`, and `asset.read`, `asset.write` and `artifact.read`. In terms of groups, you need write access. See [Permissions](./accounts#permissions).

### With arkvoryctl {#put-cli}

```bash
arkvoryctl put "./Build/Game Setup.exe" builds/game/1.4/GameSetup.exe
arkvoryctl put ./config.json config/settings.json --label test
arkvoryctl get builds/game/1.4/GameSetup.exe ./GameSetup.exe
```

`put` uploads the file in parts, with a checkpoint next to the source file, and makes it the next revision of the path. It prints the `path`, the `revision`, the artifact `id` and `created`. If the path already holds the same bytes, `put` uploads nothing and prints `created` as `false`: a repeated build step costs nothing. If someone changed the path while you uploaded, `put` stops with `revision_mismatch` (exit code 6) and does not overwrite their work. Read the history and decide. If an upload stops, run the same command again. See [Uploads and downloads](./transfers#resume).

`get` downloads the current revision with resume and a SHA-256 check. There is no command to list paths or to read the history. Use the console or the API for that.

### With one HTTP request {#put-http}

A raw `PUT` stores the bytes at the path in one request, as `curl -T` does:

```bash
curl -T ./GameSetup.exe -H "Authorization: Bearer $ARKVORY_KEY" \
  "$ARKVORY/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe"
```

The answer has `path`, `revision`, `created` and the `artifact` with its `id`, `size` and `sha256`. A new revision answers `201`. The same bytes again answer `200` with `created` false. Two headers are optional: `X-Checksum-Sha256` lets the server check the bytes in one pass, and `If-None-Match: *` refuses the request if the path already exists. One request must finish within 30 minutes. Use `put` for large files. See [Raw files](../protocols/raw-files).

### In the console {#put-console}

1. Upload the file in [[ui:upload]]. See [Uploads and downloads](./transfers).
2. Open the artifact in [[ui:catalog]] with [[ui:open]].
3. In [[ui:assetTitle]] enter the [[ui:assetPath]], for example `releases/current.upack`.
4. Enter the [[ui:currentRevision]]: `0` for a new path, or the current revision shown in [[ui:history]].
5. Select [[ui:assign]].

The revision field protects against two people changing a path at once. If it is not the current one, the server refuses with a conflict. Load the history again and retry.

### With the API and the SDK {#put-api}

`setAsset` points a path at an artifact you already uploaded. `expectedRevision` is `0` to create the path, and the current revision otherwise.

```bash
curl -X PUT "$ARKVORY/api/v1/repositories/releases/asset" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"path":"builds/game/1.4/GameSetup.exe","artifactId":"3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11","expectedRevision":0}'
```

```typescript
const current = await releases.assets.get('builds/game/1.4/GameSetup.exe');
await releases.assets.assign('builds/game/1.4/GameSetup.exe', artifactId, current.revision);
```

A conflict answers `409 revision_mismatch`. Do not retry with a guessed revision. After a lost answer, read the path: if the new artifact is already there, you are done.

## Read a path {#read}

- `arkvoryctl get PATH OUTPUT` downloads the current file.
- `GET /api/v1/repositories/<repository>/raw/<path>` and `GET /api/v1/repositories/<repository>/asset/content?path=<path>` return the bytes. Both need `content.read`, and support ranges and the ETag.
- `getAsset` (`GET …/asset?path=`) returns the pointer: `path`, `revision`, `artifactId`.
- `listAssetPage` (`GET …/assets/page?prefix=`) lists pointers. Pages hold up to 100 (50 by default) in byte order of the UTF-8 path. The prefix is literal and case sensitive. Pass `next` as `after`. The older `listAssets` returns up to 1000 and asks you to narrow the prefix.

```typescript
const page = await releases.assets.list({ prefix: 'builds/game/', limit: 100 });
```

## Revisions and history {#history}

In the console open [[ui:history]], type the path in [[ui:assetPath]] and select [[ui:historyLoad]]. The table shows the [[ui:revision]], the time ([[ui:date]]), the author ([[ui:actor]]) and, for restored revisions, the revision they come from ([[ui:source]]). The newest is first. [[ui:historyMore]] loads older ones, 50 at a time. [[ui:open]] on a row opens that revision's artifact, from where you can download its original content.

With the API, `getAssetHistory` (`…/asset/history?path=&before=`) returns the pages, newest first, and `before` is the last revision of the previous page. `getAssetRevision` (`…/asset/revision?path=&revision=`) returns one revision. Author and time are empty for revisions written before the history recorded them. Reading needs `asset.read`.

## Restore an earlier revision {#restore}

Restoring makes the path point to the artifact of an older revision. It copies no bytes and deletes no revision: the restore is a new, latest revision, and the history shows where it came from.

In the console, load the history and select the restore button of the revision you want. The button of the current revision is off. Restoring needs `asset.restore`, `asset.read` and `artifact.read`.

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/asset/restore" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"path":"builds/game/1.4/GameSetup.exe","sourceRevision":3,"expectedRevision":5}'
```

```typescript
await releases.assets.restore('builds/game/1.4/GameSetup.exe', 3, 5);
```

`expectedRevision` is the latest revision you saw. If the path changed meanwhile, the server answers `409 revision_mismatch`; the console shows a message and asks you to reload the history. A restore does not bring back old labels or metadata: they stay as they are now.

## Labels, metadata and collections {#labels}

Every artifact carries three kinds of notes. You can change them any time. The file itself never changes.

| Kind        | Example                                        | Rules                                                                                                                                |
| ----------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Labels      | `test`, `staging`, `release`, `linux`          | Up to 32. Each 1 to 64 letters, digits, `_`, `.`, `:` or `-`. Case matters                                                           |
| Metadata    | `build.number` = `42`, `git.commit` = `abc123` | Up to 32 text fields. A key starts with a letter and has up to 64 letters, digits, `_`, `.` or `-`. A value is up to 1024 characters |
| Collections | `desktop`, `nightly`                           | Up to 32. Same rules as labels. They group artifacts, whatever their version or path                                                 |

Labels are free text. They give no access and move no file. The console suggests [[ui:labelPresets]] (`nightly`, `test`, `staging`, `release`), but any label is valid, and `relase` is not corrected. For an approval that deployments rely on, use a stage ([Stages and promotion](./promotion)).

**Console.** Open the artifact in [[ui:metadata]]. Enter [[ui:labels]] and [[ui:collections]] separated by commas. Use [[ui:metadataAdd]] for a field in [[ui:metadataFields]]: a [[ui:metadataKey]] and a [[ui:metadataValue]]. [[ui:metadataJson]] edits the same data as JSON. Select [[ui:save]].

**arkvoryctl.** At upload time, `--label test` adds one label, and `--file metadata.json` gives `labels` and `metadata`:

```json
{ "labels": ["test"], "metadata": { "build.number": "42", "git.commit": "abc123" } }
```

To change an existing artifact, read it, then send the complete new state with the revision you read:

```bash
arkvoryctl annotations get 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl annotations set 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --revision 3 --file annotations.json
```

`annotations.json` must have all three keys: `labels`, `metadata` and `collections`. Anything you leave out becomes empty. A save replaces the whole set. If someone saved first, the server answers `409 revision_mismatch`: read again and decide. The SDK does not repeat such saves.

```typescript
const current = await releases.annotations.get(id);
await releases.annotations.update(id, current.revision, {
  labels: [...current.labels, 'release'],
  metadata: current.metadata,
  collections: current.collections,
});
```

You need `annotation.read` to read and `annotation.write` with `artifact.read` to write.

**Search.** In [[ui:catalog]], type text in [[ui:search]]: it matches the file name and metadata values, ignoring case. [[ui:labelFilter]] shows one label. [[ui:metadataFilter]] matches a key and a value exactly, including case. With `arkvoryctl`:

```bash
arkvoryctl search --query game --label release
arkvoryctl search --collection nightly
arkvoryctl search --metadata-key git.commit --metadata-value abc123
```

`--metadata-key` and `--metadata-value` go together. Pages hold up to 100 results. Pass `next` as `--after`. The filters combine with AND.

## Attachments {#attachments}

Attachments link other files to a build: a manifest, an SBOM, a signature, a report or any file. An attachment is a name and a link to another artifact of the same repository. The build and the attachment stay separate files.

| Rule        | Value                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| Kinds       | `manifest`, `sbom`, `signature`, `report`, `file`                                                                  |
| Per build   | At most 32                                                                                                         |
| Name        | 1 to 240 characters, unique within the build (case ignored), no `/`, `\`, control characters or spaces at the ends |
| Description | Up to 512 characters, may be empty                                                                                 |
| Target      | A published artifact of the same repository. Not the build itself                                                  |

The kind only says what the file is for. Arkvory does not check a signature, does not read an SBOM and does not run a manifest.

In the console, open the artifact. Under [[ui:attachmentsTitle]] expand the form [[ui:attachmentAdd]]. Choose the [[ui:attachmentSource]]: [[ui:attachmentUpload]] sends a new file and links it, [[ui:attachmentExisting]] links an artifact that is already published. Choose the [[ui:attachmentKind]]: [[ui:attachmentManifest]], [[ui:attachmentSbom]], [[ui:attachmentSignature]], [[ui:attachmentReport]] or [[ui:attachmentFile]]. Give it an [[ui:attachmentName]] and, if you like, a [[ui:attachmentDescription]]. Then select [[ui:attachmentAdd]]. [[ui:attachmentUnlink]] removes a link and keeps the file. [[ui:attachmentReload]] reads the list again. If the upload of an attachment breaks, [[ui:attachmentRecovery]] shows the upload ID to continue with.

Every change of the list is a numbered version. [[ui:attachmentHistory]] shows the earlier ones, and [[ui:attachmentRestore]] returns one of them as a new version.

With `arkvoryctl` the file holds the whole list as a JSON array:

```json
[
  {
    "name": "build.json",
    "kind": "manifest",
    "artifactId": "64b42380-902d-41cf-9151-10c12e4809dc",
    "description": "Build provenance from CI"
  }
]
```

```bash
arkvoryctl attachments get 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl attachments set 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --revision 0 --file attachments.json
arkvoryctl attachments history 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`--revision` is the number you read with `get`; a new build has `0`. With the API, `replaceBuildAttachments` takes `expectedRevision` and `items`; `getBuildAttachments` and `getBuildAttachmentHistory` read. To download an attachment, use the `artifactId` of its link with the normal download. Reading needs `annotation.read`, changing needs `annotation.write` with `artifact.read`, and the upload of the attachment file needs the upload actions.

Attachments and paths do not travel with a promotion to another repository. See [Stages and promotion](./promotion).

## Related pages {#related-pages}

- [Raw files](../protocols/raw-files)
- [Uploads and downloads](./transfers) and [UPack packages](./packages)
- [Command line (arkvoryctl)](../protocols/cli)
- API reference: [Files by path](../api/reference/files), [Artifacts and catalog](../api/reference/artifacts), [Build attachments](../api/reference/attachments)
