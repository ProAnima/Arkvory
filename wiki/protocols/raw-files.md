---
title: Raw files
description: Store and read a file by its path with one HTTP request, using curl, wget or PowerShell, without installing anything.
---

# Raw files

A file path in a repository works like a file on a web server. `PUT` stores a body as the next version of a path. `GET` returns the current version. Use it from build scripts and CI jobs that have `curl` or PowerShell and nothing else.

The address is the same for all three methods:

```text
https://<host>/api/v1/repositories/<repository>/raw/<path>
```

For example: `https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe`.

## Store a file {#store-a-file}

You need a repository and a key with write access. See [Accounts and keys](../use/accounts). Send the key as `Authorization: Bearer <key>`. Raw files accept no other kind of authentication.

```bash
export ARKVORY_KEY="$(cat ~/.arkvory/key)"
URL="https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe"

curl --fail-with-body -sS -T ./GameSetup.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  "$URL"
```

```powershell
$headers = @{ Authorization = "Bearer $env:ARKVORY_KEY" }
$url = 'https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe'
Invoke-RestMethod -Method Put -InFile .\GameSetup.exe -Headers $headers -Uri $url
```

```bash
wget -qO- --method=PUT --body-file=GameSetup.exe \
  --header="Authorization: Bearer $ARKVORY_KEY" "$URL"
```

Give `curl -T` the full address of the file, not of a folder. Encode characters in the path that a URL does not allow: write a space as `%20`, `#` as `%23` and `?` as `%3F`.

The answer is JSON. A new file or new bytes return `201`:

```json
{
  "path": "builds/game/1.4/GameSetup.exe",
  "revision": 1,
  "created": true,
  "artifact": { "id": "00000000-0000-4000-8000-000000000001", "size": "1048576", "sha256": "…" }
}
```

If the path already holds exactly these bytes, the answer is `200` with `"created": false` and the same revision. Nothing is stored. A step of a CI job can run again without creating a new version. `size` is a string of decimal digits.

### Send a checksum {#send-a-checksum}

Send the SHA-256 of the file with `X-Checksum-Sha256`, and the length with `Content-Length`. `curl -T` and PowerShell send the length for a file. Then the server writes the bytes directly into storage in one pass and checks them there. A wrong checksum returns `422` with the code `integrity_mismatch`, stores nothing, and keeps the path as it was.

```bash
curl --fail-with-body -sS -T ./GameSetup.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  -H "X-Checksum-Sha256: $(sha256sum GameSetup.exe | cut -d' ' -f1)" \
  "$URL"
```

```powershell
$headers['X-Checksum-Sha256'] = (Get-FileHash .\GameSetup.exe -Algorithm SHA256).Hash.ToLower()
Invoke-RestMethod -Method Put -InFile .\GameSetup.exe -Headers $headers -Uri $url
```

Without the checksum, or with a chunked body that has no `Content-Length`, the server first writes the body into a temporary file and hashes it. Then it stores it. This needs up to twice the size of the file on the disk of the server for a short time, and a second pass over the bytes. The server removes temporary files that a failure left behind after one day.

When you send the checksum and the length, and the path already holds these bytes, the server answers `200` without reading the body, and closes the connection.

### Create only {#create-only}

A `PUT` reads only one condition, `If-None-Match: *`. With it, the server stores the file only if the path does not exist. Otherwise it answers `409` with the reason `already_exists`, also when the bytes are the same. Any other value of `If-None-Match` on a `PUT` returns `400`.

```bash
curl --fail-with-body -sS -T ./notes.txt \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "If-None-Match: *" \
  "https://arkvory.example/api/v1/repositories/releases/raw/docs/notes.txt"
```

### Two writers {#two-writers}

When two requests change the same path at the same time, the first wins. The later one gets `409` with the reason `revision_mismatch`, and the path keeps the content of the winner. Run the request again to make a new revision. The uploaded bytes of the loser stay as an artifact without a path until retention removes them.

## Read a file {#read-a-file}

`GET` returns the current version of the path. `HEAD` returns the headers only.

```bash
curl --fail-with-body -sS -H "Authorization: Bearer $ARKVORY_KEY" -o GameSetup.exe "$URL"
```

```powershell
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -Headers $headers -Uri $url -OutFile .\GameSetup.exe
```

```bash
wget --header="Authorization: Bearer $ARKVORY_KEY" -O GameSetup.exe "$URL"
```

The answer headers:

| Header                  | Value                                                           |
| ----------------------- | --------------------------------------------------------------- |
| `ETag`                  | `"sha256:<digest>"`: the SHA-256 of the content, in quotes      |
| `Content-Length`        | The size of the file                                            |
| `Accept-Ranges`         | `bytes`                                                         |
| `Content-Type`          | Always `application/octet-stream`                               |
| `Content-Disposition`   | `attachment` with the last segment of the path as the file name |
| `X-Arkvory-Artifact-Id` | The ID of the artifact that holds this version                  |

An unknown path returns `404`.

### Ranges and conditional requests {#ranges-and-conditional-requests}

| Request header              | Effect                                                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `Range: bytes=0-1023`       | `206` with the requested part and `Content-Range`. A start past the end of the file returns `416` with `Content-Range: bytes */<size>`. |
| `Range: bytes=-1024`        | The last 1024 bytes                                                                                                                     |
| `Range: bytes=1048576-`     | From the offset to the end                                                                                                              |
| `If-Range: "sha256:…"`      | Applies the `Range` only if the ETag is exactly this one. If the path has a new version, you get the whole new file.                    |
| `If-None-Match: "sha256:…"` | `304` with no body if the ETag is the same. It works with `HEAD` too.                                                                   |

Only one range per request is supported. A request with several ranges returns the whole file.

A path can get a new version at any time, and a `GET` resolves the path again. To continue a download safely, remember the `ETag` of the first answer and send it as `If-Range`:

```bash
etag=$(curl -sSI -H "Authorization: Bearer $ARKVORY_KEY" "$URL" | awk 'tolower($1)=="etag:" {print $2}' | tr -d '\r')
curl -sS -H "Authorization: Bearer $ARKVORY_KEY" -H "If-Range: $etag" \
  -H "Range: bytes=1048576-" "$URL" >> GameSetup.part
```

To skip a download when the file has not changed, send the ETag you stored last time:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $ARKVORY_KEY" \
  -H 'If-None-Match: "sha256:<digest>"' "$URL"
```

For large files, [`arkvoryctl get`](./cli) downloads with resume and verifies the SHA-256 for you.

## Paths and versions {#paths-and-versions}

A raw file is a [file by path](../use/files). Every `PUT` with new bytes adds a revision to the path: revision 1, 2, 3 and so on. Earlier revisions stay. Bytes are never replaced, because each revision points to its own immutable artifact, named after the last segment of the path.

- `GET` on the raw address always gives the current revision.
- To see all revisions of a path, read its history: [`getAssetHistory`](../api/reference/files#getAssetHistory), or [[ui:history]] in the console.
- To read an older revision, [`getAssetRevision`](../api/reference/files#getAssetRevision) returns its artifact. Download it with the content address of the artifact.
- To go back to an old revision, use [`restoreAsset`](../api/reference/files#restoreAsset). It adds a new revision that points to the old bytes.
- To list the paths of a repository by prefix, use [`listAssetPage`](../api/reference/files#listAssetPage).
- A path cannot be deleted. The history stays. Retention does not remove artifacts that a path revision uses.

The same operations are in the [SDK](./sdk#raw-files-by-path) (`client.raw.putRawFile`, `downloadRawFile`) and in [`arkvoryctl`](./cli#transfers) (`put`, `get`).

### Path rules {#path-rules}

| Rule        | Value                                                                               |
| ----------- | ----------------------------------------------------------------------------------- |
| Length      | 1 to 1024 characters                                                                |
| Folders     | Segments separated by `/`                                                           |
| Not allowed | An empty segment (`a//b`), `.` or `..`, a backslash, a colon and control characters |

`curl` and browsers remove `.` and `..` from a URL before they send it, so such a path never arrives. A path that breaks the rules returns `400`.

## Permissions {#permissions}

Personal tokens and file keys get read or write access to the repository. Service keys get exact actions.

| Operation     | Service key actions                                                                              | Personal token or file key             |
| ------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------- |
| `GET`, `HEAD` | `content.read`                                                                                   | Read access                            |
| `PUT`         | `upload.create`, `upload.write`, `upload.complete`, `asset.read`, `asset.write`, `artifact.read` | Write access, token scope `read-write` |

A deployment agent that only downloads needs the action `content.read`.

A [read gateway](../operate/read-gateways) accepts `GET` and `HEAD` only. A [mirror](../operate/mirrors) serves reads and refuses `PUT` with `409` and the reason `mirror_read_only`.

## Limits {#limits}

| Limit                      | Value                                                                                                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File size                  | The maximum object size of the installation, `ARKVORY_MAX_OBJECT_BYTES` (about 10 TiB by default)                                                                                      |
| One `PUT` request          | Must finish within 30 minutes and must not pause for more than 30 seconds (`ARKVORY_UPLOAD_DEADLINE_MS`, `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`). These are also the highest allowed values. |
| Uploads at the same time   | 2 per server and 1 per key by default (`ARKVORY_MAX_UPLOADS`, `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`). A waiting request gives up after 20 seconds with `503`.                            |
| Downloads at the same time | 16 per server and 4 per key by default                                                                                                                                                 |
| Quota                      | The file counts against the repository quota and the capacity of the installation                                                                                                      |

A single `PUT` has no resume: after a failure, it starts again from the first byte. Use raw files for small and medium files and for scripts. For large files or slow networks, use [`arkvoryctl put`](./cli) or the [SDK](./sdk). They upload in parts, continue after a failure and check the SHA-256. They also store the file as a revision of a path. The variables are described in [Environment variables](../reference/environment#transfers-and-bandwidth).

## Troubleshooting {#troubleshooting}

Errors are JSON documents with `code`, `reason`, `message` and `requestId`. See [Errors](../api/errors). Give the `requestId` to your administrator to find the request in the server log.

| Status       | Reason                                                      | Cause                                                                                                 | What to do                                                                            |
| ------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `400`        | `validation`                                                | The path, `Content-Length`, `X-Checksum-Sha256` or `If-None-Match` is not valid                       | Check the path rules and encode the URL                                               |
| `401`        | `credential_missing`, `credential_invalid`, `token_expired` | No key, a wrong key, or an expired token                                                              | Send `Authorization: Bearer <key>`. Basic authentication does not work for raw files. |
| `403`        | `permission_missing`, `read_only_token`                     | The key cannot write, or it is a read-only token                                                      | Use a key with the actions of [Permissions](#permissions)                             |
| `404`        |                                                             | The path does not exist, or the key does not see the repository                                       | Check the repository name and the path                                                |
| `409`        | `already_exists`                                            | `If-None-Match: *` and the path exists                                                                | Remove the header to add a revision                                                   |
| `409`        | `revision_mismatch`                                         | Another request changed the path first                                                                | Run the request again                                                                 |
| `409`        | `mirror_read_only`                                          | The repository is a mirror                                                                            | Write to the main server                                                              |
| `416`        | `range_not_satisfiable`                                     | The range starts after the end of the file                                                            | Check the size with `HEAD`                                                            |
| `422`        | `integrity_mismatch`                                        | The body does not match `X-Checksum-Sha256` or `Content-Length`                                       | Compute the checksum again; check the proxy                                           |
| `503`        | `busy`                                                      | Too many transfers at the same time                                                                   | Wait for the time in `Retry-After` and retry                                          |
| `507`        | `storage_quota`                                             | The repository quota or the capacity of the installation is reached                                   | Free space or ask for a larger quota                                                  |
| Not a status | `curl: (55)` or `(56)` while sending                        | The server closed the connection. When the path holds the bytes already, it answers `200` and closes. | Run `curl -i` and read the answer                                                     |
| Not a status | The connection closes after 30 minutes                      | The upload deadline                                                                                   | Use `arkvoryctl put`                                                                  |

## Related pages {#related-pages}

- [Clients and protocols](./index)
- [Command line (arkvoryctl)](./cli)
- [TypeScript SDK](./sdk)
- [Files and paths](../use/files)
- [API reference: Files by path](../api/reference/files)
