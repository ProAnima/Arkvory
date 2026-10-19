---
title: Directory trees
description: Publish a directory as one archive, fetch it into a folder, check a folder against it and repair only the files that differ.
---

# Directory trees

A deployment agent or a CI job often needs a whole directory: a game build, a set of tools, a configuration tree. `arkvoryctl tree` publishes a directory as one ZIP artifact, fetches it into a folder, checks a folder against it and repairs only the files that differ. The artifact is an ordinary ZIP file: the console, the API and any ZIP tool read it, and backups keep it like any other artifact.

These commands are part of the free core. They need the same permissions as uploads and downloads: see [Uploads and downloads](./transfers).

## Publish a directory {#push}

```bash
arkvoryctl tree push ./Build/Game --name game-1.4.zip --label release
```

| Option                 | Meaning                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `--name NAME.zip`      | Name of the artifact. Default: the folder name with `.zip`. The name must end with `.zip`. |
| `--label TAG`          | A label for the artifact                                                                   |
| `--file METADATA.json` | Labels and metadata, as for `upload`                                                       |
| `--compress`           | Compress the entries (deflate). Without it, the files are stored as they are.              |

The result shows the artifact `id`, its `size`, `sha256` and the number of files in `entries`.

- **The same folder gives the same archive.** Files are in path order, every entry carries the date 1980-01-01, and only one property of the file system is kept: a file its owner may execute gets mode 755, every other file 644. Pushing an unchanged folder again gives the same bytes and the same SHA-256.
- **Interruptions.** The archive is built next to the folder (`.<folder>.arkvory-tree.zip`) and uploaded in parts with a checkpoint. After Ctrl+C or a network failure, run the same command again: it builds the same archive and continues the upload. Both files are removed after success.
- **What is refused.** Symbolic links, junctions, devices and pipes inside the folder (`tree_entry_unsupported`), names Windows cannot hold (`unsafe_name`), and two names that differ only in letter case (`case_collision`). Empty folders are not kept.
- **Stored or compressed.** Without `--compress`, the bytes of each file are a continuous range of the archive. The server can then serve one file by a byte range, and repairs move exactly the bytes of the files that differ. With `--compress` the archive is smaller and a repaired file is inflated on your machine.

## Fetch a directory {#pull}

```bash
arkvoryctl tree pull 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game
```

- **An empty or missing folder** gets the whole archive. It is downloaded next to the folder with checkpoints, so an interrupted pull continues where it stopped. After its SHA-256 is verified, the files are extracted into a new folder next to the target, which then takes the target's place.
- **A folder with files** becomes the tree. When the server has the [table of contents](#table-of-contents), only the files that differ are downloaded, each by its byte range, and files the tree does not have are removed. Without a table of contents the whole archive is downloaded, and the extracted folder replaces the old one.

The parent folder must exist. A file inside the target is replaced in one step: it is written to a temporary file next to it, checked, and renamed. A program that reads the file sees either the old or the new version.

## Check a directory {#verify}

```bash
arkvoryctl tree verify 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game
```

The result lists `missing` files, `mismatched` files (other size or other SHA-256) and `extra` files the tree does not have, with their numbers in `counts`. Each list shows at most 1000 paths. `ok` is `true` when nothing is missing or mismatched; extra files do not change it. The exit code is 0 when `ok` is true and 5 otherwise.

## Repair a directory {#repair}

```bash
arkvoryctl tree repair 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game
```

Repair writes every missing and mismatched file again and keeps extra files. With a table of contents it downloads only the entries of those files; `fetchedBytes` in the result says how many bytes of the archive it read. Without one it downloads the whole archive first.

## The table of contents {#table-of-contents}

After an archive is published, the server's worker reads it once and records each file: its path, size, SHA-256 and where its bytes are in the archive. This happens for artifacts whose name ends with `.zip` or `.upack`. Until it is done, or when the archive cannot be indexed, the commands work with the whole archive instead.

A server that has the table offers `zip-tree` in `tree` of `GET /api/v1/capabilities` (see `arkvoryctl doctor`); with an older server the commands use the whole archive. The table itself is the operation [getArtifactTree](../api/reference/artifacts#getArtifactTree): `status` is `ready`, `pending` or `unavailable` with a `reason`.

| `reason`             | Meaning                                                            |
| -------------------- | ------------------------------------------------------------------ |
| `not_archive`        | The artifact name does not end with `.zip` or `.upack`             |
| `invalid_archive`    | The file is not a readable ZIP archive                             |
| `unsafe_entry`       | A path leaves the archive, or an entry is a link or a special file |
| `encrypted_entry`    | An entry is encrypted                                              |
| `duplicate_entry`    | Two entries have the same path, also when ignoring letter case     |
| `unsupported_method` | An entry uses a compression method other than stored or deflate    |
| `crc_mismatch`       | The bytes of an entry do not match its checksum in the archive     |
| `too_many_entries`   | More than 100,000 entries                                          |
| `too_large`          | More than 100 GiB uncompressed                                     |

## How files are checked {#checks}

- **Every file is verified before it takes its place.** With a table of contents, its size and SHA-256 must match the values the server computed from the published archive. Without one, the whole archive's SHA-256 is verified first, then each file's size and CRC-32. A mismatch stops the command with `checksum_mismatch` (exit code 5), and the file in the folder is left as it was.
- **Nothing is written outside the folder.** Paths are read from the archive and from the server as untrusted data. A path that leaves the folder is refused with `path_outside_root`. A link inside the folder on the way to a file is never followed. Names that Windows cannot hold (`CON`, `aux.txt`, `a:b`, a trailing dot or space) are refused with `unsafe_name` on every system, so a tree means the same on Windows and Linux.
- **Modes.** A file extracted from the archive gets mode 755 if the archive marks it executable, otherwise 644 (Linux and macOS). A file repaired by range keeps the mode of the file it replaces.

## Faster transfers {#extensions}

The whole-archive upload of `tree push` and download of `tree pull` go through the same transfer as `upload` and `download`. A [client module](../protocols/cli#client-modules) with a transfer extension can carry them when the server offers the same extension; the archive stays an ordinary ZIP, and its SHA-256 and every file are checked as described above. Without a module, or when the server does not offer it, `arkvoryctl` uses its own transfer.

## Related pages {#related-pages}

- [Uploads and downloads](./transfers)
- [Command line](../protocols/cli)
- [Artifacts API](../api/reference/artifacts)
