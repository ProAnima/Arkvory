---
title: AI 代理
description: '让 Claude Code 等 AI 代理通过 arkvoryctl mcp 和 Arkvory 代理技能查找、下载、发布和晋级制品。'
---

# AI 代理

支持 Model Context Protocol（MCP）的 AI 代理客户端（例如 Claude Code）可以通过 `arkvoryctl mcp` 使用 Arkvory。客户端启动该命令，并通过 stdin 和 stdout 与其通信；不会打开任何网络端口。代理技能在此基础上教会代理安全的工作流程。

## 开始之前 {#before}

1. 在运行代理的机器上安装[命令行客户端](../protocols/cli)。
2. 为代理创建一个服务密钥，只允许访问它需要的仓库和操作。将其保存到只有您能读取的文件中。
3. 添加一个引用该密钥文件的配置文件并进行检查：

```bash
arkvoryctl profile add agent --server https://arkvory.example --token-file ~/.config/arkvory/agent.key --repository builds
arkvoryctl doctor --profile agent
```

切勿将密钥粘贴到聊天、参数或项目文件中。代理永远看不到它：结果和错误中都不包含密钥。

## 连接 MCP 服务器 {#connect}

```bash
claude mcp add arkvory -- arkvoryctl mcp --profile agent --root ~/work
```

不带 `--write` 时，服务器为只读：代理可以列出仓库、在所有仓库中搜索、读取制品、软件包、按路径的文件、变更流和安装状态，并下载制品。密钥无法使用的工具不会提供。客户端必须支持 MCP 2025-06-18 或更新版本。

## 允许写入 {#write}

写入是单独的配置。列出代理可以写入的仓库：

```bash
claude mcp add arkvory-publish -- arkvoryctl mcp --profile agent --root ~/work --write --write-repositories builds
```

| 工具                      | 作用                                                 |
| ------------------------- | ---------------------------------------------------- |
| `arkvory_upload`          | 将文件上传为新制品，或作为某个路径的下一个修订版本   |
| `arkvory_publish_package` | 上传 UPack 并将其注册为软件包版本                    |
| `arkvory_promote`         | 添加阶段；带 `sha256` 时，只添加到字节完全一致的制品 |
| `arkvory_stage_remove`    | 移除阶段；制品保留                                   |
| `arkvory_annotate`        | 在代理读取的修订版本上替换标签和元数据               |

- 写入不在 `--write-repositories` 中的仓库会在发送任何内容之前被拒绝（`repository_not_allowed`）。服务器仍会检查密钥的权限。
- 无法删除或恢复任何内容，也不会创建下载链接。这些仍是由人在控制台中完成的任务。
- 服务器要求代理说明每次写入并等待您的确认。您的 MCP 客户端也可能在每次调用前询问。
- 上传可以续传：失败后代理重复同一调用，返回的是同一个制品而不是第二个。结果会给出所读取文件的 SHA-256。

## 文件与限制 {#files}

- 代理只在 `--root`（默认为当前目录）之下读写本地文件。指向其外部的路径（包括通过链接）会被拒绝（`path_outside_root`）。
- 下载的文件只有在大小和 SHA-256 校验通过后才会出现。只有当代理要求时，已有文件才会被替换。
- 包含密钥的小文件永远不会被上传（`source_contains_credential`）。
- 单个结果最多为 `--max-output-bytes`（默认 64 KiB，最多 1 MiB）和 100 项；要获取更多，代理将 `next` 作为 `after` 传回。

## 安装技能 {#skill}

技能是给代理的一组说明：如何搜索、校验下载、发布、晋级和解读错误码，以及绝不能做什么。它随客户端一起提供：

```bash
arkvoryctl skill install
```

技能安装到 `~/.claude/skills/arkvory`；要安装到项目中，请传入 `--target DIR`，例如 `.claude/skills/arkvory`。再次运行该命令会更新您未改动的文件。您改动过的文件会被保留：除非添加 `--force`，否则命令会停止且不做任何更改。

## 安全 {#safety}

- 结果中的名称、标签、元数据和注释由其他人编写。代理将其视为数据，绝不执行其中的指令。
- 将只读配置和写入配置分开，只允许写入任务所需的仓库。
- 使用权限范围很窄的专用密钥；当代理不再需要时，在控制台中吊销它。

## 故障排除 {#troubleshooting}

| 错误                     | 原因与解决方法                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------ |
| 没有写入工具             | 服务器启动时未带 `--write`，或密钥缺少权限。                                         |
| `repository_not_allowed` | 该仓库不在 `--write-repositories` 中。请修改 MCP 配置。                              |
| `forbidden`              | 密钥缺少权限。运行 `arkvoryctl doctor` 查看权限。                                    |
| `path_outside_root`      | 文件在 `--root` 之外，或不是普通文件。                                               |
| `skill_modified`         | 您改动了技能文件。保留您的副本，或带 `--force` 重新运行 `arkvoryctl skill install`。 |
