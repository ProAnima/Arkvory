---
title: Autorrecuperação
description: O que o Arkvory reinicia e retoma sozinho após uma falha, um travamento ou a perda de uma sessão do banco de dados, e o que ainda exige um operador.
---

# Autorrecuperação

O Arkvory reinicia sozinho um serviço que falhou e retoma o trabalho interrompido sem um operador. Esta página lista o que reinicia, quanto tempo a recuperação leva e quais problemas ainda precisam de você. Um servidor não é um sistema de alta disponibilidade: uma reinicialização interrompe as conexões por um breve período, e os clientes retomam as transferências.

## O que reinicia sozinho {#overview}

Cada serviço roda sob o gerenciador de serviços da plataforma. A API, o worker e o agente de backup encerram seu processo quando não podem continuar com segurança. O gerenciador inicia então um novo processo.

| Situação                                                | Linux (systemd)                              | Serviços Windows                                              | Docker Compose                                                          |
| ------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Falha, encerramento forçado, falta de memória           | Reinicia após 10 s                           | Reinicia após 10 s                                            | O mecanismo reinicia o contêiner com uma pausa crescente                |
| Saída sem solicitação de parada, inclusive com código 0 | Reinicia                                     | O launcher transforma a saída em código 1, reinicia após 10 s | Reinicia                                                                |
| Perda da posse do armazenamento ou da concessão         | Sai com código 1, reinicia                   | Sai com código 1, reinicia                                    | Sai com código 1, reinicia                                              |
| Thread principal travada                                | O watchdog encerra o processo, reinicia      | Igual                                                         | Igual                                                                   |
| Banco de dados inacessível na inicialização             | Sai com código 1, tenta a cada 10 s          | Sai com código 1, tenta a cada 10 s                           | Sai com código 1, tenta com pausa crescente                             |
| Reinicialização da máquina                              | Serviços habilitados em `multi-user.target`  | Automatic (Delayed Start)                                     | Com o mecanismo de contêineres. Docker Desktop: após o login do usuário |
| Você para o serviço                                     | Permanece parado até a próxima inicialização | Permanece parado até a próxima inicialização                  | `docker compose stop` o mantém parado                                   |

Uma verificação de prontidão que falha, por si só, não reinicia um serviço. Ela pode falhar porque o processo está concluindo o trabalho antes de parar, ou porque falta uma pasta no diretório de armazenamento. Reiniciar não corrige essas causas.

## Serviços Windows {#windows}

O instalador gráfico e `install.ps1` registram `Arkvoryapi`, `Arkvoryworker` e `Arkvorybackup`, que compartilham a conta `NT AUTHORITY\LocalService`, e o serviço `Arkvorydatabase` para o banco gerenciado. Consulte [Windows](../install/windows#services).

- **Tipo de inicialização.** A API, o worker e o agente de backup usam Automatic (Delayed Start). O banco usa Automatic. Os serviços com início atrasado sobem algum tempo após a inicialização da máquina, e não no mesmo instante.
- **Ações de recuperação.** Após uma falha, o Windows reinicia o serviço em 10 segundos. A mesma ação se repete em cada falha seguinte. O contador é zerado após uma hora. As ações também se aplicam quando o processo sai com código de erro.
- **Tempo limite de parada.** 120 segundos, para permitir que uma solicitação em andamento termine.
- **Logs.** A saída de cada serviço vai para `logs\`, com rotação em 20 MiB e 5 arquivos antigos.

Mostre as ações de recuperação de um serviço:

```powershell
sc.exe qfailure Arkvoryapi
```

Executar novamente o instalador gráfico restaura os tipos de inicialização e as ações de recuperação. Um serviço que você parou permanece parado.

## Unidades systemd do Linux {#linux}

Os pacotes e `install.sh` criam `arkvory-api`, `arkvory-worker` e `arkvory-backup`, e `arkvory-database` quando o banco é gerenciado.

- `Restart=always` com `RestartSec=10` reinicia a API, o worker e o agente de backup após toda saída não solicitada, inclusive com código 0.
- `StartLimitIntervalSec=0` remove o limite de tentativas: o systemd nunca desiste. Uma falha permanente, como uma configuração incorreta, causa uma reinicialização a cada 10 segundos até ser corrigida.
- A unidade do banco usa `Restart=on-failure` com os mesmos 10 segundos.
- `TimeoutStopSec=120` dá dois minutos ao serviço para parar.
- As unidades são habilitadas para `multi-user.target`.

```bash
systemctl is-enabled arkvory-api arkvory-worker arkvory-backup
systemctl status arkvory-api arkvory-worker arkvory-backup
```

Somente systemd é suportado para serviços nativos. Com outro sistema de inicialização, use Docker Compose.

## Docker Compose {#compose}

Todos os serviços do projeto `proanima-arkvory` usam `restart: unless-stopped`. As etapas executadas uma vez, `initialize` e `migrate`, não reiniciam.

- O contêiner da API consulta `/health/ready` com a chave de integridade a cada 10 segundos, com um período inicial de 20 segundos. Um contêiner não saudável é sinalizado, mas o Docker não o reinicia. O worker espera uma API saudável ao iniciar.
- Os contêineres têm 120 segundos para parar.
- O mecanismo de contêineres deve iniciar com a máquina. No Linux, verifique `systemctl is-enabled docker`. O Arkvory não altera o mecanismo.
- O Docker Desktop no Windows é um aplicativo de um usuário. Nenhum contêiner roda antes do login e da inicialização do Docker Desktop. Ative **Start Docker Desktop when you sign in**. O instalador e `arkvory status` avisam quando a opção está desativada. Para iniciar sem login, use os serviços nativos do Windows.

## Reinicialização após um travamento {#hang}

Um processo pode parar de funcionar sem terminar: um loop infinito, uma chamada bloqueante ou um travamento em código nativo. O gerenciador de serviços não percebe, porque o processo ainda existe. Por isso, a API, o worker e o agente de backup têm, cada um, um watchdog.

1. A thread principal incrementa um contador uma vez por segundo.
2. Uma segunda thread verifica o contador uma vez por segundo.
3. Quando o contador não muda por `ARKVORY_WATCHDOG_SECONDS` verificações seguidas (60 por padrão), o watchdog escreve `process.stalled` com o campo `stalledSeconds` na saída de erro e encerra o processo.
4. O gerenciador reinicia o processo como após uma falha.

O watchdog conta seus ciclos, não o tempo do relógio. Quando o host entra em suspensão ou uma máquina virtual é pausada, ambas as threads param: nenhum travamento é inventado ao retornar. Um travamento leva até 60 segundos mais os 10 segundos da reinicialização.

`ARKVORY_WATCHDOG_SECONDS` aceita de 10 a 3600. `0` desativa o watchdog. Use-o somente quando um depurador pausa o processo, pois uma pausa acima do limite causa reinicialização. Uma operação bloqueante longa também conta como travamento. Se o watchdog não puder iniciar, o serviço escreve `process.watchdog_failed` e continua sem ele. O PostgreSQL gerenciado não tem watchdog; seu gerenciador o reinicia após uma falha. Consulte [Variáveis de ambiente](../reference/environment#watchdog).

## Perda da sessão do banco ou da posse do armazenamento {#ownership}

A API comprova com uma sessão do banco que é a única escritora do diretório de armazenamento. A sessão é verificada a cada 2 segundos; uma verificação sem resposta em 8 segundos conta como perdida. O worker comprova seu papel da mesma forma. A posse nunca é restaurada dentro de um processo em execução, pois outro processo pode tê-la assumido.

Quando a posse é perdida, por exemplo após reiniciar o PostgreSQL, o processo:

1. escreve `api.ownership_lost` ou `worker.ownership_lost`,
2. para de aceitar trabalho e cancela as transferências,
3. sai com código 1.

O gerenciador inicia um novo processo, que verifica tudo desde o início. Enquanto o banco está indisponível, a API sai e reinicia a cada 10 segundos até o PostgreSQL responder. Isso é esperado. Nesse intervalo, os clientes recebem 503 `unavailable` com `Retry-After`. Um agente de backup em execução não sai quando o banco fica indisponível. Registra o erro e tenta novamente após seu intervalo de consulta (15 segundos por padrão).

## O que acontece com o trabalho em andamento {#work}

Uma falha interrompe conexões abertas. Os dados confirmados permanecem. O que acontece depois depende do trabalho.

| Trabalho                                        | Após uma reinicialização                                                                                                                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Download                                        | O cliente retoma com uma solicitação de intervalo. O SDK e o cliente de linha de comando fazem isso sozinhos                                                                            |
| Upload em várias partes                         | As partes registradas ficam no servidor. O cliente consulta quais existem e envia as ausentes. A sessão fica aberta por 7 dias desde a criação                                          |
| Upload de um arquivo inteiro em uma solicitação | O cliente envia novamente desde o primeiro byte                                                                                                                                         |
| Conclusão de upload pelo worker                 | Veja abaixo                                                                                                                                                                             |
| Backup                                          | Veja abaixo                                                                                                                                                                             |
| Sincronização de espelho                        | O worker salva a posição após cada alteração aplicada e copia um arquivo a partir da primeira parte ausente. Após uma falha, espera 2 segundos, dobrando até 5 minutos entre tentativas |
| Atualização                                     | O instalador mantém seu bloqueio e registro. Não continua sozinho. Consulte [Solução de problemas](./troubleshooting#update-failed)                                                     |

O SDK e o cliente de linha de comando repetem falhas de rede e respostas 408, 429, 502, 503 e 504 um número limitado de vezes. Outros clientes precisam da própria lógica de repetição. Consulte [Transferências](../use/transfers).

**Tarefas de conclusão.** Um upload grande é concluído pelo worker (o SDK e o cliente de linha de comando fazem isso a partir de 16 GiB). O worker mantém uma concessão de 30 segundos e a renova a cada 2 segundos. Após uma falha, ela expira em até 30 segundos, e o worker reiniciado retoma a tarefa. Uma tarefa roda no máximo 5 vezes. Após uma falha, espera 2 segundos, dobrando até 60 segundos. `forbidden`, `invalid_input`, `integrity_mismatch` e `not_found` encerram a tarefa imediatamente. Uma tarefa que esgotou as tentativas recebe o registro `completion.attempts_exhausted`. Pedir novamente a conclusão do mesmo upload coloca a tarefa na fila outra vez. A conclusão verifica os bytes armazenados, portanto é seguro repeti-la.

Um segundo worker no mesmo banco aguarda como reserva (`worker.standby`) e verifica a cada 5 segundos se o primeiro saiu.

**Agente de backup.** O agente mantém uma concessão de 60 segundos (`ARKVORY_BACKUP_LEASE_SECONDS`) e a renova a cada 20 segundos. Após uma falha, outro agente, ou o reiniciado, a assume quando expira: um backup espera até um minuto. A tarefa interrompida roda novamente com a mesma chave, até 5 vezes. Uma nova captura libera os bloqueios de uma captura encerrada. `agent_offline` aparece após 2 minutos sem heartbeat. Durante uma atualização, o instalador para o agente primeiro; o backup em andamento termina como `interrupted` e volta à fila.

**Limites de taxa.** Os contadores de login por endereço ficam no processo e são zerados ao reiniciar. A espera progressiva de uma conta fica no banco e permanece.

## Verificações na inicialização {#startup-checks}

Cada processo verifica o ambiente antes de atender. Uma falha encerra o processo com código 1 e uma linha `startup.failed` (API) ou `worker.unavailable` (worker). `reason` identifica a causa sem segredos.

| Processo         | O que é verificado                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API              | Cada configuração tem valor válido; a mensagem identifica a variável, nunca seu valor. O arquivo de chaves é lido como JSON de até 1 MiB. TLS integrado: certificado e chave são legíveis, combinam e não expiraram; não há fallback para HTTP. O diretório de armazenamento permite escrita. O banco responde e tem todas as migrações deste release e nenhuma de um mais novo. O arquivo `storage-id` corresponde à identidade no banco. Nenhum outro escritor mantém o bloqueio do banco |
| Worker           | As mesmas configurações, o banco, a identidade do armazenamento e o bloqueio do único worker. Um segundo worker aguarda como reserva                                                                                                                                                                                                                                                                                                                                                        |
| Agente de backup | A identidade do armazenamento, o número do esquema e se o armazenamento de backups não se sobrepõe ao diretório de armazenamento. Um armazenamento de backups ausente ou não montado não é fatal. O agente informa um aviso                                                                                                                                                                                                                                                                 |

Após uma atualização, o instalador espera três respostas de prontidão bem-sucedidas seguidas e um worker em execução. Depois, espera cerca de 90 segundos pelo heartbeat do agente de backup. Um agente ausente é apenas um aviso e nunca reverte uma atualização.

## O que ainda precisa de você {#operator}

A autorrecuperação cobre falhas de um processo. Estas situações precisam de um operador:

- **Um problema permanente.** Configuração incorreta, banco inacessível, disco cheio ou permissões incorretas fazem o serviço reiniciar a cada 10 segundos sem sucesso. Leia `startup.failed` e corrija a causa. Consulte [Solução de problemas](./troubleshooting).
- **Uma atualização malsucedida.** Uma atualização interrompida mantém seu bloqueio e registro até você executar `recover`.
- **Backups danificados.** `verify_failed` e `vault_unavailable` precisam de uma pessoa. O agente mantém o armazenamento de backups inalterado.
- **Certificados.** O Arkvory lê arquivos renovados sem reiniciar (a cada 300 segundos por padrão), mas suas ferramentas devem renová-los.
- **Um serviço parado.** Um serviço que você parou permanece parado.
- **A plataforma.** O Docker deve iniciar com a máquina. Você atualiza versões principais do PostgreSQL, Node.js e o sistema operacional.
- **Um servidor ou disco perdido.** Não há failover. Restaure de um backup. Consulte [Backups](./backups).

## Páginas relacionadas {#related-pages}

- [Monitoramento](./monitoring)
- [Solução de problemas](./troubleshooting)
- [Windows](../install/windows)
- [Variáveis de ambiente](../reference/environment)
