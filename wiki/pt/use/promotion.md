---
title: 'Estágios e promoção'
description: 'Marque builds com estágios, promova-os para outro repositório e deixe um agente de implantação escolher o build mais recente de um estágio.'
---

# Estágios e promoção

Um build vai do CI à produção em etapas: testado, aprovado, lançado. O Arkvory tem duas ferramentas para isso. Um **estágio** é uma marca em um build, como `qa` ou `release`. A **promoção** publica um build em outro repositório sem enviar os bytes de novo. Use uma das duas, ou as duas juntas.

## Estágios e repositórios {#concepts}

- Um **estágio** diz onde um build está aprovado. Um build pode ter vários estágios, até 16. Os estágios pertencem a um build em um repositório. Somente as operações de estágio os alteram, e toda alteração vai para um diário com o autor e um comentário opcional.
- Uma **promoção** copia ou move um build de um repositório para outro, por exemplo de `dev` para `staging` para `prod`. A cópia é um novo artefato no destino. Nenhum byte é enviado.
- Um **rótulo** é apenas uma tag livre sem histórico. Um estágio é a marca controlada com que uma implantação pode contar. Consulte [Arquivos por caminho](./files#labels).

Um nome de estágio tem de 1 a 32 caracteres: letras minúsculas, dígitos, `.`, `_` ou `-`, começando com uma letra ou um dígito. Um build com um estágio não pode ser excluído, e a retenção o mantém. Remova o estágio primeiro.

## Adicionar e remover estágios {#stages}

No console, abra o artefato em [[ui:metadata]]. A seção [[ui:promotionTitle]] mostra [[ui:stagesTitle]] com os estágios do build. Informe um [[ui:stageName]] e, se quiser, um [[ui:stageComment]], depois selecione [[ui:stageAdd]]. Cada estágio tem um botão para removê-lo, e o console pede confirmação: as implantações que pedirem esse estágio escolherão outra versão.

Os estágios também aparecem no catálogo, como chips em cada linha, e na coluna [[ui:packageStages]] de [[ui:packages]].

```bash
arkvoryctl stages add 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 qa --comment "smoke passed" --repository dev
arkvoryctl stages list 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository dev
arkvoryctl stages remove 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 qa --repository dev
arkvoryctl stages artifacts --stage release --repository prod
```

`stages artifacts` lista cada build que tem um estágio, ou um estágio, 100 por vez. Passe `next` como `--after`.

Com a API:

```bash
curl -X PUT "$ARKVORY/api/v1/repositories/dev/artifacts/$ID/stages/qa" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"comment":"smoke passed"}'
curl -X DELETE "$ARKVORY/api/v1/repositories/dev/artifacts/$ID/stages/qa" \
  -H "Authorization: Bearer $ARKVORY_KEY"
```

```typescript
await dev.stages.add(id, 'qa', 'smoke passed');
const { items } = await prod.stages.artifacts({ stage: 'release' });
```

As operações são `setArtifactStage`, `removeArtifactStage`, `listArtifactStages` e `listStagedArtifacts`. Adicionar um estágio que já existe não muda nada: o primeiro horário e o comentário permanecem. Remover um estágio que não existe dá certo. Um build com 16 estágios recusa outro com `409 stage_limit`.

## Promover para outro repositório {#promote}

No console, abra o artefato. O formulário [[ui:promoteTitle]] aparece quando você pode ler o build e pode promover para pelo menos um outro repositório. Escolha o [[ui:promoteTarget]] entre esses repositórios. Informe os [[ui:promoteStages]] a definir no destino, separados por vírgulas, e um [[ui:promoteComment]]. Selecione [[ui:promoteSubmit]]. Se nenhum outro repositório permitir, o console exibe [[ui:promoteNoTargets]].

```bash
arkvoryctl promote 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository staging --to prod --stage release --comment CAB-142
arkvoryctl promote 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository staging --to prod --move
```

`--repository` é a origem, `--to` o destino. O resultado tem o `repository` de destino, o novo `artifactId`, o `sourceArtifactId`, o `mode`, `created` e os `stages`.

```bash
curl -X POST "$ARKVORY/api/v1/repositories/staging/artifacts/$ID/promote" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"target":"prod","mode":"copy","stages":["release"],"comment":"CAB-142"}'
```

```typescript
await staging.promotions.promote(id, { target: 'prod', mode: 'copy', stages: ['release'] });
```

A resposta é `201` para uma nova cópia e `200` quando o destino já a tinha. A operação é `promoteArtifact`.

### Copiar ou mover {#copy-move}

|                    | Copiar (padrão)      | Mover                                                                                                          |
| ------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Origem             | Permanece            | É removida no mesmo passo em que a cópia é publicada                                                           |
| Estágios da origem | Permanecem na origem | Passam para a cópia, além dos estágios que você informar                                                       |
| No console         |                      | Marque [[ui:promoteMove]]. O console pede confirmação                                                          |
| Bloqueado quando   |                      | A origem ainda é usada por uma referência externa, um caminho de arquivo ou um link de anexo. Nada é publicado |

O que a cópia recebe e o que não recebe:

- Ela recebe os rótulos, os metadados e as coleções da origem, sua identidade UPack e os estágios que você informar. É um novo artefato com um novo ID. Seu SHA-256 é o mesmo.
- Ela não recebe anexos nem ponteiros de caminho. Vincule-os novamente no destino.
- Nenhum byte é enviado. No mesmo servidor, o arquivo armazenado é compartilhado até que o último artefato que o usa desapareça.
- Ela conta para a cota do destino como um novo upload.
- Repetir uma promoção retorna a mesma cópia. Se o destino já tiver um pacote com o mesmo grupo, nome, versão e soma de verificação, esse artefato é retornado. Com bytes diferentes, o servidor responde `409 version_exists`.
- O destino deve ser diferente da origem. Um espelho não pode ser um destino, porque é somente leitura. Consulte [Repositórios](./repositories#read-only).

Uma promoção interrompida deixa uma reserva de curta duração. Execute a mesma promoção novamente com a mesma conta para continuar.

## Histórico de promoções {#history}

A página do artefato no console mostra [[ui:promotionHistory]], do mais antigo ao mais recente: quem adicionou ou removeu um estágio, quem copiou ou moveu o build para outro repositório e de onde veio uma cópia recebida. [[ui:promotionMore]] carrega os próximos registros.

```bash
arkvoryctl promotions history 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository prod
arkvoryctl promotions journal --repository prod --after 120 --json
```

O diário de um repositório é para o CI. Consulte-o periodicamente com a última `sequence` que você viu como `--after`, e você recebe os novos eventos em ordem. Um evento tem uma `sequence`, a `action` (`stage.added`, `stage.removed`, `promoted` ou `received`), o `stage`, o `mode`, o repositório e o artefato pares, o `actor`, o `comment` e o horário. As páginas contêm até 100 eventos. As operações são `listArtifactPromotions` e `listRepositoryPromotions`.

## Escolher um build para implantação {#resolve}

Um agente de implantação pede "o build mais recente do pacote `app` que está no intervalo `^1.4` e tem o estágio `release`". O Arkvory responde com exatamente uma versão, ou com `404` se não houver nenhuma.

```bash
arkvoryctl packages resolve app --group acme/game --range ^1.4 --stage release --repository prod --json
arkvoryctl packages download app ./app.upack --group acme/game --range ^1.4 --stage release --repository prod
```

`resolve` imprime a escolha sem baixá-la:

```json
{
  "group": "acme/game",
  "name": "app",
  "version": "1.4.7",
  "artifactId": "3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11",
  "sha256": "…",
  "size": "73400320",
  "publishedAt": "2026-10-01T09:30:00.000Z",
  "stagedAt": "2026-10-02T12:00:00.000Z",
  "stages": ["qa", "release"]
}
```

Com HTTP, `resolvePackage` retorna isto, e `downloadPackageContent` envia os bytes da mesma escolha em uma única chamada:

```bash
curl -fL -G -H "Authorization: Bearer $DEPLOY_KEY" -o app.upack \
  --data-urlencode "name=app" --data-urlencode "group=acme/game" \
  --data-urlencode "range=^1.4" --data-urlencode "stage=release" \
  "$ARKVORY/api/v1/repositories/prod/packages/content"
```

```typescript
const found = await prod.packages.resolve({ name: 'app', range: '^1.4', stage: 'release' });
```

Os filtros são os mesmos em todas as ferramentas: o `name` do pacote, o `group` (vazio se o pacote não tiver nenhum), uma versão exata ou um intervalo, o `stage`, se incluir pré-lançamentos e a ordem. Os intervalos são explicados em [Pacotes UPack](./packages#versions).

Por padrão, a versão SemVer mais recente vence. Com `--order promoted` (`order=promoted` no HTTP), vence a versão que recebeu o estágio por último, mesmo que seu número seja menor. Isso exige um estágio.

O nome é resolvido a cada solicitação, então duas chamadas podem retornar builds diferentes quando alguém promove no meio. Para um download que precise ser retomado, pegue o `artifactId` de `resolve` e baixe esse.

## Reverter {#rollback}

Com a ordem `promoted`, reverter é um passo comum. Remova o estágio da versão com defeito, e a versão que recebeu o estágio antes dela se torna a escolha. Para tornar uma versão mais antiga atual de novo, remova seu estágio e adicione-o mais uma vez: adicionar um estágio que já existe não renova seu horário.

```bash
arkvoryctl stages remove <faulty artifact id> release --repository prod
arkvoryctl packages download app ./app.upack --stage release --order promoted --repository prod
```

## Permissões {#permissions}

| Ação                                   | Chaves: ações de repositório                                          | Pessoas: acesso de grupo              |
| -------------------------------------- | --------------------------------------------------------------------- | ------------------------------------- |
| Ler estágios e o histórico de um build | `artifact.read`                                                       | Leitura                               |
| Listar builds com estágio e o diário   | `artifact.list`                                                       | Leitura                               |
| Adicionar ou remover um estágio        | `artifact.promote` com `artifact.read`                                | Escrita                               |
| Promover com cópia                     | Origem: `artifact.read` e `content.read`. Destino: `artifact.promote` | Leitura na origem, escrita no destino |
| Promover com movimentação              | O mesmo, e `artifact.promote` na origem                               | Escrita em ambos                      |
| Resolver uma versão                    | `package.read`                                                        | Leitura                               |
| Baixar a versão escolhida pelo nome    | `content.read`                                                        | Leitura                               |

Uma chave para um agente de implantação que só baixa precisa de `content.read` no repositório que ele lê. Para `arkvoryctl packages download`, também precisa de `package.read` e `artifact.read`. Consulte [Permissões](./accounts#permissions).

Servidores também podem trocar builds por conta própria: um repositório pode importar, de um repositório de outro servidor, as versões que carregam certos estágios. Consulte [Espelhos](../operate/mirrors).

## Páginas relacionadas {#related-pages}

- [Pacotes UPack](./packages) e [Repositórios](./repositories)
- [Contas e acesso](./accounts)
- [Linha de comando (arkvoryctl)](../protocols/cli#packages-and-promotion)
- Referência da API: [Estágios e promoção](../api/reference/promotion)
