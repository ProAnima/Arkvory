---
title: 'Eventos'
description: 'Acompanhe cada alteração da instalação com um único cursor: CloudEvents, permissões, retenção e ressincronização.'
---

# Eventos

O fluxo de eventos informa a um sistema externo o que mudou em toda a instalação: publicações, exclusões, caminhos de arquivo, registros de pacotes, anotações, anexos, estágios, promoções, imagens de contêiner, npm e Git LFS. É um único fluxo ordenado para todos os repositórios que você pode ler, no formato [CloudEvents 1.0](https://cloudevents.io). Leia-o com `arkvoryctl events tail`, o [SDK TypeScript](./sdk) ou `GET /api/v1/events`.

Um evento é uma dica de que algo mudou. Leia o estado atual pela API habitual e trate os eventos de forma que uma repetição não cause dano.

## Ler o fluxo {#read}

```bash
arkvoryctl events tail --cursor-file ./arkvory.cursor
```

O comando imprime um evento por linha em JSON e salva a posição em `--cursor-file` após cada evento. Execute-o de novo e ele continua de onde parou. Adicione `--follow` para esperar novos eventos até Ctrl+C. `--types artifact.*,stage.added` mantém os tipos ou prefixos indicados, `--repository releases` mantém um repositório e `--after <id>` começa depois do evento indicado.

Em TypeScript, `follow` lê página após página e chama `save` depois de cada evento que você tratou:

```ts
for await (const event of client.events.follow({ after: saved, save: (cursor) => store(cursor) })) {
  await handle(event);
}
```

Por HTTP:

```bash
curl -H "Authorization: Bearer $ARKVORY_TOKEN" \
  "https://arkvory.example.com/api/v1/events?limit=100&types=artifact.*"
```

A resposta contém `items`, `next`, `head`, `oldest` e `epoch`. Passe `next` como `after` na próxima solicitação. Sem `after`, o fluxo começa no evento mais antigo que o servidor guarda. Uma solicitação retorna até `limit` eventos (1–500, padrão 100). Uma página com menos de `limit` eventos não é o fim do fluxo. Uma solicitação examina no máximo 5000 eventos, então você leu tudo quando a posição em `next` é igual a `head`. Veja [listEvents](../api/reference/events#listEvents).

## O evento {#event}

```json
{
  "specversion": "1.0",
  "id": "0f7d8e3c-1d2b-4a5c-9e8f-0a1b2c3d4e5f:42",
  "source": "/arkvory/studio/repositories/releases",
  "type": "arkvory.artifact.published.v1",
  "subject": "9a7b6c5d-4e3f-4a1b-8c2d-1e0f9a8b7c6d",
  "time": "2026-10-17T09:30:00.000Z",
  "datacontenttype": "application/json",
  "dataschema": "urn:arkvory:event:artifact.published:1",
  "partitionkey": "repository:releases",
  "arkvoryposition": "42",
  "arkvoryepoch": "0f7d8e3c-1d2b-4a5c-9e8f-0a1b2c3d4e5f",
  "data": {
    "repository": "releases",
    "artifactId": "9a7b6c5d-4e3f-4a1b-8c2d-1e0f9a8b7c6d",
    "name": "game.upack",
    "size": "73400320",
    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "labels": ["ci"],
    "stages": []
  }
}
```

- `id` é o mesmo em cada repetição de um evento: deduplique por ele.
- `data` contém identificadores e dados do artefato: o nome, o tamanho como string decimal, SHA-256, os rótulos e estágios no momento do evento e o pacote UPack. Eventos de arquivos, estágios, imagens, npm e Git LFS acrescentam o caminho, o estágio, a imagem com seu digest ou tag, o pacote npm ou o id do objeto.
- Valores de metadados, o usuário que fez a alteração, segredos e o conteúdo de arquivos nunca estão em um evento. Se os rótulos deixassem `data` maior que 8 KiB, eles são omitidos e `truncated` é `true`.
- `GET /api/v1/events/types` lista cada tipo com o JSON Schema do seu `data`.

| Grupo                | Tipos                                                                               |
| -------------------- | ----------------------------------------------------------------------------------- |
| Artefatos            | `artifact.published`, `artifact.deleted`, `artifact.promoted`, `artifact.received`  |
| Arquivos e pacotes   | `asset.revision.created`, `asset.restored`, `package.registered`                    |
| Descrições           | `annotation.updated`, `attachments.updated`, `stage.added`, `stage.removed`         |
| Imagens de contêiner | `oci.manifest.pushed`, `oci.manifest.deleted`, `oci.tag.updated`, `oci.tag.deleted` |
| npm e Git LFS        | `npm.version.published`, `npm.tag.updated`, `npm.tag.deleted`, `lfs.object.stored`  |

## Ordem e permissões {#order}

- Os eventos de um repositório chegam na ordem em que suas alterações foram confirmadas (`partitionkey`). Entre repositórios, as posições mostram a ordem em que os eventos ficaram visíveis, não causa e efeito.
- As posições crescem, mas podem pular números. Nunca espere que sejam consecutivas.
- Um evento aparece no fluxo cerca de meio segundo após sua alteração, quando o worker lhe atribui um número. Enquanto o worker está parado, os eventos esperam e nada se perde.
- Você vê os eventos dos repositórios em que sua chave ou conta tem `artifact.list`, a mesma permissão do [fluxo de alterações](../api/reference/artifacts#listCatalogChanges). As permissões são verificadas a cada solicitação, então uma permissão revogada oculta os eventos imediatamente.
- `next` também avança além dos eventos que você não pode ver, no máximo 5000 por solicitação, de modo que uma chave com poucas permissões nunca fica parada. Ele apenas indica que o servidor tinha outros eventos nessas posições.

## Retenção e restauração {#retention}

O servidor guarda os eventos por 168 horas e no máximo 5 000 000 deles (`ARKVORY_EVENTS_RETENTION_HOURS`, `ARKVORY_EVENTS_MAX_ROWS`, veja [Variáveis de ambiente](../reference/environment)). O fluxo é uma janela, não um histórico: o histórico fica na auditoria do catálogo. Os eventos não fazem parte dos backups.

| Resposta                               | O que aconteceu                                                                   | O que fazer                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `410`, `gone/events_cursor_expired`    | Seu cursor é anterior a `oldest`                                                  | Leia o estado atual pela API e continue a partir de `oldest`                  |
| `409`, `conflict/events_epoch_changed` | O servidor foi restaurado de um backup e suas posições começaram uma nova `epoch` | Leia o estado atual e continue sem cursor ou a partir da nova cabeça do fluxo |

As duas respostas trazem `events` com `epoch`, `oldest` e `head` atuais; um cursor é `<epoch>:<position>`. `arkvoryctl events tail` termina com o código de saída 6, e o SDK lança o erro com os mesmos campos.

## Webhooks {#webhooks}

Os [webhooks](./webhooks) continuam enviando o fluxo de alterações de um repositório para um endereço HTTP. O fluxo de eventos não os substitui.
