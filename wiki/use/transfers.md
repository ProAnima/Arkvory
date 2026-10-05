---
title: Uploads and downloads
description: Send and fetch files of any size, continue after an interruption, check checksums and share a file without a key.
---

# Uploads and downloads

Files of any size go to Arkvory in parts, and a transfer that stops can continue from where it stopped. This page shows how, in the console, with `arkvoryctl`, with the SDK and with the HTTP API.

An upload needs the actions `upload.create`, `upload.read`, `upload.write` and `upload.complete`. In terms of groups, it needs write access. A download needs `content.read`. See [Permissions](./accounts#permissions).

## Upload a file {#upload}

Every upload does the same steps. The client computes the SHA-256 of the whole file and starts an upload session with the file name, the size and the checksum. It sends the file in parts. When all parts are there, the server assembles them, checks the checksum and publishes the file as an immutable artifact.

### In the console {#upload-console}

1. Select [[ui:upload]] in the sidebar, or [[ui:uploadFile]] in the top bar.
2. Choose the file under [[ui:chooseFile]]. The console reads the whole file once to compute its checksum ([[ui:hashing]]). For a file of tens of gigabytes, this takes a while before the first byte is sent.
3. Select [[ui:startUpload]]. The bar under [[ui:transferTitle]] shows the progress.
4. When the file is published, its ID is shown. Open [[ui:catalog]] to see it.

[[ui:pause]] stops the transfer and keeps the parts that arrived. The browser warns you before you leave the page during an upload. The console sends no labels or metadata with the file. Add them afterwards in [[ui:metadata]]; see [Files by path](./files#labels).

### With arkvoryctl {#upload-cli}

```bash
arkvoryctl upload ./Build/Game.zip --label test
arkvoryctl upload ./Build/Game.zip --file metadata.json --state ./job-state/game.json
arkvoryctl uploads status 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl uploads cancel 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`upload` prints the artifact when it is published. `--label` adds one label. `--file` points to a JSON file with `labels` and `metadata`, and has priority. To store the file under a path, use `put`; to publish a UPack, use `packages publish`. See [Command line](../protocols/cli#transfers).

### With the SDK {#upload-sdk}

```typescript
const session = await releases.uploads.create(idempotencyKey, {
  name: 'Game.zip',
  size: String(file.size),
  sha256,
  labels: ['test'],
  metadata: { commit: 'abc123' },
});
const artifact = await releases.uploads.resume(session.id, file, {
  onProgress: (bytes) => console.log(bytes),
});
```

`resume` sends the parts the server does not have and completes the upload. The whole example, with hashing in Node.js, is in [TypeScript SDK](../protocols/sdk#upload-a-large-file-with-resume-node-js).

### With the HTTP API {#upload-http}

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/uploads" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Idempotency-Key: game-1234" \
  -H "Content-Type: application/json" \
  -d '{"name":"Game.zip","size":"73400320","sha256":"<64 hex digits>"}'

curl "$ARKVORY/api/v1/repositories/releases/uploads/$ID/parts" -H "Authorization: Bearer $ARKVORY_KEY"

curl -X PUT "$ARKVORY/api/v1/repositories/releases/uploads/$ID/parts/0" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/octet-stream" \
  -H "X-Content-SHA256: <64 hex digits of this part>" --data-binary @part-0.bin

curl -X POST "$ARKVORY/api/v1/repositories/releases/uploads/$ID/complete" \
  -H "Authorization: Bearer $ARKVORY_KEY"
```

The size is a decimal string. The `Idempotency-Key` is 1 to 128 letters, digits, `.`, `_`, `:` or `-`. The answer to the first call has the upload `id` and `expiresAt`. The second call returns the part size `partBytes` and the parts that are already stored. Every part has exactly that size except the last. The operations are `createUpload`, `listUploadParts`, `putUploadPart` and `completeUpload` ([Uploads](../api/reference/uploads)).

For a small file you can use two simpler ways. `PUT /uploads/{id}/content` sends the whole file in one request. `PUT /raw/<path>` creates the session, sends the bytes and stores them at a path in one request, as `curl -T` does. Both requests must finish within 30 minutes. Use parts for anything large or slow. See [Raw files](../protocols/raw-files). An empty file goes in one request.

## How big a file can be {#limits}

| Limit            | Value                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Part size        | 8 MiB for files up to about 78 GiB. Bigger files use 16, 32, 64 MiB and so on, up to 1 GiB, so that a file never needs more than 10 000 parts. |
| Parts per upload | 10 000 (indexes 0 to 9999)                                                                                                                     |
| Largest file     | 10 000 parts of 1 GiB, about 10 TiB                                                                                                            |
| Lower ceiling    | The administrator may set one with `ARKVORY_MAX_OBJECT_BYTES`                                                                                  |
| File name        | 1 to 240 characters, no `/`, `\` or control characters                                                                                         |

The server picks the part size when the upload is created and keeps it for the whole upload. `GET /api/v1/capabilities` shows `maxObjectBytes`, `partBytes`, `maxPartBytes` and `maxParts`. The console refuses a file above the server limit before it starts.

A client holds one part in memory while it hashes and sends it. For files above 78 GiB the part, and so the memory, grows up to 1 GiB.

Free disk space on the server must hold the parts and the assembled file for a while. If the disk is full, the server refuses the upload with `507 storage_full`.

## Resume an upload {#resume}

An upload session keeps its parts after a failure. To continue, give the client the same file and the same session.

**Console.** Within the open tab, select [[ui:startUpload]] again after [[ui:pause]]. After closing the tab, keep the upload ID. Expand [[ui:resumeTitle]]: the field [[ui:uploadId]] shows the ID while the upload runs. Later, choose the same file, enter the ID there and select [[ui:startUpload]]. The console compares the parts with your file. If the file differs, it stops and tells you. [[ui:newUpload]] clears both fields and starts a new upload.

The field [[ui:idempotency]] is a second way back. The console fills it by itself. The same key with the same file returns the same session instead of a second one.

**arkvoryctl.** Run the same command with the same options. The client saved a checkpoint `<file>.arkvory-upload.json` next to the source file, or the file you gave in `--state`, before the first request. To publish the same bytes as a new artifact, use a new `--state`. In CI keep the source file and the state folder between retries. A change of the file, the server, the repository or the options gives `checkpoint_mismatch` (exit code 6).

**SDK.** Call `resume` again with the saved session ID and the same file. To recover when even the answer to `create` was lost, call `create` with the same idempotency key and the same descriptor: it returns the same session.

**HTTP.** Read the stored parts with `listUploadParts`, then send the missing indexes. Sending a part again with the same bytes is safe. Other bytes for a stored index are refused with `409 upload_state`.

The clients also repeat a request by themselves after a network failure or after `408`, `429`, `502`, `503` and `504`: up to 20 times for one operation, with a pause that grows from 0.5 to 60 seconds and respects `Retry-After`. `arkvoryctl` has the options `--retries` and `--attempt-timeout` for slow links.

Only the account or key that created an upload can continue it. For anyone else it does not exist. Rotating a service key keeps the account, so the new key continues the upload.

## Checksums {#checksums}

- **Before the upload.** The console, the CLI and the SDK compute the SHA-256 of the file and send it in the session.
- **Each part.** The header `X-Content-SHA256` has the checksum of the part. A part whose bytes do not match is refused with `422 integrity_mismatch` and not stored.
- **At the end.** The server checks the size and the SHA-256 of the assembled file against the session before it publishes. A mismatch is `422 integrity_mismatch`; the CLI exits with code 5. The artifact does not appear.
- **Downloads.** The console, the CLI and the SDK check the SHA-256 of the whole file before they hand it over. The final file appears only after the check passes.

The ETag of a file is its checksum: `"sha256:<64 hex digits>"`. Artifact details show the SHA-256 and [[ui:copyHash]] copies it.

## Completion job {#completion}

Assembling a large file takes time. For files below 16 GiB, `completeUpload` assembles them inside the request, which may take up to 30 minutes. From 16 GiB the SDK, and so the console and the CLI, ask the worker to finish it: `enqueueCompletion` answers `202` with a job, and the client polls `getCompletionJob` until the state is `completed` or `failed`. A failed job has an error code, for example `integrity_mismatch`.

The worker service must run for jobs. It tries a job up to 5 times, with a growing pause, and gives up at once on errors that a retry cannot fix. A repeated `enqueueCompletion` returns the same job. If the server restarts, the job continues. You do not have to start the upload again.

## Upload expiry {#expiry}

An unfinished upload session expires 7 days after it was created. The time is in `expiresAt`, is not extended, and does not move when you send parts. After it, parts and `complete` are refused with `409 upload_expired`. Start a new upload. Published files never expire.

The server removes expired sessions and their parts in the background. To give one up earlier, use `arkvoryctl uploads cancel ID` or `cancelUpload`. Cancelling is not pausing: the parts are discarded.

## Download a file {#download}

### In the console {#download-console}

Select [[ui:download]] next to a file in [[ui:catalog]], or in the artifact details. The browser asks where to save the file. The file goes to the queue in [[ui:downloads]]. The queue writes the data to a temporary copy, checks the SHA-256, and only then replaces the target file.

The queue needs Chrome or Edge on HTTPS or on the local computer, because it writes a large file through the browser's file system access. Other browsers should use the CLI or the SDK.

The states of a download are [[ui:downloadQueued]], [[ui:downloadRunning]], [[ui:downloadRetrying]], [[ui:downloadPaused]], [[ui:downloadSaving]], [[ui:downloadCompleted]], [[ui:downloadFailed]] and [[ui:downloadCancelled]]. The buttons are:

| Button                                         | Effect                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| [[ui:downloadResume]]                          | Continue a paused or failed download from the part that is saved |
| [[ui:downloadCancel]]                          | Cancel one download and delete its temporary copy                |
| [[ui:downloadsPause]] / [[ui:downloadsResume]] | Hold and release the whole queue                                 |
| [[ui:downloadsClearWaiting]]                   | Cancel the downloads that wait                                   |
| [[ui:downloadsCancel]]                         | Cancel all downloads                                             |
| [[ui:downloadsClearFinished]]                  | Remove finished rows to make room (the queue holds 64)           |
| [[ui:downloadRestore]]                         | After a page reload, bring back the unfinished downloads         |

[[ui:downloadSettings]] has [[ui:downloadConcurrency]] (1 to 8, default 2), [[ui:downloadInterval]] (0 to 60 000 ms, default 250) and [[ui:downloadWait]] (1 to 1800 seconds, default 300). Select [[ui:downloadApply]] to use them. They do not raise the limits of the server.

After a reload or a closed tab, sign in again to the same server as the same account, open [[ui:downloads]] and select [[ui:downloadRestore]]. The restored downloads wait on pause. Select [[ui:downloadResume]] on each and choose the target file again. The browser needs free space for the temporary copy.

### With arkvoryctl {#download-cli}

```bash
arkvoryctl download 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game.zip
arkvoryctl get builds/game/1.4/Game.zip ./Game.zip
arkvoryctl packages download app ./app.upack --range ^1.4 --stage release
```

While a download runs, `<output>.arkvory-part` and `<output>.arkvory-download.json` stay next to the target. Run the same command again after an interruption. The final file appears only after the SHA-256 check. An existing target is never overwritten (`destination_exists`, exit code 6).

### With HTTP: ranges and ETag {#download-http}

`downloadArtifact` returns the bytes of an artifact. `HEAD` returns the headers only.

```bash
curl -fL -H "Authorization: Bearer $ARKVORY_KEY" -C - -o Game.zip \
  "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/content"
```

- `Accept-Ranges: bytes`. Send `Range: bytes=1048576-`, `bytes=0-1023` or `bytes=-500` for one range. The answer is `206` with `Content-Range`. Several ranges at once are not supported: the server sends the whole file. A start beyond the end gives `416`.
- `ETag` is `"sha256:<hex>"`. `If-None-Match` with it gives `304`. `If-Range` with it continues a range only when the file is still the same; otherwise the whole file comes.
- `curl -C -` resumes a download. By-name addresses resolve on every request, for example `packages/content?name=app&range=^1.4`, so the file may change between two calls. To resume them safely, send the ETag you got in `If-Range`, or resolve the name first and download by the artifact ID.

The SDK reads the content in 8 MiB ranges and verifies each one. See [TypeScript SDK](../protocols/sdk#download-with-verification).

## Links for people without a key {#links}

A download link lets someone fetch one file without any key: a tester, a customer, a build machine that holds no credential. The link opens only that artifact, for `GET` and `HEAD`, until it expires. It works with `curl -C -` and with ranges.

In the console, open the artifact in [[ui:metadata]] and select [[ui:downloadLink]]. The console copies the link and shows it, with its expiry. The link lasts one hour. The button appears only if you may download the file.

```bash
arkvoryctl link 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --ttl 900
```

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/links" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"ttlSeconds":900}'
```

The lifetime is 60 seconds to 24 hours (86 400 seconds) and one hour by default. The answer has a `token` starting with `dtl_`, a `url` and `expiresAt`. The CLI and the SDK print a complete URL. The API returns the path, which you add to the server address.

The link is a secret. Whoever has it can download the file. You cannot revoke a link before it expires, so make it short. Treat the URL as a key: keep it out of chat rooms and public logs. Proxy logs and browser history may record it. See [Download links](../api/reference/links).

## Limits and queues {#queues}

The administrator sets how many transfers the server runs at once and how fast. By default a server runs 2 uploads and 16 downloads at the same time, and one account runs 1 upload and 4 downloads. More wait in a queue for up to 20 seconds. If the queue is full or the wait ends, the server answers `503` with `Retry-After`, and the clients wait and retry. A byte-per-second budget, when set, makes transfers slower but does not stop them. Users cannot see or change these budgets. The values are in [Environment variables](../reference/environment#transfers-and-bandwidth).

## Errors {#errors}

| Answer                     | Reason                                                                         | What to do                                              |
| -------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `409 upload_expired`       | The session is older than 7 days                                               | Start a new upload                                      |
| `409 upload_state`         | The upload is already published or cancelled, or a stored part has other bytes | Start a new upload, or check that you use the same file |
| `409 parts_incomplete`     | Some parts have not arrived                                                    | Resume the upload                                       |
| `409 part_mismatch`        | The parts do not match the planned part size or indexes                        | Take the part size from `listUploadParts` and resume    |
| `409 idempotency_mismatch` | The key was used for another file                                              | Use a new key                                           |
| `422 integrity_mismatch`   | A checksum does not match                                                      | Send the original file again                            |
| `507 storage_quota`        | The repository quota is used up                                                | Delete old builds or ask for a bigger quota             |
| `507 storage_full`         | The server disk is full                                                        | Call the administrator                                  |
| `503` with `Retry-After`   | The server is busy                                                             | Wait, the clients retry by themselves                   |

The full list is in [Errors](../api/errors).

## Related pages {#related-pages}

- [Command line (arkvoryctl)](../protocols/cli) and [TypeScript SDK](../protocols/sdk)
- [Files by path](./files) and [Packages](./packages)
- API reference: [Uploads](../api/reference/uploads), [Download links](../api/reference/links), [Artifacts](../api/reference/artifacts)
