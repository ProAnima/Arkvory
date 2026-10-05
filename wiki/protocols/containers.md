---
title: Container images
description: Push and pull Docker and OCI images, Helm charts and ORAS artifacts through the registry that every repository has under /v2.
---

# Container images

Every Arkvory repository is also a container registry. Docker, Podman, Buildx, containerd, Helm and ORAS push to it and pull from it with the OCI Distribution protocol. Image layers and manifests are stored as ordinary artifacts. Repository permissions, quotas, SHA-256 checks, backups and mirrors apply to them as to any other file.

## Before you start {#before-you-start}

You need:

- The server address with HTTPS and a trusted certificate, for example `arkvory.example`. See [HTTPS](../install/https).
- A repository, for example `releases`.
- A key: a personal access token or a service key. See [Accounts and keys](../use/accounts).

The registry answers at the root of the host, under `/v2/`. It cannot work under a path prefix such as `https://example.com/arkvory/`, because Docker does not support one. A reverse proxy must pass `/v2/` unchanged and must not buffer request bodies. In nginx, set `client_max_body_size 0` and turn off request buffering.

## Image names {#image-names}

An image reference has this form:

```text
<host>/<repository>/<image>:<tag>
<host>/<repository>/<image>@sha256:<digest>
```

The first path segment is the Arkvory repository. It is the access boundary: a key sees only the repositories it is granted. The rest is the image name, with one or more components.

| Reference                                   | Repository | Image           | Reference part |
| ------------------------------------------- | ---------- | --------------- | -------------- |
| `arkvory.example/releases/web:1.4`          | `releases` | `web`           | tag `1.4`      |
| `arkvory.example/releases/team/web:1.4`     | `releases` | `team/web`      | tag `1.4`      |
| `arkvory.example/qa/tools/builder@sha256:…` | `qa`       | `tools/builder` | digest         |

| Part       | Rule                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository | Lowercase letters, digits, `_` and `-`. Starts with a letter or a digit. Up to 64 characters.                                               |
| Image      | Components separated by `/`. A component has lowercase letters and digits, joined by `.`, `_`, `__` or dashes. Up to 200 characters in all. |
| Tag        | Letters, digits, `_`, `.` and `-`. Starts with a letter, a digit or `_`. Up to 128 characters.                                              |
| Digest     | `sha256:` and 64 lowercase hexadecimal digits. Other algorithms are refused.                                                                |

A reference without an image part, such as `arkvory.example/web:1.4`, is refused with `NAME_INVALID`: `web` is taken as the repository, and the image name is empty.

## Log in {#log-in}

The registry takes the Arkvory key as the password of HTTP Basic authentication. The user name is not checked: use any name, for example the name of the CI job. A request may also send the key as `Authorization: Bearer <key>`. You need no separate token service.

```bash
docker login arkvory.example -u ci --password-stdin < ~/.arkvory/key
```

```powershell
Get-Content C:\Private\arkvory.key | docker login arkvory.example -u ci --password-stdin
```

Other clients log in the same way:

```bash
podman login arkvory.example -u ci --password-stdin < ~/.arkvory/key
helm registry login arkvory.example -u ci --password-stdin < ~/.arkvory/key
oras login arkvory.example -u ci --password-stdin < ~/.arkvory/key
```

| Key                                       | Use it for                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| Personal access token, scope `read`       | Pulling on a workstation                                                  |
| Personal access token, scope `read-write` | Pushing from a workstation                                                |
| Service key                               | CI/CD and deployment agents. The only kind of key that can delete images. |
| File key from the server keys file        | The installation owner and older integrations (`read` or `write`)         |

A personal token expires. After that, every request gets `401 UNAUTHORIZED`: create a new token and log in again. Docker saves the key in `~/.docker/config.json` unless you configure a credential helper. Protect that file or use a credential store.

## Push and pull {#push-and-pull}

```bash
docker tag web:1.4 arkvory.example/releases/team/web:1.4
docker push arkvory.example/releases/team/web:1.4
docker pull arkvory.example/releases/team/web:1.4
docker pull arkvory.example/releases/team/web@sha256:<digest>
```

What the registry does:

- A layer that the repository already holds is not stored again, even when another image uses it.
- Layers are not shared between repositories. A request to mount a layer from another repository gets an ordinary upload session, so the client sends the layer again.
- Every layer and every manifest is checked against its SHA-256 digest. A mismatch stores nothing and returns `DIGEST_INVALID`.
- A manifest is accepted only when everything it refers to is already in the repository: the config and the layers of an image, or the platform manifests of an index. Platform manifests must be in the same image as their index. Otherwise the answer is `MANIFEST_BLOB_UNKNOWN`.
- Layer downloads support `Range` requests.

The registry accepts these manifest types:

| Media type                                                  | Used for                                       |
| ----------------------------------------------------------- | ---------------------------------------------- |
| `application/vnd.oci.image.manifest.v1+json`                | OCI images, Helm charts, ORAS artifacts        |
| `application/vnd.oci.image.index.v1+json`                   | Multi-platform images, BuildKit registry cache |
| `application/vnd.docker.distribution.manifest.v2+json`      | Docker images (schema 2)                       |
| `application/vnd.docker.distribution.manifest.list.v2+json` | Docker multi-platform images                   |

A manifest has `schemaVersion: 2` and is at most 4 MiB. Docker schema 1 is not supported. The type comes from the `Content-Type` header or from the `mediaType` field of the manifest, and the two must agree. A pull returns the manifest exactly as it was pushed, with its own media type. The registry does not convert between formats.

### Multi-platform images {#multi-platform-images}

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t arkvory.example/releases/team/web:1.4 --push .
```

Buildx pushes each platform manifest by its digest, then the index under the tag. All of them go to the same image name, as the registry requires.

### Build cache {#build-cache}

A BuildKit builder that can export a cache, for example a `docker buildx` builder with the `docker-container` driver, can keep its registry cache in Arkvory:

```bash
docker buildx build \
  --cache-from type=registry,ref=arkvory.example/releases/team/web:cache \
  --cache-to type=registry,ref=arkvory.example/releases/team/web:cache,mode=max \
  -t arkvory.example/releases/team/web:1.4 --push .
```

The cache index lists layers and a cache configuration. Arkvory stores them as blobs of the image and protects them like the layers of any stored manifest.

### Helm charts {#helm-charts}

Helm stores charts as OCI artifacts. After `helm registry login`:

```bash
helm push web-1.4.0.tgz oci://arkvory.example/releases/charts
helm pull oci://arkvory.example/releases/charts/web --version 1.4.0
helm install web oci://arkvory.example/releases/charts/web --version 1.4.0
```

The chart becomes the image `charts/web` with the tag `1.4.0` in the repository `releases`. Arkvory has no classic chart repository with an `index.yaml` file.

### ORAS artifacts {#oras-artifacts}

ORAS stores any files as the layers of an OCI manifest:

```bash
oras push arkvory.example/releases/tools/settings:1.0 ./settings.json:application/json
oras pull arkvory.example/releases/tools/settings:1.0
```

The Referrers API is not available: `/v2/<name>/referrers/<digest>` answers `404`. Clients that follow the OCI specification, such as ORAS, then keep attached artifacts under tags named after the digest instead.

## Tags and digests {#tags-and-digests}

- Pushing a manifest under a tag moves the tag. The manifest that the tag named before stays in the registry and can still be pulled by its digest.
- A push by digest (`PUT /v2/<name>/manifests/sha256:…`) stores the manifest without a tag. The digest must be the SHA-256 of the body.
- Tags are listed in byte order, so uppercase letters come before lowercase ones.

List the tags of an image:

```bash
curl -fsS -u "ci:$ARKVORY_KEY" https://arkvory.example/v2/releases/team/web/tags/list
```

The answer is `{"name": "releases/team/web", "tags": [...]}`. Use `n` for the page size (100 by default, at most 1000) and `last` for the last tag of the previous page. When there are more tags, the `Link` header contains the address of the next page.

Find the digest of a tag:

```bash
curl -fsSI -u "ci:$ARKVORY_KEY" \
  https://arkvory.example/v2/releases/team/web/manifests/1.4 | grep -i docker-content-digest
```

There is no catalog of all images (`/v2/_catalog`). In the console, layers and manifests appear among the artifacts of the repository with the label `oci`, named by their digest. Use [[ui:labelFilter]] in [[ui:catalog]] to show them.

## Delete images and free space {#delete-images}

You delete images through the registry API. The Docker command line has no command for it: use `curl`, `oras manifest delete` or another registry tool.

| Request                                | Effect                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `DELETE /v2/<name>/manifests/<tag>`    | Removes the tag only. The manifest stays and can be pulled by its digest. |
| `DELETE /v2/<name>/manifests/<digest>` | Removes the manifest and every tag that points to it                      |
| `DELETE /v2/<name>/blobs/<digest>`     | Refused with `405`. Layers leave together with their manifests.           |

Both deletions need a service key with the action `artifact.delete` in the repository. Personal tokens, console sessions and file keys cannot delete images. A deletion answers `202`.

```bash
curl -fsS -X DELETE -H "Authorization: Bearer $ARKVORY_CLEANUP_KEY" \
  https://arkvory.example/v2/releases/team/web/manifests/sha256:<digest>
```

How space is freed:

1. While a manifest is stored, with or without a tag, Arkvory protects it and every layer it refers to. Retention skips them with the blocker `reference`.
2. Moving or deleting a tag frees nothing. Old manifests keep their layers until you delete those manifests by digest.
3. After a manifest is deleted by digest, its artifact and the layers that no other manifest uses lose this protection. They stay stored until someone removes them with retention or deletes them as artifacts. See [Storage](../operate/storage).
4. A layer that was pushed without a manifest, for example by a push that failed, is not protected.
5. When a layer that was removed is needed again, the registry reports it as unknown, and the next push uploads it again.

## Permissions {#permissions}

Personal tokens and file keys get read or write access to a repository. Service keys get exact actions.

| Operation                  | Service key actions                                | Personal token or file key                         |
| -------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| Pull manifests and layers  | `content.read`                                     | Read access                                        |
| List tags                  | `artifact.list`                                    | Read access                                        |
| Push                       | `upload.create`, `upload.write`, `upload.complete` | Write access; a token needs the scope `read-write` |
| Delete a tag or a manifest | `artifact.delete`                                  | Not possible                                       |

A CI key that pushes usually pulls too, for example base images or the build cache. Give it `content.read` and `artifact.list` as well. A repository that the key is not granted answers `403 DENIED`.

## Read gateways and mirrors {#read-gateways-and-mirrors}

- A [read gateway](../operate/read-gateways) serves pulls. A push gets `405`.
- A [mirror](../operate/mirrors) receives the images of its source together with their tags and deletions. Clients pull from the mirror at its own address. A push gets `409 DENIED` with the reason `mirror_read_only`.

## Limits {#limits}

| Limit                      | Value                                                                                                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest size              | 4 MiB                                                                                                                                                                                     |
| Layer size                 | The largest object of the installation, `ARKVORY_MAX_OBJECT_BYTES` (about 10 TiB by default)                                                                                              |
| One upload request         | Must finish within 30 minutes and must not pause for more than 30 seconds (`ARKVORY_UPLOAD_DEADLINE_MS`, `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`). 30 minutes is also the highest allowed value. |
| Unfinished upload          | Removed with its bytes after 24 hours without activity                                                                                                                                    |
| Temporary disk space       | Up to twice the size of the layer while it is uploaded                                                                                                                                    |
| Uploads at the same time   | 1 per key and 2 per server by default (`ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`, `ARKVORY_MAX_UPLOADS`). A waiting request gives up after 20 seconds (`ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS`).    |
| Downloads at the same time | 4 per key and 16 per server by default                                                                                                                                                    |
| Tags per page              | 1000                                                                                                                                                                                      |
| Quota                      | Layers, manifests and the bytes of unfinished uploads count against the repository quota and the installation capacity                                                                    |

Docker sends each layer in one request. A layer must therefore arrive within the upload deadline, and a failed layer upload starts again from the first byte. For files of many gigabytes, use [`arkvoryctl`](./cli) instead: it uploads in parts and continues after a failure. The variables are described in [Environment variables](../reference/environment#transfers-and-bandwidth).

## Not supported {#not-supported}

- The Referrers API. It answers `404`, and clients fall back to tags.
- The catalog of all images, `/v2/_catalog`.
- Mounting layers from another repository. The client uploads the layer again.
- A token service for Bearer tokens. Send the key itself with Basic or Bearer.
- A pull-through cache of Docker Hub or of other registries.
- Docker schema 1 manifests and digests other than `sha256`.
- Deleting single layers.
- A section for images in the console.

## Plain HTTP for tests {#plain-http-for-tests}

Docker refuses a registry without HTTPS. Only addresses of the local computer (`localhost`, `127.0.0.0/8`) work over plain HTTP by default. For a test server on another host, add it to `insecure-registries` in the Docker daemon configuration (`/etc/docker/daemon.json` on Linux) and restart Docker:

```json
{
  "insecure-registries": ["arkvory.test:8080"]
}
```

Podman uses the option `--tls-verify=false`. Over plain HTTP, the key travels in clear text. Use this only on a test network.

For a certificate from your own certificate authority, Docker on Linux reads the CA from `/etc/docker/certs.d/<host>/ca.crt` (with the port, if it is not 443). Docker Desktop uses the trust store of the system.

## Troubleshooting {#troubleshooting}

Docker prints registry error codes in lowercase with spaces, for example `denied` or `name invalid`, followed by the message of the server. Each error also has a request ID in `detail.requestId`. Give it to your administrator: it finds the request in the server log.

| Error                                             | Cause                                                                                                                  | What to do                                                                                                                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNAUTHORIZED` (401)                              | The key is missing, wrong, expired or revoked                                                                          | Log in again with a valid key                                                                                                                                                                  |
| `DENIED` (403)                                    | The key cannot write or does not see the repository. A token with scope `read` gets "Read-only personal access token". | Use a key with write access to this repository                                                                                                                                                 |
| `DENIED` (409)                                    | The repository is a mirror                                                                                             | Push to the main server                                                                                                                                                                        |
| `DENIED` (507)                                    | The repository quota or the installation capacity is reached. Unfinished uploads count too.                            | Free space or ask for a larger quota                                                                                                                                                           |
| `NAME_INVALID`                                    | The reference has no image part after the repository, or it has uppercase letters                                      | Use `<host>/<repository>/<image>:<tag>` in lowercase                                                                                                                                           |
| `MANIFEST_UNKNOWN`                                | The tag or digest does not exist in this image                                                                         | Check the name with `tags/list`                                                                                                                                                                |
| `MANIFEST_BLOB_UNKNOWN`                           | A manifest refers to a layer or a platform manifest that is not in this repository                                     | Push the whole image again so that the client uploads the missing parts                                                                                                                        |
| `DIGEST_INVALID`                                  | The bytes do not match the digest                                                                                      | Push again. If it repeats, check the proxy.                                                                                                                                                    |
| `TOOMANYREQUESTS` (503 or 429)                    | Too many transfers of this key at the same time, or the server is busy                                                 | Wait and retry. Lower the parallel uploads of the client, for example `"max-concurrent-uploads": 1` in the Docker daemon configuration, or ask the administrator to raise the transfer limits. |
| `http: server gave HTTP response to HTTPS client` | The server has no HTTPS                                                                                                | Set up [HTTPS](../install/https), or use `insecure-registries` for a test server                                                                                                               |
| `x509: certificate signed by unknown authority`   | Docker does not trust the certificate                                                                                  | Install the CA certificate as described above                                                                                                                                                  |
| `413 Request Entity Too Large`                    | The reverse proxy limits the request size                                                                              | Set `client_max_body_size 0` in nginx                                                                                                                                                          |
| A large layer stops after 30 minutes              | The upload deadline of one request                                                                                     | Use a faster network, or keep such files out of images and upload them with `arkvoryctl`                                                                                                       |

## Related pages {#related-pages}

- [Clients and protocols](./index)
- [Accounts and keys](../use/accounts)
- [HTTPS](../install/https)
- [Storage](../operate/storage)
- [Mirrors](../operate/mirrors) and [Read gateways](../operate/read-gateways)
