---
title: Glossário
description: 'Definições curtas dos termos usados no Arkvory e em sua documentação, em ordem alfabética, cada um com um link para a página que o explica.'
---

# Glossário

Os termos estão em ordem alfabética. Para conhecer as ideias por trás deles, leia [Conceitos](../guide/concepts).

## A {#letter-a}

### Conta {#account}

O acesso de uma pessoa ao servidor: um nome de 3 a 64 caracteres e uma senha de 12 a 128 caracteres. As concessões de grupo dão a uma conta acesso aos repositórios. Consulte [Contas e acesso](../use/accounts).

### Ação {#action}

Um direito exato sobre um repositório, como `upload.create` ou `content.read`. As chaves de serviço carregam ações, e a referência da API nomeia as ações de que cada operação precisa. Consulte [Autenticação](../api/authentication#repository-actions).

### Administrador {#administrator}

Uma conta que gerencia contas, grupos, atualizações e backups. Um administrador não lê os arquivos de um repositório, a menos que um grupo também conceda esse acesso. Consulte [Contas e acesso](../use/accounts).

### Admissão {#admission}

O limite de quantas solicitações e transferências o servidor processa ao mesmo tempo. Acima dele, uma transferência espera brevemente e então o servidor responde `503` com o código `busy` e um cabeçalho `Retry-After`. Consulte [Limites de taxa e servidores ocupados](../api/index#rate-limits).

### Artefato {#artifact}

Um arquivo armazenado imutável, com seu SHA-256. Conteúdo novo cria um novo artefato. Consulte [Conceitos](../guide/concepts#artifacts).

### Anexo {#attachment}

Um vínculo de um build com outro artefato do mesmo repositório: um manifesto, um SBOM, uma assinatura, um relatório ou outro arquivo. Um build tem até 32 anexos. Consulte [Conceitos](../guide/concepts#annotations).

## B {#letter-b}

### Backup {#backup}

Uma cópia agendada do banco de dados e de todo o conteúdo publicado para o armazenamento de backups (vault). Consulte [Backups](../operate/backups).

### Agente de backup {#backup-agent}

O serviço que faz as cópias, verifica-as e aplica a retenção aos pontos de restauração. Consulte [Backups](../operate/backups).

### Token bearer {#bearer-token}

A forma como todo cliente envia uma credencial para `/api/v1`: o cabeçalho `Authorization: Bearer <credential>`. Consulte [Autenticação](../api/authentication#headers).

### Vínculo (binding) {#binding}

Uma entrada de uma política de serviço: um repositório e a lista de ações permitidas nele. Uma política tem até 64 vínculos. Consulte [Autenticação](../api/authentication#service-accounts).

### Build {#build}

A saída de uma execução de CI, armazenada como um artefato ou como uma versão de pacote. Consulte [Pacotes](../use/packages).

## C {#letter-c}

### Catálogo {#catalog}

A lista de artefatos de um repositório, com seus nomes, tamanhos, rótulos e estágios. Consulte [Referência de artefatos](../api/reference/artifacts).

### Teto (ceiling) {#ceiling}

O limite de uma delegação: as ações de repositório que um operador pode incluir nas políticas e chaves das contas que administra. O operador não pode ultrapassar seu teto. Consulte [Autenticação](../api/authentication#delegation).

### Soma de verificação (checksum) {#checksum}

O SHA-256 que comprova que os bytes são os esperados. Os uploads o declaram antes de os bytes chegarem, e o servidor e os clientes o verificam. Consulte [Transferências](../use/transfers).

### Limpeza física (cleanup) {#cleanup}

Também chamada de limpeza física. Ela libera o espaço em disco do conteúdo excluído em segundo plano, em pequenos lotes. Consulte [Armazenamento](../operate/storage).

### Coleção {#collection}

Um conjunto nomeado de artefatos. Uma coleção faz parte das anotações de um artefato. Consulte [Conceitos](../guide/concepts#annotations).

### Comparação e troca (compare-and-swap) {#compare-and-swap}

Uma alteração que nomeia a revisão que espera, como `expectedRevision`. Se outra alteração veio primeiro, o servidor responde `409` com o motivo `revision_mismatch` e não altera nada. Consulte [Visão geral da API HTTP](../api/index#revisions).

### Tarefa de conclusão {#completion-job}

Uma tarefa em segundo plano do worker que verifica e publica um upload grande. Você a acompanha com `GET /api/v1/jobs/{id}`. Seu estado é `queued`, `running`, `completed` ou `failed`. Consulte [Referência de uploads](../api/reference/uploads#getCompletionJob).

### Console {#console}

A interface web do Arkvory, servida em `/console/`. Consulte [O console web](../guide/console).

### CORS {#cors}

A regra do navegador para páginas que chamam uma API em outro endereço. Uma página de outra origem só funciona se o administrador listar essa origem em `ARKVORY_CORS_ORIGINS`. Consulte [Variáveis de ambiente](./environment).

### Cursor {#cursor}

O valor `next` em uma página de resultados. Envie-o de volta como `after` para ler a próxima página; quando `next` é `null`, a lista está completa. Consulte [Visão geral da API HTTP](../api/index#pagination).

## D {#letter-d}

### Delegação {#delegation}

Uma concessão da chave de recuperação a uma chave de operador: ela pode administrar contas de serviço nomeadas, com ações de administração nomeadas, dentro de um teto. Consulte [Autenticação](../api/authentication#delegation).

### Digest {#digest}

O endereço de conteúdo de uma imagem de contêiner, escrito `sha256:…`. Consulte [Imagens de contêiner](../protocols/containers).

### Link de download {#download-link}

Um link com prazo limitado que baixa um artefato sem chave. Ele dura de 60 segundos a 24 horas (1 hora por padrão), e ninguém pode revogá-lo antes de expirar. Consulte [Autenticação](../api/authentication#download-links).

## E {#letter-e}

### ETag {#etag}

O validador de um download: o valor forte `"sha256:<hex>"` do artefato. Use-o com `If-Range` para retomar com segurança e com `If-None-Match` para pular um download repetido. Consulte [Visão geral da API HTTP](../api/index#range-downloads).

## F {#letter-f}

### Failover {#failover}

Mover clientes para um espelho quando a origem é perdida. O operador desanexa o espelho, e ele se torna um repositório comum que aceita alterações. Nada muda por conta própria. Consulte [Espelhos](../operate/mirrors).

### Feedback {#feedback}

Um relatório com capturas de tela e logs que um usuário conectado envia à ProAnimaStudio pelo console. O console mostra o que está anexado antes de enviar qualquer coisa. Consulte [O console web](../guide/console#feedback).

### Arquivo por caminho {#file-by-path}

Um arquivo endereçado por um caminho no repositório, como `builds/game/Setup.exe`, que mantém suas revisões anteriores. Consulte [Arquivos e caminhos](../use/files).

### Chave de arquivo {#file-key}

Um segredo cujo SHA-256 está listado no arquivo de chaves do servidor (`ARKVORY_KEYS_FILE`). A chave de recuperação é uma chave de arquivo. Consulte [Autenticação](../api/authentication#recovery-key).

## G {#letter-g}

### Período de carência {#grace-period}

O tempo que o conteúdo excluído permanece no disco antes de a limpeza física removê-lo: 24 horas por padrão. Consulte [Armazenamento](../operate/storage).

### Grupo {#group}

Um conjunto de contas que compartilham acesso a repositórios. Um grupo recebe acesso `read` ou `write` ("Ler e escrever") por repositório. Consulte [Contas e acesso](../use/accounts).

## H {#letter-h}

### Histórico {#history}

As revisões anteriores de um arquivo por caminho, ou de um conjunto de anexos. Consulte [Arquivos e caminhos](../use/files).

### Hub {#hub}

O serviço da ProAnimaStudio em `https://hub.proanima.net` que anuncia versões estáveis e recebe feedback. Consulte [Atualizações](../install/updates).

## I {#letter-i}

### Chave de idempotência {#idempotency-key}

O cabeçalho `Idempotency-Key`: um valor de 1 a 128 caracteres que faz uma solicitação repetida ter efeito uma única vez. Consulte [Visão geral da API HTTP](../api/index#idempotency).

### Imagem {#image}

Uma imagem de contêiner armazenada no registro integrado. Consulte [Imagens de contêiner](../protocols/containers).

### Raiz da instalação {#installation-root}

A pasta com os dados, a configuração e os logs: `C:\ProgramData\ProAnima\Arkvory` no Windows e `/opt/proanima-arkvory` no Linux. Consulte [Escolher uma instalação](../install/index#installation-directory).

## L {#letter-l}

### Rótulo {#label}

Um rótulo curto em um artefato, como `nightly` ou `tested`. Um artefato tem até 32 rótulos. Consulte [Conceitos](../guide/concepts#annotations).

### Concessão (lease) {#lease}

Uma concessão que um processo mantém por um curto período e precisa renovar, para que apenas um processo execute uma tarefa. O agente de backup mantém uma concessão de 60 segundos por padrão, de modo que dois agentes nunca são executados ao mesmo tempo. Consulte [Variáveis de ambiente](./environment#backups).

### Vivacidade (liveness) {#liveness}

A resposta de `GET /health/live`: o processo está em execução. É público. Consulte [Referência do sistema](../api/reference/system).

### Bloqueio {#lock}

Um bloqueio de arquivo do Git LFS que impede duas pessoas de alterar o mesmo arquivo binário. Consulte [Git LFS](../protocols/git-lfs).

## M {#letter-m}

### Hora de manutenção {#maintenance-hour}

A hora do dia em UTC em que as atualizações automáticas podem ser instaladas. O padrão é 03:00. Consulte [Atualizações](../install/updates).

### Metadados {#metadata}

Campos de texto de chave/valor de um artefato: até 32 campos, com valores de até 1.024 caracteres. Consulte [Conceitos](../guide/concepts#annotations).

### Espelho {#mirror}

Uma cópia somente leitura de um repositório que uma segunda instalação mantém ao seguir a origem. Consulte [Espelhos](../operate/mirrors).

### Origem do espelho {#mirror-source}

A instalação de onde um espelho copia. O espelho se conecta a ela com uma chave somente leitura. Consulte [Espelhos](../operate/mirrors).

### Movimentação {#move}

Uma promoção que também remove o build do repositório de origem. Consulte [Promoção](../use/promotion).

## O {#letter-o}

### Primeiros passos {#onboarding}

Os primeiros passos após a instalação, mostrados no console na seção Primeiros passos. Consulte [Início rápido](../guide/quick-start).

### OpenAPI {#openapi}

A descrição legível por máquina da API HTTP, servida em `/api/v1/openapi.json`. Consulte [Visão geral da API HTTP](../api/index#discovery).

### Proprietário {#owner}

A primeira conta, criada durante a instalação. Ela é um administrador e membro do grupo `arkvory-owners`, que pode gravar em `releases`. Consulte [Conceitos](../guide/concepts#owner-and-recovery-key).

## P {#letter-p}

### Pacote {#package}

Um pacote UPack versionado com um grupo, um nome e uma versão SemVer. Consulte [Pacotes](../use/packages).

### Grupo do pacote {#package-group}

A primeira parte do nome de um pacote. Pacotes com o mesmo nome em grupos diferentes são pacotes diferentes. Consulte [Pacotes](../use/packages).

### Parte {#part}

Um pedaço de um arquivo grande enviado como uma solicitação própria. Uma parte tem pelo menos 8 MiB, exceto a última, e no máximo 1 GiB. Consulte [Transferências](../use/transfers).

### Permissão {#permission}

O direito de executar uma ação. Pessoas recebem `read` ou `write` por meio de grupos; chaves de serviço recebem ações exatas. Consulte [Autenticação](../api/authentication#access-rules).

### Token de acesso pessoal {#personal-access-token}

O segredo de uma pessoa para scripts e a linha de comando. Ele começa com `pat_`, expira após 90 dias por padrão (365 no máximo) e é somente leitura ou leitura e gravação. Consulte [Autenticação](../api/authentication#personal-tokens).

### Fixar {#pin}

Impedir que algo seja excluído automaticamente, como um ponto de restauração. Consulte [Backups](../operate/backups).

### Política {#policy}

As regras salvas de uma conta de serviço (seus vínculos), de um repositório (sua política de armazenamento) ou do plano de backup. Consulte [Autenticação](../api/authentication#service-accounts).

### Promover {#promote}

O verbo da promoção: publicar um build em outro repositório ou marcá-lo com um estágio. Consulte [Promoção](../use/promotion).

### Promoção {#promotion}

Publicar um build em outro repositório sem enviá-lo novamente. Consulte [Promoção](../use/promotion).

## Q {#letter-q}

### Cota {#quota}

O máximo de espaço que um repositório pode usar. Um novo upload que o ultrapassaria é recusado com `507` e o motivo `storage_quota`. Consulte [Armazenamento](../operate/storage).

## R {#letter-r}

### Range {#range}

O cabeçalho HTTP `Range: bytes=start-end` que pede parte de um arquivo. Os downloads aceitam um intervalo por solicitação, que é o que a retomada precisa. Consulte [Visão geral da API HTTP](../api/index#range-downloads).

### Limite de taxa {#rate-limit}

Um limite de quantas vezes algo pode ser tentado. O Arkvory limita tentativas de login, registro, senha e feedback, e responde `429` com `Retry-After`. Consulte [Autenticação](../api/authentication#sign-in-limits).

### Gateway de leitura {#read-gateway}

Um processo extra de API somente para download no mesmo armazenamento. Ele responde a `GET` e `HEAD` e recusa alterações com `405`. Consulte [Gateways de leitura](../operate/read-gateways).

### Prontidão (readiness) {#readiness}

Se o servidor pode fazer seu trabalho. `GET /health/status` é público e responde `{"status":"ready"}` ou `unavailable`; `GET /health/ready` exige uma credencial e fornece detalhes. Consulte [Referência do sistema](../api/reference/system).

### Chave de recuperação {#recovery-key}

Também chamada de chave de bootstrap. O segredo da instalação em `config/bootstrap-token.txt`: ela cria o proprietário, gerencia contas de serviço e recupera o acesso. Consulte [Autenticação](../api/authentication#recovery-key).

### Registro {#registry}

Um servidor para o qual clientes como Docker ou npm enviam e do qual baixam. O Arkvory tem um registro de contêineres (`/v2/`) e um registro npm (`/npm/`). Consulte [Clientes e protocolos](../protocols/index).

### Repositório {#repository}

Um espaço nomeado para conteúdo, com suas próprias regras de acesso e política de armazenamento. Consulte [Repositórios](../use/repositories).

### ID da solicitação {#request-id}

O identificador de uma solicitação, devolvido no cabeçalho `X-Request-Id` e em todo erro. Informe-o ao suporte. Consulte [Visão geral da API HTTP](../api/index#request-ids).

### Resolver {#resolve}

Encontrar o build para o qual um estágio e um intervalo de versões apontam. Consulte [Promoção](../use/promotion).

### Restaurar {#restore}

Tornar uma revisão anterior de um arquivo atual novamente, o que adiciona uma nova revisão. Também recuperar a instalação inteira a partir de um ponto de restauração. Consulte [Arquivos e caminhos](../use/files) e [Backups](../operate/backups).

### Ponto de restauração {#restore-point}

Um backup completo que pode ser restaurado. Consulte [Backups](../operate/backups).

### Retomar {#resume}

Continuar um upload ou download interrompido de onde parou. Consulte [Transferências](../use/transfers).

### Retenção {#retention}

As regras sobre por quanto tempo o conteúdo ou os backups são mantidos. Consulte [Armazenamento](../operate/storage).

### Política de retenção {#retention-policy}

As regras de retenção salvas de um repositório: quantos builds manter, quais rótulos proteger e com que idade um build deve estar antes da remoção. Ela fica desativada até que um administrador a ative. Consulte [Armazenamento](../operate/storage).

### Retry-After {#retry-after}

O cabeçalho, e o campo `retryAfterSeconds` de um erro, que informa quantos segundos esperar antes de tentar de novo após um `429` ou um `503`. Consulte [Visão geral da API HTTP](../api/index#rate-limits).

### Revisão {#revision}

Uma versão numerada de um arquivo por caminho, das anotações de um artefato ou de uma configuração. As revisões começam em 1. Consulte [Visão geral da API HTTP](../api/index#revisions).

### Revogar {#revoke}

Cancelar uma chave ou um token definitivamente. Consulte [Autenticação](../api/authentication#service-keys).

### Rollback {#rollback}

Voltar à versão anterior após uma atualização que não iniciou. Consulte [Atualizações](../install/updates).

### Rotacionar {#rotate}

Substituir uma chave por uma nova enquanto a antiga ainda funciona. Ativar a nova chave limita a antiga a 24 horas. Consulte [Autenticação](../api/authentication#service-keys).

## S {#letter-s}

### SBOM {#sbom}

Uma lista de materiais de software (software bill of materials): a lista de componentes de um build. Você pode anexá-la a um build. Consulte [Conceitos](../guide/concepts#annotations).

### Autorrecuperação {#self-healing}

Os serviços reiniciando sozinhos após uma falha ou um travamento. Consulte [Autorrecuperação](../operate/self-healing).

### SemVer {#semver}

Versionamento semântico (SemVer): `MAJOR.MINOR.PATCH`, com uma parte de pré-lançamento opcional, como `1.4.2` ou `2.0.0-rc.1`. Consulte [Pacotes](../use/packages).

### Conta de serviço {#service-account}

Uma conta para CI ou automação. Ela tem uma política e se conecta com chaves. Consulte [Autenticação](../api/authentication#service-accounts).

### Chave de serviço {#service-key}

O segredo com que uma conta de serviço se conecta. Ele começa com `arkvory_`, é mostrado uma única vez e precisa ser ativado. Consulte [Autenticação](../api/authentication#service-keys).

### Sessão {#session}

Uma sessão conectada do console. Ela começa com `dps_` e dura 12 horas. Consulte [Autenticação](../api/authentication#sessions).

### SHA-256 {#sha-256}

A função de hash que o Arkvory usa para artefatos, partes e releases. Ela é escrita como 64 dígitos hexadecimais minúsculos. Consulte [Transferências](../use/transfers).

### Versão estável {#stable-release}

Uma versão que a ProAnimaStudio aprovou para instalações no canal estável. Consulte [Atualizações](../install/updates).

### Estágio {#stage}

Uma marca em um build, como `qa`, `release` ou `prod`. Consulte [Promoção](../use/promotion).

### Superfície (surface) {#surface}

Um dos seis grupos de operações da API: `discovery`, `identity`, `catalog`, `transfers`, `administration` e `operations`. Consulte [Visão geral da API HTTP](../api/index#surfaces).

## T {#letter-t}

### Tag {#tag}

O nome de uma versão de uma imagem de contêiner, como `latest` ou `1.4`. Consulte [Imagens de contêiner](../protocols/containers).

## U {#letter-u}

### UPack {#upack}

O formato de pacote que o Arkvory registra: um arquivo com um manifesto chamado `upack.json` que informa o grupo, o nome e a versão. Consulte [Pacotes](../use/packages).

### Atualização {#update}

Uma versão estável mais recente do Arkvory e sua instalação. Consulte [Atualizações](../install/updates).

### Upload {#upload}

O ato de enviar um arquivo ao servidor. A palavra também nomeia a sessão de upload que reserva o arquivo. Consulte [Transferências](../use/transfers).

### Sessão de upload {#upload-session}

Uma reserva para um arquivo. Ela dura 7 dias e é concluída quando todos os bytes chegam. Consulte [Referência de uploads](../api/reference/uploads).

## V {#letter-v}

### Armazenamento de backups (vault) {#vault}

O armazenamento de backups: uma pasta em outro disco ou um compartilhamento de rede. Consulte [Backups](../operate/backups).

### Versão {#version}

Uma versão SemVer de um pacote, como `1.4.2`. Consulte [Pacotes](../use/packages).

### Intervalo de versões {#version-range}

Um conjunto de versões, como `^1.4`. Consulte [Pacotes](../use/packages).

## W {#letter-w}

### Worker {#worker}

O serviço que conclui uploads grandes e sincroniza espelhos. Consulte [Escolher uma instalação](../install/index).

### Escritor (writer) {#writer}

O processo de API que aceita alterações, em oposição a um gateway de leitura. Consulte [Gateways de leitura](../operate/read-gateways).
