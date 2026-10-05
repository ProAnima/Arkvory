---
title: 스테이지 및 승격
description: 빌드에 스테이지를 표시하고 다른 리포지토리로 승격하며, 배포 에이전트가 스테이지의 최신 빌드를 선택하도록 합니다.
---

# 스테이지 및 승격

빌드는 CI에서 프로덕션까지 여러 단계를 거칩니다: 테스트, 승인, 릴리스. Arkvory에는 이를 위한 두 가지 도구가 있습니다. **스테이지**는 `qa` 또는 `release`처럼 빌드에 붙는 표시입니다. **승격**은 바이트를 다시 보내지 않고 다른 리포지토리에 빌드를 게시합니다. 둘 중 하나만 사용하거나 함께 사용할 수 있습니다.

## 스테이지와 리포지토리 {#concepts}

- **스테이지**는 빌드가 어디에서 승인되었는지를 나타냅니다. 빌드에는 최대 16개까지 여러 스테이지를 둘 수 있습니다. 스테이지는 한 리포지토리의 빌드에 속합니다. 스테이지 작업만이 스테이지를 변경하며, 모든 변경은 작성자와 선택적 주석이 포함된 저널에 기록됩니다.
- **승격**은 빌드를 한 리포지토리에서 다른 리포지토리로 복사하거나 이동합니다. 예를 들어 `dev`에서 `staging`을 거쳐 `prod`로 이동합니다. 복사본은 대상 리포지토리의 새 아티팩트입니다. 바이트는 업로드되지 않습니다.
- **레이블**은 기록이 없는 자유 태그일 뿐입니다. 스테이지는 배포가 신뢰할 수 있는 통제된 표시입니다. [경로 기반 파일](./files#labels)을 참조하세요.

스테이지 이름은 1~32자이며, 영문 소문자, 숫자, `.`, `_` 또는 `-`를 사용하고 문자 또는 숫자로 시작합니다. 스테이지가 있는 빌드는 삭제할 수 없으며 보존 대상에 포함됩니다. 먼저 스테이지를 제거하세요.

## 스테이지 추가 및 제거 {#stages}

콘솔에서 [[ui:metadata]]에서 아티팩트를 엽니다. [[ui:promotionTitle]] 섹션에는 빌드의 스테이지와 함께 [[ui:stagesTitle]]가 표시됩니다. [[ui:stageName]]을 입력하고 원한다면 [[ui:stageComment]]도 입력한 다음 [[ui:stageAdd]]를 선택합니다. 각 스테이지에는 제거 버튼이 있으며, 콘솔이 확인을 요청합니다: 이 스테이지를 요청하는 배포는 다른 버전을 선택하게 됩니다.

스테이지는 카탈로그에서도 각 행의 칩으로 표시되며, [[ui:packages]]의 [[ui:packageStages]] 열에도 표시됩니다.

```bash
arkvoryctl stages add 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 qa --comment "smoke passed" --repository dev
arkvoryctl stages list 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository dev
arkvoryctl stages remove 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 qa --repository dev
arkvoryctl stages artifacts --stage release --repository prod
```

`stages artifacts`는 스테이지가 있는 모든 빌드 또는 특정 스테이지 하나를 한 번에 100개씩 나열합니다. `next`를 `--after`로 전달하세요.

API를 사용하는 경우:

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

작업은 `setArtifactStage`, `removeArtifactStage`, `listArtifactStages`, `listStagedArtifacts`입니다. 이미 있는 스테이지를 추가해도 아무것도 바뀌지 않습니다: 처음 추가한 시각과 주석이 유지됩니다. 없는 스테이지를 제거해도 성공합니다. 스테이지가 16개인 빌드에 다른 스테이지를 추가하면 `409 stage_limit`으로 거부됩니다.

## 다른 리포지토리로 승격 {#promote}

콘솔에서 아티팩트를 엽니다. 빌드를 읽을 수 있고 하나 이상의 다른 리포지토리로 승격할 수 있으면 [[ui:promoteTitle]] 양식이 나타납니다. 해당 리포지토리에서 [[ui:promoteTarget]]를 선택합니다. 대상에 설정할 [[ui:promoteStages]]를 쉼표로 구분하여 입력하고 [[ui:promoteComment]]를 입력합니다. [[ui:promoteSubmit]]를 선택합니다. 허용되는 다른 리포지토리가 없으면 콘솔에 [[ui:promoteNoTargets]]가 표시됩니다.

```bash
arkvoryctl promote 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository staging --to prod --stage release --comment CAB-142
arkvoryctl promote 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository staging --to prod --move
```

`--repository`는 원본이고 `--to`는 대상입니다. 결과에는 대상 `repository`, 새 `artifactId`, `sourceArtifactId`, `mode`, `created`, `stages`가 포함됩니다.

```bash
curl -X POST "$ARKVORY/api/v1/repositories/staging/artifacts/$ID/promote" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"target":"prod","mode":"copy","stages":["release"],"comment":"CAB-142"}'
```

```typescript
await staging.promotions.promote(id, { target: 'prod', mode: 'copy', stages: ['release'] });
```

응답은 새 복사본이면 `201`, 대상에 이미 있었으면 `200`입니다. 작업은 `promoteArtifact`입니다.

### 복사 또는 이동 {#copy-move}

|                 | 복사(기본값) | 이동                                                                                               |
| --------------- | ------------ | -------------------------------------------------------------------------------------------------- |
| 원본            | 유지됨       | 복사본이 게시되는 같은 단계에서 제거됨                                                             |
| 원본의 스테이지 | 원본에 남음  | 직접 지정한 스테이지 외에도 복사본으로 전달됨                                                      |
| 콘솔            |              | [[ui:promoteMove]]를 선택합니다. 콘솔이 확인을 요청합니다                                          |
| 차단되는 경우   |              | 원본이 외부 참조, 파일 경로 또는 첨부 파일 링크에서 아직 사용 중입니다. 아무것도 게시되지 않습니다 |

복사본이 얻는 것과 얻지 못하는 것:

- 원본의 레이블, 메타데이터, 컬렉션, UPack 정체성, 그리고 직접 지정한 스테이지를 얻습니다. 새 ID를 가진 새 아티팩트입니다. SHA-256은 동일합니다.
- 첨부 파일과 경로 포인터는 얻지 못합니다. 대상에서 다시 연결하세요.
- 바이트는 업로드되지 않습니다. 같은 서버에서는 저장된 파일을 사용하는 마지막 아티팩트가 사라질 때까지 파일이 공유됩니다.
- 대상의 할당량에 새 업로드와 마찬가지로 계산됩니다.
- 승격을 반복하면 같은 복사본이 반환됩니다. 대상에 같은 그룹, 이름, 버전, 체크섬을 가진 패키지가 이미 있으면 그 아티팩트가 반환됩니다. 바이트가 다르면 서버가 `409 version_exists`로 응답합니다.
- 대상은 원본과 달라야 합니다. 미러는 읽기 전용이므로 대상이 될 수 없습니다. [리포지토리](./repositories#read-only)를 참조하세요.

중단된 승격은 수명이 짧은 예약을 남깁니다. 계속하려면 같은 계정으로 같은 승격을 다시 실행하세요.

## 승격 기록 {#history}

콘솔의 아티팩트 페이지에는 [[ui:promotionHistory]]가 오래된 것부터 표시됩니다: 누가 스테이지를 추가하거나 제거했는지, 누가 빌드를 다른 리포지토리로 복사하거나 이동했는지, 받은 복사본이 어디에서 왔는지입니다. [[ui:promotionMore]]는 다음 항목을 불러옵니다.

```bash
arkvoryctl promotions history 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository prod
arkvoryctl promotions journal --repository prod --after 120 --json
```

리포지토리의 저널은 CI를 위한 것입니다. 마지막으로 본 `sequence`를 `--after`로 전달하여 폴링하면 새 이벤트를 순서대로 받습니다. 이벤트에는 `sequence`, `action`(`stage.added`, `stage.removed`, `promoted` 또는 `received`), `stage`, `mode`, 상대 리포지토리와 아티팩트, `actor`, `comment`, 시각이 있습니다. 페이지에는 최대 100개의 이벤트가 들어 있습니다. 작업은 `listArtifactPromotions`와 `listRepositoryPromotions`입니다.

## 배포할 빌드 선택 {#resolve}

배포 에이전트는 "`^1.4` 범위에 있고 `release` 스테이지를 가진 패키지 `app`의 최신 빌드"를 요청합니다. Arkvory는 정확히 하나의 버전으로 응답하거나, 없으면 `404`로 응답합니다.

```bash
arkvoryctl packages resolve app --group acme/game --range ^1.4 --stage release --repository prod --json
arkvoryctl packages download app ./app.upack --group acme/game --range ^1.4 --stage release --repository prod
```

`resolve`는 다운로드하지 않고 선택 결과를 출력합니다:

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

HTTP에서는 `resolvePackage`가 이 결과를 반환하고, `downloadPackageContent`가 같은 선택의 바이트를 한 번의 호출로 전송합니다:

```bash
curl -fL -G -H "Authorization: Bearer $DEPLOY_KEY" -o app.upack \
  --data-urlencode "name=app" --data-urlencode "group=acme/game" \
  --data-urlencode "range=^1.4" --data-urlencode "stage=release" \
  "$ARKVORY/api/v1/repositories/prod/packages/content"
```

```typescript
const found = await prod.packages.resolve({ name: 'app', range: '^1.4', stage: 'release' });
```

필터는 모든 도구에서 동일합니다: 패키지 `name`, `group`(패키지에 없으면 비어 있음), 정확한 버전 또는 범위, `stage`, 프리릴리스 포함 여부, 정렬 순서입니다. 범위는 [UPack 패키지](./packages#versions)에서 설명합니다.

기본적으로 최신 SemVer 버전이 선택됩니다. `--order promoted`(HTTP에서는 `order=promoted`)를 사용하면 스테이지가 마지막으로 설정된 버전이 번호가 더 낮더라도 선택됩니다. 이 옵션을 사용하려면 스테이지가 필요합니다.

이름은 요청할 때마다 확인되므로, 그사이 누군가 승격하면 두 호출이 서로 다른 빌드를 반환할 수 있습니다. 재개해야 하는 다운로드의 경우 `resolve`에서 `artifactId`를 가져와 그것을 다운로드하세요.

## 롤백 {#rollback}

`promoted` 순서에서는 롤백이 일반적인 단계입니다. 문제가 있는 버전에서 스테이지를 제거하면 그 이전에 스테이지가 설정된 버전이 선택됩니다. 이전 버전을 다시 현재 버전으로 만들려면 해당 스테이지를 제거했다가 다시 추가하세요: 이미 있는 스테이지를 추가해도 시각은 갱신되지 않습니다.

```bash
arkvoryctl stages remove <faulty artifact id> release --repository prod
arkvoryctl packages download app ./app.upack --stage release --order promoted --repository prod
```

## 권한 {#permissions}

| 작업                                  | 키: 리포지토리 작업                                              | 사용자: 그룹 액세스                |
| ------------------------------------- | ---------------------------------------------------------------- | ---------------------------------- |
| 빌드의 스테이지와 기록 읽기           | `artifact.read`                                                  | 읽기                               |
| 스테이지가 있는 빌드 목록과 저널 보기 | `artifact.list`                                                  | 읽기                               |
| 스테이지 추가 또는 제거               | `artifact.promote`와 `artifact.read`                             | 쓰기                               |
| 복사로 승격                           | 원본: `artifact.read`와 `content.read`. 대상: `artifact.promote` | 원본에 대한 읽기, 대상에 대한 쓰기 |
| 이동으로 승격                         | 위와 같고, 원본에 `artifact.promote`                             | 양쪽 모두에 대한 쓰기              |
| 버전 확인                             | `package.read`                                                   | 읽기                               |
| 이름으로 선택한 버전 다운로드         | `content.read`                                                   | 읽기                               |

다운로드만 하는 배포 에이전트의 키에는 읽는 리포지토리에 대한 `content.read`가 필요합니다. `arkvoryctl packages download`의 경우 `package.read`와 `artifact.read`도 필요합니다. [권한](./accounts#permissions)을 참조하세요.

서버끼리도 빌드를 주고받을 수 있습니다: 리포지토리는 다른 서버의 리포지토리에서 특정 스테이지를 가진 버전을 가져올 수 있습니다. [미러](../operate/mirrors)를 참조하세요.

## 관련 페이지 {#related-pages}

- [UPack 패키지](./packages) 및 [리포지토리](./repositories)
- [계정 및 액세스](./accounts)
- [명령줄(arkvoryctl)](../protocols/cli#packages-and-promotion)
- API 참조: [스테이지 및 승격](../api/reference/promotion)
