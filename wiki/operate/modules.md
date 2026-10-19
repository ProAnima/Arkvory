---
title: Modules
description: Install signed module packages on a host, enable and check them, remove them, and keep the keys of plugin authors you trust.
---

# Modules

A module package adds a feature to Arkvory. Arkvory installs only packages whose signature it can verify. The commands of this page run on the host of the installation, as root on Linux or as an administrator on Windows. The console and the HTTP API cannot install modules or trust keys, so a stolen administrator account of the console cannot run code on the server.

The services check the installed modules again and load them each time they start. A module runs only after you enable it.

## Install a package {#install}

1. Copy the package file `arkvory-module-<id>-<version>.tgz` to the host.
2. Check it and read its terms:

   ```bash
   sudo arkvory module install /root/arkvory-module-sample-1.0.0.tgz --root /opt/proanima-arkvory
   ```

   The command shows the module, its roles, the data it keeps, the signing key and the SHA-256 of the package, then the terms of the module. Nothing changes yet.

3. Install it:

   ```bash
   sudo arkvory module install /root/arkvory-module-sample-1.0.0.tgz --root /opt/proanima-arkvory --yes
   ```

Arkvory refuses a package when:

| Reason                                                                                   | Code in the message                                            |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| The signature is not from a ProAnimaStudio module key, or the manifest changed           | `unknown_key`, `wrong_key_class`, `signature_invalid`          |
| A file is missing, changed or not listed in the manifest                                 | `file_missing`, `file_mismatch`, `file_unlisted`               |
| The archive holds links, devices, paths outside the package or names that differ in case | `link_entry`, `special_entry`, `unsafe_path`, `case_collision` |
| The archive holds a native addon (`.node`)                                               | `native_addon`                                                 |
| The module needs another version of Arkvory                                              | `module_incompatible`                                          |
| ProAnimaStudio revoked this version                                                      | `module_revoked`, with the replacement version                 |
| No current revocation list (see below)                                                   | `stale_revocations`                                            |

Limits: 1 GiB per package, 256 MiB per file, 4096 files. A larger package is refused before its data is read.

A version that is already installed with the same bytes is left as it is. The same version with other bytes is refused.

## Enable and load a module {#load}

An installed module stays disabled until you enable it. The services load modules only when they start.

1. Add the module to the modules file (`ARKVORY_MODULES_FILE`, see [Environment variables](../reference/environment#core)). Settings of the module go into `config`:

   ```json
   { "format": 1, "modules": { "sample": { "enabled": true } } }
   ```

2. If the module keeps files, approve the size of its data directory with `resources`, for example `"resources": { "dataMiB": 512, "dataFiles": 10000 }` beside `enabled`. It replaces the size the package asks for. See [Data directory of a module](#data).
3. Restart the services, as in [Apply a change](../install/configuration#apply-change).
4. Check the module as a global administrator: `GET /api/v1/system/modules` lists it with `running: true` and `health.status` `ok` on the API and on each read gateway.

The API and the read gateways run modules. The worker checks the same modules and runs none of them. This release refuses modules that run in the worker or the backup agent (`role_unsupported`) and modules that declare route prefixes without serving routes through Arkvory (`routes_unsupported`). Docker Compose installations do not load modules yet.

Before a service imports any code of a module, it checks the package again:

1. Only root (on Windows: SYSTEM and Administrators) or the owner of the installation directory may change the installation directory, `modules/`, the module set, the revocation list and its directory. The installation sets this up. A file that another account may change, or a link inside a package, is refused (`access_unsafe`, `access_link`).
2. The signature, every file and the version of Arkvory, as `module install` checks them.
3. The revocation list. A revoked version is never loaded. An expired list or no list does not stop a module.

A module that fails a check is not loaded; the other modules and Arkvory go on. `GET /api/v1/system/modules` shows it with `running: false`:

| `health.status` | Meaning                                                    | Codes                                                                                                               |
| --------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `failed`        | The package was refused, or its code did not load or start | `file_mismatch`, `unknown_key`, `module_incompatible`, `access_unsafe`, `config_invalid`, `start_failed` and others |
| `revoked`       | ProAnimaStudio revoked this version                        | the reason from the revocation list                                                                                 |
| `unavailable`   | The package directory is missing from the host             | `module_unavailable`                                                                                                |

A module that failed takes Arkvory out of readiness (`/health/ready` answers 503 with `module_failed`) only when another enabled module needs it. A module that stores the bytes of published files (data `layout`) never does: Arkvory keeps serving its data and writes new uploads to its own storage instead of the module's. The log records `module.refused` and `module.failed` with the code in `errorCode`.

Install the package again to repair a changed or missing package. Every service of the installation must see the same modules, enabled or not: a read gateway or worker with other modules is not ready (`module_plan_mismatch`). Install the same packages on the host of each read gateway.

### Data directory of a module {#data}

A module that keeps indexes, caches or state of its own gets a directory on the data volume: `module-data/<id>/` in the storage directory of `default`. Its `data` part is meant for backups, its `cache` part is not. Arkvory counts every write against the approved size, in MiB and in files, for both parts together. A write beyond it is refused (`module_quota_exceeded`) and the module keeps running. Without an approved size, the module can only read. The [reserve of the volume](./storage#disk) applies too. On a read gateway the module reads the same files and cannot change them.

Removing a module keeps its directory. Delete `module-data/<id>/` yourself when you no longer need the data. Backups do not include module directories yet.

## Routes of modules {#routes}

A module may add HTTP routes under its own prefix `/api/ext/<id>/v<major>/`, for example `/api/ext/sample/v1/`. Arkvory checks every request before any code of the module runs:

| Check        | As for `/api/v1`                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential   | The same keys, sessions and tokens; a route is open to every signed-in caller or only to the global administrator                                                   |
| Permission   | The permission the route names on the repository in its path, such as `content.read` or `upload.create`: a service key needs it, an account its read or write grant |
| Request body | The size limit of the route, the upload limits, deadlines and bandwidth of the server                                                                               |
| Files        | Sent by Arkvory itself: ETag, Range, `If-Range`, 304, the download queue and the download bandwidth                                                                 |

Errors have the error format of the API. A module never sees the credential or other headers. A read gateway serves the reading routes of a module and answers `read_only` to the others.

Each module describes its routes in an OpenAPI document, and Arkvory compares both when the module starts. A module whose routes break the rules does not start and serves nothing; Arkvory goes on. `GET /api/v1/system/modules` shows it with `running: false` and `health.status` `failed`:

| Code                     | Meaning                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `routes_invalid`         | A route breaks the rules, for example a path outside the module's prefix or a change open to every signed-in caller |
| `openapi_invalid`        | The OpenAPI document is missing or invalid                                                                          |
| `openapi_route_mismatch` | A route has no operation in the document, or an operation has no route                                              |
| `transfer_invalid`       | The module offers a transfer protocol it may not offer                                                              |

The documents of the routes:

| Address                                                                                     | Who may read it          | Content                                                                              |
| ------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------ |
| `GET /api/ext/openapi.json`                                                                 | Every signed-in caller   | The routes of all modules this service runs, with the operations the caller may call |
| [`GET /api/v1/system/modules/{id}/openapi`](../api/reference/system#getSystemModuleOpenApi) | The global administrator | The routes of one module                                                             |

`/api/v1/openapi.json` never lists module routes. A module of the kind `transfer` may offer another way to transfer files: `GET /api/v1/capabilities` lists it in `transfer`. A client uses it only with a matching extension; otherwise it transfers files as usual.

## Update, pin and downgrade {#versions}

Install the file of the new version with `--yes`. The previous package stays on the host until the next module change.

| Task                       | Command                                                         |
| -------------------------- | --------------------------------------------------------------- |
| Keep the installed version | `sudo arkvory module pin sample 1.0.0 --root …`                 |
| Allow other versions again | `sudo arkvory module pin sample --unpin --root …`               |
| Install an older version   | `sudo arkvory module install <file> --downgrade --yes --root …` |

A pinned module refuses every other version until you unpin it. A version older than the installed one, or than a removed one whose package is still on the host, needs `--downgrade`.

## Check installed modules {#list}

```bash
sudo arkvory module list --root /opt/proanima-arkvory
```

The command verifies every installed package again, as the services do before they load it: the signature, every file and the archive. Each module shows one state:

| State                | Meaning                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `ok`                 | The package is intact                                                                                       |
| `refused: <code>`    | A file was changed, added or replaced by a link (`file_mismatch`, `file_unlisted`, `link_entry` and others) |
| `revoked (<reason>)` | ProAnimaStudio revoked this version. `read path only` means that its data stays readable                    |

A refused package is never used. Install the package file again to repair it.

## Remove a module {#remove}

```bash
sudo arkvory module remove sample --root /opt/proanima-arkvory
```

The module leaves the installation, and its package stays on the host until the next module change. A module that stores the bytes of published files (data `layout`) cannot be removed: Arkvory refuses with `module_owns_data`, so its data never becomes unreadable.

## Revocation list {#revocations}

ProAnimaStudio publishes a signed list of revoked module versions. Each list has a number, and Arkvory never accepts a list with a lower number than the one it has. A module package can carry a newer list: Arkvory keeps it when you install the package. On a host without access to the hub, store a list file yourself:

```bash
sudo arkvory module revocations /root/module-revocations.json --root /opt/proanima-arkvory
```

Each list is signed with an expiry: 90 days by default, never more than 180. `module install` and `module pin <id> <version>` need a current list; with an expired list or none they refuse with `stale_revocations`. A package that carries a current list counts. To go on anyway, add `--allow-stale-revocations`: Arkvory prints a warning and records the decision in `modules/audit.jsonl`. An expired list never stops installed modules: they keep running and their data stays readable; only a revocation entry stops a version. A list with a higher number always replaces the stored one, even when it has expired.

When ProAnimaStudio replaces its module signing key, one release carries both keys and the next list is signed with the new key; only a later release drops the old key. An update to that release is refused while the host still stores a list signed with the old key: store a current list first. `sudo arkvory module check-revocations --root …` shows whether this release trusts the key of the stored list.

## Trust a plugin author {#trust}

Plugins of your own team or of another author are signed with the author's key. Add the key to the trust list of the host before you install such plugins. The trust list belongs to the host: the services can read it but not change it.

1. Get the public key file (`.pub`, minisign format) from the author, and its fingerprint through another channel.
2. Show the key and compare the fingerprint:

   ```bash
   sudo arkvory module trust add /root/acme.pub --label "Acme platform team" --plugins "op-acme-*" --root /opt/proanima-arkvory
   ```

3. Add it with `--yes`.

| Option               | Meaning                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `--label`            | Who holds the key; required                                                                          |
| `--plugins`          | Plugin ids the key may sign, separated by commas: an exact id or a prefix with `*`. Default `op-*`   |
| `--expires`          | UTC time such as `2027-01-31T00:00:00Z`. After it, the key accepts no new installation               |
| `--allow-in-process` | Allows the key's plugins to run inside the Arkvory process. Such code gets all rights of the service |

Plugin ids always start with `op-`. A plugin key never signs ProAnimaStudio modules, and ProAnimaStudio keys never sign `op-` plugins. A key that the host already knows under another id or as a key of another kind is refused (`duplicate_key`). Signatures must be prehashed, the default of current minisign versions; legacy signatures are refused with `signature_algorithm`.

`sudo arkvory module trust list --root …` shows the trusted keys. `sudo arkvory module trust remove <key id> --root …` removes one.

This release keeps the trust list; plugins are installed by a later release.

## After an interruption {#recover}

Every change of the module set is recorded in the update journal. If a command stops halfway, the next deployment command refuses with `Interrupted deployment`. Run `sudo arkvory recover --root …`: it restores the previous module set. Until then, every module command that changes something refuses, `module trust` and `module revocations` included.

## Module request lifetime {#request-scope}

A module route uses the caller’s permissions until its response ends, including streaming. Cancellation or completion revokes these permissions and closes read resources. The `upload-read` service reads accepted parts of unfinished uploads after checking ownership, `upload.read`, range and cancellation. Modules can withdraw transfer offers while running. Subsequent capability queries omit them; routes and active transfers remain. Clients may cache old offers, so routes must check each operation.
