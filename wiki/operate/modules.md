---
title: Modules
description: Install signed module packages on a host, check them, remove them, and keep the keys of plugin authors you trust.
---

# Modules

A module package adds a feature to Arkvory. Arkvory installs only packages whose signature it can verify. The commands of this page run on the host of the installation, as root on Linux or as an administrator on Windows. The console and the HTTP API cannot install modules or trust keys, so a stolen administrator account of the console cannot run code on the server.

This release stores and verifies module packages. The services do not run module code yet: a later release loads the installed modules.

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

Limits: 1 GiB per package, 256 MiB per file, 4096 files. A larger package is refused before its data is read.

A version that is already installed with the same bytes is left as it is. The same version with other bytes is refused.

## Update, pin and downgrade {#versions}

Install the file of the new version with `--yes`. The previous package stays on the host until the next module change.

| Task                       | Command                                                         |
| -------------------------- | --------------------------------------------------------------- |
| Keep the installed version | `sudo arkvory module pin sample 1.0.0 --root …`                 |
| Allow other versions again | `sudo arkvory module pin sample --unpin --root …`               |
| Install an older version   | `sudo arkvory module install <file> --downgrade --yes --root …` |

A pinned module refuses every other version until you unpin it.

## Check installed modules {#list}

```bash
sudo arkvory module list --root /opt/proanima-arkvory
```

The command verifies every installed package again, as the services will before they load it: the signature, every file and the archive. Each module shows one state:

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

Plugin ids always start with `op-`. A plugin key never signs ProAnimaStudio modules, and ProAnimaStudio keys never sign `op-` plugins.

`sudo arkvory module trust list --root …` shows the trusted keys. `sudo arkvory module trust remove <key id> --root …` removes one.

This release keeps the trust list; plugins are installed by a later release.

## After an interruption {#recover}

Every change of the module set is recorded in the update journal. If a command stops halfway, the next deployment command refuses with `Interrupted deployment`. Run `sudo arkvory recover --root …`: it restores the previous module set.
