---
title: Uploads e downloads
description: Envie e baixe arquivos de qualquer tamanho, continue após uma interrupção, verifique somas de verificação e compartilhe um arquivo sem uma chave.
---

# Uploads e downloads

Arquivos de qualquer tamanho são enviados ao Arkvory em partes, e uma transferência interrompida pode continuar de onde parou. Esta página mostra como, no console, com `arkvoryctl`, com o SDK e com a API HTTP.

Um upload exige as ações `upload.create`, `upload.read`, `upload.write` e `upload.complete`. Em termos de grupos, exige acesso de escrita. Um download exige `content.read`. Consulte [Permissões](./accounts#permissions).

## Envie um arquivo {#upload}

Todo upload segue as mesmas etapas. O cliente calcula o SHA-256 do arquivo inteiro e inicia uma sessão de upload com nome, tamanho e soma de verificação. Envia o arquivo em partes. Quando todas chegam, o servidor as monta, verifica a soma e publica o arquivo como artefato imutável.

### No console {#upload-console}

1. Selecione [[ui:upload]] na barra lateral ou [[ui:uploadFile]] na barra superior.
2. Escolha o arquivo em [[ui:chooseFile]]. O console lê o arquivo inteiro uma vez para calcular sua soma de verificação ([[ui:hashing]]). Para dezenas de gigabytes, isso leva um tempo antes de enviar o primeiro byte.
3. Selecione [[ui:startUpload]]. A barra em [[ui:transferTitle]] mostra o progresso.
4. Quando o arquivo é publicado, seu ID aparece. Abra [[ui:catalog]] para vê-lo.

[[ui:pause]] interrompe a transferência e mantém as partes recebidas. O navegador avisa antes de você sair da página durante um upload. O console não envia rótulos nem metadados com o arquivo. Acrescente-os depois em [[ui:metadata]]; consulte [Arquivos por caminho](./files#labels).

### Com arkvoryctl {#upload-cli}

```bash
arkvoryctl upload ./Build/Game.zip --label test
arkvoryctl upload ./Build/Game.zip --file metadata.json --state ./job-state/game.json
arkvoryctl uploads status 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl uploads cancel 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`upload` imprime o artefato quando ele é publicado. `--label` acrescenta um rótulo. `--file` aponta para um arquivo JSON com `labels` e `metadata` e tem prioridade. Para armazenar sob um caminho, use `put`; para publicar um UPack, use `packages publish`. Consulte [Linha de comando](../protocols/cli#transfers).

### Com o SDK {#upload-sdk}

```typescript
const session = await releases.uploads.create(idempotencyKey, {
  name: 'Game.zip',
  size: String(file.size),
  sha256,
  labels: ['test'],
  metadata: { commit: 'abc123' },
});
const artifact = await releases.uploads.resume(session.id, file, {
  onProgress: (bytes) => console.log(bytes),
});
```

`resume` envia as partes ausentes no servidor e conclui o upload. O exemplo completo, com cálculo do hash no Node.js, está em [SDK TypeScript](../protocols/sdk#upload-a-large-file-with-resume-node-js).

### Com a API HTTP {#upload-http}

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/uploads" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Idempotency-Key: game-1234" \
  -H "Content-Type: application/json" \
  -d '{"name":"Game.zip","size":"73400320","sha256":"<64 hex digits>"}'

curl "$ARKVORY/api/v1/repositories/releases/uploads/$ID/parts" -H "Authorization: Bearer $ARKVORY_KEY"

curl -X PUT "$ARKVORY/api/v1/repositories/releases/uploads/$ID/parts/0" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/octet-stream" \
  -H "X-Content-SHA256: <64 hex digits of this part>" --data-binary @part-0.bin

curl -X POST "$ARKVORY/api/v1/repositories/releases/uploads/$ID/complete" \
  -H "Authorization: Bearer $ARKVORY_KEY"
```

O tamanho é uma string decimal. `Idempotency-Key` tem de 1 a 128 letras, dígitos, `.`, `_`, `:` ou `-`. A primeira resposta contém o `id` do upload e `expiresAt`. A segunda retorna o tamanho das partes, `partBytes`, e as partes já armazenadas. Toda parte tem exatamente esse tamanho, exceto a última. As operações são `createUpload`, `listUploadParts`, `putUploadPart` e `completeUpload` ([Uploads](../api/reference/uploads)).

Para um arquivo pequeno, há duas formas mais simples. `PUT /uploads/{id}/content` envia o arquivo inteiro em uma solicitação. `PUT /raw/<path>` cria a sessão, envia os bytes e os armazena em um caminho em uma solicitação, como `curl -T`. Ambas devem terminar em 30 minutos. Use partes para arquivos grandes ou conexões lentas. Consulte [Arquivos brutos](../protocols/raw-files). Um arquivo vazio é enviado em uma solicitação.

## Qual pode ser o tamanho de um arquivo {#limits}

| Limite            | Valor                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tamanho da parte  | 8 MiB para arquivos até cerca de 78 GiB. Arquivos maiores usam 16, 32, 64 MiB e assim por diante, até 1 GiB, para nunca exigir mais de 10 000 partes. |
| Partes por upload | 10 000 (índices de 0 a 9999)                                                                                                                          |
| Maior arquivo     | 10 000 partes de 1 GiB, cerca de 10 TiB                                                                                                               |
| Limite menor      | O administrador pode definir um com `ARKVORY_MAX_OBJECT_BYTES`                                                                                        |
| Nome do arquivo   | De 1 a 240 caracteres, sem `/`, `\` ou caracteres de controle                                                                                         |

O servidor escolhe o tamanho da parte ao criar o upload e o mantém até o fim. `GET /api/v1/capabilities` mostra `maxObjectBytes`, `partBytes`, `maxPartBytes` e `maxParts`. O console recusa arquivos acima do limite antes de começar.

O cliente mantém uma parte na memória enquanto calcula seu hash e a envia. Acima de 78 GiB, a parte e o uso de memória crescem até 1 GiB.

O espaço livre no servidor deve comportar as partes e o arquivo montado por um tempo. Se o disco estiver cheio, o servidor recusa o upload com `507 storage_full`.

## Retome um upload {#resume}

A sessão mantém suas partes após uma falha. Para continuar, forneça ao cliente o mesmo arquivo e a mesma sessão.

**Console.** Na aba aberta, selecione [[ui:startUpload]] novamente após [[ui:pause]]. Depois de fechar a aba, guarde o ID do upload. Expanda [[ui:resumeTitle]]: [[ui:uploadId]] mostra o ID durante o upload. Depois, escolha o mesmo arquivo, informe o ID e selecione [[ui:startUpload]]. O console compara as partes com seu arquivo. Se diferirem, ele para e avisa. [[ui:newUpload]] limpa ambos os campos e inicia um novo upload.

O campo [[ui:idempotency]] é outra forma de retomar. O console o preenche sozinho. A mesma chave com o mesmo arquivo retorna a mesma sessão, em vez de criar outra.

**arkvoryctl.** Execute o mesmo comando com as mesmas opções. Antes da primeira solicitação, o cliente salvou um checkpoint `<file>.arkvory-upload.json` junto ao arquivo de origem, ou no arquivo informado em `--state`. Para publicar os mesmos bytes como novo artefato, use um novo `--state`. Em CI, mantenha o arquivo de origem e a pasta de estado entre tentativas. Alterar arquivo, servidor, repositório ou opções resulta em `checkpoint_mismatch` (código de saída 6).

**SDK.** Chame `resume` novamente com o ID salvo e o mesmo arquivo. Se até a resposta de `create` foi perdida, chame `create` com a mesma chave de idempotência e o mesmo descritor: ele retorna a mesma sessão.

**HTTP.** Leia as partes armazenadas com `listUploadParts` e envie os índices ausentes. Reenviar uma parte com os mesmos bytes é seguro. Bytes diferentes para um índice armazenado são recusados com `409 upload_state`.

Os clientes também repetem solicitações após falhas de rede ou respostas `408`, `429`, `502`, `503` e `504`: até 20 vezes por operação, com pausa crescente de 0,5 a 60 segundos, respeitando `Retry-After`. `arkvoryctl` tem as opções `--retries` e `--attempt-timeout` para conexões lentas.

Somente a conta ou chave que criou o upload pode continuá-lo. Para outros, ele não existe. Rotacionar uma chave de serviço mantém a conta, então a nova chave pode continuar o upload.

## Somas de verificação {#checksums}

- **Antes do upload.** O console, o CLI e o SDK calculam o SHA-256 do arquivo e o enviam na sessão.
- **Cada parte.** `X-Content-SHA256` contém a soma da parte. Bytes que não correspondem são recusados com `422 integrity_mismatch` e não são armazenados.
- **Ao concluir.** O servidor verifica o tamanho e o SHA-256 do arquivo montado contra a sessão antes de publicar. Uma divergência resulta em `422 integrity_mismatch`; o CLI sai com código 5. O artefato não aparece.
- **Downloads.** O console, o CLI e o SDK verificam o SHA-256 do arquivo inteiro antes de entregá-lo. O arquivo final aparece somente após a verificação passar.

O ETag de um arquivo é sua soma: `"sha256:<64 hex digits>"`. Os detalhes mostram o SHA-256, e [[ui:copyHash]] o copia.

## Tarefa de conclusão {#completion}

Montar um arquivo grande leva tempo. Abaixo de 16 GiB, `completeUpload` monta dentro da solicitação, que pode levar até 30 minutos. A partir de 16 GiB, o SDK, e portanto o console e o CLI, pedem que o worker conclua: `enqueueCompletion` responde `202` com uma tarefa, e o cliente consulta `getCompletionJob` até o estado ser `completed` ou `failed`. Uma tarefa malsucedida tem um código de erro, como `integrity_mismatch`.

O serviço worker deve estar em execução para as tarefas. Ele tenta até 5 vezes, com pausa crescente, e desiste imediatamente de erros que uma repetição não corrige. Repetir `enqueueCompletion` retorna a mesma tarefa. Se o servidor reiniciar, ela continua. Você não precisa reiniciar o upload.

## Expiração do upload {#expiry}

Uma sessão incompleta expira 7 dias após ser criada. O horário está em `expiresAt`, não é prorrogado e não muda quando você envia partes. Depois disso, partes e `complete` são recusados com `409 upload_expired`. Inicie outro upload. Arquivos publicados nunca expiram.

O servidor remove sessões expiradas e suas partes em segundo plano. Para desistir antes, use `arkvoryctl uploads cancel ID` ou `cancelUpload`. Cancelar não é pausar: as partes são descartadas.

## Baixe um arquivo {#download}

### No console {#download-console}

Selecione [[ui:download]] ao lado de um arquivo em [[ui:catalog]] ou nos detalhes do artefato. O navegador pergunta onde salvar. O arquivo entra na fila em [[ui:downloads]]. A fila grava os dados em uma cópia temporária, verifica o SHA-256 e só então substitui o arquivo de destino.

A fila precisa de Chrome ou Edge em HTTPS ou no computador local, pois grava arquivos grandes pelo acesso ao sistema de arquivos do navegador. Outros navegadores devem usar o CLI ou o SDK.

Os estados são [[ui:downloadQueued]], [[ui:downloadRunning]], [[ui:downloadRetrying]], [[ui:downloadPaused]], [[ui:downloadSaving]], [[ui:downloadCompleted]], [[ui:downloadFailed]] e [[ui:downloadCancelled]]. Os botões são:

| Botão                                          | Efeito                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| [[ui:downloadResume]]                          | Continua um download pausado ou malsucedido a partir da parte salva |
| [[ui:downloadCancel]]                          | Cancela um download e exclui sua cópia temporária                   |
| [[ui:downloadsPause]] / [[ui:downloadsResume]] | Pausa e libera toda a fila                                          |
| [[ui:downloadsClearWaiting]]                   | Cancela os downloads em espera                                      |
| [[ui:downloadsCancel]]                         | Cancela todos os downloads                                          |
| [[ui:downloadsClearFinished]]                  | Remove linhas concluídas para liberar espaço (a fila comporta 64)   |
| [[ui:downloadRestore]]                         | Após recarregar a página, recupera os downloads incompletos         |

[[ui:downloadSettings]] tem [[ui:downloadConcurrency]] (1 a 8, padrão 2), [[ui:downloadInterval]] (0 a 60 000 ms, padrão 250) e [[ui:downloadWait]] (1 a 1800 segundos, padrão 300). Selecione [[ui:downloadApply]] para aplicá-los. Eles não aumentam os limites do servidor.

Após recarregar ou fechar a aba, entre novamente no mesmo servidor com a mesma conta, abra [[ui:downloads]] e selecione [[ui:downloadRestore]]. Os downloads recuperados ficam pausados. Selecione [[ui:downloadResume]] em cada um e escolha novamente o arquivo de destino. O navegador precisa de espaço livre para a cópia temporária.

### Com arkvoryctl {#download-cli}

```bash
arkvoryctl download 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game.zip
arkvoryctl get builds/game/1.4/Game.zip ./Game.zip
arkvoryctl packages download app ./app.upack --range ^1.4 --stage release
```

Durante um download, `<output>.arkvory-part` e `<output>.arkvory-download.json` ficam junto ao destino. Após uma interrupção, execute novamente o mesmo comando. O arquivo final aparece só depois da verificação SHA-256. Um destino existente nunca é sobrescrito (`destination_exists`, código de saída 6).

### Com HTTP: intervalos e ETag {#download-http}

`downloadArtifact` retorna os bytes de um artefato. `HEAD` retorna só os cabeçalhos.

```bash
curl -fL -H "Authorization: Bearer $ARKVORY_KEY" -C - -o Game.zip \
  "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/content"
```

- `Accept-Ranges: bytes`. Envie `Range: bytes=1048576-`, `bytes=0-1023` ou `bytes=-500` para um intervalo. A resposta é `206` com `Content-Range`. Vários intervalos simultâneos não são suportados: o servidor envia o arquivo inteiro. Um início além do fim resulta em `416`.
- `ETag` é `"sha256:<hex>"`. `If-None-Match` com ele resulta em `304`. `If-Range` continua um intervalo somente quando o arquivo ainda é o mesmo; caso contrário, vem o arquivo inteiro.
- `curl -C -` retoma um download. Endereços por nome são resolvidos em cada solicitação, como `packages/content?name=app&range=^1.4`, então o arquivo pode mudar entre chamadas. Para retomar com segurança, envie o ETag recebido em `If-Range`, ou resolva primeiro o nome e baixe pelo ID do artefato.

O SDK lê em intervalos de 8 MiB e verifica cada um. Consulte [SDK TypeScript](../protocols/sdk#download-with-verification).

## Links para pessoas sem uma chave {#links}

Um link permite baixar um arquivo sem chave: um testador, um cliente ou uma máquina de build sem credenciais. Abre somente esse artefato, para `GET` e `HEAD`, até expirar. Funciona com `curl -C -` e intervalos.

No console, abra o artefato em [[ui:metadata]] e selecione [[ui:downloadLink]]. O console copia e mostra o link com sua validade. Dura uma hora. O botão aparece somente se você pode baixar o arquivo.

```bash
arkvoryctl link 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --ttl 900
```

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/links" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"ttlSeconds":900}'
```

A validade vai de 60 segundos a 24 horas (86 400 segundos), com uma hora por padrão. A resposta contém um `token` que começa com `dtl_`, uma `url` e `expiresAt`. O CLI e o SDK imprimem uma URL completa. A API retorna o caminho, que você acrescenta ao endereço do servidor.

O link é um segredo. Quem o tiver pode baixar o arquivo. Não é possível revogá-lo antes de expirar, então use validade curta. Trate a URL como chave: mantenha-a fora de chats e logs públicos. Logs do proxy e o histórico do navegador podem registrá-la. Consulte [Links de download](../api/reference/links).

## Limites e filas {#queues}

O administrador define quantas transferências rodam simultaneamente e sua velocidade. Por padrão, um servidor executa 2 uploads e 16 downloads, e uma conta executa 1 upload e 4 downloads. Os demais aguardam na fila até 20 segundos. Se a fila estiver cheia ou a espera terminar, o servidor responde `503` com `Retry-After`, e os clientes aguardam e tentam novamente. Um orçamento de bytes por segundo, quando definido, reduz a velocidade sem interromper. Os usuários não podem ver nem alterar esses orçamentos. Consulte os valores em [Variáveis de ambiente](../reference/environment#transfers-and-bandwidth).

## Erros {#errors}

| Resposta                   | Motivo                                                                               | O que fazer                                                     |
| -------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `409 upload_expired`       | A sessão tem mais de 7 dias                                                          | Inicie outro upload                                             |
| `409 upload_state`         | O upload já foi publicado ou cancelado, ou uma parte armazenada tem bytes diferentes | Inicie outro upload ou verifique se está usando o mesmo arquivo |
| `409 parts_incomplete`     | Algumas partes não chegaram                                                          | Retome o upload                                                 |
| `409 part_mismatch`        | As partes não correspondem ao tamanho ou aos índices planejados                      | Use o tamanho de `listUploadParts` e retome                     |
| `409 idempotency_mismatch` | A chave foi usada para outro arquivo                                                 | Use uma nova chave                                              |
| `422 integrity_mismatch`   | Uma soma de verificação não corresponde                                              | Envie novamente o arquivo original                              |
| `507 storage_quota`        | A cota do repositório foi esgotada                                                   | Exclua builds antigos ou peça uma cota maior                    |
| `507 storage_full`         | O disco do servidor está cheio                                                       | Chame o administrador                                           |
| `503` com `Retry-After`    | O servidor está ocupado                                                              | Aguarde; os clientes tentam novamente sozinhos                  |

A lista completa está em [Erros](../api/errors).

## Páginas relacionadas {#related-pages}

- [Linha de comando (arkvoryctl)](../protocols/cli) e [SDK TypeScript](../protocols/sdk)
- [Arquivos por caminho](./files) e [Pacotes](./packages)
- Referência da API: [Uploads](../api/reference/uploads), [Links de download](../api/reference/links), [Artefatos](../api/reference/artifacts)
