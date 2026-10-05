---
title: Security
description: How to harden an Arkvory server, where its secrets live, which limits protect sign-in, what is logged and audited, and what is sent to the ProAnimaStudio hub.
---

# Security

This page is for the administrator who runs a server. It starts with the steps to harden a new installation and then describes each protection in detail.

The project states that a threat model and an external security review are still open. Do not publish the server on the open Internet. Let only the networks of your clients reach it.

## Harden a new server {#checklist}

1. Keep the default listen address `127.0.0.1` until HTTPS works. See [Network and HTTPS](#network).
2. Turn on HTTPS and open only the HTTPS port to the client networks. Never open the database port.
3. Create personal accounts for the administrators. Keep the recovery key for emergencies. See [Recovery key](../install/index#recovery-key).
4. Give each tool or CI system its own service account with a key that has the fewest rights. See [Keys and tokens](#keys).
5. Leave self-registration off. It is off by default.
6. If a reverse proxy is in front of Arkvory, set `ARKVORY_TRUSTED_PROXIES`. See [Sign-in limits](#sign-in-limits).
7. Put the backup vault on an encrypted volume that only the service account and the backup administrator can read. See [Backups](./backups).
8. Keep copies of the secret files outside the server. See [Back up your secrets](#secret-backups).
9. Connect the metrics and the alerts. See [Monitoring](./monitoring).

## Network and HTTPS {#network}

The server listens on `127.0.0.1:8080` by default. A native installation can listen on another address after you configure HTTPS:

```bash
sudo arkvory configure --root /opt/proanima-arkvory --tls-cert /etc/arkvory/fullchain.pem --tls-key /etc/arkvory/privkey.pem --listen-host 0.0.0.0
```

The command checks the files, restarts the services and restores the old settings when the services do not come up. See [HTTPS and reverse proxy](../install/https) for the full procedure and for Docker Compose, which needs a reverse proxy.

- The certificate and the key must read, match and not be expired. Otherwise the API does not start and never falls back to plain HTTP.
- The minimum TLS version is 1.2. Set `ARKVORY_TLS_MIN_VERSION=TLSv1.3` to require 1.3. Client certificates are not supported.
- The server answers with `Strict-Transport-Security: max-age=31536000` when it serves HTTPS itself. A proxy owns that header when it terminates TLS.
- Renewed certificate files are read again every 300 seconds (`ARKVORY_TLS_RELOAD_SECONDS`) without a restart. New connections get the new certificate. A file that cannot be read leaves the working certificate in place and writes `tls.reload_failed`. `tls.expiring` is written daily for the last 14 days.
- A non-loopback address without TLS and without a trusted proxy writes the warning `http.plaintext_exposed` at start. Fix it before you let clients in.
- Arkvory never turns off the check of a certificate that it receives: not for mirrors, not for the hub, not in the command-line client. Add your own certificate authority with `--mirror-ca-file` for mirrors.

Behind a reverse proxy the API stays on loopback. The proxy must stream bodies without buffering whole files. Do not log the query string at the proxy, because a download link carries its secret there.

## Secrets on the server {#secrets}

The installers create these files in the installation root. Keep the permissions that the installer set.

| File                         | Content                                                               | Access                                                                               |
| ---------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `config/bootstrap-token.txt` | The recovery key. It has administrator rights                         | Linux: root only (mode 0600). Windows: SYSTEM and Administrators                     |
| `config/keys.json`           | SHA-256 hashes of the recovery key and the health key, never the keys | Linux: root writes, the service group reads (0640). Windows: inherited from the root |
| `config/health-token.txt`    | The health key `deployment-health`. It has no repository rights       | Linux: root only. Compose: readable in the container                                 |
| `config/runtime.json`        | All server settings, including the database URL with its password     | Linux: root writes, the service group reads (0640). Windows: inherited from the root |
| `config/postgres.env`        | The database password of a Compose installation                       | Root only, or SYSTEM and Administrators                                              |
| `github-token.txt`           | An optional GitHub token for updates                                  | Root only, or SYSTEM and Administrators                                              |
| `config/mirrors/*.token`     | Read keys for the source servers of mirrors                           | The service account                                                                  |
| The TLS key                  | The private key of the certificate                                    | You choose the location. Allow only the service account                              |

On Windows the root grants full control to SYSTEM and Administrators. The service account `LocalService` reads the root and writes only `data\`, `logs\` and the update inbox. The database runs under a different account, so the API cannot read the database files.

Rules for all secrets:

- Pass them in files or environment variables, never in command arguments. Arguments are visible in the process list.
- Do not copy the recovery key to clients, CI systems or scripts. Create accounts and service keys for daily work.
- The server never writes keys, passwords, tokens, `Authorization` headers or query strings to its log. See [Monitoring](./monitoring#never-logged).
- Command output of the installer redacts database URLs, keys and long secrets.

To replace the recovery key, change the file `bootstrap-token.txt` and its hash in `config/keys.json` together, keep the entry `deployment-health`, and restart the API and the worker. See [Configuration](../install/configuration).

## Passwords and sign-in limits {#sign-in-limits}

Passwords have 12 to 128 characters and are stored only as a salted hash (scrypt). A sign-in lasts 12 hours. One account has at most 32 active sessions; a new sign-in ends the oldest. A password change or a reset ends all sessions and revokes all personal tokens of the account.

Arkvory has no hard lockout, which would let anyone who knows a name lock out the owner. It slows attacks in layers:

| Layer                          | Limit                                                                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Per address, sign-in           | 10 attempts at once, then 1 more every 15 seconds. A correct password gives the attempt back. IPv6 counts per /64 network                                                                                                      |
| Per address, self-registration | 3 attempts, then 1 every 20 minutes; 20 per process, then 1 every 3 minutes                                                                                                                                                    |
| Per account                    | Every wrong password adds one unit of debt. The debt shrinks by 1 every 6 seconds. Above 20 units, each wrong password adds a wait that doubles from 1 second to 2 minutes. During the wait even the correct password gets 429 |
| Sign-in requests at once       | At most 16, and the body of a request must arrive within 10 seconds                                                                                                                                                            |
| Password checks                | Anonymous and administrator checks use separate queues, so a flood of sign-ins does not block an administrator                                                                                                                 |

The answer is 429 `rate_limited` with the reason `login_attempts` and the header `Retry-After`. The address counters live in the process and reset at a restart. The account debt is in the database. A password reset by an administrator clears it.

Behind a reverse proxy, set `ARKVORY_TRUSTED_PROXIES` to the addresses of the proxy (up to 32, IP or CIDR). Only these addresses may name the client address with `X-Forwarded-For`. Without the setting, every client shares the address of the proxy, and a few failed sign-ins lock everyone out for a while.

## Keys, tokens and expiry {#keys}

| Credential                  | Lifetime                                                                                         | Rotation                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Sign-in session             | 12 hours                                                                                         | Sign in again                                                                                                        |
| Personal access token       | 90 days by default, at most 365. Scope `read` or `read-write`. Never administrator rights        | Create a new token in [[ui:personalAccessTokens]] and revoke the old one                                             |
| Service key                 | 90 days by default, at most 365. A key that is issued but not activated expires after 15 minutes | [[ui:keyRotate]] issues a new key. The old key works for at most 24 more hours. [[ui:keyRevoke]] stops a key at once |
| Download link               | One hour in the console                                                                          | Create a new link                                                                                                    |
| Recovery key and health key | They do not expire                                                                               | Replace them by hand. See [Secrets on the server](#secrets)                                                          |

Create personal tokens and change passwords only in a signed-in session. A token cannot create tokens. A personal token has no administrator rights, whoever owns it.

Least privilege for tools:

- Create one service account for each consumer in [[ui:services]], with [[ui:servicePolicy]] on the exact repositories and the exact actions that it needs. [[ui:bindingRead]] and [[ui:bindingPublish]] fill typical sets.
- Creating accounts and grants needs the separate right of the recovery key or of a delegation. [[ui:delegations]] lets the owner pass limited rights to an operator. A delegated key never outlives the key of its issuer.
- Give the metrics scraper its own key with minimal rights.
- Revoking a grant blocks a key that waits for activation but does not revoke keys that are already active. Revoke or disable those yourself. A download that has started continues after a revoke.
- A change of rights applies from the next request. The server checks access again for every request, for lists, metadata and file bytes.

## Audit logs {#audit}

| Journal                  | What it holds                                                                                                                                                             | Where to read                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Security journal         | Sign-ins and failures, registrations, changes of accounts, groups, grants, passwords and personal tokens, with actor, credential kind, target, outcome and client address | `GET /api/v1/security/audit`, for an administrator session or the recovery key       |
| Catalog audit            | Changes of artifacts, paths, annotations and stages in a repository                                                                                                       | `GET /api/v1/repositories/{repository}/audit`, with the permission to read the audit |
| Service account activity | Creation, changes, issued and revoked keys of a service account                                                                                                           | [[ui:serviceAudit]] in the console                                                   |
| Process log              | One `http.access` line per request, with `principal` and `clientIp`                                                                                                       | See [Monitoring](./monitoring#logs)                                                  |

The security journal is append-only: the database refuses to change or delete a row. The server keeps 365 days and at most 1,000,000 rows, and removes the oldest rows in batches. Requests that rate limits refuse are not journaled, so a flood cannot grow the table. Export the journal to your own event store if you need a longer history.

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_KEY" "https://arkvory.example/api/v1/security/audit?limit=100"
```

Use the `after` parameter with the last ID to read older rows.

## Console and browser {#console-headers}

The server sets these headers on the answers of the console:

| Header                    | Value                                                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy` | `default-src 'none'; img-src 'self' blob:; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` |
| `Referrer-Policy`         | `no-referrer`                                                                                                                                                                       |
| `X-Content-Type-Options`  | `nosniff`                                                                                                                                                                           |
| `Cache-Control`           | `private, no-store`                                                                                                                                                                 |
| `X-Request-Id`            | The request ID of the answer                                                                                                                                                        |

Every API answer also carries `X-Content-Type-Options`, `Cache-Control` and `X-Request-Id`. The CSP allows no inline script, no outside script, no framing and no connection to other hosts. Pictures from `blob:` are the screenshots that you add to a feedback message.

The server sets no cookies. The console keeps a key or a session token only in the memory of the browser tab. The browser stores only the choice of theme and language, and the private files of the download queue. A browser page from another address cannot call the API: `ARKVORY_CORS_ORIGINS` is empty by default. It lists up to 16 exact origins for an external console, with HTTPS or HTTP on loopback. An allowed origin gets no extra rights, because every request needs a key.

## Update signing {#update-signing}

Every release has a manifest `arkvory-release.json` with the SHA-256 of its archive and installer, and a signature `arkvory-release.json.sig`. The signature is an Ed25519 signature in the minisign format. The updater holds the public keys inside its code.

- A release from the hub or from GitHub installs only when its signature matches a built-in key and the SHA-256 values match the manifest. A wrong signature is an error, and the updater does not look for another source.
- The private signing key stays with the maintainer and is never on your server. A release can carry an old and a new public key to rotate keys.
- A local folder that you pass with `--artifact` is your own choice. A signature file in it is checked when present.
- The graphical installer and the `.deb` and `.rpm` packages are not signed with a publisher certificate yet. Windows shows the publisher as unknown. Download them only from [GitHub Releases](https://github.com/ProAnima/Arkvory/releases) and compare the SHA-256 values with `release-checksums.json`.
- A release that changes the database schema installs only after the server has made and verified a fresh backup. See [Updates](../install/updates).

## What is sent to the ProAnimaStudio hub {#hub}

Updates are approved in the hub of ProAnimaStudio (`https://hub.proanima.net`). The server contacts it in these cases:

| Data            | When                                           | Content                                                                                                                                                                                                                                              |
| --------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Update check    | Every 6 hours                                  | The current version, the operating system and the architecture are part of the address. With statistics on, a random installation ID in the header `X-Install-Id`                                                                                    |
| Event `updated` | After an installed update, with statistics on  | The version and the installation ID                                                                                                                                                                                                                  |
| Feedback        | Only when a user sends the form in the console | The text, an optional email address for the reply, up to 6 screenshots, and the log of the browser page. An administrator can add the last 1.5 MiB of the API log and a system summary. The form shows all of it before you send ([[ui:reportShow]]) |

The installation ID is a random UUID in `config/install-id`. It carries no name, address or content. The project states that the hub stores no IP addresses, names or file content. Without statistics the ID is not sent, and the hub offers a version only when it is released to all installations. The system summary holds versions, the schema number and the state of updates and mirrors, without addresses and secrets. The API log has no secrets either.

Turn it off:

```bash
sudo arkvory configure --root /opt/proanima-arkvory --statistics off
sudo arkvory configure --root /opt/proanima-arkvory --hub-off
```

- `--statistics off` stops the installation ID and the `updated` event. The console has the same switch: [[ui:updateStatistics]] in [[ui:updates]].
- `--hub-off` stops all contact with the hub. Updates then come only from GitHub, and console feedback is off after the next restart of the services. The users get the contact address shown in the console instead.
- `--hub-url https://hub.example` points the server to another hub. Only HTTPS, or HTTP on loopback, is accepted.

The checks every 6 hours also run when automatic installation is off. A server without internet access installs from a local copy of a release. See [Updates](../install/updates).

## Back up your secrets {#secret-backups}

The backup vault holds the catalog, the password hashes and all published files. It is not encrypted. It does not hold the files of your configuration. Keep a second copy of these files in an encrypted place outside the server:

- `config/keys.json` and `config/bootstrap-token.txt` (the recovery key),
- `config/runtime.json`,
- the TLS certificate and key,
- `config/mirrors/` with the keys of the mirrors,
- `config/hub.json` and `github-token.txt`, if you use them.

A restore creates a new instance with its own settings and its own keys file. After a restore, sessions are gone, personal tokens and service keys are revoked, and cleanup and retention policies are off. Issue new keys and turn the policies on again on purpose. Passwords return as they were at the snapshot time. Treat every copy of these files as a secret. See [Backups](./backups).

## Report a vulnerability {#vulnerabilities}

Do not describe a vulnerability or publish keys in a public issue. The owner of the project is Ian Panaev (GitHub account `ProAnima`). The project has not published a dedicated private channel for security reports yet. Send a short message without exploit details through the GitHub account of the project or to the studio address that the console shows, `info@proanima.net`, and ask for a private way to continue. See `SECURITY.md` in the repository.

## Related pages {#related-pages}

- [Monitoring](./monitoring)
- [Self-healing](./self-healing)
- [Accounts and access](../use/accounts)
- [HTTPS and reverse proxy](../install/https)
- [Authentication](../api/authentication)
- [Errors](../api/errors)
