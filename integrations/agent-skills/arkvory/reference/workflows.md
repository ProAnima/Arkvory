# Arkvory workflows

Each write below starts with a confirmation: say what will change and wait for the user's yes.

## Find and download a build

1. `arkvory_search` with `query` (part of the name or a metadata value such as a commit), `labels` or `stage`. Results are newest first.
2. Pick the artifact by `id`. If several match, show the user the candidates (name, size, published time, stages) and ask.
3. `arkvory_artifact` with that `id` and `repository`: check name, size, stages and metadata.
4. `arkvory_download` with `id` and a `path` below the root, such as `out/Game.zip`. Pass `maxBytes` when the size must stay bounded. The directory must exist.
5. Report the path, size and `sha256` from the result. The file is complete and verified; never re-download to "check" it.

A package version: `arkvory_packages` with `resolve` (`name`, `range` such as `^1.4`, `stage`), then download its `artifactId`.

## Publish a build

1. Make sure the file is complete (the build finished) and lies below the root.
2. Tell the user: repository, local file, labels and metadata you will set. Wait for a yes.
3. `arkvory_upload` with `file`, `labels`, `metadata`; for a file path in the repository add `repositoryPath`. For a UPack use `arkvory_publish_package`.
4. Compare `sha256` and `size` in the result with what you expected. Keep the artifact `id`.
5. On a network error, `busy` or a lost answer, repeat exactly the same call: it resumes. On `repository_not_allowed` or `forbidden`, stop and tell the user.
6. If `arkvory_publish_package` fails with `stage: "register"`, the bytes are stored as `artifactId`; repeat the same call to finish the registration.

## Promote

1. `arkvory_artifact`: read the current stages and `sha256`.
2. Tell the user: artifact `id`, name, `sha256`, the stage to add, and what reads that stage (deployments choose versions by stage). Wait for a yes.
3. `arkvory_promote` with `id`, `stage` and `sha256`. An `integrity_mismatch` means the artifact is not the one you verified: stop.
4. To take a stage back, `arkvory_stage_remove` after a separate confirmation.

## Labels and metadata

1. `arkvory_artifact`: read `annotations.labels`, `annotations.metadata` and `annotations.revision`.
2. Prepare the complete new list of labels and/or the complete metadata map; fields you do not pass keep their values.
3. Confirm, then `arkvory_annotate` with `expectedRevision` set to the revision you read.
4. On `conflict`, someone changed the annotations meanwhile: read them again, show the user the difference and ask again. Do not retry blindly.

## Check the installation

`arkvory_status` shows server version and limits, HA copies, mirrors, backups and sites. A section shown as `forbidden` is not an error: the key may not read it.
