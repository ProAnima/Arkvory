---
title: Variáveis de ambiente
---

# Variáveis de ambiente

O Arkvory é configurado com variáveis de ambiente cujos nomes começam com `ARKVORY_`. Esta página lista todas as variáveis lidas pelos processos do servidor, pelo cliente de linha de comando e pelos scripts de instalação.

## De onde vêm os valores {#where-the-values-come-from}

Os instaladores gravam as configurações do servidor em um único arquivo, `config/runtime.json`, na raiz da instalação. O iniciador de cada serviço lê esse arquivo e repassa os valores à API, ao worker e ao agente de backup. Cada chave deve começar com `ARKVORY_`, e cada valor deve ser uma string.

```json
{
  "ARKVORY_HOST": "127.0.0.1",
  "ARKVORY_PORT": "8080",
  "ARKVORY_CAPACITY_BYTES": "10995116277760",
  "ARKVORY_DATABASE_URL": "postgresql://arkvory:PASSWORD@127.0.0.1:54329/arkvory",
  "ARKVORY_DATA_DIR": "/opt/proanima-arkvory/data",
  "ARKVORY_KEYS_FILE": "/opt/proanima-arkvory/config/keys.json",
  "ARKVORY_MAX_DOWNLOADS": "32"
}
```

O arquivo contém a senha do banco de dados. Mantenha os direitos de acesso como o instalador os definiu.

Para alterar uma configuração, edite `config/runtime.json` e reinicie os serviços. Prefira o comando `arkvory configure` quando ele cobrir a configuração (HTTPS, armazenamento de backups, espelhos, atualizações). Ele valida a alteração e restaura o arquivo antigo quando os serviços não iniciam. Consulte [Configuração](../install/configuration).

```bash
sudo systemctl restart arkvory-api arkvory-worker arkvory-backup
```

```powershell
Restart-Service Arkvoryapi, Arkvoryworker, Arkvorybackup
```

Um valor fora do intervalo permitido interrompe o processo na inicialização, com uma mensagem que cita a variável. Nesse caso, o Arkvory não recorre a um valor padrão.

A coluna "Lida por" usa estes nomes: **API** é o servidor HTTP (também um gateway de leitura), **worker** é o worker em segundo plano, **agente** é o agente de backup, **CLI** é o `arkvoryctl`.

## Essenciais {#core}

| Variável                     | Lida por                      | Padrão            | Significado                                                                                                                                                        |
| ---------------------------- | ----------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ARKVORY_DATABASE_URL`       | API, worker, agente, migração | obrigatória       | URL de conexão do PostgreSQL (`postgres://` ou `postgresql://`). Use um banco de dados separado para cada instalação.                                              |
| `ARKVORY_DATA_DIR`           | API, worker, agente           | obrigatória       | Diretório de armazenamento local: staging, conteúdo e o arquivo `storage-id`. Não use um compartilhamento de rede.                                                 |
| `ARKVORY_HOST`               | API                           | `127.0.0.1`       | Endereço em que escutar. Os instaladores gravam `127.0.0.1`; no Docker Compose é `0.0.0.0` dentro do contêiner, e a porta é publicada somente no loopback do host. |
| `ARKVORY_PORT`               | API                           | `8080`            | Porta TCP, 1–65535.                                                                                                                                                |
| `ARKVORY_WEB_DIR`            | API                           | `apps/web/public` | Diretório com os arquivos do console web. O iniciador o define para o release atual a cada inicialização.                                                          |
| `ARKVORY_DATABASE_POOL_SIZE` | API                           | `10`              | Tamanho do pool de conexões da API, 4–200. Até três conexões estão sempre em uso.                                                                                  |

## Armazenamento e limites {#storage-and-limits}

| Variável                        | Lida por            | Padrão          | Significado                                                                                                                                                                                                 |
| ------------------------------- | ------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_CAPACITY_BYTES`        | API, worker         | 10 TiB          | Limite superior, em bytes, de todo o conteúdo reservado: publicado, uploads não concluídos e conteúdo que aguarda a limpeza. Não é uma verificação de disco. O worker o lê somente para cópias de espelhos. |
| `ARKVORY_STORAGE_RESERVE_BYTES` | API, worker, agente | `1073741824`    | Espaço livre, em bytes, que os uploads nunca usam. Ele é reservado para o banco de dados, os logs e o sistema. `0` desativa a reserva.                                                                      |
| `ARKVORY_MAX_OBJECT_BYTES`      | API                 | cerca de 10 TiB | Maior objeto, em bytes. O maior valor permitido é 10.000 partes de 1 GiB. Defina um valor menor para limitar o tamanho dos arquivos.                                                                        |

## Transferências e largura de banda {#transfers-and-bandwidth}

Estes limites valem para um único processo da API. As taxas são em bytes por segundo: `0` significa sem limite; qualquer outro valor deve estar entre 65.536 e 1 TiB.

| Variável                                          | Lida por | Padrão    | Significado                                                                                                                                                                                            |
| ------------------------------------------------- | -------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ARKVORY_MAX_UPLOADS`                             | API      | `2`       | Uploads em execução ao mesmo tempo, 1–32.                                                                                                                                                              |
| `ARKVORY_MAX_DOWNLOADS`                           | API      | `16`      | Downloads em execução ao mesmo tempo, 1–256.                                                                                                                                                           |
| `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`               | API      | `1`       | Uploads simultâneos de uma conta ou chave, até o limite total de uploads.                                                                                                                              |
| `ARKVORY_MAX_DOWNLOADS_PER_PRINCIPAL`             | API      | `4`       | Downloads simultâneos de uma conta ou chave, até o limite total de downloads.                                                                                                                          |
| `ARKVORY_TRANSFER_QUEUE_LIMIT`                    | API      | `64`      | Transferências que podem aguardar uma vaga livre, 1–1024.                                                                                                                                              |
| `ARKVORY_TRANSFER_QUEUE_PER_PRINCIPAL`            | API      | `8`       | Transferências em espera de uma conta ou chave, até o limite da fila.                                                                                                                                  |
| `ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS`               | API      | `20000`   | Quanto tempo uma transferência pode esperar na fila, 1–120.000 ms.                                                                                                                                     |
| `ARKVORY_MAX_REQUESTS`                            | API      | `128`     | Solicitações autenticadas ao mesmo tempo, 1–4096. Deve ser maior que uploads mais downloads. Quando não é definida e os limites de transferência são altos, o padrão é uploads mais downloads mais 64. |
| `ARKVORY_UPLOAD_BYTES_PER_SECOND`                 | API      | `0`       | Taxa total de upload do processo.                                                                                                                                                                      |
| `ARKVORY_DOWNLOAD_BYTES_PER_SECOND`               | API      | `0`       | Taxa total de download do processo.                                                                                                                                                                    |
| `ARKVORY_UPLOAD_BYTES_PER_SECOND_PER_PRINCIPAL`   | API      | `0`       | Taxa de upload de uma conta ou chave, somando todas as conexões dela.                                                                                                                                  |
| `ARKVORY_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL` | API      | `0`       | Taxa de download de uma conta ou chave, somando todas as conexões dela.                                                                                                                                |
| `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`                  | API      | `30000`   | Uma solicitação de upload que não envia dados durante esse tempo é interrompida, 1–1.800.000 ms.                                                                                                       |
| `ARKVORY_UPLOAD_DEADLINE_MS`                      | API      | `1800000` | Maior duração de uma solicitação de upload, 1–1.800.000 ms. Não pode ser menor que o tempo limite de inatividade.                                                                                      |

## Rede, HTTPS e navegadores {#network-https-and-browsers}

| Variável                     | Lida por | Padrão       | Significado                                                                                                                         |
| ---------------------------- | -------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_TLS_CERT_FILE`      | API      | não definida | Certificado PEM (com a cadeia) para o HTTPS integrado. Defina-o junto com o arquivo de chave.                                       |
| `ARKVORY_TLS_KEY_FILE`       | API      | não definida | Chave privada PEM sem senha.                                                                                                        |
| `ARKVORY_TLS_MIN_VERSION`    | API      | `TLSv1.2`    | `TLSv1.2` ou `TLSv1.3`.                                                                                                             |
| `ARKVORY_TLS_RELOAD_SECONDS` | API      | `300`        | Com que frequência os arquivos de certificado renovados são lidos: 30–86.400 segundos, ou `0` para lê-los somente na inicialização. |
| `ARKVORY_CORS_ORIGINS`       | API      | vazia        | Lista separada por vírgulas de até 16 origens de navegador, para um console em outro endereço. Somente HTTPS, ou HTTP no loopback.  |
| `ARKVORY_TRUSTED_PROXIES`    | API      | vazia        | Até 32 endereços de proxy reverso (IP ou CIDR). Somente eles podem definir o endereço do cliente com `X-Forwarded-For`.             |

O HTTPS integrado é para instalações nativas. Com o Docker Compose, use um proxy reverso. Consulte [HTTPS](../install/https).

## Identidade e chaves {#identity-and-keys}

| Variável                     | Lida por    | Padrão      | Significado                                                                                                                                                         |
| ---------------------------- | ----------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_KEYS_FILE`          | API, worker | obrigatória | Arquivo JSON com chaves de arquivo, como a chave de recuperação e a chave de verificação de integridade (health check). Ele guarda hashes SHA-256, nunca as chaves. |
| `ARKVORY_ALLOW_REGISTRATION` | API         | desativada  | `true` permite que as pessoas criem as próprias contas na página de login. Qualquer outro valor a mantém desativada.                                                |

## Backups {#backups}

| Variável                          | Lida por        | Padrão       | Significado                                                                                                                                                |
| --------------------------------- | --------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_BACKUP_VAULT`            | agente          | não definida | Diretório de um vault inicializado. Sem ele, o agente é executado e informa que nenhum vault está configurado. `arkvory configure --backup-vault` o grava. |
| `ARKVORY_BACKUP_BYTES_PER_SECOND` | agente          | sem limite   | Limite da taxa de cópia de um backup, no mínimo 65.536.                                                                                                    |
| `ARKVORY_BACKUP_POLL_SECONDS`     | agente          | `15`         | Com que frequência o agente procura novas tarefas de backup, 1–3600 segundos.                                                                              |
| `ARKVORY_BACKUP_LEASE_SECONDS`    | agente          | `60`         | Tempo de lease que impede que um segundo agente seja executado ao mesmo tempo, 2–3600 segundos.                                                            |
| `ARKVORY_BACKUP_SNAPSHOT_SECONDS` | agente          | `1800`       | Limite de tempo para a parte de snapshot do banco de dados de um backup, 60–86.400 segundos.                                                               |
| `ARKVORY_BACKUP_BARRIER_SECONDS`  | agente          | `30`         | Quanto tempo um backup espera por uma etapa de limpeza em execução, 1–600 segundos.                                                                        |
| `ARKVORY_RESTORE_DATABASE_URL`    | comando restore | não definida | Banco de dados de destino de uma restauração. É mais seguro que `--database-url`, porque outros usuários não o veem na lista de processos.                 |

Consulte [Backups](../operate/backups).

## Espelhos {#mirrors}

| Variável                  | Lida por    | Padrão       | Significado                                                                                                                       |
| ------------------------- | ----------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_MIRRORS_FILE`    | API, worker | não definida | Arquivo JSON que lista os repositórios espelhados (até 64). `arkvory configure --mirror` o grava.                                 |
| `ARKVORY_MIRRORS_CA_FILE` | worker      | não definida | Caminho absoluto de um arquivo PEM com autoridades certificadoras extras para os servidores de origem. O TLS é sempre verificado. |

Consulte [Espelhos](../operate/mirrors).

## Atualizações e o hub {#updates-and-the-hub}

| Variável                     | Lida por | Padrão                     | Significado                                                                                                                                   |
| ---------------------------- | -------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_HUB_URL`            | API      | `https://hub.proanima.net` | Endereço do hub da ProAnimaStudio, usado pelo feedback do console. Um valor vazio desativa o feedback. Somente HTTPS, ou HTTP no loopback.    |
| `ARKVORY_HUB_PROJECT`        | API      | `arkvory`                  | Nome do projeto no hub.                                                                                                                       |
| `ARKVORY_UPDATE_CONTROL_DIR` | API      | não definida               | Diretório que a API compartilha com o atualizador do host. Os instaladores o definem. Sem ele, o console não consegue solicitar atualizações. |

Consulte [Atualizações](../install/updates).

## Logs e encerramento {#logging-and-shutdown}

| Variável                   | Lida por            | Padrão  | Significado                                                                                         |
| -------------------------- | ------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| `ARKVORY_LOG_LEVEL`        | API, worker, agente | `info`  | `debug`, `info`, `warning` ou `error`.                                                              |
| `ARKVORY_ACCESS_LOG`       | API                 | `true`  | `true` grava uma linha JSON para cada solicitação HTTP; `false` a desativa.                         |
| `ARKVORY_DRAIN_TIMEOUT_MS` | API                 | `30000` | Depois de um sinal de parada, o tempo para as solicitações em andamento terminarem, 0–3.600.000 ms. |

## Gateways de leitura {#read-gateways}

Quando qualquer uma destas variáveis é definida, o slot, o número de slots e a taxa compartilhada são obrigatórios. O processo de escrita usa o papel `api` e o slot `0`. Cada gateway de leitura usa o papel `reader` e o próprio slot. Consulte [Gateways de leitura](../operate/read-gateways).

| Variável                                                 | Lida por | Padrão       | Significado                                                                                                            |
| -------------------------------------------------------- | -------- | ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_ROLE`                                           | API      | `api`        | `api` (o processo de escrita) ou `reader` (um gateway de leitura).                                                     |
| `ARKVORY_GATEWAY_SLOTS`                                  | API      | não definida | Número de processos que compartilham o limite de download, 2–16.                                                       |
| `ARKVORY_GATEWAY_SLOT`                                   | API      | não definida | Slot deste processo, de `0` até o número de slots menos um.                                                            |
| `ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND`               | API      | não definida | Taxa total de download de todos os processos. Cada slot recebe uma parte igual, de no mínimo 65.536 bytes por segundo. |
| `ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL` | API      | `0`          | Taxa total de download de uma conta ou chave em todos os processos; `0` significa sem limite.                          |

## Watchdog {#watchdog}

| Variável                   | Lida por            | Padrão | Significado                                                                                                                                                                           |
| -------------------------- | ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_WATCHDOG_SECONDS` | API, worker, agente | `60`   | Um processo que fica bloqueado por esse tempo se encerra sozinho, e o gerenciador de serviços o inicia de novo. `0` o desativa (para um depurador); caso contrário, 10–3600 segundos. |

Consulte [Autorrecuperação](../operate/self-healing).

## Cliente de linha de comando {#command-line-client}

| Variável              | Lida por | Padrão                                  | Significado                                                                 |
| --------------------- | -------- | --------------------------------------- | --------------------------------------------------------------------------- |
| `ARKVORY_BASE_URL`    | CLI      | perfil e depois `http://127.0.0.1:8080` | Endereço do servidor. Quando definida, a chave também deve vir do ambiente. |
| `ARKVORY_TOKEN`       | CLI      | não definida                            | A própria chave. Tem prioridade sobre um arquivo de chave.                  |
| `ARKVORY_TOKEN_FILE`  | CLI      | arquivo de chave do perfil              | Caminho de um arquivo que contém a chave.                                   |
| `ARKVORY_CLI_HOME`    | CLI      | `~/.config/arkvory`                     | Diretório do arquivo `profiles.json`.                                       |
| `ARKVORY_CLI_VERSION` | CLI      | `development`                           | Versão que `--version` imprime. Os pacotes de release a contêm.             |

Consulte [Cliente de linha de comando](../protocols/cli).

## Scripts de instalação {#installer-scripts}

Estas variáveis são lidas pelo `install.sh` no Linux. No Windows, o `install.ps1` usa, em vez delas, parâmetros como `-Root` e `-Artifact`.

| Variável                  | Padrão                        | Significado                                                                            |
| ------------------------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| `ARKVORY_INSTALL_ROOT`    | `/opt/proanima-arkvory`       | Raiz da instalação. Não coloque uma instalação nativa em um diretório pessoal.         |
| `ARKVORY_ARTIFACT_DIR`    | não definida                  | Diretório de um release descompactado. O script o instala em vez de baixar um release. |
| `ARKVORY_RELEASE_VERSION` | a versão estável mais recente | Versão estável exata a instalar, como `1.2.3`.                                         |

## Definidas pelo instalador {#set-by-the-installer}

O instalador define estas variáveis para os próprios processos auxiliares. Não as defina você mesmo.

| Variável                  | Significado                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `ARKVORY_IMAGE`           | Imagem de contêiner do release atual, em `config/compose.env`.                          |
| `ARKVORY_SERVICE_WRAPPER` | Caminho do wrapper do serviço de backup do Windows, usado quando o serviço está parado. |
| `ARKVORY_PROTECT_ROOT`    | Raiz da instalação cujas regras de acesso são definidas no Windows.                     |
| `ARKVORY_ENGINE_USER`     | No Windows com o Docker Desktop, dá ao usuário atual acesso à raiz.                     |

## Páginas relacionadas {#related-pages}

- [Configuração](../install/configuration)
- [Monitoramento](../operate/monitoring)
- [Segurança](../operate/security)
- [Armazenamento](../operate/storage)
