---
title: Imagens de contêiner
description: Faça push e pull de imagens Docker e OCI, charts do Helm e artefatos do ORAS pelo registro que todo repositório tem em /v2.
---

# Imagens de contêiner

Todo repositório do Arkvory também é um registro de contêineres. Docker, Podman, Buildx, containerd, Helm e ORAS fazem push e pull nele com o protocolo OCI Distribution. As camadas e os manifestos das imagens são armazenados como artefatos comuns. As permissões do repositório, as cotas, as verificações de SHA-256, os backups e os espelhos se aplicam a eles como a qualquer outro arquivo.

## Antes de começar {#before-you-start}

Você precisa de:

- O endereço do servidor com HTTPS e um certificado confiável, por exemplo `arkvory.example`. Consulte [HTTPS](../install/https).
- Um repositório, por exemplo `releases`.
- Uma chave: um token de acesso pessoal ou uma chave de serviço. Consulte [Contas e chaves](../use/accounts).

O registro responde na raiz do host, em `/v2/`. Ele não pode funcionar sob um prefixo de caminho como `https://example.com/arkvory/`, porque o Docker não oferece suporte a isso. Um proxy reverso precisa repassar `/v2/` sem alterações e não pode armazenar em buffer o corpo das solicitações. No nginx, defina `client_max_body_size 0` e desative o buffering das solicitações.

## Nomes de imagens {#image-names}

Uma referência de imagem tem este formato:

```text
<host>/<repository>/<image>:<tag>
<host>/<repository>/<image>@sha256:<digest>
```

O primeiro segmento do caminho é o repositório do Arkvory. Ele é o limite de acesso: uma chave vê somente os repositórios que lhe foram concedidos. O restante é o nome da imagem, com um ou mais componentes.

| Referência                                  | Repositório | Imagem          | Parte da referência |
| ------------------------------------------- | ----------- | --------------- | ------------------- |
| `arkvory.example/releases/web:1.4`          | `releases`  | `web`           | tag `1.4`           |
| `arkvory.example/releases/team/web:1.4`     | `releases`  | `team/web`      | tag `1.4`           |
| `arkvory.example/qa/tools/builder@sha256:…` | `qa`        | `tools/builder` | digest              |

| Parte       | Regra                                                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Repositório | Letras minúsculas, dígitos, `_` e `-`. Começa com uma letra ou um dígito. Até 64 caracteres.                                                    |
| Imagem      | Componentes separados por `/`. Um componente tem letras minúsculas e dígitos, unidos por `.`, `_`, `__` ou hifens. Até 200 caracteres no total. |
| Tag         | Letras, dígitos, `_`, `.` e `-`. Começa com uma letra, um dígito ou `_`. Até 128 caracteres.                                                    |
| Digest      | `sha256:` e 64 dígitos hexadecimais minúsculos. Outros algoritmos são recusados.                                                                |

Uma referência sem a parte da imagem, como `arkvory.example/web:1.4`, é recusada com `NAME_INVALID`: `web` é tomado como o repositório, e o nome da imagem fica vazio.

## Fazer login {#log-in}

O registro aceita a chave do Arkvory como a senha da autenticação HTTP Basic. O nome de usuário não é verificado: use qualquer nome, por exemplo o nome do job de CI. Uma solicitação também pode enviar a chave como `Authorization: Bearer <key>`. Você não precisa de um serviço de tokens separado.

```bash
docker login arkvory.example -u ci --password-stdin < ~/.arkvory/key
```

```powershell
Get-Content C:\Private\arkvory.key | docker login arkvory.example -u ci --password-stdin
```

Outros clientes fazem login da mesma forma:

```bash
podman login arkvory.example -u ci --password-stdin < ~/.arkvory/key
helm registry login arkvory.example -u ci --password-stdin < ~/.arkvory/key
oras login arkvory.example -u ci --password-stdin < ~/.arkvory/key
```

| Chave                                             | Use para                                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| Token de acesso pessoal, escopo `read`            | Pull em uma estação de trabalho                                                   |
| Token de acesso pessoal, escopo `read-write`      | Push a partir de uma estação de trabalho                                          |
| Chave de serviço                                  | CI/CD e agentes de implantação. É o único tipo de chave que pode excluir imagens. |
| Chave de arquivo do arquivo de chaves do servidor | O proprietário da instalação e integrações mais antigas (`read` ou `write`)       |

Um token pessoal expira. Depois disso, toda solicitação recebe `401 UNAUTHORIZED`: crie um novo token e faça login de novo. O Docker salva a chave em `~/.docker/config.json`, a menos que você configure um credential helper. Proteja esse arquivo ou use um armazenamento de credenciais.

## Push e pull {#push-and-pull}

```bash
docker tag web:1.4 arkvory.example/releases/team/web:1.4
docker push arkvory.example/releases/team/web:1.4
docker pull arkvory.example/releases/team/web:1.4
docker pull arkvory.example/releases/team/web@sha256:<digest>
```

O que o registro faz:

- Uma camada que o repositório já tem não é armazenada de novo, mesmo quando outra imagem a usa.
- As camadas não são compartilhadas entre repositórios. Uma solicitação para montar uma camada de outro repositório recebe uma sessão de upload comum, então o cliente envia a camada de novo.
- Cada camada e cada manifesto é verificado com o digest SHA-256 dele. Uma divergência não armazena nada e retorna `DIGEST_INVALID`.
- Um manifesto só é aceito quando tudo a que ele se refere já está no repositório: a config e as camadas de uma imagem, ou os manifestos de plataforma de um índice. Os manifestos de plataforma precisam estar na mesma imagem que o índice deles. Caso contrário, a resposta é `MANIFEST_BLOB_UNKNOWN`.
- Os downloads de camadas aceitam solicitações `Range`.

O registro aceita estes tipos de manifesto:

| Tipo de mídia                                               | Usado para                                             |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| `application/vnd.oci.image.manifest.v1+json`                | Imagens OCI, charts do Helm, artefatos do ORAS         |
| `application/vnd.oci.image.index.v1+json`                   | Imagens multiplataforma, cache de registro do BuildKit |
| `application/vnd.docker.distribution.manifest.v2+json`      | Imagens Docker (schema 2)                              |
| `application/vnd.docker.distribution.manifest.list.v2+json` | Imagens Docker multiplataforma                         |

Um manifesto tem `schemaVersion: 2` e no máximo 4 MiB. O schema 1 do Docker não é aceito. O tipo vem do cabeçalho `Content-Type` ou do campo `mediaType` do manifesto, e os dois devem coincidir. Um pull retorna o manifesto exatamente como foi enviado, com o próprio tipo de mídia. O registro não converte entre formatos.

### Imagens multiplataforma {#multi-platform-images}

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t arkvory.example/releases/team/web:1.4 --push .
```

O Buildx envia cada manifesto de plataforma pelo digest dele e depois o índice com a tag. Todos vão para o mesmo nome de imagem, como o registro exige.

### Cache de build {#build-cache}

Um builder do BuildKit que consegue exportar um cache, por exemplo um builder do `docker buildx` com o driver `docker-container`, pode manter o cache de registro dele no Arkvory:

```bash
docker buildx build \
  --cache-from type=registry,ref=arkvory.example/releases/team/web:cache \
  --cache-to type=registry,ref=arkvory.example/releases/team/web:cache,mode=max \
  -t arkvory.example/releases/team/web:1.4 --push .
```

O índice do cache lista camadas e uma configuração de cache. O Arkvory os armazena como blobs da imagem e os protege como as camadas de qualquer manifesto armazenado.

### Charts do Helm {#helm-charts}

O Helm armazena charts como artefatos OCI. Depois de `helm registry login`:

```bash
helm push web-1.4.0.tgz oci://arkvory.example/releases/charts
helm pull oci://arkvory.example/releases/charts/web --version 1.4.0
helm install web oci://arkvory.example/releases/charts/web --version 1.4.0
```

O chart se torna a imagem `charts/web` com a tag `1.4.0` no repositório `releases`. O Arkvory não tem um repositório de charts clássico com um arquivo `index.yaml`.

### Artefatos do ORAS {#oras-artifacts}

O ORAS armazena arquivos quaisquer como as camadas de um manifesto OCI:

```bash
oras push arkvory.example/releases/tools/settings:1.0 ./settings.json:application/json
oras pull arkvory.example/releases/tools/settings:1.0
```

A Referrers API não está disponível: `/v2/<name>/referrers/<digest>` responde `404`. Os clientes que seguem a especificação OCI, como o ORAS, passam então a manter os artefatos anexados em tags nomeadas a partir do digest.

## Tags e digests {#tags-and-digests}

- Enviar um manifesto com uma tag move a tag. O manifesto que a tag indicava antes continua no registro e ainda pode ser baixado pelo digest dele.
- Um push por digest (`PUT /v2/<name>/manifests/sha256:…`) armazena o manifesto sem uma tag. O digest deve ser o SHA-256 do corpo.
- As tags são listadas em ordem de bytes, então as letras maiúsculas vêm antes das minúsculas.

Liste as tags de uma imagem:

```bash
curl -fsS -u "ci:$ARKVORY_KEY" https://arkvory.example/v2/releases/team/web/tags/list
```

A resposta é `{"name": "releases/team/web", "tags": [...]}`. Use `n` para o tamanho da página (100 por padrão, no máximo 1000) e `last` para a última tag da página anterior. Quando há mais tags, o cabeçalho `Link` contém o endereço da próxima página.

Encontre o digest de uma tag:

```bash
curl -fsSI -u "ci:$ARKVORY_KEY" \
  https://arkvory.example/v2/releases/team/web/manifests/1.4 | grep -i docker-content-digest
```

Não existe um catálogo de todas as imagens (`/v2/_catalog`). No console, as camadas e os manifestos aparecem entre os artefatos do repositório com o rótulo `oci`, nomeados pelo digest. Use [[ui:labelFilter]] em [[ui:catalog]] para mostrá-los.

## Excluir imagens e liberar espaço {#delete-images}

Você exclui imagens pela API do registro. A linha de comando do Docker não tem um comando para isso: use `curl`, `oras manifest delete` ou outra ferramenta de registro.

| Solicitação                            | Efeito                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `DELETE /v2/<name>/manifests/<tag>`    | Remove somente a tag. O manifesto permanece e pode ser baixado pelo digest dele. |
| `DELETE /v2/<name>/manifests/<digest>` | Remove o manifesto e todas as tags que apontam para ele                          |
| `DELETE /v2/<name>/blobs/<digest>`     | Recusada com `405`. As camadas saem junto com os manifestos delas.               |

As duas exclusões exigem uma chave de serviço com a ação `artifact.delete` no repositório. Tokens pessoais, sessões do console e chaves de arquivo não podem excluir imagens. Uma exclusão responde `202`.

```bash
curl -fsS -X DELETE -H "Authorization: Bearer $ARKVORY_CLEANUP_KEY" \
  https://arkvory.example/v2/releases/team/web/manifests/sha256:<digest>
```

Como o espaço é liberado:

1. Enquanto um manifesto está armazenado, com ou sem tag, o Arkvory o protege, assim como todas as camadas a que ele se refere. A retenção os ignora com o bloqueio `reference`.
2. Mover ou excluir uma tag não libera nada. Os manifestos antigos mantêm as camadas deles até você excluí-los pelo digest.
3. Depois que um manifesto é excluído pelo digest, o artefato dele e as camadas que nenhum outro manifesto usa perdem essa proteção. Elas continuam armazenadas até alguém removê-las com a retenção ou excluí-las como artefatos. Consulte [Armazenamento](../operate/storage).
4. Uma camada que foi enviada sem um manifesto, por exemplo em um push que falhou, não é protegida.
5. Quando uma camada que foi removida é necessária de novo, o registro a informa como desconhecida, e o próximo push a envia novamente.

## Permissões {#permissions}

Tokens pessoais e chaves de arquivo recebem acesso de leitura ou de gravação a um repositório. Chaves de serviço recebem ações exatas.

| Operação                        | Ações da chave de serviço                          | Token pessoal ou chave de arquivo                           |
| ------------------------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| Pull de manifestos e camadas    | `content.read`                                     | Acesso de leitura                                           |
| Listar tags                     | `artifact.list`                                    | Acesso de leitura                                           |
| Push                            | `upload.create`, `upload.write`, `upload.complete` | Acesso de gravação; um token precisa do escopo `read-write` |
| Excluir uma tag ou um manifesto | `artifact.delete`                                  | Não é possível                                              |

Uma chave de CI que faz push normalmente também faz pull, por exemplo de imagens base ou do cache de build. Dê a ela também `content.read` e `artifact.list`. Um repositório ao qual a chave não tem acesso responde `403 DENIED`.

## Gateways de leitura e espelhos {#read-gateways-and-mirrors}

- Um [gateway de leitura](../operate/read-gateways) atende pulls. Um push recebe `405`.
- Um [espelho](../operate/mirrors) recebe as imagens da origem dele junto com as tags e as exclusões. Os clientes fazem pull do espelho no endereço dele. Um push recebe `409 DENIED` com o motivo `mirror_read_only`.

## Limites {#limits}

| Limite                     | Valor                                                                                                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tamanho do manifesto       | 4 MiB                                                                                                                                                                                               |
| Tamanho da camada          | O maior objeto da instalação, `ARKVORY_MAX_OBJECT_BYTES` (cerca de 10 TiB por padrão)                                                                                                               |
| Uma solicitação de upload  | Deve ser concluída em até 30 minutos e não pode ficar parada por mais de 30 segundos (`ARKVORY_UPLOAD_DEADLINE_MS`, `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`). 30 minutos também é o maior valor permitido. |
| Upload não concluído       | Removido com seus bytes após 24 horas sem atividade                                                                                                                                                 |
| Espaço temporário em disco | Até o dobro do tamanho da camada durante o upload                                                                                                                                                   |
| Uploads ao mesmo tempo     | 1 por chave e 2 por servidor por padrão (`ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`, `ARKVORY_MAX_UPLOADS`). Uma solicitação em espera desiste após 20 segundos (`ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS`).     |
| Downloads ao mesmo tempo   | 4 por chave e 16 por servidor por padrão                                                                                                                                                            |
| Tags por página            | 1000                                                                                                                                                                                                |
| Cota                       | As camadas, os manifestos e os bytes de uploads não concluídos contam na cota do repositório e na capacidade da instalação                                                                          |

O Docker envia cada camada em uma única solicitação. Por isso, uma camada precisa chegar dentro do prazo de upload, e um upload de camada que falha recomeça do primeiro byte. Para arquivos de muitos gigabytes, use o [`arkvoryctl`](./cli): ele envia em partes e continua depois de uma falha. As variáveis são descritas em [Variáveis de ambiente](../reference/environment#transfers-and-bandwidth).

## Sem suporte {#not-supported}

- A Referrers API. Ela responde `404`, e os clientes recorrem às tags.
- O catálogo de todas as imagens, `/v2/_catalog`.
- A montagem de camadas de outro repositório. O cliente envia a camada de novo.
- Um serviço de tokens para tokens Bearer. Envie a própria chave com Basic ou Bearer.
- Um cache pull-through do Docker Hub ou de outros registros.
- Manifestos do schema 1 do Docker e digests diferentes de `sha256`.
- A exclusão de camadas individuais.
- Uma seção para imagens no console.

## HTTP simples para testes {#plain-http-for-tests}

O Docker recusa um registro sem HTTPS. Por padrão, somente endereços do computador local (`localhost`, `127.0.0.0/8`) funcionam por HTTP simples. Para um servidor de teste em outro host, adicione-o a `insecure-registries` na configuração do daemon do Docker (`/etc/docker/daemon.json` no Linux) e reinicie o Docker:

```json
{
  "insecure-registries": ["arkvory.test:8080"]
}
```

O Podman usa a opção `--tls-verify=false`. Por HTTP simples, a chave trafega em texto claro. Use isso somente em uma rede de teste.

Para um certificado da sua própria autoridade certificadora, o Docker no Linux lê a CA de `/etc/docker/certs.d/<host>/ca.crt` (com a porta, se não for 443). O Docker Desktop usa o repositório de certificados confiáveis do sistema.

## Solução de problemas {#troubleshooting}

O Docker imprime os códigos de erro do registro em minúsculas e com espaços, por exemplo `denied` ou `name invalid`, seguidos da mensagem do servidor. Cada erro também tem um ID da solicitação em `detail.requestId`. Informe-o ao seu administrador: com ele, a solicitação é encontrada no log do servidor.

| Erro                                              | Causa                                                                                                                      | O que fazer                                                                                                                                                                                                       |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNAUTHORIZED` (401)                              | A chave está ausente, incorreta, expirada ou revogada                                                                      | Faça login de novo com uma chave válida                                                                                                                                                                           |
| `DENIED` (403)                                    | A chave não pode gravar ou não enxerga o repositório. Um token com escopo `read` recebe "Read-only personal access token". | Use uma chave com acesso de gravação a este repositório                                                                                                                                                           |
| `DENIED` (409)                                    | O repositório é um espelho                                                                                                 | Faça push no servidor principal                                                                                                                                                                                   |
| `DENIED` (507)                                    | A cota do repositório ou a capacidade da instalação foi atingida. Os uploads não concluídos também contam.                 | Libere espaço ou peça uma cota maior                                                                                                                                                                              |
| `NAME_INVALID`                                    | A referência não tem a parte da imagem depois do repositório, ou tem letras maiúsculas                                     | Use `<host>/<repository>/<image>:<tag>` em minúsculas                                                                                                                                                             |
| `MANIFEST_UNKNOWN`                                | A tag ou o digest não existe nesta imagem                                                                                  | Confira o nome com `tags/list`                                                                                                                                                                                    |
| `MANIFEST_BLOB_UNKNOWN`                           | Um manifesto se refere a uma camada ou a um manifesto de plataforma que não está neste repositório                         | Envie a imagem inteira de novo para que o cliente envie as partes que faltam                                                                                                                                      |
| `DIGEST_INVALID`                                  | Os bytes não correspondem ao digest                                                                                        | Envie de novo. Se repetir, verifique o proxy.                                                                                                                                                                     |
| `TOOMANYREQUESTS` (503 ou 429)                    | Muitas transferências desta chave ao mesmo tempo, ou o servidor está ocupado                                               | Aguarde e tente de novo. Reduza os uploads paralelos do cliente, por exemplo `"max-concurrent-uploads": 1` na configuração do daemon do Docker, ou peça ao administrador que aumente os limites de transferência. |
| `http: server gave HTTP response to HTTPS client` | O servidor não tem HTTPS                                                                                                   | Configure o [HTTPS](../install/https) ou use `insecure-registries` para um servidor de teste                                                                                                                      |
| `x509: certificate signed by unknown authority`   | O Docker não confia no certificado                                                                                         | Instale o certificado da CA como descrito acima                                                                                                                                                                   |
| `413 Request Entity Too Large`                    | O proxy reverso limita o tamanho da solicitação                                                                            | Defina `client_max_body_size 0` no nginx                                                                                                                                                                          |
| Uma camada grande para após 30 minutos            | O prazo de upload de uma única solicitação                                                                                 | Use uma rede mais rápida, ou mantenha esses arquivos fora das imagens e envie-os com o `arkvoryctl`                                                                                                               |

## Páginas relacionadas {#related-pages}

- [Clientes e protocolos](./index)
- [Contas e chaves](../use/accounts)
- [HTTPS](../install/https)
- [Armazenamento](../operate/storage)
- [Espelhos](../operate/mirrors) e [Gateways de leitura](../operate/read-gateways)
