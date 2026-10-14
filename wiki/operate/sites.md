---
title: Sites
description: See every installation of your cluster in one place, pair sites with a one-time code and follow their state.
---

# Sites

A **site** is one Arkvory installation: the main one, a mirror in another location, an installation that imports versions from another. On [[ui:fleet]], one installation, the **controller**, shows every site it manages: whether it answers, its version, its HA copies and read gateways, its mirrors and how far behind they are, and its download queue. Only global administrators see the page.

## How it works {#how-it-works}

- The controller keeps a list of sites. It reads every site every 30 seconds over HTTPS and keeps the last answer, so a site that stops answering still shows its last known state.
- When a site is paired, it gives the controller a key of its own, a **fleet key**. The fleet key reaches only what a controller needs: the state of the site and the descriptions in its catalog. It cannot download file bytes, change anything, or read accounts and keys.
- The controller keeps the fleet keys sealed with a key in its data directory (`fleet.key`). The database and its backups alone do not reveal them. After a restore, pair the sites again.
- Every site shows which controllers manage it and can revoke them at any time.

## Pair a site {#pair}

1. On the site: open [[ui:fleet]] and, under [[ui:fleetThisSite]], select [[ui:fleetMakeCode]]. The site shows a code that is valid for ten minutes and, with built-in HTTPS, the fingerprint of its certificate.
2. On the controller: open [[ui:fleet]], enter the address of the site under [[ui:fleetAdd]] and select [[ui:fleetCheck]]. The controller connects and shows the fingerprint of the certificate it received.
3. Compare the two fingerprints. They must be the same. If they differ, the address is wrong or something stands between the two installations: do not pair.
4. Enter the code and select [[ui:fleetPair]]. The site appears in the list with its state.

A code works once. A used or expired code is refused: make a new one.

The address is the HTTPS address of the site's API, for example `https://branch.example:8443`. Plain HTTP is accepted only on the same computer (`127.0.0.1`). When TLS ends at a proxy in front of the site, the site cannot show the proxy's certificate: compare with the SHA-256 fingerprint your browser shows for the site's address.

From then on, the controller trusts exactly that certificate. When the site gets a new certificate, it shows [[ui:fleetStateCertificate]]: remove the site and pair it again.

## States {#states}

| State                        | Meaning                                                      | What to do                                                         |
| ---------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| [[ui:fleetStateOk]]          | The site answered the last read                              | Nothing                                                            |
| [[ui:fleetStatePending]]     | The site was not read yet                                    | Wait for the next read or select [[ui:fleetReadSite]]              |
| [[ui:fleetStateUnreachable]] | No answer: the site is stopped, or the network is down       | Check the site and the network. The last known state stays visible |
| [[ui:fleetStateCertificate]] | The site presents another certificate than the one confirmed | If the certificate was renewed, remove the site and pair it again  |
| [[ui:fleetStateRevoked]]     | The administrator of the site revoked this controller        | Pair again with a new code                                         |
| [[ui:fleetStateInvalid]]     | The site answered in a way this release does not understand  | Update both installations to the same release                      |
| [[ui:fleetStateRefused]]     | The site refused the request                                 | Pair again with a new code                                         |

## What the list shows {#list}

- **[[ui:fleetVersion]]**: the release of the site and its role, writer or read gateway.
- **[[ui:fleetCopies]]**: on an HA cluster, the complete copies and the copies a write needs; the read gateways that hold their slot.
- **[[ui:fleetMirrors]]**: the mirrors and imports of the site; how many changes the furthest one is behind its source, or how many are stopped.
- **[[ui:fleetQueue]]**: downloads that run and downloads that wait in the download queue.
- **[[ui:fleetSeen]]**: when the site last answered.

[[ui:fleetReadAll]] reads every site now instead of waiting for the next round. [[ui:fleetRemoveSite]] forgets a site here; revoke the controller on the site as well, because until then its key stays valid there.

## Content of a site {#content}

[[ui:fleetContent]] in the row of a site opens its repositories, artifacts and files below the list. Choose a repository; [[ui:fleetFind]] searches artifacts by name or label and lists files under a path that starts with what you typed. [[ui:fleetMore]] reads the next page.

The controller reads these on the site with its fleet key and shows the answer as the site gave it. Only descriptions travel: names, sizes, labels, stages, paths and revisions. To download a file, use the site itself.

## Who manages this site {#managed-by}

Under [[ui:fleetThisSite]], every site lists the controllers that manage it: their name, who paired them, when, and their last request. [[ui:fleetRevoke]] refuses the controller's key at once.

## Settings {#settings}

| Variable                 | Default                           | Meaning                                                                             |
| ------------------------ | --------------------------------- | ----------------------------------------------------------------------------------- |
| `ARKVORY_SITE_NAME`      | the host name                     | How this installation is named on other sites                                       |
| `ARKVORY_FLEET_KEY_FILE` | `fleet.key` in the data directory | The key that seals the keys of managed sites; made on the first start of the writer |

## Limits {#limits}

- The page shows the state of sites. Mirrors, updates, the download queue and HA are configured on each site, with its console or `arkvory configure`; changing them from the controller comes next.
- A controller manages up to 256 sites and reads at most eight at a time.
- The controller holds a key to every site it manages: protect its global administrators and its data directory as carefully as the sites themselves.
