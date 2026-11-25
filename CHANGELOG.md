# Changelog

Entries for the next release, copied into its GitHub release notes when it is published. Published releases and their notes: [GitHub Releases](https://github.com/ProAnima/Arkvory/releases).

## Next patch release

**Security**

- Updated runtime dependencies Fastify, PostgreSQL's JavaScript client, MCP server SDK and Zod, refreshed development tools and pinned minimatch 11.0.8 to fix GHSA-g3hv-75wg-m249 in the tooling dependency tree.
- The bundled Node.js runtime is 24.22.3, a security release; the installers verify it by its pinned SHA-256. The Compose installation uses PostgreSQL 18.7, a minor update of the same major version that needs no data migration.

**Fixed**

- The scheduled updater is no longer stopped after 30 minutes. An update that waits for a fresh verified backup of a large installation could be ended in the middle of a database migration, which left the services stopped until `recover`; an update request that was accepted before could then block every later check. The time limit is now 14 hours, above the longest wait the updater itself allows. The update to this release registers the updater again with the new limit; every later update does the same.
- `arkvory recover` refuses a deployment that is already finished. Run after a rolled-back migration it repeated the failed migration and could leave the services stopped; run after a successful update without a schema change it switched back to the previous release.
- A failed or interrupted release staging no longer leaves a copy of the release in `releases/`; leftovers of earlier attempts are removed at the start of the next one.
- The Linux command-line installer extracts the Node.js runtime with root ownership instead of the user id recorded in the archive.
- A backup capture that cannot create its staging directory in the vault (a full or read-only volume) is recorded as failed at once. Before, the job stayed "running" until the next capture and a manual retry was refused as busy.
- Moving stored files between volumes no longer leaves staging directories, or the partial file of an interrupted copy, in the target volume: online cleanup removes them on its next pass.
- A licence refresh that could not connect to the hub (the host does not answer) is retried later like any unreachable hub. Before, two such attempts in a row required a new `license activate`.
- Modules: a derived cache works again after a short database outage at its first use instead of staying unavailable until a restart; a cancelled data file write that meets contention gives its quota back; on Windows a file published while another program holds its temporary name is no longer reported as a conflict.
- Promotion no longer publishes a copy whose catalog entry names another storage volume than the one that holds its bytes. This could happen when a promotion was retried after the source had been moved to another volume, or when the volume of the source had reached its limit; the copy was then unreadable, and a promotion in `move` mode retired the only readable entry. Such a promotion now reserves a new copy or is refused with `capacity_exceeded`.
- Backup retention no longer deletes a restore point that was missing from the vault for a while and came back, for example after backup disks were rotated or an older snapshot of the vault was mounted for a restore drill. Such a point, pinned ones included, is listed again and verified anew. Before, the next retention run removed it and its content. Points that were already missing when you update keep the earlier behaviour: if one of them comes back, take a manual backup first and pin the points you need.
- Backups: content that was damaged in the vault is no longer inherited by every later restore point. A deep verification that finds such content takes it out of the way, and the next backup stores it again from the source, which also heals the earlier points that list it.
- Modules: readers of a module cache use their own pool of database connections (up to 16 per process, opened on use). Before, the third concurrent reader waited five seconds and failed, and downloads of the core could fail with it. See [ADR 0073](docs/adr/0073-capacity-counters-and-pools.md).
- A publication that waits for a lock of its repository for a few seconds (a retention pass over a very large repository, a migration) no longer loses its upload lock connection after two to four seconds; it failed after all bytes had been received.
- A mirror whose source was restored from a backup during the first synchronisation runs that synchronisation again instead of skipping the changes that reuse earlier sequence numbers.
- npm: a tarball whose pax header sets an entry size, whose global pax header sets a path, or that holds a file named like `package.json` in another letter case is refused. npm reads such an archive differently from the registry, so the indexed manifest could differ from the installed one.
- SDK: the completion of a large upload by the worker honours the attempt timeout and the caller's cancellation while it enqueues and polls.
- Licences: a failure the hub reports itself (5xx with its error code) is retried with backoff; before, two in a row required a new `license activate`.
- Release signing: `sign-draft` signs a draft only after its assets match the checksum inventory and its manifest names the requested version, the commit of the release tag on `main` and the hashes of the runtime archive and Setup.
- HA: losing the standby server could leave the storage of the active server suspended until an operator ran `drbdadm resume-io`. The DRBD fence-peer handler gave up after 20 s, while the fence of the server Pacemaker delays in `ha-2` takes longer. The handler now waits up to 60 s. Clusters built with an earlier plan: in `/etc/drbd.d/arkvory.res` on every server, the witness included, change `--timeout 20` in the `fence-peer` line to `--timeout 60`; no restart is needed. See [Cluster](https://github.com/ProAnima/Arkvory/blob/main/wiki/operate/cluster.md#updates) and [ADR 0072](docs/adr/0072-single-site-ha.md).
