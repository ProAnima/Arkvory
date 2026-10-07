---
title: Clientes e protocolos
---

# Clientes e protocolos

O Arkvory tem um único armazenamento e um único modelo de acesso, mas várias formas de alcançá-lo. Cada forma é um cliente ou um protocolo que uma ferramenta já fala. Todas armazenam os dados como artefatos do Arkvory. Por isso, as mesmas permissões, cotas, verificações de SHA-256, regras de retenção, backups e espelhos se aplicam, qualquer que seja a forma que você use.

Esta página lista todas as formas de se comunicar com o Arkvory, para que serve cada uma e quais credenciais ela aceita. Use-a para escolher a ferramenta certa para cada tarefa.

## Visão geral {#overview}

| Forma                         | Endereço                                       | Use para                                                                                                | Credenciais                                                                       |
| ----------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Console web                   | `https://arkvory.example/console/`             | Navegar pelos repositórios, enviar e baixar arquivos no navegador, gerenciar usuários, chaves e backups | Login com nome de usuário e senha, ou uma chave de serviço                        |
| Linha de comando `arkvoryctl` | `/api/v1`                                      | Scripts de CI, uploads e downloads retomáveis, arquivos por caminho, promoção, backups                  | Chave de um arquivo ou de uma variável de ambiente (enviada como Bearer)          |
| SDK TypeScript                | `/api/v1`                                      | Suas próprias ferramentas em TypeScript ou JavaScript, no Node.js ou em um navegador                    | Chave obtida de um callback (enviada como Bearer)                                 |
| API REST                      | `/api/v1/...`                                  | Integrações em qualquer linguagem                                                                       | Somente `Authorization: Bearer <key>`                                             |
| Registro de contêineres (OCI) | `/v2/`                                         | Docker, Podman, Buildx, containerd, charts do Helm, artefatos do ORAS                                   | Basic com a chave como senha (`docker login`), ou Bearer                          |
| Git LFS                       | `/lfs/<repository>`                            | Arquivos grandes de um repositório git, bloqueio de arquivos para Unity e Unreal                        | Basic com a chave como senha (credential helper do git), ou Bearer                |
| Registro npm                  | `/npm/<repository>/`                           | Scoped registries do Unity Package Manager, `npm publish` e `npm install`                               | Bearer (`_authToken` no `.npmrc`, `token` no `.upmconfig.toml`), ou Basic `_auth` |
| Arquivos brutos por caminho   | `/api/v1/repositories/<repository>/raw/<path>` | Uma única solicitação com `curl -T` ou PowerShell                                                       | Somente `Authorization: Bearer <key>`                                             |
| Webhooks                      | A URL do seu receptor                          | Iniciar uma implantação ou um job quando um repositório mudar                                           | Assinatura HMAC de cada requisição                                                |

As rotas em `/v2`, `/lfs` e `/npm` seguem as especificações dos respectivos protocolos. Elas não fazem parte do documento OpenAPI de `/api/v1` e informam os erros no formato que os clientes delas esperam.

## Credenciais {#credentials}

Toda solicitação precisa de uma credencial, exceto as verificações públicas de integridade (health checks). O Arkvory aceita estes tipos:

| Tipo                    | Aparência         | Origem                                                                                                                                  | Uso típico                                                     |
| ----------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Token de acesso pessoal | `pat_...`         | Criado por um usuário no console. Escopo `read` ou `read-write`. Expira (90 dias por padrão, no máximo 365).                            | Desenvolvedores: Unity, git, Docker em uma estação de trabalho |
| Chave de serviço        | `arkvory_...`     | Emitida por um administrador para uma conta de serviço, com ações exatas por repositório                                                | CI/CD, agentes de implantação, servidores de build             |
| Chave de arquivo        | qualquer segredo  | O arquivo de chaves do servidor (`ARKVORY_KEYS_FILE`), com `read` ou `write` por repositório; a chave do proprietário também administra | Proprietário da instalação, integrações legadas                |
| Sessão                  | `dps_...`         | Login no console; válida por 12 horas                                                                                                   | Trabalho interativo no console                                 |
| Link de download        | URL com `?token=` | Criado para um artefato; de 60 segundos a 24 horas                                                                                      | Entregar um arquivo a alguém sem uma chave                     |

Os protocolos diferem apenas na forma como enviam a chave:

- `/api/v1`, a CLI, o SDK e os arquivos brutos usam `Authorization: Bearer <key>`.
- `/v2`, `/lfs` e `/npm` também aceitam HTTP Basic. O nome de usuário não é verificado. A senha é a chave do Arkvory. É assim que `docker login`, os credential helpers do git e o `_auth` do npm enviam as credenciais.
- Um token pessoal somente leitura nunca altera dados. Ele ainda pode baixar objetos do Git LFS, porque a solicitação batch do Git LFS é um `POST` também para downloads.

Como criar tokens e chaves: [Contas e chaves](../use/accounts). Detalhes dos cabeçalhos: [Autenticação](../api/authentication).

## Qual devo usar? {#which-one-should-i-use}

| Tarefa                                                                                            | Forma recomendada                                                    |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Enviar um artefato de build pelo CI e retomar o envio após uma falha de rede                      | [`arkvoryctl upload`](./cli) ou [`arkvoryctl put`](./cli)            |
| Publicar um pacote UPack pelo CI                                                                  | [`arkvoryctl packages publish`](./cli)                               |
| Implantar "o release 1.4 mais recente" em um servidor                                             | [`arkvoryctl packages download --range ^1.4 --stage release`](./cli) |
| Colocar um arquivo pequeno ou médio por caminho a partir de um script de shell, sem instalar nada | [Arquivos brutos](./raw-files) com `curl -T` ou PowerShell           |
| Armazenar imagens de contêiner ou charts do Helm                                                  | [Imagens de contêiner](./containers)                                 |
| Manter texturas, modelos e fases de um jogo fora do host git                                      | [Git LFS](./git-lfs)                                                 |
| Compartilhar pacotes Unity entre projetos                                                         | [Pacotes Unity e npm](./unity-npm)                                   |
| Criar sua própria ferramenta ou interface web                                                     | [SDK TypeScript](./sdk)                                              |
| Integrar a partir de Python, Go, C# ou outra linguagem                                            | [API REST](../api/index)                                             |
| Explorar, gerenciar usuários, chaves e backups                                                    | [Console web](../guide/console)                                      |

Regras práticas:

- **Arquivos grandes (muitos gigabytes):** use o `arkvoryctl` ou o SDK. Eles enviam em partes e continuam depois de uma interrupção. Uma única solicitação `PUT` (arquivos brutos, objetos do Git LFS, npm publish, uma camada do Docker) recomeça do byte zero depois de uma falha.
- **A ferramenta já fala um protocolo:** use esse protocolo. Docker, git e Unity não precisam de software adicional.
- **A máquina só lê:** dê a ela um token somente leitura ou uma chave de serviço apenas com ações de leitura.

## Regras comuns {#shared-rules}

**HTTPS.** Use HTTPS em todos os clientes. A CLI e o SDK recusam HTTP simples, exceto no loopback (`localhost`, `127.0.0.1`, `[::1]`). O Docker precisa de um certificado confiável. O git envia a chave em cada solicitação. Consulte [HTTPS](../install/https).

**Mesmo armazenamento.** Uma camada de imagem, um objeto do Git LFS, um tarball do npm e um arquivo bruto são todos artefatos. Eles contam nas cotas do repositório e na capacidade da instalação. São verificados por SHA-256 quando armazenados. Entram nos backups.

**Gateways de leitura e espelhos.** Um gateway de leitura aceita somente `GET` e `HEAD`. Um espelho é uma cópia somente leitura de um repositório em outra instalação.

| Forma                   | Em um gateway de leitura                      | Em um espelho                                                 |
| ----------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| `/api/v1`, CLI, SDK     | Somente leitura                               | Leitura; as alterações são recusadas (`409 mirror_read_only`) |
| Registro de contêineres | Pull                                          | Pull; o push é recusado                                       |
| Git LFS                 | Sem suporte (a solicitação batch é um `POST`) | Clone e fetch; o push e os bloqueios são recusados            |
| Registro npm            | Instalação e busca                            | Instalação e busca; a publicação é recusada                   |
| Arquivos brutos         | `GET` e `HEAD`                                | `GET` e `HEAD`                                                |

Consulte [Gateways de leitura](../operate/read-gateways) e [Espelhos](../operate/mirrors).

## Páginas relacionadas {#related-pages}

- [Linha de comando (arkvoryctl)](./cli)
- [SDK TypeScript](./sdk)
- [Imagens de contêiner](./containers)
- [Git LFS](./git-lfs)
- [Pacotes Unity e npm](./unity-npm)
- [Arquivos brutos](./raw-files)
- [Webhooks](./webhooks)
- [Visão geral da API](../api/index) e [Erros](../api/errors)
