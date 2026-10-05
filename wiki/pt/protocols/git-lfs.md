---
title: Git LFS
description: Armazene os arquivos grandes de um repositório git no Arkvory e bloqueie assets binários, por exemplo para projetos Unity e Unreal.
---

# Git LFS

Todo repositório do Arkvory é um servidor Git LFS. Seu repositório git permanece onde está, por exemplo no GitHub, GitLab ou Gitea. Somente os arquivos grandes que o Git LFS rastreia, e os bloqueios de arquivo, vão para o Arkvory. Os objetos do LFS são artefatos comuns, portanto permissões de repositório, cotas, verificações SHA-256, backups e espelhos se aplicam a eles.

## Configurar um repositório git {#set-up}

Você precisa do endereço do servidor com HTTPS (consulte [HTTPS](../install/https)), de um repositório do Arkvory, por exemplo `games`, e de uma chave (consulte [Contas e chaves](../use/accounts)).

1. Instale o Git LFS em todas as máquinas que usam o repositório e execute `git lfs install` uma vez por usuário.
2. Crie o arquivo `.lfsconfig` na raiz do repositório git e faça commit dele. Ele faz toda a equipe usar o Arkvory:

```ini
[lfs]
	url = https://arkvory.example/lfs/games
```

3. Rastreie os padrões de arquivo. Isso grava `.gitattributes`, que você também faz commit:

```bash
git lfs track "*.psd" "*.fbx" "*.wav" "*.uasset" "*.umap"
git add .gitattributes .lfsconfig
```

4. Faça commit e push como de costume. A primeira solicitação pede credenciais: consulte [Entrar](#sign-in).

O endereço LFS de um repositório é sempre `https://<host>/lfs/<repository>`.

Para mover arquivos que já estão no LFS em outro servidor, primeiro baixe todos os objetos do servidor antigo, depois troque `lfs.url` e faça upload deles:

```bash
git lfs fetch --all origin
git config lfs.url https://arkvory.example/lfs/games
git lfs push --all origin
```

## Entrar {#sign-in}

O Arkvory usa a chave como senha da autenticação HTTP Basic. O nome de usuário não é verificado: use qualquer nome. A chave também pode vir como um token Bearer.

O Git pede o nome de usuário e a senha por meio de seu credential helper na primeira vez que o servidor responde `401`. O helper os salva: Git Credential Manager no Windows e no macOS, `credential.helper store` ou `cache` no Linux.

| Quem                  | Chave                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| Desenvolvedor         | Um token de acesso pessoal. Escopo `read-write` para push e bloqueios, escopo `read` somente para clone e pull. |
| Servidor de build, CI | Uma chave de serviço com as ações em [Permissões](#permissions)                                                 |

O Git mantém credenciais por host. A chave do Arkvory não substitui a credencial do host do seu repositório git, por exemplo o GitHub.

Em um runner de CI sem credential helper, coloque a chave na configuração local do checkout. A chave então fica somente em `.git/config` desse workspace, nunca em `.lfsconfig`:

```bash
git config lfs.url "https://ci:${ARKVORY_KEY}@arkvory.example/lfs/games"
```

Não faça commit de uma chave. Não a imprima nos logs. Remova o workspace depois do job.

## Trabalho diário {#daily-work}

O Git LFS funciona como com qualquer servidor LFS. Os comandos que você usa:

| Comando                                 | O que ele faz                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `git push`                              | Envia novos objetos do LFS ao Arkvory antes de fazer push dos commits                   |
| `git clone`, `git pull`, `git checkout` | Baixam os objetos de que a árvore de trabalho precisa                                   |
| `git lfs fetch --all`                   | Baixa os objetos de todos os branches                                                   |
| `git lfs ls-files`                      | Lista os arquivos rastreados e seus IDs curtos                                          |
| `git lfs push --all origin`             | Envia novamente todos os objetos locais. Objetos que o Arkvory já tem não são enviados. |

Um objeto que o Arkvory já tem, com o mesmo ID e tamanho, não é enviado novamente. Um push repetido após uma interrupção envia somente o que falta.

## Bloqueio de arquivos {#locks}

Assets binários não podem ser mesclados. Um bloqueio avisa à equipe que uma pessoa está editando um arquivo. Os bloqueios pertencem ao repositório do Arkvory, não a um branch.

```bash
git lfs lock Content/Maps/Level01.umap
git lfs locks
git lfs unlock Content/Maps/Level01.umap
```

- Um segundo `git lfs lock` no mesmo caminho falha com "already created lock" e informa o proprietário.
- O proprietário é indicado pelo nome do usuário ou da conta de serviço no momento em que o bloqueio foi feito. Uma chave de arquivo mostra seu ID.
- Somente o proprietário desbloqueia um arquivo. `git lfs unlock --force` em um bloqueio de outra pessoa exige uma chave de serviço com a ação `artifact.delete` no repositório. Tokens pessoais não podem quebrar bloqueios.
- Um caminho de bloqueio é um caminho do repositório git: até 1024 caracteres, com `/` entre pastas, e sem segmentos vazios, `.` ou `..`, barra invertida ou dois-pontos.
- `git lfs locks` mostra 100 bloqueios por página.

Ative a verificação antes do push, para que o git se recuse a fazer push de alterações em arquivos que outros bloquearam. A configuração é por endereço de servidor:

```bash
git config lfs.https://arkvory.example/lfs/games.locksverify true
```

Marque os tipos de arquivo que devem ser bloqueados antes da edição. O Git LFS então os mantém somente leitura até que você os bloqueie:

```bash
git lfs track --lockable "*.umap" "*.uasset"
```

A verificação de bloqueio no push precisa de acesso de escrita, então um token somente leitura não pode usá-la. Use `git lfs locks` para listar os bloqueios, o que o acesso de leitura permite.

## Dicas para Unity e Unreal {#game-engines}

- Unity: mantenha os assets de texto (`.unity`, `.prefab`, `.asset`) no git e defina a serialização de assets como Force Text. Rastreie os binários grandes no LFS, por exemplo `*.png`, `*.psd`, `*.fbx`, `*.wav`, `*.mp4`, `*.exr`. Arquivos de texto que você rastrear no LFS também são aceitos.
- Unreal Engine: rastreie `*.uasset`, `*.umap` e os arquivos de origem grandes, e marque `*.uasset` e `*.umap` como bloqueáveis.
- Integrações de editor que chamam os comandos de bloqueio do LFS usam o protocolo padrão de bloqueio de arquivos do Git LFS. O Arkvory é testado com os clientes de linha de comando `git` e `git-lfs`.
- Não coloque saídas de build mutáveis de dezenas de gigabytes no LFS. Envie-as como artefatos ou [arquivos brutos](./raw-files) com o [`arkvoryctl`](./cli). Objetos do LFS nunca são excluídos pela retenção, então permanecem para sempre.
- Código ou ferramentas grandes e reutilizáveis compartilhados por projetos Unity são melhor servidos por [pacotes Unity](./unity-npm).

## O que é armazenado {#what-is-stored}

- Um objeto do LFS é um artefato no repositório do Arkvory. Seu nome e sua identidade são o SHA-256 de seu conteúdo (o `oid` do LFS), e ele tem o rótulo `lfs`. Você vê esses artefatos no console em [[ui:catalog]].
- O Arkvory verifica o tamanho e o SHA-256 enquanto recebe o objeto. Se eles diferirem do `oid`, o upload falha com `422` e nada é armazenado.
- Um objeto pertence ao repositório. Dois repositórios do Arkvory mantêm suas próprias cópias do mesmo arquivo.
- A retenção nunca remove objetos do LFS, porque o servidor não consegue ver quais commits ainda precisam deles. Não há comando para excluir um objeto do LFS. Planeje a cota do repositório para todo o histórico dos assets.
- Os bloqueios são linhas no banco de dados. Os backups os incluem.

## Permissões {#permissions}

Tokens pessoais e chaves de arquivo recebem acesso de leitura ou de escrita ao repositório. Chaves de serviço recebem ações exatas.

| Operação                                         | Ações da chave de serviço | Token pessoal ou chave de arquivo               |
| ------------------------------------------------ | ------------------------- | ----------------------------------------------- |
| Download (`clone`, `fetch`, `pull`)              | `content.read`            | Acesso de leitura                               |
| Upload (`push`)                                  | `upload.create`           | Acesso de escrita, escopo do token `read-write` |
| Listar bloqueios                                 | `artifact.list`           | Acesso de leitura                               |
| Criar, verificar e liberar os próprios bloqueios | `upload.create`           | Acesso de escrita, escopo do token `read-write` |
| Liberar um bloqueio de outra pessoa (`--force`)  | `artifact.delete`         | Não é possível                                  |

Um job de CI que faz push e pull precisa de `content.read`, `upload.create` e `artifact.list`. Uma chave que só pode fazer push ainda assim descobre que um objeto existe, então não o envia duas vezes.

Um token pessoal somente leitura pode clonar e fazer pull embora a solicitação da lista de download seja um `POST`. Ele não pode fazer push nem bloquear. Um espelho e um gateway de leitura são abordados em [Espelhos e gateways de leitura](#mirrors-and-read-gateways).

## Como a transferência funciona {#how-it-works}

Você não precisa desses detalhes para o trabalho diário. Eles ajudam quando você depura um proxy ou um firewall.

1. O Git LFS envia um `POST /lfs/<repository>/objects/batch` com a operação (`download` ou `upload`) e a lista de objetos. Até 1000 objetos por solicitação. O Git LFS envia no máximo 100 por padrão.
2. O Arkvory responde com um link para cada objeto que deve ser transferido, válido por uma hora. Para um upload, ele omite os objetos que já tem.
3. O Git LFS envia cada objeto com `PUT`, ou o baixa com `GET`, para `/lfs/<repository>/objects/<oid>`. A solicitação carrega a mesma chave da solicitação em lote.
4. Um `PUT` precisa de um cabeçalho `Content-Length`. Um upload em chunks é recusado com `422`.

Com suporte a:

| Item                       | Valor                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Adaptador de transferência | `basic` somente                                                                                                                  |
| Algoritmo de hash          | `sha256` somente. Um cliente que pedir outro recebe `409`.                                                                       |
| Autenticação               | Basic (chave como senha) ou Bearer                                                                                               |
| Download                   | `GET` e `HEAD` com solicitações `Range`                                                                                          |
| Tipo de mídia              | `application/vnd.git-lfs+json` para as solicitações JSON. Corpos de objeto de qualquer tipo de mídia são armazenados como bytes. |

Os erros são documentos JSON com `message` e `request_id`. Informe o `request_id` quando pedir ajuda ao seu administrador.

Os links apontam para o endereço com o qual o cliente chegou ao servidor. Quando um proxy reverso encerra o HTTPS, ele deve repassar o cabeçalho `Host` e enviar `X-Forwarded-Proto: https`, como no exemplo de nginx da instalação, para que os links usem `https`. O Arkvory coloca a chave em um link somente quando o link é `https` ou aponta para o computador local. Em HTTP simples para outro host, o git não consegue enviar a chave com o objeto e a transferência falha.

## Arquivos grandes e retomada {#large-files}

- O Git LFS envia cada objeto em uma única solicitação `PUT`. Após uma falha, ele reinicia o objeto a partir do primeiro byte. O adaptador `tus`, que retoma dentro de um objeto, não é suportado.
- Uma solicitação de upload deve terminar em até 30 minutos e não pode pausar por mais de 30 segundos (`ARKVORY_UPLOAD_DEADLINE_MS`, `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`). Um arquivo de muitos gigabytes precisa de uma rede rápida e estável. Para arquivos maiores, use o [`arkvoryctl`](./cli), que faz upload em partes.
- Os downloads aceitam solicitações `Range`.
- Um objeto pode ser tão grande quanto o tamanho máximo de objeto da instalação (`ARKVORY_MAX_OBJECT_BYTES`, cerca de 10 TiB por padrão). Um objeto maior é recusado na resposta em lote com `422`.

Por padrão, o servidor executa 2 uploads ao mesmo tempo e 1 por chave (`ARKVORY_MAX_UPLOADS`, `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`). O Git LFS envia 8 objetos ao mesmo tempo por padrão. Os outros uploads esperam por um slot livre e desistem após 20 segundos (`ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS`) com `503`. O Git LFS repete algumas vezes um objeto que falhou, mas um push de arquivos grandes é mais confiável com menos transferências paralelas:

```bash
git config lfs.concurrenttransfers 1
```

Você também pode pedir ao administrador para aumentar os limites. Eles são descritos em [Variáveis de ambiente](../reference/environment#transfers-and-bandwidth).

## Espelhos e gateways de leitura {#mirrors-and-read-gateways}

| Local                                          | Clone e fetch                                                                            | Push e bloqueios                                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Servidor principal                             | Sim                                                                                      | Sim                                                                                         |
| [Espelho](../operate/mirrors)                  | Sim. O espelho tem os objetos de sua origem, então aponte `lfs.url` para ele.            | Recusado (`409`, motivo `mirror_read_only`). Os bloqueios não são copiados para um espelho. |
| [Gateway de leitura](../operate/read-gateways) | Não. A lista de download é uma solicitação `POST`, que um gateway de leitura não aceita. | Não                                                                                         |

Sempre aponte `lfs.url` para o servidor principal, ou para um espelho no caso de máquinas somente leitura.

## Solução de problemas {#troubleshooting}

| Mensagem ou sintoma                                                        | Causa                                                                                 | O que fazer                                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `401` ou um erro de autorização                                            | Sem chave, chave errada, ou token expirado ou revogado                                | Remova a credencial salva no seu gerenciador de credenciais e faça push novamente com uma chave válida |
| `403` com "Read-only personal access token"                                | O token tem o escopo `read`                                                           | Crie um token com o escopo `read-write`                                                                |
| `403`                                                                      | A chave não tem o acesso para esta operação, ou o repositório não foi concedido a ela | Adicione as ações de [Permissões](#permissions)                                                        |
| `Lock failed: already created lock`                                        | Alguém detém o bloqueio                                                               | Peça ao proprietário para desbloquear, ou a um administrador para usar `--force`                       |
| `422` "Object exceeds the maximum size"                                    | O objeto é maior que o limite da instalação                                           | Use o `arkvoryctl` para esses arquivos                                                                 |
| `422` no upload                                                            | O conteúdo não corresponde ao `oid`; o arquivo mudou durante o push                   | Execute `git lfs push` novamente                                                                       |
| `503` ou `Retry-After`                                                     | Transferências demais ao mesmo tempo                                                  | Reduza `lfs.concurrenttransfers` e tente novamente                                                     |
| `507`                                                                      | A cota do repositório ou a capacidade da instalação foi atingida                      | Libere espaço ou peça uma cota maior                                                                   |
| `409` no upload                                                            | O repositório é um espelho                                                            | Faça push para o servidor principal                                                                    |
| Arquivos na árvore de trabalho são pequenos arquivos de texto com um `oid` | Os objetos não foram baixados, ou `git lfs install` não foi executado                 | Execute `git lfs install`, depois `git lfs pull`                                                       |
| `x509: certificate signed by unknown authority`                            | O cliente não confia no certificado                                                   | Adicione a autoridade certificadora ao repositório de confiança do sistema, ou defina `http.sslCAInfo` |

Não desative a verificação de TLS (`GIT_SSL_NO_VERIFY`): a chave é enviada em cada solicitação.

## Páginas relacionadas {#related-pages}

- [Clientes e protocolos](./index)
- [Contas e chaves](../use/accounts)
- [HTTPS](../install/https)
- [Espelhos](../operate/mirrors)
- [Pacotes Unity e npm](./unity-npm)
