---
title: 目录树
description: 将目录发布为一个归档，把它取回到文件夹中，用它检查文件夹，并且只修复不一致的文件。
---

# 目录树

部署代理或 CI 作业经常需要整个目录：游戏构建、一套工具、一棵配置树。`arkvoryctl tree` 把目录发布为一个 ZIP 制品，把它取回到文件夹中，用它检查文件夹，并且只修复不一致的文件。该制品是普通的 ZIP 文件：控制台、API 和任何 ZIP 工具都能读取它，备份也像对待其他制品一样保存它。

这些命令属于免费核心功能。它们需要的权限与上传和下载相同：参见[上传与下载](./transfers)。

## 发布目录 {#push}

```bash
arkvoryctl tree push ./Build/Game --name game-1.4.zip --label release
```

| 选项                   | 含义                                                            |
| ---------------------- | --------------------------------------------------------------- |
| `--name NAME.zip`      | 制品名称。默认值：文件夹名加上 `.zip`。名称必须以 `.zip` 结尾。 |
| `--label TAG`          | 制品的标签                                                      |
| `--file METADATA.json` | 标签和元数据，与 `upload` 相同                                  |
| `--compress`           | 压缩条目（deflate）。不使用此选项时，文件按原样存储。           |

结果显示制品的 `id`、`size`、`sha256`，以及 `entries` 中的文件数量。

- **相同的文件夹产生相同的归档。** 文件按路径排序，每个条目的日期都是 1980-01-01，并且只保留文件系统的一项属性：所有者可执行的文件获得模式 755，其他文件获得 644。再次推送未更改的文件夹会得到相同的字节和相同的 SHA-256。
- **中断。** 归档在文件夹旁边构建（`.<folder>.arkvory-tree.zip`），并带检查点按分片上传。按下 Ctrl+C 或发生网络故障后，请再次运行相同的命令：它会构建相同的归档并继续上传。成功后两个文件都会被删除。
- **会被拒绝的内容。** 文件夹中的符号链接、联接点（junction）、设备和管道（`tree_entry_unsupported`），Windows 无法使用的名称（`unsafe_name`），以及仅大小写不同的两个名称（`case_collision`）。空文件夹不会被保留。
- **存储或压缩。** 不使用 `--compress` 时，每个文件的字节在归档中是一段连续的范围。这样服务器可以按字节范围提供单个文件，修复时也只传输不一致文件的字节。使用 `--compress` 时归档更小，修复的文件在您的机器上解压。

## 取回目录 {#pull}

```bash
arkvoryctl tree pull 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game
```

- **空文件夹或不存在的文件夹**会获得整个归档。归档带检查点下载到文件夹旁边，因此被中断的取回会从停止处继续。SHA-256 验证通过后，文件被解压到目标旁边的新文件夹中，然后由该文件夹取代目标。
- **已有文件的文件夹**会变成这棵树。如果服务器有[文件清单](#table-of-contents)，则只下载不一致的文件，每个文件按其字节范围下载，树中没有的文件会被删除。没有文件清单时会下载整个归档，解压出的文件夹替换旧文件夹。

父文件夹必须存在。目标中的文件一步完成替换：先写入旁边的临时文件，校验后再重命名。读取该文件的程序看到的要么是旧版本，要么是新版本。

## 检查目录 {#verify}

```bash
arkvoryctl tree verify 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game
```

结果列出 `missing`（缺失）文件、`mismatched`（不一致，大小或 SHA-256 不同）文件，以及树中没有的 `extra`（多余）文件，数量在 `counts` 中。每个列表最多显示 1000 个路径。没有缺失和不一致的文件时 `ok` 为 `true`；多余的文件不影响它。`ok` 为 true 时退出码为 0，否则为 5。

## 修复目录 {#repair}

```bash
arkvoryctl tree repair 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game
```

修复会重新写入所有缺失和不一致的文件，并保留多余的文件。有文件清单时，它只下载这些文件的条目；结果中的 `fetchedBytes` 表示它读取了归档的多少字节。没有文件清单时，它会先下载整个归档。

## 文件清单 {#table-of-contents}

归档发布后，服务器的工作进程会读取它一次，并记录每个文件：路径、大小、SHA-256 以及其字节在归档中的位置。名称以 `.zip` 或 `.upack` 结尾的制品会这样处理。在完成之前，或者归档无法建立索引时，命令改为使用整个归档。

具备文件清单的服务器会在 `GET /api/v1/capabilities` 的 `tree` 中提供 `zip-tree`（参见 `arkvoryctl doctor`）；对于较旧的服务器，命令使用整个归档。文件清单本身是操作 [getArtifactTree](../api/reference/artifacts#getArtifactTree)：`status` 为 `ready`、`pending`，或为 `unavailable` 并带有 `reason`。

| `reason`             | 含义                                             |
| -------------------- | ------------------------------------------------ |
| `not_archive`        | 制品名称不以 `.zip` 或 `.upack` 结尾             |
| `invalid_archive`    | 该文件不是可读取的 ZIP 归档                      |
| `unsafe_entry`       | 某个路径离开了归档，或者某个条目是链接或特殊文件 |
| `encrypted_entry`    | 某个条目已加密                                   |
| `duplicate_entry`    | 两个条目路径相同（忽略大小写时也算）             |
| `unsupported_method` | 某个条目使用了 stored 和 deflate 以外的压缩方法  |
| `crc_mismatch`       | 某个条目的字节与归档中记录的校验和不一致         |
| `too_many_entries`   | 条目超过 100,000 个                              |
| `too_large`          | 解压后超过 100 GiB                               |

## 文件如何校验 {#checks}

- **每个文件在就位之前都会经过验证。** 有文件清单时，其大小和 SHA-256 必须与服务器根据已发布归档计算出的值一致。没有文件清单时，先验证整个归档的 SHA-256，再验证每个文件的大小和 CRC-32。不一致时命令以 `checksum_mismatch`（退出码 5）停止，文件夹中的文件保持原样。
- **不会在文件夹之外写入任何内容。** 从归档和服务器读取的路径都被视为不可信数据。离开文件夹的路径会以 `path_outside_root` 拒绝。通往文件途中的文件夹内链接绝不会被跟随。Windows 无法使用的名称（`CON`、`aux.txt`、`a:b`、末尾的点或空格）在所有系统上都会以 `unsafe_name` 拒绝，因此一棵树在 Windows 和 Linux 上含义相同。
- **模式。** 从归档解压的文件，如果归档将其标记为可执行，则获得模式 755，否则为 644（Linux 和 macOS）。按范围修复的文件保留它所替换文件的模式。

## 更快的传输 {#extensions}

`tree push` 的整个归档上传和 `tree pull` 的整个归档下载，与 `upload` 和 `download` 使用同一种传输。当服务器提供相同的扩展时，带有传输扩展的[客户端模块](../protocols/cli#client-modules)可以承担这些传输；归档仍是普通的 ZIP，其 SHA-256 和每个文件都按上文所述进行校验。没有模块，或服务器不提供该扩展时，`arkvoryctl` 使用自己的传输。

## 相关页面 {#related-pages}

- [上传与下载](./transfers)
- [命令行](../protocols/cli)
- [制品 API](../api/reference/artifacts)
