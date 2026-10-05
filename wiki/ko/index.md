---
layout: home
title: Arkvory
titleTemplate: 문서
hero:
  name: Arkvory
  text: 빌드, 패키지, 대용량 파일을 위한 자체 리포지토리
  tagline: CI 파이프라인, 배포 에이전트, 게임 팀이 함께 쓰는 서버 하나. 크기에 제한 없는 재개 가능한 업로드, 리포지토리별 액세스 제어, 백업, 미러, 11개 언어로 제공되는 콘솔을 지원합니다.
  image:
    src: /arkvory.svg
    alt: ''
  actions:
    - theme: brand
      text: 시작하기
      link: /ko/guide/
    - theme: alt
      text: 설치
      link: /ko/install/
    - theme: alt
      text: HTTP API
      link: /ko/api/
features:
  - title: 크기 제한 없는 파일
    details: 수십 GB의 파일도 파트로 나누어 업로드하며, 연결이 끊겨도 이어서 진행합니다. 다운로드는 Range 요청으로 재개됩니다. 모든 파일은 SHA-256으로 검증합니다.
    link: /ko/use/transfers
  - title: 패키지와 이미지
    details: 버전이 있는 UPack 패키지, Docker와 Podman용 컨테이너 이미지, 게임 에셋을 위한 Git LFS, npm 및 Unity 패키지, 경로로 접근하는 일반 파일을 지원합니다.
    link: /ko/protocols/
  - title: 근거를 설명할 수 있는 액세스 제어
    details: 계정, 그룹, 개인용 액세스 토큰, 필요한 리포지토리와 작업으로만 범위를 제한한 키를 가진 서비스 계정을 제공합니다. 로그인과 액세스 변경은 감사 기록에 남습니다.
    link: /ko/use/accounts
  - title: 스테이지와 승격
    details: 빌드에 테스트 완료나 릴리스 표시를 달고, 다른 리포지토리로 승격하고, 배포 에이전트가 스테이지를 기준으로 최신 빌드를 가져가도록 할 수 있습니다.
    link: /ko/use/promotion
  - title: 백업과 미러
    details: 로컬 디스크나 네트워크 공유에 예약된 검증 백업을 만듭니다. 미러는 두 번째 사이트를 동기화된 상태로 유지하며, 첫 번째 사이트를 잃으면 서비스를 넘겨받습니다.
    link: /ko/operate/backups
  - title: 스스로 운영
    details: Windows 서비스, Linux 패키지, Docker Compose를 지원합니다. 서비스는 충돌이나 응답 중단 후 다시 시작되며, 업데이트는 서명된 상태로 도착해 최신 백업을 만든 뒤에 설치됩니다.
    link: /ko/operate/self-healing
---
