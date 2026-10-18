---
title: Licences
description: Activate the licence of a paid module online or offline, check its state, and see what Arkvory sends and keeps.
---

# Licences

The free core of Arkvory needs no licence. Every function of this documentation works without one, and no licence state turns any of them off or makes data unreadable. A licence enables a paid module of ProAnimaStudio (see [Modules](modules)). Until you activate a licence, Arkvory sends nothing about licences anywhere.

The commands of this page run on the host of the installation, as root on Linux or as an administrator on Windows. Docker Compose installations do not load modules, so they refuse these commands.

## Activate online {#activate}

1. Save the licence key from the ProAnimaStudio site in a file that only you can read, for example `/root/arkvory.key`.
2. Activate:

   ```bash
   sudo arkvory license activate --key-file /root/arkvory.key --root /opt/proanima-arkvory
   ```

3. Delete the key file. Arkvory does not keep the key and does not need it again.

Arkvory sends the request to the hub of the installation (the address in `config/hub.json`, the same as for updates) over HTTPS with certificate verification. It accepts the answer only when ProAnimaStudio's licence key signed it, for this installation and for this request. A key with a typo is refused before anything is sent. Activating the same installation with the same key again takes no new place of the licence.

### What is sent {#sent}

| Request    | Contents                                                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Activation | The licence key, the installation id, a random value, the Arkvory version, the id and version of installed paid modules, the time |
| Refresh    | The activation id and its secret, a random value, the sequence number, the versions                                               |

The name of the licensee, names of people, addresses, details of the machine, amounts of data, names of repositories, contents, metadata and usage statistics are never sent. Turning statistics off neither adds nor removes anything here. With the hub off (`--hub-off`), use [offline activation](#offline).

### What is kept {#kept}

- The token: the signed document of the hub, in the database and in backups.
- The activation secret: a file in `config/licenses/`, readable only by the account of the services. It is never in the database, the logs or a backup.
- The licence key: nowhere.

## Check the state {#status}

```bash
sudo arkvory license status --root /opt/proanima-arkvory
```

Add `--json` for scripts. A global administrator sees the same in `GET /api/v1/system/license` ([reference](../api/reference/system#getSystemLicense)). Arkvory verifies each stored document again every time; a document that ProAnimaStudio did not sign is `invalid` and enables nothing.

| State           | Meaning                                                                                   | Paid writes                     |
| --------------- | ----------------------------------------------------------------------------------------- | ------------------------------- |
| `valid`         | The licence holds; `refreshFailing` when the hub has not answered for a while             | in the module's mode            |
| `offline-grace` | No refresh for more than a day; the token holds until `offlineGraceUntil`                 | in the module's mode            |
| `grace`         | The licence term ended; renewal grace until `graceUntil`                                  | in the module's mode            |
| `mismatch`      | The token belongs to another installation (a restore elsewhere); grace until `graceUntil` | in the module's mode until then |
| `expired`       | `trial_expired`, `licence_expired` or `activation_stale` (the token ended)                | in the core's form              |
| `revoked`       | A signed revocation; the reason is shown                                                  | in the core's form              |
| `invalid`       | A stored document does not verify                                                         | in the core's form              |

In every state your data stays readable, backups and restores work, and publishing never fails because of a licence: without a licence, a paid module writes new data in the form of the free core. Writing in the module's mode resumes by itself after a successful refresh.

## Refresh and the offline window {#refresh}

The worker refreshes each activation about once a day and when it starts. Each refresh brings a new token and a new secret; the previous secret stops working.

When the hub cannot be reached, the worker tries again after 15 minutes, then waits longer each time, up to 6 hours. The licence stays `valid`; after a day without a refresh it is `offline-grace`; when the token ends (the offline window: 30 days by default, 7 for a trial) it is `expired` with `activation_stale`. A refusal of the hub, such as `licence_expired` or `activation_suspended`, is not tried again: settle it, then run:

```bash
sudo arkvory license refresh --root /opt/proanima-arkvory
```

Setting the clock back extends nothing: Arkvory judges by the latest time it has seen. A database clock more than a day behind that time shows `clockRollback`.

### Copies and restores {#copies}

A copy of the installation, such as a cloned virtual machine, holds the same secret. When both copies refresh, the hub suspends the activation (`activation_secret_reused`). Activate again with the key on the installation you keep.

A backup restored on another installation keeps its token, which belongs to the old installation: the state is `mismatch` with grace. Activate the new installation with the key, then deactivate the old one.

An activation that was not refreshed for its offline window and 30 more days lapses, and its place is freed. The next refresh takes the place back while one is free; otherwise it is refused with `activation_lapsed`. Deactivate another installation, then refresh.

## Deactivate {#deactivate}

```bash
sudo arkvory license deactivate lic_0123456789ABCDEFGHJKMNPQRS --root /opt/proanima-arkvory
```

Name the licence or one activation. The hub frees the place, and Arkvory deletes the secret.

## Offline activation {#offline}

For hosts without access to the hub:

1. Write a request file:

   ```bash
   sudo arkvory license request --key-file /root/arkvory.key --out /root/request.json --root /opt/proanima-arkvory
   ```

   The file holds the SHA-256 of the key, never the key. Arkvory goes to no network for it.

2. Upload the file in your ProAnimaStudio account and download the answer.
3. Install the answer:

   ```bash
   sudo arkvory license install /root/answer.json --root /opt/proanima-arkvory
   ```

The answer must belong to a request of this installation. An offline activation is not refreshed: it holds until its end, at most 365 days, and a new request renews it. A revocation reaches such a host only with a licence revocation list, which you install the same way.

## Errors {#errors}

| Code                                                | Meaning                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `licence_key_invalid`                               | The hub does not know the key                                                                          |
| `activation_limit_reached`                          | Every place of the licence is taken; deactivate another installation                                   |
| `answer_invalid`                                    | The answer is not signed by ProAnimaStudio, or is for another installation or request; nothing is kept |
| `installation_mismatch`, `nonce_unknown`            | The offline answer belongs to another installation or to no waiting request                            |
| `seq_replayed`                                      | An older document than the one kept; refused                                                           |
| `revocation_rollback`                               | A revocation list older than the one kept                                                              |
| `unreachable`, `timeout`, `tls_failed`, `hub_error` | The hub could not be reached; the worker tries again                                                   |
