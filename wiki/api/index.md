---
title: 'HTTP API overview'
description: 'The rules every integration with the Arkvory HTTP API needs: JSON and sizes, discovery, pagination, revisions, idempotency, retries, ranges, errors and limits.'
---

# HTTP API overview

The HTTP API is the interface that the web console, the command-line client and the SDK use. Anything they do, your integration can do in any language. This page explains the rules that apply to every operation. The pages under [Reference pages](#reference-pages) list each operation with its access rule, retry rule, parameters and answers, and they are generated from the contract that the server enforces.

## Basics {#basics}

- **Base path.** Every operation is under `/api/v1`, for example `https://arkvory.example/api/v1/repositories`. The only exceptions are the health checks under `/health`.
- **Format.** Requests and answers are JSON (`application/json`). A JSON body is limited to 64 KiB, and a request that sends another content type for a JSON operation gets `415`. Bytes of files are sent as `application/octet-stream`.
- **Unknown fields.** Most operations refuse a request that has a field they do not define (`400`, with the field in `details`). In answers, ignore fields you do not know.
- **Times** are RFC 3339 timestamps in UTC. **IDs** of artifacts, uploads, jobs, accounts and keys are UUIDs.
- **Names.** A repository name matches `[a-z0-9][a-z0-9_-]{0,63}`. A file name (the artifact name) has up to 240 characters and no `/` or `\`. A path in a repository has up to 1,024 characters.
- **Caching.** Answers carry `Cache-Control: private, no-store`.
- **Other protocols.** The routes `/v2` (containers), `/lfs` (Git LFS) and `/npm` follow the specifications of their own clients and use their own error formats. They are not part of the OpenAPI document. See [Clients and protocols](../protocols/index).

### Sizes and counts {#sizes}

A JSON number cannot carry every 64-bit value. Arkvory therefore sends **sizes and byte counters as decimal strings**: `"size": "1048576"`. The same is true for the size you declare when you create an upload. A size has no sign, no leading zeros and no more than 16 digits. Counts, revisions, limits and part indexes are ordinary JSON integers.

The largest object is 10,000 GiB (10 737 418 240 000 bytes) unless the administrator sets a lower `ARKVORY_MAX_OBJECT_BYTES`. A larger declared size is refused with `400`.

## Authentication {#authentication}

Every operation except sign-in, the public health checks and the sign-in options needs a credential in the header `Authorization: Bearer <credential>`. The credential is a console session, a personal access token, a service key or the recovery key. What a credential may do depends on its kind and on the **access rule** of each operation. Read [Authentication](./authentication) before you design the integration, and give automation a service key with only the actions it needs.

## Discovery {#discovery}

A client can ask the server what it supports instead of guessing. All of these need a credential.

| Request                        | Answer                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/capabilities`     | The API versions (`v1`), the gateway role (`api` or `reader`), the feature flags and the limits of this server: `maxObjectBytes`, `partBytes` (the smallest part, 8 MiB), `maxPartBytes` (1 GiB), `maxParts` (10,000) and `maxPageSize` (100).                                                                  |
| `GET /api/v1/operations`       | The operations that this credential may probably call, each with its `operationId`, method, path, `surface`, `retry` class, required actions and remaining conditions. Filter with `repository`, `surface`, `after` and `limit` (1 to 100, 50 by default). The list is advisory: only the real request decides. |
| `GET /api/v1/openapi.json`     | The OpenAPI 3.0.3 document of the writer API. Add `?surface=<name>` to get one surface only.                                                                                                                                                                                                                    |
| `GET /api/v1/auth/permissions` | The actions of the calling credential per repository.                                                                                                                                                                                                                                                           |
| `GET /api/v1/auth/me`          | Who the credential is, its kind and its coarse `read`/`write` grants.                                                                                                                                                                                                                                           |
| `GET /api/v1/repositories`     | The repositories the credential may see.                                                                                                                                                                                                                                                                        |

Use `capabilities` to read limits instead of hard-coding them. Treat a feature flag that you do not know as `false`.

### Surfaces {#surfaces}

Operations are grouped into six **surfaces**. They are labels of the contract, not separate services; the URLs do not change.

| Surface          | What it covers                                                                  |
| ---------------- | ------------------------------------------------------------------------------- |
| `discovery`      | Capabilities, the operation catalog, OpenAPI and repositories                   |
| `identity`       | Sign-in, the caller's own identity, tokens and key activation                   |
| `catalog`        | Artifacts, annotations, packages, files by path, stages, promotion, attachments |
| `transfers`      | Upload sessions, parts, completion jobs and downloads                           |
| `administration` | Accounts, groups, service accounts, keys, delegations, updates and backups      |
| `operations`     | Liveness, readiness, metrics and feedback                                       |

The health checks are `GET /health/live` (the process runs) and `GET /health/status` (public; `{"status":"ready"}` or `unavailable`) without a credential, and `GET /health/ready` and `GET /health/metrics` with one. They do not use the request budget, so load does not make a balancer remove the server.

## Pagination {#pagination}

A list is returned a page at a time. The answer has `items` and `next`. When `next` is not `null`, send it back unchanged in the query parameter `after` to read the following page; when it is `null`, the list is complete. Treat a cursor as an opaque string and do not build one yourself.

`limit` sets the page size, from 1 to 100. Most lists return 50 items when you omit it. Pages are not a snapshot: items that arrive while you read may or may not appear. Filters and sort order must stay the same while you follow `next`.

## Revisions and compare-and-swap {#revisions}

Things that people edit have a **revision** that counts up from 1: the labels, metadata and collections of an artifact, the attachments of a build, a file path, a storage policy, the backup plan and the settings of a service account. A change names the revision it expects in the request body, as `expectedRevision`:

```json
{ "expectedRevision": 3, "value": { "labels": ["tested"], "metadata": {}, "collections": [] } }
```

If the current revision is not 3, nothing changes and the server answers `409` with the reason `revision_mismatch`. This is **compare-and-swap**. Read the state again, apply your change to it and send the new revision. Never loop with a larger number to force the write. Use `0` for something that does not exist yet, such as a new path. The API does not use the `If-Match` header.

A **downloaded artifact** has a different validator, the `ETag`. See [Range downloads and ETags](#range-downloads).

## Idempotency keys {#idempotency}

An `Idempotency-Key` header makes a repeated request take effect once. Use a value of 1 to 128 characters from letters, digits and `_ . : -`, and keep it with the job state before the first request, so a restarted job repeats the same key. These writes need one:

| Operation                                                           | A repeat with the same key and the same body                                                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `createUpload`                                                      | Returns the same upload session.                                                                                    |
| `issueServiceKey` and `rotateServiceKey`                            | Returns the key's metadata with `200`, without the secret. Revoke the key and issue another if you lost the secret. |
| `requestBackupRun`, `requestBackupVerify`, `requestBackupRetention` | Returns the same request instead of queuing another.                                                                |

The same key with a different body is refused with `409` and the reason `idempotency_mismatch`. A key is scoped to the caller and the target, so two callers can use the same value.

Other writes are safe to repeat for another reason: they set a state (setting a stage, registering a package, revoking a key), or they are compare-and-swap. The next section tells you which.

## Retry rules {#retry-rules}

Every operation has a **retry class**. The class tells a client what to do when it did not receive the answer. The reference shows it as "Retry" on each operation.

| Class              | Meaning                               | What to do                                                                                                                                                                         |
| ------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read`             | Reading changes nothing.              | Repeat with backoff.                                                                                                                                                               |
| `idempotent`       | The same request has the same effect. | Repeat. An answer may differ in detail: deleting twice can report that the object is gone.                                                                                         |
| `idempotency-key`  | Safe only with a key.                 | Repeat with the same `Idempotency-Key` and the same body.                                                                                                                          |
| `compare-and-swap` | A change that depends on a revision.  | Read the state, decide again, and repeat with the revision you read. Never raise `expectedRevision` to get through a `409`.                                                        |
| `reconcile-upload` | A step of an upload session.          | Read the upload and its parts first (`getUpload`, `listUploadParts`), then send what is missing. A whole-file `PUT` cannot continue in the middle: it starts again from byte zero. |
| `reconcile-job`    | Queuing a completion job.             | Read the job (`getCompletionJob`) first. A failed job can be queued again.                                                                                                         |
| `never-automatic`  | A repeat could do the action twice.   | Do not repeat automatically. Check the result, then decide. Examples: creating an account, a token or a download link, running a storage policy, sending feedback.                 |

A network failure and the statuses `408`, `429`, `502`, `503` and `504` are temporary: repeat according to the class, wait at least as long as `Retry-After`, and add exponential backoff with a limit on attempts. Do not repeat `401`, `403` and other `4xx` answers without changing the request. Do not repeat `500` blindly; give the request ID to support. After a `503` on a change, the result is unknown, so use the class to find out what happened. The SDK and the command-line client apply these rules.

## Range downloads and ETags {#range-downloads}

`GET` and `HEAD` of `…/artifacts/{id}/content` return the original bytes with a strong `ETag` of the form `"sha256:<hex>"` and `Accept-Ranges: bytes`. The same applies to the downloads by package (`…/packages/content`) and by file path (`…/asset/content`, `…/raw/{path}`). They look up the current artifact on every request; `packages/content` and `raw` name the one they chose in `X-Arkvory-Artifact-Id`, so you can pin it for a resume.

- `Range: bytes=0-1023`, `bytes=1024-` and `bytes=-1024` return `206` with `Content-Range`. The server serves one range; a list of ranges is answered with the whole file.
- A start beyond the end of the file returns `416` with the code `invalid_input`, the reason `range_not_satisfiable` and `Content-Range: bytes */<size>`.
- To resume, send `Range` together with `If-Range: "<the ETag you saw>"`. If the content behind a name has changed, the `ETag` differs and you receive the whole new file instead of a mixed one.
- `If-None-Match` with the `ETag` returns `304` without a body.
- Verify the SHA-256 of what you saved. The ETag carries it.

A download link (`?token=`) works on the content route of one artifact. See [Authentication](./authentication#download-links).

## Errors {#errors}

Every failure has the same JSON envelope: `code`, `message`, `requestId`, and, when there is more to say, `reason`, `details` and `retryAfterSeconds`. Decide by `code` and `reason`, never by the `message`. Unknown reasons count as absent, and an unknown `code` is handled by its HTTP status. See [Errors](./errors).

## Rate limits and busy servers {#rate-limits}

Arkvory does not meter API calls per minute. It limits how much it does at once, and it limits attempts to guess a password:

- **Busy.** The server admits a fixed number of requests and transfers at the same time (`ARKVORY_MAX_REQUESTS`, 128 by default; 2 uploads and 16 downloads by default). A transfer may wait in a bounded queue for up to 20 seconds. When there is no room, the answer is `503` with the code `busy`. Repeat after `Retry-After`.
- **Capacity.** A full disk reserve, a quota or a limit on a number of objects returns `507`, which does not improve by waiting.
- **Attempts.** Too many sign-in, registration, password or feedback attempts return `429` with the code `rate_limited`. See [Authentication](./authentication#sign-in-limits).

Both `429` and `503` carry the `Retry-After` header in seconds (2 when the server has no estimate), and the same number in `retryAfterSeconds`. If a request goes through a proxy, the proxy may add its own limits.

## Request IDs {#request-ids}

Every answer has an `X-Request-Id` header, and every error has the same value in `requestId`. Log it with your own job and quote it to support. A request ID that you send is used only when it arrives through a proxy listed in `ARKVORY_TRUSTED_PROXIES` and has 8 to 128 safe characters; otherwise the server makes a new one. A W3C `traceparent` header is recorded in the server's access log only.

## Browsers and CORS {#cors}

A web page on the same address as Arkvory works without any setting. A page on another address works only if the administrator lists its exact origin in `ARKVORY_CORS_ORIGINS` (up to 16, HTTPS or loopback HTTP). Another origin gets `403` with the reason `origin_not_allowed`, even when the key is valid. Requests never use cookies: send the key in the `Authorization` header and keep it in memory. See [Environment variables](../reference/environment).

## Compatibility promise {#evolution}

`/api/v1` changes only by addition: new operations, new optional request fields, new answer fields, new error reasons and new feature flags. A change that would break a client, such as a different meaning, a new required field, a different status or different paging, gets a new version of the API and a period in which both work. In return, your client has to:

- ignore answer fields it does not know;
- treat an unknown `reason` as absent and an unknown `code` by its HTTP status;
- take limits from `capabilities`;
- send only the fields that the operation defines.

The `operationId` values are stable names. Use them when you map operations to your own code.

## Example: upload one file and download it {#example}

This sequence uploads a file in one request. For files above a few gigabytes, or on unreliable links, use [`arkvoryctl`](../protocols/cli) or the [SDK](../protocols/sdk): they send parts and continue after a failure. The example uses `jq` to read the JSON.

First, set the address and the key, and compute the size and the SHA-256 of the file:

```bash
export ARKVORY_URL=https://arkvory.example
export ARKVORY_KEY="$(cat ~/.arkvory/key)"
FILE=./Setup.exe
SIZE=$(stat -c %s "$FILE")
SHA=$(sha256sum "$FILE" | cut -d ' ' -f 1)
```

**Step 1. Reserve the upload.** The same `Idempotency-Key` returns the same session, so you can repeat this call safely.

```bash
ID=$(curl -fsS -X POST "$ARKVORY_URL/api/v1/repositories/releases/uploads" \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  -H "Idempotency-Key: build-1042-setup" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Setup.exe\",\"size\":\"$SIZE\",\"sha256\":\"$SHA\",\"labels\":[\"nightly\"]}" \
  | jq -r .id)
```

**Step 2. Send the bytes.** The server publishes the artifact when the size and the SHA-256 match.

```bash
curl -fsS -X PUT "$ARKVORY_URL/api/v1/repositories/releases/uploads/$ID/content" \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  -H "Content-Type: application/octet-stream" \
  -T "$FILE" | jq '{id, status}'
```

**Step 3. Download it.** The artifact ID is the upload ID.

```bash
curl -fL -o Setup-copy.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  "$ARKVORY_URL/api/v1/repositories/releases/artifacts/$ID/content"
sha256sum Setup-copy.exe
```

Step 2 answers `{"id": "…", "status": "available"}`. If the connection breaks during step 2, read the upload with `GET …/uploads/$ID`: while its status is `pending`, send the file again from the start. An upload session lives for 7 days. The key needs the actions `upload.create`, `upload.write`, `upload.complete` and `content.read` on `releases`. See [Uploads](./reference/uploads) and [Transfers](../use/transfers).

## Reference pages {#reference-pages}

Each page lists the operations of one group with their access rule, retry class, parameters and answers.

- [System and health](./reference/system): liveness, readiness, metrics, OpenAPI, capabilities
- [Repositories](./reference/repositories)
- [Uploads](./reference/uploads)
- [Artifacts and catalog](./reference/artifacts)
- [Packages](./reference/packages)
- [Files by path](./reference/files)
- [Stages and promotion](./reference/promotion)
- [Storage policies and retention](./reference/storage)
- [Mirrors](./reference/mirrors)
- [Download links](./reference/links)
- [Build attachments](./reference/attachments)
- [Accounts and sign-in](./reference/accounts)
- [Service accounts and keys](./reference/services)
- [Backups](./reference/backups)
- [Updates](./reference/updates)
- [Feedback](./reference/feedback)

Related pages: [Authentication](./authentication), [Errors](./errors), [TypeScript SDK](../protocols/sdk).
