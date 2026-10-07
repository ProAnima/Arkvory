---
title: FAQ
description: 'Respostas curtas e exatas para perguntas comuns sobre limites, disponibilidade, bancos de dados, atualizações, migração de servidores, acesso e a licença.'
---

# FAQ

## Tamanho e disponibilidade {#size-and-availability}

### Qual é o maior arquivo que posso armazenar? {#max-object-size}

10.000 GiB (10 737 418 240 000 bytes). Um upload tem no máximo 10.000 partes de no máximo 1 GiB cada. O administrador pode definir um limite menor com `ARKVORY_MAX_OBJECT_BYTES`. Um tamanho declarado maior é recusado com `400`. Na prática, o espaço livre em disco, a cota do repositório e a reserva de 1 GiB de espaço livre o impedem primeiro: eles respondem `507`. Consulte [Conceitos](../guide/concepts#uploads) e [Variáveis de ambiente](./environment).

### Quanto um servidor pode conter? {#capacity}

O Arkvory reserva até 10 TiB de conteúdo por padrão (`ARKVORY_CAPACITY_BYTES`), contando arquivos publicados, uploads não concluídos e conteúdo que aguarda limpeza. É um contador, não uma verificação de disco. O disco e a reserva são o limite real. Um repositório pode ter sua própria cota. Consulte [Armazenamento](../operate/storage).

### O Arkvory tem alta disponibilidade? {#high-availability}

Não. Uma instalação é um único servidor com um banco de dados PostgreSQL e um diretório local de conteúdo. Se o servidor parar, os clientes esperam e depois retomam suas transferências; os serviços reiniciam sozinhos após uma falha ou um travamento. Para proteção contra a perda do servidor, use [backups](../operate/backups). Para leitura a partir de um segundo site, use [espelhos](../operate/mirrors); a troca para um espelho é um passo manual, e as alterações que o espelho ainda não recebeu são perdidas.

### Ele funciona offline? {#offline}

O servidor funciona sem acesso à internet. O instalador do Windows inclui o Node.js e o PostgreSQL e instala offline. Os pacotes do Linux incluem o Node.js, e o gerenciador de pacotes instala o PostgreSQL. Os instaladores por script e o Docker baixam arquivos. As atualizações podem ser instaladas a partir de uma cópia local de uma versão. Se o hub de atualizações não puder ser alcançado, a verificação de atualização falha e é mostrada no console; nada mais é afetado. Consulte [Escolher uma instalação](../install/index) e [Atualizações](../install/updates).

## Armazenamento e banco de dados {#storage-and-database}

### Qual banco de dados ele usa? {#database}

PostgreSQL, um banco de dados para cada instalação. O instalador do Windows inclui o PostgreSQL 18.4. Os pacotes do Linux usam um cluster dedicado de um servidor PostgreSQL 16 a 19 da sua distribuição. A pilha do Docker Compose executa o PostgreSQL 18.4 em um contêiner. Os instaladores por script usam o seu próprio servidor. Nunca conecte duas instalações ao mesmo banco de dados. O conteúdo dos arquivos não está no banco de dados: está no diretório de dados.

### Posso usar S3 ou outro armazenamento de objetos? {#s3}

Não. O conteúdo dos arquivos é armazenado em um diretório local, que deve estar em um sistema de arquivos local com suporte a hard links, não em um compartilhamento de rede. O Arkvory não armazena conteúdo no S3 nem oferece uma interface S3. O armazenamento de backups (vault) é uma pasta em outro disco ou em um compartilhamento de rede montado (no Windows, um volume local ou iSCSI).

### Posso usar o login único (SSO) da minha empresa? {#sso}

Não. Contas, grupos e senhas pertencem ao Arkvory. A automação faz login com chaves de serviço. Consulte [Autenticação](../api/authentication).

## Executando o servidor {#running}

### Como vejo qual versão está instalada? {#version}

No console, abra [[ui:updates]]: [[ui:updateCurrent]] a mostra. No servidor, execute `arkvory status --root <installation root>` e leia `current`; no Windows com o instalador gráfico, execute `& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' status --root 'C:\ProgramData\ProAnima\Arkvory'` em um PowerShell elevado. Um administrador também pode chamar `GET /api/v1/system/updates`, que retorna `currentVersion`. O comando `arkvoryctl --version` mostra a versão do cliente, não a do servidor.

### Como ativo as atualizações automáticas? {#automatic-updates}

No console, abra [[ui:updates]], selecione [[ui:updateAutomatic]], escolha a [[ui:updateHour]] e selecione [[ui:updateSave]]. No servidor, execute `arkvory configure --root <installation root> --enable-updates`; `--disable-updates` as desativa. Os instaladores as deixam desativadas a menos que você passe `--automatic`.

O servidor procura uma versão a cada 6 horas mesmo quando a instalação automática está desativada. Com ela ativada, uma versão estável é instalada uma vez por dia durante a hora de manutenção (03:00 UTC por padrão), a menos que a versão esteja fixada. Uma versão que altera o esquema do banco de dados só é instalada depois que o servidor faz e verifica um backup novo. Consulte [Atualizações](../install/updates).

### O que o Arkvory envia para a ProAnimaStudio? {#hub-traffic}

Seus arquivos e dados permanecem no seu servidor. O servidor contata o hub da ProAnimaStudio (`hub.proanima.net`), e o GitHub quando o hub não pode ser alcançado, para três coisas:

- **Verificações de atualização.** A solicitação carrega o nome do projeto, o sistema operacional, a arquitetura do processador, a versão instalada e o canal de atualização. Com as estatísticas ativadas, ela também carrega um ID de instalação aleatório.
- **Estatísticas anônimas.** Um evento após cada atualização instalada, com o ID de instalação, a versão, o sistema, a arquitetura e o canal. Nenhum nome, endereço, conteúdo ou endereço IP é armazenado. As estatísticas ficam ativadas por padrão; desative-as com [[ui:updateStatistics]] em [[ui:updates]] ou com `arkvory configure --statistics off`. Sem estatísticas, uma nova versão chega até você somente quando é distribuída para todos.
- **Feedback.** Somente quando uma pessoa autenticada o envia em [[ui:reportOpen]]. Ele contém a mensagem, um endereço de e-mail opcional, até 6 capturas de tela e o log do console. Um administrador pode adicionar o log do servidor e um resumo de versões e estados sem segredos. [[ui:reportShow]] mostra exatamente o que será enviado.

`arkvory configure --hub-off` impede o contato com o hub: as versões então vêm somente do GitHub, e o feedback é desativado após a reinicialização dos serviços. Um `ARKVORY_HUB_URL` vazio desativa somente o feedback. Consulte a [Licença](https://github.com/ProAnima/Arkvory/blob/main/LICENSE.md), seção 7.

### Os backups são executados sozinhos? {#automatic-backups}

Não, até você configurá-los. Conecte um armazenamento de backups (vault) com `arkvory configure --backup-vault <folder> --vault-key-file <file>` e depois ative o agendamento diário em [[ui:backupPlan]] em [[ui:backups]]. O plano começa às 02:00 UTC e mantém 7 pontos de restauração diários, 4 semanais e 6 mensais. Enquanto o agendamento estiver desativado, o console mostra o aviso de que o agendamento diário está desligado. Consulte [Backups](../operate/backups).

### Como mudo para outro servidor? {#move-server}

1. Instale uma versão do Arkvory igual ou mais recente no novo servidor.
2. Restaure o ponto de restauração mais recente do armazenamento de backups (vault) em um banco de dados vazio e um diretório de armazenamento vazio com o comando `arkvory-backup restore`. Ele verifica cada arquivo por SHA-256. Consulte [Backups](../operate/backups).
3. Aponte `ARKVORY_DATABASE_URL` e `ARKVORY_DATA_DIR` em `config/runtime.json` para o banco de dados e o diretório restaurados, reinicie os serviços e verifique o console, um download e um upload.
4. Mova o endereço (DNS ou as configurações de CI) para o novo servidor.

Os usuários, grupos e senhas voltam. As sessões não são transferidas, tokens pessoais e chaves de serviço são revogados, então faça login novamente e emita novas chaves. As políticas de retenção e limpeza voltam desativadas; ative-as de propósito. Os uploads que não foram concluídos são cancelados. Para um repositório que você deseja mover enquanto o servidor antigo continua em execução, você também pode deixar o novo servidor segui-lo como um [espelho](../operate/mirrors) e desanexá-lo quando fizer a troca; um espelho carrega os arquivos, pacotes e imagens, mas não contas, chaves, anexos ou políticas.

### O que acontece com uma transferência quando o servidor reinicia? {#interrupted-transfers}

O cliente continua. Uma sessão de upload dura 7 dias e mantém as partes que chegaram; o cliente de linha de comando e o SDK perguntam ao servidor o que ele tem e enviam o restante. Um download continua com uma solicitação `Range`. Uma única solicitação `PUT`, como um arquivo bruto ou uma camada do Docker, recomeça do primeiro byte. Consulte [Retomar transferências interrompidas](../protocols/cli#resume-interrupted-transfers).

### Onde devo procurar quando algo falha? {#logs}

Cada erro tem um ID de solicitação, no campo `requestId` e no cabeçalho `X-Request-Id`. Encontre-o no log de acesso do servidor. Os serviços gravam seus logs na pasta `logs` no Windows e no journal (`journalctl -u arkvory-api`) no Linux. Envie um relatório com [[ui:reportOpen]] para incluir os logs. Consulte [Solução de problemas](../operate/troubleshooting) e [Monitoramento](../operate/monitoring).

## Acesso {#access}

### Como redefino a senha do proprietário? {#reset-owner-password}

Outro administrador pode usar [[ui:resetPassword]] em [[ui:administration]]. Se ninguém conseguir fazer login, use a chave de recuperação de `config/bootstrap-token.txt`: encontre o ID da conta com `GET /api/v1/users` e envie `PATCH /api/v1/users/<id>` com `{"password": "…"}`. A nova senha tem 12 a 128 caracteres. A redefinição encerra todas as sessões e tokens pessoais da conta. Consulte [Autenticação](../api/authentication#recovery-key).

### O que é a chave de recuperação e o que acontece se eu a perder? {#lost-recovery-key}

É um segredo em `config/bootstrap-token.txt` na raiz da instalação, legível somente pelo administrador do sistema. Ela cria o primeiro proprietário e administra contas de serviço. As ferramentas de instalação leem o arquivo, então não o exclua. Se o arquivo for perdido, mas você ainda tiver uma conta de administrador, pode continuar trabalhando com a conta; para criar uma nova chave de recuperação, siga a [Configuração](../install/configuration). Consulte [Conceitos](../guide/concepts#owner-and-recovery-key).

### Qual chave meu CI deve usar? {#ci-key}

Uma chave de serviço de uma conta de serviço cuja política tenha somente as ações de que o job precisa, por exemplo `upload.create`, `upload.write`, `upload.complete`, `upload.read` e `job.read` para publicar. As predefinições do console [[ui:bindingRead]] e [[ui:bindingPublish]] preenchem conjuntos típicos. Não use a chave de recuperação nem o token de uma pessoa no CI. As chaves duram 90 dias por padrão e são limitadas a 365, então planeje uma rotação. Consulte [Autenticação](../api/authentication#service-accounts).

### Por que um administrador não pode excluir um artefato ou alterar uma política de armazenamento? {#delete-forbidden}

As ações `artifact.delete`, `storage.read`, `storage.manage` e `diagnostics.read` existem somente para chaves de serviço. Uma concessão de grupo, um token pessoal, uma sessão e a chave de recuperação nunca as carregam. Crie uma conta de serviço que tenha essas ações no repositório, emita uma chave e use essa chave para a chamada (a API, o `arkvoryctl` ou [[ui:keySignIn]] no console). O erro é `403` com o motivo `permission_missing`. Consulte [Autenticação](../api/authentication#repository-actions).

### O Docker, o Git LFS e o Unity funcionam com ele? {#protocols}

Sim. O Arkvory serve um registro de contêineres em `/v2/`, um servidor Git LFS em `/lfs/<repository>` e um registro npm em `/npm/<repository>/` que o Unity Package Manager pode usar. Eles aceitam a chave do Arkvory como senha. Consulte [Clientes e protocolos](../protocols/index).

## Licença {#license}

### O Arkvory é open source? {#open-source}

Não. O Arkvory é gratuito, e seu código-fonte está aberto para leitura, mas não é open source. Ele está sob a Licença ProAnima Arkvory 1.0 de Ian Panaev, que não permite a distribuição de forks ou cópias. Por favor, não o chame de "open source". O texto completo está em [LICENSE.md](https://github.com/ProAnima/Arkvory/blob/main/LICENSE.md); o texto em russo prevalece se os dois forem diferentes.

### O que posso fazer com ele? {#license-allowed}

Você pode instalar e usar qualquer número de cópias para qualquer finalidade, inclusive em uma empresa; ler e estudar o código-fonte; alterá-lo; e usar sua versão alterada dentro da sua organização. Você pode armazenar e entregar seus próprios artefatos por meio dele, também para seus próprios clientes.

### O que não é permitido? {#license-forbidden}

Você não pode distribuir o software ou versões alteradas a ninguém fora da sua organização, publicar forks, builds, imagens de contêiner ou patches que contenham seu código, vender, alugar ou emprestar o software ou o acesso a ele, cobrar por ele, nem oferecê-lo a terceiros como serviço hospedado ou gerenciado. Você não pode remover os avisos de direitos autorais, a licença ou os nomes ProAnima Arkvory e ProAnimaStudio, nem apresentar uma versão alterada como o original. Ao descrever publicamente um sistema construído sobre o Arkvory, cite a fonte: "ProAnima Arkvory by ProAnimaStudio (Ian Panaev), https://github.com/ProAnima/Arkvory". Obtenha cópias somente das fontes oficiais. Para outras permissões, escreva para info@proanima.net.

### Onde relato um problema ou uma vulnerabilidade? {#report}

Para um problema com sua instalação, use [[ui:reportOpen]] no console. Para um problema de segurança, siga o [SECURITY.md](https://github.com/ProAnima/Arkvory/blob/main/SECURITY.md) no repositório e não o publique publicamente.
