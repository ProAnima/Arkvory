---
title: Windows
---

# Windows

Há três maneiras de executar o Arkvory no Windows:

- **Instalador gráfico** `Arkvory-Setup-x64.exe`. Recomendado. Instala serviços do Windows e um banco de dados PostgreSQL dedicado. Não precisa de acesso à internet.
- **Script do PowerShell** `install.ps1`. Instala os mesmos serviços do Windows, mas usa o seu servidor PostgreSQL existente.
- **Docker Desktop** com `install.ps1 -Mode compose`. Somente para avaliação. Consulte [Docker Compose](./docker).

## Requisitos {#requirements}

- Windows x64, build 10.0.17763 ou posterior (Windows 10 versão 1809, Windows Server 2019 ou posterior).
- Uma conta no grupo Administradores.
- Um volume NTFS local para os dados. Compartilhamentos de rede não são aceitos para o armazenamento de arquivos.
- Um diretório de instalação fora dos perfis de usuário e do `AppData`. A conta do serviço precisa conseguir ler todos os diretórios pais.

## Instalar com o instalador gráfico {#install-with-the-graphical-installer}

1. Baixe `Arkvory-Setup-x64.exe` do [GitHub Releases](https://github.com/ProAnima/Arkvory/releases).
2. Execute o arquivo e confirme a solicitação do Controle de Conta de Usuário.
3. Selecione inglês ou russo e aceite a licença.
4. Informe a conta do proprietário. O nome tem de 3 a 64 caracteres: letras latinas, dígitos, ponto, hífen ou sublinhado. A senha tem de 12 a 128 caracteres.
5. Aguarde enquanto o instalador prepara o banco de dados, os serviços e a conta do proprietário.
6. Na última página, mantenha marcada a opção **Open Arkvory and finish onboarding** e clique em **Finish**. O console abre em `http://127.0.0.1:8080/console/#onboarding`.

O instalador também cria dois atalhos no menu Iniciar: **Arkvory** (o console) e **API and CLI** (a página de ajuda do console).

Se o instalador informar que o runtime da Microsoft exige uma reinicialização, reinicie o Windows e execute o instalador novamente. Os dados existentes do Arkvory são mantidos.

As atualizações automáticas ficam desativadas após a instalação. Para ativá-las, consulte [Atualizações](./updates).

### Instalação silenciosa {#silent-installation}

Para uma implantação automatizada, coloque a conta do proprietário em um arquivo JSON. Proteja o arquivo de modo que somente o SYSTEM e os Administradores possam lê-lo.

```json
{ "name": "admin", "password": "<pelo menos 12 caracteres>" }
```

```powershell
.\Arkvory-Setup-x64.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /OWNERFILE="C:\secure\owner.json"
```

O instalador exclui o arquivo do proprietário depois de criar a conta. Nunca passe uma senha como argumento de comando. Sem `/OWNERFILE`, crie o proprietário depois, no console, com a chave de recuperação. O instalador termina com um código diferente de zero quando a configuração não é concluída. Não execute o instalador enquanto uma atualização está em andamento.

## O que o instalador gráfico cria {#what-the-graphical-installer-creates}

| Item                       | Local ou valor                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------- |
| Arquivos do programa       | `C:\Program Files\ProAnima\Arkvory`                                                |
| Dados, configuração e logs | `C:\ProgramData\ProAnima\Arkvory` (a raiz da instalação)                           |
| Banco de dados             | PostgreSQL 18.4 em `database\` da raiz, em `127.0.0.1:54329`                       |
| Console                    | `http://127.0.0.1:8080/console/`                                                   |
| Chave de recuperação       | `config\bootstrap-token.txt` na raiz                                               |
| Tarefa de atualização      | `ProAnimaArkvoryUpdate` no Agendador de Tarefas. Executa a cada minuto como SYSTEM |

### Serviços {#services}

| Nome do serviço   | Nome para exibição        | Conta                         | Tipo de inicialização        |
| ----------------- | ------------------------- | ----------------------------- | ---------------------------- |
| `Arkvoryapi`      | ProAnima Arkvory api      | `NT AUTHORITY\LocalService`   | Automático (Início Atrasado) |
| `Arkvoryworker`   | ProAnima Arkvory worker   | `NT AUTHORITY\LocalService`   | Automático (Início Atrasado) |
| `Arkvorybackup`   | ProAnima Arkvory backup   | `NT AUTHORITY\LocalService`   | Automático (Início Atrasado) |
| `Arkvorydatabase` | ProAnima Arkvory database | `NT AUTHORITY\NetworkService` | Automático                   |

Os serviços são executados sem nenhum usuário conectado. A API, o worker e o agente de backup compartilham a conta LocalService. O banco de dados é executado sob a conta NetworkService, então a conta da API não consegue ler os arquivos do banco de dados.

A raiz concede controle total somente ao SYSTEM e aos Administradores. O LocalService pode ler a raiz e só pode alterar `data\`, `logs\` e a caixa de entrada de atualizações. A chave de recuperação e os outros arquivos de credenciais do instalador podem ser lidos somente pelo SYSTEM e pelos Administradores.

## Instalar com o PowerShell e um PostgreSQL existente {#install-with-powershell-and-an-existing-postgresql}

Use este método se a sua organização já executa um PostgreSQL. Ele não cria um serviço de banco de dados gerenciado nem uma entrada em **Aplicativos**.

1. Peça ao administrador do seu banco de dados um banco vazio e uma role proprietária dele. O Arkvory executa as migrações com essa role.
2. Baixe `install.ps1` do release e revise o script.
3. Abra o Windows PowerShell **como administrador** e execute:

```powershell
.\install.ps1 -AutomaticUpdates
```

O script pede a URL de conexão do PostgreSQL. A entrada fica oculta. Em seguida, ele baixa o Node.js 24.21.0 de `nodejs.org`, verifica o SHA-256 e instala a versão estável mais recente.

Em vez de digitar no prompt, você pode passar um arquivo JSON protegido:

```json
{ "ARKVORY_DATABASE_URL": "postgresql://arkvory:<senha>@db.example:5432/arkvory" }
```

```powershell
.\install.ps1 -Config C:\secure\arkvory.json
```

Se o PowerShell bloquear scripts, execute `powershell -ExecutionPolicy Bypass -File .\install.ps1`. Isso altera a política somente para este processo.

| Parâmetro                    | Significado                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `-Root <path>`               | Raiz da instalação. Padrão: `C:\ProgramData\ProAnima\Arkvory`                 |
| `-Version <x.y.z>`           | Instala esta versão estável em vez da mais recente                            |
| `-Mode windows` ou `compose` | Serviços do Windows (padrão) ou [Docker Compose](./docker)                    |
| `-Engine docker` ou `podman` | Mecanismo de contêineres para o Compose                                       |
| `-Config <file>`             | Arquivo JSON com configurações `ARKVORY_*`, incluindo a URL do banco de dados |
| `-Artifact <directory>`      | Instala a partir de um `Arkvory-Windows.zip` extraído, em vez do GitHub       |
| `-AutomaticUpdates`          | Ativa as atualizações automáticas                                             |
| `-Pin`                       | Fixa a versão instalada                                                       |

Informe `-Root`, `-Config` e `-Artifact` como caminhos absolutos, por exemplo `-Artifact $PWD.Path`.

O script não cria uma conta de proprietário. Abra `http://127.0.0.1:8080/console/` no servidor, selecione **[[ui:welcomeOwner]]** e informe a chave de recuperação de `config\bootstrap-token.txt`.

## Gerenciar os serviços {#manage-the-services}

```powershell
Get-Service Arkvoryapi, Arkvoryworker, Arkvorybackup, Arkvorydatabase
Restart-Service Arkvoryapi, Arkvoryworker
sc.exe qfailure Arkvoryapi
```

O comando de gerenciamento precisa de um PowerShell elevado e sempre da opção `--root`:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
# Instalador gráfico
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' status --root $root
# Instalação por script
& "$root\runtime\node-v24.21.0-win-x64\node.exe" "$root\manage.mjs" status --root $root
```

Execute `arkvory.ps1 help` para ver todos os comandos. Os comandos são descritos em [Configuração](./configuration) e [Atualizações](./updates).

## Recuperação após uma falha {#recovery-after-a-failure}

- Quando o processo de um serviço para sem que ninguém peça, o Windows o inicia de novo após 10 segundos. A contagem de falhas é zerada após uma hora.
- Um processo cuja thread principal fica travada por 60 segundos se encerra sozinho, e o Windows o inicia de novo. Consulte [Autorrecuperação](../operate/self-healing).
- Uma verificação de prontidão que falha, por si só, não reinicia um serviço (por exemplo, enquanto o servidor conclui as solicitações em andamento antes de parar). Mas, quando o banco de dados deixa de responder, a API e o worker não conseguem confirmar que têm a posse do armazenamento: após cerca de 8 segundos, eles se encerram sozinhos, e o Windows os inicia de novo a cada 10 segundos até que o banco de dados volte.
- Um serviço que você mesmo para continua parado até você iniciá-lo ou até o Windows reiniciar.

Executar o instalador gráfico novamente restaura o tipo de inicialização e as ações de recuperação dos serviços.

## Logs {#logs}

| Local na raiz      | Conteúdo                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `logs\`            | Saída da API, do worker e do agente de backup. Os arquivos são rotacionados ao atingir 20 MiB; 5 arquivos antigos são mantidos |
| `logs\updater.log` | Saída da tarefa de atualização, com a mesma rotação                                                                            |
| `database\`        | Logs do serviço de banco de dados (`arkvory-database*.log`)                                                                    |
| `bootstrap.log`    | Saída da etapa de configuração do instalador gráfico                                                                           |

O instalador também grava o próprio log na pasta temporária do usuário que o executou. A API e o worker gravam um registro JSON por linha. Consulte [Monitoramento](../operate/monitoring).

## Desinstalar {#uninstall}

Abra **Configurações > Aplicativos**, selecione **ProAnima Arkvory** e clique em **Desinstalar**. O desinstalador:

1. Remove a tarefa `ProAnimaArkvoryUpdate`.
2. Para e remove `Arkvorybackup`, `Arkvoryworker`, `Arkvoryapi` e `Arkvorydatabase`.
3. Remove os arquivos do programa.

Ele **mantém** de propósito `C:\ProgramData\ProAnima\Arkvory`: o banco de dados, todos os arquivos, a configuração e a chave de recuperação. Nunca mexe no armazenamento de backups. Se você executar depois o instalador da mesma versão ou de uma mais recente, ele continua com os dados mantidos. Para remover os dados, faça um backup primeiro e depois exclua a pasta você mesmo.

Uma instalação por script não tem desinstalador. Para remover os serviços dela, execute em um PowerShell elevado:

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
Unregister-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Confirm:$false
foreach ($role in 'backup', 'worker', 'api') {
  $exe = "$root\service\arkvory-$role.exe"
  if ((Get-Service "Arkvory$role").Status -ne 'Stopped') { & $exe stopwait }
  & $exe uninstall
}
```

## Docker Desktop {#docker-desktop}

O Docker Desktop é um aplicativo de um único usuário. Os contêineres dele só são executados depois que esse usuário entra e o Docker Desktop inicia. Depois de uma reinicialização do computador, o Arkvory fica indisponível até lá. Se você instalar com o Docker Desktop, ative **Settings > General > Start Docker Desktop when you sign in**. O instalador e o comando `status` avisam quando essa configuração está desativada. Para um servidor que precisa iniciar sem login, use os serviços nativos descritos nesta página.

## Solução de problemas {#troubleshooting}

| Problema                                                                   | O que fazer                                                                                                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O instalador informa que a configuração não foi concluída                  | Leia `bootstrap.log`, o log do instalador e os logs do banco de dados. Não exclua a pasta do banco de dados                                             |
| `database\bootstrap-started` existe, mas `database\initialized` não existe | A criação do banco de dados foi interrompida. Não exclua o cluster e não repita o SQL manualmente. Corrija a causa e execute o comando `finish-install` |
| `Run installer as Administrator`                                           | Inicie o PowerShell com **Executar como administrador**                                                                                                 |
| `Use a dedicated directory`                                                | A raiz já contém arquivos. Use um diretório vazio. Gerencie uma instalação existente com os comandos dela                                               |
| `Node.js runtime is incomplete after extraction`                           | Verifique a quarentena do seu antivírus                                                                                                                 |
| `Another installation owns this service`                                   | Já existem serviços de uma instalação em outra raiz. Remova-os primeiro                                                                                 |

Para concluir uma instalação interrompida sem excluir dados:

```powershell
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' finish-install --root C:\ProgramData\ProAnima\Arkvory
```

Há mais dicas em [Solução de problemas](../operate/troubleshooting).
