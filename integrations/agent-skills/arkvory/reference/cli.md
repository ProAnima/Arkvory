# arkvoryctl fallbacks

Use these only when the `arkvory_*` tools are not connected. The same rules apply: confirm every write, never pass a key as an argument, refer to artifacts by ID. Add `--json` and decide by the exit code: 0 success, 2 arguments, 3 access, 4 network or server busy, 5 SHA-256 mismatch, 6 conflict, 7 local file error, 8 capacity.

## Check the connection

```bash
arkvoryctl doctor --profile builds --json
arkvoryctl repositories --json
```

## Find and download

```bash
arkvoryctl search --all --query build-42 --label release --json
arkvoryctl inspect ARTIFACT_ID --json
arkvoryctl download ARTIFACT_ID ./out/Game.zip --json
arkvoryctl packages download app ./out/app.upack --range ^1.4 --stage release --json
arkvoryctl get builds/game/1.0/Game.zip ./out/Game.zip --json
```

A download is verified by SHA-256 and resumes when repeated; an existing file is never overwritten.

## Publish

```bash
arkvoryctl upload ./build/Game.zip --label test --json
arkvoryctl put ./build/Game.zip builds/game/1.0/Game.zip --json
arkvoryctl packages publish ./build/app.upack --label test --json
```

Repeat the same command after a failure: it resumes from its checkpoint beside the file. Compare `sha256` in the output with the file.

## Promote and annotate

```bash
arkvoryctl stages list ARTIFACT_ID --json
arkvoryctl stages add ARTIFACT_ID release --comment "QA passed" --json
arkvoryctl stages remove ARTIFACT_ID staging --json
arkvoryctl annotations get ARTIFACT_ID --json
arkvoryctl annotations set ARTIFACT_ID --revision 3 --file annotations.json --json
```

## Not for agents

Do not run `arkvoryctl link` (its URL is a bearer credential) or anything that deletes, restores or administers. Ask the user to do it.
