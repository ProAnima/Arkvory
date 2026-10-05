---
title: Stages and promotion
description: Mark builds with stages, promote them to another repository, and let a deployment agent pick the newest build of a stage.
---

# Stages and promotion

A build goes from CI to production in steps: tested, approved, released. Arkvory has two tools for this. A **stage** is a mark on a build, such as `qa` or `release`. **Promotion** publishes a build in another repository without sending the bytes again. Use either, or both together.

## Stages and repositories {#concepts}

- A **stage** says where a build is approved. A build may have several stages, up to 16. Stages belong to a build in one repository. Only the stage operations change them, and every change goes into a journal with the author and an optional comment.
- A **promotion** copies or moves a build from one repository to another, for example from `dev` to `staging` to `prod`. The copy is a new artifact in the target. No bytes are uploaded.
- A **label** is only a free tag with no history. A stage is the controlled mark that a deployment can rely on. See [Files by path](./files#labels).

A stage name has 1 to 32 characters: lowercase letters, digits, `.`, `_` or `-`, starting with a letter or a digit. A build with a stage cannot be deleted, and retention keeps it. Remove the stage first.

## Add and remove stages {#stages}

In the console, open the artifact in [[ui:metadata]]. The section [[ui:promotionTitle]] shows [[ui:stagesTitle]] with the stages of the build. Enter a [[ui:stageName]] and, if you like, a [[ui:stageComment]], then select [[ui:stageAdd]]. Each stage has a button to remove it, and the console asks to confirm: deployments that ask for this stage will pick another version.

The stages also show in the catalog, as chips in each row, and in the column [[ui:packageStages]] of [[ui:packages]].

```bash
arkvoryctl stages add 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 qa --comment "smoke passed" --repository dev
arkvoryctl stages list 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository dev
arkvoryctl stages remove 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 qa --repository dev
arkvoryctl stages artifacts --stage release --repository prod
```

`stages artifacts` lists every build that has a stage, or one stage, 100 at a time. Pass `next` as `--after`.

With the API:

```bash
curl -X PUT "$ARKVORY/api/v1/repositories/dev/artifacts/$ID/stages/qa" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"comment":"smoke passed"}'
curl -X DELETE "$ARKVORY/api/v1/repositories/dev/artifacts/$ID/stages/qa" \
  -H "Authorization: Bearer $ARKVORY_KEY"
```

```typescript
await dev.stages.add(id, 'qa', 'smoke passed');
const { items } = await prod.stages.artifacts({ stage: 'release' });
```

The operations are `setArtifactStage`, `removeArtifactStage`, `listArtifactStages` and `listStagedArtifacts`. Adding a stage that is already there changes nothing: the first time and comment stay. Removing a stage that is not there succeeds. A build with 16 stages refuses another with `409 stage_limit`.

## Promote to another repository {#promote}

In the console, open the artifact. The form [[ui:promoteTitle]] appears when you may read the build and may promote into at least one other repository. Choose the [[ui:promoteTarget]] from those repositories. Enter the [[ui:promoteStages]] to set in the target, separated by commas, and a [[ui:promoteComment]]. Select [[ui:promoteSubmit]]. If no other repository allows it, the console says [[ui:promoteNoTargets]].

```bash
arkvoryctl promote 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository staging --to prod --stage release --comment CAB-142
arkvoryctl promote 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository staging --to prod --move
```

`--repository` is the source, `--to` the target. The result has the target `repository`, the new `artifactId`, the `sourceArtifactId`, the `mode`, `created` and the `stages`.

```bash
curl -X POST "$ARKVORY/api/v1/repositories/staging/artifacts/$ID/promote" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"target":"prod","mode":"copy","stages":["release"],"comment":"CAB-142"}'
```

```typescript
await staging.promotions.promote(id, { target: 'prod', mode: 'copy', stages: ['release'] });
```

The answer is `201` for a new copy and `200` when the target already had it. The operation is `promoteArtifact`.

### Copy or move {#copy-move}

|                      | Copy (default)     | Move                                                                                                       |
| -------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| Source               | Stays              | Is removed in the same step as the copy is published                                                       |
| Stages of the source | Stay on the source | Pass to the copy, besides the stages you give                                                              |
| In the console       |                    | Tick [[ui:promoteMove]]. The console asks for confirmation                                                 |
| Blocked when         |                    | The source is still used by an external reference, a file path or an attachment link. Nothing is published |

What the copy gets and what it does not:

- It gets the labels, metadata and collections of the source, its UPack identity and the stages you give. It is a new artifact with a new ID. Its SHA-256 is the same.
- It gets no attachments and no path pointers. Link them again in the target.
- No bytes are uploaded. On the same server the stored file is shared until the last artifact that uses it is gone.
- It counts against the quota of the target like a new upload.
- Repeating a promotion returns the same copy. If the target already has a package with the same group, name, version and checksum, that artifact is returned. With different bytes the server answers `409 version_exists`.
- The target must differ from the source. A mirror cannot be a target, because it is read-only. See [Repositories](./repositories#read-only).

An interrupted promotion leaves a short-lived reservation. Run the same promotion again as the same account to continue.

## Promotion history {#history}

The artifact page in the console shows [[ui:promotionHistory]], oldest first: who added or removed a stage, who copied or moved the build to another repository, and where a received copy came from. [[ui:promotionMore]] loads the next entries.

```bash
arkvoryctl promotions history 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository prod
arkvoryctl promotions journal --repository prod --after 120 --json
```

The journal of a repository is for CI. Poll it with the last `sequence` you saw as `--after`, and you get the new events in order. An event has a `sequence`, the `action` (`stage.added`, `stage.removed`, `promoted` or `received`), the `stage`, the `mode`, the peer repository and artifact, the `actor`, the `comment` and the time. Pages hold up to 100 events. The operations are `listArtifactPromotions` and `listRepositoryPromotions`.

## Pick a build for deployment {#resolve}

A deployment agent asks for "the newest build of the package `app` that is in the range `^1.4` and has the stage `release`". Arkvory answers with exactly one version, or with `404` if there is none.

```bash
arkvoryctl packages resolve app --group acme/game --range ^1.4 --stage release --repository prod --json
arkvoryctl packages download app ./app.upack --group acme/game --range ^1.4 --stage release --repository prod
```

`resolve` prints the choice without downloading it:

```json
{
  "group": "acme/game",
  "name": "app",
  "version": "1.4.7",
  "artifactId": "3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11",
  "sha256": "…",
  "size": "73400320",
  "publishedAt": "2026-10-01T09:30:00.000Z",
  "stagedAt": "2026-10-02T12:00:00.000Z",
  "stages": ["qa", "release"]
}
```

With HTTP, `resolvePackage` returns this, and `downloadPackageContent` sends the bytes of the same choice in one call:

```bash
curl -fL -G -H "Authorization: Bearer $DEPLOY_KEY" -o app.upack \
  --data-urlencode "name=app" --data-urlencode "group=acme/game" \
  --data-urlencode "range=^1.4" --data-urlencode "stage=release" \
  "$ARKVORY/api/v1/repositories/prod/packages/content"
```

```typescript
const found = await prod.packages.resolve({ name: 'app', range: '^1.4', stage: 'release' });
```

The filters are the same in every tool: the package `name`, the `group` (empty if the package has none), an exact version or a range, the `stage`, whether to include prereleases and the order. Ranges are explained in [UPack packages](./packages#versions).

By default the newest SemVer version wins. With `--order promoted` (`order=promoted` in HTTP) the version that was staged last wins, even if its number is lower. This needs a stage.

The name is resolved on every request, so two calls may return different builds when someone promotes in between. For a download that must resume, take the `artifactId` from `resolve` and download that.

## Roll back {#rollback}

With the order `promoted`, a rollback is an ordinary step. Remove the stage from the faulty version, and the version staged before it becomes the choice. To make an older version current again, remove its stage and add it once more: adding a stage that is already there does not renew its time.

```bash
arkvoryctl stages remove <faulty artifact id> release --repository prod
arkvoryctl packages download app ./app.upack --stage release --order promoted --repository prod
```

## Permissions {#permissions}

| Action                                 | Keys: repository actions                                               | People: group access                    |
| -------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------- |
| Read stages and the history of a build | `artifact.read`                                                        | Read                                    |
| List staged builds and the journal     | `artifact.list`                                                        | Read                                    |
| Add or remove a stage                  | `artifact.promote` with `artifact.read`                                | Write                                   |
| Promote with copy                      | Source: `artifact.read` and `content.read`. Target: `artifact.promote` | Read on the source, write on the target |
| Promote with move                      | The same, and `artifact.promote` on the source                         | Write on both                           |
| Resolve a version                      | `package.read`                                                         | Read                                    |
| Download the chosen version by name    | `content.read`                                                         | Read                                    |

A key for a deployment agent that only downloads needs `content.read` in the repository it reads. For `arkvoryctl packages download` it also needs `package.read` and `artifact.read`. See [Permissions](./accounts#permissions).

Servers can also exchange builds on their own: a repository can import, from a repository of another server, the versions that carry certain stages. See [Mirrors](../operate/mirrors).

## Related pages {#related-pages}

- [UPack packages](./packages) and [Repositories](./repositories)
- [Accounts and access](./accounts)
- [Command line (arkvoryctl)](../protocols/cli#packages-and-promotion)
- API reference: [Stages and promotion](../api/reference/promotion)
