# Arkvory MCP tools

`arkvoryctl mcp` offers only the tools the key can use. Write tools exist only when the server was started with `--write`. `repository` is optional everywhere: the profile's repository is used when it is left out.

## Read

| Tool                   | Does                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `arkvory_repositories` | Repositories the key can see, with its permissions in each                                                            |
| `arkvory_search`       | Search every repository the key can list: `query` (name or metadata value), `labels` (all must match), `stage`        |
| `arkvory_artifacts`    | Artifacts of one repository in ID order                                                                               |
| `arkvory_artifact`     | One artifact: name, size, `sha256`, labels, metadata, stages; annotations with their `revision` and build attachments |
| `arkvory_packages`     | UPack versions; with `resolve`, the one version a name, range and stage select                                        |
| `arkvory_files`        | Files by path prefix; with `path`, the revision history of that path                                                  |
| `arkvory_history`      | The change feed of a repository                                                                                       |
| `arkvory_status`       | Server version and limits, HA copies, mirrors, backups, sites; a part the key may not read is `forbidden`             |
| `arkvory_download`     | Verified download of one artifact to `path` below the root; `overwrite: true` replaces a file, `maxBytes` caps size   |

Lists return at most 100 items. When `next` is not null, call again with `after` set to `next` and the same other arguments. `truncated: true` means fewer items or shorter strings came than asked for.

## Write

| Tool                      | Does                                                                                              | Hints                   |
| ------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------- |
| `arkvory_upload`          | `file` below the root as a new artifact; with `repositoryPath`, as the next revision of that path | not destructive         |
| `arkvory_publish_package` | `file` (a `.upack`) uploaded and registered as a package version                                  | not destructive         |
| `arkvory_promote`         | Adds `stage` to artifact `id`; with `sha256`, only if the artifact has exactly those bytes        | idempotent              |
| `arkvory_stage_remove`    | Removes `stage` from artifact `id`; the artifact stays                                            | destructive, idempotent |
| `arkvory_annotate`        | Replaces `labels` and/or `metadata` at `expectedRevision`; a field left out keeps its value       | destructive (replaces)  |

- `labels`: up to 32, letters, digits and `_ . : -`, up to 64 characters each. `metadata`: up to 32 keys (a letter, then letters, digits, `_ . -`) with values up to 1024 characters.
- Uploads are resumable: after a failure or a lost answer, repeat the same call with the same arguments. It continues the same upload or returns the same artifact; nothing is stored twice.
- The upload result carries `size` and `sha256` of the file that was read, and the server's receipt for the same bytes.
- A path that already holds the same bytes uploads nothing (`created: false`).
- A write to a repository outside `--write-repositories` fails with `repository_not_allowed` before any request.
- A file that contains the access key is refused (`source_contains_credential`).

## Never available

Deleting artifacts or files, restoring revisions, download links (`dtl_…`), users, groups, keys, policies, sites, updates and backups. These are tasks for a person in the console.
