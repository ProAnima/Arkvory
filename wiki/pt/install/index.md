---
title: Escolher uma instalação
---

# Escolher uma instalação

O Arkvory é executado em um único servidor. Toda instalação tem as mesmas partes:

- **API**: a API HTTP e o console web.
- **Worker**: conclui uploads e executa tarefas em segundo plano.
- **Agente de backup**: faz backups agendados em um armazenamento de backups (vault).
- **PostgreSQL**: o banco de dados do catálogo.

O conteúdo dos arquivos fica em um disco local do servidor. Essa configuração não é um sistema de alta disponibilidade. Uma atualização ou uma falha do servidor causa uma breve interrupção, e os clientes retomam as transferências.

## Opções de instalação {#installation-options}

| Opção                                                                                           | Plataforma                                  | Inicia após uma reinicialização, sem login                                           | Banco de dados                                                   | Atualizações automáticas após a instalação                       | Recomendado para                                                            |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [Instalador gráfico](./windows) `Arkvory-Setup-x64.exe`                                         | Windows x64                                 | Sim (serviços do Windows)                                                            | PostgreSQL 18.4 incluído, gerenciado pelo Arkvory                | Desativadas                                                      | Servidores e estações de trabalho Windows, instalação sem acesso à internet |
| [Pacote Linux](./linux) `Arkvory-amd64.deb`, `Arkvory-x86_64.rpm`                               | Linux x64 com systemd                       | Sim (unidades systemd)                                                               | Cluster PostgreSQL dedicado da sua distribuição (versão 16 a 19) | Desativadas                                                      | Servidores Debian, Ubuntu e baseados em RPM                                 |
| Script, serviços nativos: `install.sh` ([Linux](./linux)), `install.ps1` ([Windows](./windows)) | Linux x64 ou arm64 com systemd, Windows x64 | Sim                                                                                  | Seu servidor PostgreSQL existente                                | Desativadas, ou ativadas com `--automatic` / `-AutomaticUpdates` | Automação, um servidor PostgreSQL existente, Linux arm64                    |
| [Docker Compose](./docker)                                                                      | Linux com Docker Engine                     | Sim, se o mecanismo de contêineres iniciar junto com o sistema                       | Contêiner PostgreSQL 18.4                                        | Desativadas, ou ativadas com `--automatic`                       | Hosts de contêineres                                                        |
| [Docker Desktop](./docker)                                                                      | Windows x64                                 | Não. Os contêineres só executam depois que o usuário entra e o Docker Desktop inicia | Contêiner PostgreSQL 18.4                                        | Desativadas, ou ativadas com `-AutomaticUpdates`                 | Avaliação em uma estação de trabalho                                        |

Todas as opções instalam a mesma API, o mesmo worker e o mesmo agente de backup. O HTTPS integrado está disponível somente para instalações nativas. Uma instalação com Compose precisa de um proxy reverso para o HTTPS. Consulte [HTTPS e proxy reverso](./https).

### Instalação remota por SSH {#remote-installation-over-ssh}

O **Arkvory Remote Setup** faz parte dos pacotes de cliente. Ele é executado no computador do administrador, conecta-se a um servidor por SSH e instala lá o pacote nativo para Linux ou Windows. Em seguida, cria a conta do proprietário e abre o console por um túnel SSH privado.

| Servidor    | Requisitos                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| Linux x64   | SSH e SFTP, systemd, `apt-get` ou `dnf`, root ou um usuário com `sudo -n` (sem solicitação de senha) |
| Windows x64 | OpenSSH Server com SFTP, Windows PowerShell, uma conta de administrador                              |

O túnel funciona somente enquanto o Remote Setup está em execução. Ele não publica o Arkvory para outros computadores. Não há suporte para `sudo` protegido por senha, agentes SSH, jump hosts nem servidores ARM.

## O que um release contém {#what-a-release-contains}

Os releases são publicados em [github.com/ProAnima/Arkvory/releases](https://github.com/ProAnima/Arkvory/releases).

| Arquivo                                                                                                                                   | Finalidade                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `Arkvory-Setup-x64.exe`                                                                                                                   | Instalador gráfico para Windows. Inclui o Node.js, o PostgreSQL, o WinSW e o runtime do Microsoft Visual C++              |
| `Arkvory-amd64.deb`, `Arkvory-x86_64.rpm`                                                                                                 | Pacotes Linux. Incluem o Node.js                                                                                          |
| `install.sh`, `install.ps1`                                                                                                               | Instaladores de linha de comando para serviços nativos ou para o Docker Compose                                           |
| `Arkvory-Linux.tar.gz`, `Arkvory-Windows.zip`                                                                                             | Kits de automação: o instalador de linha de comando e os arquivos do release, para instalar sem acesso ao GitHub Releases |
| `Arkvory-CLI-Setup-x64.exe`, `Arkvory-CLI-amd64.deb`, `Arkvory-CLI-x86_64.rpm`                                                            | Pacotes de cliente: o cliente de linha de comando `arkvoryctl` e o Arkvory Remote Setup                                   |
| `arkvoryctl.mjs`, `arkvory-remote.mjs`                                                                                                    | As mesmas ferramentas de cliente, como arquivos únicos para o Node.js 24                                                  |
| `arkvory-runtime.zip`, `arkvory-setup.mjs`, `arkvory-release.json`, `arkvory-release.json.sig`, `release-checksums.json`, `native-*.json` | Arquivos do programa, manifestos, somas de verificação e a assinatura. Os instaladores e o atualizador os leem            |

## Requisitos {#requirements}

| Item                             | Requisito                                                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows, instalador gráfico      | x64, build do Windows 10.0.17763 ou posterior (Windows 10 versão 1809, Windows Server 2019). Direitos de administrador                               |
| Windows, script                  | x64, Windows PowerShell. Direitos de administrador para serviços nativos                                                                             |
| Linux, pacotes                   | x64, systemd, glibc 2.28 ou posterior, Python 3. O gerenciador de pacotes instala o PostgreSQL 16 ou posterior                                       |
| Linux, script                    | x64 ou arm64, systemd para serviços nativos, glibc, Bash, curl, Python 3, tar e xz                                                                   |
| Docker Compose                   | Docker Engine com o plugin Compose, ou Docker Desktop no modo de contêineres Linux. O Podman com um provedor de compose compatível também é possível |
| PostgreSQL                       | Um banco de dados para cada instalação do Arkvory. Nunca conecte duas instalações ao mesmo banco de dados                                            |
| Armazenamento de arquivos        | Um sistema de arquivos local que aceite links físicos (hard links). Não use um compartilhamento de rede para o armazenamento de arquivos             |
| Armazenamento de backups (vault) | Um volume separado, montado antes de os serviços iniciarem. Consulte [Backups](../operate/backups)                                                   |

O Arkvory não define mínimos fixos de processador nem de memória. Planeje o espaço em disco para seus arquivos, o banco de dados e o armazenamento de backups. Por padrão, o Arkvory mantém 1 GiB de espaço livre no volume de armazenamento e aceita até 10 TiB de uploads reservados. Você pode alterar os dois limites. Consulte [Configuração](./configuration).

### Acesso à rede durante a instalação e as atualizações {#network-access-during-installation-and-updates}

O instalador gráfico funciona sem acesso à internet. As outras opções baixam arquivos por HTTPS:

| Host                                                         | Usado por                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `nodejs.org`                                                 | `install.sh` e `install.ps1` baixam o Node.js 24.21.0 e verificam o SHA-256 dele            |
| `api.github.com`, `github.com` e hosts de download do GitHub | Instaladores por script e atualizações, quando não é possível acessar o hub de atualizações |
| `hub.proanima.net`                                           | Verificações e downloads de atualizações. Consulte [Atualizações](./updates)                |
| Docker Hub                                                   | O Compose cria a imagem a partir de `node:24.21.0-bookworm-slim` e executa `postgres:18.4`  |

Sem acesso à internet, instale e atualize a partir de uma cópia local de um release. Consulte [Atualizações](./updates).

## Portas {#ports}

| Porta     | Serviço                                                         | Exposição padrão                                                                                                                                              |
| --------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8080/TCP  | API e console (HTTP, ou HTTPS com TLS integrado)                | Somente `127.0.0.1`. Uma instalação nativa pode escutar em outros endereços depois que você configura o HTTPS. O Compose sempre a publica em `127.0.0.1:8080` |
| 54329/TCP | PostgreSQL gerenciado do instalador gráfico e dos pacotes Linux | Somente `127.0.0.1`                                                                                                                                           |
| 5432/TCP  | Contêiner PostgreSQL de uma instalação Compose                  | Não publicada. Acessível somente dentro da rede do Compose                                                                                                    |

Abra somente a porta HTTPS para as redes de clientes. Nunca abra a porta do banco de dados.

## Diretório de instalação {#installation-directory}

A raiz da instalação é `C:\ProgramData\ProAnima\Arkvory` no Windows e `/opt/proanima-arkvory` no Linux. Use um diretório dedicado e vazio, fora dos diretórios pessoais e dos perfis de usuário.

| Caminho na raiz                  | Conteúdo                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `installation.json`              | Versão instalada, modo de instalação, configuração de atualização automática e fixação de versão |
| `journal.json`, `operation.lock` | Estado da última atualização e o bloqueio de uma operação em execução                            |
| `launcher.mjs`, `manage.mjs`     | O iniciador dos serviços e os comandos de gerenciamento                                          |
| `releases/<version>/`            | Código do programa de cada versão instalada. Os serviços não gravam aqui                         |
| `runtime/`                       | Node.js. O instalador gráfico também coloca aqui o PostgreSQL e o WinSW                          |
| `config/`                        | Configurações, chaves e a chave de recuperação. Consulte [Configuração](./configuration)         |
| `data/`                          | Armazenamento de arquivos de uma instalação nativa                                               |
| `database/`                      | Cluster PostgreSQL gerenciado. No Windows, também os logs dele                                   |
| `logs/`                          | Logs dos serviços do Windows e o log do atualizador do Windows                                   |
| `service/`                       | Wrappers dos serviços do Windows                                                                 |
| `updates/`                       | Solicitações de atualização feitas pelo console e o status do atualizador                        |

Uma instalação Compose guarda os dados nos volumes do Docker `proanima-arkvory_storage` (arquivos) e `proanima-arkvory_catalog` (banco de dados), e não em `data/`.

As versões antigas em `releases/` não são excluídas automaticamente. Depois de uma atualização bem-sucedida, você pode excluir as versões não usadas. Mantenha a versão atual e a versão anterior indicada em `journal.json`.

## Chave de recuperação {#recovery-key}

O instalador cria `config/bootstrap-token.txt`. Esse arquivo guarda a **chave de recuperação**: uma chave com direitos de administrador. Somente o root ou o grupo Administradores pode lê-lo.

- Use-a uma vez para criar a conta do primeiro proprietário, se o instalador não tiver criado uma. O console pede a chave na primeira inicialização.
- As ferramentas de instalação a leem no servidor: criação do proprietário, `arkvory configure --backup-vault`, a verificação de backup após uma atualização e o backup antes de uma alteração do esquema do banco de dados. **Não exclua este arquivo.**
- Não a copie para clientes, sistemas de CI nem scripts. Para o trabalho diário, crie contas de usuário e chaves de serviço com direitos limitados. Consulte [Contas e acesso](../use/accounts).

Para substituir a chave de recuperação, consulte [Configuração](./configuration).

## Próximos passos {#next-steps}

1. Instale com a página da sua plataforma: [Windows](./windows), [Linux](./linux) ou [Docker Compose](./docker).
2. Entre e publique um primeiro arquivo. Consulte [Início rápido](../guide/quick-start).
3. Configure o [HTTPS](./https) antes que os clientes se conectem de outros computadores.
4. Conecte um armazenamento de backups e faça um primeiro backup. Consulte [Backups](../operate/backups).
5. Escolha uma [política de atualização](./updates).
