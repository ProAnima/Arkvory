---
title: 라이선스
description: 유료 모듈의 라이선스를 온라인 또는 오프라인으로 활성화하고, 상태를 확인하고, Arkvory가 무엇을 보내고 보관하는지 알아봅니다.
---

# 라이선스

Arkvory의 무료 코어에는 라이선스가 필요 없습니다. 이 문서의 모든 기능은 라이선스 없이 작동하며, 어떤 라이선스 상태도 기능을 끄거나 데이터를 읽을 수 없게 만들지 않습니다. 라이선스는 ProAnimaStudio의 유료 모듈을 켭니다([모듈](modules) 참조). 라이선스를 활성화하기 전까지 Arkvory는 라이선스에 관한 어떤 것도 어디로도 보내지 않습니다.

이 페이지의 명령은 설치가 있는 호스트에서 Linux에서는 root로, Windows에서는 관리자로 실행합니다. Docker Compose 설치는 모듈을 로드하지 않으므로 이 명령을 거부합니다.

## 온라인 활성화 {#activate}

1. ProAnimaStudio 사이트에서 받은 라이선스 키를 본인만 읽을 수 있는 파일에 저장합니다. 예: `/root/arkvory.key`.
2. 활성화합니다:

   ```bash
   sudo arkvory license activate --key-file /root/arkvory.key --root /opt/proanima-arkvory
   ```

3. 활성화 후 로컬 키 파일을 삭제하세요. 복구 시 키가 다시 필요할 수 있으므로 계정에서 라이선스 키에 접근할 수 있어야 합니다.

Arkvory는 인증서를 검증하는 HTTPS로 설치의 허브(`config/hub.json`의 주소, 업데이트와 같은 주소)에 요청을 보냅니다. 응답은 ProAnimaStudio의 라이선스 키가 이 설치와 이 요청에 대해 서명한 경우에만 받아들입니다. 오타가 있는 키는 아무것도 보내기 전에 거부됩니다. 같은 설치를 같은 키로 다시 활성화해도 라이선스의 새 자리를 차지하지 않습니다.

### 보내는 내용 {#sent}

| 요청   | 내용                                                                              |
| ------ | --------------------------------------------------------------------------------- |
| 활성화 | 라이선스 키, 설치 ID, 임의의 값, Arkvory 버전, 설치된 유료 모듈의 ID와 버전, 시각 |
| 갱신   | 활성화 ID와 그 비밀, 임의의 값, 순번, 버전                                        |

라이선스 소유자의 이름, 사람 이름, 주소, 기기 정보, 데이터 양, 저장소 이름, 내용, metadata, 사용 통계는 절대 보내지 않습니다. 통계를 꺼도 여기서 추가되거나 빠지는 것은 없습니다. 허브를 끈 경우(`--hub-off`)에는 [오프라인 활성화](#offline)를 사용하세요.

### 보관하는 내용 {#kept}

- 토큰: 허브가 서명한 문서로, 데이터베이스와 백업에 있습니다.
- 활성화 비밀: `config/licenses/`의 파일로, 서비스 계정만 읽을 수 있습니다. 데이터베이스, 로그, 백업에는 절대 들어가지 않습니다.
- 라이선스 키: 어디에도 없습니다.

## 상태 확인 {#status}

```bash
sudo arkvory license status --root /opt/proanima-arkvory
```

스크립트에는 `--json`을 추가합니다. 전역 관리자는 `GET /api/v1/system/license`에서 같은 내용을 봅니다([참조](../api/reference/system#getSystemLicense)). Arkvory는 저장된 모든 문서를 매번 다시 검증합니다. ProAnimaStudio가 서명하지 않은 문서는 `invalid`이며 아무것도 켜지 않습니다.

| 상태            | 의미                                                                        | 유료 쓰기              |
| --------------- | --------------------------------------------------------------------------- | ---------------------- |
| `valid`         | 라이선스가 유효합니다. 허브가 한동안 응답하지 않으면 `refreshFailing`       | 모듈 방식으로          |
| `offline-grace` | 하루 넘게 갱신이 없습니다. 토큰은 `offlineGraceUntil`까지 유효              | 모듈 방식으로          |
| `grace`         | 라이선스 기간이 끝났습니다. 갱신 유예 기간은 `graceUntil`까지               | 모듈 방식으로          |
| `mismatch`      | 토큰이 다른 설치의 것입니다(다른 곳에서 복원). 유예 기간은 `graceUntil`까지 | 그때까지 모듈 방식으로 |
| `expired`       | `trial_expired`, `licence_expired` 또는 `activation_stale`(토큰 종료)       | 코어 형식으로          |
| `revoked`       | 서명된 취소. 사유가 표시됩니다                                              | 코어 형식으로          |
| `invalid`       | 저장된 문서가 검증을 통과하지 못합니다                                      | 코어 형식으로          |

어떤 상태에서도 데이터는 읽을 수 있고, 백업과 복원이 작동하며, 라이선스 때문에 게시가 실패하는 일은 없습니다. 라이선스가 없으면 유료 모듈은 새 데이터를 무료 코어 형식으로 씁니다. 갱신에 성공하면 모듈 방식의 쓰기가 저절로 다시 시작됩니다.

## 갱신과 오프라인 기간 {#refresh}

워커는 각 활성화를 하루에 한 번쯤, 그리고 시작할 때 갱신합니다. 갱신할 때마다 새 토큰과 새 비밀을 받으며, 이전 비밀은 더 이상 쓸 수 없습니다.

허브에 연결할 수 없으면 워커는 15분 뒤에 다시 시도하고, 그 뒤로는 매번 더 오래, 최대 6시간까지 기다립니다. 라이선스는 `valid`로 남고, 하루 동안 갱신이 없으면 `offline-grace`가 되며, 토큰이 끝나면(오프라인 기간: 기본 30일, 체험판은 7일) `activation_stale`과 함께 `expired`가 됩니다. `licence_expired`나 `activation_suspended` 같은 허브의 거부는 다시 시도하지 않습니다. 원인을 해결한 뒤 실행하세요:

```bash
sudo arkvory license refresh --root /opt/proanima-arkvory
```

시계를 되돌려도 아무것도 연장되지 않습니다. Arkvory는 지금까지 본 가장 늦은 시각을 기준으로 판단합니다. 데이터베이스 시계가 그 시각보다 하루 넘게 늦으면 `clockRollback`이 표시됩니다.

갱신 요청이 허브에 도달했을 수 있지만 응답을 잃은 경우 Arkvory는 10분 안에 한 번만 재전송합니다. 재시작해도 횟수는 초기화되지 않습니다. 결과를 여전히 알 수 없거나 재전송 기회를 소진했거나 시간이 지났거나 받은 토큰이 유효하지 않으면 `activation_recovery_required`로 갱신을 중단합니다. 현재 토큰은 만료될 때까지 유효합니다. 키를 가져와 `license activate --key-file <file>`을 다시 실행하세요. `license refresh`로는 이 상태를 해제할 수 없습니다.

### 복사본과 복원 {#copies}

복제한 가상 머신처럼 설치의 복사본은 같은 비밀을 가집니다. 두 복사본이 모두 갱신하면 허브는 활성화를 일시 중지합니다(`activation_secret_reused`). 남겨 둘 설치를 키로 다시 활성화하세요.

다른 설치에 복원한 백업은 이전 설치의 토큰을 그대로 가집니다. 상태는 유예 기간이 있는 `mismatch`입니다. 새 설치를 키로 활성화한 다음 이전 설치를 비활성화하세요.

오프라인 기간과 그 뒤 30일 동안 갱신되지 않은 활성화는 만료되고 자리가 해제됩니다. 다음 갱신은 빈자리가 있으면 자리를 되찾고, 없으면 `activation_lapsed`로 거부됩니다. 다른 설치를 비활성화한 뒤 갱신하세요.

## 비활성화 {#deactivate}

```bash
sudo arkvory license deactivate lic_0123456789ABCDEFGHJKMNPQRS --root /opt/proanima-arkvory
```

라이선스 또는 활성화 하나를 지정합니다. 허브는 자리를 해제하고 Arkvory는 비밀을 삭제합니다.

## 오프라인 활성화 {#offline}

허브에 접근할 수 없는 호스트용입니다:

1. 요청 파일을 만듭니다:

   ```bash
   sudo arkvory license request --key-file /root/arkvory.key --out /root/request.json --root /opt/proanima-arkvory
   ```

   파일에는 키가 아니라 키의 SHA-256이 들어 있습니다. Arkvory는 이를 위해 어떤 네트워크도 사용하지 않습니다.

2. ProAnimaStudio 계정에서 파일을 업로드하고 응답을 내려받습니다.
3. 응답을 설치합니다:

   ```bash
   sudo arkvory license install /root/answer.json --root /opt/proanima-arkvory
   ```

응답은 이 설치의 요청에 대한 것이어야 합니다. 오프라인 활성화는 갱신되지 않으며 끝날 때까지, 최대 365일 유효하고 새 요청으로 연장합니다. 취소는 라이선스 취소 목록으로만 이런 호스트에 전달되며, 목록도 같은 방법으로 설치합니다.

## 오류 {#errors}

| 코드                                                | 의미                                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `licence_key_invalid`                               | 허브가 이 키를 모릅니다                                                                            |
| `activation_limit_reached`                          | 라이선스의 모든 자리가 찼습니다. 다른 설치를 비활성화하세요                                        |
| `answer_invalid`                                    | 응답이 ProAnimaStudio의 서명이 아니거나 다른 설치 또는 요청의 것입니다. 아무것도 보관하지 않습니다 |
| `installation_mismatch`, `nonce_unknown`            | 오프라인 응답이 다른 설치의 것이거나 기다리는 요청이 없습니다                                      |
| `seq_replayed`                                      | 보관된 것보다 오래된 문서입니다. 거부됩니다                                                        |
| `revocation_rollback`                               | 보관된 것보다 오래된 취소 목록입니다                                                               |
| `unreachable`, `timeout`, `tls_failed`, `hub_error` | 허브에 연결할 수 없었습니다. 워커가 다시 시도합니다                                                |
