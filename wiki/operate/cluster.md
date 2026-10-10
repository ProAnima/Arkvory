---
title: High availability cluster
description: Run Arkvory on two or three Linux servers of one site with a synchronous copy of all data, automatic failover and mandatory fencing.
---

# High availability cluster

An Arkvory cluster keeps working when one server of a site fails. Two or three Linux servers hold the same copy of one block volume. One server is **active** and runs Arkvory. When it fails, the cluster manager fences it and starts Arkvory on another server with the same data.

The cluster protects against the loss of a server, a disk or a network link inside one site. It does not protect against the loss of the whole site. For that, keep [mirrors](./mirrors) at another site and [backups](./backups) outside the cluster.

## How it works {#how-it-works}

- **One volume, synchronous copies.** DRBD 9 copies every write of the volume to the other servers before the write completes (protocol C). The whole installation lives on the volume: the database, the storage, the configuration and the releases. The catalog and the file bytes never diverge.
- **Pacemaker decides where Arkvory runs.** Corosync and Pacemaker keep the quorum, choose the active server and start, in order: the volume, the file system, the database, `arkvory-replica`, the API, the worker, the backup agent, the update timer and a virtual IP address. Arkvory has no election of its own.
- **Fencing is mandatory.** Before another server takes over, Pacemaker switches the failed server off through a power device (IPMI, iDRAC, iLO, Redfish, a PDU) or a hypervisor. Without fencing, two servers could write at once. A cluster without fencing does not start.
- **Two copies for every acknowledged write.** Arkvory answers a write with success only when the write is on at least two complete copies (see [Writes](#writes)). When a copy is missing, writes stop and reads continue.

| Profile | Data servers | Witness                                                                                | When one data server fails                                   |
| ------- | ------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `ha-2`  | 2            | required: a small server without data that runs `corosync-qnetd` and a DRBD tiebreaker | Writes stop until the server returns or an operator decision |
| `ha-3`  | 3            | not used: the three servers decide by majority                                         | Writes continue: two copies remain                           |

`ha-3` is the recommended profile. `ha-2` costs less and stops writes honestly instead of keeping data in one copy.

The cluster is for the native Linux packages. Windows installations and Docker Compose remain standalone servers with mirrors and backups.

## Writes and copies {#writes}

A **complete copy** is the local disk of the active server when it is up to date, plus every other data server that is connected, replicating and up to date. A server that is resynchronizing does not count until it is up to date. The witness has no data and never counts.

Every request that changes data (the HTTP API, the container registry, Git LFS, npm) is checked twice:

- **before** it runs, against the copies of the last second;
- **after** the data is committed and synced, against a fresh reading of the volume.

When fewer complete copies exist than writes need, the client gets HTTP 503 with the code `unavailable`, the reason `replication_degraded` and a `Retry-After` header, never a 2xx. The status of an upload completion job (`GET /api/v1/jobs/{id}`) is checked the same way, because it tells the client that a large upload is published.

A 503 after the commit means that the operation may exist in one copy only. Repeat the request with the same `Idempotency-Key`: the repeat returns the existing result, and its 2xx confirms it once two copies exist again.

Reads, downloads, the console, sign-in and sign-out, feedback, and the Git LFS batch request work while writes are stopped.

An administrator signed in to the console sees a banner while writes are stopped or while a single-copy decision is active.

## Requirements {#requirements}

- Two or three data servers with the same Linux distribution, the same Arkvory package version and a disk (or logical volume) of the full size for the volume on each. Plan for the whole storage plus the database.
- For `ha-2`, a third small server as the witness. It needs no disk for data and does not run Arkvory.
- A network between the servers with low latency. Every write waits for the other servers, so the latency adds to each write. Use a dedicated link when you can.
- DRBD 9 (the kernel module and `drbd-utils` 9; many distributions ship the older 8.4 module, so use LINBIT packages), `pacemaker`, `pcs`, `corosync`, `resource-agents` (on Ubuntu, `resource-agents-base` and `resource-agents-extra`), the fence agents for your hardware. For `ha-2`: `corosync-qdevice` on the data servers and `corosync-qnetd` on the witness.
- A fence device for each data server and the credentials for it.
- A free IP address in the servers' network. Clients connect to this virtual address.
- A TLS certificate for the virtual address. Keep the certificate and the key on the volume, so every server finds them at the same path.

## Build a cluster {#build}

The commands below use the default resource name `arkvory`, the installation directory `/opt/proanima-arkvory` and `/dev/vg0/arkvory` as the backing disk. Run them as root.

1. On every data server, unpack the Arkvory package without installing it. This adds the files and the `arkvory` command and creates nothing in `/opt/proanima-arkvory`:

   ```bash
   dpkg --unpack Arkvory-amd64.deb
   ```

2. On one data server, make the plan. It writes the DRBD resource and the Pacemaker commands into a directory for you to review:

   ```bash
   arkvory cluster-plan --cluster ha-2 \
     --nodes node-a=10.0.0.11,node-b=10.0.0.12 --witness witness=10.0.0.13 \
     --disk /dev/vg0/arkvory --fence-agent fence_ipmilan \
     --virtual-ip 10.0.0.100/24 --output /root/arkvory-plan
   ```

   For `ha-3`, list three servers in `--nodes` and leave out `--witness`. Optional: `--cluster-resource`, `--drbd-minor` (default 0), `--drbd-port` (default 7789), `--filesystem` (`xfs` or `ext4`, default `xfs`). The names must be the host names of the servers.

3. Copy `arkvory.res` to `/etc/drbd.d/` on every server, the witness included. Create the metadata on the data servers and bring the resource up everywhere:

   ```bash
   drbdadm create-md arkvory   # data servers only
   drbdadm up arkvory          # every server
   ```

   On the witness, also run `systemctl enable drbd@arkvory.service` so that the tiebreaker comes back after a restart.

   The plan lets a returning copy resynchronize at 20 MB/s at least, even under write load, and at 1 GB/s at most. Set `c-min-rate` and `c-max-rate` in the `disk` section to what your replication link carries.

4. On the first data server, make it primary, create the file system and mount it. With new empty disks, skip the initial synchronization first:

   ```bash
   drbdadm new-current-uuid --clear-bitmap arkvory/0
   drbdadm primary arkvory
   mkfs.xfs /dev/drbd0
   mkdir -p /opt/proanima-arkvory && mount /dev/drbd0 /opt/proanima-arkvory
   ```

5. Install Arkvory into the mounted volume, put the TLS files on the volume and turn on the cluster mode:

   ```bash
   dpkg --configure proanima-arkvory
   install -d -m 0750 -o root -g arkvory /opt/proanima-arkvory/config/tls
   install -m 0644 tls.crt /opt/proanima-arkvory/config/tls/tls.crt
   install -m 0640 -g arkvory tls.key /opt/proanima-arkvory/config/tls/tls.key
   arkvory configure --root /opt/proanima-arkvory --tls-cert /opt/proanima-arkvory/config/tls/tls.crt --tls-key /opt/proanima-arkvory/config/tls/tls.key --listen-host 0.0.0.0
   arkvory configure --root /opt/proanima-arkvory --cluster ha-2
   ```

   `configure --cluster` checks that the installation directory is the mounted DRBD device, that this server is primary and that every copy is complete. It starts `arkvory-replica`, makes Arkvory acknowledge writes only with two complete copies and turns off the automatic start of the Arkvory services: from now on Pacemaker starts them. If a step fails, the standalone configuration is restored.

6. Stop Arkvory on the first server and release the volume:

   ```bash
   systemctl stop arkvory-update.timer arkvory-backup arkvory-worker arkvory-api arkvory-replica arkvory-database
   umount /opt/proanima-arkvory && drbdadm secondary arkvory
   ```

7. On each other data server in turn, take the volume, prepare the server and release the volume again:

   ```bash
   drbdadm primary arkvory
   mkdir -p /opt/proanima-arkvory && mount /dev/drbd0 /opt/proanima-arkvory
   arkvory cluster-node --root /opt/proanima-arkvory --cluster-resource arkvory
   dpkg --configure proanima-arkvory
   systemctl stop arkvory-update.timer arkvory-backup arkvory-worker arkvory-api arkvory-replica arkvory-database
   umount /opt/proanima-arkvory && drbdadm secondary arkvory
   ```

   `cluster-node` creates the service accounts with the same user and group IDs as on the first server (the files on the volume belong to them) and installs the same services, none of them started automatically. If an account already exists with other IDs, the command stops and tells you which IDs to set.

8. Set up the Corosync cluster with `pcs` on the data servers (`pcs host auth`, `pcs cluster setup`, `pcs cluster start --all`). On Debian and Ubuntu, first run `pcs cluster destroy` on each data server: the packages install a sample Corosync configuration that `pcs` takes for an existing cluster. Do not run `pcs cluster enable`: a server that was fenced should rejoin only when you start it. For `ha-2`, also authenticate the witness and run `pcs qdevice setup model net --enable --start` on it. On Debian and Ubuntu the package has already set the quorum device up for its own service account: run `systemctl enable --now corosync-qnetd` there instead.

9. Open `/root/arkvory-plan/pacemaker.sh`. Replace each `<agent parameters: …>` with the parameters of your fence device: its address, the login, the password file or key, and the plug or port of that server. Then run the script on one data server:

   ```bash
   sh /root/arkvory-plan/pacemaker.sh
   ```

   The script builds the whole configuration in a file and pushes it at once: fencing, quorum policy, the DRBD resource, the Arkvory group and its constraints.

10. Check the cluster on the active server:

    ```bash
    arkvory cluster-check --root /opt/proanima-arkvory
    ```

    The command checks the quorum, that fencing is enabled, that every server has a fence device, the DRBD quorum and fencing settings, that every copy is complete and that Arkvory runs on exactly one server. It exits with an error when a check fails.

11. Prove fencing once: fence each standby server and let it come back (see [Fencing test](#fence-test)).

Point your clients and DNS name at the virtual address.

## Day-to-day operation {#operation}

Run these commands as root. `cluster-status` and `cluster-single-copy` read the volume, so run them on the active server; the others work on any data server.

| Command                                                                   | What it does                                                                                      |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `arkvory cluster-status --root <dir>`                                     | Profile, the role of this server, complete and required copies and any operator decision, as JSON |
| `arkvory cluster-check --root <dir>`                                      | All checks of a healthy cluster; exits with an error when one fails                               |
| `arkvory cluster-switchover --root <dir> --to <server>`                   | Planned move of Arkvory to another data server; refused unless every copy is complete             |
| `arkvory cluster-fence-test --root <dir> --node <standby>`                | Fences a standby server to prove its fence device; the active server is refused                   |
| `arkvory cluster-single-copy --root <dir> --until <time> --reason <text>` | Accepts writes with a single copy until a time; see [Single copy](#single-copy)                   |

`pcs status` shows the cluster as Pacemaker sees it.

### Planned switchover {#switchover}

`cluster-switchover` asks Pacemaker to move the group, waits up to 5 minutes until Arkvory runs on the target and then removes the temporary placement rule. Connections to the old server break during the move; clients repeat their requests. Arkvory never moves back by itself.

### Fencing test {#fence-test}

`cluster-fence-test` restarts a standby through its fence device. After the restart, start the cluster on that server with `pcs cluster start`. The cluster services do not start on their own after a restart (step 8 of [Build a cluster](#build)), so a server that was fenced never rejoins without you.

### Updates {#updates}

Install a new package on every data server. On standby servers the package only replaces the program files, because the release lives on the volume. On the active server the package applies the release: Arkvory tells Pacemaker to leave the group alone, stops the services, migrates, starts them, waits until they are ready and hands the group back. Automatic updates work the same way on the active server.

Do not start or stop the Arkvory services with `systemctl` on a cluster server. Pacemaker would take it as a failure. Use `pcs resource disable arkvory` and `pcs resource enable arkvory` for a planned stop of the whole service.

## Failures {#failures}

| What happens                                                    | `ha-2`                                                                                                          | `ha-3`                                                            |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| A standby server fails                                          | Fenced. Reads continue, writes get 503 `replication_degraded`                                                   | Fenced. Reads and writes continue                                 |
| The active server fails                                         | Fenced, Arkvory starts on the other server. Reads return, writes wait for the second copy                       | Fenced, Arkvory starts on another server. Reads and writes return |
| Network split between data servers                              | The witness gives the quorum to one side; the other side is fenced. Never two writers                           | The majority side continues; the other server is fenced           |
| Two of three members fail (ha-2: a data server and the witness) | The last server has no quorum: Arkvory stops. Never a writer without quorum. Bring the servers back (see below) | The same for two data servers                                     |
| Fencing does not work                                           | No failover. Arkvory stays stopped until fencing succeeds                                                       | The same                                                          |

To bring a fenced server back:

1. Repair the cause and start the server.
2. Run `pcs cluster start` on it.
3. The volume resynchronizes the changed blocks. Writes resume by themselves when every copy needed is complete again; `arkvory cluster-status` shows the progress.

After a loss of quorum, start the cluster on every server that is back. Pacemaker runs Arkvory again on the server with the newest copy. The server that lost the quorum last may be fenced once more on the way back, because it could not stop cleanly: start the cluster on it again after its restart.

When fencing failed and you repaired it, clear the failed attempts on a running server so that Pacemaker tries again: `pcs stonith history cleanup <server>` and `pcs resource cleanup`.

### Single copy {#single-copy}

When a data server stays away for long (a disk replacement, for example), and stopped writes cost more than the risk, an operator can accept writes with one copy for a limited time:

```bash
arkvory cluster-single-copy --root /opt/proanima-arkvory --until 2026-10-12T18:00:00Z --reason "disk replacement on node-b"
```

- The time must be within the next 7 days. The command works only while copies are missing.
- While the decision is active, a loss of the active server loses the writes acknowledged after it.
- The console banner, the metric `arkvory_replication_required_copies` and the alert `ArkvorySingleCopyWrites` show the decision.
- It ends at its time, with `--off`, or by itself as soon as every copy is complete again. A later loss stops writes again.

## Monitoring {#monitoring}

`GET /health/ready` stays 200 on the active server while writes are stopped, so a monitor does not move a healthy server. Its field `writable` is `false` and the field `replication` shows `copies`, `required` and `singleCopyUntil`; `replication` is `null` when the copies cannot be read. Standalone servers have no `replication` field.

| Metric                                     | Meaning                                                     |
| ------------------------------------------ | ----------------------------------------------------------- |
| `arkvory_replication_copies`               | Complete copies at the last check                           |
| `arkvory_replication_required_copies`      | Copies a write needs: 2, or 1 during a single-copy decision |
| `arkvory_replication_writes_refused_total` | Writes answered with 503 `replication_degraded`             |
| `arkvory_replication_check_failures_total` | Failed readings of the copy state                           |

The alert rules in `deploy/monitoring/arkvory-alerts.yml` include `ArkvoryReplicationDegraded`, `ArkvorySingleCopyWrites` and `ArkvoryReplicationCheckFailing`. Watch the cluster itself too: run `arkvory cluster-check` on a schedule and alert on its exit code, or use the monitoring of your Pacemaker installation. See [Monitoring](./monitoring).

## Backups {#backups}

The backup agent runs on the active server only, as part of the group. Keep the backup vault outside the cluster volume, for example on a NAS. See [Backups](./backups).
