---
title: Arquivos por caminho
description: Mantenha um arquivo em um caminho com um histórico completo, restaure revisões anteriores e adicione rótulos, metadados, coleções e anexos.
---

# Arquivos por caminho

Um arquivo por caminho é um nome em um repositório, como `builds/game/1.4/GameSetup.exe`, que aponta para um arquivo armazenado. Quando você coloca conteúdo novo no mesmo caminho, o caminho passa a apontar para o novo arquivo. O antigo permanece, e você pode voltar a ele. Use um caminho quando pessoas e scripts precisarem de um endereço estável para "o Setup.exe atual".

## O que é um caminho {#what-it-is}

Todo arquivo armazenado é um **artefato** imutável com um ID e um SHA-256. Um caminho é um ponteiro para um artefato. Cada mudança do ponteiro é uma **revisão**, numerada a partir de 1. Revisões nunca são excluídas nem editadas.

Um caminho tem de 1 a 1024 caracteres. Ele é formado por segmentos separados por `/`. Um segmento não é vazio, não é `.` nem `..` e não tem caracteres de controle. Um caminho não pode conter `\` nem `:`. Maiúsculas e minúsculas importam.

Um caminho e um pacote são duas visões dos mesmos artefatos: um arquivo UPack também pode ter um caminho. Consulte [Pacotes UPack](./packages).

## Colocar um arquivo em um caminho {#put}

Você precisa das ações `upload.create`, `upload.write` e `upload.complete`, e de `asset.read`, `asset.write` e `artifact.read`. Em termos de grupos, você precisa de acesso de escrita. Consulte [Permissões](./accounts#permissions).

### Com o arkvoryctl {#put-cli}

```bash
arkvoryctl put "./Build/Game Setup.exe" builds/game/1.4/GameSetup.exe
arkvoryctl put ./config.json config/settings.json --label test
arkvoryctl get builds/game/1.4/GameSetup.exe ./GameSetup.exe
```

`put` envia o arquivo em partes, com um checkpoint ao lado do arquivo de origem, e o torna a próxima revisão do caminho. Ele imprime o `path`, a `revision`, o `id` do artefato e `created`. Se o caminho já contém os mesmos bytes, `put` não envia nada e imprime `created` como `false`: uma etapa de build repetida não custa nada. Se alguém alterar o caminho enquanto você envia, `put` para com `revision_mismatch` (código de saída 6) e não sobrescreve o trabalho da pessoa. Leia o histórico e decida. Se um upload parar, execute o mesmo comando novamente. Consulte [Uploads e downloads](./transfers#resume).

`get` baixa a revisão atual com retomada e uma verificação de SHA-256. Não há comando para listar caminhos ou ler o histórico. Use o console ou a API para isso.

### Com uma única solicitação HTTP {#put-http}

Um `PUT` bruto armazena os bytes no caminho em uma única solicitação, como faz `curl -T`:

```bash
curl -T ./GameSetup.exe -H "Authorization: Bearer $ARKVORY_KEY" \
  "$ARKVORY/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe"
```

A resposta tem `path`, `revision`, `created` e o `artifact` com seu `id`, `size` e `sha256`. Uma nova revisão responde `201`. Os mesmos bytes novamente respondem `200` com `created` falso. Dois cabeçalhos são opcionais: `X-Checksum-Sha256` permite que o servidor verifique os bytes em uma única passagem, e `If-None-Match: *` recusa a solicitação se o caminho já existir. Uma solicitação deve terminar em até 30 minutos. Use `put` para arquivos grandes. Consulte [Arquivos brutos](../protocols/raw-files).

### No console {#put-console}

1. Envie o arquivo em [[ui:upload]]. Consulte [Uploads e downloads](./transfers).
2. Abra o artefato em [[ui:catalog]] com [[ui:open]].
3. Em [[ui:assetTitle]], informe o [[ui:assetPath]], por exemplo `releases/current.upack`.
4. Informe a [[ui:currentRevision]]: `0` para um novo caminho, ou a revisão atual mostrada em [[ui:history]].
5. Selecione [[ui:assign]].

O campo de revisão protege contra duas pessoas alterando um caminho ao mesmo tempo. Se não for a atual, o servidor recusa com um conflito. Carregue o histórico novamente e tente de novo.

### Com a API e o SDK {#put-api}

`setAsset` aponta um caminho para um artefato que você já enviou. `expectedRevision` é `0` para criar o caminho e, caso contrário, a revisão atual.

```bash
curl -X PUT "$ARKVORY/api/v1/repositories/releases/asset" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"path":"builds/game/1.4/GameSetup.exe","artifactId":"3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11","expectedRevision":0}'
```

```typescript
const current = await releases.assets.get('builds/game/1.4/GameSetup.exe');
await releases.assets.assign('builds/game/1.4/GameSetup.exe', artifactId, current.revision);
```

Um conflito responde `409 revision_mismatch`. Não tente novamente com uma revisão adivinhada. Após uma resposta perdida, leia o caminho: se o novo artefato já estiver lá, está feito.

## Ler um caminho {#read}

- `arkvoryctl get PATH OUTPUT` baixa o arquivo atual.
- `GET /api/v1/repositories/<repository>/raw/<path>` e `GET /api/v1/repositories/<repository>/asset/content?path=<path>` retornam os bytes. Ambos precisam de `content.read` e oferecem suporte a intervalos e ao ETag.
- `getAsset` (`GET …/asset?path=`) retorna o ponteiro: `path`, `revision`, `artifactId`.
- `listAssetPage` (`GET …/assets/page?prefix=`) lista ponteiros. As páginas contêm até 100 (50 por padrão) na ordem de bytes do caminho em UTF-8. O prefixo é literal e diferencia maiúsculas de minúsculas. Passe `next` como `after`. O antigo `listAssets` retorna até 1000 e pede que você restrinja o prefixo.

```typescript
const page = await releases.assets.list({ prefix: 'builds/game/', limit: 100 });
```

## Revisões e histórico {#history}

No console, abra [[ui:history]], digite o caminho em [[ui:assetPath]] e selecione [[ui:historyLoad]]. A tabela mostra a [[ui:revision]], o horário ([[ui:date]]), o autor ([[ui:actor]]) e, para revisões restauradas, a revisão de onde vêm ([[ui:source]]). A mais recente vem primeiro. [[ui:historyMore]] carrega as mais antigas, 50 de cada vez. [[ui:open]] em uma linha abre o artefato daquela revisão, de onde você pode baixar seu conteúdo original.

Com a API, `getAssetHistory` (`…/asset/history?path=&before=`) retorna as páginas, as mais recentes primeiro, e `before` é a última revisão da página anterior. `getAssetRevision` (`…/asset/revision?path=&revision=`) retorna uma revisão. Autor e horário ficam vazios para revisões escritas antes de o histórico registrá-los. A leitura precisa de `asset.read`.

## Restaurar uma revisão anterior {#restore}

Restaurar faz o caminho apontar para o artefato de uma revisão mais antiga. Isso não copia bytes nem exclui nenhuma revisão: a restauração é uma nova revisão, a mais recente, e o histórico mostra de onde ela veio.

No console, carregue o histórico e selecione o botão de restaurar da revisão desejada. O botão da revisão atual fica desativado. Restaurar precisa de `asset.restore`, `asset.read` e `artifact.read`.

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/asset/restore" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"path":"builds/game/1.4/GameSetup.exe","sourceRevision":3,"expectedRevision":5}'
```

```typescript
await releases.assets.restore('builds/game/1.4/GameSetup.exe', 3, 5);
```

`expectedRevision` é a última revisão que você viu. Se o caminho mudou nesse meio-tempo, o servidor responde `409 revision_mismatch`; o console mostra uma mensagem e pede que você recarregue o histórico. Uma restauração não traz de volta rótulos ou metadados antigos: eles permanecem como estão agora.

## Rótulos, metadados e coleções {#labels}

Todo artefato carrega três tipos de anotações. Você pode alterá-las a qualquer momento. O arquivo em si nunca muda.

| Tipo      | Exemplo                                        | Regras                                                                                                                                 |
| --------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Rótulos   | `test`, `staging`, `release`, `linux`          | Até 32. Cada um de 1 a 64 letras, dígitos, `_`, `.`, `:` ou `-`. Maiúsculas e minúsculas importam                                      |
| Metadados | `build.number` = `42`, `git.commit` = `abc123` | Até 32 campos de texto. Uma chave começa com uma letra e tem até 64 letras, dígitos, `_`, `.` ou `-`. Um valor tem até 1024 caracteres |
| Coleções  | `desktop`, `nightly`                           | Até 32. As mesmas regras dos rótulos. Agrupam artefatos, independentemente de sua versão ou caminho                                    |

Rótulos são texto livre. Eles não dão acesso nem movem arquivos. O console sugere [[ui:labelPresets]] (`nightly`, `test`, `staging`, `release`), mas qualquer rótulo é válido, e `relase` não é corrigido. Para uma aprovação na qual as implantações confiem, use um estágio ([Estágios e promoção](./promotion)).

**Console.** Abra o artefato em [[ui:metadata]]. Informe [[ui:labels]] e [[ui:collections]] separados por vírgulas. Use [[ui:metadataAdd]] para um campo em [[ui:metadataFields]]: uma [[ui:metadataKey]] e um [[ui:metadataValue]]. [[ui:metadataJson]] edita os mesmos dados como JSON. Selecione [[ui:save]].

**arkvoryctl.** No momento do upload, `--label test` adiciona um rótulo, e `--file metadata.json` fornece `labels` e `metadata`:

```json
{ "labels": ["test"], "metadata": { "build.number": "42", "git.commit": "abc123" } }
```

Para alterar um artefato existente, leia-o e depois envie o estado novo completo com a revisão que você leu:

```bash
arkvoryctl annotations get 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl annotations set 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --revision 3 --file annotations.json
```

`annotations.json` deve ter as três chaves: `labels`, `metadata` e `collections`. Tudo o que você omitir fica vazio. Um salvamento substitui o conjunto inteiro. Se alguém salvou primeiro, o servidor responde `409 revision_mismatch`: leia de novo e decida. O SDK não repete esses salvamentos.

```typescript
const current = await releases.annotations.get(id);
await releases.annotations.update(id, current.revision, {
  labels: [...current.labels, 'release'],
  metadata: current.metadata,
  collections: current.collections,
});
```

Você precisa de `annotation.read` para ler e de `annotation.write` com `artifact.read` para escrever.

**Pesquisa.** Em [[ui:catalog]], digite texto em [[ui:search]]: ele corresponde ao nome do arquivo e aos valores de metadados, ignorando maiúsculas e minúsculas. [[ui:labelFilter]] mostra um rótulo. [[ui:metadataFilter]] corresponde exatamente a uma chave e um valor, incluindo maiúsculas e minúsculas. Com o `arkvoryctl`:

```bash
arkvoryctl search --query game --label release
arkvoryctl search --collection nightly
arkvoryctl search --metadata-key git.commit --metadata-value abc123
```

`--metadata-key` e `--metadata-value` andam juntos. As páginas contêm até 100 resultados. Passe `next` como `--after`. Os filtros se combinam com AND.

## Anexos {#attachments}

Anexos vinculam outros arquivos a um build: um manifesto, um SBOM, uma assinatura, um relatório ou qualquer arquivo. Um anexo é um nome e um vínculo para outro artefato do mesmo repositório. O build e o anexo permanecem arquivos separados.

| Regra     | Valor                                                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tipos     | `manifest`, `sbom`, `signature`, `report`, `file`                                                                                                  |
| Por build | No máximo 32                                                                                                                                       |
| Nome      | De 1 a 240 caracteres, único dentro do build (maiúsculas e minúsculas ignoradas), sem `/`, `\`, caracteres de controle ou espaços nas extremidades |
| Descrição | Até 512 caracteres, pode ser vazia                                                                                                                 |
| Alvo      | Um artefato publicado do mesmo repositório. Não o próprio build                                                                                    |

O tipo só diz para que serve o arquivo. O Arkvory não verifica uma assinatura, não lê um SBOM e não executa um manifesto.

No console, abra o artefato. Em [[ui:attachmentsTitle]], expanda o formulário [[ui:attachmentAdd]]. Escolha a [[ui:attachmentSource]]: [[ui:attachmentUpload]] envia um novo arquivo e o vincula, [[ui:attachmentExisting]] vincula um artefato que já está publicado. Escolha o [[ui:attachmentKind]]: [[ui:attachmentManifest]], [[ui:attachmentSbom]], [[ui:attachmentSignature]], [[ui:attachmentReport]] ou [[ui:attachmentFile]]. Dê a ele um [[ui:attachmentName]] e, se quiser, uma [[ui:attachmentDescription]]. Depois selecione [[ui:attachmentAdd]]. [[ui:attachmentUnlink]] remove um vínculo e mantém o arquivo. [[ui:attachmentReload]] lê a lista novamente. Se o upload de um anexo falhar, [[ui:attachmentRecovery]] mostra o ID do upload para continuar.

Cada alteração da lista é uma versão numerada. [[ui:attachmentHistory]] mostra as anteriores, e [[ui:attachmentRestore]] retorna uma delas como uma nova versão.

Com o `arkvoryctl`, o arquivo contém a lista inteira como um vetor JSON:

```json
[
  {
    "name": "build.json",
    "kind": "manifest",
    "artifactId": "64b42380-902d-41cf-9151-10c12e4809dc",
    "description": "Build provenance from CI"
  }
]
```

```bash
arkvoryctl attachments get 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
arkvoryctl attachments set 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --revision 0 --file attachments.json
arkvoryctl attachments history 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`--revision` é o número que você leu com `get`; um novo build tem `0`. Com a API, `replaceBuildAttachments` recebe `expectedRevision` e `items`; `getBuildAttachments` e `getBuildAttachmentHistory` leem. Para baixar um anexo, use o `artifactId` do seu vínculo com o download normal. A leitura precisa de `annotation.read`, a alteração precisa de `annotation.write` com `artifact.read`, e o upload do arquivo do anexo precisa das ações de upload.

Anexos e caminhos não viajam com uma promoção para outro repositório. Consulte [Estágios e promoção](./promotion).

## Páginas relacionadas {#related-pages}

- [Arquivos brutos](../protocols/raw-files)
- [Uploads e downloads](./transfers) e [Pacotes UPack](./packages)
- [Linha de comando (arkvoryctl)](../protocols/cli)
- Referência da API: [Arquivos por caminho](../api/reference/files), [Artefatos e catálogo](../api/reference/artifacts), [Anexos de build](../api/reference/attachments)
