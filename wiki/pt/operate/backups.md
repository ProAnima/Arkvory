---
title: Backups
description: Conecte um armazenamento de backups, agende e verifique backups, restaure um ponto de restauração em um servidor vazio e teste a restauração com regularidade.
---

# Backups

O agente de backup copia o banco de dados e os arquivos armazenados da sua instalação para um **armazenamento de backups (vault)**: um diretório em outro disco ou em um compartilhamento de rede. Ele trabalha enquanto as pessoas continuam enviando e baixando arquivos. Cada backup concluído é um **ponto de restauração** que você pode verificar e restaurar.

Esta página trata do vault, do agendamento, da retenção, da verificação, das telas de status e do procedimento de restauração. A restauração é um comando que você executa no servidor. O console não tem um botão de restauração.

## Como os backups funcionam {#how-backups-work}

O agente é o terceiro serviço de uma instalação, ao lado da API e do worker. Ele se chama `arkvory-backup` no Linux, `Arkvorybackup` no Windows e `backup` no Docker Compose. Apenas um agente trabalha por vez. Um segundo agente espera e assume quando o primeiro para.

O agente faz três coisas:

- Executa o plano diário quando o plano está ativado.
- Executa as tarefas que você solicita no console, com o `arkvoryctl` ou pela API.
- Verifica cada novo ponto de restauração e aplica a retenção.

Um ponto de restauração guarda o estado publicado da instalação em um momento **T**, o horário do snapshot. Os arquivos que as pessoas publicam depois de T entram no próximo backup. O console conta a idade de um backup a partir de T, não a partir do momento em que a cópia terminou.

Tenha estes fatos em mente:

- Um backup não interrompe uploads nem downloads. Enquanto ele é executado, a limpeza física deixa os arquivos de que o backup precisa e os remove em uma passagem posterior.
- Um arquivo é armazenado uma única vez no vault, qualquer que seja o número de pontos de restauração que o contêm. O primeiro backup copia tudo, então, com terabytes de conteúdo, ele demora muito. Os backups seguintes copiam apenas os arquivos novos.
- Um ponto de restauração só aparece quando a cópia está completa. Um backup que falha ou é interrompido nunca danifica os pontos de restauração anteriores.
- Um backup não é um sistema de recuperação para um instante qualquer nem alta disponibilidade. Você restaura o estado de um ponto de restauração e perde as alterações feitas depois do T dele.

## O que um backup contém {#contents}

Um ponto de restauração contém:

- As tabelas do catálogo no banco de dados: artefatos, pacotes, caminhos de arquivo e seu histórico, rótulos e metadados, estágios, anexos, contas, grupos e permissões de acesso, contas e chaves de serviço, os registros de auditoria, as políticas de armazenamento e de limpeza, os dados de imagens de contêiner, de Git LFS e do registro npm, e o estado dos espelhos.
- O conteúdo de todos os arquivos publicados.

Um ponto de restauração não contém:

- Sessões de login, links de download e o estado de execução dos gateways de leitura.
- Uploads que não terminaram. A restauração os cancela, e os clientes os iniciam de novo.
- O plano de backup e o estado do agente. Uma instalação restaurada começa com os backups desativados.
- O diretório `config/` da instalação: configurações, arquivos TLS, chaves de espelhos e a chave de recuperação. Mantenha você mesmo cópias desses arquivos.
- Os programas do Arkvory. Instale primeiro um release e depois restaure.

## Preparar o vault {#vault}

### Requisitos {#vault-requirements}

| Requisito                                                                                                           | Motivo                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Um diretório novo ou vazio, montado antes de os serviços iniciarem                                                  | O agente grava ali o `vault.json` e os pontos de restauração                                                                        |
| Fora do diretório da instalação e fora do diretório de armazenamento, inclusive por links, junctions e nomes curtos | Um vault dentro do armazenamento se perde junto com ele. A verificação recusa um caminho que os contenha ou que esteja dentro deles |
| Com permissão de gravação para a conta do serviço                                                                   | No Linux, `arkvory`. No Windows, `NT AUTHORITY\LocalService`. O `arkvory configure` define as permissões para você                  |
| Pelo menos 1 GiB de espaço livre além dos dados copiados                                                            | O vault mantém essa reserva. Um volume cheio encerra o backup com `vault_full`, e os pontos anteriores permanecem intactos          |
| No Linux, fora de `/home`, `/root`, `/run/user`, `/tmp` e `/var/tmp`                                                | O sandbox do serviço oculta essas árvores                                                                                           |
| No Windows, um volume local ou iSCSI com uma letra de unidade                                                       | O `LocalService` não consegue entrar em compartilhamentos SMB, então caminhos como `\\nas\share` são recusados                      |

Use um volume em outro disco ou em um NAS, para que a falha do disco de armazenamento não leve os backups junto. Um vault no mesmo disco físico do armazenamento protege contra erros, mas não contra a falha do disco.

**O vault não é criptografado.** Ele guarda o catálogo, os hashes das senhas e todos os arquivos publicados. Coloque-o em um volume criptografado (LUKS, BitLocker, criptografia do NAS) e permita o acesso somente à conta do serviço e ao administrador de backup.

### Conectar o vault {#connect-vault}

Execute o comando como root ou como administrador, no servidor. Ele verifica o diretório antes de alterar qualquer coisa.

```bash
sudo arkvory configure --root /opt/proanima-arkvory --backup-vault /mnt/backup/arkvory --init-vault
```

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' configure --root $root --backup-vault D:\Backup\Arkvory --init-vault
```

Em uma instalação por script no Windows, inicie o `manage.mjs` como descrito em [Windows](../install/windows#manage-the-services).

1. O comando verifica o caminho: absoluto, um diretório existente com permissão de gravação, fora da instalação e do armazenamento, e visível para o serviço.
2. Com `--init-vault`, ele cria o `vault.json` em um diretório **vazio**. Ele nunca inicializa um diretório duas vezes. Sem o `vault.json` e sem a opção, ele recusa, para que um NAS que não está montado não seja confundido com um vault vazio.
3. Ele dá acesso à conta do serviço, grava `ARKVORY_BACKUP_VAULT` em `config/runtime.json` e reinicia somente o agente.
4. Ele espera até 150 segundos até que o agente informe que este vault está disponível. Essa verificação lê o `config/bootstrap-token.txt`, então não exclua esse arquivo.
5. Se algo falhar, ele restaura as configurações e o acesso anteriores e reinicia o agente.

Para usar um vault que já existe, por exemplo em um servidor novo, omita `--init-vault`. Para desconectar o vault, use `--backup-vault-off`. Isso deixa o diretório e seus arquivos inalterados. Uma reinicialização interrompe um backup em execução, e o agente o repete.

No Docker Compose, o vault é um bind mount definido em `config/compose.vault.yml`. Quando você executa comandos do Compose por conta própria, adicione `-f config/compose.vault.yml`. Sem isso, o `up` cria o contêiner do agente sem o vault.

### Vault em um compartilhamento de rede {#network-share}

No Linux, um NAS funciona com SMB 3 e NFS 4. Monte o compartilhamento de modo que os arquivos pertençam à conta do serviço. Caso contrário, o agente não consegue gravar, e o `configure` recusa e restaura as configurações antigas.

```bash
sudo mount -t cifs //nas/arkvory /mnt/backup/arkvory \
  -o credentials=/etc/arkvory/smb.credentials,uid=$(id -u arkvory),gid=$(id -g arkvory),file_mode=0600,dir_mode=0700,vers=3.1.1
```

- Dê ao arquivo de credenciais o modo `0600`.
- No NFS, mapeie os proprietários para que os arquivos pertençam ao `arkvory`. Use `no_root_squash` na exportação ou o mesmo ID de usuário nos dois lados.
- Adicione a montagem ao `/etc/fstab` com `_netdev`. No SMB, adicione `nofail` quando o NAS puder estar indisponível durante a inicialização.
- Se o NAS cair, o agente informa `vault_unavailable`. Ele não grava no ponto de montagem vazio, porque a identidade do vault fica armazenada no `vault.json`.

## Agendamento e retenção {#schedule}

### Definir o agendamento {#set-schedule}

Abra [[ui:backups]] e use [[ui:backupPlan]]. Você precisa da permissão para gerenciar backups. Sem ela, o formulário mostra a mensagem [[ui:backupReadOnly]]

| Configuração                                                  | Significado                                                                                                                  | Padrão     |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------- |
| [[ui:backupEnabled]]                                          | Ativa o plano diário. Ativá-lo não inicia um backup na hora                                                                  | Desativado |
| [[ui:backupTime]]                                             | Horário local do backup diário, com precisão de minutos                                                                      | 02:00      |
| [[ui:backupTimezone]]                                         | O fuso horário IANA desse horário local, por exemplo `Europe/Moscow` ou `UTC`. Deslocamentos como `+03:00` não são aceitos   | `UTC`      |
| [[ui:backupDaily]], [[ui:backupWeekly]], [[ui:backupMonthly]] | Quantos dias, semanas e meses de pontos de restauração manter. Consulte [Retenção](#retention). Limites: 0–366, 0–260, 0–120 | 7, 4, 6    |

Selecione [[ui:backupPlanSave]]. Se outra pessoa alterou o plano nesse meio-tempo, o console carrega o plano atual, e você o revisa e salva de novo.

O agendamento segue estas regras:

- Um horário local que não existe no dia de uma mudança de horário é executado no momento da mudança. Um horário local que ocorre duas vezes é executado uma só vez, na primeira.
- Depois de um período de inatividade, o agente faz um backup de recuperação, e não um para cada dia perdido. Alterar o agendamento não dispara um backup de recuperação para horários anteriores.
- A janela de atualização padrão de uma instalação é 03:00 UTC. Uma atualização interrompe o agente, e um backup em execução é interrompido e repetido mais tarde. Escolha um horário de backup que não caia na janela de atualização. Consulte [Atualizações](../install/updates).

### Retenção {#retention}

A retenção mantém o ponto de restauração mais recente de cada um dos últimos N dias locais, de cada uma das últimas N semanas ISO e de cada um dos últimos N meses, contados no fuso horário do plano. Os três grupos são unidos, então 7, 4 e 6 mantêm no máximo 17 pontos, e em geral menos.

A retenção sempre mantém:

- Os pontos fixados.
- O ponto mais recente, para que sempre reste pelo menos um ponto.

A retenção nunca exclui um ponto que falhou na verificação e nunca toca nos pontos de outra instalação no mesmo vault.

Depois de cada backup, o agente enfileira a retenção como uma tarefa separada. Você também pode selecionar [[ui:backupRetentionApply]]. O console primeiro mostra quais pontos permanecem e quais são removidos. Uma remoção não pode ser desfeita. Em seguida, o agente exclui o ponto e, depois, os arquivos de que nenhum ponto restante precisa. Se o vault contiver um ponto danificado (um diretório de ponto sem `COMMITTED` ou com um manifesto inválido), a remoção para com `invalid_manifest`. Deixe o vault como está, descubra a causa e só então remova o diretório danificado manualmente.

A retenção de backups não altera a retenção de builds nos seus repositórios. Consulte [Armazenamento](./storage).

### Fixar um ponto de restauração {#pin}

Um ponto fixado é mantido além das regras de retenção. Por exemplo, fixe o ponto anterior a uma grande migração.

- Console: selecione [[ui:backupPin]] na linha do ponto em [[ui:backupPoints]]. [[ui:backupUnpin]] o libera.
- CLI: `arkvoryctl backup pin POINT_ID` e `arkvoryctl backup pin POINT_ID --off`.
- API: [setBackupPointPin](../api/reference/backups#setBackupPointPin).

## Verificação {#verification}

Há dois tipos de verificação:

| Tipo                                                    | O que verifica                                                                                                          | Quando é executada                                                                                                                                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rápida (o console mostra [[ui:backupVerifyStructural]]) | Cada arquivo do ponto em relação ao digest no manifesto dele, e se cada arquivo armazenado existe com o tamanho correto | Automaticamente depois de cada backup                                                                                                                                                 |
| Completa ([[ui:backupVerifyDeep]])                      | As verificações rápidas, além de ler cada arquivo armazenado e conferir o SHA-256 dele                                  | Automaticamente a cada 7 dias para o ponto mais recente. Sob demanda com [[ui:backupVerifyDeepAction]], com `arkvoryctl backup verify POINT_ID` ou com `arkvory-backup verify --deep` |

Uma verificação completa lê o ponto inteiro, então, com um vault grande, ela exige tempo e taxa de transferência do disco. Se um ponto falhar, o console mostra [[ui:backupVerifyFailed]] com um código de erro, e o aviso `verify_failed` fica ativo. Não altere o vault até saber a causa.

Um ponto que ainda não foi verificado mostra [[ui:backupVerifyNone]]. Uma verificação completa do ponto mais recente também é a melhor verificação regular de que o vault pode ser lido.

## Fazer um backup agora {#run-now}

Use qualquer um destes:

- Console: [[ui:backupRun]] em [[ui:backups]].
- CLI: `arkvoryctl backup run`.
- API: [requestBackupRun](../api/reference/backups#requestBackupRun) responde com 202 e a tarefa enfileirada.

O agente verifica a fila dele a cada 15 segundos (`ARKVORY_BACKUP_POLL_SECONDS`), então a tarefa começa logo depois. As tarefas são executadas uma de cada vez, e fechar o console não as interrompe. Uma tarefa que para por causa de uma reinicialização ou de um conflito é repetida, em até 5 tentativas. Consulte [Variáveis de ambiente](../reference/environment#backups) para ver as configurações do agente, incluindo o limite de taxa de cópia `ARKVORY_BACKUP_BYTES_PER_SECOND`.

Um backup passa por estas etapas, que o console mostra em [[ui:backupJobPhase]]: [[ui:backupPhasePreparing]], [[ui:backupPhaseCatalog]], [[ui:backupPhaseTransfer]], [[ui:backupPhaseFinishing]] e [[ui:backupPhaseDone]]. Uma verificação rápida mostra [[ui:backupPhaseStructural]], e uma completa mostra [[ui:backupPhaseDeep]].

Não execute migrações do banco de dados nem as ferramentas offline `gc` e `scrub` durante um backup. Elas esperam por ele ou recusam com `busy`.

## Acompanhar o status {#status}

### No console {#status-console}

[[ui:backups]] é visível para os administradores e para a chave de recuperação. As chaves de serviço e os tokens de acesso pessoal nunca a veem. A página mostra:

- O estado: [[ui:backupStateOk]], [[ui:backupStateWarning]] ou [[ui:backupStateCritical]].
- [[ui:backupNewest]] com a idade a partir de T, [[ui:backupNextRun]] com [[ui:backupOverdue]] quando uma execução está atrasada, [[ui:backupAgent]] com o último sinal e [[ui:backupVault]] com o espaço livre.
- A tarefa em execução no momento e, depois, os avisos, cada um com uma dica do que fazer.
- [[ui:backupPoints]], com [[ui:backupSnapshot]], [[ui:backupCompleted]], [[ui:backupSize]], [[ui:backupFiles]], [[ui:backupVerification]] e a fixação.
- [[ui:backupJobs]], com o tipo ([[ui:backupKindCapture]], [[ui:backupKindVerify]], [[ui:backupKindRetention]]), o estado, a etapa, os horários, o código de erro e o progresso.

Uma tarefa tem um destes estados: [[ui:backupJobQueued]], [[ui:backupJobRunning]], [[ui:backupJobCommitting]], [[ui:backupJobCompleted]], [[ui:backupJobFailed]] ou [[ui:backupJobInterrupted]]. A página é atualizada enquanto uma tarefa é executada. Use [[ui:backupRefresh]] a qualquer momento.

### Avisos {#warnings}

| Código                 | Nível   | O que fazer                                                                                                                      |
| ---------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `vault_not_configured` | Aviso   | Conecte um vault. Consulte [Conectar o vault](#connect-vault)                                                                    |
| `agent_offline`        | Crítico | Sem sinal há 2 minutos. Inicie o serviço do agente e leia o log dele                                                             |
| `schedule_disabled`    | Aviso   | Ative o plano se você precisa de backups diários                                                                                 |
| `no_backup_yet`        | Aviso   | Crie o primeiro backup                                                                                                           |
| `backup_stale`         | Crítico | O ponto mais recente tem mais de 26 horas e o plano está ativado. Leia os códigos de erro das tarefas e o log do agente          |
| `last_run_failed`      | Aviso   | O último backup falhou. O código de erro está na lista de tarefas                                                                |
| `vault_unavailable`    | Crítico | O volume não está montado, o `vault.json` não existe ou o vault não aceita gravação                                              |
| `vault_low_space`      | Aviso   | Menos de 10% do volume está livre, ou menos que o dobro dos dados novos do último backup. Libere espaço ou mantenha menos pontos |
| `verify_failed`        | Crítico | Um ponto falhou na verificação. Não altere o vault; investigue                                                                   |
| `never_deep_verified`  | Aviso   | Nenhuma verificação completa há mais de 8 dias. Verifique se o agente está em execução ou inicie uma verificação completa        |

### Com a CLI e a API {#status-cli}

```bash
arkvoryctl backup status
arkvoryctl backup jobs
arkvoryctl backup points
arkvoryctl backup status --json || echo "backup problem"
```

O `backup status` termina com o código de saída 9 enquanto um aviso crítico está ativo, então você pode usá-lo em um monitor. Esses comandos exigem a chave de arquivo do proprietário ou uma sessão de administrador da conta. Consulte [Cliente de linha de comando](../protocols/cli#backups) e [SDK TypeScript](../protocols/sdk#backups). As operações HTTP estão na [referência da API de Backups](../api/reference/backups).

Para o Prometheus, a API expõe `arkvory_backup_last_success_timestamp_seconds` (o T do ponto mais recente), `arkvory_backup_agent_last_seen_timestamp_seconds` e `arkvory_backup_warnings` com um rótulo `code`. Consulte [Monitoramento](./monitoring).

## Restaurar {#restore}

Uma restauração grava em um banco de dados **vazio** e em um diretório de armazenamento **vazio**. Ela nunca sobrescreve uma instalação em execução. Depois da restauração, você inicia uma instância separada com os dados restaurados, verifica-a e só então decide se ela substitui o servidor antigo.

### Antes de começar {#restore-prepare}

- **O programa.** O comando de restauração é o programa `arkvory-backup` do release instalado. Inicie-o com o Node.js da instalação:
  - Pacotes Linux: `/opt/proanima-arkvory/runtime/node /opt/proanima-arkvory/releases/VERSION/apps/backup/dist/main.js COMMAND`
  - Instalador gráfico para Windows: `& "$root\runtime\node.exe" "$root\releases\VERSION\apps\backup\dist\main.js" COMMAND`

  `VERSION` é a versão instalada, indicada no `installation.json`. No restante desta página, `arkvory-backup` representa essa linha de comando inteira. Quem usa o Docker Compose executa o mesmo programa em um contêiner da imagem do release. Em uma instalação por script, use a pasta do Node.js em `runtime/`.

- **O release.** Use o release que criou o ponto ou um mais novo. Um ponto de um release mais novo é recusado com `schema_mismatch`.
- **A conta.** Execute o comando com uma conta que possa ler o vault. No Linux, o vault pertence ao `arkvory` e tem o modo 0700, então use `sudo -u arkvory`. No Windows, use um PowerShell com privilégios elevados. O novo diretório de armazenamento precisa terminar como propriedade da conta que executará a API.
- **O destino.** Crie um banco de dados vazio, por exemplo `CREATE DATABASE arkvory_restore OWNER arkvory;`. Escolha um diretório de armazenamento que não exista ou esteja vazio, em um volume diferente do vault e fora do armazenamento de origem.
- **A URL do banco de dados.** Passe-a pelo ambiente, não como argumento, porque os argumentos ficam visíveis na lista de processos.

### Restaurar passo a passo {#restore-steps}

1. Liste os pontos de restauração e escolha um. Copie o ID do ponto.

   ```bash
   arkvoryctl backup points
   arkvory-backup list --vault /mnt/backup/arkvory
   ```

2. Verifique o ponto por completo.

   ```bash
   arkvory-backup verify --vault /mnt/backup/arkvory --point POINT_ID --deep
   ```

3. Defina o banco de dados de destino no ambiente.

   ```bash
   export ARKVORY_RESTORE_DATABASE_URL='postgresql://arkvory@db.example/arkvory_restore'
   ```

4. Execute a restauração **sem** `--yes`. Isso é uma simulação. Ela verifica o ponto, os hashes dos arquivos, a versão do esquema e se o destino está vazio, e não grava nada.

   ```bash
   arkvory-backup restore --vault /mnt/backup/arkvory --point POINT_ID --storage /srv/arkvory-restore
   ```

   Uma verificação aprovada termina com o código de saída 0 e a linha de log `backup.restore.planned`.

5. Execute o mesmo comando com `--yes`. Adicione `--report` para manter um arquivo de relatório. O arquivo ainda não pode existir.

   ```bash
   arkvory-backup restore --vault /mnt/backup/arkvory --point POINT_ID --storage /srv/arkvory-restore --yes --report /root/restore-report.json
   ```

   A restauração passa pelas fases `verify`, `content`, `schema`, `tables`, `migrate` e `done`. Ela copia cada arquivo e confere o SHA-256, cria o esquema, carrega todas as tabelas em uma só transação, aplica a normalização e depois executa as migrações restantes. O relatório contém apenas identificadores e contagens, nunca caminhos nem credenciais.

6. Inicie uma instância separada da API com os dados restaurados: o `ARKVORY_DATABASE_URL` do novo banco de dados, o `ARKVORY_DATA_DIR` do novo diretório, o próprio `ARKVORY_KEYS_FILE` e outra porta. Verifique se o `/health/ready` responde, se você consegue entrar, se o catálogo está completo e se um arquivo de controle é baixado com o mesmo SHA-256.

Se uma restauração falhar, exclua o banco de dados e o diretório de destino e crie-os de novo. Um destino que não está vazio é recusado com `target_not_empty`, o que protege os dados existentes.

### O que uma restauração altera {#after-restore}

A restauração aplica um conjunto fixo de alterações, para que a nova instância não continue nada que estava em andamento e não ative nenhuma credencial antiga:

- Os uploads não concluídos são cancelados e liberam a cota. As tarefas de conclusão na fila e em execução terminam como falhas com o código `conflict`. As promoções não concluídas são descartadas.
- Nenhuma sessão é restaurada. Todos entram de novo.
- Todos os tokens de acesso pessoal são revogados, e todas as chaves de serviço passam a `revoked`. Emita chaves novas.
- A retenção do armazenamento e a limpeza física são desativadas em todos os repositórios. Ative-as de novo de propósito.
- Os backups ficam desativados e nenhum vault é configurado. Os links de download e as configurações dos gateways de leitura não são transferidos.
- As contas, os grupos e as permissões de acesso permanecem, com os hashes das senhas do momento T. Uma senha que você alterou depois de T volta a funcionar na forma antiga, então redefina as senhas conforme a sua política.
- A chave de recuperação e as chaves de arquivo vêm do arquivo de chaves da instalação que executa os dados restaurados.
- Os espelhos mantêm a posição deles, mas as configurações dos espelhos ficam em `config/`. Conecte-os de novo. Consulte [Espelhos](./mirrors).
- Um registro de auditoria de segurança `backup.restored` anota o ponto e as contagens.

### Mudar para outro servidor {#move-server}

Você pode usar um backup para mover uma instalação para outro servidor:

1. Instale o Arkvory no novo servidor, com o mesmo release ou um mais novo. Consulte [Escolher uma instalação](../install/index).
2. Conecte o mesmo vault, ou uma cópia dele, ao novo servidor. Não use `--init-vault` para um vault existente.
3. Restaure o ponto mais recente em um novo banco de dados vazio e em um diretório vazio, como descrito acima, e teste o resultado.
4. Aponte a instalação para os dados restaurados: defina `ARKVORY_DATABASE_URL` e `ARKVORY_DATA_DIR` em `config/runtime.json` e reinicie os serviços. Consulte [Configuração](../install/configuration).
5. Emita chaves novas, defina de novo as políticas de retenção e de limpeza, conecte os espelhos e o plano de backup e informe aos clientes o novo endereço.

Os dois últimos passos são manuais e não fazem parte de uma troca guiada. Ensaie toda a sequência antes em um servidor reserva. As alterações feitas no servidor antigo depois de T se perdem, então pare o servidor antigo antes de os clientes mudarem.

## Teste a restauração com regularidade {#test-restore}

Um backup que você nunca restaurou é apenas uma esperança. O produto verifica os bytes de um ponto, mas não registra uma restauração de teste. Guarde você mesmo a data e o resultado.

Teste pelo menos:

- Depois do primeiro backup.
- Depois de cada atualização que altera o esquema do banco de dados.
- Em um cronograma próprio, por exemplo a cada trimestre.

Cada teste segue [Restaurar passo a passo](#restore-steps) em um servidor reserva ou em um banco de dados descartável e termina com um login, uma olhada no catálogo e o download de um arquivo de controle. Depois, exclua o banco de dados descartável e o diretório.

## Códigos de saída e linhas de log {#exit-codes}

### Códigos de saída {#exit-codes-table}

O programa `arkvory-backup` grava um objeto JSON por linha na saída padrão e, em caso de falha, uma linha de dica no erro padrão.

| Código | Significado                                                                                                                                              |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0      | Sucesso. Para `restore` sem `--yes`, a verificação passou                                                                                                |
| 1      | A execução falhou: banco de dados ou disco indisponível, lease ou snapshot perdido, vault ou destino cheio. Os pontos de restauração não são danificados |
| 2      | Argumentos ou variáveis de ambiente incorretos                                                                                                           |
| 3      | Uma verificação de segurança recusou: sem `vault.json`, diretórios sobrepostos, um destino que não está vazio, um esquema sem suporte, ponto inexistente |
| 4      | Falha de integridade: um hash, um arquivo ausente ou um manifesto alterado. Deixe o vault inalterado até entender o que houve                            |
| 5      | Ocupado: outro backup ou uma manutenção está em andamento, ou uma exclusão não terminou a tempo. Tente de novo mais tarde                                |

### Linhas de log {#log-lines}

Toda linha tem `component` definido como `backup`. Caminhos, URLs e segredos nunca são gravados. As linhas mais úteis:

| Código                                                                                      | Significado                                                                                                                |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `backup.phase`                                                                              | Um backup passa para uma etapa: `barrier`, `pins`, `tables`, `blobs`, `manifest`, `commit`, `done`                         |
| `backup.capture.completed`                                                                  | Um backup terminou. Campos: `pointId`, `outcome`, `blobs`, `copied`, `reused`, `copiedBytes`, `contentBytes`, `durationMs` |
| `backup.point`                                                                              | Um ponto de restauração na saída de `list`                                                                                 |
| `backup.verify.point`, `backup.verify.problem`                                              | O resultado de uma verificação e cada problema com o seu `errorCode`                                                       |
| `backup.restore.phase`, `backup.restore.planned`, `backup.restore.completed`                | O andamento e o resultado da restauração, com as contagens de linhas e das alterações listadas acima                       |
| `backup.failed`                                                                             | Um comando falhou. Leia o `errorCode`                                                                                      |
| `backup.agent.started`, `.standby`, `.lease_acquired`, `.lease_lost`, `.stopped`, `.failed` | A vida do agente                                                                                                           |
| `backup.request.started`, `.done`, `.failed`, `.requeued`                                   | Uma tarefa do agente, com `kind` e `errorCode`                                                                             |
| `backup.schedule.due`                                                                       | O plano iniciou um backup                                                                                                  |
| `backup.retention.applied`                                                                  | A retenção terminou. Campos: `forgotten`, `blobs`, `freedBytes`                                                            |

Leia o log do agente com `journalctl -u arkvory-backup` no Linux, em `logs\` na raiz da instalação no Windows e com `docker compose logs backup` no Compose.

### Códigos de erro {#error-codes}

| `errorCode`                                              | Saída | O que fazer                                                                                                      |
| -------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------- |
| `vault_missing`                                          | 3     | O diretório não tem `vault.json`. Monte o volume ou execute `vault init` uma vez                                 |
| `unsafe_path`                                            | 3     | Mantenha o vault, o armazenamento e o destino da restauração em árvores de diretórios separadas                  |
| `target_not_empty`                                       | 3     | A restauração grava somente em um banco de dados vazio e em um diretório vazio                                   |
| `schema_mismatch`                                        | 3     | O ponto é mais novo que o release ou mais antigo que a restauração suportada. Use outro release                  |
| `upgrade_required`                                       | 3     | Atualize todos os processos de API e de manutenção da instalação                                                 |
| `point_not_found`, `storage_mismatch`                    | 3     | ID de ponto incorreto, ou o `ARKVORY_DATA_DIR` não é um diretório de armazenamento inicializado desta instalação |
| `integrity_mismatch`, `invalid_manifest`, `blob_missing` | 4     | Deixe o vault inalterado. Execute `verify --deep` e investigue                                                   |
| `busy`, `barrier_timeout`                                | 5     | Outra operação está em andamento. Tente de novo mais tarde                                                       |
| `vault_full`, `storage_full`                             | 1     | Libere espaço. Os pontos anteriores estão intactos                                                               |
| `attempts_exhausted`                                     | 3     | Esta solicitação usou as 5 tentativas dela. Inicie um novo backup                                                |

## Limites {#limits}

- Um plano e um vault por instalação. O vault é um diretório em um disco ou em um compartilhamento montado, sem S3 e sem perfil offsite ou imutável.
- O vault não é criptografado pelo Arkvory.
- Você não pode pausar nem cancelar uma tarefa de backup, e o console não tem um assistente de restauração nem um status de teste de restauração.
- A restauração exige um destino vazio, e a troca para os dados restaurados é um passo manual.
- O agente de backup não é um sistema de alta disponibilidade. Um segundo agente apenas espera como reserva.

## Páginas relacionadas {#related-pages}

- [Escolher uma instalação](../install/index)
- [Atualizações](../install/updates)
- [Armazenamento](./storage)
- [Espelhos](./mirrors), para um segundo site
- [Monitoramento](./monitoring)
- [Autorrecuperação](./self-healing)
- [Solução de problemas](./troubleshooting)
- [Variáveis de ambiente](../reference/environment#backups)
