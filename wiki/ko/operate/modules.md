---
title: 모듈
description: 호스트에 서명된 모듈 패키지를 설치하고 활성화하고 확인하고 제거하며, 신뢰하는 플러그인 작성자의 키를 관리합니다.
---

# 모듈

모듈 패키지는 Arkvory에 기능을 추가합니다. Arkvory는 서명을 검증할 수 있는 패키지만 설치합니다. 이 페이지의 명령은 설치가 있는 호스트에서 Linux에서는 root로, Windows에서는 관리자로 실행합니다. 콘솔과 HTTP API는 모듈을 설치하거나 키를 신뢰할 수 없으므로, 도난당한 콘솔 관리자 계정으로는 서버에서 코드를 실행할 수 없습니다.

서비스는 시작할 때마다 설치된 모듈을 다시 확인하고 로드합니다. 모듈은 활성화한 뒤에만 실행됩니다.

## 패키지 설치 {#install}

1. 패키지 파일 `arkvory-module-<id>-<version>.tgz`를 호스트에 복사합니다.
2. 패키지를 확인하고 약관을 읽습니다.

   ```bash
   sudo arkvory module install /root/arkvory-module-sample-1.0.0.tgz --root /opt/proanima-arkvory
   ```

   명령은 모듈, 역할, 모듈이 보관하는 데이터, 서명 키, 패키지의 SHA-256을 보여 주고 이어서 모듈의 약관을 보여 줍니다. 아직 아무것도 바뀌지 않습니다.

3. 설치합니다.

   ```bash
   sudo arkvory module install /root/arkvory-module-sample-1.0.0.tgz --root /opt/proanima-arkvory --yes
   ```

Arkvory는 다음 경우 패키지를 거부합니다.

| 이유                                                                   | 메시지의 코드                                                  |
| ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| 서명이 ProAnimaStudio 모듈 키로 만든 것이 아니거나 매니페스트가 변경됨 | `unknown_key`, `wrong_key_class`, `signature_invalid`          |
| 파일이 없거나 변경되었거나 매니페스트에 없음                           | `file_missing`, `file_mismatch`, `file_unlisted`               |
| 아카이브에 링크, 장치, 패키지 밖 경로 또는 대소문자만 다른 이름이 있음 | `link_entry`, `special_entry`, `unsafe_path`, `case_collision` |
| 아카이브에 네이티브 애드온(`.node`)이 있음                             | `native_addon`                                                 |
| 모듈에 다른 버전의 Arkvory가 필요함                                    | `module_incompatible`                                          |
| ProAnimaStudio가 이 버전을 폐기함                                      | `module_revoked`, 대체 버전과 함께                             |
| 현재 유효한 폐기 목록이 없음(아래 참조)                                | `stale_revocations`                                            |

제한: 패키지당 1 GiB, 파일당 256 MiB, 파일 4096개. 더 큰 패키지는 데이터를 읽기 전에 거부됩니다.

같은 바이트로 이미 설치된 버전은 그대로 둡니다. 같은 버전이지만 바이트가 다르면 거부됩니다.

## 모듈 활성화와 로드 {#load}

설치된 모듈은 활성화하기 전까지 비활성 상태로 남습니다. 서비스는 시작할 때만 모듈을 로드합니다.

1. 모듈 파일(`ARKVORY_MODULES_FILE`, [환경 변수](../reference/environment#core) 참고)에 모듈을 추가합니다. 모듈 설정은 `config`에 넣습니다.

   ```json
   { "format": 1, "modules": { "sample": { "enabled": true } } }
   ```

2. 모듈이 파일을 보관한다면 `resources`로 데이터 디렉터리의 크기를 승인합니다. 예를 들어 `enabled` 옆에 `"resources": { "dataMiB": 512, "dataFiles": 10000 }`을 둡니다. 이 값은 패키지가 요청하는 크기를 대체합니다. [모듈의 데이터 디렉터리](#data)를 참고하세요.
3. [변경 사항 적용](../install/configuration#apply-change)과 같이 서비스를 다시 시작합니다.
4. 전역 관리자로 모듈을 확인합니다. `GET /api/v1/system/modules`는 API와 각 읽기 게이트웨이에서 모듈을 `running: true`, `health.status` `ok`로 보여 줍니다.

서명된 모듈은 선언한 역할에 따라 API, 읽기 게이트웨이, worker 및 백업 에이전트에서 실행됩니다. 각 프로세스는 해당 역할에 제공되며 `uses`에 선언된 서비스만 전달합니다. 라우트에는 `routes`가 필요합니다. Docker Compose는 아직 모듈을 로드하지 않습니다.

모듈 스토리지는 `<module>.<name>`으로 등록되며 새 업로드 대상으로 선택할 수 있습니다. 쓰기 수락을 중단하면 새 업로드는 `default`를 사용합니다. 코어는 조각에서 구성된 객체를 게시하기 전에 전체 바이트를 검증합니다. 데이터 정리는 활성 읽기, 모든 백업 고정 및 캡처 장벽이 해제될 때까지 기다립니다. 계산은 제한된 스레드에서 실행됩니다. 구독은 처리 성공 후 이벤트를 확인하며 실패 후 다시 전달할 수 있습니다.

서비스는 모듈의 코드를 가져오기 전에 패키지를 다시 확인합니다.

1. 설치 디렉터리, `modules/`, 모듈 집합, 폐기 목록과 그 디렉터리는 root(Windows에서는 SYSTEM과 Administrators) 또는 설치 디렉터리의 소유자만 변경할 수 있습니다. 설치 과정이 이렇게 설정합니다. 다른 계정이 변경할 수 있는 파일과 패키지 안의 링크는 거부됩니다(`access_unsafe`, `access_link`).
2. 서명, 모든 파일, Arkvory 버전을 `module install`과 같은 방식으로 확인합니다.
3. 폐기 목록. 폐기된 버전은 절대 로드되지 않습니다. 만료된 목록이나 목록이 없는 상태는 모듈을 멈추지 않습니다.

확인에 실패한 모듈은 로드되지 않으며, 다른 모듈과 Arkvory는 계속 동작합니다. `GET /api/v1/system/modules`는 해당 모듈을 `running: false`로 보여 줍니다.

| `health.status` | 의미                                                       | 코드                                                                                                        |
| --------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `failed`        | 패키지가 거부되었거나 코드가 로드 또는 시작되지 않았습니다 | `file_mismatch`, `unknown_key`, `module_incompatible`, `access_unsafe`, `config_invalid`, `start_failed` 등 |
| `revoked`       | ProAnimaStudio가 이 버전을 폐기했습니다                    | 폐기 목록의 사유                                                                                            |
| `unavailable`   | 호스트에 패키지 디렉터리가 없습니다                        | `module_unavailable`                                                                                        |

실패한 모듈은 다른 활성 모듈이 그 모듈을 필요로 할 때만 Arkvory를 준비되지 않은 상태로 만듭니다(`/health/ready`가 `module_failed`와 함께 503으로 응답). 게시된 파일의 바이트를 저장하는 모듈(데이터 `layout`)은 절대 그렇게 하지 않습니다. Arkvory는 그 데이터를 계속 제공하고 새 업로드를 모듈의 저장소 대신 자체 저장소에 기록합니다. 로그에는 `module.refused`와 `module.failed`가 `errorCode`의 코드와 함께 기록됩니다.

변경되었거나 없어진 패키지를 복구하려면 다시 설치하세요. 설치의 모든 서비스는 활성화 여부와 관계없이 같은 모듈을 보아야 합니다. 다른 모듈을 가진 읽기 게이트웨이나 워커는 준비되지 않습니다(`module_plan_mismatch`). 각 읽기 게이트웨이의 호스트에 같은 패키지를 설치하세요.

### 모듈의 데이터 디렉터리 {#data}

자체 인덱스, 캐시 또는 상태를 보관하는 모듈은 데이터 볼륨에 디렉터리를 받습니다. `default`의 스토리지 디렉터리 안의 `module-data/<id>/`입니다. 그중 `data` 부분은 백업 대상이고 `cache` 부분은 그렇지 않습니다. Arkvory는 모든 쓰기를 두 부분을 합쳐 MiB와 파일 수로 승인된 크기에 대해 계산합니다. 이를 넘는 쓰기는 거부되며(`module_quota_exceeded`) 모듈은 계속 실행됩니다. 승인된 크기가 없으면 모듈은 읽기만 할 수 있습니다. [볼륨의 예비 영역](./storage#disk)도 적용됩니다. 읽기 게이트웨이에서 모듈은 같은 파일을 읽지만 변경할 수는 없습니다.

모듈을 제거해도 디렉터리는 남습니다. 데이터가 더 이상 필요 없으면 `module-data/<id>/`를 직접 삭제하세요. 백업은 아직 모듈 디렉터리를 포함하지 않습니다.

## 모듈의 라우트 {#routes}

모듈은 자신의 접두사 `/api/ext/<id>/v<major>/` 아래에 HTTP 라우트를 추가할 수 있습니다(예: `/api/ext/sample/v1/`). Arkvory는 모듈의 코드가 실행되기 전에 모든 요청을 확인합니다.

| 확인      | `/api/v1`과 동일                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 자격 증명 | 같은 키, 세션, 토큰을 사용하며, 라우트는 로그인한 모든 호출자 또는 전역 관리자에게만 열립니다                                                           |
| 권한      | 라우트가 경로 속 리포지토리에 대해 지정한 권한(예: `content.read`, `upload.create`): 서비스 키에는 그 권한이, 계정에는 읽기 또는 쓰기 권한이 필요합니다 |
| 요청 본문 | 라우트의 크기 제한과 서버의 업로드 제한, 기한, 대역폭                                                                                                   |
| 파일      | Arkvory가 직접 보냅니다: ETag, Range, `If-Range`, 304, 다운로드 대기열과 다운로드 대역폭                                                                |

오류는 API의 오류 형식을 따릅니다. 모듈은 자격 증명이나 다른 헤더를 보지 못합니다. 읽기 게이트웨이는 모듈의 읽기 라우트를 제공하고 나머지에는 `read_only`로 응답합니다.

각 모듈은 OpenAPI 문서로 라우트를 설명하고, Arkvory는 모듈이 시작될 때 둘을 대조합니다. 라우트가 규칙을 어기는 모듈은 시작하지 않고 아무것도 제공하지 않으며, Arkvory는 계속 동작합니다. `GET /api/v1/system/modules`는 이 모듈을 `running: false`와 `health.status` `failed`로 보여 줍니다.

| 코드                     | 의미                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `routes_invalid`         | 라우트가 규칙을 어깁니다. 예: 모듈 접두사 밖의 경로, 로그인한 모든 호출자에게 열린 변경 |
| `openapi_invalid`        | OpenAPI 문서가 없거나 올바르지 않습니다                                                 |
| `openapi_route_mismatch` | 라우트에 문서상의 작업이 없거나, 작업에 라우트가 없습니다                               |
| `transfer_invalid`       | 모듈이 제공할 수 없는 전송 프로토콜을 제공합니다                                        |

라우트 문서:

| 주소                                                                                        | 읽을 수 있는 사람    | 내용                                                                   |
| ------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------- |
| `GET /api/ext/openapi.json`                                                                 | 로그인한 모든 호출자 | 이 서비스가 실행하는 모든 모듈의 라우트와 호출자가 호출할 수 있는 작업 |
| [`GET /api/v1/system/modules/{id}/openapi`](../api/reference/system#getSystemModuleOpenApi) | 전역 관리자          | 모듈 하나의 라우트                                                     |

`/api/v1/openapi.json`은 모듈의 라우트를 나열하지 않습니다. 종류가 `transfer`인 모듈은 파일을 전송하는 다른 방법을 제공할 수 있으며, `GET /api/v1/capabilities`가 이를 `transfer`에 나열합니다. 클라이언트는 일치하는 확장이 있을 때만 이를 사용하고, 그렇지 않으면 평소처럼 파일을 전송합니다.

## 업데이트, 고정, 다운그레이드 {#versions}

새 버전의 파일을 `--yes`로 설치합니다. 이전 패키지는 다음 모듈 변경까지 호스트에 남아 있습니다.

| 작업                | 명령                                                            |
| ------------------- | --------------------------------------------------------------- |
| 설치된 버전 유지    | `sudo arkvory module pin sample 1.0.0 --root …`                 |
| 다른 버전 다시 허용 | `sudo arkvory module pin sample --unpin --root …`               |
| 더 오래된 버전 설치 | `sudo arkvory module install <file> --downgrade --yes --root …` |

고정된 모듈은 고정을 해제할 때까지 다른 모든 버전을 거부합니다. 설치된 버전보다, 또는 패키지가 아직 호스트에 남아 있는 제거된 버전보다 오래된 버전에는 `--downgrade`가 필요합니다.

## 설치된 모듈 확인 {#list}

```bash
sudo arkvory module list --root /opt/proanima-arkvory
```

이 명령은 서비스가 로드하기 전에 하는 것과 같이 설치된 모든 패키지를 다시 검증합니다. 서명, 모든 파일, 아카이브를 확인합니다. 각 모듈은 하나의 상태를 표시합니다.

| 상태                 | 의미                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `ok`                 | 패키지가 온전함                                                                                 |
| `refused: <code>`    | 파일이 변경되었거나 추가되었거나 링크로 바뀜(`file_mismatch`, `file_unlisted`, `link_entry` 등) |
| `revoked (<reason>)` | ProAnimaStudio가 이 버전을 폐기함. `read path only`는 해당 데이터를 계속 읽을 수 있다는 뜻      |

거부된 패키지는 절대 사용되지 않습니다. 복구하려면 패키지 파일을 다시 설치하십시오.

## 모듈 제거 {#remove}

```bash
sudo arkvory module remove sample --root /opt/proanima-arkvory
```

모듈은 설치에서 빠지고, 패키지는 다음 모듈 변경까지 호스트에 남습니다. 게시된 파일의 바이트를 저장하는 모듈(데이터 `layout`)은 제거할 수 없습니다. Arkvory는 데이터를 읽을 수 없게 되는 일이 없도록 `module_owns_data`로 거부합니다.

## 폐기 목록 {#revocations}

ProAnimaStudio는 폐기된 모듈 버전의 서명된 목록을 게시합니다. 각 목록에는 번호가 있으며, Arkvory는 가지고 있는 목록보다 번호가 낮은 목록을 절대 받아들이지 않습니다. 모듈 패키지가 더 새로운 목록을 포함할 수 있으며, 패키지를 설치하면 Arkvory가 그 목록을 보관합니다. 허브에 접근할 수 없는 호스트에서는 목록 파일을 직접 저장합니다.

```bash
sudo arkvory module revocations /root/module-revocations.json --root /opt/proanima-arkvory
```

각 목록은 만료 시각과 함께 서명됩니다. 기본 90일이며 180일을 넘지 않습니다. `module install`과 `module pin <id> <version>`에는 현재 유효한 목록이 필요하며, 만료된 목록이거나 목록이 없으면 `stale_revocations`로 거부됩니다. 현재 유효한 목록을 담은 패키지도 인정됩니다. 그래도 진행하려면 `--allow-stale-revocations`를 추가하십시오. Arkvory는 경고를 출력하고 결정을 `modules/audit.jsonl`에 기록합니다. 만료된 목록은 설치된 모듈을 멈추지 않습니다. 모듈은 계속 실행되고 데이터도 읽을 수 있으며, 버전을 멈추는 것은 폐기 항목뿐입니다. 번호가 더 큰 목록은 만료되었더라도 항상 저장된 목록을 대체합니다.

ProAnimaStudio가 모듈 서명 키를 교체할 때는 한 릴리스가 두 키를 모두 포함하고 다음 목록은 새 키로 서명됩니다. 이전 키는 그 이후 릴리스에서만 제거됩니다. 호스트가 이전 키로 서명된 목록을 아직 저장하고 있으면 그 릴리스로의 업데이트는 거부됩니다. 먼저 현재 유효한 목록을 저장하십시오. `sudo arkvory module check-revocations --root …`는 이 릴리스가 저장된 목록의 키를 신뢰하는지 보여 줍니다.

## 플러그인 작성자 신뢰 {#trust}

팀이나 다른 작성자의 플러그인은 작성자의 키로 서명됩니다. 이런 플러그인을 설치하기 전에 키를 호스트의 신뢰 목록에 추가하십시오. 신뢰 목록은 호스트에 속합니다. 서비스는 목록을 읽을 수 있지만 변경할 수는 없습니다.

1. 작성자에게서 공개 키 파일(`.pub`, minisign 형식)을 받고, 지문은 다른 경로로 받습니다.
2. 키를 표시하고 지문을 비교합니다.

   ```bash
   sudo arkvory module trust add /root/acme.pub --label "Acme platform team" --plugins "op-acme-*" --root /opt/proanima-arkvory
   ```

3. `--yes`로 추가합니다.

| 옵션                 | 의미                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `--label`            | 키 보유자. 필수                                                                                |
| `--plugins`          | 키가 서명할 수 있는 플러그인 id(쉼표로 구분): 정확한 id 또는 `*`가 붙은 접두사. 기본값 `op-*`  |
| `--expires`          | `2027-01-31T00:00:00Z` 같은 UTC 시간. 이후에는 키로 새 설치를 받아들이지 않음                  |
| `--allow-in-process` | 키의 플러그인이 Arkvory 프로세스 안에서 실행되도록 허용. 이런 코드는 서비스의 모든 권한을 가짐 |

플러그인 id는 항상 `op-`로 시작합니다. 플러그인 키는 ProAnimaStudio 모듈에 서명하지 않으며, ProAnimaStudio 키는 `op-` 플러그인에 서명하지 않습니다. 호스트가 이미 다른 id 또는 다른 종류의 키로 알고 있는 키는 거부됩니다(`duplicate_key`). 서명은 현재 minisign 버전의 기본값인 prehash 방식이어야 하며, 레거시 서명은 `signature_algorithm`으로 거부됩니다.

`sudo arkvory module trust list --root …`는 신뢰하는 키를 보여 줍니다. `sudo arkvory module trust remove <key id> --root …`는 키 하나를 제거합니다.

이 릴리스는 신뢰 목록을 관리하며, 플러그인은 이후 릴리스가 설치합니다.

## 중단된 후 {#recover}

모듈 집합의 모든 변경은 업데이트 저널에 기록됩니다. 명령이 중간에 멈추면 다음 배포 명령이 `Interrupted deployment`로 거부됩니다. `sudo arkvory recover --root …`를 실행하십시오. 이전 모듈 집합을 복원합니다. 그때까지 무언가를 바꾸는 모든 모듈 명령은 거부되며, `module trust`와 `module revocations`도 마찬가지입니다.
