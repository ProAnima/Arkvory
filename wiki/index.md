---
layout: home
title: Arkvory
titleTemplate: Documentation
hero:
  name: Arkvory
  text: Your own repository for builds, packages and large files
  tagline: One server for CI pipelines, deployment agents and game teams. Resumable uploads of any size, access by repository, backups, mirrors and a console in eleven languages.
  image:
    src: /arkvory.svg
    alt: ''
  actions:
    - theme: brand
      text: Get started
      link: /guide/
    - theme: alt
      text: Install
      link: /install/
    - theme: alt
      text: HTTP API
      link: /api/
features:
  - title: Files of any size
    details: Uploads of tens of gigabytes go in parts and continue after a lost connection. Downloads resume with ranges. Every file is checked by SHA-256.
    link: /use/transfers
  - title: Packages and images
    details: UPack packages with versions, container images for Docker and Podman, Git LFS for game assets, npm and Unity packages, and plain files by path.
    link: /protocols/
  - title: Access you can explain
    details: Accounts, groups, personal tokens and service accounts with keys limited to the repositories and actions they need. Sign-ins and changes to access are audited.
    link: /use/accounts
  - title: Stages and promotion
    details: Mark a build as tested or released, promote it to another repository, and let a deployment agent take the newest build with a stage.
    link: /use/promotion
  - title: Backups and mirrors
    details: Scheduled, verified backups to a local disk or a network share. Mirrors keep a second site in step and take over when the first one is lost.
    link: /operate/backups
  - title: Runs by itself
    details: Windows services, Linux packages or Docker Compose. Services restart after a crash or a hang, and updates arrive signed, behind a fresh backup.
    link: /operate/self-healing
---
