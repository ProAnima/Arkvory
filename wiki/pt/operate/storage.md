---
title: Armazenamento
description: Planeje o espaço em disco, defina cotas e políticas de retenção por repositório, libere espaço sem parar o servidor e reaja quando o disco ficar cheio.
---

# Armazenamento

O Arkvory mantém cada arquivo publicado uma vez, sem alterações, em um diretório de armazenamento no disco local do servidor e, opcionalmente, em [mais volumes](#volumes). Esta página explica o que ocupa espaço, como limitá-lo com cotas e políticas de retenção, como arquivos excluídos saem do disco e o que fazer quando ele fica cheio.

## Onde fica o conteúdo {#location}

O diretório é definido por `ARKVORY_DATA_DIR`. Os instaladores usam estes locais:

| Instalação     | Armazenamento                                |
| -------------- | -------------------------------------------- |
| Windows        | `data\` em `C:\ProgramData\ProAnima\Arkvory` |
| Linux          | `data/` em `/opt/proanima-arkvory`           |
| Docker Compose | O volume Docker `proanima-arkvory_storage`   |

Dentro dele, `blobs/` contém arquivos concluídos, `staging/` e `parts/` contêm uploads em andamento, e `storage-id` vincula o diretório ao banco. O catálogo, com nomes, rótulos, versões e permissões, fica no PostgreSQL. Arquivos e banco pertencem ao mesmo conjunto.

- Use um sistema de arquivos local com suporte a hard links. Não use um compartilhamento de rede.
- Não acrescente, altere nem exclua arquivos manualmente no diretório. O Arkvory os remove como descrito abaixo.
- Um arquivo publicado nunca muda. Novo conteúdo é um novo arquivo com novo ID.

## Vários volumes {#volumes}

Você pode dar ao Arkvory mais diretórios de armazenamento, por exemplo em um segundo disco, em vez de ampliar um volume. Cada diretório extra é uma instância do módulo integrado `local-storage` com seu próprio ID. O diretório de armazenamento de `ARKVORY_DATA_DIR` é sempre a instância `default`.

Configure as instâncias no arquivo de módulos (`ARKVORY_MODULES_FILE`, consulte [Variáveis de ambiente](../reference/environment)):

```json
{
  "format": 1,
  "modules": {
    "local-storage": {
      "enabled": true,
      "config": {
        "instances": {
          "volume-2": { "directory": "/srv/arkvory-volume-2" }
        }
      }
    }
  }
}
```

| Campo           | Significado                                                                                                                              | Padrão                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `directory`     | Caminho absoluto do diretório. Ele não pode conter o diretório de armazenamento ou outra instância, nem ficar dentro deles               | Obrigatório                     |
| `acceptsWrites` | `false` interrompe novos uploads para este volume. Seus arquivos continuam legíveis, e uploads que já começaram nele podem terminar      | `true`                          |
| `mode`          | `read-only` atende somente downloads e verificações e recusa toda gravação e remoção, por exemplo para um volume montado somente leitura | `full`                          |
| `enabled`       | `false` fecha o volume: seus arquivos não podem ser baixados até você ativá-lo de novo                                                   | `true`                          |
| `reserveBytes`  | Espaço livre mantido neste volume, em bytes                                                                                              | `ARKVORY_STORAGE_RESERVE_BYTES` |

Um ID tem letras minúsculas, dígitos e `-`, começa com uma letra e não é `default`. Você pode acrescentar até 16 instâncias. Todos os processos (a API, os gateways de leitura, o worker e o agente de backup) devem ler o mesmo arquivo de módulos: um processo que planeja outras instâncias não fica pronto. Reinicie todos os serviços após uma alteração.

Para acrescentar um volume:

1. Monte o volume e crie o diretório. Ele deve pertencer à conta que executa os serviços. O Arkvory não cria esse diretório. Se ele não existir, por exemplo porque o volume não está montado, o volume fica indisponível e nada é gravado sob o ponto de montagem.
2. Acrescente a instância ao arquivo de módulos e reinicie os serviços. Na primeira inicialização, a API registra a identidade do volume, o arquivo `storage-id` no diretório. A partir daí, todos os processos verificam esse arquivo. Um volume que não está montado, ou outro volume no mesmo caminho, nunca recebe gravações. Antes de cada gravação e remoção no volume, o arquivo é verificado de novo.
3. Escolha quais uploads vão para o volume com uma [política de alocação](#placement).

### Alocação de novos uploads {#placement}

A política de alocação de um repositório escolhe o armazenamento de cada novo upload. Uma regra tem um ID, um armazenamento (`backendId`) e duas condições opcionais: um grupo de pacotes (`models/*`, `tools` ou `*`) e um tamanho mínimo em bytes. Vence a primeira regra cujas condições são atendidas. Sem correspondência, o upload vai para `default`. Um repositório pode ter até 32 regras.

Leia e altere a política com `arkvoryctl` ou com as operações de API [getStoragePlacement](../api/reference/storage#getStoragePlacement) e [setStoragePlacement](../api/reference/storage#setStoragePlacement):

```bash
arkvoryctl storage placement --repository releases
arkvoryctl storage placement --repository releases --revision 0 --file rules.json
```

O arquivo `rules.json` contém a lista de regras, por exemplo todos os arquivos de 1 GiB ou mais em `volume-2`:

```json
[{ "id": "large", "backendId": "volume-2", "packageGroup": null, "minSizeBytes": "1073741824" }]
```

- Ler a política exige `storage.read`, alterá-la exige `storage.manage`. A resposta também lista cada armazenamento com seu estado: `accepting`, `not_accepting`, `read_only`, `disabled`, `unavailable` ou `not_loaded`.
- Uma regra só pode citar um armazenamento configurado. Outro nome é recusado com 400 `backend_unknown`.
- A política é salva com uma revisão. Se outra pessoa a alterou, leia-a de novo e salve novamente.
- Uma alteração vale somente para novos uploads. Arquivos já armazenados nunca mudam de volume.

### Quando um volume não aceita novos uploads {#placement-fallback}

A publicação nunca falha por causa da alocação. Se o armazenamento escolhido não aceita uploads naquele momento, por causa de `acceptsWrites: false`, `read-only`, `enabled: false`, de uma instância ausente ou de um volume indisponível (não montado, verificação de identidade com falha, sem resposta), o novo upload é criado em `default`. O upload mostra seu armazenamento em `storageBackend`, a métrica `arkvory_storage_placement_fallback_total` o conta, e o log tem a linha `storage.placement_fallback`.

- **Uploads em andamento não são movidos.** Se um volume deixa de aceitar dados enquanto um upload em partes está em andamento nele, novas partes são recusadas com 409 `backend_read_only`, e o cliente inicia um novo upload. Se todas as partes já estão lá, a conclusão do upload grava o arquivo em `default`. As partes são lidas do volume onde estão. Um arquivo que uma tentativa interrompida já gravou por completo no volume permanece lá.
- **Um volume indisponível** faz os downloads de seus arquivos falharem com 503 `unavailable` até ele voltar. O servidor continua funcionando, e a prontidão e `writable` seguem somente `default`. Cada processo verifica seus volumes de novo a cada 30 segundos.
- **A limpeza física** remove cada arquivo no volume que o contém, incluindo as partes que ficaram em outro volume. Em um volume indisponível ou somente leitura, a limpeza pula o arquivo e tenta de novo mais tarde.
- **Cotas e limites.** As cotas e `ARKVORY_CAPACITY_BYTES` contam todos os volumes juntos. A reserva vale para cada volume.
- **Arquivos temporários** de uploads raw, OCI e de espelhos ficam no diretório de armazenamento `default`.
- **Cluster.** Em um [cluster de alta disponibilidade](./cluster), cada volume deve ser um diretório no volume replicado, como o diretório de armazenamento: outro disco não é copiado para os demais servidores. Caso contrário, a API não inicia.

Acompanhe `arkvory_storage_backend_up` e `arkvory_storage_backend_accepting`; consulte [Monitoramento](./monitoring#metrics). Os backups copiam todos os volumes. Uma restauração precisa de um diretório vazio para cada volume; consulte [Restaurar vários volumes](./backups#restore-volumes).

## Planeje o disco {#disk}

O seguinte ocupa espaço no volume de armazenamento:

| O que                        | Observações                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Arquivos publicados          | Todas as versões que você mantém                                                                                                                 |
| Uploads em andamento         | Partes e arquivos temporários até o upload terminar                                                                                              |
| Partes de uploads concluídos | As partes temporárias ficam junto ao arquivo concluído até uma rodada de limpeza física removê-las. Consulte [Limpeza física](#physical-cleanup) |
| Arquivos excluídos           | Ficam no disco até terminar o período de carência e uma rodada de limpeza removê-los                                                             |
| Cópias de espelhos           | Uma parte em `mirror-staging` enquanto um espelho copia um arquivo. Consulte [Espelhos](./mirrors)                                               |

Além do armazenamento, planeje o banco PostgreSQL, os logs e o armazenamento de backups em volumes separados, se possível. Consulte [Backups](./backups).

O Arkvory mantém uma **reserva** de espaço livre no volume. Por padrão, é 1 GiB (`ARKVORY_STORAGE_RESERVE_BYTES`). Um upload que usaria a reserva é recusado com HTTP 507 e motivo `storage_full`. Downloads continuam funcionando. `GET /health/ready` mostra `writable: false` enquanto não há espaço para novos dados.

Dois limites funcionam independentemente do disco:

- `ARKVORY_CAPACITY_BYTES` limita todo o conteúdo reservado da instalação. O padrão é 10 TiB. É um limite lógico, não uma verificação do disco. Ao atingi-lo, uploads falham com HTTP 507 e motivo `catalog_limit`.
- `ARKVORY_MAX_OBJECT_BYTES` limita o tamanho de um arquivo.

Consulte [Variáveis de ambiente](../reference/environment#storage-and-limits). O Arkvory não tem uma métrica de espaço livre do armazenamento ou do banco. Monitore os volumes com ferramentas do sistema operacional ou um node exporter.

## Quem pode gerenciar o armazenamento {#permissions}

As configurações não fazem parte dos direitos normais de leitura e escrita. Uma chave de serviço precisa de ações explícitas no repositório:

| Ação               | Permite                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| `storage.read`     | Ver a política, o uso, as configurações de limpeza física e a alocação                            |
| `storage.manage`   | Alterar política, cota, configurações de limpeza física e alocação e solicitar um lote de limpeza |
| `artifact.delete`  | Visualizar exclusões, excluir artefatos e ativar uma política automática de retenção              |
| `diagnostics.read` | Ler os eventos de armazenamento                                                                   |

Contas com senha e a chave de recuperação não têm esses direitos por si só. Para gerenciar no console:

1. Crie uma conta de serviço com uma política para o repositório que inclua as quatro ações. Consulte [Contas e acesso](../use/accounts).
2. Emita e ative uma chave para ela.
3. No console, abra [[ui:keySignIn]], cole a chave e selecione [[ui:connect]].
4. Abra [[ui:repositories]] e selecione [[ui:repositoryStorage]] no cartão do repositório.

O painel [[ui:storageTitle]] aparece acima do catálogo. Sem os direitos, fica oculto.

Uma política de retenção ativada está vinculada à **chave que a ativou**. Cada execução automática verifica se a chave ainda está ativa, não expirou e ainda tem `storage.manage` e `artifact.delete`. Se você revogar a chave ou restringir seus direitos, a exclusão para e aparece `retention.failed`. Após rotacionar a chave, salve novamente a política com a nova chave.

## Cotas e limites de alerta {#quotas}

Um repositório pode ter uma cota. Sem ela, vale apenas o limite global.

| Configuração    | Campo no console              | Significado                                                                                                                     | Padrão     |
| --------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Cota            | [[ui:storageQuota]]           | O espaço máximo que o repositório pode usar. A API recebe bytes exatos, de 1 a 9 007 199 254 740 991, e `null` para não limitar | Sem limite |
| Limite de aviso | [[ui:storageWarningPercent]]  | A porcentagem da cota que gera um aviso. 1–98                                                                                   | 80         |
| Limite crítico  | [[ui:storageCriticalPercent]] | A porcentagem que gera um erro. 2–99, maior que o limite de aviso                                                               | 95         |

O uso contabilizado é o tamanho de todos os arquivos ainda não removidos do disco: publicados, uploads incompletos e excluídos aguardando limpeza. Um arquivo excluído ainda usa cota até a limpeza removê-lo.

- **Verificação.** O servidor verifica a cota no início do upload. Um novo upload que a excederia falha com HTTP 507 e motivo `storage_quota`. Repetir com a mesma chave de idempotência não reserva espaço duas vezes.
- **Redução.** É possível definir uma cota abaixo do uso atual. Uploads em andamento podem terminar. Novos uploads acima do limite são recusados.
- **Sem liberação automática.** A cota nunca causa exclusão. A retenção não remove builds extras para atender a uma cota.
- **Estados.** O estado é `unlimited`, `normal`, `warning`, `critical` ou `exceeded`. Uma mudança é registrada uma vez como evento de armazenamento.
- **Monitoramento.** O servidor verifica os estados de até 20 repositórios a cada minuto, mesmo com exclusão automática desativada.

Os números são reservas lógicas, não espaço livre no disco. Um repositório pode estar abaixo da cota com o disco cheio, pois o disco também contém arquivos temporários e outros repositórios.

## Política de retenção {#retention}

Uma política exclui automaticamente **builds UPack registrados** antigos e mantém os últimos N. Não exclui outros arquivos: arquivos por caminho, imagens de contêineres, objetos Git LFS e pacotes npm ficam fora. Sem uma política, nada é excluído automaticamente.

### Configurações {#retention-settings}

| Configuração       | Campo no console        | Significado                                                                                                | Padrão                                |
| ------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Ativar             | [[ui:storageEnabled]]   | Ativa a exclusão automática                                                                                | Desativado                            |
| Agrupamento        | [[ui:storageGrouping]]  | A unidade contada: [[ui:storagePerChannel]], [[ui:storagePerPackage]] ou [[ui:storageGlobal]]              | Pacote e canal                        |
| Últimos N          | [[ui:storageKeep]]      | Quantos builds manter por contador, 1–100 000                                                              | 10                                    |
| Canais             | [[ui:storageChannels]]  | N próprio para um rótulo, como `label=N`, um por linha, até 32. Usado só no agrupamento por pacote e canal | `test=10`, `staging=10`, `release=10` |
| Idade mínima       | [[ui:storageAge]]       | Builds mais novos que esse valor são mantidos, em horas, 0–87 600                                          | 24                                    |
| Rótulos protegidos | [[ui:storageProtected]] | Builds com um desses rótulos nunca são excluídos; até 32, separados por vírgulas                           | `bse`, `release`                      |
| Intervalo          | [[ui:storageInterval]]  | Minutos entre execuções, 1–10 080                                                                          | 60                                    |

Um rótulo tem de 1 a 64 letras, dígitos ou os caracteres `_ . : -`.

### Como os builds são escolhidos {#retention-rules}

1. O servidor ordena os builds de cada contador pelo **horário de publicação**, mais novos primeiro. Não é a ordem SemVer das versões.
2. O contador depende do agrupamento. Por pacote e canal, um build é contado separadamente em cada rótulo de canal configurado que possui, por pacote (`group/name`). Sem um rótulo configurado, entra em um contador compartilhado do pacote, com N padrão. Por pacote, cada pacote tem um contador. Para o repositório inteiro, todos compartilham um contador. Nomes de pacotes ignoram maiúsculas e minúsculas; rótulos não.
3. Um build permanece se estiver entre os últimos N de **qualquer** contador a que pertence.
4. Um build mais novo que a idade mínima permanece.
5. Um build com rótulo protegido permanece. Seus rótulos vêm da anotação atual, ou do upload se não houver anotação. Builds protegidos ainda participam da ordenação, então o total mantido pode ser maior que N.

Um build nunca é excluído enquanto algo ainda precisa dele:

- Um serviço externo mantém uma referência.
- Um caminho de arquivo, atual ou do histórico, o usa.
- Outro build o lista como anexo, agora ou no histórico.
- Ele está promovido a um estágio. Remova primeiro o estágio.
- Uma imagem de contêiner, entrada Git LFS ou npm o usa.

Excluir um build é lógico: ele sai das listas, e novos downloads falham com 404. Os bytes saem depois, na [Limpeza física](#physical-cleanup). A versão do pacote fica reservada, portanto a mesma versão não pode ser publicada novamente com outro conteúdo.

### Ative uma política com segurança {#retention-enable}

Visualize antes de ativar. A prévia mostra o que a política salva excluiria, sem excluir nada.

1. Conecte-se com uma chave que tenha as quatro ações e abra o painel de armazenamento do repositório.
2. Preencha os campos, deixe [[ui:storageEnabled]] desativado e selecione [[ui:storageSave]].
3. Selecione [[ui:storagePreview]]. A lista mostra até 100 builds que a política salva excluiria em um lote. Se restarem candidatos, o console informa.
4. Se a lista estiver correta, marque [[ui:storageEnabled]] e a confirmação [[ui:storageAcknowledge]], e salve novamente. Isso exige `artifact.delete`.

Observações:

- A prévia mostra um instante. Ao executar, a política ordena e verifica as dependências novamente.
- A política é salva com uma revisão. Se outra pessoa a alterou, recarregue e salve novamente.
- [[ui:storageRefresh]] recarrega as configurações e o uso.

### Como é executada {#retention-run}

O processo de API escritor (não um gateway de leitura) verifica a cada 60 segundos e processa até 20 políticas vencidas. Um lote exclui no máximo 100 builds. Se restarem candidatos, o próximo começa após um minuto. Caso contrário, a próxima execução ocorre após o intervalo. O agendamento fica no banco e sobrevive a reinicializações.

Você também pode executar um lote com [runStoragePolicy](../api/reference/storage#runStoragePolicy). Uso, prévia e eventos têm operações na mesma [Referência da API de armazenamento](../api/reference/storage).

## Limpeza física {#physical-cleanup}

Excluir um artefato, por uma pessoa ou política, só o remove do catálogo. A **limpeza física** remove seus bytes do disco em segundo plano, sem parar API, worker ou gateways de leitura. Ela também:

- Cancela uploads que expiraram sem terminar e remove suas partes.
- Remove as partes temporárias de uploads concluídos.

Ela não escolhe builds para excluir. Remove somente o que já foi excluído ou cancelado.

**A limpeza física é desativada por padrão e definida por repositório.** Ative-a em cada repositório usado. Até lá, arquivos excluídos, uploads expirados e partes de uploads concluídos ficam no disco, e a cota contabiliza os arquivos excluídos.

### Configurações {#cleanup-settings}

No painel do repositório, abra [[ui:cleanupTitle]]:

| Configuração        | Campo no console       | Significado                                              | Padrão     | Intervalo |
| ------------------- | ---------------------- | -------------------------------------------------------- | ---------- | --------- |
| Ativar              | [[ui:cleanupEnabled]]  | Ativa a limpeza em segundo plano                         | Desativado |           |
| Período de carência | [[ui:cleanupGrace]]    | Quanto tempo um arquivo excluído fica no disco, em horas | 24         | 0–8760    |
| Lote                | [[ui:cleanupBatch]]    | Arquivos processados por lote                            | 25         | 1–100     |
| Intervalo           | [[ui:cleanupInterval]] | Segundos entre lotes                                     | 60         | 5–86 400  |
| Pausa               | [[ui:cleanupDelay]]    | Milissegundos de pausa entre arquivos                    | 50         | 0–1000    |

Selecione [[ui:cleanupSave]] para aplicar. A alteração vale imediatamente. Ao desativar, a limpeza para após o arquivo atual. [[ui:cleanupRun]] solicita um lote em breve, sem excluir imediatamente. Selecione [[ui:cleanupRefresh]] para ver o resultado do último lote.

O período de carência não é uma lixeira. Com 0, um arquivo pode sair logo após a exclusão se nenhum leitor o tiver aberto. O Arkvory não restaura um artefato excluído.

### O que a limpeza faz e ignora {#cleanup-rules}

- Remove somente arquivos cancelados ou excluídos após a carência. Verifica novamente se nada os usa: referência, histórico de caminhos ou histórico de anexos.
- Um download aberto, upload em escrita ou arquivo necessário a um backup em execução faz a limpeza **ignorar** o arquivo. O próximo lote tenta novamente. O resultado mostra quantos arquivos processou, ignorou e falharam, e quantos bytes liberou.
- A cota e a capacidade lógica só são liberadas após remover os arquivos do disco.
- O tamanho do lote e a pausa limitam a carga no disco. Não garantem uma taxa estrita de transferência nem influência zero na latência de outras solicitações.
- A limpeza roda na API escritora, uma vez por banco. O escritor verifica um repositório vencido a cada 5 segundos. Sem escritor em execução, nada é limpo.
- Ative só após atualizar todos os processos Arkvory, inclusive gateways e worker. Um processo antigo sem o protocolo de limpeza faz o trabalho ser adiado.

## Exclua um artefato {#delete-artifacts}

É possível excluir manualmente um artefato publicado. Você precisa de `artifact.delete` no repositório.

1. Abra o artefato em [[ui:metadata]] e encontre [[ui:deletionTitle]].
2. Selecione [[ui:deletionInspect]]. O console mostra o que ainda usa o artefato. Se algo bloqueia a exclusão, remova primeiro a dependência.
3. Cole o ID para confirmar e selecione [[ui:deletionSubmit]].

Essa exclusão não verifica rótulos protegidos, pois você escolhe o objeto. As dependências sempre são verificadas. Após excluir:

- O artefato sai de listas e buscas. Um novo download falha com 404. Um download em andamento pode terminar.
- A versão do pacote fica reservada.
- Os bytes ficam no disco até a [limpeza física](#physical-cleanup) removê-los após a carência.
- Não é possível desfazer no console ou na API.

Para muitos artefatos, a API oferece [previewRetention](../api/reference/storage#previewRetention) e [applyRetention](../api/reference/storage#applyRetention). A prévia lista candidatos publicados antes de uma data com os motivos de bloqueio. A aplicação exclui só os IDs fornecidos, até 100 por chamada, e retorna um resultado para cada ID: `deleted`, `already_deleted`, `protected`, `changed`, `not_eligible` ou `not_found`. Verifique cada resultado, não só o status HTTP.

## Diagnósticos e eventos de armazenamento {#diagnostics}

[[ui:storageEvents]] lista o que aconteceu no repositório, mais antigos primeiro, 100 por página. Selecione [[ui:storageMore]] para a próxima. A leitura exige `diagnostics.read`. A operação é [getStorageEvents](../api/reference/storage#getStorageEvents), com filtro por nível (`info`, `warning`, `error`).

| Evento                                                                                                | Nível                  | Significado                                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `storage.policy_updated`                                                                              | info                   | A política de retenção foi salva                                                                                             |
| `retention.completed`                                                                                 | info                   | Um lote excluiu builds. O evento contém a contagem                                                                           |
| `retention.failed`                                                                                    | error                  | A exclusão automática parou, por exemplo porque a chave autorizadora foi revogada                                            |
| `cleanup.configured`                                                                                  | info                   | As configurações de limpeza física foram salvas                                                                              |
| `storage.placement_updated`                                                                           | info                   | A política de alocação foi salva                                                                                             |
| `cleanup.completed`                                                                                   | info ou error          | Um lote processou, ignorou ou falhou em arquivos. Lista as contagens e os bytes liberados                                    |
| `capacity.normal`, `capacity.warning`, `capacity.critical`, `capacity.exceeded`, `capacity.unlimited` | info, warning ou error | O estado da cota mudou                                                                                                       |
| Códigos de erro HTTP                                                                                  | warning ou error       | Uma solicitação de uma chave gerenciada para este repositório falhou. O evento mantém o ID da solicitação, a rota e o status |

O histórico é limitado a 1000 eventos por repositório e 20 000 no total, e os mais antigos são descartados. São diagnósticos de melhor esforço, sem garantia de entrega. Exporte em tempo o que precisar e use o log do servidor para evidências de longo prazo. Consulte [Monitoramento](./monitoring).

O painel também mostra o uso: bytes publicados, uploads incompletos, bytes aguardando limpeza e total contra a cota. A operação é [getStorageUsage](../api/reference/storage#getStorageUsage).

## Quando o disco está cheio {#disk-full}

Sinais: uploads falham com HTTP 507 e motivo `storage_full`, `GET /health/ready` mostra `writable: false`, ou o sistema informa falta de espaço. Downloads continuam funcionando. Os clientes podem retomar uploads após liberar espaço.

1. **Encontre a causa.** Verifique espaço livre nos volumes de armazenamento, banco e backups. Compare os números no painel. Muitos bytes aguardando limpeza indicam dados excluídos ainda no disco. Muitos uploads incompletos indicam uploads abandonados.
2. **Execute a limpeza.** Se estiver desativada, ative em cada repositório, com carência curta como 0 se aceitar remover arquivos excluídos imediatamente. Selecione [[ui:cleanupRun]]. Ela também remove partes temporárias de uploads concluídos e uploads expirados. Aguarde os lotes e leia o último resultado. A limpeza ignora arquivos em uso, então repita.
3. **Exclua o que não precisa.** Aplique uma política de retenção ou exclua artefatos. Isso só libera espaço quando a limpeza remove os bytes.
4. **Acrescente espaço.** Amplie o volume ou disco. Mova backups ou outros dados para outro volume se o compartilham. Você também pode [acrescentar um volume](#volumes) e alocar novos uploads nele.
5. **Verifique a recuperação.** Com espaço livre, `writable` volta a `true` e uploads funcionam novamente.

Não exclua manualmente arquivos em `blobs/`, `staging/` ou `parts/`: isso rompe a ligação entre banco e disco. Se a reserva for pequena para logs e banco no mesmo volume, aumente `ARKVORY_STORAGE_RESERVE_BYTES`.

Se o motivo for `storage_quota` ou `catalog_limit`, o problema não é o disco. Aumente a cota ou o limite global, ou exclua dados.

## Limites {#limits}

- A retenção trata só builds UPack registrados. Nunca remove outros arquivos.
- A ordem de retenção é o horário de publicação, não o número da versão.
- Armazenamento, cotas e limpeza exigem ações explícitas de uma chave de serviço. Contas com senha e a chave de recuperação não as têm.
- A limpeza física é desativada por padrão e definida por repositório.
- Um artefato excluído não pode ser restaurado. Restaure os dados de um backup. Consulte [Backups](./backups).
- Repositórios espelhados não executam políticas de armazenamento. Consulte [Espelhos](./mirrors).
- O armazenamento deve ser um sistema de arquivos local. Não há suporte a compartilhamentos de rede. Os [volumes](#volumes) extras também são diretórios locais, e o Arkvory não move arquivos armazenados entre eles.
- No Windows, o Arkvory sincroniza cada arquivo com o disco, mas não consegue sincronizar a entrada de diretório que o publica: o Node.js não oferece sincronização de diretórios ali. Uma queda de energia logo após um upload pode deixar um arquivo publicado ausente do disco. Use um nobreak e mantenha [backups](./backups) ou um [espelho](./mirrors). No Linux, as entradas de diretório também são sincronizadas.

## Páginas relacionadas {#related-pages}

- [Backups](./backups)
- [Espelhos](./mirrors)
- [Monitoramento](./monitoring)
- [Solução de problemas](./troubleshooting)
- [Variáveis de ambiente](../reference/environment)
- [Repositórios](../use/repositories)
