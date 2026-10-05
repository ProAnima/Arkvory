---
title: Conceitos
description: 'As ideias usadas pelo restante da documentação, da instalação e dos repositórios ao acesso, à retenção, aos backups e aos espelhos.'
---

# Conceitos

Esta página explica as palavras que as outras páginas usam. Cada seção é curta e leva à página que cobre o assunto por completo. Para definições de uma linha, consulte o [Glossário](../reference/glossary).

## Instalação e seus serviços {#installation}

Uma instalação é um servidor. Ela executa três serviços do Arkvory ao lado de um banco de dados PostgreSQL:

| Parte            | O que ela faz                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| API              | O servidor HTTP: a API HTTP, o [console web](./console) e os registros para contêineres, Git LFS e npm. Também executa a retenção e a limpeza física. |
| Worker           | Tarefas em segundo plano: conclui uploads grandes e sincroniza espelhos.                                                                              |
| Agente de backup | Backups agendados no armazenamento de backups (vault).                                                                                                |
| PostgreSQL       | O catálogo: artefatos, pacotes, revisões, contas, chaves e tarefas.                                                                                   |

O conteúdo dos arquivos fica em um diretório local do servidor, não no banco de dados. Todas as partes ficam na **raiz da instalação** (`C:\ProgramData\ProAnima\Arkvory` no Windows, `/opt/proanima-arkvory` no Linux). Os serviços iniciam sem um usuário conectado e reiniciam após uma falha ou um travamento ([Autorrecuperação](../operate/self-healing)).

Uma instalação não é um cluster de alta disponibilidade. Se o servidor parar, os clientes esperam e depois continuam suas transferências. Consulte [Escolher uma instalação](../install/index).

## Repositórios {#repositories}

Um **repositório** é um espaço nomeado para conteúdo. Ele tem suas próprias regras de acesso, sua própria política de armazenamento (cota e retenção) e, opcionalmente, uma origem de espelho. Um nome de repositório tem de 1 a 64 caracteres: letras latinas minúsculas, dígitos, `-` e `_`, começando com uma letra ou um dígito.

Você não cria um repositório com um comando separado. Um repositório existe assim que um grupo recebe acesso ao seu nome ou uma política de conta de serviço o nomeia. Uma nova instalação tem um lugar para o primeiro, `releases`. Consulte [Repositórios](../use/repositories).

## Artefatos {#artifacts}

Um **artefato** é um arquivo armazenado. Ele é **imutável**: seus bytes nunca mudam. Ele tem um UUID, um nome (até 240 caracteres, sem `/` ou `\`), um tamanho e uma soma de verificação SHA-256. Conteúdo novo cria um novo artefato; ele nunca substitui um antigo.

Um artefato só fica visível depois que o servidor verifica que os bytes correspondem ao tamanho declarado e ao SHA-256. Um download retorna os mesmos bytes, com a soma de verificação como um `ETag` forte. Todo o resto no Arkvory fica sobre artefatos: uma versão de pacote, uma revisão de um caminho, uma camada de contêiner e um objeto Git LFS são todos artefatos.

## Uploads {#uploads}

Um **upload** reserva um artefato futuro. Você cria uma **sessão de upload** com o nome, o tamanho e o SHA-256 do arquivo, e com uma `Idempotency-Key` que torna a solicitação segura para repetir. Depois você envia os bytes:

- em uma única solicitação, para arquivos pequenos e médios; ou
- em **partes**, para arquivos grandes. O servidor escolhe o tamanho da parte: no mínimo 8 MiB, dobrado para arquivos muito grandes para que o upload nunca precise de mais de 10.000 partes. Uma parte nunca excede 1 GiB. Cada parte carrega seu próprio SHA-256, e uma parte repetida é inofensiva.

Depois você **conclui** o upload. O servidor verifica o arquivo inteiro e o publica. Para arquivos grandes, o worker conclui o upload em uma **tarefa de conclusão** que o cliente acompanha; o SDK e o cliente de linha de comando escolhem isso para arquivos de 16 GiB ou mais. Uma sessão de upload vive por 7 dias. Um upload interrompido continua a partir das partes que o servidor já tem. O maior objeto é 10.000 GiB, a menos que o administrador defina um `ARKVORY_MAX_OBJECT_BYTES` menor.

O [cliente de linha de comando](../protocols/cli) e o [SDK](../protocols/sdk) fazem tudo isso por você. Consulte [Transferências](../use/transfers) e a [referência de Uploads](../api/reference/uploads).

## Pacotes {#packages}

Um **pacote** é um arquivo UPack que o Arkvory registrou. Sua identidade é um **grupo**, um **nome** e uma **versão SemVer**, por exemplo `acme` / `game-server` / `1.4.2`. O grupo faz parte da identidade: dois pacotes com o mesmo nome em grupos diferentes são pacotes diferentes. Uma versão publicada nunca muda; publicar a mesma versão com outro conteúdo é recusado.

Um agente de implantação pede um pacote por versão exata, por um **intervalo de versões** como `^1.4`, ou pela versão mais recente em um **estágio**. Versões de pré-lançamento aparecem somente quando você as pede. Consulte [Pacotes](../use/packages).

## Arquivos por caminho {#files-by-path}

Um **arquivo por caminho** tem um endereço como `builds/game/1.4/Setup.exe` e aponta para um artefato. Quando você armazena novos bytes no caminho, o caminho recebe uma nova **revisão** (1, 2, 3 e assim por diante). As revisões anteriores permanecem no **histórico**, e você pode **restaurar** uma: restaurar adiciona uma nova revisão com o conteúdo antigo. Armazenar os mesmos bytes novamente não adiciona nada.

Um caminho tem no máximo 1.024 caracteres, usa `/` como separador e não tem segmentos vazios, `.` ou `..` e nem `:`. Uma alteração informa a revisão que ela espera; se outra alteração veio primeiro, o servidor responde `409`. Use `0` para um caminho que ainda não existe. Consulte [Arquivos e caminhos](../use/files) e [Arquivos brutos](../protocols/raw-files).

## Rótulos, metadados, coleções e anexos {#annotations}

Você pode descrever um artefato sem tocar em seus bytes:

| Item      | Regra                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rótulos   | Até 32 tags curtas como `nightly` ou `tested`.                                                                                                         |
| Metadados | Até 32 campos de texto; uma chave tem até 64 caracteres, um valor até 1.024.                                                                           |
| Coleções  | Conjuntos nomeados que agrupam artefatos.                                                                                                              |
| Anexos    | Até 32 vínculos de um build para outros artefatos do mesmo repositório: um manifesto, um SBOM, uma assinatura, um relatório ou qualquer outro arquivo. |

Rótulos, metadados e coleções mudam como um único conjunto versionado. Os anexos têm sua própria revisão e histórico.

## Estágios e promoção {#stages-and-promotion}

Um **estágio** é uma marca controlada em um build, como `qa`, `release` ou `prod`. Um nome de estágio usa letras minúsculas, dígitos, `.`, `_` e `-` (até 32 caracteres), e um artefato pode ter até 16 estágios. Alterar um estágio exige sua própria permissão, `artifact.promote`, e cada alteração é registrada com o autor, o horário e um comentário.

A **promoção** publica um build em outro repositório sem enviar os bytes novamente. `copy` mantém a origem; `move` também remove o build do repositório de origem. Repetir uma promoção retorna a cópia que já existe. **Resolver** encontra o build para o qual um estágio e um intervalo de versões apontam. Consulte [Promoção](../use/promotion).

## Contas, grupos e permissões {#access}

Pessoas usam **contas**. Uma conta tem um nome (de 3 a 64 caracteres) e uma senha (de 12 a 128 caracteres). Uma conta de **administrador** gerencia contas e grupos. As contas pertencem a **grupos**, e um grupo recebe acesso `read` ou `write` ("Leitura e escrita") a um repositório. Os direitos são recalculados a cada solicitação, então uma alteração passa a valer imediatamente.

A automação usa uma **conta de serviço**. Sua **política** lista **ações** exatas por repositório, como `upload.create` ou `content.read`, e suas chaves só podem restringir essa política. O servidor verifica cada ação; esconder um botão no console não é uma proteção. Consulte [Contas e acesso](../use/accounts) e [Autenticação](../api/authentication).

## Chaves e tokens {#keys-and-tokens}

Cada solicitação carrega uma credencial. Há quatro tipos que você cria, e um embutido:

| Credencial                  | Para                                        | Validade                                   |
| --------------------------- | ------------------------------------------- | ------------------------------------------ |
| **Sessão** do console       | Uma pessoa conectada com nome e senha       | 12 horas                                   |
| **Token de acesso pessoal** | Scripts e ferramentas de uma pessoa         | 90 dias por padrão, no máximo 365          |
| **Chave de serviço**        | CI/CD e agentes de implantação              | 90 dias por padrão, no máximo 365          |
| **Link de download**        | Entregar um artefato a alguém sem uma chave | 60 segundos a 24 horas (1 hora por padrão) |
| **Chave de recuperação**    | A própria instalação                        | Não expira                                 |

Uma chave de serviço é emitida uma vez, mostrada uma vez, e só se torna utilizável depois de ser **ativada**. Você pode **rotacioná-la** (emitir uma nova e depois aposentar a antiga) e **revogá-la** definitivamente. Consulte [Autenticação](../api/authentication).

## O proprietário e a chave de recuperação {#owner-and-recovery-key}

O **proprietário** é a primeira conta. É um administrador e membro do grupo `arkvory-owners`, que tem acesso `write` a `releases`. O instalador do Windows o cria; no Linux e no Docker você o cria no console com a chave de recuperação.

A **chave de recuperação** é um segredo que o instalador grava em `config/bootstrap-token.txt` na raiz da instalação. Ela pode criar o primeiro proprietário e contas, gerenciar contas de serviço e suas delegações, executar backups e solicitar atualizações. As ferramentas de instalação a leem no servidor. Ela não é para CI nem para o trabalho diário: mantenha-a no servidor e não a copie. Consulte [Escolher uma instalação](../install/index#recovery-key) e [Segurança](../operate/security).

## Retenção, cotas e limpeza {#retention}

Uma **política de armazenamento** pertence a um repositório. Ela pode manter os últimos N builds de cada pacote (ou de cada pacote e canal), proteger rótulos e estágios contra remoção, esperar uma idade mínima antes de remover qualquer coisa e definir uma **cota** com limites de aviso e crítico. Ela fica desativada até que um administrador a ative. Remover um artefato é lógico primeiro: os bytes permanecem no disco por um **período de carência** (24 horas por padrão) e então a **limpeza física** libera o espaço em segundo plano, em pequenos lotes, sem parar o servidor.

O servidor também mantém uma reserva de espaço livre em disco (1 GiB por padrão) que os uploads nunca usam. Consulte [Armazenamento](../operate/storage).

## Backups {#backups}

O **agente de backup** copia o banco de dados e todo o conteúdo publicado para o **armazenamento de backups (vault)**, uma pasta em outro disco ou em um compartilhamento de rede. Uma cópia completa é um **ponto de restauração**. O agente verifica cada ponto, aplica a retenção aos pontos (7 diários, 4 semanais e 6 mensais por padrão) e permite que você **fixe** um ponto para que a retenção o mantenha. O agendamento diário fica desativado até que um administrador o ative em [[ui:backupPlan]].

Restaurar é um comando no servidor. Ele grava em um banco de dados vazio e em um diretório de armazenamento vazio. Consulte [Backups](../operate/backups).

## Espelhos e gateways de leitura {#mirrors-and-gateways}

Um **espelho** é uma cópia somente leitura de um repositório que uma segunda instalação mantém seguindo a primeira, a **origem**. Ele recusa alterações e serve downloads. Se a origem for perdida, um operador desanexa o espelho e ele se torna um repositório comum; a troca é manual e não é um failover automático. Consulte [Espelhos](../operate/mirrors).

Um **gateway de leitura** é um processo de API extra no mesmo armazenamento que responde apenas `GET` e `HEAD`. O escritor e os gateways compartilham um único orçamento de largura de banda de download. Consulte [Gateways de leitura](../operate/read-gateways).

## Para onde ir em seguida {#next}

1. [Início rápido](./quick-start): instale o Arkvory e envie um primeiro arquivo.
2. [Contas e acesso](../use/accounts): pessoas, grupos, tokens e chaves de serviço.
3. [Visão geral da API HTTP](../api/index): as regras de que toda integração precisa.
4. [Glossário](../reference/glossary): definições curtas de cada termo.
