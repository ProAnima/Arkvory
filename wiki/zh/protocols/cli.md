---
title: 命令行（arkvoryctl）
---

# 命令行（arkvoryctl）

`arkvoryctl` 是 Arkvory 面向用户和 CI/CD 的远程客户端。它按分片上传和下载，中断后可以继续，并校验 SHA-256。它使用您提供的密钥所具有的权限。

## 安装 {#install}

| 系统                                         | 软件包                      | 安装方式                                                                                          |
| -------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| Windows 10/11、Windows Server 2019+（x64）   | `Arkvory-CLI-Setup-x64.exe` | 运行它。它为当前用户安装，无需管理员权限，并把 `arkvoryctl` 添加到用户的 `PATH`。请打开新的终端。 |
| Debian、Ubuntu（x64）                        | `Arkvory-CLI-amd64.deb`     | `sudo apt install ./Arkvory-CLI-amd64.deb`                                                        |
| Fedora、兼容 RHEL 的发行版（x64）            | `Arkvory-CLI-x86_64.rpm`    | `sudo dnf install ./Arkvory-CLI-x86_64.rpm`                                                       |
| 任何装有 Node.js 24 的系统（例如 CI runner） | `arkvoryctl.mjs`            | `node ./arkvoryctl.mjs --help`                                                                    |

原生软件包自带 Node.js。单文件 `arkvoryctl.mjs` 没有 npm 依赖。请从 `ProAnima/Arkvory` 的可信发行版获取这些文件，并把它们的 SHA-256 与 `release-checksums.json` 比对。暂无 ARM64 软件包。要更新，请安装较新的稳定版。卸载时会保留您的配置文件、密钥文件和检查点。

## 连接到服务器 {#connect-to-a-server}

1. 获取密钥：来自控制台的个人访问令牌，或来自管理员的服务密钥。参见[账户与密钥](../use/accounts)。
2. 把密钥保存在任何代码仓库之外的私有文件中。在 Linux 上使用权限模式 `0600`；在 Windows 上只允许您的账户访问。
3. 添加配置文件（profile）并检查连接：

```bash
arkvoryctl profile add production --server https://arkvory.example --token-file "$HOME/.secrets/arkvory.key" --repository releases
arkvoryctl doctor
arkvoryctl repositories
```

```powershell
arkvoryctl profile add production --server https://arkvory.example --token-file C:\Private\arkvory.key --repository releases
arkvoryctl doctor
```

`doctor` 显示服务器、仓库、服务器支持的功能以及密钥的权限。密钥绝不会作为命令参数。

## 配置文件与环境变量 {#profiles-and-environment}

配置文件保存在 `~/.config/arkvory` 下的 `profiles.json` 中（在 Windows 上是用户文件夹中的 `.config\arkvory`）。配置文件保存服务器 URL、默认仓库和密钥文件的**路径**，而不是密钥本身。

| 命令                                                                    | 作用                                                                    |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `profile add NAME --server URL [--token-file PATH] [--repository NAME]` | 添加配置文件。第一个配置文件会成为默认配置文件。默认仓库是 `releases`。 |
| `profile list`                                                          | 显示所有配置文件以及当前使用的配置文件                                  |
| `profile use NAME`                                                      | 将某个配置文件设为默认                                                  |
| `profile remove NAME`                                                   | 删除配置文件                                                            |

| 变量                 | 含义                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_TOKEN`      | 密钥本身。优先于任何文件。                                                                                    |
| `ARKVORY_TOKEN_FILE` | 密钥文件的路径。优先于配置文件中的密钥文件。                                                                  |
| `ARKVORY_BASE_URL`   | 服务器 URL。设置后**不会**使用配置文件中的密钥文件：请通过 `ARKVORY_TOKEN` 或 `ARKVORY_TOKEN_FILE` 提供密钥。 |
| `ARKVORY_CLI_HOME`   | `profiles.json` 所在的另一个文件夹                                                                            |

服务器 URL 必须使用 HTTPS。明文 HTTP 仅允许用于 `localhost`、`127.0.0.1` 和 `[::1]`。TLS 验证无法关闭。

## 全局选项 {#global-options}

| 选项                       | 默认值       | 含义                                                                                    |
| -------------------------- | ------------ | --------------------------------------------------------------------------------------- |
| `--profile NAME`           | 当前配置文件 | 仅为此命令指定配置文件                                                                  |
| `--repository NAME`        | 来自配置文件 | 仅为此命令指定仓库                                                                      |
| `--json`                   | 关闭         | 在 stdout 输出一个紧凑的 JSON 结果；错误以 JSON 形式输出到 stderr                       |
| `--lang en` 或 `--lang ru` | 来自 `LANG`  | 帮助和消息的语言                                                                        |
| `--timeout MS`             | 60000        | 管理类请求的时限（1 到 3600000）                                                        |
| `--attempt-timeout MS`     | 120000       | 单次传输尝试的时限（1 到 1800000）                                                      |
| `--retries N`              | 20           | 单个操作的网络重试次数（0 到 100）；`0` 表示关闭重试                                    |
| `--verbose`                | 关闭         | 每个 HTTP 请求向 stderr 输出一行：方法、路径、状态、耗时、请求 ID。不包含请求头或密钥。 |
| `--help`、`--version`      |              | 帮助；以 JSON 形式输出客户端版本                                                        |
| `--`                       |              | 结束选项，用于以 `-` 开头的文件名                                                       |

每个选项只能出现一次。未知选项会被拒绝。

## 命令 {#commands}

### 发现与目录 {#discovery-and-catalog}

| 命令                                                                       | 结果                           |
| -------------------------------------------------------------------------- | ------------------------------ |
| `doctor`                                                                   | 连接、功能和权限               |
| `repositories [--after CURSOR]`                                            | 密钥可见的仓库                 |
| `operations [--after CURSOR]`                                              | 仓库中可用的 API 操作          |
| `list [--after CURSOR]`                                                    | 仓库中的制品                   |
| `search [--query TEXT] [--label TAG] [--collection NAME] [--after CURSOR]` | 按名称和元数据文本搜索         |
| `search --metadata-key KEY --metadata-value VALUE`                         | 精确匹配元数据（两者都要传入） |
| `inspect ID`                                                               | 单个制品的元数据               |
| `storage usage` / `storage policy`                                         | 仓库用量和存储策略             |

分页结果会返回 `next`。将它通过 `--after` 传入即可读取下一页。

### 传输 {#transfers}

| 命令                                                                           | 结果                                                                                             |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `upload FILE [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]`   | 可续传地上传任意文件                                                                             |
| `download ID OUTPUT`                                                           | 可续传、经 SHA-256 校验的下载                                                                    |
| `put FILE PATH [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]` | 上传文件，并使其成为该路径的下一个修订版本。如果该路径已经保存了相同的字节，则不会上传任何内容。 |
| `get PATH OUTPUT`                                                              | 下载路径的当前修订版本，经过校验且可续传                                                         |
| `link ID [--ttl SECONDS]`                                                      | 无需密钥的下载 URL，有效期 60 秒到 24 小时（默认 1 小时）                                        |
| `uploads status ID` / `uploads cancel ID`                                      | 查看上传会话的状态；取消上传会话（取消不是暂停）                                                 |

`METADATA.json` 包含 `labels` 和 `metadata`（字符串映射）。它优先于 `--label`。

```bash
arkvoryctl put "./Build/Game Setup.exe" builds/game/1.4/GameSetup.exe
arkvoryctl get builds/game/1.4/GameSetup.exe ./GameSetup.exe
arkvoryctl link 00000000-0000-4000-8000-000000000001 --ttl 900
```

下载链接是机密信息，在过期之前无法撤销。

### 包与晋级 {#packages-and-promotion}

| 命令                                                                                                                  | 结果                                        |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `packages list [--group G] [--name N] [--after CURSOR]`                                                               | UPack 包                                    |
| `packages publish FILE [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]`                                | 上传 UPack 归档并注册                       |
| `packages register ID`                                                                                                | 注册已上传的 UPack                          |
| `packages resolve NAME [--group G] [--exact V] [--range R] [--stage S] [--prerelease] [--order promoted]`             | 选择一个版本（`--exact` 和 `--range` 互斥） |
| `packages download NAME OUTPUT [same filters]`                                                                        | 选择版本，然后经校验后下载                  |
| `promote ID --to REPOSITORY [--move] [--stage S1,S2] [--comment TEXT]`                                                | 将制品发布到另一个仓库，无需再次传输字节    |
| `stages list ID` / `stages add ID STAGE [--comment TEXT]` / `stages remove ID STAGE` / `stages artifacts [--stage S]` | 制品的阶段                                  |
| `promotions history ID` / `promotions journal [--after CURSOR]`                                                       | 晋级历史记录                                |

```bash
arkvoryctl packages publish ./build.upack --label test --state ./job-state/build.json --json
arkvoryctl promote 00000000-0000-4000-8000-000000000001 --to prod --stage release
arkvoryctl packages download app ./app.upack --range ^1.4 --stage release
```

使用 `--exact` 指定精确版本；`--version` 会输出客户端版本。参见[包](../use/packages)和[晋级](../use/promotion)。

### 注解与附件 {#annotations-and-attachments}

`annotations get ID` 和 `annotations set ID --revision N --file ANNOTATIONS.json` 用于读取和替换标签、元数据和集合。`attachments get ID`、`attachments history ID` 和 `attachments set ID --revision N --file ATTACHMENTS.json` 对构建所关联的文件执行同样的操作。请先读取，再连同您读取到的修订版本一起发送完整的新状态。并发修改会返回冲突（退出码 6）。

### 备份 {#backups}

| 命令                                                              | 结果                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| `backup status`                                                   | 备份存储、代理、计划、最近的恢复点、警告；出现严重警告时退出码为 9 |
| `backup run`                                                      | 将备份任务加入队列                                                 |
| `backup jobs [--after CURSOR]` / `backup points [--after CURSOR]` | 任务和恢复点，最新的在前                                           |
| `backup verify POINT_ID`                                          | 将对某个恢复点的完整验证加入队列                                   |
| `backup pin POINT_ID [--off]`                                     | 使某个恢复点不受保留规则限制，或取消固定                           |

这些命令需要安装所有者（bootstrap）的文件密钥，或账户管理员的会话。个人令牌和服务密钥会收到 403（退出码 3）。实际工作由服务器的备份代理完成。监控示例：`arkvoryctl backup status --json || alert`。参见[备份](../operate/backups)。

## 续传被中断的传输 {#resume-interrupted-transfers}

按下 Ctrl+C 或发生网络故障之后，请再次运行**相同的命令和相同的选项**。

- `upload`、`put` 和 `packages publish` 会在源文件旁边保存一个检查点：`<source>.arkvory-upload.json`，或通过 `--state` 指定的文件。检查点在第一个请求之前就保存幂等键，因此即使响应丢失，也不会产生第二份副本。
- 要把相同的字节发布为**新**制品，请使用新的 `--state` 文件。
- `download` 和 `get` 会在输出文件旁边保存 `<output>.arkvory-part` 和 `<output>.arkvory-download.json`。只有通过 SHA-256 校验后才会出现最终文件。已存在的输出文件绝不会被覆盖。
- 在 CI 中，请在作业开始之前创建状态文件夹，并在重试之间把它与源文件一起保留。

请把检查点保存在支持硬链接的本地磁盘（NTFS、ext4、XFS）上，不要放在 FAT、exFAT 或网络共享上。系统硬崩溃后会留下一个 `.lock` 文件。请确认其中记录的 PID 对应的进程已经停止，然后只删除该 `.lock` 文件。

## CI 示例 {#ci-example}

```bash
# 密钥来自 CI 的机密存储。绝不要打印它。
export ARKVORY_BASE_URL=https://arkvory.example
export ARKVORY_TOKEN_FILE=/run/secrets/arkvory-key
mkdir -p job-state
node ./arkvoryctl.mjs packages publish ./build.upack --label test --state ./job-state/upload.json --json
```

如果上传之后注册失败，JSON 错误中会包含 `stage: "register"` 和 `artifactId`。请重复执行相同的命令。重复注册同一个制品是安全的。

## 输出 {#output}

- 结果以 JSON 形式输出到 stdout。不带 `--json` 时，JSON 会带缩进。备份命令除非添加 `--json`，否则输出便于阅读的文本行。
- 只有在交互式 stderr 上才会显示进度。
- 不带 `--json` 时，错误是向 stderr 输出的一行，包含服务器错误码、原因、消息、下一步操作和请求 ID。带 `--json` 时，stderr 包含 `{"error": {...}}`，其中有 `code`、`exitCode`、`status`、`serverCode`、`reason`、`requestId` 和 `retryAfterSeconds`。遇到未知的错误码时，请根据 `exitCode` 判断。

## 退出码 {#exit-codes}

| 代码 | 含义                                                        |
| ---- | ----------------------------------------------------------- |
| 0    | 成功                                                        |
| 2    | 参数或配置错误                                              |
| 3    | 没有密钥，或访问被拒绝（401、403）                          |
| 4    | HTTP 或网络错误、超时、服务器繁忙、未找到                   |
| 5    | 完整性校验失败（SHA-256 不匹配，422 `integrity_mismatch`）  |
| 6    | 冲突：修订版本、状态、锁、已存在的文件、检查点已变化（409） |
| 7    | 本地文件错误或服务器响应无效                                |
| 8    | 服务器容量限制：配额、磁盘、队列（507 `capacity_exceeded`） |
| 9    | `backup status`：存在严重的备份警告                         |
| 130  | 已中断                                                      |

客户端只会在 `--retries` 范围内重试网络故障以及 HTTP 408、429、502、503 和 504。

## 故障排查 {#troubleshooting}

| 消息                                       | 原因与解决方法                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `credential_required`（退出码 3）          | 未找到密钥。检查 `--token-file`、`ARKVORY_TOKEN_FILE`，或在使用 `ARKVORY_BASE_URL` 时设置密钥。 |
| `forbidden`（退出码 3）                    | 密钥缺少相应权限。运行 `doctor` 查看权限。                                                      |
| `checkpoint_mismatch`（退出码 6）          | 文件、服务器、仓库或选项与保存的检查点不一致。请使用原来的选项，或使用新的 `--state`。          |
| `state_locked`（退出码 6）                 | 另一个进程正在使用该检查点，或崩溃后遗留了旧的 `.lock`。                                        |
| `destination_exists`（退出码 6）           | 输出文件已存在。请选择其他名称。                                                                |
| `put` 上的 `revision_mismatch`（退出码 6） | 在此期间有人更改了该路径。请检查路径的历史记录，然后再决定如何处理。                            |
| 退出码 8                                   | 配额已用尽或磁盘已满。请联系管理员。                                                            |

## 相关页面 {#related-pages}

- [客户端与协议](./index)
- [传输](../use/transfers)和[文件与路径](../use/files)
- [TypeScript SDK](./sdk)
- [错误](../api/errors)
