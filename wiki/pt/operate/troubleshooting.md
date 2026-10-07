---
title: 'Solução de problemas'
description: 'Sintomas, causas e correções para as falhas que acontecem em um servidor Arkvory, e como encontrar os logs e o ID da solicitação.'
---

# Solução de problemas

Encontre o seu sintoma, leia a causa e aplique a correção. Cada seção informa o evento de log ou o erro que você deve ver. Para o significado de um código de erro, consulte [Erros](../api/errors).

## Primeiros passos {#first-steps}

1. Consulte o endpoint de status: `curl -fsS http://127.0.0.1:8080/health/status`. `{"status":"ready"}` significa que a API alcança o banco de dados e o armazenamento.
2. Leia as linhas de log mais recentes do serviço com falha. Consulte [Logs e feedback](#logs-and-feedback).
3. Procure o evento `startup.failed` ou `worker.unavailable`. O campo `reason` indica a causa.
4. Se um cliente relatar um erro, peça o ID da solicitação e procure-o no log.

## O servidor não inicia {#server-does-not-start}

O gerenciador de serviços reinicia um serviço com falha a cada 10 segundos. O log então repete `startup.failed`. Leia o campo `reason` e os campos `errno` e `sqlstate`.

### A porta está ocupada {#port-busy}

**Causa.** `startup.failed` tem `errno` `EADDRINUSE`. Outro programa escuta na porta 8080 (`ARKVORY_PORT`), ou um processo antigo do Arkvory ainda está em execução.

**Correção.** Encontre o proprietário da porta e pare-o, ou altere a porta.

```bash
sudo ss -ltnp 'sport = :8080'
```

```powershell
Get-NetTCPConnection -LocalPort 8080 | Select-Object LocalAddress, OwningProcess
```

Para alterar a porta, edite `ARKVORY_PORT` em `config/runtime.json` e reinicie os serviços. O endereço do console muda junto.

### O banco de dados está inacessível ou rejeita o login {#database-problems}

**Causa.** O log mostra um destes motivos:

| `reason`                                                             | Significado                                                                |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `dependency unavailable`, with `errno` `ECONNREFUSED` or `ETIMEDOUT` | O PostgreSQL está parado, escuta em outro lugar, ou um firewall o bloqueia |
| `database authentication failed`                                     | O usuário ou a senha em `ARKVORY_DATABASE_URL` está errado                 |
| `database does not exist`                                            | O banco de dados nomeado na URL está ausente                               |
| `database role lacks a required privilege`                           | A role não pode criar ou alterar as tabelas                                |

**Correção.** Inicie o PostgreSQL, ou corrija `ARKVORY_DATABASE_URL` em `config/runtime.json` e reinicie os serviços. O banco de dados gerenciado escuta em `127.0.0.1:54329` (serviço `Arkvorydatabase` no Windows, `arkvory-database` no Linux). Os serviços sobem sozinhos quando o banco de dados responde. Não exclua a pasta `database/`.

### O banco de dados e o programa divergem {#migrations}

**Causa.** O motivo começa com `unavailable:` e diz `Database migrations 1 through N are required; run migrate`, ou `Database schema is newer than this release`, ou `database schema is missing; run migrations`. Isso acontece após uma atualização que parou no meio do caminho, ou após uma versão antiga ser iniciada em um banco de dados mais novo.

**Correção.** Não inicie uma versão antiga em um banco de dados mais novo. Verifique o estado com `arkvory status --root <root>` e conclua ou desfaça a atualização com `recover`. Consulte [Uma atualização falhou](#update-failed). Para manter os dados seguros, restaure a partir de um backup somente quando `recover` não conseguir concluir.

### Outro processo possui o armazenamento {#storage-identity}

**Causa.** O motivo é `busy: Another writer or maintenance process owns this database`, ou `conflict: Database belongs to a different storage directory`. Uma segunda API roda contra o mesmo banco de dados, ou o diretório de dados não é aquele com o qual este banco de dados foi usado. Cada diretório de armazenamento tem um arquivo `storage-id`, e o banco de dados o registra.

**Correção.** Pare o outro processo. Use o diretório de dados que pertence a este banco de dados. Nunca copie `storage-id` para outro diretório e nunca conecte duas instalações ao mesmo banco de dados.

### Permissões na raiz ou no diretório de dados {#root-permissions}

**Causa.** O `errno` é `EACCES` ou `EPERM`, ou o motivo é `Cannot read ARKVORY_KEYS_FILE (EACCES)`. A conta de serviço não pode ler a configuração nem gravar no diretório de dados. Causas típicas são uma instalação dentro de um perfil de usuário, uma pasta copiada manualmente, ou um proprietário alterado.

**Correção.**

- Linux: a raiz e `config/` pertencem a `root:arkvory` com modos 0750. `config/runtime.json` e `config/keys.json` têm modo 0640. `data/` e `logs/` pertencem a `arkvory:arkvory`.
- Windows: a conta `NT AUTHORITY\LocalService` deve ler todas as pastas pai da raiz e alterar `data\`, `logs\` e a caixa de entrada de atualizações. Execute o instalador gráfico novamente para restaurar as regras de acesso.
- Instale em uma pasta dedicada fora dos diretórios pessoais e dos perfis de usuário.

### Uma configuração ou um certificado é rejeitado {#invalid-configuration}

**Causa.** O motivo nomeia uma variável, por exemplo `Invalid ARKVORY_PORT`, ou um problema de certificado: `TLS certificate has expired`, `TLS certificate and key do not match`, `TLS key is not an unencrypted PEM private key`. O servidor nunca inicia em HTTP simples quando o certificado está errado.

**Correção.** Corrija a variável nomeada em `config/runtime.json`. Um valor fora do intervalo impede a inicialização. Renove ou substitua os arquivos de certificado. Use `arkvory configure --tls-off` para voltar ao HTTP simples enquanto corrige os arquivos. Consulte [Variáveis de ambiente](../reference/environment).

## O console não consegue alcançar a API {#console-unreachable}

| Mensagem no console         | Causa                                                                                                                                                                                                 | Correção                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [[ui:errorNetwork]]         | O navegador não recebe resposta: o serviço está parado, o endereço ou a porta está errado, um firewall o bloqueia, o servidor escuta somente em `127.0.0.1`, ou o certificado não corresponde ao nome | Teste `/health/status` no mesmo computador que o navegador. Verifique o serviço, o endereço de escuta e o firewall                           |
| [[ui:errorGateway]]         | Um proxy reverso responde, mas a API por trás dele não                                                                                                                                                | Verifique se a API está em execução e se o proxy aponta para a porta dela. Aumente o timeout de leitura do proxy para transferências grandes |
| [[ui:errorTimeout]]         | O servidor não respondeu a tempo                                                                                                                                                                      | Procure `upload.deadline` ou um banco de dados ocupado no log                                                                                |
| [[ui:errorUnavailable]]     | Uma dependência, como o banco de dados, está indisponível por um momento                                                                                                                              | Espere e tente novamente. Consulte [Ocupado e indisponível](#retry-after)                                                                    |
| [[ui:errorOriginForbidden]] | Um console externo roda em um endereço que `ARKVORY_CORS_ORIGINS` não lista                                                                                                                           | Adicione a origem exata (esquema, host e porta) e reinicie a API                                                                             |
| [[ui:sessionEnded]]         | Você saiu em outro lugar, a senha mudou, ou o acesso foi revogado                                                                                                                                     | Entre novamente                                                                                                                              |

Durante uma atualização, o console se reconecta sozinho. Não envie a solicitação de instalação novamente. Se o Docker Desktop for usado, o servidor fica indisponível até o Docker Desktop iniciar. Consulte [Docker](#docker).

## Problemas de login {#sign-in}

### Nome ou senha incorretos {#wrong-password}

**Causa.** A mensagem é [[ui:signInFailed]] (401 `invalid_credentials`). O servidor dá a mesma resposta para um nome errado, uma senha errada e uma conta desativada, para que ninguém possa descobrir quais nomes existem.

**Correção.** Um administrador pode verificar a conta em [[ui:administration]] e usar [[ui:enableUser]] se ela estiver desativada, ou [[ui:resetPassword]] para definir uma nova senha.

### Tentativas demais {#too-many-attempts}

**Causa.** A resposta é 429 `rate_limited` com `login_attempts` e `Retry-After`. O endereço usou suas 10 tentativas, ou a conta está em espera após muitas senhas erradas (até 2 minutos). Até a senha correta espera durante esse tempo.

**Correção.** Espere o número de segundos em `Retry-After`. Um administrador pode limpar a espera de uma conta redefinindo a senha. Reiniciar a API limpa os contadores dos endereços, mas não a espera de uma conta.

### Todos ficam bloqueados atrás de um proxy {#blocked-behind-proxy}

**Causa.** O servidor vê o endereço do proxy como o endereço de todos os clientes, então todos os clientes compartilham um único orçamento.

**Correção.** Defina `ARKVORY_TRUSTED_PROXIES` com os endereços do proxy e reinicie a API. O proxy deve enviar `X-Forwarded-For`. Consulte [Segurança](./security#sign-in-limits).

### O proprietário foi perdido {#owner-lost}

**Causa.** Ninguém lembra a senha de um administrador.

**Correção.** Use a chave de recuperação no servidor:

1. Leia a chave de `config/bootstrap-token.txt` como root ou Administrador.
2. No console, abra [[ui:keySignIn]], cole a chave e selecione [[ui:connect]].
3. Abra [[ui:administration]]. Use [[ui:resetPassword]] para a conta, ou [[ui:createUser]] para criar um novo administrador.
4. Selecione [[ui:disconnect]] e entre com a conta.

O formulário [[ui:welcomeOwner]] funciona somente enquanto o servidor não tem nenhuma conta.

### A chave de recuperação foi perdida {#recovery-key-lost}

**Causa.** O arquivo `config/bootstrap-token.txt` foi excluído ou nunca foi salvo. O servidor guarda apenas o hash da chave.

**Correção.** Com direitos de root ou Administrador no servidor, grave uma nova chave e seu hash. Consulte [Configuração](../install/configuration). Não exclua o arquivo novamente: as ferramentas de instalação o leem.

## Uploads {#uploads}

### Um upload não termina {#upload-stuck}

**Causa.** Há várias causas possíveis:

- O cliente perdeu a conexão. Um upload multipart mantém suas partes registradas por 7 dias.
- Um upload grande espera pelo worker. O worker está parado, ou falhou. Um segundo worker espera como standby.
- Uploads demais rodam ao mesmo tempo. Por padrão, 2 rodam, 1 por conta, e os outros esperam 20 segundos, depois recebem 503 `busy`.
- Um proxy reverso recusa um corpo grande (413) ou interrompe uma solicitação lenta (502 ou 504).

**Correção.**

1. Consulte o estado do upload: `arkvoryctl uploads status <id>`. Retome com o mesmo arquivo e o mesmo arquivo de estado. Consulte [Linha de comando](../protocols/cli#resume-interrupted-transfers).
2. Verifique o worker: `systemctl status arkvory-worker`, `Get-Service Arkvoryworker`. Procure `completion.failed` e `completion.attempts_exhausted` com o `uploadId`. A métrica `arkvory_completion_oldest_queued_seconds` mostra uma tarefa em espera.
3. Aumente os limites do proxy para o tamanho do corpo e o tempo de leitura. Uma solicitação de upload para após 30 segundos sem dados e após 30 minutos no total.
4. Uma sessão com mais de 7 dias não existe mais (409 `upload_expired`). Inicie um novo upload.

### integrity_mismatch {#integrity-mismatch}

**Causa.** A resposta é 422 `integrity_mismatch`, ou o cliente sai com código 5. Os bytes não correspondem ao tamanho declarado ou ao SHA-256. O arquivo mudou enquanto era enviado, o hash declarado foi calculado para outro arquivo, ou um proxy ou um dispositivo de rede alterou o corpo.

**Correção.** Envie o arquivo novamente a partir de uma cópia inalterada. A sessão permanece aberta, então um arquivo corrigido pode ser enviado para ela. Se um download falhar na verificação repetidas vezes, baixe-o mais uma vez por outro caminho e depois informe o ID da solicitação. Consulte [Logs e feedback](#logs-and-feedback).

## Ocupado, com limite de taxa, indisponível {#retry-after}

Os códigos `busy`, `unavailable` e `rate_limited` são temporários. A resposta tem o cabeçalho `Retry-After` e o campo `retryAfterSeconds`. Espere esse tempo. O SDK e o cliente de linha de comando repetem essas respostas um número limitado de vezes.

| Resposta                           | Causa                                                                                                                                                      | O que fazer                                                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 503 `busy`, reason `request_limit` | O servidor trata `ARKVORY_MAX_REQUESTS` solicitações ao mesmo tempo (128 por padrão)                                                                       | Espere. Aumente o limite apenas com memória suficiente. Verifique `arkvory_http_requests_in_flight`                                                      |
| 503 `busy`                         | A fila de transferência está cheia, uma transferência esperou mais que `ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS` (20 s), ou o servidor drena antes de uma parada | Espere e repita. Aumente `ARKVORY_MAX_UPLOADS` ou `ARKVORY_MAX_DOWNLOADS` se for frequente. `arkvory_transfer_admission_failures_total` conta as recusas |
| 503 `unavailable`                  | O banco de dados reinicia, o processo perdeu a posse do armazenamento, ou o hub está inacessível (`hub_unreachable`)                                       | Espere. Os serviços reiniciam sozinhos. Consulte [Autorrecuperação](./self-healing)                                                                      |
| 429 `rate_limited`                 | Tentativas demais de login, registro, senha ou feedback                                                                                                    | Espere. Consulte [Tentativas demais](#too-many-attempts)                                                                                                 |

Um 500 `internal` não tem `Retry-After`. Não o repita às cegas. Procure o ID da solicitação dele no log e informe-o.

## Disco cheio e cota {#disk-full}

| Resposta, motivo    | Causa                                                                                                                                                        | Correção                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| 507 `storage_full`  | O espaço livre do volume de armazenamento está abaixo da reserva `ARKVORY_STORAGE_RESERVE_BYTES` (1 GiB por padrão), ou o disco do banco de dados está cheio | Libere espaço no volume. Verifique `df -h` ou `Get-PSDrive`, e o volume do PostgreSQL               |
| 507 `storage_quota` | A cota do repositório foi esgotada                                                                                                                           | Exclua builds antigos, altere a política de retenção, ou aumente a cota em [[ui:repositoryStorage]] |
| 507 `catalog_limit` | A soma de todo o conteúdo reservado ultrapassaria `ARKVORY_CAPACITY_BYTES` (10 TiB por padrão)                                                               | Exclua conteúdo, ou aumente o valor em `config/runtime.json`                                        |
| 507 `queue_full`    | Uma conta tem 100 tarefas de conclusão abertas, ou o servidor tem 10.000                                                                                     | Espere o worker concluí-las                                                                         |

Enquanto o disco está cheio, os downloads e o console continuam funcionando. `/health/ready` mostra `"writable": false`. Excluir um artefato no Arkvory não libera o disco imediatamente: o arquivo espera a limpeza física após o período de carência. Consulte [Armazenamento](./storage). Não reduza a reserva para espremer mais dados, porque o banco de dados e os logs precisam dela.

## Backups falham {#backups-failing}

Comece pelo aviso em [[ui:backups]] ou `arkvoryctl backup status`, e pelos eventos de log `backup.request.failed` e `backup.agent.failed` com seus `errorCode`. Consulte [Backups](./backups).

| Aviso ou mensagem                                                                   | Causa                                                                                                | Correção                                                                                                                                          |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_offline`                                                                     | O serviço de backup está parado, ou falha ao iniciar                                                 | Inicie `arkvory-backup` ou `Arkvorybackup`. Leia o log dele                                                                                       |
| `vault_unavailable`                                                                 | O volume do vault não está montado, não tem `vault.json`, ou a conta de serviço não pode gravar nele | Monte o volume antes de o serviço iniciar. Verifique o proprietário e as permissões. No Windows, reinicie o agente se o volume foi montado depois |
| `The vault directory does not exist; create it or mount its volume first`           | O caminho está errado ou o volume está ausente                                                       | Crie ou monte o diretório                                                                                                                         |
| `The vault directory is not writable`                                               | A conta de serviço não tem acesso de gravação                                                        | No Linux, monte um compartilhamento com `uid` e `gid` do usuário `arkvory`. No Windows, use um volume local ou iSCSI                              |
| `The directory has no vault.json: mount the vault volume, or pass --init-vault ...` | Um diretório vazio pode ser um compartilhamento não montado, então o comando o recusa                | Monte o volume certo, ou passe `--init-vault --vault-no-encryption` para um vault vazio novo                                                      |
| `The vault must be outside the installation root and the storage directory`         | O vault se sobrepõe aos dados                                                                        | Escolha um diretório separado em outro volume                                                                                                     |
| `Network share paths are not supported ...`                                         | Um caminho UNC no Windows. `LocalService` não consegue entrar em compartilhamentos SMB               | Use uma letra de unidade de um volume local ou iSCSI                                                                                              |
| `The backup service cannot reach /home, /root, /run/user, /tmp or /var/tmp`         | O sandbox do systemd oculta essas pastas                                                             | Escolha outro diretório                                                                                                                           |
| `vault_full`, `vault_low_space`                                                     | O volume do vault está quase cheio                                                                   | Libere espaço ou mantenha menos pontos. Os pontos anteriores permanecem intactos                                                                  |
| `vault_key_missing`, `vault_key_invalid`                                            | O vault é criptografado e o agente não tem chave, ou tem a errada                                    | Execute `arkvory configure --backup-vault DIR --vault-key-file FILE` com a chave do agente. Veja [Criptografar o vault](./backups#encryption)     |
| `last_run_failed`                                                                   | O backup mais recente falhou                                                                         | Leia o `errorCode` com `arkvoryctl backup jobs`                                                                                                   |
| `verify_failed`                                                                     | Um ponto falhou na verificação                                                                       | Não altere o vault. Mantenha-o para análise e informe-o                                                                                           |

`arkvory configure --backup-vault` restaura as configurações antigas quando o agente não informa o novo vault em 150 segundos. Uma atualização para o agente de backup, então um backup que roda naquele momento é repetido depois. Quando as atualizações automáticas estão ativadas, mantenha o horário do backup fora da hora de atualização (03:00 UTC por padrão).

## Um espelho não sincroniza {#mirror-not-syncing}

Observe o selo [[ui:mirrorFailing]] no repositório, em `GET /api/v1/repositories/{repository}/mirror` e nos eventos do worker `mirror.step_failed`. Os downloads continuam funcionando a partir do que está copiado. Consulte [Espelhos](./mirrors).

| `errorCode`                                                                    | Causa                                                                                     | Correção                                                                                                                                              |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mirror_failed`, or a code of the source such as `unauthorized` or `forbidden` | A origem está inacessível, a chave dela está errada ou expirou, ou ela não tem um direito | Teste a origem com a chave. Substitua a chave com `arkvory configure --mirror ... --mirror-token-file`. O worker lê a chave novamente após cada falha |
| `mirror_mismatch`                                                              | O mesmo ID tem outro conteúdo na origem                                                   | A cópia é mantida. Investigue o artefato                                                                                                              |
| `mirror_source_changed`                                                        | O repositório já contém uma cópia de outra origem                                         | Desvincule com `--mirror-detach` e espelhe a nova origem em um novo repositório                                                                       |
| `mirror_source_behind`                                                         | A origem foi restaurada ou reinstalada                                                    | Ela se re-semeia sozinha e o código desaparece                                                                                                        |
| A certificate error                                                            | A origem usa um certificado da empresa ou autoassinado                                    | Passe `--mirror-ca-file` para `arkvory configure`. A verificação nunca é desativada                                                                   |

A origem precisa de um release com o feed de espelho. O worker espera 2 segundos após uma falha, dobrando até 5 minutos. `ArkvoryMirrorStale` dispara após uma hora sem uma atualização.

## Uma atualização falhou {#update-failed}

1. Leia a falha. No console, [[ui:updates]] mostra uma mensagem. O atualizador grava `logs\updater.log` no Windows, e `journalctl -u arkvory-update` no Linux.
2. Verifique a versão instalada: `arkvory status --root <root>`.
3. Encontre o seu caso.

| Caso                                                            | O que aconteceu                                                                                                     | O que fazer                                                                                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Mesmo esquema de banco de dados, falha normal                   | O instalador iniciou a versão anterior novamente                                                                    | Corrija a causa e atualize novamente                                                                                                          |
| O console mostra [[ui:updateMaintenance]]                       | Um release com mudança de esquema precisa de um backup verificado, e o instalador recusou antes de qualquer mudança | Conecte um vault, espere o primeiro backup, verifique novamente                                                                               |
| A migração falhou                                               | A transação dela foi revertida, e a versão anterior roda no esquema anterior                                        | Corrija a causa e atualize novamente                                                                                                          |
| A nova versão não iniciou após uma migração bem-sucedida        | O journal diz `maintenance-required` e nomeia um ponto de backup                                                    | Corrija a causa e execute `recover`, que conclui a atualização. Ou restaure o ponto com a versão anterior                                     |
| O atualizador foi morto ou a máquina perdeu energia             | O bloqueio `operation.lock` e o journal permanecem. Nada continua sozinho                                           | O procedimento abaixo                                                                                                                         |
| O console mostra [[ui:updateStale]] ou [[ui:updateUnavailable]] | O agendador do host não está em execução ou não está conectado                                                      | Verifique a tarefa `ProAnimaArkvoryUpdate` (Windows) ou `arkvory-update.timer` (Linux). Conecte-a com `arkvory updates-connect --root <root>` |

Após um atualizador interrompido:

1. Pare o agendador e certifique-se de que nenhum atualizador esteja em execução. Salve `journal.json` e os logs.
2. Só então exclua o arquivo `operation.lock` na raiz da instalação. Nunca o exclua enquanto uma atualização estiver em execução.
3. Execute `recover`:

   ```bash
   sudo arkvory recover --root /opt/proanima-arkvory
   ```

   ```powershell
   & 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' recover --root C:\ProgramData\ProAnima\Arkvory
   ```

   Antes de a migração começar, ele restaura a versão anterior. Depois de a migração começar, ele repete a migração e inicia a nova versão.

4. Verifique `/health/ready`, a fila de conclusão e um download de teste. Depois, ligue o agendador novamente.

`arkvory updates-reset --root <root>` limpa uma solicitação de atualização aceita depois que você reconciliou o estado. Não é possível fazer downgrade. Consulte [Atualizações](../install/updates).

## Docker {#docker}

- **Nada roda após reiniciar o Windows.** O Docker Desktop inicia quando o usuário entra. Ative **Start Docker Desktop when you sign in**, ou use os serviços nativos.
- **Nada roda após reiniciar um host Linux.** Verifique se o mecanismo inicia no boot: `systemctl is-enabled docker`.
- **Um contêiner não consegue ler um arquivo em `config/`.** Os contêineres rodam como o usuário `node` (uid 1000). O instalador torna `runtime.json`, `keys.json` e `health-token.txt` legíveis para ele. Se uma edição manual alterou o proprietário ou o modo para 0600, a API para com `Cannot read ARKVORY_KEYS_FILE (EACCES)`. Restaure o modo 0644 desses três arquivos. A pasta `config/` em si permanece fechada.
- **O vault não é gravável.** O agente roda como uid 1000, então o vault deve pertencer a ele. `arkvory configure --backup-vault` configura isso com o arquivo `config/compose.vault.yml`. Um compartilhamento que você mesmo monta precisa de `uid=1000`. Inclua `-f config/compose.vault.yml` em todo comando Compose manual, ou `up` cria o contêiner de backup sem o vault.
- **Um contêiner está `unhealthy`.** A verificação de integridade chama `/health/ready` a cada 10 segundos. O Docker marca o contêiner, mas não o reinicia. Leia o log do contêiner da API.

Mostre o log de um contêiner:

```bash
docker logs --tail 100 proanima-arkvory-api-1
```

## Um serviço do Windows não inicia {#windows-service}

1. Leia o estado e a saída de erro:

   ```powershell
   Get-Service Arkvoryapi, Arkvoryworker, Arkvorybackup, Arkvorydatabase
   Get-Content C:\ProgramData\ProAnima\Arkvory\logs\arkvory-api.err.log -Tail 50
   ```

2. Abra o Visualizador de Eventos do Windows, **Windows Logs > System**, e procure eventos do Gerenciador de Controle de Serviços.
3. Encontre a sua causa:

| Causa                                                                                        | Correção                                                                            |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| A raiz está dentro de um perfil de usuário, ou `LocalService` não consegue ler uma pasta pai | Instale em uma pasta dedicada. Consulte [Permissões](#root-permissions)             |
| A porta está ocupada                                                                         | Consulte [A porta está ocupada](#port-busy)                                         |
| O serviço de banco de dados não está em execução                                             | Inicie `Arkvorydatabase`. A API tenta novamente a cada 10 segundos                  |
| Os serviços iniciaram "tarde" após um boot                                                   | O tipo de inicialização deles é Automático (Início Atrasado). Espere alguns minutos |
| O software antivírus colocou o Node.js em quarentena                                         | Permita os arquivos em `runtime\`                                                   |
| `Another installation owns this service`                                                     | Existem serviços de uma instalação em outra raiz. Remova-os primeiro                |
| Um serviço permanece parado                                                                  | Você ou uma atualização o parou. Inicie-o com `Start-Service`                       |

Execute o instalador gráfico novamente para restaurar os tipos de inicialização e as ações de recuperação dos serviços. Consulte [Windows](../install/windows).

## Logs, IDs de solicitação e feedback {#logs-and-feedback}

**Encontre os logs.** Linux: `journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup`. Windows: `logs\` na raiz da instalação. Compose: `docker logs <container>`. Os formatos e os eventos estão em [Monitoramento](./monitoring#logs).

**Encontre o ID da solicitação.** Toda resposta tem o cabeçalho `X-Request-Id`. Todo corpo de erro tem `requestId`. O console o mostra como [[ui:requestIdLabel]] sob a mensagem, e o cliente de linha de comando o imprime na linha de erro. Procure esse valor nos logs da API e do worker para ver a solicitação e as tarefas que ela iniciou.

**Envie feedback com logs.**

1. Entre e selecione [[ui:reportOpen]] na barra superior.
2. Descreva o problema e adicione o ID da solicitação. Você pode adicionar até 6 capturas de tela.
3. Se você for administrador, ative [[ui:reportServerLog]]. Isso anexa as linhas de log mais recentes da API (cerca de 1,5 MiB) e um resumo do sistema sem endereços e segredos.
4. Selecione [[ui:reportShow]] para ver exatamente o que será enviado, depois [[ui:reportSend]].

O servidor envia o relatório ao hub da ProAnimaStudio. Se o hub não puder ser alcançado ou o feedback estiver desativado, o console mostra o endereço `info@proanima.net` para escrever. Consulte [Segurança](./security#hub) para saber o que é enviado.

## Páginas relacionadas {#related-pages}

- [Monitoramento](./monitoring)
- [Autorrecuperação](./self-healing)
- [Segurança](./security)
- [Erros](../api/errors)
- [Windows](../install/windows)
