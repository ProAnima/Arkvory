---
title: 'Repositórios'
description: 'O que é um repositório, como ver os repositórios que você pode usar, como escolher um no console e o que são repositórios somente leitura.'
---

# Repositórios

Um repositório é um lugar nomeado no Arkvory onde os arquivos são armazenados e onde o acesso é decidido. Tudo o que você publica vai para um repositório, e cada solicitação o nomeia.

## O que é um repositório {#what-it-is}

Um repositório tem um ID: letras latinas minúsculas, dígitos, `-` e `_`, começando com uma letra ou um dígito, no máximo 64 caracteres. Exemplos são `releases`, `builds` e `game-prod`. O ID faz parte de todos os endereços:

| O que                                               | Endereço                              |
| --------------------------------------------------- | ------------------------------------- |
| Artefatos, pacotes, arquivos por caminho (API HTTP) | `/api/v1/repositories/<repository>/…` |
| Imagens de contêiner                                | `/v2/<repository>/<image>/…`          |
| Git LFS                                             | `/lfs/<repository>`                   |
| Pacotes npm e Unity                                 | `/npm/<repository>/…`                 |

Consulte [Imagens de contêiner](../protocols/containers), [Git LFS](../protocols/git-lfs) e [Unity e npm](../protocols/unity-npm).

Um repositório contém artefatos imutáveis. Existem duas visões deles: pacotes UPack com uma versão ([Pacotes](./packages)) e arquivos por caminho com um histórico ([Arquivos por caminho](./files)). Estágios e promoção movem builds entre repositórios ([Estágios e promoção](./promotion)).

Hoje um repositório não tem nome de exibição, nem descrição, nem configurações próprias além do acesso, das [configurações de armazenamento](#settings) e, para uma cópia de outro servidor, do seu [estado de espelho](#read-only). Você não pode renomear um repositório. Você não pode excluí-lo: retire o acesso e os arquivos permanecem no disco.

## Criar um repositório {#create}

Não há nenhum comando que cria um repositório. Um repositório existe assim que o acesso a ele é concedido. O repositório fica vazio até o primeiro upload.

Um administrador faz uma destas coisas:

- Concede a um grupo acesso ao novo nome. No console, abra [[ui:administration]], expanda [[ui:manageGrants]], escolha o grupo, digite o nome em [[ui:repository]], escolha [[ui:read]] ou [[ui:write]] e selecione [[ui:saveGrant]]. O grupo `arkvory-owners`, ao qual o proprietário pertence, é uma boa escolha para a primeira concessão. Consulte [Grupos e acesso a repositórios](./accounts#groups).
- Nomeia o repositório na política de uma conta de serviço. Consulte [Contas de serviço e chaves para CI](./accounts#service-accounts).

Com a API, `setGroupGrant` e `setServicePolicy` fazem o mesmo. Um erro de digitação cria um nome novo e errado: confira a ortografia. O nome `releases` existe após a instalação, com acesso de escrita para o grupo `arkvory-owners`.

## Ver os repositórios que você pode usar {#list}

Você vê apenas os repositórios nos quais sua credencial tem algum direito. Um repositório no qual você não tem nenhum direito não aparece, e pedi-lo diretamente retorna `404`. Um repositório vazio ao qual você tem acesso também aparece.

No console, abra [[ui:repositories]]. Cada cartão mostra o nome do repositório e, em [[ui:repositoryRights]], as ações que você tem nele. Os botões são:

- [[ui:repositoryOpen]] abre o catálogo do repositório. Aparece quando você pode listar artefatos.
- [[ui:repositoryStorage]] abre o catálogo com as configurações de armazenamento. Aparece quando você pode ler a política de armazenamento ou os diagnósticos.
- [[ui:repositoryAccess]] leva à administração de usuários e de serviços. Aparece para administradores e administradores de serviços.

A lista mostra 50 repositórios por vez; [[ui:managementMore]] carrega a próxima página e [[ui:managementReload]] a atualiza. Um espelho mostra o selo [[ui:mirrorBadge]].

Com o `arkvoryctl`:

```bash
arkvoryctl repositories
arkvoryctl doctor
```

`repositories` imprime cada repositório com seus `formats` e suas `permissions`. Quando a resposta tem um valor `next`, passe-o como `--after`. O `doctor` mostra o servidor, as capacidades e as permissões da chave atual.

Com a API, `listRepositories` aceita `limit` (de 1 a 100, 50 por padrão) e `after`, o último ID da página anterior. `getRepository` retorna um cartão.

```bash
curl -H "Authorization: Bearer $ARKVORY_KEY" "$ARKVORY/api/v1/repositories?limit=100"
```

```typescript
const page = await client.repositories({ limit: 50 });
const card = await client.repository('releases');
```

Um cartão é `id`, `formats` (sempre `upack` e `assets`) e `permissions`. Ele não informa nada sobre o tamanho nem o número de arquivos. Consulte [Permissões](./accounts#permissions) para os nomes das ações.

## Escolher um repositório no console {#choose}

O cartão [[ui:connection]] tem o campo [[ui:repository]] com uma lista dos repositórios que você pode ler. O campo começa com `releases`. Depois que você entra, o console o mantém se você puder lê-lo e, caso contrário, escolhe o primeiro repositório que você pode ler. Para trabalhar em outro, digite seu nome ou escolha-o na lista. O catálogo, os pacotes, os uploads e os detalhes então usam esse repositório. [[ui:repositoryOpen]] em um cartão preenche o campo para você.

O endereço de um artefato no console contém seu repositório: `#/artifact/<repository>/<id>`. Um link para um artefato em um repositório que você não pode ler mostra uma mensagem e o catálogo.

O `arkvoryctl` usa o repositório do perfil, `releases` a menos que você defina outro ao adicionar o perfil. Substitua-o para um comando com `--repository`:

```bash
arkvoryctl profile add production --server https://arkvory.example --token-file ~/.arkvory/key --repository builds
arkvoryctl list --repository releases
```

No SDK, `client.inRepository('builds')` retorna um cliente vinculado a um repositório. No HTTP, o repositório está no caminho.

## Configurações de um repositório {#settings}

O que você pode definir hoje para um repositório:

- **Acesso.** Quem pode ler e escrever. Consulte [Contas e acesso](./accounts).
- **Armazenamento.** Uma cota em GiB, limites de aviso e críticos, retenção (manter os últimos N builds de cada pacote e canal, rótulos protegidos, uma idade mínima), limpeza automática e limpeza física. As configurações exigem as ações `storage.read` para consultar e `storage.manage` para alterar; o nível de grupo de uma pessoa não as concede, uma chave de serviço sim. No console, elas ficam em [[ui:storageTitle]], que [[ui:repositoryStorage]] abre. Com `arkvoryctl`, `storage usage` e `storage policy` as leem. Um novo upload que ultrapassaria a cota é recusado com `507 storage_quota`. Consulte [Armazenamento e retenção](../operate/storage).
- **Espelho.** Um administrador do servidor pode tornar o repositório uma cópia do repositório de outro servidor. Consulte a próxima seção.

## Repositórios somente leitura {#read-only}

Um **espelho** é uma cópia somente leitura de um repositório de outro servidor Arkvory. O servidor o mantém sincronizado por conta própria. Todos os que têm o direito de ler podem listar e baixar. Ninguém pode alterá-lo: upload, publicação, alteração de rótulos, adição de estágios, atribuição de caminhos e exclusão são todos recusados com `409 mirror_read_only`, qualquer que seja o nível de grupo da pessoa ou as ações da chave. Para alterar o conteúdo, use o servidor principal.

O console mostra um espelho com um selo acima do catálogo e oculta o botão de upload:

| Selo                 | Significado                                           |
| -------------------- | ----------------------------------------------------- |
| [[ui:mirrorBadge]]   | A cópia está em dia                                   |
| [[ui:mirrorBehind]]  | O servidor ainda está se atualizando                  |
| [[ui:mirrorFailing]] | A última sincronização falhou; os downloads continuam |

Selecione [[ui:mirrorHelpLabel]] ao lado do selo para ver a origem, o horário da última sincronização e o código de erro.

Um segundo tipo é uma **importação**. É um repositório comum que assume, automaticamente, as versões que carregam certos estágios em um repositório de outro servidor (por exemplo, de `dev` para `prod`). Seu selo é [[ui:mirrorImport]]. Os uploads para ele continuam possíveis, e alterações ou exclusões posteriores na origem não afetam o que foi copiado.

Com a API, `getRepositoryMirror` retorna o estado: `mode` (`mirror` ou `import`), `phase` (`pending`, `seeding` ou `following`), `caughtUp`, `syncedAt` e `errorCode`. Responde `404` para um repositório comum.

Os espelhos são configurados pelo administrador do servidor. Consulte [Espelhos](../operate/mirrors). Um **gateway de leitura** é outra coisa: um endereço que serve apenas downloads para os mesmos repositórios. As alterações por meio dele são recusadas com `405 read_only`. Consulte [Gateways de leitura](../operate/read-gateways).

## Páginas relacionadas {#related-pages}

- [Contas e acesso](./accounts)
- [Arquivos por caminho](./files) e [Pacotes](./packages)
- [Armazenamento e retenção](../operate/storage)
- Referência da API: [Repositórios](../api/reference/repositories), [Espelhos](../api/reference/mirrors)
