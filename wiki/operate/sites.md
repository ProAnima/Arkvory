---
title: Sites
description: See every installation of your cluster in one place, pair sites with a one-time code and follow their state.
---

# Sites

A **site** is one Arkvory installation: the main one, a mirror in another location, an installation that imports versions from another. On [[ui:fleet]], one installation, the **controller**, shows every site it manages: whether it answers, its version, its HA copies and read gateways, its mirrors and how far behind they are, and its download queue. Only global administrators see the page.

## State of the cluster {#overview}

The page starts with [[ui:fleetOverview]]: what needs attention across the sites, and which site feeds which. The controller builds it from the last reads of the sites, at most once every 5 seconds, and lists itself as "this site".

### Alerts {#alerts}

Each alert names the site and the problem. The most severe come first: [[ui:fleetSeverityCritical]], then [[ui:fleetSeverityWarning]], then [[ui:fleetSeverityInfo]]. When nothing needs attention, the list says so.

| Alert                                  | Severity                     | When                                                                                                                                                             | What to do                                                        |
| -------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Unreachable                            | [[ui:fleetSeverityCritical]] | No answer for 2 minutes. One failed read is no alert                                                                                                             | Check the site and the network                                    |
| Certificate, revoked, refused, invalid | [[ui:fleetSeverityCritical]] | At once, with the [state](#states) of the same name                                                                                                              | Pair again, or update both installations                          |
| Stale                                  | [[ui:fleetSeverityWarning]]  | The site answered, but was not read for three read periods (90 seconds) plus the time one round of reads takes: the background reads of the controller are stuck | Check the API process of the controller                           |
| Not writable                           | [[ui:fleetSeverityCritical]] | A writer refuses writes and is not draining                                                                                                                      | Check its database and its disk                                   |
| Copies                                 | [[ui:fleetSeverityCritical]] | An HA site lacks copies of its data; writes pause until they are back                                                                                            | Bring the missing node back, see [HA cluster](./cluster#failures) |
| Single copy                            | [[ui:fleetSeverityWarning]]  | Copies are lacking, but an operator accepted [one copy](./cluster#single-copy) until a set time                                                                  | Bring the missing node back before that time                      |
| Mirror failing                         | [[ui:fleetSeverityWarning]]  | The last synchronization of a mirror failed. Reading a restored source again does not count                                                                      | Read the [error code](./mirrors#error-codes) of the mirror        |
| Mirror behind                          | [[ui:fleetSeverityWarning]]  | A mirror is `ARKVORY_FLEET_LAG_ALERT` changes (1000 by default) or more behind its source                                                                        | Check the source, the network and the mirror                      |
| Updates failed                         | [[ui:fleetSeverityWarning]]  | The updater of the site reports a failure                                                                                                                        | Open [[ui:updates]] in the [settings of the site](#site-settings) |
| Version skew                           | [[ui:fleetSeverityInfo]]     | The site runs another version than the controller                                                                                                                | Update the sites to the same release                              |

Alerts use only fresh reads: a site that does not answer raises its own alert, not alerts about what it last reported. One round of reads takes up to 15 seconds for every eight sites, because the controller reads at most eight at a time and waits up to 15 seconds for each; the stale alert adds that time, so many unreachable sites do not make healthy ones look stuck. Prometheus alerts at the same `ARKVORY_FLEET_LAG_ALERT`, see [Monitoring](./monitoring#alerts).

### Links {#map}

[[ui:fleetMap]] shows which site feeds which. Every mirror and import is an arrow from the source site to the site that holds the mirror.

- A source at whose address no managed site answers is drawn by its address, with a dashed border. If that source is the controller itself, set `ARKVORY_SITE_URL`, see [Settings](#settings).
- A failing link is dashed red.
- The number on a link is how many changes the mirror is behind its source.
- While a site does not answer, its links and their lag stay as it last reported them, marked as last known: dashed on the map, and with the hint [[ui:fleetLinkStale]] in the table.

Below the map, a table lists the same facts: [[ui:fleetLinkFrom]], [[ui:fleetLinkTo]], [[ui:fleetMirrorRepository]], [[ui:fleetMirrorSourceRepository]] and [[ui:fleetLinkBehind]].

Global administrators of the controller get the same alerts and links from `GET /api/v1/fleet/overview`, or from the SDK with `client.fleet.overview()`. For Prometheus, the controller exports the state of its sites and the number of alerts: see [Monitoring](./monitoring#metrics).

## How it works {#how-it-works}

- The controller keeps a list of sites. It reads every site every 30 seconds over HTTPS and keeps the last answer, so a site that stops answering still shows its last known state.
- When a site is paired, it gives the controller a key of its own, a **fleet key**. The fleet key reaches only what a controller needs: the state of the site, the descriptions in its catalog, and the listed changes: the download queue, update requests, and mirror and HA changes for the site's agent. It cannot download file bytes, write to repositories, or read or change accounts and keys.
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

## Settings of a site {#site-settings}

[[ui:fleetSettings]] in the row of a site opens its settings below the list; [[ui:fleetThisSettings]] opens the same card for this site. The card has three parts:

- **[[ui:fleetQueueSettings]]**: how many downloads run at once, places kept for people, the strategy, class weights and the other queue values of [Traffic control](../reference/environment#transfers-and-bandwidth). An empty field keeps the value of the site's environment, shown in grey. [[ui:fleetQueueSave]] applies the values at once, without a restart: new decisions follow them, active downloads keep their places. [[ui:fleetQueueReset]] returns to the environment.
- **[[ui:updates]]**: the installed and the latest version, automatic installation and the maintenance hour, [[ui:updateCheck]] and [[ui:updateInstall]]. The site's updater takes a request within a minute; the card shows it as accepted until then.
- **[[ui:fleetAgent]]**: the site's mirrors and imports with [[ui:fleetMirrorKeySave]] and [[ui:fleetMirrorDetach]], [[ui:fleetMirrorAttach]] with the source key, and on an HA cluster [[ui:fleetSwitchover]] to a node with a complete copy (the node name typed twice) and the single-copy decision. The site's agent applies each request within a minute with the checks and rollback of `arkvory configure` and `cluster-*`; [[ui:fleetRequests]] shows how each ended. The source key goes to the agent once, in a file of its own, and is never shown again. The agent is the updater of the site: connect it with `updates-connect`.

Each change carries the revision it was made from. If someone changed the settings meanwhile, the site refuses the change and the card shows the current values: check them and save again. The site records who changed its queue: the controller's key and the name of its administrator.

From the controller a mirror or an import is attached only as a new repository, and the authority certificate of a source is set on the site itself (`arkvory configure --mirror-ca-file`): what a site trusts never changes remotely. The request list shows how each change ended as a code; the agent's own words stay in its log on the site. If a change was interrupted half done, the agent takes no other until an administrator of the site checked it and ran `arkvory changes-reset --root <root>` there.

## Who manages this site {#managed-by}

Under [[ui:fleetThisSite]], every site lists the controllers that manage it: their name, who paired them, when, and their last request. [[ui:fleetRevoke]] refuses the controller's key at once.

## Settings {#settings}

| Variable                  | Default                           | Meaning                                                                                                                                                                                          |
| ------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ARKVORY_SITE_NAME`       | the host name                     | How this installation is named on other sites                                                                                                                                                    |
| `ARKVORY_FLEET_KEY_FILE`  | `fleet.key` in the data directory | The key that seals the keys of managed sites; made on the first start of the writer                                                                                                              |
| `ARKVORY_SITE_URL`        | not set                           | The `https://host[:port]` address other sites use to reach this installation. With it, mirrors whose source is this installation link to it on [[ui:fleetMap]]. An invalid value stops the start |
| `ARKVORY_FLEET_LAG_ALERT` | `1000`                            | Changes behind its source at which a mirror of a managed site alerts; a whole number, 1 or more                                                                                                  |

## Limits {#limits}

- Fencing tests and adding or removing cluster nodes stay local commands on the nodes. Read gateways keep the download queue of their environment.
- A controller manages up to 256 sites and reads at most eight at a time.
- The controller holds a key to every site it manages: protect its global administrators and its data directory as carefully as the sites themselves.
