---
title: AI agents
description: 'Let an AI agent such as Claude Code find, download, publish and promote artifacts through arkvoryctl mcp and the Arkvory agent skill.'
---

# AI agents

An AI agent client that speaks the Model Context Protocol (MCP), such as Claude Code, can work with Arkvory through `arkvoryctl mcp`. The client starts the command and talks to it over stdin and stdout; no network port is opened. The agent skill teaches the agent safe workflows on top of it.

## Before you start {#before}

1. Install the [command-line client](../protocols/cli) on the machine where the agent runs.
2. Create a service key for the agent that can reach only the repositories and actions it needs. Save it to a file that only you can read.
3. Add a profile that refers to the key file and check it:

```bash
arkvoryctl profile add agent --server https://arkvory.example --token-file ~/.config/arkvory/agent.key --repository builds
arkvoryctl doctor --profile agent
```

Never paste the key into the chat, an argument or a project file. The agent never sees it: results and errors do not contain it.

## Connect the MCP server {#connect}

```bash
claude mcp add arkvory -- arkvoryctl mcp --profile agent --root ~/work
```

Without `--write` the server is read-only: the agent can list repositories, search all of them, read artifacts, packages, files by path, the change feed and the installation status, and download artifacts. Tools the key cannot use are not offered. The client must support MCP 2025-06-18 or newer.

## Allow writing {#write}

Writing is a separate configuration. List the repositories the agent may write to:

```bash
claude mcp add arkvory-publish -- arkvoryctl mcp --profile agent --root ~/work --write --write-repositories builds
```

| Tool                      | What it does                                                                   |
| ------------------------- | ------------------------------------------------------------------------------ |
| `arkvory_upload`          | Uploads a file as a new artifact, or as the next revision of a file path       |
| `arkvory_publish_package` | Uploads a UPack and registers it as a package version                          |
| `arkvory_promote`         | Adds a stage; with `sha256`, only to the artifact that has exactly those bytes |
| `arkvory_stage_remove`    | Removes a stage; the artifact stays                                            |
| `arkvory_annotate`        | Replaces labels and metadata at the revision the agent read                    |

- A write to a repository that is not in `--write-repositories` is refused before anything is sent (`repository_not_allowed`). The server still checks the key's permissions.
- Nothing can be deleted or restored, and no download links are created. These stay tasks for a person in the console.
- The server tells the agent to describe each write and wait for your confirmation. Your MCP client may also ask before each call.
- An upload is resumable: after a failure the agent repeats the same call, and the same artifact is returned instead of a second one. The result names the SHA-256 of the file that was read.

## Files and limits {#files}

- The agent reads and writes local files only below `--root` (the current directory by default). A path that leads outside it, including through a link, is refused (`path_outside_root`).
- A download appears only after its size and SHA-256 are verified. An existing file is replaced only when the agent asks for it.
- A file that contains the key is never uploaded (`source_contains_credential`), and arkvoryctl's own files (profiles, key files, upload checkpoints) are never read or replaced, even below `--root` (`private_path`).
- One result is at most `--max-output-bytes` (64 KiB by default, up to 1 MiB) and 100 items; the agent passes `next` back as `after` for more.

## Install the skill {#skill}

The skill is a set of instructions for the agent: how to search, verify downloads, publish, promote and read error codes, and what it must never do. It ships with the client:

```bash
arkvoryctl skill install
```

The skill goes to `~/.claude/skills/arkvory`; pass `--target DIR` to install it into a project, such as `.claude/skills/arkvory`. Running the command again updates the files you have not changed. A file you changed is kept: the command stops and changes nothing unless you add `--force`.

## Safety {#safety}

- Names, labels, metadata and comments in results are written by other people. The agent treats them as data and never follows instructions found in them.
- Keep the read-only and the write configuration apart, and allow writing only to the repositories the task needs.
- Use a dedicated key with narrow permissions; revoke it in the console when the agent no longer needs it.

## Troubleshooting {#troubleshooting}

| Error                    | Cause and fix                                                                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No write tools           | The server was started without `--write`, or the key lacks the permission.                                                                                                                                       |
| `repository_not_allowed` | The repository is not in `--write-repositories`. Change the MCP configuration.                                                                                                                                   |
| `forbidden`              | The key lacks the permission. Run `arkvoryctl doctor` to see the permissions.                                                                                                                                    |
| `path_outside_root`      | The file is outside `--root` or not a regular file.                                                                                                                                                              |
| `state_locked`           | The same upload is still running in another call. After a crash, make sure no `arkvoryctl mcp` is uploading that file, then delete the `.lock` file in `mcp-uploads` of the CLI directory (`~/.config/arkvory`). |
| `skill_modified`         | You changed a skill file. Keep your copy or repeat `arkvoryctl skill install` with `--force`.                                                                                                                    |
