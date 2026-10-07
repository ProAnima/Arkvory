---
title: 백업
description: 백업 보관소를 연결하고, 백업을 예약하고 검증하며, 복원 지점을 빈 서버에 복원하고, 복원을 정기적으로 테스트합니다.
---

# 백업

백업 에이전트는 설치 환경의 데이터베이스와 저장된 파일을 **백업 보관소**에 복사합니다. 백업 보관소는 다른 디스크나 네트워크 공유에 있는 디렉터리입니다. 사용자가 업로드와 다운로드를 계속하는 동안에도 백업은 동작합니다. 완료된 백업은 각각 **복원 지점**이 되며, 이를 검증하고 복원할 수 있습니다.

이 페이지에서는 백업 보관소, 일정, 보존, 검증, 상태 화면, 복원 절차를 설명합니다. 복원은 서버에서 실행하는 명령입니다. 콘솔에는 복원 버튼이 없습니다.

## 백업이 동작하는 방식 {#how-backups-work}

에이전트는 API, 워커와 함께 설치 환경을 구성하는 세 번째 서비스입니다. 이름은 Linux에서 `arkvory-backup`, Windows에서 `Arkvorybackup`, Docker Compose에서 `backup`입니다. 에이전트는 한 번에 하나만 작업합니다. 두 번째 에이전트는 대기하다가 첫 번째 에이전트가 멈추면 작업을 넘겨받습니다.

에이전트는 세 가지 일을 합니다.

- 계획이 켜져 있으면 매일 계획을 실행합니다.
- 콘솔, `arkvoryctl`, API로 요청한 작업을 실행합니다.
- 새 복원 지점을 각각 검증하고 보존 규칙을 적용합니다.

복원 지점은 특정 시점 **T**, 즉 스냅샷 시각에 설치 환경에 게시되어 있던 상태를 담습니다. T 이후에 게시된 파일은 다음 백업에 들어갑니다. 콘솔은 백업이 얼마나 오래되었는지를 복사가 끝난 시각이 아니라 T부터 계산합니다.

다음 사항을 기억하세요.

- 백업은 업로드와 다운로드를 멈추지 않습니다. 백업이 실행되는 동안 물리적 정리는 백업에 필요한 파일을 건너뛰고, 이후 실행에서 삭제합니다.
- 복원 지점이 몇 개든 파일은 백업 보관소에 한 번만 저장됩니다. 첫 번째 백업은 모든 것을 복사하므로 콘텐츠가 테라바이트 규모이면 오래 걸립니다. 이후 백업은 새 파일만 복사합니다.
- 복원 지점은 복사가 완전히 끝나야 생깁니다. 실패하거나 중단된 백업은 이전 복원 지점을 손상시키지 않습니다.
- 백업은 특정 시점 복구 시스템도, 고가용성도 아닙니다. 하나의 복원 지점이 가진 상태로 복원하며, 그 지점의 T 이후에 생긴 변경은 사라집니다.

## 백업에 포함되는 내용 {#contents}

복원 지점에는 다음이 들어 있습니다.

- 데이터베이스의 카탈로그 테이블: 아티팩트, 패키지, 파일 경로와 그 기록, 레이블과 메타데이터, 스테이지, 첨부 파일, 계정, 그룹과 권한 부여, 서비스 계정과 키, 감사 기록, 스토리지 및 정리 정책, 컨테이너 이미지, Git LFS, npm 레지스트리 데이터, 미러의 상태.
- 게시된 모든 파일의 콘텐츠.

복원 지점에 들어 있지 않은 것은 다음과 같습니다.

- 로그인 세션, 다운로드 링크, 읽기 게이트웨이의 런타임 상태.
- 끝나지 않은 업로드. 복원하면 취소되며, 클라이언트가 다시 시작해야 합니다.
- 백업 계획과 에이전트 상태. 복원된 설치 환경은 백업이 꺼진 상태로 시작합니다.
- 설치 환경의 `config/` 디렉터리: 설정, TLS 파일, 미러 키, 복구 키. 이 파일의 사본은 직접 보관하세요.
- Arkvory 프로그램. 먼저 릴리스를 설치한 다음 복원하세요.

## 백업 보관소 준비 {#vault}

### 요구 사항 {#vault-requirements}

| 요구 사항                                                                           | 이유                                                                                                                        |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 서비스가 시작되기 전에 마운트되는 새 디렉터리 또는 빈 디렉터리                      | 에이전트가 이곳에 `vault.json`과 복원 지점을 씁니다                                                                         |
| 설치 디렉터리와 스토리지 디렉터리 밖. 링크, 정션, 짧은 이름을 거쳐도 마찬가지입니다 | 스토리지 안에 있는 백업 보관소는 스토리지와 함께 사라집니다. 검사는 이 디렉터리를 포함하거나 이 안에 있는 경로를 거부합니다 |
| 서비스 계정이 쓸 수 있어야 함                                                       | Linux에서는 `arkvory`, Windows에서는 `NT AUTHORITY\LocalService`입니다. `arkvory configure`가 권한을 설정합니다             |
| 복사할 데이터 외에 최소 1 GiB의 여유 공간                                           | 백업 보관소는 이 여유분을 유지합니다. 볼륨이 가득 차면 백업이 `vault_full`로 끝나며 이전 지점은 그대로 남습니다             |
| Linux에서는 `/home`, `/root`, `/run/user`, `/tmp`, `/var/tmp` 아래가 아니어야 함    | 서비스 샌드박스가 이 트리를 숨깁니다                                                                                        |
| Windows에서는 드라이브 문자가 있는 로컬 볼륨 또는 iSCSI 볼륨                        | `LocalService`는 SMB 공유에 로그인할 수 없으므로 `\\nas\share` 같은 경로는 거부됩니다                                       |

스토리지 디스크가 고장 나도 백업이 함께 사라지지 않도록 다른 디스크나 NAS의 볼륨을 사용하세요. 스토리지와 같은 물리 디스크에 있는 백업 보관소는 실수로부터는 보호하지만 디스크 장애로부터는 보호하지 못합니다.

**vault는 기본적으로 암호화됩니다.** Arkvory는 파일, 카탈로그, 복원 지점의 설명을 암호화합니다([vault 암호화](#encryption) 참고). 암호화 없이 만든 vault는 카탈로그, 비밀번호 해시, 게시된 모든 파일을 평문으로 보관합니다. 암호화된 볼륨(LUKS, BitLocker, NAS 암호화)에 두고 서비스 계정과 백업 관리자만 접근하게 하세요.

### vault 암호화 {#encryption}

vault는 만들 때 암호화되고 그대로 유지됩니다. Arkvory는 파일 내용, 카탈로그, 복원 지점의 설명을 AES-256-GCM으로 암호화하며, vault를 읽을 때 변경되거나 잘리거나 바뀐 파일을 찾아냅니다. 파일 이름, 크기, 복원 지점의 수는 숨기지 않습니다.

서버에서 `arkvory-backup` 프로그램으로 vault를 만드세요([시작하기 전에](#restore-prepare) 참고). 두 파일은 모두 새 파일이어야 하며 vault와 스토리지 바깥에 있어야 합니다.

```bash
arkvory-backup vault init /mnt/backup/arkvory \
  --kit-file /root/arkvory-recovery-kit.txt \
  --agent-key-file /root/arkvory-agent.key
```

1. 이 명령은 두 개의 키로 vault를 만듭니다. 서비스의 키(`arkvory-agent.key`)와 복구 키트에 들어 있는 복구 키입니다. 성공을 알리기 전에 각 키로 vault를 열어 봅니다.
2. 복구 키트를 지금 이 서버 밖으로 옮기세요. 비밀번호 관리자나 금고에 보관합니다. 키트나 에이전트 키가 없으면 아무도 백업을 읽을 수 없고, 대신 복원해 줄 수도 없습니다. 키트와 vault 사본을 가진 사람은 그 안의 모든 백업을 읽을 수 있습니다.
3. 다음 절처럼 에이전트 키로 vault를 연결하고, 가지고 있던 키 파일 사본은 삭제하세요. 설치는 `config/backup/vault.key`에 자체 사본을 두며, 서비스 계정만 읽을 수 있습니다.

키트의 복구 키는 이 vault만 엽니다. 설치의 복구 키(`config/bootstrap-token.txt`)가 아닙니다.

키트가 vault를 여는지 지금 확인하고, 키를 바꿀 때마다 다시 확인하세요.

```bash
arkvory-backup vault key verify --vault /mnt/backup/arkvory --key-file /root/arkvory-recovery-kit.txt
```

키는 슬롯에 속하며, 각 슬롯은 자기 키로 vault를 엽니다. 다음 명령은 슬롯을 바꿉니다. 어느 것도 키를 보여 주지 않습니다.

| 명령                                                                     | 효과                                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `vault key list --vault DIR`                                             | 슬롯을 나열합니다: ID, 종류(`agent` 또는 `recovery`), 생성 시각. 키가 필요 없습니다.                   |
| `vault key add-recovery --vault DIR --key-file KEY --kit-file NEW`       | 복구 슬롯을 추가하고 그 키트를 씁니다. 다른 사람이나 다른 금고를 위한 것입니다.                        |
| `vault key rotate-agent --vault DIR --key-file KEY --agent-key-file NEW` | 새 에이전트 키를 만들고 이전 키를 제거합니다. 그런 다음 새 키 파일로 `arkvory configure`를 실행하세요. |
| `vault key remove --vault DIR --key-file KEY --slot ID`                  | 슬롯을 제거합니다. 마지막 슬롯과 마지막 복구 슬롯은 남습니다.                                          |

슬롯을 제거하면 그 키만 가진 사람은 vault를 열 수 없게 됩니다. 이전 지점을 다시 암호화하지는 않습니다. 전에 vault와 키를 복사한 사람은 그 사본을 계속 읽을 수 있습니다. 키가 유출되었을 수 있다면 새 키로 새 vault를 만들고 거기서 새 지점을 시작하세요.

암호화하지 않은 vault도 만들 수 있습니다: `arkvory-backup vault init DIR --no-encryption`. 카탈로그, 비밀번호 해시, 모든 파일을 평문으로 보관하므로 암호화된 볼륨과 서비스 계정 전용 접근이 필요합니다.

### 백업 보관소 연결 {#connect-vault}

서버에서 root 또는 관리자로 명령을 실행하세요. 명령은 아무것도 바꾸기 전에 디렉터리를 검사합니다.

```bash
sudo arkvory configure --root /opt/proanima-arkvory --backup-vault /mnt/backup/arkvory --vault-key-file /root/arkvory-agent.key
```

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' configure --root $root --backup-vault D:\Backup\Arkvory --vault-key-file C:\Private\arkvory-agent.key
```

Windows의 스크립트 설치에서는 [Windows](../install/windows#manage-the-services)에 설명된 대로 `manage.mjs`를 시작하세요.

1. 명령은 경로를 확인합니다. 절대 경로여야 하고, 쓸 수 있는 기존 디렉터리여야 하며, 설치 디렉터리와 스토리지 밖에 있고, 서비스에서 보여야 합니다.
2. 암호화된 vault(기본값)는 이미 있습니다. `arkvory-backup vault init`으로 만들었고, `--vault-key-file`이 서비스에 키를 전달합니다(`AK1-…` 키이며 복구 키는 절대 아닙니다). `--init-vault --vault-no-encryption`을 쓰면 대신 **빈** 디렉터리에 암호화되지 않은 vault를 만듭니다. 같은 디렉터리를 두 번 초기화하지 않습니다. `vault.json`도 `--init-vault`도 없으면 거부하므로, 마운트되지 않은 NAS를 빈 vault로 착각하지 않습니다.
3. 서비스 계정에 접근 권한을 주고, 키를 `config/backup/vault.key`로 복사하고, `ARKVORY_BACKUP_VAULT`와 `ARKVORY_BACKUP_VAULT_KEY_FILE`을 `config/runtime.json`에 쓰고, 에이전트만 다시 시작합니다.
4. 에이전트가 이 백업 보관소를 사용 가능하다고 보고할 때까지 최대 150초 기다립니다. 이 확인은 `config/bootstrap-token.txt`를 읽으므로 이 파일을 삭제하지 마세요.
5. 어느 단계든 실패하면 이전 설정과 이전 접근 권한을 복원하고 에이전트를 다시 시작합니다.

이미 있는 vault를 쓰려면(예: 새 서버에서) `--vault-key-file`로 그 키를 주고 `--init-vault`는 빼세요. vault 연결을 끊으려면 `--backup-vault-off`를 사용하세요. 디렉터리와 파일은 그대로 두고 설치의 키 파일은 삭제합니다. 재시작하면 실행 중인 백업이 중단되고, 에이전트가 다시 수행합니다.

Docker Compose에서 백업 보관소는 `config/compose.vault.yml`에 정의된 바인드 마운트입니다. Compose 명령을 직접 실행할 때는 `-f config/compose.vault.yml`을 추가하세요. 추가하지 않으면 `up`이 백업 보관소 없이 에이전트 컨테이너를 만듭니다.

### 네트워크 공유의 백업 보관소 {#network-share}

Linux에서 NAS는 SMB 3과 NFS 4로 동작합니다. 파일이 서비스 계정 소유가 되도록 공유를 마운트하세요. 그렇지 않으면 에이전트가 쓸 수 없고, `configure`가 거부하며 이전 설정을 복원합니다.

```bash
sudo mount -t cifs //nas/arkvory /mnt/backup/arkvory \
  -o credentials=/etc/arkvory/smb.credentials,uid=$(id -u arkvory),gid=$(id -g arkvory),file_mode=0600,dir_mode=0700,vers=3.1.1
```

- 자격 증명 파일의 모드를 `0600`으로 지정하세요.
- NFS에서는 파일이 `arkvory` 소유가 되도록 소유자를 매핑하세요. 내보내기에 `no_root_squash`를 사용하거나 양쪽에서 같은 사용자 ID를 사용하세요.
- `/etc/fstab`에 `_netdev`와 함께 마운트를 추가하세요. 부팅 시 NAS를 사용하지 못할 수 있다면 SMB에는 `nofail`도 추가하세요.
- NAS가 끊기면 에이전트는 `vault_unavailable`을 보고합니다. 백업 보관소의 식별 정보는 `vault.json`에 저장되므로, 비어 있는 마운트 지점에는 쓰지 않습니다.

## 일정과 보존 {#schedule}

### 일정 설정 {#set-schedule}

[[ui:backups]] 섹션을 열고 [[ui:backupPlan]] 영역을 사용하세요. 백업을 관리할 권한이 필요합니다. 권한이 없으면 양식에 [[ui:backupReadOnly]] 메시지가 표시됩니다.

| 설정                                                          | 의미                                                                                                                         | 기본값  |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------- |
| [[ui:backupEnabled]]                                          | 매일 실행하는 계획을 켭니다. 켠다고 해서 백업이 바로 시작되지는 않습니다                                                     | 꺼짐    |
| [[ui:backupTime]]                                             | 매일 백업하는 현지 시각(분 단위)                                                                                             | 02:00   |
| [[ui:backupTimezone]]                                         | 그 현지 시각의 IANA 시간대. 예: `Europe/Moscow`, `UTC`. `+03:00` 같은 오프셋은 허용되지 않습니다                             | `UTC`   |
| [[ui:backupDaily]], [[ui:backupWeekly]], [[ui:backupMonthly]] | 복원 지점을 며칠, 몇 주, 몇 개월 분량으로 보관할지 정합니다. [보존](#retention)을 참조하세요. 허용 범위: 0–366, 0–260, 0–120 | 7, 4, 6 |

[[ui:backupPlanSave]] 버튼을 선택하세요. 그사이 다른 사람이 계획을 변경했다면 콘솔이 현재 계획을 불러옵니다. 내용을 검토한 다음 다시 저장하세요.

일정에는 다음 규칙이 적용됩니다.

- 시각 변경일에 존재하지 않는 현지 시각은 변경이 일어나는 시점에 실행됩니다. 두 번 나타나는 현지 시각은 첫 번째 시점에 한 번만 실행됩니다.
- 가동 중단 후에는 에이전트가 누락된 날마다 백업하지 않고 보충 백업을 한 번만 만듭니다. 일정을 변경해도 이전 시각에 대한 보충 백업은 실행되지 않습니다.
- 설치 환경의 기본 유지 관리 시간은 03:00 UTC입니다. 업데이트는 에이전트를 멈추므로, 실행 중인 백업은 중단되고 나중에 다시 실행됩니다. 유지 관리 시간에 걸리지 않는 백업 시각을 고르세요. [업데이트](../install/updates)를 참조하세요.

### 보존 {#retention}

보존은 계획의 시간대를 기준으로 최근 N일의 각 현지 날짜, 최근 N개 ISO 주의 각 주, 최근 N개월의 각 월에서 가장 최신 복원 지점을 하나씩 남깁니다. 세 그룹의 합집합이 남으므로 7, 4, 6이면 최대 17개를 남기고, 보통은 그보다 적습니다.

보존은 다음을 항상 남깁니다.

- 고정된 지점.
- 가장 최신 지점. 따라서 지점이 적어도 하나는 항상 남습니다.

보존은 검증에 실패한 지점을 삭제하지 않으며, 같은 백업 보관소에 있는 다른 설치 환경의 지점은 건드리지 않습니다.

에이전트는 각 백업이 끝나면 보존을 별도의 작업으로 대기열에 추가합니다. [[ui:backupRetentionApply]] 버튼을 선택해 직접 적용할 수도 있습니다. 콘솔은 먼저 어떤 지점이 남고 어떤 지점이 삭제되는지 보여 줍니다. 삭제는 되돌릴 수 없습니다. 이어서 에이전트가 해당 지점을 삭제하고, 그 뒤에 남은 어떤 지점에서도 필요하지 않은 파일을 삭제합니다. 백업 보관소에 손상된 지점(`COMMITTED`가 없거나 매니페스트가 유효하지 않은 지점 디렉터리)이 있으면 삭제가 `invalid_manifest`로 중단됩니다. 백업 보관소를 그대로 둔 채 원인을 찾은 다음, 손상된 디렉터리를 직접 삭제하세요.

백업 보존은 리포지토리의 빌드 보존에 영향을 주지 않습니다. [스토리지](./storage)를 참조하세요.

### 복원 지점 고정 {#pin}

고정한 지점은 보존 규칙과 관계없이 유지됩니다. 예를 들어 대규모 마이그레이션 직전의 지점을 고정하세요.

- 콘솔: [[ui:backupPoints]] 영역에서 해당 지점의 행에 있는 [[ui:backupPin]] 버튼을 선택하세요. [[ui:backupUnpin]] 버튼은 고정을 해제합니다.
- CLI: `arkvoryctl backup pin POINT_ID`, 해제는 `arkvoryctl backup pin POINT_ID --off`.
- API: [setBackupPointPin](../api/reference/backups#setBackupPointPin).

## 검증 {#verification}

검증에는 두 종류가 있습니다.

| 종류                                                 | 확인하는 내용                                                                                       | 실행 시점                                                                                                                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 빠른 검증(콘솔의 [[ui:backupVerifyStructural]] 상태) | 지점의 모든 파일을 매니페스트의 다이제스트와 대조하고, 저장된 각 파일이 존재하며 크기가 맞는지 확인 | 모든 백업 후 자동으로                                                                                                                                           |
| 전체 검증([[ui:backupVerifyDeep]])                   | 빠른 검증에 더해 저장된 모든 파일을 읽고 SHA-256을 확인                                             | 가장 최신 지점에 대해 7일마다 자동으로. 요청 시에는 [[ui:backupVerifyDeepAction]] 버튼, `arkvoryctl backup verify POINT_ID`, `arkvory-backup verify --deep`으로 |

전체 검증은 지점 전체를 읽으므로 백업 보관소가 크면 시간과 디스크 처리량이 필요합니다. 지점이 검증에 실패하면 콘솔에 오류 코드와 함께 [[ui:backupVerifyFailed]] 메시지가 표시되고 `verify_failed` 경고가 활성화됩니다. 원인을 알기 전에는 백업 보관소를 변경하지 마세요.

아직 확인하지 않은 지점에는 [[ui:backupVerifyNone]] 메시지가 표시됩니다. 가장 최신 지점의 전체 검증은 백업 보관소를 읽을 수 있는지 정기적으로 확인하는 가장 좋은 방법이기도 합니다.

## 지금 백업 실행 {#run-now}

다음 중 하나를 사용하세요.

- 콘솔: [[ui:backups]] 섹션의 [[ui:backupRun]] 버튼.
- CLI: `arkvoryctl backup run`.
- API: [requestBackupRun](../api/reference/backups#requestBackupRun)은 대기열에 추가된 작업과 함께 202로 응답합니다.

에이전트는 15초마다(`ARKVORY_BACKUP_POLL_SECONDS`) 대기열을 확인하므로 작업은 곧 시작됩니다. 작업은 한 번에 하나씩 실행되며, 콘솔을 닫아도 멈추지 않습니다. 재시작이나 충돌로 중단된 작업은 최대 5번까지 다시 실행됩니다. 복사 속도 제한 `ARKVORY_BACKUP_BYTES_PER_SECOND`를 포함한 에이전트 설정은 [환경 변수](../reference/environment#backups)를 참조하세요.

백업은 다음 단계를 거치며, 콘솔은 이를 [[ui:backupJobPhase]] 열에 표시합니다. [[ui:backupPhasePreparing]], [[ui:backupPhaseCatalog]], [[ui:backupPhaseTransfer]], [[ui:backupPhaseFinishing]], [[ui:backupPhaseDone]]. 빠른 검증의 단계 표시는 [[ui:backupPhaseStructural]], 전체 검증의 단계 표시는 [[ui:backupPhaseDeep]]입니다.

백업 중에는 데이터베이스 마이그레이션이나 오프라인 도구 `gc`, `scrub`을 실행하지 마세요. 이 작업은 백업이 끝나기를 기다리거나 `busy`로 거부됩니다.

## 상태 확인 {#status}

### 콘솔에서 {#status-console}

[[ui:backups]] 섹션은 관리자와 복구 키에만 표시됩니다. 서비스 키와 개인용 액세스 토큰에는 표시되지 않습니다. 이 페이지에는 다음이 표시됩니다.

- 상태: [[ui:backupStateOk]], [[ui:backupStateWarning]], [[ui:backupStateCritical]] 중 하나.
- [[ui:backupNewest]] 항목(T부터 계산한 경과 시간 포함), [[ui:backupNextRun]] 항목(실행이 늦어지면 [[ui:backupOverdue]] 표시 포함), [[ui:backupAgent]] 항목(마지막 신호 포함), [[ui:backupVault]] 항목(여유 공간 포함).
- 현재 실행 중인 작업, 그리고 경고. 각 경고에는 무엇을 해야 하는지 알려 주는 안내가 있습니다.
- [[ui:backupPoints]] 영역: [[ui:backupSnapshot]], [[ui:backupCompleted]], [[ui:backupSize]], [[ui:backupFiles]], [[ui:backupVerification]], 고정 상태가 표시됩니다.
- [[ui:backupJobs]] 영역: 종류([[ui:backupKindCapture]], [[ui:backupKindVerify]], [[ui:backupKindRetention]]), 상태, 단계, 시각, 오류 코드, 진행률이 표시됩니다.

작업의 상태는 [[ui:backupJobQueued]], [[ui:backupJobRunning]], [[ui:backupJobCommitting]], [[ui:backupJobCompleted]], [[ui:backupJobFailed]], [[ui:backupJobInterrupted]] 중 하나입니다. 작업이 실행되는 동안 페이지가 새로 고쳐집니다. 언제든 [[ui:backupRefresh]] 버튼을 사용할 수 있습니다.

### 경고 {#warnings}

| 코드                   | 수준 | 해야 할 일                                                                                                                                                                                |
| ---------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vault_not_configured` | 경고 | 백업 보관소를 연결하세요. [백업 보관소 연결](#connect-vault)을 참조하세요                                                                                                                 |
| `agent_offline`        | 위험 | 2분 동안 신호가 없습니다. 에이전트 서비스를 시작하고 로그를 읽으세요                                                                                                                      |
| `schedule_disabled`    | 경고 | 매일 백업이 필요하면 계획을 켜세요                                                                                                                                                        |
| `no_backup_yet`        | 경고 | 첫 번째 백업을 만드세요                                                                                                                                                                   |
| `backup_stale`         | 위험 | 계획이 켜져 있는데 가장 최신 지점이 26시간보다 오래되었습니다. 작업의 오류 코드와 에이전트 로그를 읽으세요                                                                                |
| `last_run_failed`      | 경고 | 마지막 백업이 실패했습니다. 오류 코드는 작업 목록에 있습니다                                                                                                                              |
| `vault_unavailable`    | 위험 | 볼륨이 마운트되지 않았거나, `vault.json`이 없거나, vault에 쓸 수 없거나, 암호화된 vault에 유효한 키가 없습니다(에이전트 로그에 `vault_key_missing` 또는 `vault_key_invalid`가 표시됩니다) |
| `vault_low_space`      | 경고 | 볼륨의 여유 공간이 10% 미만이거나 마지막 백업의 새 데이터 양의 두 배 미만입니다. 공간을 확보하거나 보관하는 지점 수를 줄이세요                                                            |
| `verify_failed`        | 위험 | 지점이 검증에 실패했습니다. 백업 보관소를 변경하지 말고 원인을 조사하세요                                                                                                                 |
| `never_deep_verified`  | 경고 | 8일이 넘도록 전체 검증이 없습니다. 에이전트가 실행 중인지 확인하거나 전체 검증을 시작하세요                                                                                               |

### CLI와 API로 {#status-cli}

```bash
arkvoryctl backup status
arkvoryctl backup jobs
arkvoryctl backup points
arkvoryctl backup status --json || echo "backup problem"
```

`backup status`는 위험 경고가 활성화되어 있는 동안 종료 코드 9로 끝나므로 모니터링에 사용할 수 있습니다. 이 명령에는 소유자 파일 키 또는 계정 관리자 세션이 필요합니다. [명령줄 클라이언트](../protocols/cli#backups)와 [TypeScript SDK](../protocols/sdk#backups)를 참조하세요. HTTP 작업은 [백업 API 참조](../api/reference/backups)에 있습니다.

Prometheus를 위해 API는 `arkvory_backup_last_success_timestamp_seconds`(가장 최신 지점의 T), `arkvory_backup_agent_last_seen_timestamp_seconds`, `code` 레이블이 있는 `arkvory_backup_warnings`를 제공합니다. [모니터링](./monitoring)을 참조하세요.

## 복원 {#restore}

복원은 **빈** 데이터베이스와 **빈** 스토리지 디렉터리에 씁니다. 실행 중인 설치 환경을 덮어쓰지 않습니다. 복원이 끝나면 복원된 데이터로 별도의 인스턴스를 시작하고 확인한 다음, 그 인스턴스로 이전 서버를 대체할지 결정하세요.

### 시작하기 전에 {#restore-prepare}

- **프로그램.** 복원 명령은 설치된 릴리스의 프로그램 `arkvory-backup`입니다. 설치 환경의 Node.js로 시작하세요.
  - Linux 패키지: `/opt/proanima-arkvory/runtime/node /opt/proanima-arkvory/releases/VERSION/apps/backup/dist/main.js COMMAND`
  - Windows 그래픽 설치 프로그램: `& "$root\runtime\node.exe" "$root\releases\VERSION\apps\backup\dist\main.js" COMMAND`

  `VERSION`은 `installation.json`에 있는 설치된 버전입니다. 이 페이지의 나머지 부분에서 `arkvory-backup`은 이 전체 명령줄을 가리킵니다. Docker Compose 사용자는 릴리스 이미지의 컨테이너에서 같은 프로그램을 실행합니다. 스크립트 설치에서는 `runtime/` 아래의 Node.js 폴더를 사용하세요.

- **릴리스.** 해당 지점을 만든 릴리스 또는 그보다 새로운 릴리스를 사용하세요. 더 새로운 릴리스에서 만든 지점은 `schema_mismatch`로 거부됩니다.
- **계정.** 백업 보관소를 읽을 수 있는 계정으로 명령을 실행하세요. Linux에서 백업 보관소는 `arkvory` 소유이고 모드가 0700이므로 `sudo -u arkvory`를 사용하세요. Windows에서는 관리자 권한 PowerShell을 사용하세요. 새 스토리지 디렉터리는 결국 API를 실행할 계정의 소유가 되어야 합니다.
- **키.** 암호화된 vault에는 키가 필요합니다. 아래의 모든 명령에 복구 키트나 키 파일을 `--key-file FILE`로 주거나 `ARKVORY_BACKUP_VAULT_KEY_FILE`을 설정하세요. 키는 언제나 파일이며 인수가 아닙니다.
- **대상.** 빈 데이터베이스를 만드세요. 예: `CREATE DATABASE arkvory_restore OWNER arkvory;`. 스토리지 디렉터리는 존재하지 않거나 비어 있는 디렉터리로 고르세요. 백업 보관소와 다른 볼륨에 있어야 하고, 원본 스토리지 안에 있으면 안 됩니다.
- **데이터베이스 URL.** 인수가 아니라 환경 변수로 전달하세요. 인수는 프로세스 목록에서 보이기 때문입니다.

### 복원 단계별 안내 {#restore-steps}

1. 복원 지점을 나열하고 하나를 고르세요. 지점 ID를 복사하세요.

   ```bash
   arkvoryctl backup points
   arkvory-backup list --vault /mnt/backup/arkvory
   ```

2. 지점을 전체 검증하세요.

   ```bash
   arkvory-backup verify --vault /mnt/backup/arkvory --point POINT_ID --deep
   ```

3. 환경 변수에 대상 데이터베이스를 설정하세요.

   ```bash
   export ARKVORY_RESTORE_DATABASE_URL='postgresql://arkvory@db.example/arkvory_restore'
   ```

4. `--yes` **없이** 복원을 실행하세요. 이것은 사전 점검(dry run)입니다. 지점, 파일 해시, 스키마 버전, 대상이 비어 있는지를 확인하며 아무것도 쓰지 않습니다.

   ```bash
   arkvory-backup restore --vault /mnt/backup/arkvory --point POINT_ID --storage /srv/arkvory-restore
   ```

   점검을 통과하면 종료 코드 0과 로그 줄 `backup.restore.planned`로 끝납니다.

5. 같은 명령을 `--yes`와 함께 실행하세요. 보고서 파일을 남기려면 `--report`를 추가하세요. 이 파일은 아직 존재하지 않아야 합니다.

   ```bash
   arkvory-backup restore --vault /mnt/backup/arkvory --point POINT_ID --storage /srv/arkvory-restore --yes --report /root/restore-report.json
   ```

   복원은 `verify`, `content`, `schema`, `tables`, `migrate`, `done` 단계를 거칩니다. 모든 파일을 복사하며 SHA-256을 확인하고, 스키마를 만들고, 모든 테이블을 하나의 트랜잭션으로 불러오고, 정규화를 적용한 다음 나머지 마이그레이션을 실행합니다. 보고서에는 식별자와 개수만 들어 있으며 경로나 자격 증명은 들어 있지 않습니다.

6. 복원된 데이터로 별도의 API 인스턴스를 시작하세요. 새 데이터베이스의 `ARKVORY_DATABASE_URL`, 새 디렉터리의 `ARKVORY_DATA_DIR`, 자체 `ARKVORY_KEYS_FILE`, 다른 포트를 사용합니다. `/health/ready`가 응답하는지, 로그인할 수 있는지, 카탈로그가 완전한지, 확인용 파일이 같은 SHA-256으로 다운로드되는지 확인하세요.

복원이 실패하면 대상 데이터베이스와 디렉터리를 삭제하고 다시 만드세요. 비어 있지 않은 대상은 기존 데이터를 보호하기 위해 `target_not_empty`로 거부됩니다.

### 복원이 변경하는 내용 {#after-restore}

복원은 정해진 변경을 적용합니다. 새 인스턴스가 진행 중이던 작업을 이어 가지 않고 이전 자격 증명을 활성화하지 않게 하기 위해서입니다.

- 끝나지 않은 업로드는 취소되고 할당량이 반환됩니다. 대기 중이거나 실행 중인 완료 작업은 코드 `conflict`로 실패 처리됩니다. 끝나지 않은 승격은 폐기됩니다.
- 세션은 복원되지 않습니다. 모두 다시 로그인합니다.
- 모든 개인용 액세스 토큰이 폐기되고, 모든 서비스 키는 `revoked`가 됩니다. 새 키를 발급하세요.
- 모든 리포지토리에서 스토리지 보존과 물리적 정리가 꺼집니다. 의도적으로 다시 켜세요.
- 백업이 꺼지고 백업 보관소가 구성되지 않은 상태가 됩니다. 다운로드 링크와 읽기 게이트웨이 설정은 이어지지 않습니다.
- 계정, 그룹, 권한 부여는 T 시점의 비밀번호 해시와 함께 유지됩니다. T 이후에 변경한 비밀번호는 이전 비밀번호로 다시 로그인되므로, 비밀번호는 자체 정책에 따라 재설정하세요.
- 복구 키와 파일 키는 복원된 데이터를 실행하는 설치 환경의 키 파일에서 가져옵니다.
- 미러는 현재 위치를 유지하지만 미러 설정은 `config/`에 있습니다. 다시 연결하세요. [미러](./mirrors)를 참조하세요.
- 보안 감사 항목 `backup.restored`가 지점과 개수를 기록합니다.

### 다른 서버로 이전 {#move-server}

백업을 사용해 설치 환경을 다른 서버로 옮길 수 있습니다.

1. 새 서버에 같은 릴리스 또는 더 새로운 릴리스의 Arkvory를 설치하세요. [설치 방식 선택](../install/index)을 참조하세요.
2. 같은 백업 보관소 또는 그 사본을 새 서버에 연결하세요. 이미 있는 백업 보관소에는 `--init-vault`를 사용하지 마세요.
3. 위에 설명한 대로 가장 최신 지점을 새 빈 데이터베이스와 빈 디렉터리에 복원하고 결과를 테스트하세요.
4. 설치 환경이 복원된 데이터를 가리키도록 `config/runtime.json`에 `ARKVORY_DATABASE_URL`과 `ARKVORY_DATA_DIR`을 설정하고 서비스를 다시 시작하세요. [구성](../install/configuration)을 참조하세요.
5. 새 키를 발급하고, 보존 정책과 정리 정책을 다시 설정하고, 미러와 백업 계획을 연결하고, 클라이언트에 새 주소를 알리세요.

마지막 두 단계는 수동이며 안내형 전환 절차에 포함되지 않습니다. 먼저 예비 서버에서 전체 순서를 예행연습하세요. 이전 서버에서 T 이후에 이루어진 변경은 사라지므로, 클라이언트가 옮겨 가기 전에 이전 서버를 중지하세요.

## 복원을 정기적으로 테스트 {#test-restore}

한 번도 복원해 보지 않은 백업은 희망에 불과합니다. 제품은 지점의 바이트를 검증하지만 테스트 복원을 기록하지는 않습니다. 날짜와 결과는 직접 기록하세요.

최소한 다음 시점에 테스트하세요.

- 첫 번째 백업 후.
- 데이터베이스 스키마를 변경하는 업데이트마다.
- 분기마다처럼 직접 정한 일정에 따라.

각 테스트는 예비 서버 또는 임시 데이터베이스에서 [복원 단계별 안내](#restore-steps)를 따르며, 로그인, 카탈로그 확인, 확인용 파일 다운로드로 마칩니다. 테스트가 끝나면 임시 데이터베이스와 디렉터리를 삭제하세요.

## 종료 코드와 로그 줄 {#exit-codes}

### 종료 코드 {#exit-codes-table}

`arkvory-backup` 프로그램은 표준 출력에 줄마다 JSON 객체 하나를 쓰고, 실패하면 표준 오류에 안내 줄을 하나 씁니다.

| 코드 | 의미                                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | 성공. `--yes` 없는 `restore`에서는 점검을 통과했다는 뜻입니다                                                                            |
| 1    | 실행 실패: 데이터베이스나 디스크를 사용할 수 없음, 리스 또는 스냅샷 손실, 백업 보관소 또는 대상이 가득 참. 복원 지점은 손상되지 않습니다 |
| 2    | 인수나 환경 변수가 잘못되었습니다                                                                                                        |
| 3    | 안전 검사가 거부함: `vault.json` 없음, 디렉터리 겹침, 비어 있지 않은 대상, 지원하지 않는 스키마, 해당 지점 없음                          |
| 4    | 무결성 실패: 해시, 누락된 파일, 변경된 매니페스트. 원인을 파악하기 전에는 백업 보관소를 그대로 두세요                                    |
| 5    | 사용 중: 다른 백업이나 유지 관리가 실행 중이거나 삭제가 제때 끝나지 않았습니다. 나중에 다시 시도하세요                                   |

### 로그 줄 {#log-lines}

모든 줄의 `component`는 `backup`입니다. 경로, URL, 시크릿은 기록되지 않습니다. 가장 유용한 줄은 다음과 같습니다.

| 코드                                                                                        | 의미                                                                                                              |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `backup.phase`                                                                              | 백업이 다음 단계로 이동함: `barrier`, `pins`, `tables`, `blobs`, `manifest`, `commit`, `done`                     |
| `backup.capture.completed`                                                                  | 백업이 끝남. 필드: `pointId`, `outcome`, `blobs`, `copied`, `reused`, `copiedBytes`, `contentBytes`, `durationMs` |
| `backup.point`                                                                              | `list` 출력의 복원 지점 하나                                                                                      |
| `backup.verify.point`, `backup.verify.problem`                                              | 검증 결과, 그리고 `errorCode`와 함께 표시되는 각 문제                                                             |
| `backup.restore.phase`, `backup.restore.planned`, `backup.restore.completed`                | 복원 진행 상황과 결과. 행 개수와 위에 나열한 변경 개수를 포함합니다                                               |
| `backup.failed`                                                                             | 명령이 실패함. `errorCode`를 읽으세요                                                                             |
| `backup.agent.started`, `.standby`, `.lease_acquired`, `.lease_lost`, `.stopped`, `.failed` | 에이전트의 수명 주기                                                                                              |
| `backup.request.started`, `.done`, `.failed`, `.requeued`                                   | 에이전트의 작업. `kind`와 `errorCode`를 포함합니다                                                                |
| `backup.schedule.due`                                                                       | 계획이 백업을 시작함                                                                                              |
| `backup.retention.applied`                                                                  | 보존이 끝남. 필드: `forgotten`, `blobs`, `freedBytes`                                                             |

에이전트 로그는 Linux에서 `journalctl -u arkvory-backup`, Windows에서 설치 루트의 `logs\`, Compose에서 `docker compose logs backup`으로 읽으세요.

### 오류 코드 {#error-codes}

| `errorCode`                                              | 종료 코드 | 해야 할 일                                                                                                              |
| -------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------- |
| `vault_missing`                                          | 3         | 디렉터리에 `vault.json`이 없습니다. 볼륨을 마운트하거나 `vault init`을 한 번 실행하세요                                 |
| `vault_key_missing`                                      | 3         | vault가 암호화되어 있는데 키가 주어지지 않았습니다. `--key-file FILE` 또는 `ARKVORY_BACKUP_VAULT_KEY_FILE`을 사용하세요 |
| `vault_key_invalid`                                      | 3         | 이 키로는 vault를 열 수 없습니다. 파일, vault, 또는 슬롯이 제거되었는지 확인하세요. 오타는 키의 체크섬으로 발견됩니다   |
| `unsafe_path`                                            | 3         | 백업 보관소, 스토리지, 복원 대상을 서로 다른 디렉터리 트리에 두세요                                                     |
| `target_not_empty`                                       | 3         | 복원은 빈 데이터베이스와 빈 디렉터리에만 씁니다                                                                         |
| `schema_mismatch`                                        | 3         | 지점이 릴리스보다 새롭거나 지원되는 복원 범위보다 오래되었습니다. 다른 릴리스를 사용하세요                              |
| `upgrade_required`                                       | 3         | 설치 환경의 모든 API 및 유지 관리 프로세스를 업데이트하세요                                                             |
| `point_not_found`, `storage_mismatch`                    | 3         | 지점 ID가 잘못되었거나 `ARKVORY_DATA_DIR`이 이 설치 환경의 초기화된 스토리지 디렉터리가 아닙니다                        |
| `integrity_mismatch`, `invalid_manifest`, `blob_missing` | 4         | 백업 보관소를 그대로 두세요. `verify --deep`을 실행하고 원인을 조사하세요                                               |
| `busy`, `barrier_timeout`                                | 5         | 다른 작업이 실행 중입니다. 나중에 다시 시도하세요                                                                       |
| `vault_full`, `storage_full`                             | 1         | 공간을 확보하세요. 이전 지점은 손상되지 않습니다                                                                        |
| `attempts_exhausted`                                     | 3         | 이 요청이 5번의 시도를 모두 사용했습니다. 새 백업을 시작하세요                                                          |

## 제한 사항 {#limits}

- 설치 환경마다 계획 하나와 백업 보관소 하나만 사용할 수 있습니다. 백업 보관소는 디스크 또는 마운트된 공유에 있는 디렉터리이며, S3나 오프사이트, 변경 불가(immutable) 프로필은 없습니다.
- 암호화는 내용과 카탈로그를 숨기지만 파일 이름, 크기, 복원 지점의 수는 숨기지 않습니다. 키를 잃으면 백업을 잃습니다. 키 슬롯을 제거해도 이전 지점이 다시 암호화되지는 않습니다.
- 백업 작업을 일시 중지하거나 취소할 수 없으며, 콘솔에는 복원 마법사나 복원 테스트 상태가 없습니다.
- 복원에는 빈 대상이 필요하며, 복원된 데이터로의 전환은 수동 단계입니다.
- 백업 에이전트는 고가용성 시스템이 아닙니다. 두 번째 에이전트는 예비로 대기할 뿐입니다.

## 관련 페이지 {#related-pages}

- [설치 방식 선택](../install/index)
- [업데이트](../install/updates)
- [스토리지](./storage)
- 두 번째 사이트를 위한 [미러](./mirrors)
- [모니터링](./monitoring)
- [자가 복구](./self-healing)
- [문제 해결](./troubleshooting)
- [환경 변수](../reference/environment#backups)
