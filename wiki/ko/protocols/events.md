---
title: '이벤트'
description: '커서 하나로 설치의 모든 변경을 따라갑니다: CloudEvents, 권한, 보관 기간, 재동기화.'
---

# 이벤트

이벤트 피드는 외부 시스템에 설치 전체에서 무엇이 바뀌었는지 알려 줍니다. 게시, 삭제, 파일 경로, 패키지 등록, 어노테이션, 첨부 파일, 스테이지, 승격, 컨테이너 이미지, npm, Git LFS가 포함됩니다. 읽을 수 있는 모든 리포지토리를 아우르는 하나의 순서 있는 스트림이며 형식은 [CloudEvents 1.0](https://cloudevents.io)입니다. `arkvoryctl events tail`, [TypeScript SDK](./sdk) 또는 `GET /api/v1/events`로 읽습니다.

이벤트는 무언가 바뀌었다는 힌트입니다. 현재 상태는 일반 API로 읽고, 같은 이벤트가 반복되어도 문제가 없도록 처리하세요.

## 피드 읽기 {#read}

```bash
arkvoryctl events tail --cursor-file ./arkvory.cursor
```

이 명령은 한 줄에 이벤트 하나씩 JSON으로 출력하고, 이벤트마다 위치를 `--cursor-file`에 저장합니다. 다시 실행하면 멈춘 곳부터 이어 갑니다. `--follow`를 붙이면 Ctrl+C를 누를 때까지 새 이벤트를 기다립니다. `--types artifact.*,stage.added`는 지정한 유형이나 접두사만, `--repository releases`는 리포지토리 하나만 남기고, `--after <id>`는 지정한 이벤트 다음부터 시작합니다.

TypeScript에서 `follow`는 페이지를 차례로 읽고, 처리한 이벤트마다 `save`를 호출합니다.

```ts
for await (const event of client.events.follow({ after: saved, save: (cursor) => store(cursor) })) {
  await handle(event);
}
```

HTTP로:

```bash
curl -H "Authorization: Bearer $ARKVORY_TOKEN" \
  "https://arkvory.example.com/api/v1/events?limit=100&types=artifact.*"
```

응답에는 `items`, `next`, `head`, `oldest`, `epoch`가 들어 있습니다. 다음 요청에서 `next`를 `after`로 전달하세요. `after`가 없으면 서버가 보관하는 가장 오래된 이벤트부터 시작합니다. 요청 하나는 최대 `limit`개(1–500, 기본 100)의 이벤트를 반환합니다. 이벤트가 `limit`개보다 적다고 끝은 아닙니다. 요청 하나는 최대 5000개의 이벤트를 살펴보므로, `next`의 위치가 `head`와 같을 때 모두 읽은 것입니다. [listEvents](../api/reference/events#listEvents)를 참고하세요.

## 이벤트 {#event}

```json
{
  "specversion": "1.0",
  "id": "0f7d8e3c-1d2b-4a5c-9e8f-0a1b2c3d4e5f:42",
  "source": "/arkvory/studio/repositories/releases",
  "type": "arkvory.artifact.published.v1",
  "subject": "9a7b6c5d-4e3f-4a1b-8c2d-1e0f9a8b7c6d",
  "time": "2026-10-17T09:30:00.000Z",
  "datacontenttype": "application/json",
  "dataschema": "urn:arkvory:event:artifact.published:1",
  "partitionkey": "repository:releases",
  "arkvoryposition": "42",
  "arkvoryepoch": "0f7d8e3c-1d2b-4a5c-9e8f-0a1b2c3d4e5f",
  "data": {
    "repository": "releases",
    "artifactId": "9a7b6c5d-4e3f-4a1b-8c2d-1e0f9a8b7c6d",
    "name": "game.upack",
    "size": "73400320",
    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "labels": ["ci"],
    "stages": []
  }
}
```

- 같은 이벤트가 반복될 때마다 `id`는 같습니다. 이것으로 중복을 제거하세요.
- `data`에는 아티팩트의 식별자와 사실이 들어 있습니다. 이름, 10진수 문자열로 된 크기, SHA-256, 이벤트 시점의 레이블과 스테이지, UPack 패키지입니다. 파일, 스테이지, 이미지, npm, Git LFS 이벤트에는 경로, 스테이지, digest나 tag가 붙은 이미지, npm 패키지 또는 객체 ID가 추가됩니다.
- 메타데이터 값, 변경한 사용자, 비밀 값, 파일 내용은 이벤트에 절대 들어가지 않습니다. 레이블 때문에 `data`가 8 KiB를 넘게 되면 레이블을 빼고 `truncated`를 `true`로 둡니다.
- `GET /api/v1/events/types`는 모든 유형과 그 `data`의 JSON Schema를 나열합니다.

| 그룹            | 유형                                                                                |
| --------------- | ----------------------------------------------------------------------------------- |
| 아티팩트        | `artifact.published`, `artifact.deleted`, `artifact.promoted`, `artifact.received`  |
| 파일과 패키지   | `asset.revision.created`, `asset.restored`, `package.registered`                    |
| 설명            | `annotation.updated`, `attachments.updated`, `stage.added`, `stage.removed`         |
| 컨테이너 이미지 | `oci.manifest.pushed`, `oci.manifest.deleted`, `oci.tag.updated`, `oci.tag.deleted` |
| npm과 Git LFS   | `npm.version.published`, `npm.tag.updated`, `npm.tag.deleted`, `lfs.object.stored`  |

## 순서와 권한 {#order}

- 한 리포지토리의 이벤트는 변경이 커밋된 순서대로 옵니다(`partitionkey`). 리포지토리 사이에서 위치는 이벤트가 보이게 된 순서를 나타낼 뿐 인과 관계를 뜻하지 않습니다.
- 위치는 커지지만 번호를 건너뛸 수 있습니다. 연속된다고 기대하지 마세요.
- 이벤트는 변경 후 약 0.5초 뒤, worker가 번호를 매기면 피드에 나타납니다. worker가 멈춰 있는 동안 이벤트는 기다리며 사라지지 않습니다.
- 키나 계정에 `artifact.list` 권한이 있는 리포지토리의 이벤트를 볼 수 있습니다. [변경 피드](../api/reference/artifacts#listCatalogChanges)와 같은 권한입니다. 권한은 요청마다 확인하므로 권한을 회수하면 이벤트가 즉시 숨겨집니다.
- `next`는 볼 수 없는 이벤트도 지나가며(요청당 최대 5000개) 권한이 좁은 키도 제자리에 머물지 않습니다. 그 위치에 서버의 다른 이벤트가 있었다는 사실만 알려 줍니다.

## 보관 기간과 복원 {#retention}

서버는 이벤트를 168시간, 최대 5 000 000개까지 보관합니다(`ARKVORY_EVENTS_RETENTION_HOURS`, `ARKVORY_EVENTS_MAX_ROWS`, [환경 변수](../reference/environment) 참고). 피드는 기록이 아니라 창입니다. 기록은 카탈로그 감사가 보관합니다. 이벤트는 백업에 포함되지 않습니다.

| 응답                                   | 일어난 일                                                   | 할 일                                                     |
| -------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| `410`, `gone/events_cursor_expired`    | 커서가 `oldest`보다 오래되었습니다                          | API로 현재 상태를 읽은 뒤 `oldest`부터 계속하세요         |
| `409`, `conflict/events_epoch_changed` | 서버가 백업에서 복원되어 위치가 새 `epoch`로 시작되었습니다 | 현재 상태를 읽은 뒤 커서 없이 또는 새 헤드부터 계속하세요 |

두 응답 모두 `events`에 현재 `epoch`, `oldest`, `head`를 담습니다. 커서는 `<epoch>:<position>`입니다. `arkvoryctl events tail`은 종료 코드 6으로 끝나고, SDK는 같은 필드를 가진 오류를 던집니다.

## 웹훅 {#webhooks}

[웹훅](./webhooks)은 여전히 리포지토리 하나의 변경 피드를 HTTP 주소로 보냅니다. 이벤트 피드는 웹훅을 대체하지 않습니다.
