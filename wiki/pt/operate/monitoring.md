---
title: Monitoramento
description: 'Endpoints de saúde, métricas, logs, diagnósticos do console e uma lista sugerida de alertas para um servidor Arkvory.'
---

# Monitoramento

O Arkvory oferece quatro fontes de fatos: endpoints de saúde que respondem "está no ar", métricas do Prometheus, linhas de log em JSON e os diagnósticos do console. Esta página lista o que cada fonte contém e termina com um conjunto de alertas para começar.

As métricas, os endpoints de saúde e os eventos de log descrevem um processo de API. O worker e o agente de backup não têm porta HTTP. Você os vê por meio de linhas de log, das métricas da fila de conclusão e do status de backup.

## Verificar um servidor agora {#quick-check}

1. Consulte o endpoint de status público. Ele não precisa de chave:

   ```bash
   curl -fsS http://127.0.0.1:8080/health/status
   ```

   `{"status":"ready"}` com HTTP 200 significa que a API alcança seu banco de dados e seu diretório de armazenamento.

2. Peça a resposta completa de prontidão com a chave de saúde que o instalador criou:

   ```bash
   sudo sh -c 'curl -fsS -H "Authorization: Bearer $(cat /opt/proanima-arkvory/config/health-token.txt)" http://127.0.0.1:8080/health/ready'
   ```

   ```powershell
   $root = 'C:\ProgramData\ProAnima\Arkvory'
   $key = (Get-Content "$root\config\health-token.txt" -Raw).Trim()
   Invoke-RestMethod -Headers @{ Authorization = "Bearer $key" } http://127.0.0.1:8080/health/ready
   ```

3. Verifique os backups:

   ```bash
   arkvoryctl backup status
   ```

   O comando precisa da chave de recuperação ou da sessão de um administrador. Ele sai com código 9 quando um aviso crítico está ativo. Para verificações não assistidas, use os alertas do Prometheus abaixo. Consulte [Linha de comando](../protocols/cli).

4. Verifique os serviços e as linhas de log mais recentes. Consulte [Logs](#logs).

`arkvory status --root <root>` mostra a versão instalada, o modo de instalação e a política de atualização. Ele não sonda o servidor. `arkvoryctl doctor` mostra o servidor, o repositório, as capacidades e as permissões de uma chave. É uma verificação de cliente, não uma verificação de saúde.

## Saúde e prontidão {#health}

Três endpoints respondem na porta da API. Nenhum deles conta para o orçamento de solicitações `ARKVORY_MAX_REQUESTS`, então uma carga de transferências não pode fazer um servidor parecer morto. Os três continuam respondendo enquanto o servidor drena antes de parar.

| Caminho          | Chave                 | Resposta                                                                                                    | Use para                                                |
| ---------------- | --------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `/health/live`   | Não                   | 200 `{"status":"ok"}` enquanto o processo responde                                                          | Uma verificação de processo                             |
| `/health/status` | Não                   | 200 `{"status":"ready"}`, ou 503 `{"status":"unavailable"}` ou `{"status":"draining"}` com `Retry-After: 2` | Balanceadores de carga e sondagens de disponibilidade   |
| `/health/ready`  | Qualquer chave válida | 200 com os detalhes abaixo, ou 503 com o envelope de erro e `Retry-After`                                   | Verificações de implantação e o health check do Compose |

`/health/status` e `/health/ready` verificam três coisas: o banco de dados responde e tem exatamente as migrações desta versão, a pasta `blobs` do diretório de armazenamento existe, e o processo ainda possui seu bloqueio de armazenamento. O resultado de `/health/status` é armazenado em cache por um segundo, então sondagens públicas não podem multiplicar as consultas ao banco de dados. Um servidor em drenagem responde `draining` imediatamente.

Sem uma chave, `/health/ready` retorna 401. A chave `deployment-health` que o instalador cria não tem direitos de repositório nem direitos de administrador. Seu segredo está em `config/health-token.txt`.

Uma resposta 200 de `/health/ready` tem estes campos:

| Campo             | Significado                                                                                                                                                                                                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`          | Sempre `ready` em uma resposta 200                                                                                                                                                                                                                                                                                                        |
| `writable`        | `false` quando o espaço livre do volume de armazenamento está abaixo de `ARKVORY_STORAGE_RESERVE_BYTES`, e em um gateway de leitura. As leituras ainda funcionam                                                                                                                                                                          |
| `role`            | `api`, ou `reader` para um gateway de leitura                                                                                                                                                                                                                                                                                             |
| `sharedDownloads` | O lease de um gateway de leitura (`slot`, `slots`, `active`, `leaseSeconds`), ou `null`                                                                                                                                                                                                                                                   |
| `transfers`       | Para `uploads` e `downloads`: `admission` (`active`, `waiting`, `capacity`, `perPrincipalCapacity`, `waitingCapacity`, `perPrincipalWaitingCapacity`, `timeoutMs`, `rejected`, `timedOut`, `cancelled`) e `bandwidth` (`bytesPerSecond`, `perPrincipalBytesPerSecond`, `burstBytes`, `perPrincipalBurstBytes`, `waiting`, `grantedBytes`) |

Uma verificação de prontidão malsucedida, sozinha, nunca reinicia um serviço. Consulte [Autorrecuperação](./self-healing).

## Métricas {#metrics}

`GET /health/metrics` retorna as métricas do processo da API no formato de texto do Prometheus (versão 0.0.4). Qualquer chave válida pode lê-lo, e ele funciona enquanto o servidor drena. Crie uma chave de serviço com os mínimos direitos para o coletor e mantenha-a em um arquivo que somente o Prometheus lê.

```yaml
scrape_configs:
  - job_name: arkvory
    metrics_path: /health/metrics
    scheme: https
    authorization:
      credentials_file: /etc/prometheus/arkvory.key
    static_configs:
      - targets: ['arkvory.example:443']
```

O job deve se chamar `arkvory`: as regras de alerta fornecidas o selecionam pelo nome.

Os valores pertencem ao processo e começam do zero após uma reinicialização. `arkvory_process_start_time_seconds` muda quando isso acontece. Os rótulos são limitados: `route` é o modelo da rota, nunca a URL, e `status_class` é `2xx`, `5xx` e assim por diante.

| Métrica                                                                                     | Rótulos                                                    | Significado                                                                               |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `arkvory_http_requests_total`                                                               | `method`, `route`, `status_class`                          | Respostas encerradas                                                                      |
| `arkvory_http_request_duration_seconds`                                                     | mesma                                                      | Histograma de duração de 5 ms a 1800 s. Transferências abortadas são incluídas            |
| `arkvory_http_request_bytes_total`, `arkvory_http_response_bytes_total`                     | `method`, `route`                                          | Bytes do socket, cabeçalhos incluídos                                                     |
| `arkvory_http_requests_in_flight`                                                           |                                                            | Solicitações admitidas cujas respostas ainda estão abertas                                |
| `arkvory_transfer_active`, `arkvory_transfer_queue_depth`                                   | `direction`                                                | Transferências admitidas e transferências que esperam por uma vaga                        |
| `arkvory_transfer_admission_failures_total`                                                 | `direction`, `reason`                                      | Transferências recusadas pela admissão: `rejected` (fila cheia), `timed_out`, `cancelled` |
| `arkvory_completion_jobs`                                                                   | `state` (`queued`, `running`)                              | Tarefas de conclusão de upload no banco de dados                                          |
| `arkvory_completion_oldest_queued_seconds`                                                  |                                                            | Espera da tarefa enfileirada executável mais antiga                                       |
| `arkvory_diagnostic_records_total`                                                          | `outcome` (`written`, `dropped`, `truncated`, `oversized`) | Linhas de log por resultado                                                               |
| `arkvory_metrics_collection_failures_total`                                                 | `collector` (`jobs`, `backup`, `mirror`)                   | Leituras com falha de métricas respaldadas pelo banco de dados                            |
| `arkvory_backup_last_success_timestamp_seconds`                                             |                                                            | Horário do snapshot do ponto de backup concluído mais recente                             |
| `arkvory_backup_agent_last_seen_timestamp_seconds`                                          |                                                            | Último heartbeat do agente de backup                                                      |
| `arkvory_backup_warnings`                                                                   | `code`                                                     | 1 enquanto o aviso está ativo, 0 caso contrário                                           |
| `arkvory_mirror_last_sync_timestamp_seconds`, `arkvory_mirror_last_check_timestamp_seconds` | `repository`, `mode`                                       | Última atualização com a origem e última leitura de seu feed                              |
| `arkvory_mirror_failing`                                                                    | `repository`, `mode`                                       | 1 enquanto a última tentativa de sincronização falhou                                     |
| `arkvory_tls_certificate_expiry_timestamp_seconds`                                          |                                                            | Expiração do certificado HTTPS embutido. Presente apenas com HTTPS embutido               |
| `arkvory_build_info`                                                                        | `service`, `version`                                       | Sempre 1                                                                                  |
| `arkvory_process_start_time_seconds`, `arkvory_process_resident_memory_bytes`               |                                                            | Horário de início e memória residente                                                     |

As métricas respaldadas pelo banco de dados (conclusão, backup, espelho) são lidas no máximo a cada 5 segundos. Quando uma leitura falha, o servidor omite essas métricas em vez de mostrar valores antigos, e `arkvory_metrics_collection_failures_total` cresce.

O 99º percentil das solicitações de controle, sem transferências de arquivos:

```text
histogram_quantile(0.99, sum by (le) (rate(arkvory_http_request_duration_seconds_bucket{route!~".*(content|parts).*"}[10m])))
```

O Arkvory não exporta o espaço livre do volume de armazenamento nem do banco de dados. Use `node_exporter` para os volumes e `postgres_exporter` para o PostgreSQL.

## Logs {#logs}

A API, o worker, o agente de backup e as ferramentas de manutenção gravam um objeto JSON por linha na saída padrão. O servidor não grava arquivos de log por conta própria. O gerenciador de serviços da sua plataforma coleta as linhas.

| Instalação                    | Onde ler                                                                                                                                                                                                                                                      | Rotação                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Linux (pacotes, `install.sh`) | `journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup`. O banco de dados gerenciado é `arkvory-database`, o atualizador é `arkvory-update`                                                                                                           | Definida pelo journald                          |
| Windows                       | `logs\arkvory-api.out.log`, `arkvory-worker.out.log`, `arkvory-backup.out.log` na raiz da instalação. A saída de erro vai para os arquivos `.err.log` ao lado deles. O atualizador grava `logs\updater.log`, o serviço de banco de dados grava em `database\` | 20 MiB por arquivo, 5 arquivos antigos mantidos |
| Docker Compose                | `docker logs --tail 100 proanima-arkvory-api-1`, e o mesmo para `-worker-1` e `-backup-1`                                                                                                                                                                     | 20 MiB por arquivo, 5 arquivos por contêiner    |

Um travamento encerra um processo com o registro `process.stalled` na saída de erro, então verifique também o arquivo `.err.log` ou o journal. Consulte [Windows](../install/windows#logs) para os outros arquivos em `logs\`.

Toda linha começa com os mesmos campos:

| Campo                        | Valor                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `timestamp`                  | Horário UTC em ISO 8601                                                                                      |
| `level`                      | `debug`, `info`, `warning` ou `error`                                                                        |
| `service`                    | `api`, `worker`, `backup`, `migrate`, `gc` ou `scrub`                                                        |
| `version`, `pid`, `hostname` | Versão, processo e host                                                                                      |
| `component`                  | `api`, `http`, `storage`, `worker`, `maintenance`, `backup`, `mirror`, `migrate`, `process` ou `diagnostics` |
| `code`                       | O nome do evento                                                                                             |

Outros campos vêm de uma lista fixa: identificadores (`requestId`, `traceId`, `jobId`, `uploadId`, `artifactId`, `repository`, `principal`, `clientIp`), números (`status`, `durationMs`, `bytesSent`, `bytesReceived`, `attempts`) e campos de motivo (`errorCode`, `errorName`, `errno`, `sqlstate`, `reason`). `ARKVORY_LOG_LEVEL` define o nível mais baixo que é gravado.

### Eventos importantes {#log-events}

| Evento (`code`)                                                                                       | Nível                            | Significado e primeira ação                                                                                                                       |
| ----------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api.listening`                                                                                       | info                             | A API atende solicitações. Campos `address`, `port` e `tls`                                                                                       |
| `startup.failed`                                                                                      | error                            | A API não iniciou. `reason` indica a causa. Consulte [Solução de problemas](./troubleshooting#server-does-not-start)                              |
| `worker.unavailable`                                                                                  | error                            | O worker não iniciou ou parou com um erro                                                                                                         |
| `http.plaintext_exposed`                                                                              | warning                          | A API escuta em um endereço que não é loopback sem TLS e sem um proxy confiável                                                                   |
| `http.access`                                                                                         | info                             | Uma linha por solicitação concluída ou abortada                                                                                                   |
| o código de erro de uma solicitação, por exemplo `unavailable` ou `internal`                          | warning para 4xx, error para 5xx | Uma solicitação com falha, com `requestId`, `route`, `status` e, para erros de sistema, `errorName`, `errno` ou `sqlstate`                        |
| `upload.input_timeout`, `upload.deadline`                                                             | warning                          | Um upload parou de enviar dados, ou demorou mais que `ARKVORY_UPLOAD_DEADLINE_MS`                                                                 |
| `api.ownership_lost`, `worker.ownership_lost`                                                         | error                            | A sessão de banco de dados que comprova a propriedade do armazenamento caiu. O processo sai e reinicia                                            |
| `process.stalled`                                                                                     | error                            | O watchdog encerrou um processo travado. Campo `stalledSeconds`                                                                                   |
| `process.unhandled`                                                                                   | error                            | Um erro inesperado encerrou o processo                                                                                                            |
| `process.watchdog_failed`                                                                             | warning                          | O watchdog não pôde iniciar. O serviço funciona sem ele                                                                                           |
| `drain.started`, `drain.settled`, `drain.timeout`, `api.stopped`                                      | info ou warning                  | Uma parada graciosa. `drain.timeout` significa que solicitações foram cortadas                                                                    |
| `tls.reloaded`, `tls.reload_failed`, `tls.expiring`                                                   | info ou warning                  | Os arquivos de certificado foram lidos novamente, não puderam ser lidos, ou expiram em menos de 14 dias. `tls.expiring` se repete uma vez por dia |
| `completion.completed`, `completion.failed`, `completion.lease_lost`, `completion.attempts_exhausted` | info ou error                    | O resultado de uma tarefa de conclusão de upload, com `jobId`, `uploadId` e `errorCode`                                                           |
| `backup.agent.started`, `backup.agent.standby`, `backup.agent.lease_lost`                             | info ou warning                  | Estado do agente de backup                                                                                                                        |
| `backup.request.failed`, `backup.request.requeued`, `backup.failed`                                   | error ou warning                 | Uma tarefa de backup falhou ou roda novamente. Campo `errorCode`                                                                                  |
| `mirror.step_failed`, `mirror.recovered`                                                              | warning ou info                  | Uma etapa da sincronização de espelho falhou (`errorCode`, `attempts`), ou voltou a funcionar                                                     |
| `migrate.started`, `migrate.completed`, `migrate.failed`                                              | info ou error                    | A migração de banco de dados de uma atualização                                                                                                   |
| `diagnostics.dropped`, `diagnostics.oversized`                                                        | warning                          | Linhas foram descartadas porque o leitor de log é muito lento, ou uma linha era muito longa                                                       |

Um leitor de log lento nunca desacelera uma transferência. Quando a saída está bloqueada, o servidor descarta linhas, as conta e grava `diagnostics.dropped` com o número depois que a saída fica livre novamente. Uma linha com mais de 4096 caracteres é substituída por `diagnostics.oversized`. Campos de texto são cortados em 256 caracteres.

### IDs de solicitação {#request-ids}

Toda resposta carrega o cabeçalho `X-Request-Id`, e todo corpo de erro tem o campo `requestId`. O mesmo valor está na linha `http.access`, na linha de erro, nas linhas da tarefa de conclusão que a solicitação iniciou e nos registros de auditoria. Um cliente que relata um problema precisa informar apenas esse valor.

```bash
journalctl -u arkvory-api -u arkvory-worker --since "1 hour ago" -o cat | grep 'REQUEST_ID'
```

```powershell
Select-String -Path "$root\logs\*.log" -Pattern 'REQUEST_ID'
```

Atrás de um proxy reverso, o servidor aceita um `X-Request-Id` de entrada somente de um endereço em `ARKVORY_TRUSTED_PROXIES`, e apenas se for um valor único de 8 a 128 caracteres (letras, dígitos, `.`, `_`, `:` e `-`). Deixe o proxy sobrescrever o cabeçalho, por exemplo com `proxy_set_header X-Request-Id $request_id;` no nginx. Um cabeçalho `traceparent` W3C válido de qualquer cliente se torna o campo `traceId`. Ele serve apenas para busca e nunca concede nada.

### O que nunca é registrado {#never-logged}

O log não tem senhas, chaves, tokens, cabeçalhos `Authorization`, corpos de solicitação, strings de consulta, URLs nem textos de exceção. Os links de download carregam um segredo na string de consulta, então apenas o modelo da rota é registrado. O campo `reason` é o único texto livre. Ele é anonimizado e cortado em 240 caracteres. A linha mostra o `principal` (o ID de uma conta ou chave) e o `clientIp`. Trate o log como dado pessoal.

`ARKVORY_ACCESS_LOG=false` desativa `http.access`. Solicitações bem-sucedidas a `/health/live` e `/health/status` nunca são registradas. Os níveis `warning` e `error` também ocultam as linhas de acesso.

## Diagnósticos no console {#console}

Os administradores veem o estado do servidor no console sem um shell. Consulte [O console web](../guide/console).

| Onde                                        | O que você vê                                                                                                                                                                                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [[ui:backups]]                              | O título indica [[ui:backupStateOk]], [[ui:backupStateWarning]] e [[ui:backupStateCritical]]. Abaixo estão o backup [[ui:backupNewest]], o [[ui:backupNextRun]], o [[ui:backupAgent]], o [[ui:backupVault]] e a lista de avisos com a ação de cada um |
| [[ui:updates]]                              | A versão instalada e a mais recente, o horário da última verificação e o estado do atualizador do host                                                                                                                                                |
| [[ui:repositoryStorage]] de um repositório  | O uso da cota com os estados [[ui:storageWarning]] e [[ui:storageCritical]], e a lista [[ui:storageEvents]]                                                                                                                                           |
| [[ui:serviceAudit]] de uma conta de serviço | Quem criou, alterou, emitiu ou revogou o quê                                                                                                                                                                                                          |
| O cartão do repositório                     | O selo [[ui:mirrorBadge]], com o estado [[ui:mirrorFailing]] quando a última sincronização falhou                                                                                                                                                     |

A lista [[ui:storageEvents]] precisa da permissão para ler diagnósticos. Entre outros eventos, ela contém as solicitações de chaves de serviço com falha naquele repositório, com o ID da solicitação, a rota e o status.

Os limites de cota são 80 % para o aviso e 95 % para o estado crítico, a menos que um administrador os tenha alterado. Um repositório sem cota não tem limites.

## Avisos de armazenamento e disco {#storage}

O servidor mantém `ARKVORY_STORAGE_RESERVE_BYTES` (1 GiB por padrão) de espaço livre no volume de armazenamento para o banco de dados, os logs e o sistema. Abaixo dessa reserva:

- `/health/ready` informa `"writable": false`, mas ainda responde 200.
- Os uploads falham com 507 e o motivo `storage_full`. Downloads e o console continuam funcionando.

O servidor não mede o espaço livre por você. Monitore o volume de armazenamento, o volume do banco de dados e o volume de backup com suas próprias ferramentas, e alerte antes que a reserva seja atingida. A reserva não é uma cota. `ARKVORY_CAPACITY_BYTES` limita a soma do conteúdo reservado e não é uma verificação de disco. Consulte [Armazenamento](./storage).

## Saúde dos backups {#backup-health}

O agente de backup envia um heartbeat a cada renovação de lease. A API transforma o heartbeat e o histórico de tarefas de backup em avisos com códigos fixos. Consulte [Backups](./backups) para saber o que cada código pede que você faça.

| Código                                                                          | Gravidade | Condição                                                                               |
| ------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------- |
| `agent_offline`                                                                 | critical  | Nenhum heartbeat por 2 minutos                                                         |
| `backup_stale`                                                                  | critical  | O ponto mais recente é mais antigo que 26 horas e o plano está ativado                 |
| `vault_unavailable`                                                             | critical  | O volume do vault não está montado, não tem `vault.json` ou não pode ser gravado       |
| `verify_failed`                                                                 | critical  | Um ponto de restauração falhou em sua verificação                                      |
| `vault_not_configured`, `schedule_disabled`, `no_backup_yet`, `last_run_failed` | warning   | Sem vault, plano desativado, sem primeiro backup, último backup falhou                 |
| `vault_low_space`                                                               | warning   | O vault tem menos de 10 % livres, ou menos que o dobro dos novos bytes do último ponto |
| `never_deep_verified`                                                           | warning   | Nenhuma verificação completa por mais de 8 dias                                        |

A métrica `arkvory_backup_warnings` carrega os mesmos códigos. A idade de um backup conta a partir de seu horário de snapshot, não do momento em que ele terminou.

## Alertas sugeridos {#alerts}

A versão contém regras do Prometheus prontas em `releases/<version>/deploy/monitoring/arkvory-alerts.yml`. Adicione o arquivo a `rule_files` no `prometheus.yml`. Os limites são pontos de partida. Ajuste-os com o tráfego que você mede.

| Alerta                                                          | Condição                                                                      | Gravidade         |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------- |
| `ArkvoryDown`                                                   | A coleta falha por 2 minutos                                                  | Critical          |
| `ArkvoryHighServerErrorRate`                                    | Mais de 5 % das respostas são 5xx por 10 minutos                              | Warning           |
| `ArkvorySlowMetadataRequests`                                   | O 99º percentil das solicitações de controle fica acima de 2 s por 15 minutos | Warning           |
| `ArkvoryCompletionBacklog`                                      | A tarefa de conclusão enfileirada mais antiga espera mais de 10 minutos       | Warning           |
| `ArkvoryTransferAdmissionRejections`                            | Mais de 0,1 transferências recusadas ou expiradas por segundo por 15 minutos  | Warning           |
| `ArkvoryDiagnosticsDropped`                                     | Linhas de log foram descartadas nos últimos 15 minutos                        | Warning           |
| `ArkvoryMetricsCollectionFailing`                               | Uma métrica respaldada pelo banco de dados não pôde ser lida                  | Warning           |
| `ArkvoryTlsCertificateExpiring`, `ArkvoryTlsCertificateExpired` | O certificado embutido expira em menos de 14 dias, ou expirou                 | Warning, critical |
| `ArkvoryBackupStale`                                            | O ponto mais recente é mais antigo que 26 horas                               | Critical          |
| `ArkvoryBackupAgentOffline`                                     | Nenhum heartbeat por mais de 2 minutos, por 5 minutos                         | Critical          |
| `ArkvoryBackupWarning`                                          | `vault_unavailable` ou `verify_failed` por 10 minutos                         | Critical          |
| `ArkvoryMirrorStale`                                            | Um espelho não se atualizou com sua origem por uma hora                       | Warning           |
| `ArkvoryMirrorFailing`                                          | A última sincronização de um espelho falhou, por 15 minutos                   | Warning           |
| `ArkvoryRestartLoop`                                            | O processo da API reiniciou 3 ou mais vezes em 30 minutos                     | Warning           |

Adicione estes alertas você mesmo, porque o Arkvory não exporta os dados:

| Alerta                                                             | Origem                                | Por quê                                                          |
| ------------------------------------------------------------------ | ------------------------------------- | ---------------------------------------------------------------- |
| Espaço livre dos volumes de armazenamento, banco de dados e backup | `node_exporter`                       | Um disco cheio para os uploads, o banco de dados e os backups    |
| O PostgreSQL está fora do ar ou tem conexões demais                | `postgres_exporter`                   | A API sai e reinicia enquanto o banco de dados está indisponível |
| O status público não é `ready`                                     | Uma sonda externa de `/health/status` | O caminho de rede, o proxy e o certificado, vistos de um cliente |

Para os volumes e para o PostgreSQL, a versão contém regras prontas para `node_exporter` e `postgres_exporter` em `deploy/monitoring/arkvory-host-alerts.yml`. Substitua as expressões `mountpoint` pelos seus próprios volumes antes de carregar o arquivo.

Teste um alerta uma vez. Por exemplo, pare o `arkvory-backup`: `ArkvoryBackupAgentOffline` dispara cerca de 7 a 8 minutos depois (2 minutos sem heartbeat, 5 minutos na regra, mais o intervalo de coleta).

## Páginas relacionadas {#related-pages}

- [Autorrecuperação](./self-healing)
- [Solução de problemas](./troubleshooting)
- [Backups](./backups)
- [Variáveis de ambiente](../reference/environment)
- [Erros](../api/errors)
