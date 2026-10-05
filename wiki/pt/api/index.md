---
title: 'Visão geral da API HTTP'
description: 'As regras de que toda integração com a API HTTP do Arkvory precisa: JSON e tamanhos, descoberta, paginação, revisões, idempotência, tentativas, ranges, erros e limites.'
---

# Visão geral da API HTTP

A API HTTP é a interface que o console web, o cliente de linha de comando e o SDK usam. Tudo o que eles fazem, a sua integração pode fazer em qualquer linguagem. Esta página explica as regras que se aplicam a toda operação. As páginas em [Páginas de referência](#reference-pages) listam cada operação com sua regra de acesso, regra de tentativa, parâmetros e respostas, e são geradas a partir do contrato que o servidor aplica.

## Noções básicas {#basics}

- **Caminho base.** Toda operação está sob `/api/v1`, por exemplo `https://arkvory.example/api/v1/repositories`. As únicas exceções são as verificações de integridade sob `/health`.
- **Formato.** As solicitações e respostas são JSON (`application/json`). Um corpo JSON é limitado a 64 KiB, e uma solicitação que envia outro tipo de conteúdo para uma operação JSON recebe `415`. Os bytes dos arquivos são enviados como `application/octet-stream`.
- **Campos desconhecidos.** A maioria das operações recusa uma solicitação que tenha um campo que elas não definem (`400`, com o campo em `details`). Nas respostas, ignore campos que você não conhece.
- **Horários** são carimbos de data e hora RFC 3339 em UTC. **IDs** de artefatos, uploads, tarefas, contas e chaves são UUIDs.
- **Nomes.** Um nome de repositório corresponde a `[a-z0-9][a-z0-9_-]{0,63}`. Um nome de arquivo (o nome do artefato) tem até 240 caracteres e não pode conter `/` nem `\`. Um caminho em um repositório tem até 1.024 caracteres.
- **Cache.** As respostas trazem `Cache-Control: private, no-store`.
- **Outros protocolos.** As rotas `/v2` (contêineres), `/lfs` (Git LFS) e `/npm` seguem as especificações de seus próprios clientes e usam seus próprios formatos de erro. Elas não fazem parte do documento OpenAPI. Consulte [Clientes e protocolos](../protocols/index).

### Tamanhos e contagens {#sizes}

Um número JSON não consegue carregar todo valor de 64 bits. Por isso, o Arkvory envia **tamanhos e contadores de bytes como cadeias decimais**: `"size": "1048576"`. O mesmo vale para o tamanho que você declara ao criar um upload. Um tamanho não tem sinal, não tem zeros à esquerda e não tem mais de 16 dígitos. Contagens, revisões, limites e índices de partes são inteiros JSON comuns.

O maior objeto é 10.000 GiB (10 737 418 240 000 bytes), a menos que o administrador defina um `ARKVORY_MAX_OBJECT_BYTES` menor. Um tamanho declarado maior é recusado com `400`.

## Autenticação {#authentication}

Toda operação, exceto login, as verificações de integridade públicas e as opções de login, precisa de uma credencial no cabeçalho `Authorization: Bearer <credential>`. A credencial é uma sessão do console, um token de acesso pessoal, uma chave de serviço ou a chave de recuperação. O que uma credencial pode fazer depende do tipo dela e da **regra de acesso** de cada operação. Leia [Autenticação](./authentication) antes de projetar a integração e dê à automação uma chave de serviço com apenas as ações de que ela precisa.

## Descoberta {#discovery}

Um cliente pode perguntar ao servidor o que ele suporta em vez de adivinhar. Todas estas precisam de uma credencial.

| Solicitação                    | Resposta                                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/capabilities`     | As versões da API (`v1`), o papel de gateway (`api` ou `reader`), as feature flags e os limites deste servidor: `maxObjectBytes`, `partBytes` (a menor parte, 8 MiB), `maxPartBytes` (1 GiB), `maxParts` (10.000) e `maxPageSize` (100).                                                                                         |
| `GET /api/v1/operations`       | As operações que esta credencial provavelmente pode chamar, cada uma com seu `operationId`, método, caminho, `surface`, classe `retry`, ações necessárias e condições restantes. Filtre com `repository`, `surface`, `after` e `limit` (1 a 100, 50 por padrão). A lista é apenas indicativa: somente a solicitação real decide. |
| `GET /api/v1/openapi.json`     | O documento OpenAPI 3.0.3 da API de escrita. Adicione `?surface=<name>` para obter apenas uma surface.                                                                                                                                                                                                                           |
| `GET /api/v1/auth/permissions` | As ações da credencial que chama, por repositório.                                                                                                                                                                                                                                                                               |
| `GET /api/v1/auth/me`          | Quem é a credencial, seu tipo e suas concessões amplas de `read`/`write`.                                                                                                                                                                                                                                                        |
| `GET /api/v1/repositories`     | Os repositórios que a credencial pode ver.                                                                                                                                                                                                                                                                                       |

Use `capabilities` para ler os limites em vez de codificá-los fixamente. Trate uma feature flag que você não conhece como `false`.

### Superfícies {#surfaces}

As operações são agrupadas em seis **superfícies**. Elas são rótulos do contrato, não serviços separados; as URLs não mudam.

| Superfície       | O que ela cobre                                                                 |
| ---------------- | ------------------------------------------------------------------------------- |
| `discovery`      | Capacidades, o catálogo de operações, OpenAPI e repositórios                    |
| `identity`       | Login, a identidade do próprio chamador, tokens e ativação de chave             |
| `catalog`        | Artefatos, anotações, pacotes, arquivos por caminho, estágios, promoção, anexos |
| `transfers`      | Sessões de upload, partes, tarefas de conclusão e downloads                     |
| `administration` | Contas, grupos, contas de serviço, chaves, delegações, atualizações e backups   |
| `operations`     | Liveness, readiness, métricas e feedback                                        |

As verificações de integridade são `GET /health/live` (o processo roda) e `GET /health/status` (pública; `{"status":"ready"}` ou `unavailable`) sem credencial, e `GET /health/ready` e `GET /health/metrics` com uma. Elas não usam o orçamento de solicitações, então a carga não faz um balanceador remover o servidor.

## Paginação {#pagination}

Uma lista é retornada uma página por vez. A resposta tem `items` e `next`. Quando `next` não é `null`, envie-o de volta sem alterações no parâmetro de consulta `after` para ler a página seguinte; quando é `null`, a lista está completa. Trate um cursor como uma cadeia opaca e não construa um você mesmo.

`limit` define o tamanho da página, de 1 a 100. A maioria das listas retorna 50 itens quando você o omite. As páginas não são um snapshot: itens que chegam enquanto você lê podem ou não aparecer. Os filtros e a ordem de classificação devem permanecer os mesmos enquanto você segue `next`.

## Revisões e compare-and-swap {#revisions}

Coisas que as pessoas editam têm uma **revisão** que começa em 1: os rótulos, metadados e coleções de um artefato, os anexos de um build, um caminho de arquivo, uma política de armazenamento, o plano de backup e as configurações de uma conta de serviço. Uma alteração nomeia a revisão que espera no corpo da solicitação, como `expectedRevision`:

```json
{ "expectedRevision": 3, "value": { "labels": ["tested"], "metadata": {}, "collections": [] } }
```

Se a revisão atual não for 3, nada muda e o servidor responde `409` com o motivo `revision_mismatch`. Isso é **compare-and-swap**. Leia o estado novamente, aplique a sua alteração a ele e envie a nova revisão. Nunca faça um loop com um número maior para forçar a escrita. Use `0` para algo que ainda não existe, como um novo caminho. A API não usa o cabeçalho `If-Match`.

Um **artefato baixado** tem um validador diferente, o `ETag`. Consulte [Downloads por range e ETags](#range-downloads).

## Chaves de idempotência {#idempotency}

Um cabeçalho `Idempotency-Key` faz uma solicitação repetida ter efeito uma única vez. Use um valor de 1 a 128 caracteres entre letras, dígitos e `_ . : -`, e guarde-o com o estado da tarefa antes da primeira solicitação, para que uma tarefa reiniciada repita a mesma chave. Estas gravações precisam de uma:

| Operação                                                            | Uma repetição com a mesma chave e o mesmo corpo                                                                 |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `createUpload`                                                      | Retorna a mesma sessão de upload.                                                                               |
| `issueServiceKey` e `rotateServiceKey`                              | Retorna os metadados da chave com `200`, sem o segredo. Revogue a chave e emita outra se você perdeu o segredo. |
| `requestBackupRun`, `requestBackupVerify`, `requestBackupRetention` | Retorna a mesma solicitação em vez de enfileirar outra.                                                         |

A mesma chave com um corpo diferente é recusada com `409` e o motivo `idempotency_mismatch`. Uma chave é restrita ao chamador e ao alvo, então dois chamadores podem usar o mesmo valor.

Outras gravações são seguras de repetir por outro motivo: elas definem um estado (definir um estágio, registrar um pacote, revogar uma chave), ou são compare-and-swap. A próxima seção diz quais.

## Regras de tentativa {#retry-rules}

Toda operação tem uma **classe de tentativa**. A classe diz ao cliente o que fazer quando ele não recebeu a resposta. A referência a mostra como "Retry" em cada operação.

| Classe             | Significado                                       | O que fazer                                                                                                                                                                             |
| ------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read`             | A leitura não altera nada.                        | Repita com backoff.                                                                                                                                                                     |
| `idempotent`       | A mesma solicitação tem o mesmo efeito.           | Repita. Uma resposta pode diferir em detalhes: excluir duas vezes pode informar que o objeto não existe mais.                                                                           |
| `idempotency-key`  | Seguro somente com uma chave.                     | Repita com o mesmo `Idempotency-Key` e o mesmo corpo.                                                                                                                                   |
| `compare-and-swap` | Uma alteração que depende de uma revisão.         | Leia o estado, decida novamente e repita com a revisão que você leu. Nunca aumente `expectedRevision` para passar por um `409`.                                                         |
| `reconcile-upload` | Uma etapa de uma sessão de upload.                | Leia primeiro o upload e suas partes (`getUpload`, `listUploadParts`), depois envie o que falta. Um `PUT` de arquivo inteiro não pode continuar no meio: ele recomeça do byte zero.     |
| `reconcile-job`    | Colocar uma tarefa de conclusão na fila.          | Leia primeiro a tarefa (`getCompletionJob`). Uma tarefa com falha pode ser enfileirada novamente.                                                                                       |
| `never-automatic`  | Uma repetição poderia executar a ação duas vezes. | Não repita automaticamente. Verifique o resultado e depois decida. Exemplos: criar uma conta, um token ou um link de download, executar uma política de armazenamento, enviar feedback. |

Uma falha de rede e os status `408`, `429`, `502`, `503` e `504` são temporários: repita de acordo com a classe, espere pelo menos o tempo indicado em `Retry-After` e adicione backoff exponencial com um limite de tentativas. Não repita `401`, `403` e outras respostas `4xx` sem alterar a solicitação. Não repita `500` às cegas; forneça o ID da solicitação ao suporte. Após um `503` em uma alteração, o resultado é desconhecido, então use a classe para descobrir o que aconteceu. O SDK e o cliente de linha de comando aplicam estas regras.

## Downloads por range e ETags {#range-downloads}

`GET` e `HEAD` de `…/artifacts/{id}/content` retornam os bytes originais com um `ETag` forte no formato `"sha256:<hex>"` e `Accept-Ranges: bytes`. O mesmo vale para os downloads por pacote (`…/packages/content`) e por caminho de arquivo (`…/asset/content`, `…/raw/{path}`). Eles procuram o artefato atual em toda solicitação; `packages/content` e `raw` nomeiam o que escolheram em `X-Arkvory-Artifact-Id`, então você pode fixá-lo para uma retomada.

- `Range: bytes=0-1023`, `bytes=1024-` e `bytes=-1024` retornam `206` com `Content-Range`. O servidor serve um range; uma lista de ranges é respondida com o arquivo inteiro.
- Um início além do fim do arquivo retorna `416` com o código `invalid_input`, o motivo `range_not_satisfiable` e `Content-Range: bytes */<size>`.
- Para retomar, envie `Range` junto com `If-Range: "<the ETag you saw>"`. Se o conteúdo por trás de um nome mudou, o `ETag` difere e você recebe o arquivo novo inteiro em vez de um misturado.
- `If-None-Match` com o `ETag` retorna `304` sem corpo.
- Verifique o SHA-256 do que você salvou. O ETag o carrega.

Um link de download (`?token=`) funciona na rota de conteúdo de um artefato. Consulte [Autenticação](./authentication#download-links).

## Erros {#errors}

Toda falha tem o mesmo envelope JSON: `code`, `message`, `requestId` e, quando há mais a dizer, `reason`, `details` e `retryAfterSeconds`. Decida por `code` e `reason`, nunca pela `message`. Motivos desconhecidos contam como ausentes, e um `code` desconhecido é tratado pelo seu status HTTP. Consulte [Erros](./errors).

## Limites de taxa e servidores ocupados {#rate-limits}

O Arkvory não mede chamadas de API por minuto. Ele limita quanto faz ao mesmo tempo e limita tentativas de adivinhar uma senha:

- **Ocupado.** O servidor admite um número fixo de solicitações e transferências ao mesmo tempo (`ARKVORY_MAX_REQUESTS`, 128 por padrão; 2 uploads e 16 downloads por padrão). Uma transferência pode esperar em uma fila limitada por até 20 segundos. Quando não há espaço, a resposta é `503` com o código `busy`. Repita após `Retry-After`.
- **Capacidade.** Uma reserva de disco cheia, uma cota ou um limite no número de objetos retorna `507`, que não melhora esperando.
- **Tentativas.** Tentativas demais de login, registro, senha ou feedback retornam `429` com o código `rate_limited`. Consulte [Autenticação](./authentication#sign-in-limits).

Tanto `429` quanto `503` trazem o cabeçalho `Retry-After` em segundos (2 quando o servidor não tem estimativa), e o mesmo número em `retryAfterSeconds`. Se uma solicitação passar por um proxy, o proxy pode adicionar limites próprios.

## IDs de solicitação {#request-ids}

Toda resposta tem um cabeçalho `X-Request-Id`, e todo erro tem o mesmo valor em `requestId`. Registre-o com a sua própria tarefa e informe-o ao suporte. Um ID de solicitação que você envia é usado somente quando chega por um proxy listado em `ARKVORY_TRUSTED_PROXIES` e tem de 8 a 128 caracteres seguros; caso contrário, o servidor cria um novo. Um cabeçalho W3C `traceparent` é registrado apenas no log de acesso do servidor.

## Navegadores e CORS {#cors}

Uma página web no mesmo endereço do Arkvory funciona sem nenhuma configuração. Uma página em outro endereço funciona somente se o administrador listar sua origem exata em `ARKVORY_CORS_ORIGINS` (até 16, HTTPS ou HTTP de loopback). Outra origem recebe `403` com o motivo `origin_not_allowed`, mesmo quando a chave é válida. As solicitações nunca usam cookies: envie a chave no cabeçalho `Authorization` e mantenha-a na memória. Consulte [Variáveis de ambiente](../reference/environment).

## Promessa de compatibilidade {#evolution}

`/api/v1` muda apenas por adição: novas operações, novos campos opcionais de solicitação, novos campos de resposta, novos motivos de erro e novas feature flags. Uma mudança que quebraria um cliente, como um significado diferente, um novo campo obrigatório, um status diferente ou uma paginação diferente, recebe uma nova versão da API e um período em que ambas funcionam. Em troca, o seu cliente precisa:

- ignorar campos de resposta que não conhece;
- tratar um `reason` desconhecido como ausente e um `code` desconhecido pelo seu status HTTP;
- obter limites de `capabilities`;
- enviar somente os campos que a operação define.

Os valores de `operationId` são nomes estáveis. Use-os quando mapear operações para o seu próprio código.

## Exemplo: enviar um arquivo e baixá-lo {#example}

Esta sequência envia um arquivo em uma única solicitação. Para arquivos acima de alguns gigabytes, ou em links instáveis, use o [`arkvoryctl`](../protocols/cli) ou o [SDK](../protocols/sdk): eles enviam partes e continuam após uma falha. O exemplo usa `jq` para ler o JSON.

Primeiro, defina o endereço e a chave, e calcule o tamanho e o SHA-256 do arquivo:

```bash
export ARKVORY_URL=https://arkvory.example
export ARKVORY_KEY="$(cat ~/.arkvory/key)"
FILE=./Setup.exe
SIZE=$(stat -c %s "$FILE")
SHA=$(sha256sum "$FILE" | cut -d ' ' -f 1)
```

**Etapa 1. Reserve o upload.** A mesma `Idempotency-Key` retorna a mesma sessão, então você pode repetir esta chamada com segurança.

```bash
ID=$(curl -fsS -X POST "$ARKVORY_URL/api/v1/repositories/releases/uploads" \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  -H "Idempotency-Key: build-1042-setup" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Setup.exe\",\"size\":\"$SIZE\",\"sha256\":\"$SHA\",\"labels\":[\"nightly\"]}" \
  | jq -r .id)
```

**Etapa 2. Envie os bytes.** O servidor publica o artefato quando o tamanho e o SHA-256 correspondem.

```bash
curl -fsS -X PUT "$ARKVORY_URL/api/v1/repositories/releases/uploads/$ID/content" \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  -H "Content-Type: application/octet-stream" \
  -T "$FILE" | jq '{id, status}'
```

**Etapa 3. Baixe-o.** O ID do artefato é o ID do upload.

```bash
curl -fL -o Setup-copy.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  "$ARKVORY_URL/api/v1/repositories/releases/artifacts/$ID/content"
sha256sum Setup-copy.exe
```

A etapa 2 responde `{"id": "…", "status": "available"}`. Se a conexão cair durante a etapa 2, leia o upload com `GET …/uploads/$ID`: enquanto o status dele for `pending`, envie o arquivo novamente desde o início. Uma sessão de upload dura 7 dias. A chave precisa das ações `upload.create`, `upload.write`, `upload.complete` e `content.read` em `releases`. Consulte [Uploads](./reference/uploads) e [Transferências](../use/transfers).

## Páginas de referência {#reference-pages}

Cada página lista as operações de um grupo com sua regra de acesso, classe de tentativa, parâmetros e respostas.

- [Sistema e integridade](./reference/system): liveness, readiness, métricas, OpenAPI, capacidades
- [Repositórios](./reference/repositories)
- [Uploads](./reference/uploads)
- [Artefatos e catálogo](./reference/artifacts)
- [Pacotes](./reference/packages)
- [Arquivos por caminho](./reference/files)
- [Estágios e promoção](./reference/promotion)
- [Políticas de armazenamento e retenção](./reference/storage)
- [Espelhos](./reference/mirrors)
- [Links de download](./reference/links)
- [Anexos de build](./reference/attachments)
- [Contas e login](./reference/accounts)
- [Contas de serviço e chaves](./reference/services)
- [Backups](./reference/backups)
- [Atualizações](./reference/updates)
- [Feedback](./reference/feedback)

Páginas relacionadas: [Autenticação](./authentication), [Erros](./errors), [SDK TypeScript](../protocols/sdk).
