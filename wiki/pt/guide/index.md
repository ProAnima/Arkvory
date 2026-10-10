---
title: Visão geral
description: 'O ProAnima Arkvory é um repositório próprio para artefatos de build e arquivos: o que ele armazena, o que ele faz e como funciona.'
---

# Visão geral

O ProAnima Arkvory é um repositório auto-hospedado para artefatos de build e arquivos. Você o instala em seu próprio servidor. Ele armazena os arquivos que seus builds produzem e os entrega às pessoas e aos sistemas que precisam deles: agentes de implantação, pipelines de CI/CD, máquinas de teste e desenvolvedores.

O Arkvory é gratuito para todos, inclusive para empresas. O código-fonte está aberto para leitura, mas o produto não é open source. Você pode usá-lo e alterá-lo dentro da sua organização. Você não pode distribuir cópias, vendê-lo nem oferecê-lo como serviço. Consulte a [licença](https://github.com/ProAnima/Arkvory/blob/main/LICENSE.md).

## Para quem é {#who-it-is-for}

- **Engenheiros de CI/CD** que precisam de um único lugar para publicar builds, encontrar um build por versão ou estágio e baixá-lo em um job de implantação.
- **Administradores** que querem um serviço de armazenamento que roda em um único servidor, reinicia sozinho, faz os próprios backups e se atualiza sozinho.
- **Estúdios de jogos** que trabalham com Unity ou Unreal Engine. O Arkvory armazena assets binários grandes por meio do Git LFS, pacotes Unity por meio de um registro npm e saídas de build de dezenas de gigabytes.
- **Equipes com vários sites** que querem uma cópia somente leitura de um repositório perto de quem faz os downloads.

## O que ele armazena {#what-it-stores}

Tudo fica em **repositórios**. Um repositório pode guardar vários tipos de conteúdo ao mesmo tempo:

| Conteúdo                     | Como você trabalha com ele                                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Artefatos (qualquer arquivo) | Upload pelo console, pelo [cliente de linha de comando](../protocols/cli), pelo [SDK](../protocols/sdk) ou pela API HTTP                                                      |
| Pacotes UPack                | Pacotes versionados com grupo, nome e versão SemVer. Consulte [Pacotes](../use/packages).                                                                                     |
| Arquivos por caminho         | Um caminho como `builds/game/1.4/Setup.exe` que mantém todas as versões anteriores. Consulte [Arquivos e caminhos](../use/files) e [Arquivos brutos](../protocols/raw-files). |
| Imagens de contêiner         | Um registro OCI para Docker, Podman, Helm e ORAS. Consulte [Imagens de contêiner](../protocols/containers).                                                                   |
| Objetos do Git LFS           | Um servidor Git LFS com bloqueio de arquivos. Consulte [Git LFS](../protocols/git-lfs).                                                                                       |
| Pacotes npm e Unity          | Um registro npm que o Unity Package Manager pode usar. Consulte [Unity e npm](../protocols/unity-npm).                                                                        |

Cada arquivo armazenado é um **artefato** imutável com uma soma de verificação SHA-256. Conteúdo novo nunca substitui bytes antigos; ele cria um novo artefato. Consulte [Conceitos](./concepts).

## Principais recursos {#main-capabilities}

- **Arquivos grandes.** Os uploads são enviados em partes e podem continuar depois de uma falha de rede ou de uma reinicialização. Um objeto pode ter até cerca de 10 TiB. Os downloads aceitam faixas de bytes HTTP (ranges), então também podem continuar.
- **Controle de acesso.** Contas de usuário, grupos, tokens de acesso pessoal e contas de serviço com chaves. Cada chave recebe somente as ações de repositório de que precisa.
- **Estágios e promoção.** Marque um build como `qa`, `release` ou `prod`, ou publique-o em outro repositório sem um novo upload. Um agente de implantação pode pedir "o build `release` mais recente no intervalo `^1.4`".
- **Metadados.** Rótulos, metadados em texto, coleções e arquivos anexados, como manifestos, SBOMs e assinaturas.
- **Retenção.** Mantenha os últimos N builds de cada pacote, defina cotas e remova conteúdo antigo em segundo plano.
- **Backups.** Um agente de backup copia o banco de dados e todo o conteúdo para um armazenamento de backups (vault) em outro disco ou NAS, em um horário diário, e verifica as cópias.
- **Espelhos.** Uma segunda instalação pode manter uma cópia somente leitura de um repositório e servi-la quando o servidor principal não está disponível.
- **Gateways de leitura.** Processos de download extras no mesmo armazenamento compartilhado dividem um único limite de taxa de download.
- **Autorrecuperação.** Os serviços reiniciam depois de uma falha ou de um travamento. Transferências longas podem continuar após a reinicialização.
- **Atualizações.** O servidor procura versões estáveis assinadas que a ProAnimaStudio aprova no hub dela. A instalação é manual ou automática, na hora de manutenção, e é possível voltar à versão anterior.
- **Console web.** Temas claro e escuro, em onze idiomas: inglês, russo, espanhol, francês, alemão, português, chinês, japonês, coreano, hindi e árabe (da direita para a esquerda). Esta documentação está nos mesmos idiomas. Consulte [O console web](./console).

## Como ele funciona {#how-it-runs}

O Arkvory é executado em um único servidor. Ele usa o PostgreSQL para o catálogo e um diretório local para o conteúdo. Três serviços trabalham juntos:

| Serviço          | Finalidade                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| API              | O servidor HTTP: a API, o console e os registros. Também executa a retenção e a limpeza física. |
| Worker           | Tarefas em segundo plano: conclusão de uploads grandes e sincronização de espelhos              |
| Agente de backup | Backups agendados no armazenamento de backups                                                   |

Você pode instalá-lo de três maneiras:

| Plataforma                    | Instalador                                | Detalhes                                                                                                                                                                               |
| ----------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows 10/11, Windows Server | `Arkvory-Setup-x64.exe`                   | Um assistente de instalação. Inclui o Node.js e o PostgreSQL e funciona sem internet. Os serviços são executados sem nenhum usuário conectado. Consulte [Windows](../install/windows). |
| Linux                         | `Arkvory-amd64.deb`, `Arkvory-x86_64.rpm` | Pacotes para apt e dnf, com serviços systemd. Consulte [Linux](../install/linux).                                                                                                      |
| Docker                        | Docker Compose                            | A API, o worker, o agente de backup e o PostgreSQL em contêineres. Consulte [Docker](../install/docker).                                                                               |

Por padrão, o servidor escuta somente em `127.0.0.1:8080`. Antes de outras máquinas se conectarem, configure o [HTTPS](../install/https).

Uma instalação é um único servidor: se ele parar, os clientes esperam até que volte. No Linux, um [cluster de alta disponibilidade](../operate/cluster) de dois ou três servidores assume o lugar quando um deles falha. Use [backups](../operate/backups) e, se necessário, [espelhos](../operate/mirrors) em um segundo site.

## Para onde ir em seguida {#where-to-go-next}

1. [Início rápido](./quick-start): instale o Arkvory e envie seu primeiro arquivo.
2. [Conceitos](./concepts): as palavras que o restante da documentação usa.
3. [Instalação](../install/index): requisitos e opções para cada plataforma.
4. [Cliente de linha de comando](../protocols/cli): use o Arkvory em scripts e no CI.
5. [Backups](../operate/backups): proteja seus dados antes de ir para a produção.
