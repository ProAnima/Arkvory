---
title: Pacotes UPack
description: Publique pacotes UPack versionados, liste e filtre-os, e baixe uma versão por número exato, intervalo, mais recente ou estágio.
---

# Pacotes UPack

Um pacote UPack é um arquivo ZIP com um nome e uma versão SemVer. O Arkvory registra cada versão uma vez e nunca a altera. Uma tarefa de implantação pede "app, versão `^1.4`, estágio `release`" e recebe exatamente um arquivo.

## O que é um pacote {#what-it-is}

Um UPack é um arquivo ZIP com um arquivo `upack.json` em sua raiz. O manifesto nomeia o pacote:

```json
{
  "group": "acme/game",
  "name": "game-client",
  "version": "1.4.2"
}
```

| Campo     | Regra                                                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `name`    | Obrigatório. De 1 a 128 letras, dígitos, `.`, `_` ou `-`                                                               |
| `version` | Obrigatório. SemVer: `1.4.2`, `1.5.0-rc.1`, `2.0.0+build.7`. No máximo 128 caracteres                                  |
| `group`   | Opcional. Segmentos de letras, dígitos, `.`, `_` ou `-`, separados por `/`. No máximo 128 caracteres. Vazio por padrão |

Outros campos permanecem como você os escreveu e voltam na lista de pacotes. O manifesto tem no máximo 64 KiB. O arquivo não pode conter caminhos absolutos, `..`, links simbólicos, entradas criptografadas ou nomes duplicados, e tem no máximo 100 000 entradas. O Arkvory armazena o arquivo byte a byte e não o descompacta.

A identidade de um pacote é seu grupo, nome e versão, comparados sem considerar maiúsculas e minúsculas. Dentro de um repositório, uma identidade pertence a um arquivo para sempre. Registrar um arquivo diferente sob uma identidade existente é recusado com `409 version_exists`. Registrar o mesmo arquivo novamente é seguro e não altera nada. Publique uma correção como uma nova versão.

## Publicar um pacote {#publish}

Publicar é um upload seguido de um registro. O registro lê `upack.json` e grava a identidade. Você precisa das ações `package.publish` e `artifact.read`, além das ações de upload. Consulte [Permissões](./accounts#permissions).

### No console {#publish-console}

1. Envie o arquivo em [[ui:upload]]. Consulte [Uploads e downloads](./transfers).
2. Abra o artefato em [[ui:catalog]] com [[ui:open]].
3. Em [[ui:metadata]], selecione [[ui:register]]. O console mostra o nome e a versão que registrou.

O pacote agora aparece em [[ui:packages]].

### Com o arkvoryctl {#publish-cli}

```bash
arkvoryctl packages publish ./build.upack --label test --state ./job-state/build.json --json
arkvoryctl packages register 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`packages publish` envia o arquivo com retomada e o registra. Se o registro falhar depois do upload, o erro contém o `artifactId` e o estágio `register`. Execute o mesmo comando novamente: o upload não é repetido, e registrar duas vezes é seguro. `packages register ID` registra um artefato que já foi enviado. Consulte [Linha de comando](../protocols/cli#packages-and-promotion).

### Com a API HTTP e o SDK {#publish-api}

Envie o arquivo como em [Uploads e downloads](./transfers#upload-http) e depois registre-o:

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/package" \
  -H "Authorization: Bearer $ARKVORY_KEY"
```

```typescript
const entry = await releases.packages.register(uploaded.id);
console.log(entry.group, entry.name, entry.version);
```

A operação é `registerPackage`. Um arquivo corrompido, um `upack.json` ausente ou uma versão errada dão `400 invalid_input`.

## Listar e filtrar {#list}

No console, abra [[ui:packages]]. Digite um [[ui:packageGroup]] ou um [[ui:packageName]]: ambos correspondem exatamente, ignorando maiúsculas e minúsculas. Escolha uma coluna em [[ui:sortBy]], uma ordem em [[ui:direction]] ([[ui:ascending]] ou [[ui:descending]]) e um agrupamento em [[ui:groupBy]] ([[ui:packageGroup]], [[ui:packageName]] ou [[ui:noGrouping]]) e depois selecione [[ui:apply]]. [[ui:clearFilters]] redefine o formulário. A tabela mostra o grupo, o nome, a versão e os estágios de cada versão. [[ui:open]] mostra o artefato. [[ui:previousPage]] e [[ui:nextPage]] navegam entre as páginas.

```bash
arkvoryctl packages list --group acme/game --name game-client
arkvoryctl packages list --after <next from the previous answer>
```

Com a API, `listPackages` recebe `group`, `name`, `sort` (`group`, `name` ou `version`), `direction` (`asc` ou `desc`), `groupBy` (`none`, `group` ou `package`), `after` e `limit` (de 1 a 100, 50 por padrão). A resposta tem `items` (grupo, nome, versão, `artifactId` e o manifesto inteiro), `groups` e `next`. Um cursor pertence aos filtros de onde veio. Use-o somente com os mesmos filtros.

```typescript
const page = await releases.packages.list({
  name: 'game-client',
  sort: 'version',
  direction: 'desc',
});
```

A listagem precisa de `package.read`. Para pesquisar por rótulos ou metadados, consulte [Arquivos por caminho](./files#labels).

## Versões e intervalos {#versions}

O Arkvory compara versões pela precedência SemVer. `1.10.0` é mais nova que `1.9.0`. Uma versão com uma parte de pré-lançamento, como `1.5.0-rc.1`, é mais antiga que `1.5.0`.

Uma seleção recebe um `name` de pacote e, opcionalmente, estes filtros:

| Filtro         | Significado                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------- |
| `group`        | O grupo. Vazio por padrão: um pacote que tem um grupo só é encontrado quando você o informa |
| versão exata   | Uma versão. Maiúsculas e minúsculas são ignoradas                                           |
| intervalo      | Um intervalo SemVer                                                                         |
| `stage`        | Somente versões que carregam este estágio (consulte [Estágios e promoção](./promotion))     |
| pré-lançamento | Incluir pré-lançamentos. Desativado por padrão                                              |
| ordem          | `version` (padrão) ou `promoted`                                                            |

Intervalos podem ser escritos como `1.2.3`, `^1.2`, `~1.2.3`, `1.x`, `>=1.0.0 <2.0.0`, `1.0.0 - 1.4.0` e `^1 || ^3`. Um intervalo tem no máximo 256 caracteres. Uma versão exata e um intervalo não podem ser combinados.

Sem uma versão exata ou um intervalo, a seleção retorna a versão estável mais alta, que é a mais recente. Pré-lançamentos são escolhidos somente com o filtro de pré-lançamento ativado, ou quando a versão exata ou o próprio intervalo nomeia um pré-lançamento do mesmo `major.minor.patch`. `order promoted` escolhe a versão que foi preparada por último, e não a mais alta, e precisa de um estágio. Se nada corresponder, o servidor responde `404 not_found`.

## Baixar um pacote {#download}

Resolva primeiro se quiser ver o que vai receber, ou baixe diretamente.

```bash
arkvoryctl packages resolve game-client --group acme/game --range ^1.4 --stage release
arkvoryctl packages download game-client ./game-client.upack --group acme/game --range ^1.4 --stage release
arkvoryctl packages download game-client ./game-client.upack --exact 1.4.2 --group acme/game
arkvoryctl packages download game-client ./game-client.upack --group acme/game
```

As opções são `--group`, `--exact`, `--range`, `--stage`, `--prerelease` e `--order promoted`. Use `--exact` para uma versão exata, porque `--version` mostra a versão do cliente. `resolve` imprime o grupo, o nome, a versão, `artifactId`, `sha256`, `size`, `publishedAt`, `stagedAt` e os estágios. `download` resolve e depois baixa aquele artefato com retomada e uma verificação de SHA-256, como em [Uploads e downloads](./transfers#download-cli). O cliente precisa de `package.read`, `artifact.read` e `content.read`.

Com HTTP há duas operações. `resolvePackage` precisa de `package.read` e retorna os mesmos dados que `resolve`. `downloadPackageContent` envia os bytes da versão escolhida e precisa apenas de `content.read`. Ele adiciona os cabeçalhos `X-Arkvory-Artifact-Id` e `X-Arkvory-Package-Version`.

```bash
curl -fL -G -H "Authorization: Bearer $ARKVORY_KEY" -o game-client.upack \
  --data-urlencode "name=game-client" --data-urlencode "group=acme/game" \
  --data-urlencode "range=^1.4" --data-urlencode "stage=release" \
  "$ARKVORY/api/v1/repositories/prod/packages/content"
```

O endereço por nome resolve a cada solicitação. Se você retomar um download com um intervalo, o arquivo pode ter mudado entre as duas chamadas. Baixe o `artifactId` de `resolve`, ou envie o `ETag` em `If-Range`.

```typescript
const found = await prod.packages.resolve({
  name: 'game-client',
  group: 'acme/game',
  range: '^1.4',
  stage: 'release',
});
const stream = await prod.artifacts.downloadVerified(found.artifactId);
```

Um agente de implantação que só precisa buscar builds recebe uma chave de serviço com `content.read` apenas para o endereço HTTP, ou o predefinido de leitura para o `arkvoryctl`. Consulte [Contas de serviço e chaves para CI](./accounts#service-accounts).

## Rótulos, metadados e anexos {#labels}

Uma versão de pacote é um artefato comum, então tudo em [Arquivos por caminho](./files#labels) se aplica a ela: rótulos como `test`, `staging` e `release`, metadados de texto como `git.commit`, coleções e anexos como um SBOM ou uma assinatura. Defina os primeiros rótulos no momento do upload com `--label test`. Rótulos não alteram nada no arquivo. Eles são texto livre, não um status controlado. Para uma aprovação na qual uma implantação possa confiar, use um estágio. Consulte [Estágios e promoção](./promotion).

## Manter versões antigas {#retention}

Os pacotes registrados são o que a política de retenção de um repositório conta. Por padrão, quando ativada, ela mantém os últimos 10 builds de cada pacote e canal. Um canal é o rótulo `test`, `staging` ou `release`. Uma versão com um estágio, um rótulo protegido, um caminho de arquivo ou um vínculo de anexo nunca é removida pela retenção. A retenção fica desativada até que um administrador a ative e concorde com a exclusão. Consulte [Armazenamento e retenção](../operate/storage).

## Erros {#errors}

| Resposta                        | Significado                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400 invalid_input` no registro | Não é um ZIP UPack válido, não há `upack.json` na raiz, ou nome ou versão errada                                                                        |
| `409 version_exists`            | A identidade já pertence a outro arquivo. Publique uma nova versão. Promover para um repositório que tem a versão com outros bytes falha da mesma forma |
| `404 not_found` ao resolver     | Nada corresponde aos filtros. Verifique o grupo, o intervalo e o estágio                                                                                |
| `403 permission_missing`        | A chave não tem `package.read`, `package.publish` ou `content.read`                                                                                     |

## Páginas relacionadas {#related-pages}

- [Uploads e downloads](./transfers)
- [Estágios e promoção](./promotion)
- [Linha de comando (arkvoryctl)](../protocols/cli)
- Referência da API: [Pacotes](../api/reference/packages), [Estágios e promoção](../api/reference/promotion)
