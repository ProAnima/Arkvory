---
title: Command line (arkvoryctl)
---

# Command line (arkvoryctl)

`arkvoryctl` is the remote client of Arkvory for people and CI/CD. It uploads and downloads in parts, continues after interruptions and checks SHA-256. It works with the permissions of the key you give it.

## Install {#install}

| System                                               | Package                     | How to install                                                                                                                         |
| ---------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Windows 10/11, Windows Server 2019+ (x64)            | `Arkvory-CLI-Setup-x64.exe` | Run it. It installs for the current user, without administrator rights, and adds `arkvoryctl` to the user `PATH`. Open a new terminal. |
| Debian, Ubuntu (x64)                                 | `Arkvory-CLI-amd64.deb`     | `sudo apt install ./Arkvory-CLI-amd64.deb`                                                                                             |
| Fedora, RHEL-compatible (x64)                        | `Arkvory-CLI-x86_64.rpm`    | `sudo dnf install ./Arkvory-CLI-x86_64.rpm`                                                                                            |
| Any system with Node.js 24 (for example a CI runner) | `arkvoryctl.mjs`            | `node ./arkvoryctl.mjs --help`                                                                                                         |

The native packages include their own Node.js. The single file `arkvoryctl.mjs` has no npm dependencies. Take the files from a trusted release of `ProAnima/Arkvory` and compare their SHA-256 with `release-checksums.json`. ARM64 packages are not available yet. To update, install a newer stable release. Uninstalling keeps your profiles, key files and checkpoints.

## Connect to a server {#connect-to-a-server}

1. Get a key: a personal access token from the console, or a service key from your administrator. See [Accounts and keys](../use/accounts).
2. Save the key in a private file outside any repository. On Linux use mode `0600`. On Windows allow access only to your account.
3. Add a profile and check the connection:

```bash
arkvoryctl profile add production --server https://arkvory.example --token-file "$HOME/.secrets/arkvory.key" --repository releases
arkvoryctl doctor
arkvoryctl repositories
```

```powershell
arkvoryctl profile add production --server https://arkvory.example --token-file C:\Private\arkvory.key --repository releases
arkvoryctl doctor
```

`doctor` shows the server, the repository, the capabilities and the permissions of the key. The key is never a command argument.

## Profiles and environment {#profiles-and-environment}

Profiles are stored in `profiles.json` in `~/.config/arkvory` (on Windows, `.config\arkvory` in your user folder). A profile stores the server URL, the default repository and the **path** to the key file, not the key.

| Command                                                                 | Effect                                                                                       |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `profile add NAME --server URL [--token-file PATH] [--repository NAME]` | Adds a profile. The first profile becomes the default. The default repository is `releases`. |
| `profile list`                                                          | Shows all profiles and the active one                                                        |
| `profile use NAME`                                                      | Makes a profile the default                                                                  |
| `profile remove NAME`                                                   | Removes a profile                                                                            |

| Variable             | Meaning                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_TOKEN`      | The key itself. Has priority over any file.                                                                                 |
| `ARKVORY_TOKEN_FILE` | Path to a key file. Has priority over the profile's file.                                                                   |
| `ARKVORY_BASE_URL`   | Server URL. When set, the profile's key file is **not** used: give the key through `ARKVORY_TOKEN` or `ARKVORY_TOKEN_FILE`. |
| `ARKVORY_CLI_HOME`   | Another folder for `profiles.json`                                                                                          |

The server URL must use HTTPS. Plain HTTP is allowed only for `localhost`, `127.0.0.1` and `[::1]`. TLS verification cannot be turned off.

## Global options {#global-options}

| Option                     | Default          | Meaning                                                                                       |
| -------------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `--profile NAME`           | active profile   | Profile for this command only                                                                 |
| `--repository NAME`        | from the profile | Repository for this command only                                                              |
| `--json`                   | off              | One compact JSON result on stdout; errors as JSON on stderr                                   |
| `--lang en` or `--lang ru` | from `LANG`      | Language of help and messages                                                                 |
| `--timeout MS`             | 60000            | Limit for management requests (1 to 3600000)                                                  |
| `--attempt-timeout MS`     | 120000           | Limit for one transfer attempt (1 to 1800000)                                                 |
| `--retries N`              | 20               | Network retries for one operation (0 to 100); `0` turns them off                              |
| `--verbose`                | off              | One stderr line per HTTP request: method, path, status, time, request ID. No headers or keys. |
| `--help`, `--version`      |                  | Help; client version as JSON                                                                  |
| `--`                       |                  | Ends options, for file names that start with `-`                                              |

Each option may appear once. Unknown options are refused.

## Commands {#commands}

### Discovery and catalog {#discovery-and-catalog}

| Command                                                                    | Result                                     |
| -------------------------------------------------------------------------- | ------------------------------------------ |
| `doctor`                                                                   | Connection, capabilities and permissions   |
| `repositories [--after CURSOR]`                                            | Repositories visible to the key            |
| `operations [--after CURSOR]`                                              | API operations available in the repository |
| `list [--after CURSOR]`                                                    | Artifacts of the repository                |
| `search [--query TEXT] [--label TAG] [--collection NAME] [--after CURSOR]` | Search by name and metadata text           |
| `search --metadata-key KEY --metadata-value VALUE`                         | Exact metadata match (pass both)           |
| `inspect ID`                                                               | Metadata of one artifact                   |
| `storage usage` / `storage policy`                                         | Repository usage and storage policy        |

Pages return `next`. Pass it with `--after` to read the next page.

### Transfers {#transfers}

| Command                                                                        | Result                                                                                                                    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `upload FILE [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]`   | Resumable upload of any file                                                                                              |
| `download ID OUTPUT`                                                           | Resumable, SHA-256 verified download                                                                                      |
| `put FILE PATH [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]` | Uploads the file and makes it the next revision of a path. If the path already holds the same bytes, nothing is uploaded. |
| `get PATH OUTPUT`                                                              | Downloads the current revision of a path, verified and resumable                                                          |
| `link ID [--ttl SECONDS]`                                                      | A download URL without a key, valid 60 seconds to 24 hours (1 hour by default)                                            |
| `uploads status ID` / `uploads cancel ID`                                      | State of an upload session; cancel it (cancel is not a pause)                                                             |

`METADATA.json` contains `labels` and `metadata` (a map of strings). It has priority over `--label`.

```bash
arkvoryctl put "./Build/Game Setup.exe" builds/game/1.4/GameSetup.exe
arkvoryctl get builds/game/1.4/GameSetup.exe ./GameSetup.exe
arkvoryctl link 00000000-0000-4000-8000-000000000001 --ttl 900
```

A download link is a secret. It cannot be revoked before it expires.

### Packages and promotion {#packages-and-promotion}

| Command                                                                                                               | Result                                                                   |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `packages list [--group G] [--name N] [--after CURSOR]`                                                               | UPack packages                                                           |
| `packages publish FILE [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]`                                | Uploads a UPack archive and registers it                                 |
| `packages register ID`                                                                                                | Registers an already uploaded UPack                                      |
| `packages resolve NAME [--group G] [--exact V] [--range R] [--stage S] [--prerelease] [--order promoted]`             | Selects a version (`--exact` and `--range` exclude each other)           |
| `packages download NAME OUTPUT [same filters]`                                                                        | Selects a version, then downloads it verified                            |
| `promote ID --to REPOSITORY [--move] [--stage S1,S2] [--comment TEXT]`                                                | Publishes the artifact in another repository without sending bytes again |
| `stages list ID` / `stages add ID STAGE [--comment TEXT]` / `stages remove ID STAGE` / `stages artifacts [--stage S]` | Stages of artifacts                                                      |
| `promotions history ID` / `promotions journal [--after CURSOR]`                                                       | Promotion history                                                        |

```bash
arkvoryctl packages publish ./build.upack --label test --state ./job-state/build.json --json
arkvoryctl promote 00000000-0000-4000-8000-000000000001 --to prod --stage release
arkvoryctl packages download app ./app.upack --range ^1.4 --stage release
```

Use `--exact` for an exact version; `--version` prints the client version. See [Packages](../use/packages) and [Promotion](../use/promotion).

### Annotations and attachments {#annotations-and-attachments}

`annotations get ID` and `annotations set ID --revision N --file ANNOTATIONS.json` read and replace labels, metadata and collections. `attachments get ID`, `attachments history ID` and `attachments set ID --revision N --file ATTACHMENTS.json` do the same for the linked files of a build. Read first, then send the complete new state with the revision you read. A concurrent change returns a conflict (exit code 6).

### Backups {#backups}

| Command                                                           | Result                                                                      |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `backup status`                                                   | Vault, agent, plan, last point, warnings; exit code 9 on a critical warning |
| `backup run`                                                      | Queues a backup job                                                         |
| `backup jobs [--after CURSOR]` / `backup points [--after CURSOR]` | Jobs and restore points, newest first                                       |
| `backup verify POINT_ID`                                          | Queues a full verification of a point                                       |
| `backup pin POINT_ID [--off]`                                     | Keeps a point beyond retention, or releases it                              |

These commands need the installation owner (bootstrap) file key or an account administrator session. Personal tokens and service keys get 403 (exit code 3). The server's backup agent does the work. Monitoring example: `arkvoryctl backup status --json || alert`. See [Backups](../operate/backups).

## Resume interrupted transfers {#resume-interrupted-transfers}

After Ctrl+C or a network failure, run **the same command with the same options** again.

- `upload`, `put` and `packages publish` keep a checkpoint next to the source file: `<source>.arkvory-upload.json`, or the file given with `--state`. It stores the idempotency key before the first request, so a lost response never creates a second copy.
- To publish the same bytes as a **new** artifact, use a new `--state` file.
- `download` and `get` keep `<output>.arkvory-part` and `<output>.arkvory-download.json` next to the output. The final file appears only after SHA-256 verification. An existing output file is never overwritten.
- In CI, create the state folder before the job and keep it, together with the source file, between retries.

Keep checkpoints on a local disk with hard links (NTFS, ext4, XFS), not on FAT, exFAT or network shares. After a hard crash a `.lock` file remains. Check that the process with the PID in it has stopped, then delete only the `.lock` file.

## CI example {#ci-example}

```bash
# The key comes from the CI secret store. Never print it.
export ARKVORY_BASE_URL=https://arkvory.example
export ARKVORY_TOKEN_FILE=/run/secrets/arkvory-key
mkdir -p job-state
node ./arkvoryctl.mjs packages publish ./build.upack --label test --state ./job-state/upload.json --json
```

If registration fails after the upload, the JSON error contains `stage: "register"` and the `artifactId`. Repeat the same command. Registering the same artifact again is safe.

### CI systems {#ci-systems}

Every system below does the same: install a pinned `arkvoryctl.mjs`, take the key from the secret store of the system, and run one command. Pin the version and the SHA-256, so that a changed download fails the job. Use a service key that is limited to the repository and to the actions the job needs ([Accounts and keys](../use/accounts)). The agent needs Node.js 24.

```yaml
# GitHub Actions: .github/workflows/publish.yml
name: publish
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    env:
      ARKVORY_BASE_URL: https://arkvory.example
      ARKVORY_TOKEN: ${{ secrets.ARKVORY_KEY }}
      ARKVORY_CLI_VERSION: '0.3.0'
      ARKVORY_CLI_SHA256: 555af7e66e25447ba17ea0d3dc676f6d04b4b8adc47818d8c8bb548085752504
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: Install arkvoryctl
        run: |
          curl -fsSL -o arkvoryctl.mjs "https://github.com/ProAnima/Arkvory/releases/download/v${ARKVORY_CLI_VERSION}/arkvoryctl.mjs"
          echo "${ARKVORY_CLI_SHA256}  arkvoryctl.mjs" | sha256sum -c -
      - name: Publish the build
        run: node ./arkvoryctl.mjs put ./Build/Game.zip "builds/game/${GITHUB_REF_NAME}/Game.zip" --json
```

```yaml
# GitLab CI: .gitlab-ci.yml (ARKVORY_TOKEN is a masked CI/CD variable)
publish:
  image: node:24
  variables:
    ARKVORY_BASE_URL: https://arkvory.example
    ARKVORY_CLI_VERSION: '0.3.0'
    ARKVORY_CLI_SHA256: 555af7e66e25447ba17ea0d3dc676f6d04b4b8adc47818d8c8bb548085752504
  script:
    - curl -fsSL -o arkvoryctl.mjs "https://github.com/ProAnima/Arkvory/releases/download/v${ARKVORY_CLI_VERSION}/arkvoryctl.mjs"
    - echo "${ARKVORY_CLI_SHA256}  arkvoryctl.mjs" | sha256sum -c -
    - node ./arkvoryctl.mjs put ./Build/Game.zip "builds/game/${CI_COMMIT_TAG}/Game.zip" --json
```

```groovy
// Jenkins: Jenkinsfile. The agent has Node.js 24 and a checked arkvoryctl.mjs, installed as above.
pipeline {
  agent any
  environment {
    ARKVORY_BASE_URL = 'https://arkvory.example'
    ARKVORY_TOKEN = credentials('arkvory-key')
  }
  stages {
    stage('Publish') {
      steps {
        sh 'node ./arkvoryctl.mjs put ./Build/Game.zip "builds/game/${BUILD_NUMBER}/Game.zip" --json'
      }
    }
  }
}
```

Any other system, such as TeamCity or Buildkite, works the same way: set `ARKVORY_BASE_URL` and `ARKVORY_TOKEN` from its secret store and run the command. Decide by the [exit code](#exit-codes).

## Output {#output}

- Results are JSON on stdout. Without `--json` the JSON is indented. Backup commands print readable lines unless you add `--json`.
- Progress appears only on an interactive stderr.
- An error without `--json` is one stderr line with the server code, reason, message, next step and request ID. With `--json`, stderr contains `{"error": {...}}` with `code`, `exitCode`, `status`, `serverCode`, `reason`, `requestId` and `retryAfterSeconds`. Decide by `exitCode` when a code is unknown.

## Exit codes {#exit-codes}

| Code | Meaning                                                                  |
| ---- | ------------------------------------------------------------------------ |
| 0    | Success                                                                  |
| 2    | Wrong arguments or configuration                                         |
| 3    | No key, or access denied (401, 403)                                      |
| 4    | HTTP or network error, timeout, server busy, not found                   |
| 5    | Integrity failure (SHA-256 mismatch, 422 `integrity_mismatch`)           |
| 6    | Conflict: revision, state, lock, existing file, changed checkpoint (409) |
| 7    | Local file error or invalid server response                              |
| 8    | Server capacity limit: quota, disk, queue (507 `capacity_exceeded`)      |
| 9    | `backup status`: a critical backup warning is active                     |
| 130  | Interrupted                                                              |

The client retries only network failures and HTTP 408, 429, 502, 503 and 504, within `--retries`.

## Troubleshooting {#troubleshooting}

| Message                               | Cause and fix                                                                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `credential_required` (exit 3)        | No key found. Check `--token-file`, `ARKVORY_TOKEN_FILE`, or set the key when `ARKVORY_BASE_URL` is used.               |
| `forbidden` (exit 3)                  | The key lacks the permission. Run `doctor` to see the permissions.                                                      |
| `checkpoint_mismatch` (exit 6)        | The file, server, repository or options differ from the saved checkpoint. Use the original options, or a new `--state`. |
| `state_locked` (exit 6)               | Another process uses the checkpoint, or an old `.lock` remains after a crash.                                           |
| `destination_exists` (exit 6)         | The output file exists. Choose another name.                                                                            |
| `revision_mismatch` on `put` (exit 6) | Someone changed the path meanwhile. Check the path history, then decide.                                                |
| exit 8                                | Quota or disk is full. Ask the administrator.                                                                           |

## Related pages {#related-pages}

- [Clients and protocols](./index)
- [Transfers](../use/transfers) and [Files by path](../use/files)
- [TypeScript SDK](./sdk)
- [Errors](../api/errors)
