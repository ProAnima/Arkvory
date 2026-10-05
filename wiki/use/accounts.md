---
title: Accounts and access
description: Create users and groups, give them access to repositories, and issue personal tokens and service keys for CI.
---

# Accounts and access

Arkvory knows four kinds of credentials. People sign in with a password. Their own tools use personal access tokens. CI systems and deployment agents use service keys. The installer creates one more key, the recovery key, for setup and emergencies. The server checks every request against the credential it came with.

## Who can do what {#overview}

| Credential            | Made by                                  | Lifetime                        | Administration                                       | Repository access                               |
| --------------------- | ---------------------------------------- | ------------------------------- | ---------------------------------------------------- | ----------------------------------------------- |
| Password session      | Signing in                               | 12 hours                        | Users and groups, if the account is an administrator | Read or write per repository, through groups    |
| Personal access token | You, from a password session             | 90 days by default, 365 at most | Never                                                | Your groups, optionally read only               |
| Service key           | The recovery key or a delegated operator | 90 days by default, 365 at most | Only what the owner delegated                        | The service account policy, narrowed by the key |
| Recovery key          | The installer                            | Until you replace it            | Users, groups, service accounts, backups             | Read and write on `releases`                    |

Three things are easy to miss:

- An administrator account manages users and groups. It does not give access to files. Files are reached only through group grants.
- A service key is created by the recovery key or by an operator key, not by a password session. An administrator who signed in with a password cannot create service accounts.
- A personal token or a service key can never create users, groups or other tokens.

## The owner and the recovery key {#owner}

The first account is the owner. It is an administrator. The Windows setup wizard creates it. On Linux and Docker you create it in the console with the recovery key, as [The web console](../guide/console#the-first-owner) describes.

The owner is a member of the group `arkvory-owners`, which has write access to the repository `releases`. For any other repository, give a group access yourself. See [Groups and repository access](#groups).

The recovery key is the file `config/bootstrap-token.txt` in the installation directory. Only an administrator of the server can read it. Do not copy it to CI or to client machines. Installation and update tools read it, so do not delete it. See [Security](../operate/security).

## Create users {#users}

Only administrators create users. A name has 3 to 64 letters, digits, `.`, `_` or `-`. A password has 12 to 128 characters. An installation holds at most 1000 accounts.

In the console:

1. Sign in as an administrator and open [[ui:administration]].
2. Expand [[ui:createUser]].
3. Enter [[ui:accountName]] and [[ui:password]]. Tick [[ui:administrator]] only for people who manage users.
4. Select [[ui:createUser]].

The table [[ui:accountsHeading]] lists the accounts. [[ui:disableUser]] blocks an account: its sessions end at once and its personal tokens stop working until you select [[ui:enableUser]]. To set a new password for someone, expand [[ui:resetPassword]]. This ends the account's sessions and revokes all its personal tokens.

With the API, an administrator session or the recovery key calls these operations: `createUser`, `updateUser` and `listUsers`.

```bash
curl -X POST "$ARKVORY/api/v1/users" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"anna","password":"a long password here","administrator":false}'
```

```typescript
await client.administration.users.create('anna', 'a long password here', false);
```

`arkvoryctl` has no commands for accounts. Use the console or the API.

Self-registration is off by default. The server administrator turns it on with `ARKVORY_ALLOW_REGISTRATION=true` (see [Environment variables](../reference/environment)). Then [[ui:signUp]] appears on the sign-in card. A new account has no access to any repository until an administrator adds it to a group. Self-registration stops at 900 accounts, so 100 places stay free for administrators.

## Groups and repository access {#groups}

People get access through groups. A group has members and, for each repository, one level of access:

| Level in the console | Meaning                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| [[ui:read]]          | See and download                                                              |
| [[ui:write]]         | Everything in read, and upload, publish, change metadata, promote and restore |

A repository has no separate create step. It exists as soon as a grant or a service policy names it. A name uses lowercase Latin letters, digits, `-` and `_`, starts with a letter or a digit and has at most 64 characters. See [Repositories](./repositories).

In the console, open [[ui:administration]]:

1. Expand [[ui:createGroup]], enter an [[ui:accessGroup]] name (2 to 64 letters, digits, `.`, `_` or `-`) and select [[ui:createGroup]].
2. Expand [[ui:manageMembers]], choose the group and the account, then select [[ui:addMember]]. [[ui:removeMember]] takes the account out of the group.
3. Expand [[ui:manageGrants]], choose the group, type the [[ui:repository]] name, choose the [[ui:access]] level and select [[ui:saveGrant]]. [[ui:removeGrant]] takes the access away.

The table below the forms shows the [[ui:members]] and [[ui:grants]] of every group. Removing a member or a grant takes effect at the next request of the account. The files stay where they are.

An installation holds at most 100 groups, 10 000 memberships and 10 000 grants in total.

With the API, the operations are `createAccessGroup`, `addGroupMember`, `removeGroupMember`, `setGroupGrant` and `removeGroupGrant`:

```bash
curl -X PUT "$ARKVORY/api/v1/access-groups/$GROUP_ID/grants/builds" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"access":"write"}'
```

```typescript
await client.administration.groups.setGrant(groupId, 'builds', 'write');
```

## Permissions {#permissions}

Behind the two levels read and write there are 24 repository actions. A service key names these actions one by one. `arkvoryctl doctor` and `GET /api/v1/auth/permissions` show the actions the current credential holds, per repository.

| Action             | Console label                      | It allows                                                                |
| ------------------ | ---------------------------------- | ------------------------------------------------------------------------ |
| `repository.read`  | [[ui:permission.repository.read]]  | List repositories and see your own rights. No file access.               |
| `artifact.list`    | [[ui:permission.artifact.list]]    | List and search artifacts, read the stage list and the promotion journal |
| `artifact.read`    | [[ui:permission.artifact.read]]    | Artifact details, stages and promotion history of one artifact           |
| `content.read`     | [[ui:permission.content.read]]     | Download bytes, create download links, resolve a package for download    |
| `upload.create`    | [[ui:permission.upload.create]]    | Start an upload                                                          |
| `upload.read`      | [[ui:permission.upload.read]]      | Read the state and the parts of your own upload                          |
| `upload.write`     | [[ui:permission.upload.write]]     | Send the bytes of your own upload                                        |
| `upload.complete`  | [[ui:permission.upload.complete]]  | Finish your own upload, start a completion job                           |
| `upload.cancel`    | [[ui:permission.upload.cancel]]    | Cancel your own upload                                                   |
| `job.read`         | [[ui:permission.job.read]]         | Read your own completion job                                             |
| `package.read`     | [[ui:permission.package.read]]     | List UPack packages and resolve a version                                |
| `package.publish`  | [[ui:permission.package.publish]]  | Register an uploaded archive as a package                                |
| `asset.read`       | [[ui:permission.asset.read]]       | Read file paths, their history and revisions                             |
| `asset.write`      | [[ui:permission.asset.write]]      | Make an artifact the current content of a path                           |
| `asset.restore`    | [[ui:permission.asset.restore]]    | Restore an earlier revision of a path                                    |
| `annotation.read`  | [[ui:permission.annotation.read]]  | Read labels, metadata, collections and attachments                       |
| `annotation.write` | [[ui:permission.annotation.write]] | Change labels, metadata, collections and attachments                     |
| `artifact.promote` | [[ui:permission.artifact.promote]] | Add and remove stages, promote into the repository                       |
| `reference.write`  | [[ui:permission.reference.write]]  | Add and remove your own external reference on an artifact                |
| `audit.read`       | [[ui:permission.audit.read]]       | Read the catalog audit of the repository                                 |
| `artifact.delete`  | [[ui:permission.artifact.delete]]  | Check and delete artifacts, preview and apply retention                  |
| `storage.read`     | [[ui:permission.storage.read]]     | Read the storage policy, usage and cleanup settings                      |
| `storage.manage`   | [[ui:permission.storage.manage]]   | Change the storage policy and cleanup settings, run them                 |
| `diagnostics.read` | [[ui:permission.diagnostics.read]] | Read storage events                                                      |

How the levels of a group map to actions:

- **Read** gives `repository.read`, `artifact.list`, `artifact.read`, `content.read`, `package.read`, `asset.read` and `annotation.read`.
- **Write** gives everything in read, and `upload.create`, `upload.read`, `upload.write`, `upload.complete`, `upload.cancel`, `job.read`, `package.publish`, `asset.write`, `asset.restore`, `annotation.write`, `artifact.promote`, `reference.write` and `audit.read`.
- **No group level gives** `artifact.delete`, `storage.read`, `storage.manage` and `diagnostics.read`. Deleting artifacts and managing storage are for service keys that name these actions. See [Storage and retention](../operate/storage).

A mirror is a read-only copy of another repository ([Mirrors](../operate/mirrors)). Every action that changes it is refused with `409 mirror_read_only`, whatever the grants say.

## Passwords and sessions {#passwords}

Sign in with [[ui:accountName]] and [[ui:password]] in the [[ui:connection]] card. A session lasts 12 hours. [[ui:disconnect]] ends it.

To change your own password, use [[ui:changeOwnPassword]] in the same card. Enter the [[ui:currentPassword]] and the [[ui:newPassword]]. All your sessions and personal tokens end, so you sign in again and create new tokens. An administrator can reset the password of another account without knowing the old one.

The server slows down guessing:

- One network address may try 10 sign-ins in a burst, then one more every 15 seconds.
- After many wrong passwords for one account, the account waits longer and longer, up to 2 minutes. Even the right password is refused during this wait. The answer is `429 rate_limited` with `Retry-After`.
- Behind a reverse proxy, the administrator lists the proxy in `ARKVORY_TRUSTED_PROXIES`. Otherwise all people share one address.

With the API, `login` exchanges a name and a password for a bearer session, and `changeOwnPassword` changes the password:

```bash
curl -X POST "$ARKVORY/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"name":"anna","password":"a long password here"}'
```

## Personal access tokens {#tokens}

A personal access token is a key for your own tools: a script on your computer, `arkvoryctl`, or the SDK. It acts as you, with the repositories of your groups.

Only a password session creates tokens. A token cannot create another token and has no administrator rights.

1. Sign in with your password.
2. In the [[ui:connection]] card, expand [[ui:personalAccessTokens]].
3. Enter a [[ui:tokenName]]. Choose [[ui:tokenExpiry]]: [[ui:tokenDays30]], [[ui:tokenDays90]] or [[ui:tokenDays365]].
4. Choose [[ui:tokenScope]]: [[ui:tokenScopeRead]] or [[ui:tokenScopeReadWrite]]. A read token refuses every change with `403 read_only_token`.
5. Select [[ui:generateToken]], then [[ui:copyToken]]. The token is shown once. It starts with `pat_`.

The table shows each token's [[ui:tokenPrefix]], [[ui:tokenCreated]], [[ui:tokenExpires]], [[ui:tokenLastUsed]] and [[ui:tokenStatus]]: [[ui:tokenActive]], [[ui:tokenExpired]] or [[ui:tokenRevokedState]]. To stop a token, select [[ui:revokeToken]] and confirm with [[ui:tokenRevokeConfirmSubmit]]. Clients that use it lose access at once.

An account may hold 50 active tokens. An administrator can list and revoke the tokens of any account with `listAccountTokens` and `revokeAccountToken`.

With the API, a token has a name and, optionally, an expiry (up to 365 days from now) and a scope:

```bash
curl -X POST "$ARKVORY/api/v1/auth/tokens" \
  -H "Authorization: Bearer $SESSION" \
  -H "Content-Type: application/json" \
  -d '{"name":"laptop","scope":"read-write","expiresAt":"2027-01-31T00:00:00Z"}'
```

```typescript
const created = await client.identity.createToken('laptop', { scope: 'read-write' });
console.log(created.token); // shown once
```

The API default scope is `read-write`. The console preselects [[ui:tokenScopeRead]].

Give the token to `arkvoryctl` in a private file. See [Command line](../protocols/cli#connect-to-a-server).

## Service accounts and keys for CI {#service-accounts}

A service account is an identity for a tool, not for a person. It has a **policy**: the repositories and actions it may use. A service account has keys. A key has its own list of repositories and actions too. The effective rights are the intersection of the two lists, action by action. An empty policy gives no access to files.

You manage service access with the recovery key, or with an operator key that the owner delegated rights to. In the console:

1. Select [[ui:disconnect]] if you are signed in. Then open [[ui:keySignIn]], paste the recovery key into [[ui:serviceKey]] and select [[ui:connect]].
2. Open [[ui:services]]. The section appears only for the recovery key and for operator keys.

### Create an account and its policy {#service-policy}

1. In [[ui:services]], expand [[ui:serviceCreate]].
2. Enter a [[ui:serviceName]] (3 to 64 letters, digits, `.`, `_` or `-`).
3. Under [[ui:servicePolicy]] select [[ui:bindingAdd]] and type the [[ui:repository]] name.
4. Fill in the permissions: [[ui:bindingRead]] and [[ui:bindingPublish]] set typical sets, [[ui:bindingNone]] clears them, and [[ui:bindingPermissions]] lists every action. Select [[ui:bindingRemove]] to drop a repository.
5. Select [[ui:serviceCreate]].

The two presets are:

| Preset                | Actions                                                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [[ui:bindingRead]]    | `repository.read`, `artifact.read`, `artifact.list`, `content.read`, `package.read`, `asset.read`, `annotation.read`                                                   |
| [[ui:bindingPublish]] | The read set, and `upload.create`, `upload.read`, `upload.write`, `upload.complete`, `upload.cancel`, `job.read`, `package.publish`, `asset.write`, `annotation.write` |

Neither preset includes promotion, restore or deletion. Add `artifact.promote` for a promotion job. A deployment agent that only downloads needs the read set for `arkvoryctl`. For a plain HTTP download of a package by name, `content.read` alone is enough.

A policy has at most 64 repositories and an installation at most 1000 service accounts. A saved policy has a version. If someone changes it meanwhile, the console shows a conflict and keeps your draft: select [[ui:serviceRefresh]] and apply your change again. [[ui:serviceDisable]] blocks every key of the account. Transfers that already run may finish.

### Issue, save and activate a key {#service-key-issue}

1. Open the account and its [[ui:serviceKeys]].
2. Expand [[ui:keyIssue]]. Enter a [[ui:keyName]]. Set the expiry in [[ui:keyExpiry]] or leave it empty for 90 days. The longest expiry is 365 days.
3. Narrow the permissions if the key needs less than the account. Select [[ui:keyIssue]].
4. The window [[ui:keySecret]] shows the secret once. Select [[ui:keyCopy]] and store it in your CI secret store. The secret starts with `arkvory_`.
5. Tick [[ui:keySaved]] and select [[ui:keyActivate]].

A key that is not activated is useless and expires after 15 minutes. It shows as [[ui:keyPending]] until you activate it. An account may hold 3 active keys and 2 pending keys at a time. The states are [[ui:keyPending]], [[ui:keyActive]], [[ui:keyRevoked]] and [[ui:keyExpired]]; [[ui:keyDetails]] lists the id and the permissions of a key.

If the answer is lost before you copy the secret, the server cannot show it again. Revoke the key and issue another.

With the API, the recovery key creates the account, then issues the key. The header `Idempotency-Key` (1 to 128 letters, digits, `.`, `_`, `:` or `-`) makes a repeated request safe, but a repeat returns no secret. The key activates itself when it calls `activateServiceKey`:

```bash
curl -X POST "$ARKVORY/api/v1/service-accounts" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" \
  -d '{"name":"ci-prod","bindings":[{"resource":{"kind":"repository","id":"releases"},"actions":["repository.read","artifact.read","artifact.list","content.read","package.read","upload.create","upload.read","upload.write","upload.complete","job.read","package.publish","asset.read","asset.write"]}]}'

curl -X POST "$ARKVORY/api/v1/service-accounts/$ACCOUNT_ID/keys" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: ci-prod-2026-10" \
  -d '{"name":"pipeline-2026","bindings":[{"resource":{"kind":"repository","id":"releases"},"actions":["content.read","package.read","artifact.read"]}]}'

curl -X POST "$ARKVORY/api/v1/auth/activate-key" -H "Authorization: Bearer $NEW_SECRET"
```

The same steps in the SDK:

```typescript
const account = await root.administration.services.create('ci-prod', bindings);
const issued = await root.administration.credentials.issue(account.id, requestId, {
  name: 'pipeline-2026',
  bindings,
});
if (!issued.secret) throw new Error('Lost response: revoke the key and issue another');
await saveToSecretStore(issued.secret);
await new ArkvoryClient(url, () => issued.secret ?? '').identity.activateKey();
```

Give the activated key to the job as `ARKVORY_TOKEN_FILE` or `ARKVORY_TOKEN`. See the [CI example](../protocols/cli#ci-example).

### Rotate and revoke {#service-key-rotate}

Rotate a key before it expires, without a gap:

1. Next to the key select [[ui:keyRotate]]. The form is filled with the old key's permissions. You may only keep or reduce them.
2. Issue the new key, save its secret and activate it.
3. Switch your jobs to the new secret.
4. Select [[ui:keyRevoke]] on the old key.

Activating the new key limits the old one to at most 24 more hours, so a forgotten old key does not live on. Revoking is permanent and asks for the key name. New requests with the key are refused at once. Transfers that already run may finish. With the API the operations are `rotateServiceKey` and `revokeServiceKey`.

[[ui:serviceAudit]] on the account shows who issued, activated, rotated and revoked keys, with the time. It keeps no secrets. The server keeps the latest 100 000 events of all accounts.

### Delegated administration {#delegation}

Day to day, do not use the recovery key. The owner can hand parts of service administration to an **operator key**, and keep the recovery key offline.

1. With the recovery key, create a service account for the operator with an empty policy, and issue and activate a key for it.
2. Open [[ui:serviceKeys]] of that account and select [[ui:delegations]] on the key.
3. Expand [[ui:delegationNew]]. Enter the [[ui:delegationTarget]], the account the operator will manage.
4. Tick the [[ui:delegationActions]] and set the [[ui:delegationCeiling]], the most the operator may grant in repositories.
5. Select [[ui:delegationSave]].

The seven actions are:

| Action                   | Console label                            | The operator may                  |
| ------------------------ | ---------------------------------------- | --------------------------------- |
| `service-account.read`   | [[ui:permission.service-account.read]]   | See the account                   |
| `service-account.manage` | [[ui:permission.service-account.manage]] | Enable and disable it             |
| `policy.read`            | [[ui:permission.policy.read]]            | Read its policy                   |
| `policy.manage`          | [[ui:permission.policy.manage]]          | Replace its policy                |
| `credential.read`        | [[ui:permission.credential.read]]        | List its keys                     |
| `credential.manage`      | [[ui:permission.credential.manage]]      | Issue, rotate and revoke its keys |
| `service-audit.read`     | [[ui:permission.service-audit.read]]     | Read its activity log             |

Rules:

- Everything the operator sets must stay inside the ceiling. A key it issues expires no later than its own key.
- An operator may issue keys for the target account, so treat the delegation as trust in everything the ceiling allows.
- An operator cannot manage its own account, and cannot delegate further. An account cannot be both a target and an operator.
- Removing a delegation with [[ui:delegationRemove]] does not revoke the keys the operator already activated. Revoke them yourself.
- The operator sees its own assignments in [[ui:delegationOwn]].

Only the recovery key sets delegations. The operations are `listServiceDelegations`, `setServiceDelegation` and `removeServiceDelegation`.

## Audit {#audit}

Administrators can read the security journal of the installation: sign-ins and failures, registrations, password changes and resets, user, group and grant changes, and token creation and revocation. Each entry has the time, the actor, the kind of credential, the client address, the target and the outcome (`success`, `failure` or `denied`). It holds no passwords or secrets. The server keeps entries for 365 days or 1 000 000 entries, whichever comes first.

The console has no screen for this journal. Read it with the API, with an administrator session or the recovery key. Pages hold 50 entries by default and 100 at most, newest first. Pass `next` as `after` for the next page.

```bash
curl -H "Authorization: Bearer $ADMIN_KEY" "$ARKVORY/api/v1/security/audit?limit=20"
```

```typescript
const page = await client.administration.security.audit({ limit: 20 });
```

The activity log of a service account is separate. See [Issue, save and activate a key](#service-key-issue).

## If the owner is locked out {#recovery}

When nobody can sign in as an administrator, use the recovery key:

1. Read the key on the server: `config/bootstrap-token.txt` in the installation directory. Only a server administrator can do this.
2. In the console, open [[ui:keySignIn]], paste the key into [[ui:serviceKey]] and select [[ui:connect]].
3. Open [[ui:administration]]. Expand [[ui:resetPassword]], choose the account, enter a [[ui:newPassword]] and select [[ui:resetPassword]]. If the account shows as disabled, select [[ui:enableUser]].
4. Sign in with the new password.

You can also create a new administrator with [[ui:createUser]] and tick [[ui:administrator]].

The form [[ui:welcomeOwner]] works only while the installation has no accounts. Later, use the recovery key to repair accounts, not to start over.

If the recovery key itself is lost, the server administrator replaces the key's SHA-256 in `config/keys.json` and restarts the API. See [Security](../operate/security).

## Related pages {#related-pages}

- [The web console](../guide/console)
- [Repositories](./repositories)
- [Command line (arkvoryctl)](../protocols/cli)
- [Authentication](../api/authentication) and the API reference: [Accounts and sign-in](../api/reference/accounts), [Service accounts and keys](../api/reference/services)
- [Security](../operate/security)
