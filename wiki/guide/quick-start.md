---
title: Quick start
---

# Quick start

This page shows the shortest path from nothing to a running Arkvory server with one uploaded file. Choose one installation method in step 1, then follow the other steps in order.

Download installers only from the [releases page](https://github.com/ProAnima/Arkvory/releases) of the project, and compare their SHA-256 with the checksum files of the release.

## Step 1. Install the server {#step-1-install-the-server}

### Windows {#windows}

You need Windows 10 version 1809 or later, or Windows Server 2019 or later, on x64, and administrator rights. An internet connection is not needed.

1. Run `Arkvory-Setup-x64.exe` and confirm the administrator prompt.
2. Choose the language and accept the license.
3. On the owner page, enter a name (3–64 Latin letters, digits, `.`, `-` or `_`) and a password of at least 12 characters. This is the first administrator account.
4. Finish the wizard. It can open the console for you.

Setup installs the program into `C:\Program Files\ProAnima\Arkvory` and the data into `C:\ProgramData\ProAnima\Arkvory`. It creates four Windows services: `Arkvorydatabase`, `Arkvoryapi`, `Arkvoryworker` and `Arkvorybackup`. They run without a signed-in user. See [Windows](../install/windows).

### Linux {#linux}

Use the package for your distribution. The package manager also installs the PostgreSQL server (versions 16 to 19 are supported).

```bash
# Debian, Ubuntu
sudo apt install ./Arkvory-amd64.deb

# Fedora, RHEL-compatible
sudo dnf install ./Arkvory-x86_64.rpm
```

The installation root is `/opt/proanima-arkvory`. The package creates the systemd services `arkvory-database`, `arkvory-api`, `arkvory-worker` and `arkvory-backup`. Check them:

```bash
systemctl status arkvory-api arkvory-worker arkvory-backup
```

See [Linux](../install/linux).

### Docker Compose {#docker-compose}

You need Docker with Compose. On Windows, use Docker Desktop with Linux containers. The script downloads Node.js and the release, so it needs internet access.

Download `install.sh` or `install.ps1` from the release and read it before you run it.

```bash
sudo bash ./install.sh --mode compose
```

On Windows, run PowerShell as the same user that runs Docker Desktop, without administrator rights:

```powershell
.\install.ps1 -Mode compose
```

The installation root is `/opt/proanima-arkvory` on Linux and `C:\ProgramData\ProAnima\Arkvory` on Windows. The stack contains the API, the worker, the backup agent and PostgreSQL 18. See [Docker](../install/docker).

## Step 2. Open the console {#step-2-open-the-console}

Open `http://127.0.0.1:8080/console/` in a browser on the server.

The server listens only on the local address `127.0.0.1` at first. To open the console from your own computer, forward the port through SSH:

```bash
ssh -L 8080:127.0.0.1:8080 admin@arkvory.example
```

Then open `http://127.0.0.1:8080/console/` on your computer. To give other machines access, set up [HTTPS](../install/https) first.

## Step 3. Create the owner {#step-3-create-the-owner}

Skip this step if you installed with `Arkvory-Setup-x64.exe`: Setup has already created the owner.

On Linux and Docker, the first account is created with the **recovery key**. The installer writes it to `config/bootstrap-token.txt` in the installation root. Only an administrator can read the file.

```bash
sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
```

```powershell
Get-Content C:\ProgramData\ProAnima\Arkvory\config\bootstrap-token.txt
```

1. In the console, open [[ui:navStart]] and expand [[ui:welcomeOwner]].
2. Paste the key into [[ui:welcomeRecovery]].
3. Enter the owner name and a password of at least 12 characters, then select [[ui:welcomeCreate]].
4. Sign in with the new name and password in the [[ui:connection]] card.

Keep the recovery key secret and do not delete the file. Installation and update tools use it. See [Security](../operate/security).

The owner is an administrator and can write to the repository `releases`. To create another repository, open [[ui:administration]], expand [[ui:manageGrants]], give the group `arkvory-owners` [[ui:write]] access to a new name, such as `builds`, and select [[ui:saveGrant]]. A repository name uses lowercase Latin letters, digits, `-` and `_`, and has at most 64 characters.

## Step 4. Create a key for your tools {#step-4-create-a-key-for-your-tools}

Scripts and the command-line client need a key. For a first test, use a personal access token:

1. Expand [[ui:personalAccessTokens]] in the [[ui:connection]] card.
2. Enter a [[ui:tokenName]], set [[ui:tokenScope]] to [[ui:tokenScopeReadWrite]] and select [[ui:generateToken]].
3. Copy the token. It is shown only once.
4. Save it in a file that only you can read, for example `~/.arkvory/key`.

For CI/CD and deployment agents, create a service account with its own key instead. See [Accounts and access](../use/accounts).

## Step 5. Upload and download with curl {#step-5-upload-and-download-with-curl}

A file path in a repository works like a file on a web server. `PUT` stores a new version of the path, and `GET` returns the current version.

```bash
export ARKVORY_KEY="$(cat ~/.arkvory/key)"

# Upload
curl -T ./Setup.exe -H "Authorization: Bearer $ARKVORY_KEY" \
  http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe

# Download
curl -fL -H "Authorization: Bearer $ARKVORY_KEY" -o Setup-copy.exe \
  http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe
```

The upload returns JSON like this:

```json
{
  "path": "builds/game/1.0/Setup.exe",
  "revision": 1,
  "created": true,
  "artifact": { "id": "…", "size": "1048576", "sha256": "…" }
}
```

If you upload the same bytes again, the answer is `200` with `"created": false`, and no new version is made. A new file gets status `201`.

In PowerShell:

```powershell
$headers = @{ Authorization = "Bearer $env:ARKVORY_KEY" }
$url = 'http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe'
Invoke-WebRequest -Method Put -InFile .\Setup.exe -Headers $headers -Uri $url
Invoke-WebRequest -Headers $headers -Uri $url -OutFile .\Setup-copy.exe
```

One `PUT` request must finish within 30 minutes. For very large files or slow networks, use the command-line client: it uploads in parts and continues after a failure. See [Raw files](../protocols/raw-files).

## Step 6. Use the command-line client {#step-6-use-the-command-line-client}

Install `arkvoryctl` on your own computer: `Arkvory-CLI-Setup-x64.exe` on Windows, `Arkvory-CLI-amd64.deb` or `Arkvory-CLI-x86_64.rpm` on Linux. On a CI machine with Node.js 24, `arkvoryctl.mjs` also works.

```bash
arkvoryctl profile add local --server http://127.0.0.1:8080 --token-file ~/.arkvory/key
arkvoryctl doctor
arkvoryctl put ./Setup.exe builds/game/1.0/Setup.exe
arkvoryctl get builds/game/1.0/Setup.exe ./Setup-copy.exe
```

The profile uses the repository `releases` unless you add `--repository`. If a transfer stops, run the same command again: it continues from where it stopped and checks the SHA-256 at the end. The client accepts plain HTTP only for the local computer; use HTTPS for a remote server. See [Command-line client](../protocols/cli).

## Next steps {#next-steps}

- [Concepts](./concepts): repositories, artifacts, stages and keys.
- [HTTPS](../install/https): open the server to other machines safely.
- [Backups](../operate/backups): connect a vault before you store important data.
- [Packages](../use/packages) and [Promotion](../use/promotion): versioned builds for deployment.
- [The web console](./console): a tour of all sections.
