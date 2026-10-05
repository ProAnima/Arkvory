---
title: Linux
description: 'Instale o Arkvory no Linux a partir do pacote .deb ou .rpm, inicie-o, opere os serviços systemd, faça upgrade e remova-o.'
---

# Linux

Há duas maneiras de executar o Arkvory no Linux:

- **Pacote** `Arkvory-amd64.deb` ou `Arkvory-x86_64.rpm`. Recomendado. Ele instala serviços systemd e um cluster PostgreSQL dedicado que o Arkvory gerencia. O gerenciador de pacotes fornece os programas do PostgreSQL.
- **Script** `install.sh`. Ele instala os mesmos serviços, mas usa um servidor PostgreSQL existente. Também oferece suporte a arm64. Consulte [Usar um PostgreSQL existente](#existing-postgresql).

Para Docker, consulte [Docker Compose](./docker). Para um primeiro contato com o console, consulte o [Início rápido](../guide/quick-start).

## Requisitos {#requirements}

| Item                      | Requisito                                                                                                                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Processador               | x64 para os pacotes. Não há pacotes arm64: use `install.sh` em arm64                                                                                                                                                                                                                             |
| Sistema de inicialização  | systemd. OpenRC, runit e outros sistemas de inicialização não são suportados                                                                                                                                                                                                                     |
| Biblioteca C              | glibc 2.28 ou posterior. Alpine Linux (musl) não é suportado                                                                                                                                                                                                                                     |
| Distribuições testadas    | Ubuntu 24.04 para o `.deb`, Fedora 44 para o `.rpm`. Outras distribuições systemd que atendam às dependências abaixo não são testadas                                                                                                                                                            |
| Dependências do `.deb`    | `postgresql` 16 ou posterior, `systemd`, `python3`, `ca-certificates`, `libc6` 2.28 ou posterior, `libstdc++6`, `libgcc-s1`, `libatomic1`                                                                                                                                                        |
| Dependências do `.rpm`    | `postgresql-server` 16 ou posterior, `systemd`, `python3`, `ca-certificates`, `glibc` 2.28 ou posterior, `libstdc++`, `libatomic`                                                                                                                                                                |
| Programas do PostgreSQL   | Versão 16 a 19. A etapa de instalação procura em `/usr/lib/postgresql/*/bin`, `/usr/pgsql-*/bin`, `/usr/bin` e `/usr/lib/pgsql/bin` e usa a versão mais alta que encontrar. Se sua distribuição oferecer apenas uma versão mais antiga, adicione primeiro um repositório PostgreSQL mais recente |
| Conta                     | `root`, ou um usuário que possa executar `sudo`                                                                                                                                                                                                                                                  |
| Portas livres             | 8080 e 54329 em `127.0.0.1`                                                                                                                                                                                                                                                                      |
| Armazenamento de arquivos | Um sistema de arquivos local que ofereça suporte a links físicos (hard links). Não use um compartilhamento de rede                                                                                                                                                                               |

O pacote contém o Node.js 24. A instalação dele não precisa de acesso à internet além do que o gerenciador de pacotes usa para as dependências.

O pacote nunca altera um cluster ou serviço PostgreSQL existente. O Arkvory inicia o próprio cluster a partir dos programas do PostgreSQL.

## Instalar o pacote {#install-package}

1. Baixe o pacote para sua distribuição em [GitHub Releases](https://github.com/ProAnima/Arkvory/releases), junto com `native-linux.json` do mesmo release.
2. Compare o SHA-256 do pacote com o valor em `native-linux.json`. Os pacotes não são assinados com uma chave de publicador, então essa verificação é a única prova do que você baixou.
3. Instale o pacote. Mantenha o `./` na frente do nome do arquivo: ele informa ao gerenciador de pacotes que o arquivo é local. No Debian e Ubuntu:

```bash
sudo apt install ./Arkvory-amd64.deb
```

No Fedora e em sistemas compatíveis com RPM:

```bash
sudo dnf install ./Arkvory-x86_64.rpm
```

O gerenciador de pacotes instala as dependências, e então o Arkvory se configura. Ele:

1. copia o Node.js para `/opt/proanima-arkvory/runtime/node`,
2. cria as duas contas de serviço, a configuração, as chaves e a chave de recuperação,
3. cria e inicia o cluster PostgreSQL e executa as migrações do banco de dados,
4. registra e inicia os serviços e o timer de atualização,
5. espera até que a API responda à verificação de prontidão três vezes seguidas.

No final, ele imprime o endereço do console e o caminho da chave de recuperação. Se uma etapa falhar, a instalação para com um erro. Consulte [Solução de problemas](#troubleshooting).

As atualizações automáticas ficam desativadas após a instalação. Para ativá-las, consulte [Atualizações](./updates).

## O que o pacote cria {#what-package-creates}

### Arquivos e diretórios {#files}

| Caminho                                                         | Conteúdo                                                                                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/usr/lib/proanima-arkvory/`                                    | Conteúdo do pacote: Node.js, os arquivos do release e o instalador. Pertence ao pacote                                                                             |
| `/usr/bin/arkvory`                                              | O comando de gerenciamento. Consulte [O comando arkvory](#arkvory-command)                                                                                         |
| `/usr/share/applications/arkvory.desktop`                       | Entrada de menu que abre o console em uma área de trabalho. Um servidor sem área de trabalho não a usa                                                             |
| `/opt/proanima-arkvory/`                                        | A raiz da instalação: configuração, dados, banco de dados, código de cada versão. Sua estrutura é descrita em [Escolher uma instalação](./#installation-directory) |
| `/etc/systemd/system/arkvory-*.service`, `arkvory-update.timer` | As unidades de serviço e o timer de atualização                                                                                                                    |

A raiz é `root:arkvory` com modo `0711`. Dentro dela, `config/` é `0750 root:arkvory`, `data/` e `logs/` pertencem a `arkvory`, e `database/` pertence a `arkvory-db` com modo `0700`. Os arquivos da chave de recuperação e da senha do banco de dados são legíveis somente por `root`.

### Contas {#accounts}

| Conta        | Executa                       | Observações                                                                                     |
| ------------ | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `arkvory`    | API, worker, agente de backup | Conta de sistema, sem shell de login, home `/opt/proanima-arkvory/data`                         |
| `arkvory-db` | O banco de dados              | Conta de sistema, sem shell de login. A conta da API não pode ler os arquivos do banco de dados |

### Serviços {#services}

| Unidade                | Executa como                                | Política de reinício                                                    |
| ---------------------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| `arkvory-database`     | `arkvory-db`                                | `on-failure`, após 10 segundos                                          |
| `arkvory-api`          | `arkvory`                                   | `always`, após 10 segundos                                              |
| `arkvory-worker`       | `arkvory`                                   | `always`, após 10 segundos                                              |
| `arkvory-backup`       | `arkvory`                                   | `always`, após 10 segundos                                              |
| `arkvory-update.timer` | inicia `arkvory-update.service` como `root` | A cada minuto. A tarefa verifica solicitações de atualização e releases |

Todas as unidades iniciam na inicialização (`multi-user.target`). Elas permitem 120 segundos para parar. Elas são executadas com `NoNewPrivileges`, um `/tmp` privado, um sistema de arquivos somente leitura fora de seus próprios diretórios e sem acesso a `/home`. A API e o worker podem gravar somente em `data/`, `logs/` e `updates/inbox/` da raiz. O agente de backup lê o armazenamento e grava somente no armazenamento de backups. Como `/home` fica oculto das unidades, nunca coloque certificados, armazenamentos de backups ou o diretório de dados sob um diretório home.

Um serviço que para sem a sua solicitação inicia novamente após 10 segundos. Um processo cuja thread principal trava por 60 segundos encerra a si mesmo e inicia novamente. Uma verificação de prontidão com falha, por si só, não reinicia um serviço. Consulte [Autorrecuperação](../operate/self-healing).

### Portas {#ports}

| Porta     | Uso                             | Exposição                                                 |
| --------- | ------------------------------- | --------------------------------------------------------- |
| 8080/TCP  | API e console                   | Somente `127.0.0.1`, até você configurar [HTTPS](./https) |
| 54329/TCP | O cluster PostgreSQL gerenciado | Somente `127.0.0.1`. O número é fixo                      |

## Primeira inicialização e primeiros passos {#first-start}

1. Verifique se os serviços estão em execução:

   ```bash
   systemctl status arkvory-database arkvory-api arkvory-worker arkvory-backup
   ```

2. Leia a chave de recuperação. Somente `root` pode lê-la.

   ```bash
   sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
   ```

3. Abra `http://127.0.0.1:8080/console/#onboarding`. Em um servidor remoto, encaminhe a porta primeiro e abra o endereço no seu próprio computador:

   ```bash
   ssh -L 8080:127.0.0.1:8080 admin@arkvory.example
   ```

4. No console, abra [[ui:navStart]] e expanda [[ui:welcomeOwner]]. Cole a chave em [[ui:welcomeRecovery]], informe o nome do proprietário e uma senha de pelo menos 12 caracteres, e selecione [[ui:welcomeCreate]]. O nome tem de 3 a 64 caracteres: letras latinas, dígitos, ponto, hífen ou sublinhado.
5. Entre com o novo nome e a senha.

O proprietário é o primeiro administrador. A chave de recuperação fica no servidor: não exclua o arquivo e não o copie para clientes ou sistemas de CI. As ferramentas de instalação a leem. Para o trabalho diário, crie contas e chaves de serviço. Consulte [Contas e acesso](../use/accounts) e [Segurança](../operate/security).

Antes que os clientes se conectem de outros computadores, configure o [HTTPS](./https). Em seguida, conecte um armazenamento de backups e execute um primeiro backup: consulte [Backups](../operate/backups).

Para instalar em um servidor a partir do seu próprio computador, você pode usar o Arkvory Remote Setup. Consulte [Escolher uma instalação](./#remote-installation-over-ssh).

## O comando arkvory {#arkvory-command}

O pacote instala `/usr/bin/arkvory`. `arkvory help` lista todos os comandos e não precisa de direitos especiais. Todo outro comando precisa de `root` e da raiz da instalação:

```bash
sudo arkvory status --root /opt/proanima-arkvory
```

`status` imprime o modo de instalação, a versão instalada, a configuração de atualização automática e a fixação de versão.

| Comando           | Uso                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `status`          | Mostra a versão instalada e a política de atualização                                                              |
| `update`          | Instala um release estável mais recente agora. Consulte [Atualizações](./updates)                                  |
| `configure`       | HTTPS, armazenamento de backups, espelhos, política de atualização e hub. Consulte [Configuração](./configuration) |
| `recover`         | Conclui uma atualização interrompida. Consulte [Atualizações](./updates#recover-update)                            |
| `finish-install`  | Continua uma instalação interrompida                                                                               |
| `updates-connect` | Conecta o console e o timer de atualização de uma instalação que foi atualizada a partir de um release antigo      |

## Logs {#logs}

Os serviços gravam no journal do sistema. A API e o worker gravam um registro JSON por linha.

```bash
sudo journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup -u arkvory-database
sudo journalctl -u arkvory-api -f
sudo journalctl -u arkvory-update --since today
```

`arkvory-update` contém a saída do timer de atualização. O tamanho e a retenção do journal são configurações do seu sistema operacional. Para os campos de registro e as métricas, consulte [Monitoramento](../operate/monitoring). Os comandos de implantação imprimem linhas no formato `<ISO-8601 time> INFO|WARN|ERROR <text>`. Segredos são removidos delas.

## Atualização de versão {#upgrade}

Instale um pacote mais recente sobre o antigo, ou atualize pelo console ou com `arkvory update`. Os serviços em execução continuam atendendo até que a atualização mude para o novo código. Consulte [Atualizações](./updates) para as políticas, o backup antes de uma alteração de esquema do banco de dados e as etapas de recuperação.

Não há repositório apt ou dnf para o Arkvory. Baixe cada novo pacote na página de releases.

## Remover {#remove}

### Remover o pacote e manter os dados {#remove-package}

No Debian e Ubuntu:

```bash
sudo apt remove proanima-arkvory
```

No Fedora e em sistemas compatíveis com RPM:

```bash
sudo dnf remove proanima-arkvory
```

A remoção para e desativa os serviços e o timer de atualização. Ela exclui `/usr/lib/proanima-arkvory`, `/usr/bin/arkvory` e a entrada de menu. Ela **mantém** intencionalmente:

- `/opt/proanima-arkvory`: o banco de dados, todos os arquivos, a configuração e a chave de recuperação,
- os arquivos de unidade em `/etc/systemd/system`, as contas `arkvory` e `arkvory-db`,
- o armazenamento de backups e seu drop-in do systemd. Ela nunca toca no armazenamento de backups.

`apt purge` não remove mais do que `apt remove`. Se você instalar o pacote novamente, ele continua com os dados mantidos e inicia os serviços.

### Remover tudo {#remove-all}

Isso exclui todos os arquivos armazenados e o catálogo. Faça um backup primeiro e mantenha o armazenamento de backups.

```bash
sudo systemctl disable --now arkvory-update.timer arkvory-backup arkvory-worker arkvory-api arkvory-database
sudo rm -rf /opt/proanima-arkvory
sudo rm -f /etc/systemd/system/arkvory-*.service /etc/systemd/system/arkvory-update.timer
sudo rm -rf /etc/systemd/system/arkvory-backup.service.d
sudo systemctl daemon-reload
sudo userdel arkvory
sudo userdel arkvory-db
```

Remova o pacote primeiro, como descrito acima. Após uma instalação por script não há pacote: o primeiro comando para os serviços, e os comandos que citam `arkvory-database` e `arkvory-db` informam que estes não existem.

## Usar um PostgreSQL existente {#existing-postgresql}

O pacote sempre cria seu próprio cluster. Para usar um servidor PostgreSQL que sua organização opera, instale com `install.sh`. Ele cria os mesmos três serviços e o timer de atualização, mas nenhuma unidade `arkvory-database` e nenhum comando `/usr/bin/arkvory`.

Use uma versão do PostgreSQL de 16 a 19. Use um banco de dados para uma instalação do Arkvory. Nunca conecte duas instalações ao mesmo banco de dados.

1. Peça ao seu administrador de banco de dados um banco de dados vazio e um papel (role) que seja seu proprietário. O Arkvory executa suas migrações com esse papel.
2. Baixe `install.sh` do release e leia-o. Ele precisa de `bash`, `curl`, `python3`, `tar` e `xz`, systemd e `root`.
3. Execute-o. O script solicita a URL de conexão; a entrada fica oculta.

   ```bash
   sudo bash ./install.sh --automatic
   ```

   Para passar a URL em um arquivo, crie um arquivo que somente `root` possa ler:

   ```json
   { "ARKVORY_DATABASE_URL": "postgresql://arkvory:<password>@db.example:5432/arkvory" }
   ```

   ```bash
   sudo bash ./install.sh --config /root/arkvory.json
   ```

4. Exclua o diretório temporário `/opt/proanima-arkvory/bootstrap.*` quando a instalação terminar. Se você digitou a URL no prompt, o diretório a contém em `native.json`.
5. Crie o proprietário conforme descrito em [Primeira inicialização e primeiros passos](#first-start).

O script baixa o Node.js 24.21.0 de `nodejs.org`, verifica seu SHA-256 e instala o release estável mais recente. Omita `--automatic` para manter as atualizações automáticas desativadas. Variáveis de ambiente alteram os padrões:

| Variável                  | Significado                                                                  | Padrão                      |
| ------------------------- | ---------------------------------------------------------------------------- | --------------------------- |
| `ARKVORY_INSTALL_ROOT`    | Raiz da instalação. Use um diretório dedicado e vazio fora de `/home`        | `/opt/proanima-arkvory`     |
| `ARKVORY_RELEASE_VERSION` | Instala esta versão estável em vez da mais recente                           | versão estável mais recente |
| `ARKVORY_ARTIFACT_DIR`    | Instala a partir de um `Arkvory-Linux.tar.gz` descompactado em vez do GitHub | não definida                |

Passe-as por meio de `sudo env`, por exemplo `sudo env ARKVORY_INSTALL_ROOT=/srv/arkvory bash ./install.sh`.

Sem o comando `arkvory`, chame o programa de gerenciamento com o Node.js que o script instalou. Use `linux-arm64` em arm64:

```bash
root=/opt/proanima-arkvory
sudo "$root/runtime/node-v24.21.0-linux-x64/bin/node" "$root/manage.mjs" status --root "$root"
```

Você faz o backup e a manutenção do servidor PostgreSQL por conta própria. O agente de backup do Arkvory copia o conteúdo do banco de dados para o armazenamento de backups por meio da URL de conexão. Consulte [Backups](../operate/backups).

## Solução de problemas {#troubleshooting}

| Problema                                                            | O que fazer                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PostgreSQL 16–19 server binaries are required`                     | Os programas do PostgreSQL estão ausentes ou são muito antigos. Instale um servidor PostgreSQL da versão 16 a 19 e instale o pacote novamente                                                                                                                                                                                                                                                                                     |
| `Use a dedicated empty installation directory`                      | `/opt/proanima-arkvory` contém arquivos de uma primeira instalação que parou antes de salvar `installation.json`. O instalador nunca sobrescreve uma configuração. Leia o journal e a saída do gerenciador de pacotes e corrija a causa. Um diretório que ainda não contém dados pode ser movido para outro lugar para que você possa instalar novamente. Não exclua `config/` nem `database/` de uma instalação que contém dados |
| `Installation is locked`                                            | Uma operação está em execução ou travou. Pare o timer de atualização, leia `journal.json` na raiz e não exclua `operation.lock` antes de saber o estado. Consulte [Atualizações](./updates#recover-update)                                                                                                                                                                                                                        |
| `database/bootstrap-started` existe, mas `database/initialized` não | A criação do banco de dados foi interrompida. Não exclua o cluster e não repita SQL manualmente. Corrija a causa e execute `sudo arkvory finish-install --root /opt/proanima-arkvory`                                                                                                                                                                                                                                             |
| Um serviço não inicia                                               | `journalctl -u arkvory-api -n 100`. Uma falha de inicialização imprime um registro JSON com um `reason` que nomeia a configuração, nunca seu valor                                                                                                                                                                                                                                                                                |
| A porta 8080 está ocupada                                           | Outro programa a usa. Libere a porta ou defina `ARKVORY_PORT` em `config/runtime.json`. Consulte [Configuração](./configuration#address-and-port). A porta do banco de dados 54329 não pode ser alterada                                                                                                                                                                                                                          |

Se a instalação parou depois de gravar `installation.json`, você também pode repetir a etapa de configuração do pacote: `sudo dpkg --configure -a` no Debian e Ubuntu, ou instalar o mesmo pacote novamente em sistemas RPM.

Mais dicas estão em [Solução de problemas](../operate/troubleshooting).
