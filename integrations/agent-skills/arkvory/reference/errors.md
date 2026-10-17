# Arkvory error codes

A failed tool call has `isError: true` and `error.code`; server errors may add `reason`, `status`, `requestId` and `retryAfterSeconds`. Quote the `requestId` when you report a server failure. Do not repeat a failing call in a loop.

## Server codes

| Code                 | Do                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `invalid_input`      | Fix the arguments; `details` names the field. Do not repeat unchanged.                                  |
| `unauthorized`       | The key is missing, expired or revoked. Tell the user; never ask for the key in the chat.               |
| `forbidden`          | The key lacks the permission (`reason: permission_missing`). Tell the user which action and repository. |
| `not_found`          | Wrong ID, path or repository, or not visible to this key. Search again; do not guess IDs.               |
| `conflict`           | State changed (`revision_mismatch`, `version_exists`, `upload_expired`). Read again and ask the user.   |
| `gone`               | A cursor expired. Start the list again without `after`.                                                 |
| `busy`               | The server asks to wait. Wait `retryAfterSeconds`, then repeat once.                                    |
| `rate_limited`       | Too many requests. Wait `retryAfterSeconds`, then repeat once.                                          |
| `unavailable`        | The server or a dependency is down. Try once more later, then tell the user.                            |
| `capacity_exceeded`  | Quota, disk or queue full. Tell the user; repeating does not help.                                      |
| `integrity_mismatch` | Bytes do not match the SHA-256. Nothing was built on them. Tell the user; do not use the artifact.      |
| `read_only`          | The server is in read-only mode. Writes are refused until an administrator changes it.                  |
| `internal`           | Server failure. Report the `requestId`.                                                                 |

## Local codes

| Code                         | Do                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `repository_not_allowed`     | The MCP server may not write there. Ask the user to change its configuration.            |
| `path_outside_root`          | The path leaves the working root, or is not a regular file. Use a file below the root.   |
| `invalid_path`               | Not a usable file name (on Windows: `NUL`, `a:b`, a trailing dot or space).              |
| `file_not_found`             | The local file does not exist. Check the path relative to the root.                      |
| `directory_not_found`        | Create the target directory first.                                                       |
| `destination_exists`         | The target file exists. Choose another path, or pass `overwrite: true` after confirming. |
| `max_bytes_exceeded`         | The artifact is larger than `maxBytes`; nothing was transferred.                         |
| `source_changed`             | The file changed while being read. Wait until the build is finished, then repeat.        |
| `source_contains_credential` | The file contains the access key. Never upload it.                                       |
| `state_locked`               | The same upload runs in another call. Wait for it; if it persists, tell the user.        |
| `private_path`               | The path is one of arkvoryctl's own files (profiles, keys). Never read or write them.    |
| `output_too_large`           | The result does not fit. Ask for fewer items (`limit`).                                  |
| `invalid_cursor`             | Pass `next` back unchanged as `after`.                                                   |
| `network_failed`             | The server cannot be reached. Repeat once; an upload resumes.                            |
| `request_timeout`            | No answer in time. Repeat once; an upload resumes.                                       |
| `interrupted`                | The call was cancelled.                                                                  |
