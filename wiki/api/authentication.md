---
title: Authentication
description: Every way to authenticate to the Arkvory HTTP API, what each credential may do, and how access rules and repository actions work.
---

# Authentication

Every call to `/api/v1` needs a credential, except the public health checks, the sign-in options, sign-in and registration. This page lists the kinds of credentials, how to get and send each one, and what the access rules in the [API reference](./index#reference-pages) mean. For the rules of the people who manage access, see [Accounts and access](../use/accounts).

## Credentials at a glance {#credentials}

| Credential            | Looks like            | You get it by                                           | Lifetime                        | Use it for                                                            |
| --------------------- | --------------------- | ------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------- |
| Console session       | `dps_…`               | Signing in with a name and a password                   | 12 hours                        | A person in the console, or a script that signs in                    |
| Personal access token | `pat_…`               | Creating it from a session                              | 90 days by default, at most 365 | One person's scripts and tools                                        |
| Service key           | `arkvory_…`           | Issuing it for a service account, then activating it    | 90 days by default, at most 365 | CI/CD, deployment agents, other systems                               |
| Recovery key          | 64 hexadecimal digits | The installer writes it to `config/bootstrap-token.txt` | Does not expire                 | Creating the owner, administering service accounts, recovering access |
| Download link         | `dtl_…`               | Creating it for one artifact                            | 60 seconds to 24 hours          | Giving one artifact to someone without a key                          |

Use a service key for automation and a personal access token for a person's tools. Do not use the recovery key for daily work.

## Header formats {#headers}

`/api/v1` accepts a credential in one header:

```http
Authorization: Bearer <credential>
```

- A credential is 32 to 512 characters long. Anything else is `credential_invalid` at once.
- The container registry (`/v2`), Git LFS (`/lfs`) and the npm registry (`/npm`) also accept HTTP Basic, because `docker login`, git and npm send credentials that way. The user name is not checked; the password is the credential. See [Clients and protocols](../protocols/index#credentials).
- A download link goes in the query string, as `?token=dtl_…`, and works only on the content route of one artifact. See [Download links](#download-links). An `Authorization` header always wins over the query.
- A request without a valid credential gets `401` with `WWW-Authenticate: Bearer` and a reason: `credential_missing`, `credential_invalid`, `session_expired` or `token_expired`. Only the holder of the exact secret of an expired credential learns that it expired.
- **No cookies.** Arkvory sets none and reads none, so a browser never attaches a credential by itself and there is no cross-site request forgery to defend against. A script sends the header on every call. The console keeps its session token in the memory of the browser tab and forgets it when you close the tab.
- **Other origins.** A page on the same address as Arkvory needs nothing. A page on another address is refused with `403` and the reason `origin_not_allowed` unless the administrator listed its origin in `ARKVORY_CORS_ORIGINS`, even with a valid credential. Use HTTPS: a credential in plain HTTP is readable on the network. See [HTTPS](../install/https).

Check what a credential is and what it may do:

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_KEY" "$ARKVORY_URL/api/v1/auth/me"
curl -fsS -H "Authorization: Bearer $ARKVORY_KEY" "$ARKVORY_URL/api/v1/auth/permissions"
```

## Console sign-in sessions {#sessions}

A person signs in with a name and a password and receives a session. The console does this for you; a script can do the same.

1. Put the name and the password in a private file, `login.json`, so they never appear in a command line or a process list:

   ```json
   { "name": "alice", "password": "a long password of 12 to 128 characters" }
   ```

2. Call `login`:

   ```bash
   curl -fsS -X POST "$ARKVORY_URL/api/v1/auth/login" \
     -H "Content-Type: application/json" -d @login.json
   ```

3. The answer holds the session token and its end time:

   ```json
   {
     "token": "dps_…",
     "expiresAt": "2026-10-05T21:30:00.000Z",
     "account": { "id": "…", "name": "alice", "administrator": false, "enabled": true }
   }
   ```

4. Send the token as `Authorization: Bearer dps_…`.

Rules of a session:

- It lasts 12 hours and does not extend. After that, every call returns `401` with the reason `session_expired`. Sign in again.
- An account has at most 32 sessions. A new sign-in ends the oldest ones beyond that.
- `POST /api/v1/auth/logout` ends the session. Changing your password, or an administrator resetting it, ends all sessions and all personal tokens of the account. Disabling the account stops them.
- A session carries the full authority of the account, including the administrator flag. Only a session can create and revoke personal tokens and change the account's own password.
- Names are compared without regard to case. A wrong name, a wrong password and a disabled account give the same `401` with the reason `invalid_credentials`.
- A read gateway does not sign anyone in; use the writer.

### Self-registration {#self-registration}

`GET /api/v1/auth/options` is public and tells whether people may create their own accounts. Self-registration is off unless the administrator sets `ARKVORY_ALLOW_REGISTRATION=true`; then `POST /api/v1/auth/register` with the same body as sign-in creates a plain account (not an administrator, with no access to any repository) and returns a session with `201`. Otherwise it answers `403` with the reason `registration_disabled`. Self-registration stops at 900 accounts, so that administrators can still create accounts up to the limit of 1,000.

## Personal access tokens {#personal-tokens}

A personal access token lets a script act as you without your password. Only a signed-in session can create one.

```bash
curl -fsS -X POST "$ARKVORY_URL/api/v1/auth/tokens" \
  -H "Authorization: Bearer $SESSION" -H "Content-Type: application/json" \
  -d '{"name":"laptop-cli","scope":"read-write","expiresAt":"2026-12-31T00:00:00Z"}'
```

In the console, open [[ui:personalAccessTokens]] in the [[ui:connection]] card, enter a [[ui:tokenName]], choose [[ui:tokenScope]] and [[ui:tokenExpiry]], and select [[ui:generateToken]].

| Field       | Rule                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `name`      | 1 to 64 characters.                                                                                                 |
| `scope`     | `read` or `read-write`. The API uses `read-write` when you omit it; the console offers [[ui:tokenScopeRead]] first. |
| `expiresAt` | An RFC 3339 time in the future, at most 365 days away. The default is 90 days. There are no tokens without an end.  |

The `201` answer contains the token once, as `token`. Save it then: the server keeps only a hash, and the list shows a short prefix. Then:

- A token has the repository access of its account, and nothing more. It never has the administrator flag, so it cannot manage accounts, groups, updates or backups.
- A `read` token can only read. Any request that changes something, apart from `logout`, is refused with `403` and the reason `read_only_token`, before the operation runs.
- A token cannot create tokens or change a password; those need a session.
- An account has at most 50 active tokens. `GET /api/v1/auth/tokens` lists them with their prefix, scope, end and last use. `DELETE /api/v1/auth/tokens/{id}` revokes one at once ([[ui:revokeToken]] in the console). An administrator can list and revoke the tokens of any account.
- An expired token returns `401` with the reason `token_expired`.

## Service accounts and keys {#service-accounts}

A **service account** is an identity for a tool, such as a build agent. It has a **policy**: a list of **bindings**, each naming one repository and the exact **actions** allowed there (see [Repository actions](#repository-actions)). A policy has at most 64 bindings. The account owns the uploads and jobs that its keys start, so rotating a key loses nothing. A server has at most 1,000 service accounts.

Only the [recovery key](#recovery-key) creates a service account. It, or an operator with a [delegation](#delegation), changes the accounts that exist. In the console, use [[ui:services]]: [[ui:serviceCreate]], then set [[ui:servicePolicy]]. [[ui:bindingRead]] fills the seven read actions, and [[ui:bindingPublish]] adds the actions needed to upload and register packages.

```bash
curl -fsS -X POST "$ARKVORY_URL/api/v1/service-accounts" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" \
  -d '{"name":"ci-release","bindings":[{"resource":{"kind":"repository","id":"releases"},
       "actions":["repository.read","artifact.read","upload.create","upload.read","upload.write",
                  "upload.complete","upload.cancel","job.read","package.publish"]}]}'
```

Names use 3 to 64 letters, digits, `_`, `.` and `-`. To change the policy, send `PUT /api/v1/service-accounts/{id}/policy` with the `expectedRevision` you read ([compare-and-swap](./index#revisions)). To switch the account off, send `PATCH /api/v1/service-accounts/{id}` with `{"expectedRevision": n, "enabled": false}`; all its keys stop working until you switch it on again.

### Service keys {#service-keys}

A key is the secret that a service account signs in with. It looks like `arkvory_<uuid>.<secret>`. A key moves through three states: `pending`, `active` and `revoked`.

1. **Issue.** Send `POST /api/v1/service-accounts/{id}/keys` with an `Idempotency-Key`, a `name`, the `bindings` the key may use and, if you want, an `expiresAt` (UTC, within 365 days; the default is 90). The key's bindings must lie inside the account's policy. The answer, `201`, contains the key's metadata and, only this once, its `secret`. A repeat with the same idempotency key returns `200` with the metadata and no secret.
2. **Activate.** The new key is `pending` and unusable except for one call, `POST /api/v1/auth/activate-key`, with the new secret as the credential. The answer is `204`. Do this within 15 minutes; after that the key expires unused. In the console, copy the secret, select [[ui:keySaved]] and then [[ui:keyActivate]]. Activating again is harmless.
3. **Use.** The key works until its `expiresAt` or until it is revoked or its account is disabled.

```bash
curl -fsS -X POST "$ARKVORY_URL/api/v1/service-accounts/$ACCOUNT/keys" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Idempotency-Key: ci-release-2026-10" \
  -H "Content-Type: application/json" \
  -d '{"name":"ci-release-2026-10","bindings":[{"resource":{"kind":"repository","id":"releases"},
       "actions":["upload.create","upload.read","upload.write","upload.complete","job.read"]}]}'
curl -fsS -X POST "$ARKVORY_URL/api/v1/auth/activate-key" -H "Authorization: Bearer $NEW_SECRET"
```

Limits: an account has at most 3 active keys and 2 pending keys at a time (`507` with the reason `key_limit`).

**Rotate.** `POST /api/v1/api-keys/{id}/rotate` issues a new pending key for the same account, with the same body as an issue and an `Idempotency-Key`. Its bindings must be inside those of the old key. When you activate the new key, the old key's end is cut to at most 24 hours from then. Move your tools to the new key, then revoke the old one. In the console: [[ui:keyRotate]].

**Revoke.** `POST /api/v1/api-keys/{id}/revoke` ends a key for good; repeating it is harmless. In the console: [[ui:keyRevoke]]. Revoking a key does not stop a transfer that already started. Lost the secret of a pending key? Revoke it and issue another with a new idempotency key.

### Delegation {#delegation}

The recovery key can hand part of the administration to an **operator**: a service account whose key may manage other service accounts. A **delegation** names the operator's key, the target account, the **administration actions** the operator may use on it, and a **ceiling**, the repository actions it may give out. The seven administration actions are:

| Action                   | Allows                                      |
| ------------------------ | ------------------------------------------- |
| `service-account.read`   | See the account in lists and read its card. |
| `service-account.manage` | Switch the account on or off.               |
| `policy.read`            | Read the account's policy.                  |
| `policy.manage`          | Replace the account's policy.               |
| `credential.read`        | List the account's keys and read a key.     |
| `credential.manage`      | Issue, rotate and revoke keys.              |
| `service-audit.read`     | Read the account's key history.             |

Rules: the operator's key must be one that the recovery key issued; an operator never manages its own account; it cannot give out anything outside its ceiling or beyond the account's policy; a key it issues cannot outlive its own key; and ending a delegation does not revoke keys that were already activated. Only the recovery key creates accounts and sets delegations (`PUT` and `DELETE /api/v1/api-keys/{id}/delegations/{accountId}`). One operator key can have up to 64 delegations. In the console, use [[ui:delegations]]. An operator who needs something outside its delegation gets `404` for an account that it does not manage, or `403`.

## The recovery key {#recovery-key}

The installer creates the **recovery key** once and writes it to `config/bootstrap-token.txt` in the [installation root](../install/index#installation-directory). Only the Administrators group on Windows, or root on Linux, can read the file. Its hash is in the server's keys file (`ARKVORY_KEYS_FILE`), under the name `bootstrap-owner`. The installer also creates `config/health-token.txt`, a second key without any repository rights, that can call the authenticated health checks and the metrics.

What the recovery key may do:

- Create the first account and every account after it, reset passwords, disable accounts, and manage groups and their repository grants.
- Read the security audit and revoke any account's personal tokens.
- Create service accounts, set their policies, issue and revoke their keys, and set delegations.
- Read and request backups and updates, and download the server log for feedback.
- Read and write the repository `releases` like a member of a group with [[ui:write]] access.

What it cannot do: it has no access to repositories other than `releases`, cannot delete artifacts or manage storage policies (those actions exist only for service keys), and is not a session, so it cannot create personal tokens or change a password. Keep it on the server. Installation tools read it there. Do not put it in CI, and do not paste it into tools; create a service key instead. To replace it, see [Configuration](../install/configuration).

The console's [[ui:welcomeOwner]] form (under [[ui:navStart]]) uses the recovery key to create the first owner. It works only while no account exists. To reset the password of an existing account without a session, find its ID with `GET /api/v1/users`, put the new password (12 to 128 characters) in a private file and send it with the recovery key. The reset ends all sessions and tokens of that account.

```bash
echo '{"password": "a new password of 12 to 128 characters"}' > reset.json
curl -fsS -X PATCH "$ARKVORY_URL/api/v1/users/$USER_ID" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" -d @reset.json
rm reset.json
```

Other file keys can be added by an administrator in the keys file. Each entry has an `id`, the `sha256` of the secret, the `repositories` and `permissions` (`read` and `write`) it gets, and optionally the flags `administrator` and `serviceAdministrator`. The file is read at startup, so restart the API and the worker after a change.

## Download links {#download-links}

`POST /api/v1/repositories/{repository}/artifacts/{id}/links` returns a `token` (`dtl_…`) and a `url` for one artifact. Ask for a lifetime with `ttlSeconds`: 60 to 86,400, and 3,600 by default. The caller needs `content.read`.

The link works only as `GET` or `HEAD` of `/api/v1/repositories/{repository}/artifacts/{id}/content?token=…`, for that artifact in that repository, and only for reading. It is a secret. The server cannot revoke it before it expires, and it does not appear in the logs. Create links of the shortest life you need.

## What an access rule means {#access-rules}

Every operation in the reference has an **Access** line. These are the kinds of rules:

| Rule in the reference                              | What it asks for                                                                                                                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Anyone, without a key                              | Nothing. Liveness, readiness status, sign-in options, sign-in and registration.                                                                                                                                                            |
| Any valid key or session                           | Any credential that is valid. Examples: capabilities, the operation list, your own identity, readiness details and metrics.                                                                                                                |
| A signed-in account session (not a key)            | A session of a person. Personal tokens and keys are refused (`session_required`). Examples: creating and revoking your own tokens, changing your password.                                                                                 |
| Administrator                                      | An administrator account's session, or a file key with the administrator flag, such as the recovery key. Personal tokens and service keys are refused (`administrator_required`). Examples: accounts, groups, the security audit, updates. |
| Bootstrap key (installation recovery key)          | A file key with the service-administration flag. The recovery key has it. Examples: creating service accounts and setting delegations.                                                                                                     |
| Bootstrap key, or the key itself                   | The recovery key, or the key whose delegations are listed.                                                                                                                                                                                 |
| The issued key, before or after activation         | The only operation that accepts a pending key: activation.                                                                                                                                                                                 |
| Repositories the caller may see                    | The action `repository.read` on that repository, or any access to it for a session or file key. A repository the caller cannot see is left out of lists and answers `404`.                                                                 |
| System permission `backup.read` or `backup.manage` | Held by administrator sessions and by file keys with an administrator flag. Service keys and personal tokens never have them. `backup.manage` includes `backup.read`.                                                                      |
| Service administration permission                  | One of the seven [administration actions](#delegation) on the target account, from a delegation, or the recovery key.                                                                                                                      |
| Repository permission                              | **All** of the listed repository actions on the repository named in the path. Several access rules add conditions: the upload, the job or the reference must belong to the caller.                                                         |

The second part of a repository line, such as "file keys: `read`, `write`", is the coarse grant that people and file keys need instead of the exact actions. See [Group grants](#group-grants).

Beyond the access rule, the server also refuses a change in a repository that is a mirror (`409`, `mirror_read_only`), and a read gateway refuses every change (`405`, `read_only`).

## Repository permissions {#repository-permissions}

### Group grants {#group-grants}

People get repository access through **groups**. An administrator grants a group `read` or `write` (shown as "Read and write") on a repository, and adds accounts to the group. In the console: [[ui:administration]], then [[ui:manageGrants]] and [[ui:saveGrant]]. The API calls are `PUT /api/v1/access-groups/{id}/grants/{repository}` with `{"access": "read"}` or `{"access": "write"}`, and `PUT /api/v1/access-groups/{id}/members/{userId}`. Rights are recomputed on every request, so a change applies at once.

A `read` grant gives these actions: `repository.read`, `artifact.read`, `artifact.list`, `content.read`, `package.read`, `asset.read` and `annotation.read`. A `write` grant adds `upload.create`, `upload.read`, `upload.write`, `upload.complete`, `upload.cancel`, `job.read`, `package.publish`, `asset.write`, `asset.restore`, `annotation.write`, `reference.write`, `artifact.promote` and `audit.read`. The actions `artifact.delete`, `storage.read`, `storage.manage` and `diagnostics.read` cannot come from a group: only a service key can have them.

### Repository actions {#repository-actions}

A service key carries exact actions, repository by repository. There are 24:

| Action             | Allows                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `repository.read`  | See the repository and its mirror status.                                                                      |
| `artifact.read`    | Read an artifact's details, stages and promotions. Also needed with every change to an artifact.               |
| `artifact.list`    | List and search artifacts, list staged artifacts, read the promotion journal and the change feed.              |
| `artifact.promote` | Set and remove stages, and promote (copy or move) to another repository.                                       |
| `artifact.delete`  | Delete artifacts, preview and apply retention, and remove container images and force-unlock Git LFS files.     |
| `content.read`     | Download bytes by ID, by package or by path, and create download links.                                        |
| `upload.create`    | Create upload sessions. Push to the registries and Git LFS uses it.                                            |
| `upload.read`      | Read your own upload sessions and their parts.                                                                 |
| `upload.write`     | Send the parts or the whole content of your own upload.                                                        |
| `upload.complete`  | Complete your own upload, or queue its completion.                                                             |
| `upload.cancel`    | Cancel your own pending upload.                                                                                |
| `job.read`         | Read your own completion jobs.                                                                                 |
| `package.read`     | List packages, resolve versions and download packages.                                                         |
| `package.publish`  | Register a UPack archive as a package.                                                                         |
| `asset.read`       | List files by path and read their pointers, history and revisions. Downloading the bytes needs `content.read`. |
| `asset.write`      | Point a path at an artifact, or store a raw file.                                                              |
| `asset.restore`    | Restore an earlier revision of a path.                                                                         |
| `annotation.read`  | Read labels, metadata, collections and attachments.                                                            |
| `annotation.write` | Replace labels, metadata, collections and attachments.                                                         |
| `reference.write`  | Add and remove references that protect an artifact.                                                            |
| `audit.read`       | Read the repository's catalog audit.                                                                           |
| `storage.read`     | Read quota, usage, the storage policy and the cleanup settings.                                                |
| `storage.manage`   | Change the storage policy and the cleanup settings, and run cleanup.                                           |
| `diagnostics.read` | Read storage events.                                                                                           |

The exact set that an operation needs is on its line in the reference, for example `upload.write` and `upload.complete` for `putUploadContent`. A change to a repository needs the matching `read` action too, such as `artifact.read` with `annotation.write`.

Owner conditions apply to uploads and jobs: you act only on the upload sessions and completion jobs that your account created. All keys of one service account, and all sessions and tokens of one person, count as the same owner. Several services in one repository are therefore separated by accounts and repositories, not by prefixes of a path.

### Administration and system permissions {#administration-permissions}

Two other kinds of permission are not repository actions. The seven administration actions are listed under [Delegation](#delegation). The two system permissions, `backup.read` and `backup.manage`, belong to administrators and the recovery key only.

## Sign-in limits {#sign-in-limits}

The server slows down password guessing before it checks any password. The counters live in the memory of each API process and start again after a restart. They apply per client address, with an IPv6 address counted by its /64 prefix. Behind a reverse proxy, set `ARKVORY_TRUSTED_PROXIES`, or every client appears as the proxy.

| Limit                        | Value                                                                                                                                                                                                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in attempts per address | A burst of 10, then one more every 15 seconds. A successful sign-in does not use an attempt.                                                                                                                                                                                      |
| Failed passwords per account | Each wrong password adds 1 to a debt that falls by 1 every 6 seconds. Above 20, the account refuses tries for 1 second, doubling with each further failure up to 2 minutes; during that time even the right password gets `429`. A successful sign-in or a reset clears the debt. |
| Registrations per address    | 3, then one more every 20 minutes.                                                                                                                                                                                                                                                |
| Registrations per server     | 20, then one more every 3 minutes.                                                                                                                                                                                                                                                |
| Sign-in requests in progress | 16 per API process, and the body has 10 seconds to arrive. More returns `503` with the code `busy`.                                                                                                                                                                               |

A refused attempt returns `429` with the code `rate_limited`, the reason `login_attempts`, `registration_attempts` or `password_attempts`, and `Retry-After` in seconds. Wait that long; do not retry in a loop. Changing or resetting a password has its own gate and the reason `password_attempts`. All sign-ins, registrations, password changes and token changes are written to the security audit (`GET /api/v1/security/audit`, administrators only), which keeps 365 days.

## Related pages {#related}

- [HTTP API overview](./index)
- [Errors](./errors)
- [Accounts and access](../use/accounts)
- [Security](../operate/security)
- [Clients and protocols](../protocols/index)
- Reference: [Accounts and sign-in](./reference/accounts), [Service accounts and keys](./reference/services)
