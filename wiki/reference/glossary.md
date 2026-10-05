---
title: Glossary
description: Short definitions of the terms used in Arkvory and its documentation, in alphabetical order, each with a link to the page that explains it.
---

# Glossary

The terms are in alphabetical order. For the ideas behind them, read [Concepts](../guide/concepts).

## A {#letter-a}

### Account {#account}

A person's sign-in on the server: a name of 3 to 64 characters and a password of 12 to 128 characters. Group grants give an account access to repositories. See [Accounts and access](../use/accounts).

### Action {#action}

One exact right on a repository, such as `upload.create` or `content.read`. Service keys carry actions, and the API reference names the actions each operation needs. See [Authentication](../api/authentication#repository-actions).

### Administrator {#administrator}

An account that manages accounts, groups, updates and backups. An administrator does not read a repository's files unless a group also grants that access. See [Accounts and access](../use/accounts).

### Admission {#admission}

The limit on how many requests and transfers the server handles at the same time. Above it, a transfer waits briefly and then the server answers `503` with the code `busy` and a `Retry-After` header. See [Rate limits and busy servers](../api/index#rate-limits).

### Artifact {#artifact}

One immutable stored file with its SHA-256. New content makes a new artifact. See [Concepts](../guide/concepts#artifacts).

### Attachment {#attachment}

A link from a build to another artifact of the same repository: a manifest, an SBOM, a signature, a report or another file. A build has up to 32 attachments. See [Concepts](../guide/concepts#annotations).

## B {#letter-b}

### Backup {#backup}

A scheduled copy of the database and all published content into the vault. See [Backups](../operate/backups).

### Backup agent {#backup-agent}

The service that makes the copies, verifies them and applies retention to the restore points. See [Backups](../operate/backups).

### Bearer token {#bearer-token}

The way every client sends a credential to `/api/v1`: the header `Authorization: Bearer <credential>`. See [Authentication](../api/authentication#headers).

### Binding {#binding}

One entry of a service policy: a repository and the list of actions allowed on it. A policy has up to 64 bindings. See [Authentication](../api/authentication#service-accounts).

### Build {#build}

The output of one CI run, stored as an artifact or as a package version. See [Packages](../use/packages).

## C {#letter-c}

### Catalog {#catalog}

The list of artifacts in a repository, with their names, sizes, labels and stages. See [Artifacts reference](../api/reference/artifacts).

### Ceiling {#ceiling}

The limit of a delegation: the repository actions that an operator may put into the policies and keys of the accounts it administers. The operator cannot go beyond its ceiling. See [Authentication](../api/authentication#delegation).

### Checksum {#checksum}

The SHA-256 that proves the bytes are the expected ones. Uploads declare it before the bytes arrive, and the server and the clients verify it. See [Transfers](../use/transfers).

### Cleanup {#cleanup}

Also called physical cleanup. It frees the disk space of deleted content in the background, in small batches. See [Storage](../operate/storage).

### Collection {#collection}

A named set of artifacts. A collection is part of an artifact's annotations. See [Concepts](../guide/concepts#annotations).

### Compare-and-swap {#compare-and-swap}

A change that names the revision it expects, such as `expectedRevision`. If another change came first, the server answers `409` with the reason `revision_mismatch` and changes nothing. See [HTTP API overview](../api/index#revisions).

### Completion job {#completion-job}

A background job of the worker that checks and publishes a large upload. You follow it with `GET /api/v1/jobs/{id}`. Its status is `queued`, `running`, `completed` or `failed`. See [Uploads reference](../api/reference/uploads#getCompletionJob).

### Console {#console}

Arkvory's web interface, served at `/console/`. See [The web console](../guide/console).

### CORS {#cors}

The browser rule for pages that call an API at another address. A page from another origin works only if the administrator lists that origin in `ARKVORY_CORS_ORIGINS`. See [Environment variables](./environment).

### Cursor {#cursor}

The value `next` in a page of results. Send it back as `after` to read the next page; when `next` is `null`, the list is complete. See [HTTP API overview](../api/index#pagination).

## D {#letter-d}

### Delegation {#delegation}

A grant from the recovery key to an operator key: it may administer named service accounts, with named administration actions, within a ceiling. See [Authentication](../api/authentication#delegation).

### Digest {#digest}

A container image's content address, written `sha256:…`. See [Container images](../protocols/containers).

### Download link {#download-link}

A time-limited link that downloads one artifact without a key. It lives from 60 seconds to 24 hours (1 hour by default), and nobody can revoke it before it expires. See [Authentication](../api/authentication#download-links).

## E {#letter-e}

### ETag {#etag}

The validator of a download: the strong value `"sha256:<hex>"` of the artifact. Use it with `If-Range` to resume safely and with `If-None-Match` to skip a repeated download. See [HTTP API overview](../api/index#range-downloads).

## F {#letter-f}

### Failover {#failover}

Moving clients to a mirror when the source is lost. The operator detaches the mirror, and it becomes an ordinary repository that accepts changes. Nothing switches by itself. See [Mirrors](../operate/mirrors).

### Feedback {#feedback}

A report with screenshots and logs that a signed-in user sends to ProAnimaStudio from the console. The console shows what is attached before it sends anything. See [The web console](../guide/console#feedback).

### File by path {#file-by-path}

A file addressed by a path in the repository, such as `builds/game/Setup.exe`, that keeps its earlier revisions. See [Files and paths](../use/files).

### File key {#file-key}

A secret whose SHA-256 is listed in the server's keys file (`ARKVORY_KEYS_FILE`). The recovery key is a file key. See [Authentication](../api/authentication#recovery-key).

## G {#letter-g}

### Grace period {#grace-period}

The time that deleted content stays on disk before cleanup removes it: 24 hours by default. See [Storage](../operate/storage).

### Group {#group}

A set of accounts that share repository access. A group gets `read` or `write` ("Read and write") access per repository. See [Accounts and access](../use/accounts).

## H {#letter-h}

### History {#history}

The earlier revisions of a file by path, or of an attachment set. See [Files and paths](../use/files).

### Hub {#hub}

The ProAnimaStudio service at `https://hub.proanima.net` that announces stable releases and receives feedback. See [Updates](../install/updates).

## I {#letter-i}

### Idempotency key {#idempotency-key}

The `Idempotency-Key` header: a value of 1 to 128 characters that makes a repeated request take effect once. See [HTTP API overview](../api/index#idempotency).

### Image {#image}

A container image stored in the built-in registry. See [Container images](../protocols/containers).

### Installation root {#installation-root}

The folder with the data, configuration and logs: `C:\ProgramData\ProAnima\Arkvory` on Windows and `/opt/proanima-arkvory` on Linux. See [Choose an installation](../install/index#installation-directory).

## L {#letter-l}

### Label {#label}

A short tag on an artifact, such as `nightly` or `tested`. An artifact has up to 32 labels. See [Concepts](../guide/concepts#annotations).

### Lease {#lease}

A claim that a process holds for a short time and has to renew, so that only one process does a job. The backup agent holds a lease of 60 seconds by default, so two agents never run at once. See [Environment variables](./environment#backups).

### Liveness {#liveness}

The answer of `GET /health/live`: the process runs. It is public. See [System reference](../api/reference/system).

### Lock {#lock}

A Git LFS file lock that stops two people from changing the same binary file. See [Git LFS](../protocols/git-lfs).

## M {#letter-m}

### Maintenance hour {#maintenance-hour}

The hour of the day in UTC in which automatic updates may install. The default is 03:00. See [Updates](../install/updates).

### Metadata {#metadata}

Key/value text fields of an artifact: up to 32 fields, with values of up to 1,024 characters. See [Concepts](../guide/concepts#annotations).

### Mirror {#mirror}

A read-only copy of a repository that a second installation keeps by following the source. See [Mirrors](../operate/mirrors).

### Mirror source {#mirror-source}

The installation that a mirror copies from. The mirror signs in to it with a read-only key. See [Mirrors](../operate/mirrors).

### Move {#move}

A promotion that also removes the build from the source repository. See [Promotion](../use/promotion).

## O {#letter-o}

### Onboarding {#onboarding}

The first steps after installation, shown in the console under the Getting started section. See [Quick start](../guide/quick-start).

### OpenAPI {#openapi}

The machine-readable description of the HTTP API, served at `/api/v1/openapi.json`. See [HTTP API overview](../api/index#discovery).

### Owner {#owner}

The first account, created during installation. It is an administrator and a member of the group `arkvory-owners`, which can write to `releases`. See [Concepts](../guide/concepts#owner-and-recovery-key).

## P {#letter-p}

### Package {#package}

A versioned UPack package with a group, a name and a SemVer version. See [Packages](../use/packages).

### Package group {#package-group}

The first part of a package's name. Packages with the same name in different groups are different packages. See [Packages](../use/packages).

### Part {#part}

One piece of a large file that is sent as its own request. A part is at least 8 MiB, except the last one, and at most 1 GiB. See [Transfers](../use/transfers).

### Permission {#permission}

The right to do one action. People get `read` or `write` through groups; service keys get exact actions. See [Authentication](../api/authentication#access-rules).

### Personal access token {#personal-access-token}

A person's secret for scripts and the command line. It starts with `pat_`, expires after 90 days by default (365 at most) and is either read-only or read and write. See [Authentication](../api/authentication#personal-tokens).

### Pin {#pin}

To keep something from automatic deletion, such as a restore point. See [Backups](../operate/backups).

### Policy {#policy}

The saved rules of a service account (its bindings), of a repository (its storage policy) or of the backup plan. See [Authentication](../api/authentication#service-accounts).

### Promote {#promote}

The verb of promotion: publish a build in another repository, or mark it with a stage. See [Promotion](../use/promotion).

### Promotion {#promotion}

Publishing a build in another repository without uploading it again. See [Promotion](../use/promotion).

## Q {#letter-q}

### Quota {#quota}

The most space that a repository may use. A new upload that would pass it is refused with `507` and the reason `storage_quota`. See [Storage](../operate/storage).

## R {#letter-r}

### Range {#range}

The HTTP header `Range: bytes=start-end` that asks for part of a file. Downloads support one range per request, which is what resuming needs. See [HTTP API overview](../api/index#range-downloads).

### Rate limit {#rate-limit}

A limit on how often something may be tried. Arkvory limits sign-in, registration, password and feedback attempts, and answers `429` with `Retry-After`. See [Authentication](../api/authentication#sign-in-limits).

### Read gateway {#read-gateway}

An extra download-only API process on the same storage. It answers `GET` and `HEAD` and refuses changes with `405`. See [Read gateways](../operate/read-gateways).

### Readiness {#readiness}

Whether the server can do its work. `GET /health/status` is public and answers `{"status":"ready"}` or `unavailable`; `GET /health/ready` needs a credential and gives details. See [System reference](../api/reference/system).

### Recovery key {#recovery-key}

Also called the bootstrap key. The installation's secret in `config/bootstrap-token.txt`: it creates the owner, manages service accounts and recovers access. See [Authentication](../api/authentication#recovery-key).

### Registry {#registry}

A server that clients such as Docker or npm push to and pull from. Arkvory has a container registry (`/v2/`) and an npm registry (`/npm/`). See [Clients and protocols](../protocols/index).

### Repository {#repository}

A named space for content with its own access rules and storage policy. See [Repositories](../use/repositories).

### Request ID {#request-id}

The identifier of one request, sent back in the `X-Request-Id` header and in every error. Give it to support. See [HTTP API overview](../api/index#request-ids).

### Resolve {#resolve}

To find the build that a stage and a version range point to. See [Promotion](../use/promotion).

### Restore {#restore}

To make an earlier revision of a file current again, which adds a new revision. Also to recover the whole installation from a restore point. See [Files and paths](../use/files) and [Backups](../operate/backups).

### Restore point {#restore-point}

One complete backup that can be restored. See [Backups](../operate/backups).

### Resume {#resume}

To continue an interrupted upload or download from where it stopped. See [Transfers](../use/transfers).

### Retention {#retention}

The rules for how long content or backups are kept. See [Storage](../operate/storage).

### Retention policy {#retention-policy}

The saved retention rules of a repository: how many builds to keep, which labels to protect and how old a build must be before removal. It is off until an administrator turns it on. See [Storage](../operate/storage).

### Retry-After {#retry-after}

The header, and the `retryAfterSeconds` field of an error, that says how many seconds to wait before trying again after a `429` or a `503`. See [HTTP API overview](../api/index#rate-limits).

### Revision {#revision}

A numbered version of a file by path, of an artifact's annotations or of a setting. Revisions count up from 1. See [HTTP API overview](../api/index#revisions).

### Revoke {#revoke}

To cancel a key or a token for good. See [Authentication](../api/authentication#service-keys).

### Rollback {#rollback}

Returning to the previous version after an update that did not start. See [Updates](../install/updates).

### Rotate {#rotate}

To replace a key with a new one while the old one still works. Activating the new key limits the old one to 24 hours. See [Authentication](../api/authentication#service-keys).

## S {#letter-s}

### SBOM {#sbom}

A software bill of materials: the list of components of a build. You can attach it to a build. See [Concepts](../guide/concepts#annotations).

### Self-healing {#self-healing}

The services restarting by themselves after a crash or a hang. See [Self-healing](../operate/self-healing).

### SemVer {#semver}

Semantic Versioning: `MAJOR.MINOR.PATCH`, with an optional pre-release part, such as `1.4.2` or `2.0.0-rc.1`. See [Packages](../use/packages).

### Service account {#service-account}

An account for CI or automation. It has a policy and signs in with keys. See [Authentication](../api/authentication#service-accounts).

### Service key {#service-key}

The secret that a service account signs in with. It starts with `arkvory_`, is shown once and has to be activated. See [Authentication](../api/authentication#service-keys).

### Session {#session}

A signed-in console session. It starts with `dps_` and lasts 12 hours. See [Authentication](../api/authentication#sessions).

### SHA-256 {#sha-256}

The hash function that Arkvory uses for artifacts, parts and releases. It is written as 64 lowercase hexadecimal digits. See [Transfers](../use/transfers).

### Stable release {#stable-release}

A release that ProAnimaStudio has approved for installations on the stable channel. See [Updates](../install/updates).

### Stage {#stage}

A mark on a build such as `qa`, `release` or `prod`. See [Promotion](../use/promotion).

### Surface {#surface}

One of the six groups of API operations: `discovery`, `identity`, `catalog`, `transfers`, `administration` and `operations`. See [HTTP API overview](../api/index#surfaces).

## T {#letter-t}

### Tag {#tag}

A container image's name for a version, such as `latest` or `1.4`. See [Container images](../protocols/containers).

## U {#letter-u}

### UPack {#upack}

The package format that Arkvory registers: an archive with a manifest named `upack.json` that gives the group, the name and the version. See [Packages](../use/packages).

### Update {#update}

A newer stable release of Arkvory, and installing it. See [Updates](../install/updates).

### Upload {#upload}

The act of sending a file to the server. The word also names the upload session that reserves the file. See [Transfers](../use/transfers).

### Upload session {#upload-session}

A reservation for one file. It lives for 7 days and is completed once every byte has arrived. See [Uploads reference](../api/reference/uploads).

## V {#letter-v}

### Vault {#vault}

The backup storage: a folder on another disk or a network share. See [Backups](../operate/backups).

### Version {#version}

A SemVer version of a package, such as `1.4.2`. See [Packages](../use/packages).

### Version range {#version-range}

A set of versions, such as `^1.4`. See [Packages](../use/packages).

## W {#letter-w}

### Worker {#worker}

The service that finishes large uploads and synchronizes mirrors. See [Choose an installation](../install/index).

### Writer {#writer}

The API process that accepts changes, as opposed to a read gateway. See [Read gateways](../operate/read-gateways).
