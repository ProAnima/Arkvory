---
layout: home
title: Arkvory
titleTemplate: 文档
hero:
  name: Arkvory
  text: 属于您自己的构建、包和大文件仓库
  tagline: 一台服务器，同时服务 CI 流水线、部署代理和游戏团队。支持任意大小文件的续传上传、按仓库授权访问、备份、镜像，以及 11 种语言的控制台。
  image:
    src: /arkvory.svg
    alt: ''
  actions:
    - theme: brand
      text: 开始使用
      link: /zh/guide/
    - theme: alt
      text: 安装
      link: /zh/install/
    - theme: alt
      text: HTTP API
      link: /zh/api/
features:
  - title: 任意大小的文件
    details: 数十 GB 的上传按分片进行，连接中断后可以继续。下载通过范围请求续传。每个文件都用 SHA-256 校验。
    link: /zh/use/transfers
  - title: 包与容器镜像
    details: 带版本的 UPack 包、面向 Docker 和 Podman 的容器镜像、用于游戏资源的 Git LFS、npm 包和 Unity 包，以及按路径存放的普通文件。
    link: /zh/protocols/
  - title: 清晰可查的访问控制
    details: 账户、组、个人访问令牌和服务账户，密钥只限于所需的仓库和操作。登录和访问权限的变更都会记入审计。
    link: /zh/use/accounts
  - title: 阶段与晋级
    details: 把构建标记为已测试或已发布，晋级到另一个仓库，部署代理按阶段取用最新的构建。
    link: /zh/use/promotion
  - title: 备份与仓库镜像
    details: 按计划执行并经过验证的备份，可存到本地磁盘或网络共享。仓库镜像让第二个站点保持同步，并在第一个站点丢失时接管。
    link: /zh/operate/backups
  - title: 自动运行
    details: 可用 Windows 服务、Linux 软件包或 Docker Compose 部署。服务在崩溃或卡死后自动重启；更新带有签名，并且在最新的备份完成之后才会安装。
    link: /zh/operate/self-healing
---
