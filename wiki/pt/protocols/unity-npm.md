---
title: Pacotes Unity e npm
description: Use um repositório como registro com escopo para o Unity Package Manager e como registro npm para publicar e instalar pacotes.
---

# Pacotes Unity e npm

Todo repositório do Arkvory é um registro compatível com npm em `https://<host>/npm/<repository>/`. O Unity Package Manager o lê como um registro com escopo, e o `npm` publica nele e instala a partir dele. Estúdios o usam para SDKs, ferramentas e módulos que vários projetos Unity compartilham, cada um com sua própria versão.

Os tarballs dos pacotes são artefatos comuns, portanto permissões de repositório, cotas, verificações SHA-256, backups e espelhos se aplicam a eles.

## Antes de começar {#before-you-start}

Você precisa de:

- O endereço do servidor com HTTPS (consulte [HTTPS](../install/https)).
- Um repositório, por exemplo `games`. Seu endereço de registro é `https://arkvory.example/npm/games/`.
- Uma chave. Desenvolvedores usam um token de acesso pessoal com o escopo `read`. Agentes de build que publicam usam um token pessoal com o escopo `read-write` ou uma chave de serviço. Consulte [Contas e chaves](../use/accounts).

O Arkvory envia o endereço de cada tarball ao cliente nos dados do pacote. O endereço é construído a partir do nome do host com o qual o cliente chegou. Quando um proxy reverso encerra o HTTPS, ele deve repassar o cabeçalho `Host` e enviar `X-Forwarded-Proto: https`, como no exemplo de nginx da instalação. Caso contrário, o cliente recebe endereços `http://` dos tarballs.

## Adicionar o registro a um projeto Unity {#unity-manifest}

1. Abra `Packages/manifest.json` do projeto e adicione um registro com escopo:

```json
{
  "scopedRegistries": [
    {
      "name": "Arkvory",
      "url": "https://arkvory.example/npm/games/",
      "scopes": ["com.proanima"]
    }
  ],
  "dependencies": {
    "com.proanima.tools": "1.2.0"
  }
}
```

2. Forneça a chave ao Unity. Não a coloque no projeto. Crie o arquivo `.upmconfig.toml` na sua pasta de usuário (`%USERPROFILE%\.upmconfig.toml` no Windows, `~/.upmconfig.toml` no macOS e no Linux):

```toml
[npmAuth."https://arkvory.example/npm/games/"]
token = "<your Arkvory key>"
alwaysAuth = true
```

3. Reinicie o Unity. Na janela Package Manager, abra **My Registries** para ver os pacotes do registro.

Observações:

- `scopes` são prefixos de nomes de pacotes. O Unity obtém do Arkvory os pacotes cujos nomes começam com um escopo, e todos os outros pacotes do registro da Unity.
- O endereço em `.upmconfig.toml` deve ser o mesmo que `url` no manifesto, incluindo a barra final.
- `alwaysAuth = true` é obrigatório. O registro não envia um desafio de login, então o Unity deve enviar o token em cada solicitação.
- Os nomes de pacotes Unity são nomes de domínio reversos em minúsculas, como `com.company.package`. O Unity não oferece suporte a nomes com `@scope/`.

Faça commit de `Packages/manifest.json` junto com o projeto. Cada desenvolvedor mantém seu próprio `.upmconfig.toml`.

## Publicar um pacote {#publish}

Um pacote é uma pasta com um `package.json` no nível superior. Publique-o com o `npm`.

1. Na pasta do pacote, crie um arquivo `.npmrc`:

```ini
registry=https://arkvory.example/npm/games/
//arkvory.example/npm/games/:_authToken=${ARKVORY_TOKEN}
```

2. Defina a chave no ambiente e publique:

```bash
export ARKVORY_TOKEN="$(cat ~/.arkvory/key)"
npm publish
```

```powershell
$env:ARKVORY_TOKEN = (Get-Content C:\Private\arkvory.key -Raw).Trim()
npm publish
```

A linha com `_authToken` deve começar com o endereço do registro sem `https:`. Mantenha a chave fora do `.npmrc`: o npm substitui `${ARKVORY_TOKEN}` a partir do ambiente.

Em vez da linha `registry` no `.npmrc`, você pode definir o registro no `package.json` do pacote:

```json
{
  "name": "com.proanima.tools",
  "version": "1.2.0",
  "publishConfig": { "registry": "https://arkvory.example/npm/games/" }
}
```

O que o registro verifica:

- **Nome e versão.** `name` e `version` no `package.json` dentro do tarball devem corresponder aos publicados. A versão segue o SemVer 2.0.0, por exemplo `1.2.0` ou `2.0.0-beta.1`. O registro lê os dados da versão desse arquivo, não do JSON que o cliente envia.
- **Somas de verificação.** O comprimento, `shasum` e `integrity` que o cliente declara devem corresponder aos bytes. Uma divergência retorna `422 integrity_mismatch`.
- **O tarball.** Ele deve conter `<folder>/package.json`, como o `npm pack` o cria. Um segundo `package.json` no arquivo é recusado, porque o npm e o registro poderiam ler arquivos diferentes.
- **Uma versão é imutável.** O mesmo tarball publicado novamente tem sucesso e não altera nada (`200`). Outro conteúdo para uma versão existente retorna `409` com o motivo `version_exists`. Publique a correção como a próxima versão.

O `npm publish` lê o pacote do registro antes de publicar, então conceda a uma chave de publicação `content.read` e `artifact.list`, além de `upload.create`. Consulte [Permissões](#permissions).

A versão fica disponível assim que o `npm publish` retorna. O tarball de uma versão é armazenado como o artefato `<name>-<version>.tgz` com o rótulo `npm`. Para um nome com escopo, `@team/util` se torna `util-<version>.tgz`.

## Instalar pacotes {#install}

No Unity, adicione a dependência no manifesto ou escolha o pacote na janela Package Manager em **My Registries**.

Para o npm, defina o registro no `.npmrc` do projeto ou do seu usuário. Um registro para um escopo é a escolha usual, porque o Arkvory não encaminha solicitações ao registro npm público:

```ini
@team:registry=https://arkvory.example/npm/games/
//arkvory.example/npm/games/:_authToken=${ARKVORY_TOKEN}
```

```bash
npm install @team/util
npm view @team/util versions
npm search tools
```

Se você definir `registry=` como Arkvory para todo o projeto, o npm procurará todos os pacotes lá, incluindo os públicos, como `lodash`, e falhará com `404`. Use um registro com escopo ou um projeto que contenha somente seus próprios pacotes.

O npm verifica `dist.integrity` durante a instalação e grava o endereço do registro em `package-lock.json`.

## Versões e dist-tags {#versions-and-tags}

Uma dist-tag é um nome móvel para uma versão. O `npm publish` define `latest` para a nova versão. Outras tags ajudam a separar canais de release.

```bash
npm publish --tag beta
npm dist-tag add com.proanima.tools@1.3.0 latest
npm dist-tag ls com.proanima.tools
npm dist-tag rm com.proanima.tools beta
```

```bash
npm install com.proanima.tools@beta
```

| Regra          | Valor                                                                     |
| -------------- | ------------------------------------------------------------------------- |
| Nome da tag    | Começa com uma letra. Letras, dígitos, `.`, `_` e `-`. Até 64 caracteres. |
| Tags proibidas | Um nome que parece uma versão (`v1`, `v2.0`), e `x` ou `X`                |
| `latest`       | Sempre aponta para uma versão. Pode ser movida, não removida (`409`).     |
| Mover uma tag  | `npm dist-tag add`, ou publicar com `--tag`. A nova versão deve existir.  |

Uma tag é apenas um nome: ela não exclui nem oculta outras versões.

Não há como remover uma versão publicada. Consulte [Não suportado](#not-supported).

## Pesquisa {#search}

A lista **My Registries** no Unity e o `npm search` usam o endereço de pesquisa `/-/v1/search`. A pesquisa encontra pacotes cujo nome ou descrição contém o texto, em qualquer caixa, e pacotes que têm o texto como uma palavra-chave inteira. Sem texto, ela lista todos os pacotes.

- Retorna uma linha por pacote: a versão com a tag `latest`, ou então a versão mais nova.
- Os resultados são ordenados por nome. Não há classificação por popularidade.
- `size` é 20 por padrão e no máximo 250. `from` é o deslocamento.

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_TOKEN" \
  "https://arkvory.example/npm/games/-/v1/search?text=tools&from=0&size=20"
```

Para ler um pacote diretamente, solicite seu nome. `@scope/name` pode ser enviado como `@scope%2fname`:

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_TOKEN" https://arkvory.example/npm/games/com.proanima.tools
```

A resposta lista cada versão com o conteúdo de seu `package.json` (incluindo os campos `unity` e `displayName` que o Unity lê), as dist-tags e os horários de publicação. `dist` tem `tarball`, `shasum` (SHA-1) e `integrity` (SHA-512).

## Nomes e limites {#limits}

| Item                                    | Regra                                                                                                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nome do pacote                          | Letras minúsculas, dígitos, `.`, `_`, `~` e `-`, começando com uma letra ou um dígito. Até 214 caracteres. `@scope/name` é permitido para npm.                          |
| Versão                                  | SemVer 2.0.0, até 256 caracteres                                                                                                                                        |
| `package.json` no tarball               | Até 256 KiB. Os dados de todas as versões vêm em uma única resposta, então mantenha-o pequeno.                                                                          |
| Tarball                                 | Até o tamanho máximo de objeto da instalação, `ARKVORY_MAX_OBJECT_BYTES` (cerca de 10 TiB por padrão). Um arquivo que expande mais de 100 vezes mais 64 MiB é recusado. |
| O restante da solicitação de publicação | Até 8 MiB de JSON, aninhado no máximo 64 níveis. O tarball é lido como um stream e não é mantido na memória.                                                            |
| Uma solicitação de publicação           | Deve terminar em até 30 minutos e não pode pausar por mais de 30 segundos (`ARKVORY_UPLOAD_DEADLINE_MS`, `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`)                              |
| Uploads ao mesmo tempo                  | 2 por servidor e 1 por chave por padrão. Uma solicitação em espera desiste após 20 segundos.                                                                            |
| Texto de pesquisa                       | Até 256 caracteres                                                                                                                                                      |

O `npm publish` é uma única solicitação, e ele reinicia a partir do primeiro byte após uma falha. Para pacotes de muitos gigabytes, envie o arquivo com o [`arkvoryctl`](./cli) como um artefato ou um [arquivo bruto](./raw-files). Assets binários grandes que mudam com frequência ficam melhor no [Git LFS](./git-lfs); mantenha código e recursos estáveis nos pacotes.

Os limites do servidor estão em [Variáveis de ambiente](../reference/environment#transfers-and-bandwidth).

## Permissões {#permissions}

Tokens pessoais e chaves de arquivo recebem acesso de leitura ou de escrita ao repositório. Chaves de serviço recebem ações exatas.

| Operação                                    | Ações da chave de serviço | Token pessoal ou chave de arquivo               |
| ------------------------------------------- | ------------------------- | ----------------------------------------------- |
| Instalar: ler um pacote e baixar um tarball | `content.read`            | Acesso de leitura                               |
| Pesquisar, listar dist-tags                 | `artifact.list`           | Acesso de leitura                               |
| Publicar, adicionar e remover dist-tags     | `upload.create`           | Acesso de escrita, escopo do token `read-write` |

Um desenvolvedor que apenas instala pacotes precisa de um token com o escopo `read`. Um agente de build que publica precisa de `upload.create`, `content.read` e `artifact.list`. Ninguém pode excluir uma versão publicada.

## Gateways de leitura e espelhos {#read-gateways-and-mirrors}

- Um [gateway de leitura](../operate/read-gateways) atende instalação e pesquisa, porque são solicitações `GET`. Uma publicação recebe `405`.
- Um [espelho](../operate/mirrors) contém as versões e tags de sua origem. A instalação e a pesquisa funcionam. A publicação é recusada com `409` e o motivo `mirror_read_only`. Os endereços dos tarballs nos dados de um espelho apontam para o espelho.

Para usar um espelho no Unity, coloque o endereço do espelho em `url` e sua chave em `.upmconfig.toml`.

## Não suportado {#not-supported}

- Remover uma versão (`npm unpublish`). Os projetos fixam versões, e uma remoção quebraria seus builds. Publique uma versão corrigida e mova a tag.
- `npm deprecate`, `npm login`, `npm owner`, `npm access` e outros comandos de gerenciamento. Solicitações que alteram dados em outros caminhos respondem `405` com "This registry supports publish, install and dist-tags". Crie um token no console e coloque-o no `.npmrc` em vez de `npm login`.
- A lista de todos os pacotes em `/-/all`, e o `npm audit`.
- Um proxy para os registros públicos. O Arkvory armazena seus próprios pacotes. Pacotes do npmjs.com ou do registro da Unity são obtidos de lá.
- Classificação dos resultados de pesquisa.
- Uma seção para pacotes no console. Os tarballs aparecem em [[ui:catalog]] como artefatos com o rótulo `npm`.

## Solução de problemas {#troubleshooting}

Os erros têm a forma `{"error": "...", "code": "...", "request_id": "..."}`. O `npm` imprime `error`. Informe o `request_id` ao seu administrador para encontrar a solicitação no log do servidor.

| Sintoma                                               | Causa                                                                      | O que fazer                                                                                                                                                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401` no Unity ou no npm                              | O cliente não enviou a chave, ou a chave está errada, expirada ou revogada | No Unity, verifique se o endereço em `.upmconfig.toml` é igual a `url` no manifesto e se `alwaysAuth = true`. No npm, verifique se a linha `_authToken` começa com o mesmo host e caminho que `registry`. |
| `403` ao publicar                                     | O token tem o escopo `read`, ou a chave não tem `upload.create`            | Use uma chave com acesso de escrita                                                                                                                                                                       |
| `404` para um pacote                                  | Não existe esse pacote neste repositório, ou a chave não vê o repositório  | Verifique o repositório no endereço e o nome. Para um pacote Unity, verifique se o nome começa com um escopo de `scopes`.                                                                                 |
| `404` para um pacote público                          | `registry=` aponta para o Arkvory para todos os pacotes                    | Use `@scope:registry=`                                                                                                                                                                                    |
| `409` com `version_exists`                            | A versão existe com outro conteúdo                                         | Publique uma nova versão                                                                                                                                                                                  |
| `409` com `state_conflict`                            | Você tentou remover `latest`                                               | Mova `latest` para outra versão                                                                                                                                                                           |
| `409` com `mirror_read_only`                          | O repositório é um espelho                                                 | Publique no servidor principal                                                                                                                                                                            |
| `422` com `integrity_mismatch`                        | Os bytes diferem do `shasum` ou `integrity` declarados                     | Empacote e publique novamente. Verifique se nenhum proxy altera o corpo.                                                                                                                                  |
| `400` "package.json names another package or version" | O `package.json` dentro do tarball difere do nome ou da versão publicados  | Execute `npm publish` a partir de um build limpo do pacote                                                                                                                                                |
| `400` "Only publishing a new version is supported"    | O comando enviou um pacote alterado, por exemplo `npm deprecate`           | Esses comandos não são suportados                                                                                                                                                                         |
| `405`                                                 | O comando não é suportado por este registro                                | Consulte [Não suportado](#not-supported)                                                                                                                                                                  |
| `507`                                                 | A cota do repositório ou a capacidade da instalação foi atingida           | Libere espaço ou peça uma cota maior                                                                                                                                                                      |
| `503`                                                 | Uploads demais ao mesmo tempo                                              | Aguarde e tente novamente                                                                                                                                                                                 |
| Download de tarballs por `http://` e falha            | O proxy não envia `X-Forwarded-Proto: https`                               | Corrija o proxy como descrito em [Antes de começar](#before-you-start)                                                                                                                                    |

## Páginas relacionadas {#related-pages}

- [Clientes e protocolos](./index)
- [Git LFS](./git-lfs)
- [Contas e chaves](../use/accounts)
- [HTTPS](../install/https)
- [Espelhos](../operate/mirrors)
