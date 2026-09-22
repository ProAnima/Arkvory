# ProAnima Depot

**English** | [Русский](README.ru.md)

**Self-hosted artifact and file storage with controlled delivery.**

UPack packages, metadata, tagging, collections, transfer queues, and ProGet-compatible APIs.

A **ProAnimaStudio** project. **Ian Panaev** is the author, copyright holder, and owner of the ProAnimaStudio brand.

> **Stage: working standalone core, under development.** Native HTTP upload/download, PostgreSQL metadata, immutable local blobs, integrity checks, service keys, and admission limits are implemented. ProGet compatibility, UPack manifest handling, durable queues, UI, SDK, multipart uploads, garbage collection, and HA remain planned.

## Purpose

ProAnima Depot is being designed as an independent service for storing original artifacts, managing their catalog, and delivering them reliably to consumers. Metadata, versions, labels, permissions, and activity history are managed through its own interface and APIs.

The service targets application and content delivery infrastructure: deployment agents, CI/CD pipelines, artifact catalogs, internal tools, and other systems. Depot is deployed and upgraded independently of connected applications.

An initial use case is replacing ProGet for Universal Packages and ordinary files while preserving the HTTP contracts used by existing clients. External applications connect over the network. Their availability must not determine whether Depot can serve packages directly.

## Current status

| Area                                                                   | Status                                                     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| Strict TypeScript, clean boundaries, JS/declaration builds             | Implemented                                                |
| Native upload sessions and idempotent creation/completion              | Implemented                                                |
| PostgreSQL migrations, immutable metadata, labels, repository scopes   | Implemented                                                |
| Local blob storage, streaming SHA-256, publication after verification  | Implemented                                                |
| Service keys, permissions, capacity reservations, transfer admission   | Implemented                                                |
| GET/HEAD, ETag, single Range, conditional downloads                    | Implemented                                                |
| Real PostgreSQL and failure/recovery tests                             | Implemented                                                |
| 5 GiB upload, process restart, full download and checksum verification | Passed locally; see [test report](docs/CORE_VALIDATION.md) |
| ProGet API, UPack manifest/version semantics, mutable catalog, UI/SDK  | Planned                                                    |
| Durable queues, upload resume, GC, distributed delivery, HA            | Planned                                                    |

The runnable role is `apps/api`. Worker, scheduler, web, SDK, and ProGet adapter remain module boundaries. This is a development core, not a production release. [Runbook and implemented API](docs/CORE_RUNBOOK.md) (Russian).

## Planned capabilities

### Packages, files, and catalog

- UPack repositories with groups, names, versions, and original archives preserved during import.
- Ordinary files with directory paths, immutable revisions, and atomic updates of the current revision.
- Schema-based metadata: description, owner, platform, architecture, build/commit, and custom fields.
- Labels, release states, logical collections, filters, and permission-aware search.
- Separate handling of original UPack fields and editable catalog properties.
- Change history and external references that protect artifacts still used by consumers from automatic cleanup.

### Uploads and delivery

- Streaming uploads and downloads with backpressure, cancellation, and bounded buffers.
- Durable multipart upload sessions with size, coverage, and SHA-256 validation.
- GET/HEAD, ETag, Range/If-Range, and download resumption for clients that support it.
- Incomplete or unverified files never appear as published artifacts.
- Downloads remain bound to immutable content even when a file's logical path is updated.

### Queues and networking

- Separate upload, download, and background job queues.
- Priorities, fair allocation across clients, and protection against indefinite waiting.
- Limits on concurrent transfers, bandwidth, staging space, and repository quotas.
- Multiple gateways with admission control and allocated network budgets.
- Controlled migration and replication traffic so background work does not displace operational delivery.

### Security and operations

- Service accounts, repository and action permissions, key rotation, and auditing.
- Short-lived transfer tokens scoped to an object and an action.
- Archive validation, safe paths, and metadata size limits.
- Recovery of intermediate operations, idempotent completion, and integrity checks.
- Metrics, health/readiness endpoints, backups, and tested restoration procedures.

## Architecture

```mermaid
flowchart TD
    EXT[External applications] --> API[Native API and authorization]
    UI[Depot Web UI / CI/CD / SDK] --> API
    LEGACY[ProGet-compatible clients] --> COMPAT[ProGet compatibility adapters]
    COMPAT --> APP[Application use cases]
    API --> APP
    APP --> DOMAIN[Domain rules]
    APP --> PORTS[Application ports]
    PORTS --> DB[(PostgreSQL)]
    PORTS --> BLOBS[(Blob storage)]
    SCHED[Transfer scheduler] --> APP
    WORKER[Background workers] --> APP
    CLIENT[Authorized transfer clients] --> GATEWAY[Transfer gateways]
    GATEWAY --> BLOBS
    GATEWAY --> AUTH[Admission and access verification]
    AUTH --> API
```

This diagram shows component interactions. Source dependency rules are specified separately in [ARCHITECTURE](docs/ARCHITECTURE.md): the domain is independent of infrastructure, the application layer owns ports, adapters implement those ports, and application entry points assemble dependencies.

Large files are transferred directly through delivery gateways and must not accumulate in API memory. One codebase contains multiple runnable roles; a TypeScript package does not imply a separate server.

### Technology direction

| Layer                     | Direction                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------- |
| Language                  | TypeScript with `strict` and additional indexed-access and optional-property checks |
| Runtime                   | Node.js 24 LTS, ESM                                                                 |
| Code organization         | npm workspaces; domain, application, adapters, and composition roots                |
| HTTP API                  | Fastify, implemented for the native core                                            |
| Metadata and durable jobs | PostgreSQL; catalog and migrations implemented                                      |
| Content                   | Local backend implemented; S3 and HA backend planned                                |
| Delivery gateways         | Nginx with validated admission and bandwidth control                                |
| UI                        | TypeScript; framework not yet selected                                              |
| Quality                   | TypeScript, ESLint, Prettier, dependency-cruiser, GitHub Actions                    |

Development tool versions are pinned in manifests and the lockfile. Runtime dependencies are introduced alongside actual use cases.

## Compatibility and integrations

The implemented native API under `/api/v1` covers immutable artifact metadata, upload sessions, cancellation, and content delivery. OpenAPI is served at `/api/v1/openapi.json`. Transfers/jobs, mutable metadata, external references, events, administration, and SDK are planned. Runtime schemas, OpenAPI, and the future SDK must remain consistent.

Planned ProGet adapters target the operations used by clients across three API families:

| API family                   | Purpose                                             |
| ---------------------------- | --------------------------------------------------- |
| `/api/packages/{feed}/...`   | Common package operations                           |
| `/upack/{feed}/...`          | Universal Feed API                                  |
| `/endpoints/{directory}/...` | Files, directories, metadata, and multipart uploads |

Compatibility includes response shapes, authentication, error codes, groups, version ordering, overwrite rules, and HTTP behavior—not just URLs. Coverage will be recorded in a real-client matrix and tested against a separate ProGet test instance.

Native clients will be able to create queued jobs, wait for admission, and resume transfers. A legacy client cannot transparently receive `202 + JSON` instead of file bytes: its validated synchronous contract, timeouts, and retry behavior must be respected.

External applications use the public API; a versioned TypeScript SDK is planned. They do not need shared database access or imports of Depot internals. Webhooks are planned with signatures, retries, and deduplication.

## Reliability and scale

The initial design scenario is approximately **4 TB of data** with files **up to 5 GB**. The 4 TB capacity remains a target. A single 5 GiB transfer and restart have been tested locally; see the validation report. Client concurrency, network capacity, hardware, and recovery objectives still need to be specified.

- **Standalone:** one machine, local storage, and backups; no availability guarantee if that machine fails.
- **Single-site HA:** multiple APIs/gateways, a resilient entry point, HA PostgreSQL, and durable content storage with an agreed write-acknowledgment policy.
- **Multiple sites:** a separate future profile for local delivery, caches, and cross-site replication.

Request balancing does not replace data redundancy. Replication does not replace backups. An active TCP connection breaks if its gateway fails; resumption requires client support. Availability guarantees will be stated only after testing the selected topology.

## Repository layout

```text
apps/
  api/              HTTP API and dependency composition
  worker/           background processing
  scheduler/        transfer scheduling process
  web/              independent Depot interface
packages/
  domain/           pure domain rules and states
  application/      use cases and dependency ports
  contracts/        public API and event schemas
  infrastructure/   database, storage, and external adapters
  proget-compat/    ProGet protocol adapters
  sdk/              public HTTP client
docs/
  adr/              architecture decisions
  templates/        change-description templates
deploy/             future deployment profiles
tests/              future cross-package tests
scripts/            project verification tools
.github/workflows/  GitHub Actions scaffold checks
```

## Development setup

For authorized developers under the proprietary license. Requires Node.js 24 LTS, npm 11, PostgreSQL 18, and a local filesystem supporting hard links. Docker is optional if PostgreSQL is already available.

```sh
git clone https://github.com/ProAnima/Depot.git
cd Depot
npm ci
npm run build
npm run init:local
docker compose --env-file .env -f deploy/compose.dev.yml up -d --wait
npm run migrate
npm start
```

Local initialization generates private credentials under ignored `data/` and `.env`; it refuses to overwrite an existing configuration. The API binds to `127.0.0.1:8080`. Upload from another terminal with `npm run upload -- ./example.upack releases`. The CLI prints an artifact URL; requests require the generated Bearer key.

For an existing database, edit `DEPOT_DATABASE_URL` in `.env` instead of starting Compose. See the [runbook](docs/CORE_RUNBOOK.md) for configuration, permissions, recovery, and network access with TLS.

| Command                    | Purpose                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| `npm run check`            | Formatting, types, ESLint, architecture boundaries                 |
| `npm run build`            | Compile all workspaces to JavaScript and declarations              |
| `npm test`                 | Build and run domain/range/local-storage tests                     |
| `npm run test:integration` | Real PostgreSQL and HTTP tests; requires `DEPOT_TEST_DATABASE_URL` |
| `npm run test:large`       | 5 GiB HTTP upload/download, process restart, hash and RSS checks   |
| `npm run format`           | Apply formatting                                                   |

Current upload retries restart from byte zero. Cancelled sessions retain their storage reservation until a future safe GC. One API process owns a standalone database; this profile provides no node failover. Keep the database and the entire storage directory, including `storage-id`, together in backup/restore procedures.

## Development rules

The main contributor instructions are in [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

- Domain rules do not depend on HTTP, databases, Node globals, or the UI.
- The application layer owns dependency interfaces; adapters provide implementations.
- Cross-package imports use public entries such as `@proanima/depot-domain`.
- External data is validated at runtime; a type assertion is not validation.
- Strict checking must not be weakened, and `any` must not be used to bypass errors.
- Prefer composition and focused use cases; introduce abstractions for concrete needs.
- Transfers require bounded buffers, cancellation, idempotency, and partial-failure handling.
- Significant contract, durability, and boundary changes are recorded in ADRs.

The Node.js test runner covers the first working scenarios. Static checks alone do not establish storage durability or availability.

## Implementation roadmap

1. Inventory ProGet behavior and clients; define required contracts and infrastructure.
2. Implement a vertical transfer slice: publish, store, verify, and download 5 GB; test restart and Range.
3. Add catalog metadata, labels/collections, revisions, permissions, audit, and UI.
4. Implement durable queues, quotas, fairness, and multiple gateways.
5. Deliver ProGet compatibility, SDK, and network integrations for external clients.
6. Test HA, backup/restore, and failure scenarios.
7. Perform resumable migration, a pilot, final synchronization, cutover, and rollback validation.

Full stage criteria are in [ROADMAP](docs/ROADMAP.md). The first standalone transfer scenario is implemented; distributed delivery and protocol compatibility remain separate milestones.

## Documentation

The English and Russian READMEs describe the same product scope. Detailed engineering documents are currently maintained in Russian; the proprietary license and attribution notice are in English.

| Document                                     | Contents                                              |
| -------------------------------------------- | ----------------------------------------------------- |
| [CORE_RUNBOOK](docs/CORE_RUNBOOK.md)         | Running the native core, API, configuration, recovery |
| [CORE_VALIDATION](docs/CORE_VALIDATION.md)   | Measured standalone test results and limitations      |
| [PROJECT_PLAN](docs/PROJECT_PLAN.md)         | Detailed product and technical plan                   |
| [ARCHITECTURE](docs/ARCHITECTURE.md)         | Layers and allowed dependencies                       |
| [DOMAIN_MODEL](docs/DOMAIN_MODEL.md)         | Domain entities and invariants                        |
| [API_CONTRACTS](docs/API_CONTRACTS.md)       | Native API, SDK, and ProGet compatibility             |
| [RELIABILITY](docs/RELIABILITY.md)           | Writes, queues, networking, degradation, and recovery |
| [TESTING](docs/TESTING.md)                   | Functional and failure-testing strategy               |
| [CI](docs/CI.md)                             | Current GitHub Actions checks                         |
| [BOOTSTRAP_CHECKS](docs/BOOTSTRAP_CHECKS.md) | Validation of the initial scaffold                    |
| [ROADMAP](docs/ROADMAP.md)                   | Stages and open decisions                             |
| [ADR](docs/adr/README.md)                    | Architecture decision history                         |
| [SECURITY](SECURITY.md)                      | Security requirements                                 |
| [LICENSING](docs/LICENSING.md)               | Ownership and partner licensing model                 |

## License and ownership

**Copyright © 2026 Ian Panaev. All rights reserved.**

ProAnima Depot is proprietary software. Ian Panaev is its author, copyright holder, and owner of the ProAnimaStudio brand. Rights to use, modify, distribute, or maintain private forks are granted to specifically authorized organizations only through separate written agreements with the rights holder, subject to applicable law and other validly granted rights.

Repository access does not replace such an agreement. Permission scope, ownership of modifications, binary distribution, and use of branding are agreed separately. The original source code is not released under MIT, Apache, GPL, or another open-source license.

Repository terms: [LICENSE.md](LICENSE.md). Attribution: [NOTICE.md](NOTICE.md). Third-party components retain their own licenses.
