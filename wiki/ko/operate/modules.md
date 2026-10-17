---
title: 모듈
description: 호스트에 서명된 모듈 패키지를 설치하고 확인하고 제거하며, 신뢰하는 플러그인 작성자의 키를 관리합니다.
---

# 모듈

모듈 패키지는 Arkvory에 기능을 추가합니다. Arkvory는 서명을 검증할 수 있는 패키지만 설치합니다. 이 페이지의 명령은 설치가 있는 호스트에서 Linux에서는 root로, Windows에서는 관리자로 실행합니다. 콘솔과 HTTP API는 모듈을 설치하거나 키를 신뢰할 수 없으므로, 도난당한 콘솔 관리자 계정으로는 서버에서 코드를 실행할 수 없습니다.

이 릴리스는 모듈 패키지를 저장하고 검증합니다. 서비스는 아직 모듈 코드를 실행하지 않습니다. 이후 릴리스가 설치된 모듈을 로드합니다.

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

제한: 패키지당 1 GiB, 파일당 256 MiB, 파일 4096개. 더 큰 패키지는 데이터를 읽기 전에 거부됩니다.

같은 바이트로 이미 설치된 버전은 그대로 둡니다. 같은 버전이지만 바이트가 다르면 거부됩니다.

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

이 명령은 서비스가 로드하기 전에 하는 것처럼 설치된 모든 패키지를 다시 검증합니다. 서명, 모든 파일, 아카이브를 확인합니다. 각 모듈은 하나의 상태를 표시합니다.

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
