---
title: Gateways de leitura
description: 'Execute processos de API extras somente para download no mesmo servidor e armazenamento, compartilhe um orçamento de download entre eles e os monitore.'
---

# Gateways de leitura

Um **gateway de leitura** é um processo de API extra que serve apenas downloads. Ele roda no mesmo servidor que a API principal (o **escritor**), usa o mesmo banco de dados PostgreSQL e o mesmo diretório de armazenamento, e compartilha um único orçamento de download com o escritor e os outros gateways.

Use gateways para distribuir muitos downloads paralelos entre vários processos enquanto a taxa total de download permanece abaixo de um limite que você define. Um gateway não copia dados. Ele lê os arquivos que o escritor publicou, então um gateway nunca fica atrasado. Ele também não protege você contra a perda do servidor ou do disco. Para isso, consulte [Backups](./backups) e [Espelhos](./mirrors).

## Como funciona {#how-it-works}

- A instalação tem um escritor e até 15 gateways de leitura. Juntos, eles são no máximo 16 **slots**. O escritor sempre usa o slot 0. Cada gateway usa seu próprio slot, de 1 até o número de slots menos um.
- Todos os processos usam um banco de dados PostgreSQL e um diretório de armazenamento. Um gateway verifica que o armazenamento existe e pertence ao banco de dados. Ele nunca o cria.
- Você define uma taxa total de download para todos os processos. Cada processo recebe uma parcela fixa igual: o total dividido pelo número de slots, arredondado para baixo.
- Um processo mantém seu slot com um lease no banco de dados. Se ele perder o lease, para de servir novo payload e precisa ser reiniciado. Isso mantém a soma de todas as parcelas abaixo do total.

O escritor mantém seu trabalho normal. Ele recebe uploads, o console, a limpeza em segundo plano e todas as alterações. Um gateway nunca executa limpeza.

## O que um gateway recusa {#refusals}

Um gateway aceita apenas `GET` e `HEAD`. Toda solicitação que altera algo recebe HTTP 405 com o cabeçalho `Allow: GET, HEAD` e o código `read_only`, mesmo quando a chave tem direitos de escrita. Isso inclui login e autocadastro. O console faz parte apenas do escritor, então não está disponível em um gateway.

As permissões de repositório são verificadas a cada leitura, como no escritor. Sessões, tokens pessoais e chaves de serviço funcionam em um gateway para leitura.

## Requisitos {#requirements}

- **O mesmo servidor.** O gateway precisa ver exatamente os arquivos que o escritor publicou, sem atraso. Discos independentes com `rsync` ou outra cópia assíncrona não servem. Nenhum sistema de arquivos de rede está certificado ainda, então use gateways para vários processos em um único servidor.
- **As mesmas chaves de serviço.** Dê a todos os processos o mesmo conteúdo de `ARKVORY_KEYS_FILE`, para que as chaves de arquivo e seus IDs coincidam. As chaves de serviço gerenciadas vivem no banco de dados, então coincidem por si sós.
- **Porta própria.** Todo processo no mesmo host precisa de sua própria `ARKVORY_PORT`.
- **Uma visão somente leitura dos arquivos.** Onde puder, monte o diretório de armazenamento como somente leitura para o gateway. A recusa HTTP não substitui os direitos do sistema operacional. Observe que o gateway ainda grava no banco de dados: leases, diagnósticos de armazenamento, o horário de último uso de tokens pessoais e os bloqueios que protegem arquivos que estão sendo lidos.
- **Conexões de banco de dados.** Todo gateway precisa de uma conexão a mais que `ARKVORY_DATABASE_POOL_SIZE`. Conte-as em `max_connections` do PostgreSQL.

## Executar um gateway {#run}

Os instaladores registram a API, o worker e o agente de backup. Eles não registram um gateway, e `arkvory status` não o gerencia. Você mesmo inicia um gateway, como mais uma instância do programa da API da versão instalada, com seu próprio ambiente e sob seu próprio gerenciador de serviços.

Configurações iguais para todos os processos, para dois processos no total com 64 MiB/s no geral e 16 MiB/s para uma conta ou chave:

```dotenv
ARKVORY_GATEWAY_SLOTS=2
ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND=67108864
ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL=16777216
```

O escritor adiciona:

```dotenv
ARKVORY_ROLE=api
ARKVORY_GATEWAY_SLOT=0
```

Um gateway adiciona:

```dotenv
ARKVORY_ROLE=reader
ARKVORY_GATEWAY_SLOT=1
ARKVORY_PORT=8081
```

O gateway também precisa do restante das configurações da API: `ARKVORY_DATABASE_URL` do mesmo banco de dados, `ARKVORY_DATA_DIR` que leva ao mesmo armazenamento (o caminho pode diferir, a identidade do armazenamento deve coincidir), `ARKVORY_KEYS_FILE`, e as configurações de HTTPS se o gateway for acessível de outros computadores. Consulte [Variáveis de ambiente](../reference/environment#read-gateways).

| Variável                                                 | Regra                                                                                                                         |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_GATEWAY_SLOTS`                                  | O número de processos, incluindo o escritor, 2–16                                                                             |
| `ARKVORY_GATEWAY_SLOT`                                   | O slot deste processo, de 0 ao número de slots menos um. O escritor é 0, um gateway não é 0                                   |
| `ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND`               | Obrigatória. A taxa total de todos os processos, no mínimo 65 536 vezes o número de slots, no máximo 1 TiB por segundo        |
| `ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL` | A taxa total para uma conta ou chave em todos os processos. `0` significa sem limite. Caso contrário, o mesmo intervalo acima |

Se você definir qualquer uma dessas variáveis, defina o slot, o número de slots e a taxa total em todos os processos. Um valor inválido impede o processo na inicialização com uma mensagem que nomeia a variável. Um gateway sem uma configuração de download compartilhado se recusa a iniciar.

1. Decida o número de slots e as taxas.
2. Adicione as três variáveis comuns e as duas variáveis próprias do escritor ao escritor, e reinicie o escritor. Ele salva a política no banco de dados.
3. Inicie o gateway com suas próprias variáveis. Se seus números diferirem da política salva, ele não inicia.
4. Verifique a prontidão de cada processo e teste um download por faixa em cada um. Consulte [Monitorar gateways](#monitoring).
5. Só então adicione o gateway ao seu balanceador de carga.

Algumas regras protegem o perfil:

- Um gateway só pode iniciar depois que o escritor salvou a política.
- Depois que a política existe no banco de dados, um escritor sem essas variáveis não inicia. Ele para com a mensagem de que o banco de dados exige a configuração de download compartilhado.
- Você não pode alterar as taxas nem o número de slots em uma instalação em execução. Consulte [Alterar a configuração](#change).

## O orçamento de download {#budget}

Cada processo recebe `total / slots`, arredondado para baixo. O mesmo vale para a taxa de uma conta ou chave. Por exemplo, com 64 MiB/s e 2 slots, cada processo serve até 32 MiB/s, e uma conta recebe até 8 MiB/s em cada processo.

- Um processo não pode usar a parcela de outro. Se um de dois processos estiver parado, você obtém metade do total. Isso mantém o limite simples e verificável.
- As configurações locais `ARKVORY_DOWNLOAD_BYTES_PER_SECOND` e `ARKVORY_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL` podem diminuir uma parcela, não aumentá-la.
- Os orçamentos de upload permanecem no escritor, porque gateways não recebem uploads.
- A fila de transferências em espera e o limite de transferências ativas permanecem locais a cada processo, então as capacidades de todos os processos se somam.

O limite se aplica ao payload da aplicação, com uma pequena rajada. Não é um limite na interface de rede. Consulte [Variáveis de ambiente](../reference/environment#transfers-and-bandwidth).

## Leases e falhas {#leases}

O banco de dados reserva um slot por 10 segundos. Um processo o renova a cada 2 segundos, e confia no lease localmente por no máximo 8 segundos. Um lease cujo tempo expirou nunca é revivido, mesmo quando uma resposta tardia chega.

- **Lease perdido.** O processo para de distribuir novo payload, responde a novas solicitações autorizadas com 503 e precisa de uma reinicialização. Um download que foi cortado pode continuar com uma nova tentativa ou uma solicitação de faixa. Isso vale também para o escritor.
- **Reinicialização do mesmo slot.** O novo processo espera até que a reserva antiga expire, até 10 segundos após sua última renovação, e até 15 segundos no total. Se um gateway em execução ainda detém o slot, o novo processo para com `busy`.
- **Relógios.** Os leases dependem de relógios estáveis. Um salto no relógio do servidor de banco de dados, ou uma máquina virtual parada, pode deixar um processo servindo além de seu lease. Pare os processos antigos antes de iniciar um substituto em um caso desses.
- **Falha do banco de dados.** O banco de dados é o ponto fraco. Se ele ficar inacessível, os leases expiram e todos os processos param de servir payload.

O servidor só consegue notar um processo morto que perdeu sua rede por meio do TCP keepalive. Defina `tcp_keepalives_idle`, `tcp_keepalives_interval` e `tcp_keepalives_count` no PostgreSQL, por exemplo como 10, 5 e 3 segundos, ou defina `tcp_user_timeout`. Sem eles, um novo escritor ou worker pode esperar pelo longo tempo limite padrão do sistema operacional.

## Monitorar gateways {#monitoring}

- `GET /health/status` é público e retorna apenas `ready`, `unavailable` ou `draining`, com 503 quando o processo não consegue servir (slot ou lease perdido, drenagem). Use-o para o seu balanceador de carga.
- `GET /health/ready` precisa de uma chave. Ele retorna `role`, `writable` (sempre `false` em um gateway), `sharedDownloads` com `slot`, `slots`, `active` e `leaseSeconds`, e os números das filas de transferência locais. Ele responde 503 quando o slot é perdido. Para uma instalação autônoma, `sharedDownloads` é `null`.
- `GET /health/live` mostra apenas que o processo HTTP roda. Ele não diz se um gateway consegue servir.
- `GET /health/metrics` de cada processo mostra apenas aquele processo. Colete de cada gateway e use as métricas de HTTP e de transferência no nível do processo.

Verifique cada processo separadamente. Um gateway com `writable` falso é normal. Consulte [Monitoramento](./monitoring).

## Rotear solicitações {#routing}

O balanceador de carga é seu. O Arkvory não fornece nenhum balanceador.

- Envie toda solicitação que altera dados, e `/console/`, para o escritor.
- Você pode distribuir as leituras de bytes entre o escritor e os gateways: `GET` e `HEAD` para `/api/v1/repositories/NAME/artifacts/ID/content`, para `.../packages/content` e para `.../asset/content`. Mantenha as outras solicitações no escritor.
- Repasse os cabeçalhos `Authorization`, `Range`, `If-Range` e `ETag`. Transmita o corpo sem colocar o arquivo inteiro em buffer. Não redirecione um cliente para uma URL que carrega uma chave.
- Adicione um backend ao balanceador apenas quando sua prontidão autenticada estiver ok.

O SDK TypeScript pode continuar um download interrompido por outro backend saudável atrás do mesmo endereço. Uma conexão TCP em execução não se move entre servidores.

## Alterar a configuração {#change}

Você não pode alterar as taxas nem o número de slots enquanto a instalação roda, e não pode voltar a um único processo enquanto a política existir. Mesmo que todos os gateways estejam parados, a política salva impede uma inicialização sem limites.

1. Pare o tráfego de entrada. Pare o escritor, todos os gateways e o worker, e confirme que eles realmente pararam.
2. Espere até que os leases no banco de dados tenham expirado.
3. Faça um backup. Consulte [Backups](./backups).
4. Um administrador do banco de dados do Arkvory exclui todas as linhas das tabelas `arkvory_gateway_leases` e `arkvory_download_policy` em uma única transação. Isso redefine apenas o estado de coordenação, não o catálogo.
5. Inicie o escritor com as novas configurações, depois os gateways.

Nunca faça isso enquanto qualquer processo ainda possa estar em execução.

Uma atualização exige o mesmo cuidado. Pare todos os gateways antes de a instalação atualizar, e inicie-os a partir da nova versão depois. Um gateway que continua rodando código antigo contra um esquema de banco de dados mais novo se reporta como não pronto. As ferramentas de reparo offline para limpeza também precisam de todos os gateways parados. A limpeza online do escritor não.

## Gateways ou espelhos {#gateways-or-mirrors}

|                                             | Gateways de leitura                                                | Espelhos                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| O que é                                     | Mais processos de API no mesmo servidor e armazenamento            | Uma segunda instalação independente com uma cópia dos dados                        |
| Dados                                       | Uma cópia, lida ao vivo                                            | Uma segunda cópia, puxada com atraso                                               |
| Contas e chaves                             | As mesmas do escritor                                              | Suas próprias                                                                      |
| Disco extra                                 | Nenhum                                                             | Sim, tanto quanto os repositórios precisarem                                       |
| Precisa de                                  | O mesmo banco de dados e o mesmo sistema de arquivos               | Um link HTTPS para a origem e uma chave somente leitura                            |
| Protege contra um servidor ou disco perdido | Não                                                                | Em parte: ele serve enquanto a origem está fora do ar, e você pode trocar para ele |
| Use para                                    | Mais downloads paralelos com um único limite de taxa compartilhado | Um segundo site, um escritório mais perto dos usuários, um standby                 |

Ambos são adições aos backups, não substitutos.

## Limites {#limits}

- Todos os processos devem compartilhar um servidor e um diretório de armazenamento. Máquinas diferentes precisam de um sistema de arquivos testado para isso, e nenhum foi testado ainda.
- Não há suporte do instalador, failover automático nem balanceador embutido.
- Um banco de dados e um escritor continuam sendo um único ponto de falha.
- O orçamento é fixo por slot e não é redistribuído, e não há agendamento por prioridade.
- Você não pode alterar a política em uma instalação em execução.

## Páginas relacionadas {#related-pages}

- [Espelhos](./mirrors)
- [Monitoramento](./monitoring)
- [Autorrecuperação](./self-healing)
- [Variáveis de ambiente](../reference/environment#read-gateways)
- [Atualizações](../install/updates)
