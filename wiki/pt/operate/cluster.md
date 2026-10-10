---
title: Cluster de alta disponibilidade
description: Execute o Arkvory em dois ou três servidores Linux de um mesmo site com uma cópia síncrona de todos os dados, failover automático e fencing obrigatório.
---

# Cluster de alta disponibilidade

Um cluster do Arkvory continua funcionando quando um servidor do site falha. Dois ou três servidores Linux mantêm a mesma cópia de um volume de blocos. Um servidor fica **ativo** e executa o Arkvory. Quando ele falha, o gerenciador do cluster o isola (fencing) e inicia o Arkvory em outro servidor com os mesmos dados.

O cluster protege contra a perda de um servidor, de um disco ou de um link de rede dentro de um site. Ele não protege contra a perda do site inteiro. Para isso, mantenha [espelhos](./mirrors) em outro site e [backups](./backups) fora do cluster.

## Como funciona {#how-it-works}

- **Um volume, cópias síncronas.** O DRBD 9 copia cada gravação do volume para os outros servidores antes de a gravação terminar (protocolo C). Toda a instalação fica no volume: o banco de dados, o armazenamento, a configuração e as versões. O catálogo e os bytes dos arquivos nunca divergem.
- **O Pacemaker decide onde o Arkvory executa.** Corosync e Pacemaker mantêm o quórum, escolhem o servidor ativo e iniciam, em ordem: o volume, o sistema de arquivos, o banco de dados, `arkvory-replica`, a API, o worker, o agente de backup, o timer de atualização e um endereço IP virtual. O Arkvory não tem eleição própria.
- **O fencing é obrigatório.** Antes de outro servidor assumir, o Pacemaker desliga o servidor com falha por meio de um dispositivo de energia (IPMI, iDRAC, iLO, Redfish, uma PDU) ou de um hipervisor. Sem fencing, dois servidores poderiam gravar ao mesmo tempo. Um cluster sem fencing não inicia.
- **Duas cópias para cada gravação confirmada.** O Arkvory responde a uma gravação com sucesso somente quando ela está em pelo menos duas cópias completas (veja [Gravações e cópias](#writes)). Quando falta uma cópia, as gravações param e as leituras continuam.

| Perfil | Servidores de dados | Testemunha                                                                                  | Quando um servidor de dados falha                                       |
| ------ | ------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `ha-2` | 2                   | obrigatória: um servidor pequeno sem dados que executa `corosync-qnetd` e um desempate DRBD | As gravações param até o servidor voltar ou até uma decisão do operador |
| `ha-3` | 3                   | não usada: os três servidores decidem por maioria                                           | As gravações continuam: restam duas cópias                              |

`ha-3` é o perfil recomendado. `ha-2` custa menos e interrompe as gravações com honestidade, em vez de manter os dados em uma única cópia.

O cluster é para os pacotes nativos do Linux. Instalações Windows e Docker Compose continuam sendo servidores independentes com espelhos e backups.

## Gravações e cópias {#writes}

Uma **cópia completa** é o disco local do servidor ativo quando está atualizado, mais cada outro servidor de dados que esteja conectado, replicando e atualizado. Um servidor que está ressincronizando não conta até ficar atualizado. A testemunha não tem dados e nunca conta.

Toda requisição que altera dados (a API HTTP, o registro de contêineres, o Git LFS, o npm) é verificada duas vezes:

- **antes** de ser executada, com base nas cópias do último segundo;
- **depois** que os dados são confirmados e sincronizados, com base em uma leitura nova do volume.

Quando existem menos cópias completas do que as gravações exigem, o cliente recebe HTTP 503 com o código `unavailable`, o motivo `replication_degraded` e um cabeçalho `Retry-After`, nunca um 2xx. O status de um job de conclusão de upload (`GET /api/v1/jobs/{id}`) é verificado da mesma forma, porque informa ao cliente que um upload grande foi publicado.

Um 503 após a confirmação significa que a operação pode existir em apenas uma cópia. Repita a requisição com a mesma `Idempotency-Key`: a repetição retorna o resultado existente, e o seu 2xx o confirma quando duas cópias voltam a existir.

Leituras, downloads, o console, o login e o logout, o feedback e a requisição batch do Git LFS funcionam enquanto as gravações estão paradas.

Um administrador conectado ao console vê um aviso enquanto as gravações estão paradas ou enquanto uma decisão de cópia única está ativa.

## Requisitos {#requirements}

- Dois ou três servidores de dados com a mesma distribuição Linux, a mesma versão do pacote do Arkvory e, em cada um, um disco (ou volume lógico) do tamanho total do volume. Planeje todo o armazenamento mais o banco de dados.
- Para `ha-2`, um terceiro servidor pequeno como testemunha. Ele não precisa de disco para dados e não executa o Arkvory.
- Uma rede de baixa latência entre os servidores. Cada gravação espera pelos outros servidores, então a latência se soma a cada gravação. Use um link dedicado sempre que possível.
- DRBD 9 (o módulo do kernel e o `drbd-utils` 9; muitas distribuições trazem o módulo antigo 8.4, então use os pacotes da LINBIT), `pacemaker`, `pcs`, `corosync`, `resource-agents` (no Ubuntu, `resource-agents-base` e `resource-agents-extra`), os agentes de fencing para o seu hardware. Para `ha-2`: `corosync-qdevice` nos servidores de dados e `corosync-qnetd` na testemunha.
- Um dispositivo de fencing para cada servidor de dados e as credenciais dele.
- Um endereço IP livre na rede dos servidores. Os clientes se conectam a esse endereço virtual.
- Um certificado TLS para o endereço virtual. Mantenha o certificado e a chave no volume, para que cada servidor os encontre no mesmo caminho.

## Montar um cluster {#build}

Os comandos abaixo usam o nome de recurso padrão `arkvory`, o diretório de instalação `/opt/proanima-arkvory` e `/dev/vg0/arkvory` como disco de apoio. Execute-os como root.

1. Em cada servidor de dados, descompacte o pacote do Arkvory sem instalá-lo. Isso adiciona os arquivos e o comando `arkvory` e não cria nada em `/opt/proanima-arkvory`:

   ```bash
   dpkg --unpack Arkvory-amd64.deb
   ```

2. Em um servidor de dados, gere o plano. Ele grava o recurso DRBD e os comandos do Pacemaker em um diretório para você revisar:

   ```bash
   arkvory cluster-plan --cluster ha-2 \
     --nodes node-a=10.0.0.11,node-b=10.0.0.12 --witness witness=10.0.0.13 \
     --disk /dev/vg0/arkvory --fence-agent fence_ipmilan \
     --virtual-ip 10.0.0.100/24 --output /root/arkvory-plan
   ```

   Para `ha-3`, liste três servidores em `--nodes` e omita `--witness`. Opcional: `--cluster-resource`, `--drbd-minor` (padrão 0), `--drbd-port` (padrão 7789), `--filesystem` (`xfs` ou `ext4`, padrão `xfs`). Os nomes devem ser os nomes de host dos servidores.

3. Copie `arkvory.res` para `/etc/drbd.d/` em cada servidor, inclusive na testemunha. Crie os metadados nos servidores de dados e ative o recurso em todos:

   ```bash
   drbdadm create-md arkvory   # data servers only
   drbdadm up arkvory          # every server
   ```

   Na testemunha, execute também `systemctl enable drbd@arkvory.service` para que o desempate volte após uma reinicialização.

   O plano permite que uma cópia que retorna ressincronize a no mínimo 20 MB/s, mesmo sob carga de gravação, e a no máximo 1 GB/s. Ajuste `c-min-rate` e `c-max-rate` na seção `disk` para o que o seu link de replicação suporta.

4. No primeiro servidor de dados, torne-o primário, crie o sistema de arquivos e monte-o. Com discos novos e vazios, pule antes a sincronização inicial:

   ```bash
   drbdadm new-current-uuid --clear-bitmap arkvory/0
   drbdadm primary arkvory
   mkfs.xfs /dev/drbd0
   mkdir -p /opt/proanima-arkvory && mount /dev/drbd0 /opt/proanima-arkvory
   ```

5. Instale o Arkvory no volume montado, coloque os arquivos TLS no volume e ative o modo cluster:

   ```bash
   dpkg --configure proanima-arkvory
   install -d -m 0750 -o root -g arkvory /opt/proanima-arkvory/config/tls
   install -m 0644 tls.crt /opt/proanima-arkvory/config/tls/tls.crt
   install -m 0640 -g arkvory tls.key /opt/proanima-arkvory/config/tls/tls.key
   arkvory configure --root /opt/proanima-arkvory --tls-cert /opt/proanima-arkvory/config/tls/tls.crt --tls-key /opt/proanima-arkvory/config/tls/tls.key --listen-host 0.0.0.0
   arkvory configure --root /opt/proanima-arkvory --cluster ha-2
   ```

   `configure --cluster` verifica se o diretório de instalação é o dispositivo DRBD montado, se este servidor é primário e se todas as cópias estão completas. Ele inicia o `arkvory-replica`, faz o Arkvory confirmar gravações somente com duas cópias completas e desativa a inicialização automática dos serviços do Arkvory: a partir de agora o Pacemaker os inicia. Se uma etapa falhar, a configuração independente é restaurada.

6. Pare o Arkvory no primeiro servidor e libere o volume:

   ```bash
   systemctl stop arkvory-update.timer arkvory-backup arkvory-worker arkvory-api arkvory-replica arkvory-database
   umount /opt/proanima-arkvory && drbdadm secondary arkvory
   ```

7. Em cada um dos outros servidores de dados, um de cada vez, assuma o volume, prepare o servidor e libere o volume de novo:

   ```bash
   drbdadm primary arkvory
   mkdir -p /opt/proanima-arkvory && mount /dev/drbd0 /opt/proanima-arkvory
   arkvory cluster-node --root /opt/proanima-arkvory --cluster-resource arkvory
   dpkg --configure proanima-arkvory
   systemctl stop arkvory-update.timer arkvory-backup arkvory-worker arkvory-api arkvory-replica arkvory-database
   umount /opt/proanima-arkvory && drbdadm secondary arkvory
   ```

   `cluster-node` cria as contas de serviço com os mesmos IDs de usuário e de grupo do primeiro servidor (os arquivos do volume pertencem a elas) e instala os mesmos serviços, nenhum deles iniciado automaticamente. Se uma conta já existir com outros IDs, o comando para e informa quais IDs definir.

8. Configure o cluster Corosync com o `pcs` nos servidores de dados (`pcs host auth`, `pcs cluster setup`, `pcs cluster start --all`). No Debian e no Ubuntu, execute antes `pcs cluster destroy` em cada servidor de dados: os pacotes instalam uma configuração de exemplo do Corosync que o `pcs` toma por um cluster existente. Não execute `pcs cluster enable`: um servidor que foi isolado só deve voltar a entrar quando você o iniciar. Para `ha-2`, autentique também a testemunha e execute nela `pcs qdevice setup model net --enable --start`. No Debian e no Ubuntu o pacote já configurou o dispositivo de quórum para a sua própria conta de serviço: execute ali, em vez disso, `systemctl enable --now corosync-qnetd`.

9. Abra `/root/arkvory-plan/pacemaker.sh`. Substitua cada `<agent parameters: …>` pelos parâmetros do seu dispositivo de fencing: o endereço, o login, o arquivo de senha ou a chave, e a tomada ou a porta desse servidor. Depois execute o script em um servidor de dados:

   ```bash
   sh /root/arkvory-plan/pacemaker.sh
   ```

   O script monta toda a configuração em um arquivo e a aplica de uma só vez: fencing, política de quórum, o recurso DRBD, o grupo do Arkvory e as suas restrições.

10. Verifique o cluster no servidor ativo:

    ```bash
    arkvory cluster-check --root /opt/proanima-arkvory
    ```

    O comando verifica o quórum, se o fencing está habilitado, se cada servidor tem um dispositivo de fencing, as configurações de quórum e de fencing do DRBD, se todas as cópias estão completas e se o Arkvory executa em exatamente um servidor. Ele termina com erro quando uma verificação falha.

11. Comprove o fencing uma vez: isole cada servidor em espera e deixe-o voltar (veja [Teste de fencing](#fence-test)).

Aponte os seus clientes e o nome DNS para o endereço virtual.

## Operação diária {#operation}

Execute estes comandos como root. `cluster-status` e `cluster-single-copy` leem o volume, por isso execute-os no servidor ativo; os demais funcionam em qualquer servidor de dados.

| Comando                                                                   | O que faz                                                                                                      |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `arkvory cluster-status --root <dir>`                                     | Perfil, papel deste servidor, cópias completas e exigidas e qualquer decisão do operador, em JSON              |
| `arkvory cluster-check --root <dir>`                                      | Todas as verificações de um cluster saudável; termina com erro quando uma falha                                |
| `arkvory cluster-switchover --root <dir> --to <server>`                   | Mudança planejada do Arkvory para outro servidor de dados; recusada enquanto alguma cópia não estiver completa |
| `arkvory cluster-fence-test --root <dir> --node <standby>`                | Isola um servidor em espera para comprovar o seu dispositivo de fencing; o servidor ativo é recusado           |
| `arkvory cluster-single-copy --root <dir> --until <time> --reason <text>` | Aceita gravações com uma única cópia até um horário; veja [Cópia única](#single-copy)                          |

`pcs status` mostra o cluster como o Pacemaker o vê.

### Switchover planejado {#switchover}

`cluster-switchover` pede ao Pacemaker que mova o grupo, espera até 5 minutos até que o Arkvory execute no destino e então remove a regra de posicionamento temporária. As conexões com o servidor antigo caem durante a mudança; os clientes repetem as requisições. O Arkvory nunca volta sozinho.

### Teste de fencing {#fence-test}

`cluster-fence-test` reinicia um servidor em espera por meio do seu dispositivo de fencing. Após a reinicialização, inicie o cluster nesse servidor com `pcs cluster start`. Os serviços do cluster não iniciam sozinhos após uma reinicialização (etapa 8 de [Montar um cluster](#build)), portanto um servidor isolado nunca volta a entrar sem você.

### Atualizações {#updates}

Instale um novo pacote em cada servidor de dados. Nos servidores em espera, o pacote apenas substitui os arquivos do programa, porque a versão fica no volume. No servidor ativo, o pacote aplica a versão: o Arkvory diz ao Pacemaker para deixar o grupo em paz, para os serviços, migra, inicia-os, espera até ficarem prontos e devolve o grupo. As atualizações automáticas funcionam do mesmo modo no servidor ativo.

Não inicie nem pare os serviços do Arkvory com `systemctl` em um servidor do cluster. O Pacemaker entenderia isso como uma falha. Use `pcs resource disable arkvory` e `pcs resource enable arkvory` para uma parada planejada de todo o serviço.

## Falhas {#failures}

| O que acontece                                                          | `ha-2`                                                                                                                      | `ha-3`                                                                   |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Um servidor em espera falha                                             | Isolado. As leituras continuam, as gravações recebem 503 `replication_degraded`                                             | Isolado. Leituras e gravações continuam                                  |
| O servidor ativo falha                                                  | Isolado, o Arkvory inicia no outro servidor. As leituras voltam, as gravações esperam a segunda cópia                       | Isolado, o Arkvory inicia em outro servidor. Leituras e gravações voltam |
| Divisão de rede entre servidores de dados                               | A testemunha dá o quórum a um lado; o outro lado é isolado. Nunca dois escritores                                           | O lado majoritário continua; o outro servidor é isolado                  |
| Dois de três membros falham (ha-2: um servidor de dados e a testemunha) | O último servidor não tem quórum: o Arkvory para. Nunca um escritor sem quórum. Recoloque os servidores no ar (veja abaixo) | O mesmo para dois servidores de dados                                    |
| O fencing não funciona                                                  | Sem failover. O Arkvory permanece parado até o fencing ter êxito                                                            | O mesmo                                                                  |

Para recolocar um servidor isolado no ar:

1. Repare a causa e inicie o servidor.
2. Execute `pcs cluster start` nele.
3. O volume ressincroniza os blocos alterados. As gravações retomam sozinhas quando todas as cópias necessárias voltam a estar completas; `arkvory cluster-status` mostra o progresso.

Após uma perda de quórum, inicie o cluster em cada servidor que voltou. O Pacemaker executa o Arkvory de novo no servidor com a cópia mais recente. O servidor que perdeu o quórum por último pode ser isolado mais uma vez na volta, porque não conseguiu parar de forma limpa: inicie o cluster nele de novo após a reinicialização.

Quando o fencing falhou e você o reparou, limpe as tentativas com falha em um servidor em execução para que o Pacemaker tente de novo: `pcs stonith history cleanup <server>` e `pcs resource cleanup`.

### Cópia única {#single-copy}

Quando um servidor de dados fica ausente por muito tempo (uma troca de disco, por exemplo) e as gravações paradas custam mais do que o risco, um operador pode aceitar gravações com uma cópia por um tempo limitado:

```bash
arkvory cluster-single-copy --root /opt/proanima-arkvory --until 2026-10-12T18:00:00Z --reason "disk replacement on node-b"
```

- O horário deve estar dentro dos próximos 7 dias. O comando só funciona enquanto faltam cópias.
- Enquanto a decisão está ativa, a perda do servidor ativo faz perder as gravações confirmadas depois dela.
- O aviso do console, a métrica `arkvory_replication_required_copies` e o alerta `ArkvorySingleCopyWrites` mostram a decisão.
- Ela termina no seu horário, com `--off`, ou sozinha assim que todas as cópias voltam a estar completas. Uma perda posterior interrompe as gravações de novo.

## Monitoramento {#monitoring}

`GET /health/ready` continua 200 no servidor ativo enquanto as gravações estão paradas, para que um monitor não mova um servidor saudável. O campo `writable` é `false` e o campo `replication` mostra `copies`, `required` e `singleCopyUntil`; `replication` é `null` quando as cópias não podem ser lidas. Servidores independentes não têm o campo `replication`.

| Métrica                                    | Significado                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| `arkvory_replication_copies`               | Cópias completas na última verificação                                         |
| `arkvory_replication_required_copies`      | Cópias de que uma gravação precisa: 2, ou 1 durante uma decisão de cópia única |
| `arkvory_replication_writes_refused_total` | Gravações respondidas com 503 `replication_degraded`                           |
| `arkvory_replication_check_failures_total` | Leituras com falha do estado das cópias                                        |

As regras de alerta em `deploy/monitoring/arkvory-alerts.yml` incluem `ArkvoryReplicationDegraded`, `ArkvorySingleCopyWrites` e `ArkvoryReplicationCheckFailing`. Observe também o próprio cluster: execute `arkvory cluster-check` periodicamente e alerte pelo seu código de saída, ou use o monitoramento da sua instalação do Pacemaker. Veja [Monitoramento](./monitoring).

## Backups {#backups}

O agente de backup executa somente no servidor ativo, como parte do grupo. Mantenha o armazenamento de backups fora do volume do cluster, por exemplo em um NAS. Veja [Backups](./backups).
