---
title: Docker Compose
description: Execute o Arkvory como um projeto Docker Compose, com seus contêineres, volumes, portas, atualizações, agente de backup e remoção.
---

# Docker Compose

Uma instalação Compose executa a API, o worker, o agente de backup e o PostgreSQL como contêineres em um único host. O instalador cria a imagem do Arkvory a partir da versão e inicia o projeto `proanima-arkvory`. Use-a em hosts de contêiner. No Windows, o Docker Desktop serve apenas para avaliação: consulte [Windows com Docker Desktop](#docker-desktop).

O Compose não tem HTTPS integrado. Coloque um proxy reverso na frente dele antes que clientes se conectem de outros computadores: consulte [HTTPS e proxy reverso](./https).

## Requisitos {#requirements}

| Item                    | Requisito                                                                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Motor                   | Docker Engine com o plugin Compose (`docker compose`). Podman com um provedor compose compatível é possível com `--engine podman`, mas não é testado                                     |
| Conta                   | `root`, ou um usuário no grupo `docker`                                                                                                                                                  |
| Início na inicialização | O motor de contêineres deve iniciar na inicialização, ou o Arkvory não volta após uma reinicialização. Verifique com `systemctl is-enabled docker`                                       |
| Host                    | Uma instalação do Arkvory por host de contêiner. O nome do projeto e a porta são fixos                                                                                                   |
| Porta livre             | 8080 em `127.0.0.1`                                                                                                                                                                      |
| Contêineres             | Somente contêineres Linux. Contêineres Windows não são suportados                                                                                                                        |
| Internet                | `nodejs.org` (o instalador baixa o Node.js 24.21.0 e verifica seu SHA-256), o hub de atualizações ou o GitHub (a versão) e o Docker Hub (`node:24.21.0-bookworm-slim` e `postgres:18.4`) |

O instalador não instala nem altera o motor de contêineres, o hipervisor ou o WSL.

## O pacote {#bundle}

O instalador pega uma versão verificada e a descompacta em `releases/<version>/` na raiz da instalação. O arquivo Compose é `releases/<version>/deploy/compose.yml` e o arquivo de build é `releases/<version>/deploy/Dockerfile`. A imagem `proanima-arkvory:<version>` é criada no seu host a partir de `node:24.21.0-bookworm-slim`. Nada é baixado de um registro do Arkvory.

A raiz da instalação é `/opt/proanima-arkvory` no Linux. Seu layout é descrito em [Escolher uma instalação](./#installation-directory). Em uma instalação Compose, os dados não estão em `data/`: estão nos volumes descritos abaixo.

## Contêineres {#containers}

| Serviço       | Imagem                       | Função                                                                                                                      |
| ------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `database`    | `postgres:18.4`              | PostgreSQL. Informa prontidão com `pg_isready` a cada 5 segundos                                                            |
| `api`         | `proanima-arkvory:<version>` | API HTTP e console. Publicada em `127.0.0.1:8080`. Verificação de integridade a cada 10 segundos                            |
| `worker`      | `proanima-arkvory:<version>` | Conclui uploads e executa tarefas em segundo plano. Inicia depois que a API fica íntegra                                    |
| `backup`      | `proanima-arkvory:<version>` | Agente de backup. Lê o volume de armazenamento como somente leitura. Não publica porta                                      |
| `initialize`  | `proanima-arkvory:<version>` | Executado uma vez, como root: dá ao usuário 1000 a propriedade do volume de armazenamento                                   |
| `migrate`     | `proanima-arkvory:<version>` | Executado uma vez: executa as migrações do banco de dados                                                                   |
| `vault-owner` | `proanima-arkvory:<version>` | Executado uma vez, somente com o perfil `maintenance`: dá ao usuário 1000 a propriedade do armazenamento de backups (vault) |

Os serviços de longa duração reiniciam a menos que você os pare. Os contêineres do Arkvory são executados como o usuário `node` (usuário 1000) da imagem, com um sistema de arquivos raiz somente leitura, um `/tmp` de 64 MiB na memória, todas as capacidades removidas, `no-new-privileges` e 120 segundos para parar. O Docker mantém até cinco arquivos de log JSON de 20 MiB para cada contêiner.

## Volumes e montagens de vínculo {#volumes}

### Volumes do Docker {#docker-volumes}

| Volume                     | Montado em                          | Conteúdo                                                                                      |
| -------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `proanima-arkvory_storage` | `/var/lib/arkvory`                  | Conteúdo dos arquivos e preparação de upload. O agente de backup o monta como somente leitura |
| `proanima-arkvory_catalog` | `/var/lib/postgresql` em `database` | Os dados do PostgreSQL                                                                        |

Os volumes sobrevivem a atualizações e a `docker compose down`. Somente `down --volumes` os exclui.

### Montagens de vínculo a partir da raiz da instalação {#bind-mounts}

| Caminho no host                    | No contêiner                    | Modo              | Montado em                                                         |
| ---------------------------------- | ------------------------------- | ----------------- | ------------------------------------------------------------------ |
| `config/runtime.json`              | `/run/arkvory/runtime.json`     | somente leitura   | api, worker, backup                                                |
| `config/keys.json`                 | `/run/arkvory/keys.json`        | somente leitura   | api, worker                                                        |
| `config/health-token.txt`          | `/run/arkvory/health-token.txt` | somente leitura   | api, worker                                                        |
| `config/postgres.env`              | arquivo de ambiente             |                   | database                                                           |
| `updates/status`                   | `/run/arkvory-updates/status`   | somente leitura   | api, worker                                                        |
| `updates/inbox`                    | `/run/arkvory-updates/inbox`    | leitura e escrita | api, worker                                                        |
| o armazenamento de backups (vault) | `/srv/arkvory-vault`            | leitura e escrita | backup, `vault-owner` (somente enquanto um vault está configurado) |
| `config/mirrors`                   | `/run/arkvory/mirrors`          | somente leitura   | api, worker (somente enquanto um repositório é espelhado)          |

### Proprietários e modos {#owners}

| Caminho                                                | Proprietário e modo          | Por quê                                                                                                                                              |
| ------------------------------------------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| A raiz da instalação                                   | O usuário instalador, `0700` | A raiz contém a chave de recuperação e a senha do banco de dados. Somente o usuário instalador pode entrar nela                                      |
| `config/runtime.json`, `keys.json`, `health-token.txt` | `0644`                       | O usuário 1000 no contêiner deve lê-los. `runtime.json` contém a senha do banco de dados; a raiz `0700` mantém outros usuários longe desses arquivos |
| `updates/inbox`                                        | `0777`                       | O único diretório em que o contêiner escreve no host. O usuário do contêiner e o atualizador do host podem ter IDs de usuário diferentes             |
| `updates/status`                                       | `0755`                       | Gravado pelo atualizador do host; o contêiner apenas o lê                                                                                            |
| Volume de armazenamento                                | Usuário 1000                 | `initialize` o define na instalação e na atualização                                                                                                 |
| Armazenamento de backups (vault)                       | Usuário 1000                 | `vault-owner` o define quando você conecta o vault. O vault passa a pertencer ao usuário do host com ID 1000                                         |

## Portas {#ports}

| Porta    | Serviço       | Exposição                                                  |
| -------- | ------------- | ---------------------------------------------------------- |
| 8080/TCP | API e console | `127.0.0.1:8080` no host. O endereço é fixo                |
| 5432/TCP | PostgreSQL    | Não publicada. Acessível somente dentro da rede do Compose |

O arquivo Compose pertence ao diretório da versão, que as atualizações substituem, então você não pode alterar o endereço publicado nele. Para alcançar o console de outros computadores, instale um proxy reverso no host que encaminhe para `127.0.0.1:8080`.

## Ambiente {#environment}

O arquivo Compose não define configurações do Arkvory. Os serviços leem `/run/arkvory/runtime.json`, que é `config/runtime.json` no host. O instalador grava estes valores e você não deve alterá-los: `ARKVORY_HOST` (`0.0.0.0` dentro do contêiner), `ARKVORY_PORT` (`8080`), `ARKVORY_DATABASE_URL` (o contêiner `database` com uma senha gerada), `ARKVORY_DATA_DIR` (`/var/lib/arkvory`), `ARKVORY_KEYS_FILE` e `ARKVORY_UPDATE_CONTROL_DIR`.

Você pode adicionar outras configurações, como `ARKVORY_TRUSTED_PROXIES`, os limites ou `ARKVORY_LOG_LEVEL`. Adicione-as a `config/runtime.json` e, em seguida, pare e inicie os serviços conforme mostrado em [Gerenciar o projeto](#manage). A lista completa está em [Variáveis de ambiente](../reference/environment). `config/compose.env` contém `ARKVORY_IMAGE`. O instalador o mantém; não o edite.

## Instalar no Linux {#install}

1. Baixe `install.sh` em [GitHub Releases](https://github.com/ProAnima/Arkvory/releases) e leia-o.
2. Execute-o como `root`:

   ```bash
   sudo bash ./install.sh --mode compose
   ```

   Adicione `--automatic` para ativar atualizações automáticas, ou `--engine podman` para Podman. Com `ARKVORY_RELEASE_VERSION=1.2.3`, o script instala essa versão estável. Sem acesso à internet ao GitHub, descompacte `Arkvory-Linux.tar.gz` e execute `sudo env ARKVORY_ARTIFACT_DIR="$PWD" bash ./install.sh --mode compose` no diretório descompactado. O Node.js ainda é baixado.

3. Aguarde o instalador terminar. Ele verifica e descompacta a versão, cria a imagem, inicia o banco de dados, executa `initialize` e `migrate`, inicia a API e o worker, espera até que a API informe prontidão três vezes seguidas, inicia o agente de backup e registra o temporizador de atualizações.

Um usuário no grupo `docker` pode instalar sem `root` em um diretório que o usuário possui:

```bash
ARKVORY_INSTALL_ROOT="$HOME/arkvory" bash ./install.sh --mode compose
```

Nesse caso, o instalador não registra nenhum temporizador de atualizações. O console não pode solicitar atualizações até que você agende o atualizador por conta própria. Consulte [Atualizações no Compose](#updates-compose).

## Primeira inicialização e primeiros passos {#first-start}

1. Verifique se os contêineres estão em execução. Consulte [Gerenciar o projeto](#manage) para o comando `compose`.

   ```bash
   "${compose[@]}" ps
   ```

2. Leia a chave de recuperação:

   ```bash
   sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
   ```

3. Abra `http://127.0.0.1:8080/console/#onboarding` no servidor. Do seu próprio computador, encaminhe a porta: `ssh -L 8080:127.0.0.1:8080 admin@arkvory.example`.
4. No console, abra [[ui:navStart]] e expanda [[ui:welcomeOwner]]. Cole a chave em [[ui:welcomeRecovery]], informe o nome do proprietário e uma senha de pelo menos 12 caracteres e selecione [[ui:welcomeCreate]].

Mantenha a chave de recuperação no servidor. Consulte [Segurança](../operate/security).

## Gerenciar o projeto {#manage}

Abra um shell de root (`sudo -i`) e defina o comando `compose` uma vez. O Compose precisa do nome do projeto, do diretório do projeto, do arquivo de ambiente e de todos os arquivos Compose da instalação:

```bash
root=/opt/proanima-arkvory
node="$root/runtime/node-v24.21.0-linux-x64/bin/node"   # linux-arm64 on arm64
version=$("$node" -p "require('$root/installation.json').current.version")
compose=(docker compose --project-name proanima-arkvory --project-directory "$root"
  --env-file "$root/config/compose.env" -f "$root/releases/$version/deploy/compose.yml")
for file in compose.vault.yml compose.mirrors.yml; do
  if [[ -f "$root/config/$file" ]]; then compose+=(-f "$root/config/$file"); fi
done
```

Se você omitir um arquivo que existe, `up` recria o contêiner sem a montagem do vault ou do espelho.

| Tarefa                 | Comando                                                                           |
| ---------------------- | --------------------------------------------------------------------------------- |
| Mostrar os contêineres | `"${compose[@]}" ps`                                                              |
| Ler os logs            | `"${compose[@]}" logs --tail 100 api worker backup`                               |
| Parar o Arkvory        | `"${compose[@]}" stop --timeout 120 backup worker api`                            |
| Iniciar o Arkvory      | `"${compose[@]}" up -d --wait api worker` e depois `"${compose[@]}" up -d backup` |

Parar com `stop` mantém um contêiner parado após uma reinicialização do motor. Inicie-o novamente com `up -d`.

Os comandos de ciclo de vida são executados com o Node.js que o instalador colocou na raiz:

```bash
sudo "$node" "$root/manage.mjs" status --root "$root"
```

`arkvory` não é instalado em um host Compose, então chame `manage.mjs` para `status`, `update` e `configure`. Os comandos são descritos em [Configuração](./configuration).

## Logs {#logs}

Os contêineres gravam nos arquivos de log JSON do Docker. Leia-os com `"${compose[@]}" logs`. A API e o worker gravam um registro JSON por linha. Consulte [Monitoramento](../operate/monitoring). Os comandos de ciclo de vida imprimem suas mensagens no terminal, e o temporizador de atualizações grava no journal: `journalctl -u arkvory-update`.

## Atualizações no Compose {#updates-compose}

Atualize com o console, a janela de atualização automática ou o comando:

```bash
sudo "$node" "$root/manage.mjs" update --root "$root"
```

A atualização baixa e verifica a versão, cria a nova imagem e então para `backup`, `worker` e `api` e os inicia com a nova imagem. O contêiner `database` continua em execução. Os volumes permanecem como estão. Uma versão que altera o esquema do banco de dados é instalada somente após um backup verificado. Consulte [Atualizações](./updates).

O atualizador do host é executado uma vez por minuto. Instalado como `root` em um host systemd, o instalador o registra como `arkvory-update.timer`. Sem `root`, o instalador imprime um aviso. Agende este comando a cada minuto como o usuário que possui a instalação e tem acesso ao motor de contêineres, por exemplo com cron:

```text
* * * * * /home/admin/arkvory/runtime/node-v24.21.0-linux-x64/bin/node /home/admin/arkvory/manage.mjs updates-poll --root /home/admin/arkvory
```

Nunca dê o socket do Docker aos contêineres do Arkvory.

## Agente de backup no Compose {#backup-agent}

O contêiner `backup` é executado desde o início. Sem um vault, ele é executado e informa que nenhum vault está configurado. O vault é um diretório do host, fora da raiz da instalação, em um volume separado.

1. Monte o volume do vault e crie um diretório vazio, por exemplo `/mnt/backup/arkvory`. O diretório deve existir: o Compose não o cria.
2. Conecte-o:

   ```bash
   sudo "$node" "$root/manage.mjs" configure --root "$root" --backup-vault /mnt/backup/arkvory --init-vault
   ```

   O comando verifica o diretório, grava `config/compose.vault.yml`, dá ao usuário 1000 a propriedade do diretório, cria o vault em um diretório vazio (`--init-vault`) e reinicia apenas o contêiner de backup. Ele tem êxito quando o agente informa que o vault está disponível. Caso contrário, restaura a configuração anterior.

3. Para desconectar o vault, execute o mesmo comando com `--backup-vault-off`. O vault em si não é tocado.

Agendamentos, retenção e restaurações são descritos em [Backups](../operate/backups).

## Remover {#remove}

```bash
"${compose[@]}" down              # removes the containers, keeps the volumes
"${compose[@]}" down --volumes    # also deletes the catalog and all stored files
```

`down --volumes` exclui todos os dados. Nunca o execute em uma instalação que contém arquivos. Faça um backup primeiro e mantenha o vault.

Após `down`, você pode remover o que resta:

```bash
sudo systemctl disable --now arkvory-update.timer
sudo rm -f /etc/systemd/system/arkvory-update.service /etc/systemd/system/arkvory-update.timer
sudo systemctl daemon-reload
docker image rm "proanima-arkvory:$version"
sudo rm -rf /opt/proanima-arkvory
```

Exclua a raiz somente depois de não precisar mais da configuração e da chave de recuperação. As imagens de versões anteriores permanecem no host até que você as remova.

## Windows com Docker Desktop {#docker-desktop}

Use o Docker Desktop para avaliação apenas em uma estação de trabalho. O Docker Desktop é um aplicativo de um usuário: os contêineres são executados somente enquanto esse usuário está conectado e o Docker Desktop está em execução. Após uma reinicialização do computador, o Arkvory fica indisponível até então. Ative **Settings > General > Start Docker Desktop when you sign in**. O instalador e o comando `status` avisam quando essa configuração está desativada. Para um servidor, use os [serviços do Windows](./windows).

1. Inicie o Docker Desktop no modo de contêineres Linux.
2. Baixe `install.ps1` da versão e leia-o.
3. Abra o Windows PowerShell como o usuário que executa o Docker Desktop, **sem** direitos de administrador, e execute:

   ```powershell
   .\install.ps1 -Mode compose
   ```

   Os parâmetros `-Root`, `-Version`, `-Engine`, `-Artifact`, `-AutomaticUpdates` e `-Pin` são descritos em [Windows](./windows#install-with-powershell-and-an-existing-postgresql). Informe `-Root` e `-Artifact` como caminhos absolutos.

4. Abra `http://127.0.0.1:8080/console/#onboarding`, leia a chave de recuperação em `C:\ProgramData\ProAnima\Arkvory\config\bootstrap-token.txt` e crie o proprietário conforme descrito em [Primeira inicialização e primeiros passos](#first-start).

A raiz da instalação `C:\ProgramData\ProAnima\Arkvory` concede acesso a SYSTEM, Administradores e ao usuário instalador, sem herança, porque o Docker Desktop lê as montagens de vínculo com o token desse usuário. Não execute o instalador elevado para o Compose.

O instalador registra a tarefa de atualização `ProAnimaArkvoryUpdate` somente quando é executado como administrador. Essa tarefa serve para um motor de todo o sistema, não para o Docker Desktop. Para o Docker Desktop, registre a tarefa como o usuário do Docker Desktop. Ela funciona somente enquanto esse usuário está conectado e o Docker Desktop está em execução:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
$node = "$root\runtime\node-v24.21.0-win-x64\node.exe"
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$root\manage.mjs`" updates-poll --root `"$root`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Action $action -Trigger $trigger -Settings $settings
```

Gerencie o projeto no PowerShell com os mesmos argumentos:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
$version = (Get-Content "$root\installation.json" -Raw | ConvertFrom-Json).current.version
$compose = @('compose', '--project-name', 'proanima-arkvory', '--project-directory', $root,
  '--env-file', "$root\config\compose.env", '-f', "$root\releases\$version\deploy\compose.yml")
foreach ($file in 'compose.vault.yml', 'compose.mirrors.yml') {
  if (Test-Path "$root\config\$file") { $compose += @('-f', "$root\config\$file") }
}
docker @compose ps
& "$root\runtime\node-v24.21.0-win-x64\node.exe" "$root\manage.mjs" status --root $root
```

Um armazenamento de backups (vault) no Windows deve ser um volume local ou iSCSI. Caminhos UNC e SMB são recusados. Para remover a instalação, execute `docker @compose down --volumes`, cancele o registro da tarefa com `Unregister-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Confirm:$false` e exclua a raiz. Faça um backup primeiro.
