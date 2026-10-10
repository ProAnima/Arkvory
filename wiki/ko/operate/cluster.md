---
title: 고가용성 클러스터
description: 한 사이트의 Linux 서버 두세 대에서 모든 데이터의 동기 복사본, 자동 장애 조치, 필수 펜싱과 함께 Arkvory를 실행합니다.
---

# 고가용성 클러스터

Arkvory 클러스터는 사이트의 서버 한 대가 장애를 일으켜도 계속 동작합니다. Linux 서버 두세 대가 하나의 블록 볼륨에 대한 동일한 복사본을 가집니다. 한 서버가 **활성**이며 Arkvory를 실행합니다. 이 서버가 장애를 일으키면 클러스터 관리자가 이를 격리(펜싱)하고 같은 데이터를 가진 다른 서버에서 Arkvory를 시작합니다.

클러스터는 한 사이트 안에서 서버, 디스크 또는 네트워크 링크가 손실되는 경우를 보호합니다. 사이트 전체가 손실되는 경우는 보호하지 않습니다. 이를 위해서는 다른 사이트에 [미러](./mirrors)를, 클러스터 밖에 [백업](./backups)을 두십시오.

## 동작 방식 {#how-it-works}

- **하나의 볼륨, 동기 복사본.** DRBD 9는 볼륨의 모든 쓰기를 쓰기가 완료되기 전에 다른 서버로 복사합니다(프로토콜 C). 설치 전체가 볼륨 위에 있습니다. 데이터베이스, 스토리지, 구성, 릴리스가 모두 포함됩니다. 카탈로그와 파일 바이트는 서로 어긋나지 않습니다.
- **Pacemaker가 Arkvory를 실행할 위치를 결정합니다.** Corosync와 Pacemaker가 쿼럼을 유지하고, 활성 서버를 고르며, 다음 순서로 시작합니다. 볼륨, 파일 시스템, 데이터베이스, `arkvory-replica`, API, 워커, 백업 에이전트, 업데이트 타이머, 가상 IP 주소. Arkvory에는 자체 선출이 없습니다.
- **펜싱은 필수입니다.** 다른 서버가 인계받기 전에 Pacemaker는 전원 장치(IPMI, iDRAC, iLO, Redfish, PDU) 또는 하이퍼바이저를 통해 장애 서버의 전원을 끕니다. 펜싱이 없으면 두 서버가 동시에 쓸 수 있습니다. 펜싱이 없는 클러스터는 시작되지 않습니다.
- **확인된 모든 쓰기에 복사본 두 개.** Arkvory는 쓰기가 완전한 복사본 두 개 이상에 있을 때만 성공으로 응답합니다([쓰기와 복사본](#writes) 참조). 복사본이 없으면 쓰기는 멈추고 읽기는 계속됩니다.

| 프로필 | 데이터 서버 | 감시 서버                                                                     | 데이터 서버 한 대가 장애를 일으킬 때                     |
| ------ | ----------- | ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| `ha-2` | 2           | 필수: 데이터가 없고 `corosync-qnetd`와 DRBD 타이브레이커를 실행하는 작은 서버 | 서버가 돌아오거나 운영자가 결정할 때까지 쓰기가 멈춥니다 |
| `ha-3` | 3           | 사용 안 함: 서버 세 대가 다수결로 결정합니다                                  | 쓰기가 계속됩니다. 복사본 두 개가 남습니다               |

`ha-3`이 권장 프로필입니다. `ha-2`는 비용이 더 적고, 데이터를 복사본 하나에만 두는 대신 쓰기를 정직하게 멈춥니다.

클러스터는 네이티브 Linux 패키지용입니다. Windows 설치와 Docker Compose는 미러 및 백업과 함께 사용하는 독립 서버로 남습니다.

## 쓰기와 복사본 {#writes}

**완전한 복사본**은 최신 상태인 활성 서버의 로컬 디스크에, 연결되어 있고 복제 중이며 최신 상태인 다른 모든 데이터 서버를 더한 것입니다. 재동기화 중인 서버는 최신 상태가 될 때까지 포함되지 않습니다. 감시 서버에는 데이터가 없으므로 포함되지 않습니다.

데이터를 변경하는 모든 요청(HTTP API, 컨테이너 레지스트리, Git LFS, npm)은 두 번 확인됩니다.

- 실행되기 **전**에, 마지막 1초 동안의 복사본을 기준으로 확인합니다.
- 데이터가 커밋되고 동기화된 **후**에, 볼륨을 새로 읽은 값을 기준으로 확인합니다.

쓰기에 필요한 수보다 완전한 복사본이 적으면 클라이언트는 코드 `unavailable`, 사유 `replication_degraded`, `Retry-After` 헤더와 함께 HTTP 503을 받으며, 2xx는 절대 받지 않습니다. 업로드 완료 작업의 상태(`GET /api/v1/jobs/{id}`)도 같은 방식으로 확인합니다. 이 상태가 대용량 업로드가 게시되었음을 클라이언트에 알려 주기 때문입니다.

커밋 후의 503은 해당 작업이 복사본 하나에만 있을 수 있음을 뜻합니다. 같은 `Idempotency-Key`로 요청을 반복하십시오. 반복 요청은 기존 결과를 반환하며, 복사본 두 개가 다시 존재하게 되면 그 2xx가 이를 확정합니다.

쓰기가 멈춘 동안에도 읽기, 다운로드, 콘솔, 로그인과 로그아웃, 피드백, Git LFS 배치 요청은 동작합니다.

콘솔에 로그인한 관리자는 쓰기가 멈춰 있거나 단일 복사본 결정이 활성인 동안 배너를 봅니다.

## 요구 사항 {#requirements}

- 같은 Linux 배포판, 같은 Arkvory 패키지 버전을 사용하는 데이터 서버 두세 대, 그리고 각 서버에 볼륨 전체 크기의 디스크(또는 논리 볼륨). 전체 스토리지에 데이터베이스를 더한 크기로 계획하십시오.
- `ha-2`에는 감시 서버로 쓸 세 번째 작은 서버. 데이터용 디스크가 필요 없고 Arkvory를 실행하지 않습니다.
- 서버 간의 낮은 지연 시간의 네트워크. 모든 쓰기는 다른 서버를 기다리므로 지연 시간이 각 쓰기에 더해집니다. 가능하면 전용 링크를 사용하십시오.
- DRBD 9(커널 모듈과 `drbd-utils` 9. 많은 배포판이 이전 8.4 모듈을 제공하므로 LINBIT 패키지를 사용하십시오), `pacemaker`, `pcs`, `corosync`, `resource-agents`(Ubuntu에서는 `resource-agents-base`와 `resource-agents-extra`), 하드웨어에 맞는 펜스 에이전트. `ha-2`의 경우 데이터 서버에 `corosync-qdevice`, 감시 서버에 `corosync-qnetd`.
- 각 데이터 서버용 펜스 장치와 그 자격 증명.
- 서버 네트워크의 사용하지 않는 IP 주소 하나. 클라이언트는 이 가상 주소에 연결합니다.
- 가상 주소용 TLS 인증서. 모든 서버가 같은 경로에서 찾을 수 있도록 인증서와 키를 볼륨에 두십시오.

## 클러스터 구축 {#build}

아래 명령은 기본 리소스 이름 `arkvory`, 설치 디렉터리 `/opt/proanima-arkvory`, 그리고 백업 디스크로 `/dev/vg0/arkvory`를 사용합니다. root로 실행하십시오.

1. 모든 데이터 서버에서 Arkvory 패키지를 설치하지 않고 압축만 풉니다. 이렇게 하면 파일과 `arkvory` 명령이 추가되며 `/opt/proanima-arkvory`에는 아무것도 만들어지지 않습니다.

   ```bash
   dpkg --unpack Arkvory-amd64.deb
   ```

2. 데이터 서버 한 대에서 계획을 만듭니다. DRBD 리소스와 Pacemaker 명령을 검토할 수 있도록 디렉터리에 씁니다.

   ```bash
   arkvory cluster-plan --cluster ha-2 \
     --nodes node-a=10.0.0.11,node-b=10.0.0.12 --witness witness=10.0.0.13 \
     --disk /dev/vg0/arkvory --fence-agent fence_ipmilan \
     --virtual-ip 10.0.0.100/24 --output /root/arkvory-plan
   ```

   `ha-3`의 경우 `--nodes`에 서버 세 대를 나열하고 `--witness`는 생략합니다. 선택 사항: `--cluster-resource`, `--drbd-minor`(기본값 0), `--drbd-port`(기본값 7789), `--filesystem`(`xfs` 또는 `ext4`, 기본값 `xfs`). 이름은 서버의 호스트 이름이어야 합니다.

3. 감시 서버를 포함한 모든 서버의 `/etc/drbd.d/`에 `arkvory.res`를 복사합니다. 데이터 서버에서 메타데이터를 만들고 모든 서버에서 리소스를 올립니다.

   ```bash
   drbdadm create-md arkvory   # data servers only
   drbdadm up arkvory          # every server
   ```

   감시 서버에서는 재시작 후 타이브레이커가 돌아오도록 `systemctl enable drbd@arkvory.service`도 실행하십시오.

   이 계획은 돌아오는 복사본이 쓰기 부하 중에도 최소 20 MB/s, 최대 1 GB/s로 재동기화되도록 합니다. `disk` 섹션의 `c-min-rate`와 `c-max-rate`를 복제 링크가 감당할 수 있는 값으로 설정하십시오.

4. 첫 번째 데이터 서버에서 이 서버를 프라이머리로 만들고 파일 시스템을 만든 다음 마운트합니다. 비어 있는 새 디스크라면 먼저 초기 동기화를 건너뜁니다.

   ```bash
   drbdadm new-current-uuid --clear-bitmap arkvory/0
   drbdadm primary arkvory
   mkfs.xfs /dev/drbd0
   mkdir -p /opt/proanima-arkvory && mount /dev/drbd0 /opt/proanima-arkvory
   ```

5. 마운트된 볼륨에 Arkvory를 설치하고, TLS 파일을 볼륨에 두고, 클러스터 모드를 켭니다.

   ```bash
   dpkg --configure proanima-arkvory
   install -d -m 0750 -o root -g arkvory /opt/proanima-arkvory/config/tls
   install -m 0644 tls.crt /opt/proanima-arkvory/config/tls/tls.crt
   install -m 0640 -g arkvory tls.key /opt/proanima-arkvory/config/tls/tls.key
   arkvory configure --root /opt/proanima-arkvory --tls-cert /opt/proanima-arkvory/config/tls/tls.crt --tls-key /opt/proanima-arkvory/config/tls/tls.key --listen-host 0.0.0.0
   arkvory configure --root /opt/proanima-arkvory --cluster ha-2
   ```

   `configure --cluster`는 설치 디렉터리가 마운트된 DRBD 장치인지, 이 서버가 프라이머리인지, 모든 복사본이 완전한지 확인합니다. 또한 `arkvory-replica`를 시작하고, Arkvory가 완전한 복사본 두 개일 때만 쓰기를 확인하도록 하며, Arkvory 서비스의 자동 시작을 끕니다. 이제부터는 Pacemaker가 서비스를 시작합니다. 단계가 실패하면 독립 구성이 복원됩니다.

6. 첫 번째 서버에서 Arkvory를 중지하고 볼륨을 해제합니다.

   ```bash
   systemctl stop arkvory-update.timer arkvory-backup arkvory-worker arkvory-api arkvory-replica arkvory-database
   umount /opt/proanima-arkvory && drbdadm secondary arkvory
   ```

7. 나머지 각 데이터 서버에서 차례로 볼륨을 가져와 서버를 준비하고 볼륨을 다시 해제합니다.

   ```bash
   drbdadm primary arkvory
   mkdir -p /opt/proanima-arkvory && mount /dev/drbd0 /opt/proanima-arkvory
   arkvory cluster-node --root /opt/proanima-arkvory --cluster-resource arkvory
   dpkg --configure proanima-arkvory
   systemctl stop arkvory-update.timer arkvory-backup arkvory-worker arkvory-api arkvory-replica arkvory-database
   umount /opt/proanima-arkvory && drbdadm secondary arkvory
   ```

   `cluster-node`는 첫 번째 서버와 같은 사용자 ID와 그룹 ID로 서비스 계정을 만들고(볼륨의 파일은 이 계정의 소유입니다) 같은 서비스를 설치하며, 어느 것도 자동으로 시작되지 않습니다. 이미 다른 ID로 계정이 있으면 명령이 멈추고 설정해야 할 ID를 알려 줍니다.

8. 데이터 서버에서 `pcs`로 Corosync 클러스터를 설정합니다(`pcs host auth`, `pcs cluster setup`, `pcs cluster start --all`). Debian과 Ubuntu에서는 먼저 각 데이터 서버에서 `pcs cluster destroy`를 실행하십시오. 패키지가 샘플 Corosync 구성을 설치하는데, `pcs`가 이를 기존 클러스터로 간주하기 때문입니다. `pcs cluster enable`은 실행하지 마십시오. 펜싱된 서버는 사용자가 시작할 때만 다시 합류해야 합니다. `ha-2`의 경우 감시 서버도 인증하고 그 서버에서 `pcs qdevice setup model net --enable --start`를 실행하십시오. Debian과 Ubuntu에서는 패키지가 이미 자체 서비스 계정용으로 쿼럼 장치를 설정해 두었으므로, 그곳에서는 대신 `systemctl enable --now corosync-qnetd`를 실행하십시오.

9. `/root/arkvory-plan/pacemaker.sh`를 엽니다. 각 `<agent parameters: …>`를 펜스 장치의 매개변수로 바꾸십시오. 장치 주소, 로그인, 비밀번호 파일 또는 키, 그리고 해당 서버의 플러그 또는 포트입니다. 그런 다음 데이터 서버 한 대에서 스크립트를 실행합니다.

   ```bash
   sh /root/arkvory-plan/pacemaker.sh
   ```

   스크립트는 전체 구성을 파일에 만든 뒤 한 번에 적용합니다. 펜싱, 쿼럼 정책, DRBD 리소스, Arkvory 그룹과 그 제약 조건이 포함됩니다.

10. 활성 서버에서 클러스터를 확인합니다.

    ```bash
    arkvory cluster-check --root /opt/proanima-arkvory
    ```

    이 명령은 쿼럼, 펜싱 활성화 여부, 모든 서버의 펜스 장치 보유 여부, DRBD의 쿼럼 및 펜싱 설정, 모든 복사본의 완전성, 그리고 Arkvory가 정확히 한 서버에서 실행 중인지를 확인합니다. 확인이 실패하면 오류로 종료합니다.

11. 펜싱을 한 번 검증합니다. 각 대기 서버를 펜싱하고 다시 돌아오게 하십시오([펜싱 테스트](#fence-test) 참조).

클라이언트와 DNS 이름이 가상 주소를 가리키게 하십시오.

## 일상 운영 {#operation}

볼륨이 마운트된 활성 서버에서 root로 다음 명령을 실행하십시오.

| 명령                                                                      | 기능                                                                               |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `arkvory cluster-status --root <dir>`                                     | 프로필, 이 서버의 역할, 완전한 복사본 수와 필요한 수, 운영자 결정을 JSON으로 출력  |
| `arkvory cluster-check --root <dir>`                                      | 정상 클러스터의 모든 점검을 수행하며, 하나라도 실패하면 오류로 종료                |
| `arkvory cluster-switchover --root <dir> --to <server>`                   | Arkvory를 다른 데이터 서버로 계획적으로 이동. 모든 복사본이 완전하지 않으면 거부됨 |
| `arkvory cluster-fence-test --root <dir> --node <standby>`                | 대기 서버를 펜싱하여 펜스 장치를 검증. 활성 서버는 거부됨                          |
| `arkvory cluster-single-copy --root <dir> --until <time> --reason <text>` | 지정한 시각까지 복사본 하나로 쓰기를 허용. [단일 복사본](#single-copy) 참조        |

`pcs status`는 Pacemaker가 보는 클러스터를 보여 줍니다.

### 계획된 스위치오버 {#switchover}

`cluster-switchover`는 Pacemaker에 그룹을 옮기도록 요청하고, Arkvory가 대상에서 실행될 때까지 최대 5분을 기다린 다음 임시 배치 규칙을 제거합니다. 이동하는 동안 이전 서버로의 연결이 끊기며, 클라이언트는 요청을 반복합니다. Arkvory는 스스로 되돌아가지 않습니다.

### 펜싱 테스트 {#fence-test}

`cluster-fence-test`는 대기 서버를 펜스 장치로 재시작합니다. 재시작 후 그 서버에서 `pcs cluster start`로 클러스터를 시작하십시오. 클러스터 서비스는 재시작 후 자동으로 시작되지 않으므로([클러스터 구축](#build)의 8단계) 펜싱된 서버는 사용자 없이는 다시 합류하지 않습니다.

### 업데이트 {#updates}

모든 데이터 서버에 새 패키지를 설치하십시오. 대기 서버에서는 릴리스가 볼륨에 있으므로 패키지가 프로그램 파일만 교체합니다. 활성 서버에서는 패키지가 릴리스를 적용합니다. Arkvory가 Pacemaker에 그룹을 건드리지 말라고 알리고, 서비스를 중지하고, 마이그레이션하고, 서비스를 시작하고, 준비될 때까지 기다린 다음 그룹을 돌려줍니다. 활성 서버에서는 자동 업데이트도 같은 방식으로 동작합니다.

클러스터 서버에서 `systemctl`로 Arkvory 서비스를 시작하거나 중지하지 마십시오. Pacemaker가 이를 장애로 간주합니다. 전체 서비스를 계획적으로 중지하려면 `pcs resource disable arkvory`와 `pcs resource enable arkvory`를 사용하십시오.

## 장애 {#failures}

| 상황                                                              | `ha-2`                                                                                                             | `ha-3`                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| 대기 서버가 장애를 일으킴                                         | 펜싱됩니다. 읽기는 계속되고, 쓰기는 503 `replication_degraded`를 받습니다                                          | 펜싱됩니다. 읽기와 쓰기가 계속됩니다                                  |
| 활성 서버가 장애를 일으킴                                         | 펜싱되고 Arkvory가 다른 서버에서 시작됩니다. 읽기는 복구되고, 쓰기는 두 번째 복사본을 기다립니다                   | 펜싱되고 Arkvory가 다른 서버에서 시작됩니다. 읽기와 쓰기가 복구됩니다 |
| 데이터 서버 간 네트워크 분할                                      | 감시 서버가 한쪽에 쿼럼을 줍니다. 다른 쪽은 펜싱됩니다. 쓰기 주체가 둘이 되는 일은 없습니다                        | 다수 쪽이 계속되고 다른 서버는 펜싱됩니다                             |
| 구성원 세 개 중 두 개가 장애(ha-2: 데이터 서버 한 대와 감시 서버) | 마지막 서버에는 쿼럼이 없으므로 Arkvory가 멈춥니다. 쿼럼 없는 쓰기 주체는 없습니다. 서버를 복구하십시오(아래 참조) | 데이터 서버 두 대에 대해 동일합니다                                   |
| 펜싱이 동작하지 않음                                              | 장애 조치가 없습니다. 펜싱이 성공할 때까지 Arkvory는 중지된 상태로 있습니다                                        | 동일합니다                                                            |

펜싱된 서버를 복구하려면:

1. 원인을 수리하고 서버를 시작합니다.
2. 그 서버에서 `pcs cluster start`를 실행합니다.
3. 볼륨이 변경된 블록을 재동기화합니다. 필요한 모든 복사본이 다시 완전해지면 쓰기가 자동으로 재개되며, `arkvory cluster-status`가 진행 상황을 보여 줍니다.

쿼럼을 잃은 후에는 돌아온 모든 서버에서 클러스터를 시작하십시오. Pacemaker는 가장 최신 복사본을 가진 서버에서 Arkvory를 다시 실행합니다. 마지막으로 쿼럼을 잃은 서버는 깨끗하게 중지하지 못했기 때문에 복귀하는 중에 한 번 더 펜싱될 수 있습니다. 재시작한 뒤 그 서버에서 클러스터를 다시 시작하십시오.

펜싱이 실패했다가 수리한 경우에는 Pacemaker가 다시 시도하도록 실행 중인 서버에서 실패한 시도를 정리하십시오: `pcs stonith history cleanup <server>`와 `pcs resource cleanup`.

### 단일 복사본 {#single-copy}

데이터 서버가 오랫동안 빠져 있고(예: 디스크 교체) 쓰기 중단의 비용이 위험보다 클 때, 운영자는 제한된 시간 동안 복사본 하나로 쓰기를 허용할 수 있습니다.

```bash
arkvory cluster-single-copy --root /opt/proanima-arkvory --until 2026-10-12T18:00:00Z --reason "disk replacement on node-b"
```

- 시각은 앞으로 7일 이내여야 합니다. 이 명령은 복사본이 부족한 동안에만 동작합니다.
- 결정이 활성인 동안 활성 서버를 잃으면 그 이후에 확인된 쓰기를 잃게 됩니다.
- 콘솔 배너, 메트릭 `arkvory_replication_required_copies`, 알림 `ArkvorySingleCopyWrites`가 이 결정을 보여 줍니다.
- 결정은 지정한 시각에, `--off`로, 또는 모든 복사본이 다시 완전해지는 즉시 저절로 끝납니다. 이후에 다시 손실이 생기면 쓰기가 다시 멈춥니다.

## 모니터링 {#monitoring}

쓰기가 멈춘 동안에도 활성 서버의 `GET /health/ready`는 200을 유지하므로 모니터가 정상 서버를 옮기지 않습니다. `writable` 필드는 `false`이고 `replication` 필드는 `copies`, `required`, `singleCopyUntil`을 보여 줍니다. 복사본을 읽을 수 없으면 `replication`은 `null`입니다. 독립 서버에는 `replication` 필드가 없습니다.

| 메트릭                                     | 의미                                                  |
| ------------------------------------------ | ----------------------------------------------------- |
| `arkvory_replication_copies`               | 마지막 점검 시점의 완전한 복사본 수                   |
| `arkvory_replication_required_copies`      | 쓰기에 필요한 복사본 수: 2, 단일 복사본 결정 중에는 1 |
| `arkvory_replication_writes_refused_total` | 503 `replication_degraded`로 응답한 쓰기 수           |
| `arkvory_replication_check_failures_total` | 복사본 상태 읽기에 실패한 횟수                        |

`deploy/monitoring/arkvory-alerts.yml`의 알림 규칙에는 `ArkvoryReplicationDegraded`, `ArkvorySingleCopyWrites`, `ArkvoryReplicationCheckFailing`이 포함됩니다. 클러스터 자체도 함께 감시하십시오. `arkvory cluster-check`를 주기적으로 실행해 종료 코드로 알림을 보내거나, Pacemaker 설치의 모니터링을 사용하십시오. [모니터링](./monitoring)을 참조하십시오.

## 백업 {#backups}

백업 에이전트는 그룹의 일부로 활성 서버에서만 실행됩니다. 백업 보관소는 클러스터 볼륨 밖에 두십시오. 예를 들어 NAS가 있습니다. [백업](./backups)을 참조하십시오.
