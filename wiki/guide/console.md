---
title: The web console
---

# The web console

The web console is the browser interface of Arkvory. It is part of the server, so you do not install it separately. Open `/console/` on your server address, for example `http://127.0.0.1:8080/console/` on the server itself, or `https://arkvory.example/console/` after you set up [HTTPS](../install/https).

The console uses the same HTTP API as the [command-line client](../protocols/cli) and the [SDK](../protocols/sdk). The server checks every request. When a button is hidden, it only means that your account or key cannot use that operation.

## Layout {#layout}

The sidebar groups the sections. On a narrow screen, the sidebar becomes the [[ui:navigationMenu]] button.

| Group               | Sections                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [[ui:navLibrary]]   | [[ui:catalog]], [[ui:packages]], [[ui:history]], [[ui:metadata]]                                                          |
| [[ui:navTransfers]] | [[ui:upload]], [[ui:downloads]]                                                                                           |
| [[ui:navResources]] | [[ui:administration]], [[ui:repositories]], [[ui:services]], [[ui:updates]], [[ui:backups]], [[ui:navStart]], [[ui:help]] |

The top bar shows the title of the section, the [[ui:uploadFile]] button, the [[ui:reportOpen]] button and the appearance and language controls.

Each section has its own address, such as `#/catalog`, `#/packages` or `#/backups`. An open artifact has the address `#/artifact/<repository>/<id>`. You can bookmark these addresses and send them to other people. The address never contains a password, a key or a search text. If you open a link before you sign in, the console opens it after you sign in.

Some sections appear only for some users:

| Section               | Who sees it                                               |
| --------------------- | --------------------------------------------------------- |
| [[ui:administration]] | Administrators                                            |
| [[ui:repositories]]   | Everyone who is signed in                                 |
| [[ui:services]]       | The recovery key, and operator keys with delegated rights |
| [[ui:updates]]        | Administrators                                            |
| [[ui:backups]]        | Administrators and the recovery key                       |

## Signing in {#signing-in}

The [[ui:connection]] card is at the top of the page.

1. Enter your [[ui:accountName]] and [[ui:password]].
2. Select [[ui:signIn]]. A session lasts 12 hours.
3. The console selects the first [[ui:repository]] that you can read. To work in another repository, type its name or pick it from the list.

To connect with a key instead of a password, open [[ui:keySignIn]], paste the key and select [[ui:connect]]. The key stays in the memory of this browser tab. The console never saves it.

[[ui:signUp]] appears only when the administrator allows self-registration. [[ui:disconnect]] ends the connection.

After you sign in with a password, you can use [[ui:changeOwnPassword]] and [[ui:personalAccessTokens]]. A personal access token is a key for your own tools. See [Accounts and access](../use/accounts).

### The first owner {#the-first-owner}

A new installation has no accounts. On Windows, Setup creates the owner. On other installations, create the owner in the console:

1. Open [[ui:navStart]] and expand [[ui:welcomeOwner]].
2. Paste the recovery key from `config/bootstrap-token.txt` in the installation directory.
3. Enter a name and a password of at least 12 characters, then select [[ui:welcomeCreate]].
4. Sign in with the new name and password.

The form works only while there are no accounts. The owner is an administrator. The owner also gets write access to the `releases` repository through the `arkvory-owners` group.

## Library {#library}

### Artifacts {#artifacts}

[[ui:catalog]] lists the published files of the repository. Search by name or by a metadata value. Use [[ui:labelFilter]] to show one label, and [[ui:metadataFilter]] for an exact key and value. Each row shows the name, size, publication time, stages and labels. Select [[ui:download]] to download a file, or [[ui:open]] to see its details. [[ui:more]] shows the next page.

### Packages {#packages}

[[ui:packages]] lists registered UPack versions. Filter by [[ui:packageGroup]] and [[ui:packageName]], choose [[ui:sortBy]] and [[ui:groupBy]], then select [[ui:apply]]. The stages column shows where each version is promoted. See [Packages](../use/packages).

### File history {#file-history}

A file path, such as `builds/game/1.4/GameSetup.exe`, can point to new content many times. Each change is a new version. In [[ui:history]], enter a path and select [[ui:historyLoad]]. You see each version with its author and time. You can open any version to download its original content. Restoring an old version creates a new version; it does not delete anything. See [Files and paths](../use/files).

### Artifact details {#artifact-details}

[[ui:metadata]] shows one artifact:

- **Summary**: [[ui:summarySize]], [[ui:summaryCreated]] and [[ui:summaryHash]] with a [[ui:copyHash]] button.
- **Properties**: [[ui:labels]], [[ui:collections]] and [[ui:metadataFields]]. Select [[ui:save]] to store them. The file itself does not change.
- **Actions**: [[ui:download]]; [[ui:downloadLink]] creates a link that works for one hour without a key; [[ui:register]] indexes a UPack archive.
- [[ui:assetTitle]]: [[ui:assign]] makes this artifact the current content of a file path.
- [[ui:promotionTitle]]: [[ui:stageAdd]] marks the artifact with a stage, such as `qa` or `release`. [[ui:promoteSubmit]] publishes it in another repository. See [Promotion](../use/promotion).
- [[ui:attachmentsTitle]]: [[ui:attachmentAdd]] links a manifest, SBOM, signature, report or other file to this build. [[ui:attachmentHistory]] shows earlier sets.
- [[ui:deletionTitle]]: [[ui:deletionInspect]] shows what still uses the artifact. To delete, paste the artifact ID and select [[ui:deletionSubmit]]. Deleting needs a service key that has the action `artifact.delete`; a password sign-in, a personal token and the recovery key cannot delete.

## Transfers {#transfers}

### Upload {#upload}

In [[ui:upload]], choose a file and select [[ui:startUpload]]. The console first computes the SHA-256 of the file, then sends it in parts. [[ui:pause]] stops the transfer and keeps the uploaded parts.

To continue later, keep the upload ID. Open [[ui:resumeTitle]], select the same file and enter the [[ui:uploadId]]. The browser warns you before you leave the page during an upload. See [Transfers](../use/transfers).

### Downloads {#downloads}

[[ui:downloads]] is a queue of files that you download from the console. The console checks the SHA-256 of each file before it saves the final file.

- [[ui:downloadSettings]] sets [[ui:downloadConcurrency]] (1 to 8), [[ui:downloadInterval]] and [[ui:downloadWait]].
- [[ui:downloadsPause]], [[ui:downloadsResume]], [[ui:downloadsClearWaiting]], [[ui:downloadsCancel]] and [[ui:downloadsClearFinished]] control the whole queue.
- After a page reload, sign in again and select [[ui:downloadRestore]]. Then resume each file and choose where to save it.

Large downloads need Chrome or Edge on a secure address (HTTPS or the local computer). Temporary data stays in the private storage of the browser.

## Resources {#resources}

### Users and access {#users-and-access}

Administrators manage people here. [[ui:accountsHeading]] lists accounts; [[ui:groupsHeading]] lists groups. Use [[ui:createUser]], [[ui:resetPassword]], [[ui:createGroup]] and [[ui:manageMembers]]. In [[ui:manageGrants]], give a group [[ui:read]] or [[ui:write]] access to a repository by name. A repository has no separate create step: it exists as soon as a grant or a service policy names it.

### Repositories {#repositories}

[[ui:repositories]] shows the repositories that you can see, with [[ui:repositoryRights]]. Each card has [[ui:repositoryOpen]], [[ui:repositoryStorage]] (quota, automatic cleanup and physical cleanup; it needs a service key with the actions `storage.read` or `storage.manage`) and, for administrators, [[ui:repositoryAccess]]. A mirrored repository shows the [[ui:mirrorBadge]] badge. See [Repositories](../use/repositories) and [Storage](../operate/storage).

### Service access {#service-access}

Here you create accounts for tools and CI systems. To see this section, connect with the recovery key or with an operator key. Select [[ui:serviceCreate]], then set [[ui:servicePolicy]]. [[ui:bindingRead]] and [[ui:bindingPublish]] fill typical permission sets.

To issue a key, open [[ui:serviceKeys]] and select [[ui:keyIssue]]. The secret is shown only once. Copy it, confirm [[ui:keySaved]] and select [[ui:keyActivate]]. A key that is not activated expires after 15 minutes. Use [[ui:keyRotate]] to replace a key and [[ui:keyRevoke]] to stop it. [[ui:delegations]] lets the owner give an operator limited administrative rights.

### Updates {#updates}

[[ui:updates]] shows the [[ui:updateCurrent]] and the [[ui:updateLatest]]. Select [[ui:updateCheck]] or [[ui:updateInstall]]. In [[ui:updateSettings]], turn on [[ui:updateAutomatic]] and choose the [[ui:updateHour]]. See [Updates](../install/updates).

### Backups {#backups}

[[ui:backups]] shows whether backups are healthy, the latest backup, the next run, the backup agent and the backup storage. Select [[ui:backupRun]] to start a backup. [[ui:backupPoints]] lists restore points; you can verify every byte of a point or pin it. [[ui:backupPlan]] sets the daily time, the time zone and how many points to keep. Restoring is a command on the server. See [Backups](../operate/backups).

### Getting started and API reference {#getting-started-and-api-reference}

[[ui:navStart]] shows the first steps for a new server. [[ui:help]] lists example commands. [[ui:helpLoad]] shows the API operations that your current account or key can call.

## Feedback {#feedback}

After you sign in, [[ui:reportOpen]] sends a message to ProAnimaStudio through the hub. You can add up to 6 images and an email address for a reply. Administrators can attach the server log. Select [[ui:reportShow]] to see exactly what is sent.

## Appearance and language {#appearance-and-language}

[[ui:theme]] has three options: [[ui:system]], [[ui:light]] and [[ui:dark]]. [[ui:language]] lists every language of the console by its own name: English, Русский, Español, Français, Deutsch, Português, 中文, 日本語, 한국어, हिन्दी and العربية. The page switches at once, without reloading and without losing what you typed; in Arabic it reads right to left. On the first visit the console follows the browser's languages and falls back to English. [[ui:helpDocs]] in [[ui:help]] opens this documentation in the language of the console. The browser saves only the theme and the language, nothing about your account or repositories.

## Related pages {#related-pages}

- [Quick start](./quick-start)
- [Concepts](./concepts)
- [Accounts and access](../use/accounts)
- [Troubleshooting](../operate/troubleshooting)
