---
title: Configuração
description: Onde fica a configuração do Arkvory, quais comandos de ciclo de vida a alteram, as principais configurações por tarefa e como aplicar uma alteração.
---

# Configuração

O Arkvory tem dois tipos de configurações:

- **Configurações do servidor** são variáveis `ARKVORY_*` no arquivo `config/runtime.json`. Elas definem o endereço, os limites, o armazenamento e coisas semelhantes. A API, o worker e o agente de backup as leem quando iniciam.
- **Política de instalação** é a política de atualização, os arquivos HTTPS, o armazenamento de backups (vault) e os espelhos. Você a altera com o comando `arkvory configure`. O comando verifica a alteração, reinicia o que for necessário e restaura o estado anterior quando os serviços não iniciam.

Esta página mostra onde estão os arquivos, quais comandos existem e como funcionam as principais configurações. A lista completa de variáveis, com padrões e intervalos, está em [Variáveis de ambiente](../reference/environment).

## Onde fica a configuração {#where-it-lives}

A raiz da instalação contém tudo. É `C:\ProgramData\ProAnima\Arkvory` no Windows e `/opt/proanima-arkvory` no Linux. Uma instalação Compose usa a mesma raiz no host. Os caminhos abaixo são relativos à raiz.

| Arquivo                                                                        | Conteúdo                                                                                                                    | Como alterar                                                           |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `config/runtime.json`                                                          | As configurações do servidor. As chaves começam com `ARKVORY_`, e todo valor é uma string. Contém a senha do banco de dados | Manualmente, ou com `configure`                                        |
| `config/keys.json`                                                             | Hashes SHA-256 da chave de recuperação e da chave de prontidão. Nunca contém uma chave                                      | Apenas para [substituir a chave de recuperação](#replace-recovery-key) |
| `config/bootstrap-token.txt`                                                   | A chave de recuperação                                                                                                      | Apenas para substituí-la                                               |
| `config/health-token.txt`                                                      | A chave que as ferramentas de instalação usam para a verificação de prontidão                                               | Não altere                                                             |
| `config/hub.json`                                                              | O endereço do hub, o canal de atualização e a configuração de estatísticas                                                  | Com `configure`                                                        |
| `config/install-id`                                                            | Um ID de instalação aleatório, enviado ao hub somente com as estatísticas ativadas                                          | Não altere                                                             |
| `config/mirrors/`                                                              | A lista de espelhos e as chaves que o worker usa para as origens                                                            | Com `configure --mirror`                                               |
| `config/webhooks/`                                                             | A lista de assinaturas, os segredos de assinatura e as autoridades dos receptores que o worker usa                          | Com `configure --webhook`                                              |
| `installation.json`                                                            | O modo, o motor, a configuração de atualização automática, a fixação de versão e a versão instalada                         | Apenas com comandos                                                    |
| `github-token.txt`                                                             | Token opcional do GitHub para downloads de versões. Consulte [Atualizações](./updates#hub-unreachable)                      | Manualmente                                                            |
| `config/compose.env`, `config/compose.vault.yml`, `config/compose.mirrors.yml` | Apenas Compose: a imagem, a montagem do vault e a montagem do espelho                                                       | Apenas com comandos                                                    |

Em uma instalação Linux nativa, `runtime.json` e `keys.json` são `root:arkvory` com modo `0640`, e os arquivos de credenciais em `config/` são legíveis apenas por `root`. Uma instalação Compose usa o modo `0644` para os arquivos que os contêineres leem: consulte [Docker Compose](./docker#owners). Mantenha os proprietários e os modos definidos pelo instalador.

## Comandos de ciclo de vida {#lifecycle-commands}

Todos os comandos exigem direitos de administrador e a opção `--root` com a raiz da instalação.

| Instalação                     | Como executar um comando                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pacote Linux                   | `sudo arkvory <command> --root /opt/proanima-arkvory`                                                                                                      |
| Windows, instalador gráfico    | Em um PowerShell elevado: `& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' <command> --root C:\ProgramData\ProAnima\Arkvory`                             |
| Instalação por script, Compose | `sudo <root>/runtime/node-v24.21.0-linux-x64/bin/node <root>/manage.mjs <command> --root <root>`. No Windows, use `runtime\node-v24.21.0-win-x64\node.exe` |

`arkvory help` lista os comandos sem direitos especiais. Os exemplos neste site usam a forma curta `arkvory <command>`.

| Comando                         | Uso                                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                        | Mostra o modo de instalação, o motor, a configuração de atualização automática, a fixação e a versão instalada                                 |
| `configure`                     | Altera uma política. Consulte [O comando configure](#configure-command)                                                                        |
| `update`                        | Instala agora uma versão estável mais recente. Consulte [Atualizações](./updates)                                                              |
| `upgrade`                       | Instala uma versão que altera o esquema do banco de dados com um registro de backup próprio. Consulte [Atualizações](./updates#manual-upgrade) |
| `recover`                       | Conclui uma atualização interrompida. Consulte [Atualizações](./updates#recover-update)                                                        |
| `finish-install`                | Continua uma primeira instalação interrompida                                                                                                  |
| `updates-connect`               | Conecta o console e o temporizador de atualizações, e registra serviços que faltam em uma instalação antiga                                    |
| `updates-poll`, `updates-reset` | Executados pelo temporizador de atualizações e para recuperação. Consulte [Atualizações](./updates#recover-update)                             |

Apenas um comando é executado por vez. Um segundo comando para com `Installation is locked`. Nunca coloque uma chave ou uma senha em uma opção de comando: use arquivos.

### O comando configure {#configure-command}

Uma chamada altera um tipo de configuração. Os cinco tipos não podem ser misturados em uma única chamada.

| Tipo                             | Opções                                                                                                                                                                                                                                   | Efeito                                                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTPS                            | `--tls-cert FILE --tls-key FILE [--listen-host ADDRESS]`, ou `--tls-off [--listen-host ADDRESS]`                                                                                                                                         | Ativa ou desativa o HTTPS integrado. Reinicia os serviços e verifica a prontidão. Consulte [HTTPS](./https)                                       |
| Armazenamento de backups (vault) | `--backup-vault DIRECTORY [--vault-key-file FILE \| --init-vault --vault-no-encryption]`, ou `--backup-vault-off`                                                                                                                        | Conecta ou desconecta o vault. Reinicia apenas o agente de backup. Consulte [Backups](../operate/backups)                                         |
| Espelhos                         | `--mirror REPOSITORY --mirror-upstream URL --mirror-token-file FILE [--mirror-source REPOSITORY] [--mirror-stages LIST] [--mirror-ca-file FILE]`, ou `--mirror-detach REPOSITORY`                                                        | Torna um repositório um espelho ou um destino de importação, ou novamente comum. Consulte [Espelhos](../operate/mirrors)                          |
| Webhooks                         | `--webhook ID --webhook-repository REPOSITORY --webhook-url URL --webhook-secret-file FILE [--webhook-next-secret-file FILE] [--webhook-actions LIST] [--webhook-allow-private LIST] [--webhook-ca-file FILE]`, ou `--webhook-detach ID` | Adiciona, substitui ou remove uma assinatura de webhook. Reinicia os serviços e verifica se estão prontos. Veja [Webhooks](../protocols/webhooks) |
| Atualizações                     | `--enable-updates`, `--disable-updates`, `--pin [--version X.Y.Z]`, `--unpin`, `--update-channel stable` ou `beta`, `--statistics on` ou `off`, `--hub-url URL`, `--hub-off`                                                             | Altera a política de atualização. Consulte [Atualizações](./updates)                                                                              |

Alterações de HTTPS, vault e espelho reiniciam serviços e restauram a configuração anterior quando a alteração não funciona. As opções de atualização apenas reescrevem `installation.json` e `hub.json`; não reiniciam nada. Os caminhos de arquivo são absolutos.

## Configurações por tarefa {#settings-by-task}

### Endereço e porta {#address-and-port}

| Variável       | Padrão      | Significado                    |
| -------------- | ----------- | ------------------------------ |
| `ARKVORY_HOST` | `127.0.0.1` | O endereço em que a API escuta |
| `ARKVORY_PORT` | `8080`      | A porta TCP                    |

Com o padrão, apenas programas no servidor podem se conectar. Para aceitar outros computadores, escolha uma de duas formas:

- **HTTPS integrado.** `arkvory configure --tls-cert … --tls-key … --listen-host 0.0.0.0`. Consulte [HTTPS](./https#built-in-tls).
- **Um proxy reverso em outro computador.** Defina `ARKVORY_HOST` como o endereço da interface de rede para o proxy e liste o proxy em `ARKVORY_TRUSTED_PROXIES`. Edite `runtime.json`, ou execute `arkvory configure --tls-off --listen-host <address>`. Restrinja a porta com um firewall ao proxy.

`--listen-host` sozinho é recusado: use-o com os arquivos TLS ou com `--tls-off`. Após `--tls-off`, adicione `--listen-host 127.0.0.1` para voltar ao loopback, ou a API continua escutando no endereço definido.

Quando a API escuta em um endereço que não é loopback sem TLS e sem um proxy confiável, ela registra o aviso `http.plaintext_exposed` na inicialização. Nunca envie chaves por HTTP simples entre computadores.

No Linux, os serviços são executados como uma conta sem privilégios, que normalmente não pode escutar em uma porta abaixo de 1024. Os atalhos para o console (menu Iniciar, entrada de menu) continuam apontando para a porta 8080. Os comandos de ciclo de vida seguem o endereço e a porta em `runtime.json`. Em uma instalação Compose, o endereço e a porta são fixos: consulte [Docker Compose](./docker#ports).

### Endereço público e cabeçalhos encaminhados {#public-address}

Não há configuração para uma URL pública. O servidor monta links absolutos, como os links nas respostas do Git LFS e do npm, a partir da solicitação: o esquema é `https` quando a conexão é TLS ou quando o proxy envia `X-Forwarded-Proto: https`, e o host é o cabeçalho `Host`. Um proxy listado em `ARKVORY_TRUSTED_PROXIES` também pode definir o host com `X-Forwarded-Host`. Portanto, seu proxy deve encaminhar o nome público. Consulte [HTTPS](./https#reverse-proxy).

`ARKVORY_TRUSTED_PROXIES` aceita até 32 endereços ou intervalos CIDR, separados por vírgulas. Somente esses pares podem definir o endereço do cliente com `X-Forwarded-For` e o ID da solicitação com `X-Request-Id`. Sem a lista, todo cliente parece vir do endereço do proxy, e o limite de login os conta como um só.

### Navegadores em outro endereço {#browsers}

`ARKVORY_CORS_ORIGINS` lista até 16 origens de um console ou de outro aplicativo web que roda em um endereço diferente, separadas por vírgulas. Cada origem tem um esquema, um host e uma porta opcional, e nenhum caminho. Deve usar HTTPS; HTTP simples é aceito apenas para `localhost`, `127.0.0.1` e `[::1]`. Consulte [HTTPS](./https#console-api-address). `ARKVORY_ALLOW_REGISTRATION=true` permite que as pessoas criem suas próprias contas na página de login; fica desativado por padrão.

### Banco de dados {#database}

| Variável                     | Padrão                   | Significado                                                                              |
| ---------------------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| `ARKVORY_DATABASE_URL`       | definido pelo instalador | A URL de conexão do PostgreSQL. Um banco de dados gerenciado escuta em `127.0.0.1:54329` |
| `ARKVORY_DATABASE_POOL_SIZE` | `10`                     | O tamanho do pool de conexões da API, de 4 a 200                                         |

Não aponte uma instalação para outro banco de dados. Os arquivos armazenados e o catálogo pertencem um ao outro. Mudar para um novo banco de dados é uma restauração a partir de um backup: consulte [Backups](../operate/backups). Para um PostgreSQL externo, defina `max_connections` alto o suficiente para o pool da API, uma conexão por upload simultâneo para bloqueios de escrita, 5 para o worker e as conexões do agente de backup.

### Diretório de armazenamento e espaço livre {#storage}

| Variável                        | Padrão          | Significado                                                                                         |
| ------------------------------- | --------------- | --------------------------------------------------------------------------------------------------- |
| `ARKVORY_DATA_DIR`              | `<root>/data`   | Onde o conteúdo dos arquivos é armazenado. Definido pelo instalador. Use um disco local             |
| `ARKVORY_CAPACITY_BYTES`        | 10 TiB          | O máximo que todo o conteúdo reservado pode usar. É um limite de reservas, não uma medição de disco |
| `ARKVORY_STORAGE_RESERVE_BYTES` | 1 GiB           | Espaço livre que os uploads nunca usam. `0` desativa a reserva                                      |
| `ARKVORY_MAX_OBJECT_BYTES`      | cerca de 10 TiB | O maior objeto individual. Defina um valor menor para limitar o tamanho do arquivo                  |

Mantenha `ARKVORY_DATA_DIR` onde o instalador o colocou. As unidades do Linux podem escrever apenas em `data/`, `logs/` e `updates/inbox/` da raiz, então outro caminho é somente leitura para elas. Para usar um disco maior, pare os serviços, copie o conteúdo para o novo disco, monte o disco em `data/` com o proprietário `arkvory` e inicie os serviços. No Windows e no Linux, você também pode escolher a própria raiz ao instalar com um script (`-Root`, `ARKVORY_INSTALL_ROOT`). Consulte [Armazenamento](../operate/storage).

### Limites de transferência {#limits}

Os limites pertencem a um processo da API. Uma taxa de `0` significa sem limite.

| Variável                              | Padrão    | Significado                                                       |
| ------------------------------------- | --------- | ----------------------------------------------------------------- |
| `ARKVORY_MAX_UPLOADS`                 | `2`       | Uploads simultâneos, 1 a 32                                       |
| `ARKVORY_MAX_DOWNLOADS`               | `16`      | Downloads simultâneos, 1 a 256                                    |
| `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`   | `1`       | Uploads simultâneos de uma conta ou chave                         |
| `ARKVORY_MAX_DOWNLOADS_PER_PRINCIPAL` | `4`       | Downloads simultâneos de uma conta ou chave                       |
| `ARKVORY_UPLOAD_BYTES_PER_SECOND`     | `0`       | Taxa total de upload em bytes por segundo                         |
| `ARKVORY_DOWNLOAD_BYTES_PER_SECOND`   | `0`       | Taxa total de download em bytes por segundo                       |
| `ARKVORY_UPLOAD_DEADLINE_MS`          | `1800000` | O tempo máximo de uma solicitação de upload, 30 minutos           |
| `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`      | `30000`   | Uma solicitação de upload que não envia dados por esse tempo para |

Um proxy na frente da API deve permitir uma solicitação pelo menos tão longa quanto `ARKVORY_UPLOAD_DEADLINE_MS`. Consulte [HTTPS](./https#reverse-proxy). Todos os outros limites, como a fila de espera e as taxas por conta, estão em [Variáveis de ambiente](../reference/environment#transfers-and-bandwidth).

### Backups e espelhos {#backups-mirrors}

Use `configure` para ambos. `--backup-vault` grava `ARKVORY_BACKUP_VAULT`, concede à conta de serviço acesso ao diretório, reinicia apenas o agente de backup e mantém a alteração somente quando o agente informa que o vault está disponível. O vault deve ficar fora da raiz da instalação e fora do armazenamento. `--mirror` grava `ARKVORY_MIRRORS_FILE` e os arquivos de chave, reinicia a API e o worker, e verifica a origem com sua chave antes de alterar qualquer coisa.

### Atualizações e o hub {#updates-and-hub}

A política de atualização está em `installation.json` e `config/hub.json`. As opções estão em [O comando configure](#configure-command), e seu significado está em [Atualizações](./updates). `ARKVORY_HUB_URL` em `runtime.json` é separado: define para onde o console envia feedback. `configure --hub-url` ou `--hub-off` altera ambos, e o endereço de feedback passa a valer após a próxima reinicialização dos serviços.

### Logs e desligamento {#logs-and-shutdown}

| Variável                   | Padrão  | Significado                                                                                         |
| -------------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| `ARKVORY_LOG_LEVEL`        | `info`  | `debug`, `info`, `warning` ou `error`. Os níveis `warning` e `error` também ocultam o log de acesso |
| `ARKVORY_ACCESS_LOG`       | `true`  | Um registro JSON para cada solicitação HTTP. A string de consulta nunca é gravada                   |
| `ARKVORY_DRAIN_TIMEOUT_MS` | `30000` | Após uma solicitação de parada, o tempo para as solicitações em execução terminarem                 |

Os supervisores dão a um serviço 120 segundos para parar. Se você definir um tempo de drenagem acima de cerca de 90 segundos, aumente também o tempo limite de parada do gerenciador de serviços: `TimeoutStopSec` nas unidades systemd, o tempo limite de parada dos serviços do Windows e `stop_grace_period` no Compose. Consulte [Monitoramento](../operate/monitoring).

## Aplicar uma alteração {#apply-change}

`configure` aplica sua própria alteração. Para qualquer coisa que você edite em `config/runtime.json`:

1. Faça uma cópia do arquivo, por exemplo `sudo cp -p /opt/proanima-arkvory/config/runtime.json /root/runtime.json.bak`. Ele contém a senha do banco de dados: mantenha a cópia privada.
2. Edite o arquivo no local. Mantenha o JSON válido, com todo valor sendo uma string.
3. Verifique o proprietário e o modo. No Linux, devem permanecer `root:arkvory` e `0640`. Corrija-os com `sudo chown root:arkvory runtime.json` e `sudo chmod 0640 runtime.json`.
4. Reinicie os serviços. As configurações são lidas apenas na inicialização.

   ```bash
   sudo systemctl restart arkvory-api arkvory-worker arkvory-backup
   ```

   ```powershell
   Restart-Service Arkvoryapi, Arkvoryworker, Arkvorybackup
   ```

   Em uma instalação Compose, pare e inicie os contêineres com o comando `compose` de [Docker Compose](./docker#manage):

   ```bash
   "${compose[@]}" stop --timeout 120 backup worker api
   "${compose[@]}" up -d --wait api worker
   "${compose[@]}" up -d backup
   ```

5. Verifique o resultado. Um valor fora do intervalo faz o processo parar na inicialização com uma mensagem que nomeia a variável, nunca o valor. No Linux, leia-a com `journalctl -u arkvory-api -n 50`. Nesse caso, o Arkvory não recorre a um padrão.

Uma reinicialização interrompe as transferências em andamento. Os clientes as retomam.

## Substituir a chave de recuperação {#replace-recovery-key}

Substitua a chave de recuperação se você suspeitar que alguém leu `config/bootstrap-token.txt`. A chave é armazenada em dois lugares que devem mudar juntos: o arquivo `bootstrap-token.txt` contém a chave, e a entrada `bootstrap-owner` em `keys.json` contém seu SHA-256. Mantenha a entrada `deployment-health` como está.

1. Faça uma cópia de `config/keys.json`.
2. Salve este script como `replace-recovery-key.mjs`:

   ```js
   import { createHash, randomBytes } from 'node:crypto';
   import { readFileSync, writeFileSync } from 'node:fs';

   const directory = process.argv[2];
   const token = randomBytes(32).toString('hex');
   const keys = JSON.parse(readFileSync(`${directory}/keys.json`, 'utf8'));
   const owner = keys.find((key) => key.id === 'bootstrap-owner');
   if (!owner) throw new Error('No bootstrap-owner entry');
   owner.sha256 = createHash('sha256').update(token).digest('hex');
   writeFileSync(`${directory}/keys.json`, JSON.stringify(keys, null, 2));
   writeFileSync(`${directory}/bootstrap-token.txt`, token);
   ```

3. Execute-o como `root` ou Administrador com o Node.js da instalação. O script grava nos arquivos existentes, então os proprietários e as regras de acesso permanecem como estão.

   ```bash
   sudo /opt/proanima-arkvory/runtime/node ./replace-recovery-key.mjs /opt/proanima-arkvory/config
   ```

   ```powershell
   & 'C:\ProgramData\ProAnima\Arkvory\runtime\node.exe' .\replace-recovery-key.mjs 'C:\ProgramData\ProAnima\Arkvory\config'
   ```

   Após uma instalação por script, use o Node.js em `runtime\node-v24.21.0-…` em vez disso.

4. Reinicie os serviços conforme mostrado em [Aplicar uma alteração](#apply-change).
5. Leia a nova chave em `config/bootstrap-token.txt` e exclua o script e a cópia de `keys.json`.

Contas, tokens pessoais e chaves de serviço não são afetados. Eles ficam no banco de dados.
