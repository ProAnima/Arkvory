---
title: Espelhos e um segundo site
description: Mantenha uma cópia somente leitura dos repositórios em uma segunda instalação, acompanhe a sincronização dela e troque para ela quando a origem for perdida.
---

# Espelhos e um segundo site

Um **espelho** é um repositório de uma instalação do Arkvory que é uma cópia somente leitura de um repositório de outra instalação, a **origem**. A instalação do espelho busca as alterações da origem por HTTPS. Ela mantém o próprio banco de dados, o próprio armazenamento, as próprias contas e as próprias chaves.

Use um espelho para servir downloads de um segundo local e para manter um segundo site que possa assumir quando a origem for perdida. Um espelho não é um backup da origem nem alta disponibilidade automática. Você faz a troca por conta própria. Para outras proteções, consulte [Backups](./backups) e [Gateways de leitura](./read-gateways).

## O que é um espelho {#what-a-mirror-is}

Para um repositório espelhado, a instalação do espelho copia:

- Os arquivos publicados, com os bytes deles e os **mesmos IDs de artefato** da origem.
- Rótulos, metadados e coleções.
- O registro UPack, os estágios e os caminhos de arquivo atuais.
- As imagens de contêiner, os objetos Git LFS e os pacotes npm do repositório.
- As exclusões. Um arquivo excluído na origem é excluído no espelho.

Os downloads por ID, por pacote (versão, intervalo, estágio) e por caminho de arquivo respondem no espelho como respondiam na origem na última sincronização. Eles continuam funcionando quando a origem está fora do ar.

Um espelho não copia:

- Contas, grupos, chaves e permissões de acesso. O espelho tem as próprias, e elas são independentes: revogar uma chave na origem não afeta o espelho.
- As referências que protegem arquivos da limpeza, os anexos de builds, os registros de auditoria e as políticas de armazenamento.
- O histórico dos caminhos de arquivo anterior à primeira sincronização. Os números de versão dos rótulos e dos caminhos no espelho são próprios dele.

Os clientes não podem gravar em um repositório espelhado. Uploads, alterações de rótulos, caminhos de arquivo, estágios, exclusões e promoções para ele recebem HTTP 409 com o motivo `mirror_read_only`. Os outros repositórios da instalação do espelho funcionam normalmente. As políticas de armazenamento não são executadas em um repositório espelhado, e somente a sincronização exclui nele.

## Configurar um espelho {#set-up}

Você precisa de uma chave na origem e de um comando no espelho.

### Criar uma chave na origem {#source-key}

O espelho precisa de uma chave que só possa ler o repositório de origem. Uma chave de gravação não é necessária.

1. Na origem, abra [[ui:services]] com a chave de recuperação ou com uma chave de operador.
2. Selecione [[ui:serviceCreate]] e, em [[ui:servicePolicy]], adicione o repositório. Selecione [[ui:bindingRead]] para preencher as permissões de que um espelho precisa. Elas incluem `artifact.list`, `artifact.read`, `content.read`, `annotation.read`, `asset.read` e `package.read`.
3. Selecione [[ui:keyIssue]], copie o segredo, confirme [[ui:keySaved]] e selecione [[ui:keyActivate]]. Uma chave que não é ativada expira após 15 minutos.
4. Salve o segredo em um arquivo no servidor do espelho. O arquivo contém apenas a chave, em uma linha, com 16 a 4000 caracteres imprimíveis. Somente o root ou o grupo Administradores pode lê-lo.

A origem precisa ser um release com o feed de alterações. O comando do próximo passo verifica isso.

### Anexar o repositório no espelho {#attach}

Use um nome de repositório **novo e vazio** no espelho. A sincronização deixa o repositório igual ao da origem, mas nunca exclui o que a origem nunca teve.

```bash
sudo arkvory configure --root /opt/proanima-arkvory \
  --mirror releases \
  --mirror-upstream https://arkvory.example \
  --mirror-token-file /root/mirror-releases.key
```

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' configure --root $root `
  --mirror releases --mirror-upstream https://arkvory.example `
  --mirror-token-file C:\secure\mirror-releases.key
```

| Opção                      | Significado                                                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--mirror NAME`            | O repositório nesta instalação. De 1 a 64 caracteres: letras minúsculas, dígitos, `_` e `-`, começando com uma letra ou um dígito                                                  |
| `--mirror-upstream URL`    | O endereço do servidor de origem: `https://host`, sem caminho, sem credenciais e sem parâmetros de consulta. `http://` simples só é aceito para `localhost`, `127.0.0.1` e `[::1]` |
| `--mirror-token-file FILE` | Um caminho absoluto para o arquivo de chave                                                                                                                                        |
| `--mirror-source NAME`     | O repositório na origem. Padrão: o mesmo nome de `--mirror`                                                                                                                        |
| `--mirror-ca-file FILE`    | Um arquivo PEM com a autoridade certificadora da origem. Consulte [HTTPS com uma autoridade certificadora própria](#ca-file)                                                       |

Use um repositório por comando. Você não pode combinar uma alteração de espelho com alterações de HTTPS, do vault ou de atualizações na mesma chamada.

1. O comando verifica a origem com a chave antes de alterar qualquer coisa. A origem precisa informar o feed de alterações do espelho, e o feed do repositório de origem precisa responder.
2. Ele armazena a chave em `config/mirrors/NAME.token`, grava `config/mirrors/mirrors.json` e define `ARKVORY_MIRRORS_FILE` em `config/runtime.json`.
3. Ele reinicia a API e o worker e espera até que estejam prontos. Se algo falhar, ele restaura os arquivos anteriores e reinicia de novo.

No Docker Compose, o comando também grava `config/compose.mirrors.yml`, que monta os arquivos do espelho nos contêineres da API e do worker. Adicione esse arquivo aos comandos do Compose que você executa por conta própria.

Para substituir a chave de um repositório, repita o comando apenas com `--mirror` e o novo `--mirror-token-file`. A origem, os estágios e as autoridades certificadoras permanecem como estão, e um espelho nunca vira uma importação por causa de um comando repetido. O comando reinicia a API e o worker. O worker também lê o arquivo de chave de novo depois de cada falha, então um arquivo de chave substituído manualmente funciona sem reinicialização.

```bash
sudo arkvory configure --root /opt/proanima-arkvory \
  --mirror releases --mirror-token-file /root/new-mirror-releases.key
```

Quando a origem recusa a chave, o comando para antes de alterar qualquer coisa e informa o motivo: a chave não é aceita (401), ela não tem permissão para ler o repositório (403) ou o repositório não existe na origem (404). Um repositório que já espelha uma origem recusa outra origem com a mensagem `NAME mirrors another source; detach it first`.

Na instalação do espelho, dê às pessoas e às ferramentas acesso ao repositório. Um repositório passa a existir assim que uma permissão de acesso ou uma política de serviço o menciona. Use [[ui:manageGrants]] em [[ui:administration]] para as pessoas e uma política de serviço para as ferramentas. As permissões da origem não são transferidas.

### HTTPS com uma autoridade certificadora própria {#ca-file}

Se a origem usa um certificado de uma autoridade corporativa ou autoassinada, adicione `--mirror-ca-file /path/ca.pem` ao comando `--mirror`. O comando verifica se cada certificado pode ser lido e não expirou, e armazena de 1 a 64 certificados em `config/mirrors/ca.pem` (o arquivo não pode passar de 1 MiB). O worker passa então a confiar neles, além dos certificados padrão.

- O arquivo atende a todos os espelhos da instalação. Um novo `--mirror-ca-file` acrescenta ao arquivo, e um certificado que já está lá é mantido uma só vez. Desanexar o último espelho remove o arquivo.
- O worker confia em todo o conjunto para todas as conexões dele, não somente para um espelho.
- A verificação de certificados nunca é desativada.

## O que é copiado e com que frequência {#sync}

O worker da instalação do espelho faz a sincronização. Não há um serviço separado. Para cada repositório espelhado, ele executa estes passos:

1. **Primeiro preenchimento.** O worker anota a posição atual do feed de alterações da origem. Em seguida, lê a lista de artefatos, pacotes e caminhos de arquivo página por página e deixa o espelho igual a ela.
2. **Acompanhamento.** O worker lê o feed da origem. Quando está em dia, verifica de novo a cada 10 segundos. Ele salva a posição dele depois de cada alteração aplicada.
3. **Cópia de arquivos.** Um arquivo é copiado em partes. O worker confere o SHA-256 de cada parte e do arquivo inteiro. Depois de uma interrupção, ele continua pela primeira parte que falta. Uma parte espera em `mirror-staging`, dentro do diretório de armazenamento do espelho.
4. **Depois de um erro.** O worker repete o passo depois de uma pausa que começa em 2 segundos e dobra até 5 minutos. Um espelho com falha não interrompe os outros.

Uma instalação pode ter até 64 repositórios espelhados. As cópias contam para o limite de capacidade e para o disco do espelho, então planeje o mesmo espaço de que o repositório de origem precisa. Consulte [Armazenamento](./storage).

Se a chave de origem for revogada ou a origem estiver inacessível, o espelho continua servindo o que já tem e mostra o erro no status dele.

## Verificar o status da sincronização {#status}

### No console {#status-console}

[[ui:mirrors]] no menu lista cada espelho e cada importação cujo repositório você pode ler, com a origem, o estado, a última sincronização e o que foi copiado. Os administradores sempre veem a página; enquanto não há nenhum espelho, ela explica como configurar um. A página se atualiza sozinha a cada 20 segundos.

| Estado                    | Significado                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| [[ui:mirrorStateSynced]]  | Em dia com a origem                                                                             |
| [[ui:mirrorStateBehind]]  | Copiando as alterações que a origem fez desde a última verificação                              |
| [[ui:mirrorStatePending]] | Configurado, e o worker ainda não chegou a ele                                                  |
| [[ui:mirrorStateSeeding]] | O primeiro preenchimento, ou um novo depois que a origem foi restaurada                         |
| [[ui:mirrorStateFailing]] | A última tentativa falhou. Os downloads continuam funcionando, e o worker tenta de novo sozinho |

Quando a sincronização para, a página informa o motivo e o que fazer em seguida, e mostra o comando que resolve o problema quando ele existe, por exemplo uma chave nova depois que a origem recusou a antiga. Os textos seguem os [códigos de erro](#error-codes).

Conectado a um repositório espelhado, o console também mostra um selo acima do catálogo: [[ui:mirrorBadge]], [[ui:mirrorBehind]] ou [[ui:mirrorFailing]]. O motivo e o próximo passo aparecem abaixo dele enquanto a sincronização está parada, e o selo acompanha o servidor sem recarregar a página. Abra a ajuda do selo ([[ui:mirrorHelpLabel]]) para ver a origem e o horário da última sincronização. O console oculta os botões de upload e de alteração em um repositório espelhado.

### Com a API {#status-api}

[getRepositoryMirror](../api/reference/mirrors#getRepositoryMirror) retorna o status de um repositório. Ele exige a permissão de ler o repositório. Para um repositório comum, a resposta é 404.

| Campo                            | Significado                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `mode`                           | `mirror` ou `import`                                                                                                      |
| `phase`                          | `pending` (o worker não começou), `seeding` (primeiro preenchimento) ou `following`                                       |
| `caughtUp`                       | `true` quando a posição salva é igual à posição mais recente da origem. `null` antes de o primeiro preenchimento terminar |
| `checkedAt`, `syncedAt`          | Quando o worker leu o feed pela última vez e quando esteve em dia pela última vez                                         |
| `copiedArtifacts`, `copiedBytes` | Totais copiados até agora (`copiedBytes` é uma string decimal)                                                            |
| `errorCode`, `errorAt`           | A última falha de um passo, ou `null`                                                                                     |

### Códigos de erro {#error-codes}

| `errorCode`               | Significado e o que fazer                                                                                                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mirror_mismatch`         | O mesmo ID de artefato tem conteúdo diferente na origem. O espelho mantém o arquivo dele. Investigue o artefato; não exclua nenhuma das cópias antes de saber a causa                                                                                                                                                                 |
| `mirror_source_changed`   | O repositório já contém uma cópia de outra origem. Desanexe-o ou espelhe a nova origem em um novo repositório                                                                                                                                                                                                                         |
| `mirror_source_behind`    | A origem foi restaurada ou reinstalada: a alteração na posição do espelho não é a que ele aplicou ali. O espelho lê a origem de novo, e o código desaparece quando ele estiver em dia. Os arquivos que a origem restaurada não tem permanecem no espelho                                                                              |
| `mirror_delete_blocked`   | A origem excluiu um arquivo que o espelho não consegue excluir, porque algo aqui ainda o usa, como uma referência ou o histórico de um caminho de arquivo                                                                                                                                                                             |
| `mirror_detached`         | O repositório foi desanexado e tem alterações próprias. Ele nunca mais é sincronizado. Espelhe a origem em um repositório novo                                                                                                                                                                                                        |
| `mirror_package_conflict` | Uma versão da origem tem uma versão de pacote (grupo, nome e versão) que este repositório guarda com outros bytes. Os clientes continuam recebendo a versão de pacote que está aqui; o arquivo copiado permanece sem registro de pacote até que você o exclua. Remova o estágio ou a versão na origem, ou publique-a com outra versão |
| `mirror_id_taken`         | Um artefato da origem está em outro repositório desta instalação. Um repositório de origem só pode preencher um repositório aqui                                                                                                                                                                                                      |
| `mirror_unreachable`      | Não é possível alcançar a origem: a conexão é recusada ou expira, ou o nome não é resolvido. O worker tenta de novo sozinho. Verifique a rede, o firewall e se a origem está em execução                                                                                                                                              |
| `mirror_certificate`      | O certificado da origem não é confiável, expirou ou não corresponde ao nome dela. Adicione a autoridade dele com `--mirror-ca-file` (consulte [HTTPS com uma autoridade certificadora própria](#ca-file))                                                                                                                             |
| `mirror_failed`           | Uma falha sem um código mais específico. Leia o log do worker                                                                                                                                                                                                                                                                         |
| outros códigos            | O código da solicitação que falhou: `unauthorized` quando a origem não aceita mais a chave (dê uma nova ao espelho), `forbidden` quando a chave não tem permissão para ler o repositório, `not_found` quando o repositório de origem não existe mais, `capacity_exceeded` quando o espelho está cheio                                 |

O log do worker (`component` é `mirror`) tem `mirror.started`, `mirror.step_failed` com `errorCode` e `attempts`, `mirror.recovered` e `mirror.stopped`.

## Monitorar espelhos {#monitoring}

A API da instalação do espelho expõe três métricas para cada repositório espelhado, com os rótulos `repository` e `mode`:

- `arkvory_mirror_last_sync_timestamp_seconds`: a última vez em que o espelho esteve em dia.
- `arkvory_mirror_last_check_timestamp_seconds`: a última vez em que ele leu o feed.
- `arkvory_mirror_failing`: 1 enquanto a última tentativa falhou; não enquanto o espelho lê de novo uma origem restaurada (`mirror_source_behind`).

As regras prontas do Prometheus são `ArkvoryMirrorStale` (sem estar em dia há mais de uma hora, por 15 minutos) e `ArkvoryMirrorFailing` (a falha dura 15 minutos). Consulte [Monitoramento](./monitoring). Um espelho que o worker ainda não alcançou não tem horário de sincronização, então a regra de atraso não dispara antes da primeira sincronização.

## Importar por estágio {#import}

Com `--mirror-stages`, o repositório da segunda instalação **não** é um espelho. É um repositório comum com permissão de gravação que assume as versões que têm um dos estágios na origem. Use-o para mover builds de um servidor de desenvolvimento para um servidor de produção.

```bash
sudo arkvory configure --root /opt/proanima-arkvory \
  --mirror releases --mirror-upstream https://dev.example \
  --mirror-token-file /root/dev.key --mirror-stages release
```

- Você lista de 1 a 16 nomes de estágio diferentes, separados por vírgulas.
- Uma versão é copiada uma só vez, com o mesmo ID, os mesmos bytes, os mesmos rótulos e o mesmo registro UPack, e com os estágios correspondentes.
- Depois disso, ela pertence a esta instalação. As alterações, a remoção de estágios e as exclusões na origem não chegam a ela. Uma versão que você exclui aqui nunca é importada de novo. Um estágio que você remove aqui continua removido. Quando a origem depois atribui à versão outro estágio configurado, só esse estágio é adicionado.
- Os uploads e a política de armazenamento do repositório funcionam normalmente.
- Os dados de imagens de contêiner, de Git LFS e do registro npm não são transferidos.
- Uma alteração dos estágios inicia um novo primeiro preenchimento. Ele só traz as versões que ainda não estão aqui e deixa como estão as que já estão.
- Uma versão da origem cuja versão de pacote este repositório já guarda com outros bytes interrompe a importação com `mirror_package_conflict`. Os clientes continuam recebendo a versão que está aqui.

Duas instalações podem importar uma da outra. Por exemplo, a produção recebe `release` do staging, e o staging recebe `hotfix` da produção. Uma versão mantém o mesmo ID nos dois lados, então nada é copiado duas vezes nem fica circulando:

- Uma versão criada no staging que volta da produção só recebe o novo estágio.
- Uma versão excluída em um lado nunca é importada de novo do outro, mesmo que o outro lado lhe atribua um estágio depois.
- Uma exclusão nunca é repassada: o outro lado mantém sua cópia até que você a exclua lá também.

Use estágios diferentes para as duas direções. Com o mesmo estágio nas duas direções, um estágio que você remove em um lado volta quando o outro lado atribui esse estágio à versão de novo.

O console mostra o selo [[ui:mirrorImport]] ou [[ui:mirrorImportFailing]] quando a última tentativa falhou. A chave na origem precisa das mesmas permissões somente de leitura que para um espelho.

## Fazer o failover quando a origem é perdida {#failover}

Esta é uma troca manual entre duas instalações independentes em dois sites. Ela não é automática. As alterações que o espelho ainda não tinha buscado são perdidas.

### Preparar com antecedência {#failover-prepare}

1. Instale o segundo site com o mesmo release da origem, se possível, com o próprio PostgreSQL e o próprio disco. Os dois sites não compartilham nada.
2. Crie uma chave somente leitura na origem e anexe cada repositório como um espelho. Um repositório criado depois na origem não aparece sozinho no espelho, então anexe-o do mesmo jeito.
3. No espelho, emita as chaves que os seus consumidores usarão, inclusive chaves que possam gravar depois da troca. As permissões da origem não são transferidas, então uma origem comprometida não dá acesso ao espelho.
4. Configure os consumidores (CI, agentes de implantação) com o endereço do espelho como alternativa para downloads. Isso também alivia a carga do link com a origem.
5. Faça backup da origem em um vault fora do site dela. Consulte [Backups](./backups). Um espelho não substitui isso.
6. Monitore o espelho com as regras acima.

### Trocar {#failover-switch}

1. Certifique-se de que a origem está de fato indisponível para os clientes e não voltará sozinha. Dois sites que aceitam gravações no mesmo repositório lógico não podem ser mesclados depois. Se a origem estiver parcialmente acessível, pare os serviços dela ou feche a porta.
2. No espelho, leia o `syncedAt` de cada repositório. As alterações na origem depois desse horário não estão no espelho.
3. Desanexe cada repositório espelhado no espelho. Ele se torna um repositório comum com permissão de gravação, com os mesmos IDs de artefato e todos os dados dele.

   ```bash
   sudo arkvory configure --root /opt/proanima-arkvory --mirror-detach releases,prod
   ```

   Indique vários repositórios separados por vírgulas, ou `all` para todos os espelhos e importações. O comando reinicia a API e o worker uma única vez, então espere uma breve interrupção.

4. Aponte os clientes que gravam para o espelho, por DNS ou pela configuração do seu CI.
5. Envie e baixe um arquivo de controle no espelho.

O que os clientes veem:

- Antes da troca, os downloads do espelho funcionam, e as gravações recebem 409 `mirror_read_only`.
- Depois de desanexar, as gravações funcionam. O selo desaparece.
- As chaves e as senhas da origem não funcionam no espelho, a menos que você tenha criado as mesmas contas nele.

Não há volta. Um repositório desanexado não pode ser anexado de novo como espelho: a sincronização dele para com `mirror_detached`. Para trazer a origem antiga de volta, limpe-a ou instale-a do zero e anexe os repositórios do novo primário como espelhos. Nunca execute a origem antiga e o novo primário lado a lado com as gravações ativadas.

### Ensaiar {#failover-rehearse}

Ensaie a troca a cada trimestre e depois das atualizações. Desanexe um repositório em uma cópia reserva, verifique o `syncedAt`, um download e um upload e anote a data e o resultado. Teste separadamente a restauração de um backup da origem em uma instalação vazia. Consulte [Teste a restauração com regularidade](./backups#test-restore).

## Limites {#limits}

- Um espelho é somente leitura até você desanexá-lo. Um repositório desanexado não pode voltar a ser um espelho.
- O espelho não é um backup. Ele não tem cópia de contas, chaves nem permissões de acesso, e não copia referências, anexos, registros de auditoria nem políticas de armazenamento.
- O modo de importação não copia imagens de contêiner, Git LFS nem dados do npm.
- Um novo primeiro preenchimento apenas adiciona e atualiza: depois de uma restauração da origem, os arquivos que a origem perdeu permanecem no espelho.
- Um repositório de origem preenche um repositório de uma instalação: os IDs de artefato são os mesmos nos dois lados, então um segundo espelho ou importação dele é recusado ao ser configurado. Pelo mesmo motivo, duas instalações que importam uma da outra devem usar o mesmo nome de repositório nos dois lados: uma versão que veio do outro lado não pode ser levada aqui para outro repositório, e a importação para com `mirror_id_taken`.
- Uma versão cuja versão de pacote já é guardada aqui com outros bytes é copiada, e então a importação para com `mirror_package_conflict`. A cópia permanece no repositório sem registro de pacote até que você a exclua.
- Depois de restaurar a instalação do espelho a partir de um backup, as versões que foram importadas e excluídas após o backup podem ser importadas de novo.
- As duas instalações são atualizadas por conta própria. A origem precisa oferecer o feed de alterações do espelho.
- O conjunto de autoridades confiáveis da origem vale para o worker inteiro.
- Não há failover automático, nem isolamento (fencing) da origem antiga, nem sincronização reversa.

## Páginas relacionadas {#related-pages}

- [Backups](./backups)
- [Gateways de leitura](./read-gateways)
- [Armazenamento](./storage)
- [Monitoramento](./monitoring)
- [Variáveis de ambiente](../reference/environment#mirrors)
- [Contas e acesso](../use/accounts)
