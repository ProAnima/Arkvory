---
title: O console web
---

# O console web

O console web é a interface do Arkvory no navegador. Ele faz parte do servidor, então você não o instala separadamente. Abra `/console/` no endereço do seu servidor, por exemplo `http://127.0.0.1:8080/console/` no próprio servidor ou `https://arkvory.example/console/` depois de configurar o [HTTPS](../install/https).

O console usa a mesma API HTTP que o [cliente de linha de comando](../protocols/cli) e o [SDK](../protocols/sdk). O servidor verifica cada solicitação. Quando um botão está oculto, isso significa apenas que sua conta ou sua chave não pode usar aquela operação.

## Layout {#layout}

A barra lateral agrupa as seções. Em uma tela estreita, a barra lateral vira o botão [[ui:navigationMenu]].

| Grupo               | Seções                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [[ui:navLibrary]]   | [[ui:catalog]], [[ui:packages]], [[ui:history]], [[ui:metadata]]                                                          |
| [[ui:navTransfers]] | [[ui:upload]], [[ui:downloads]]                                                                                           |
| [[ui:navResources]] | [[ui:administration]], [[ui:repositories]], [[ui:services]], [[ui:updates]], [[ui:backups]], [[ui:navStart]], [[ui:help]] |

A barra superior mostra o título da seção, o botão [[ui:uploadFile]], o botão [[ui:reportOpen]] e os controles de aparência e de idioma.

Cada seção tem o próprio endereço, como `#/catalog`, `#/packages` ou `#/backups`. Um artefato aberto tem o endereço `#/artifact/<repository>/<id>`. Você pode salvar esses endereços nos favoritos e enviá-los a outras pessoas. O endereço nunca contém uma senha, uma chave nem um texto de busca. Se você abrir um link antes de entrar, o console o abre depois que você entrar.

Algumas seções aparecem somente para alguns usuários:

| Seção                 | Quem vê                                                               |
| --------------------- | --------------------------------------------------------------------- |
| [[ui:administration]] | Administradores                                                       |
| [[ui:repositories]]   | Todos que estão conectados                                            |
| [[ui:services]]       | A chave de recuperação e as chaves de operador com direitos delegados |
| [[ui:updates]]        | Administradores                                                       |
| [[ui:backups]]        | Administradores e a chave de recuperação                              |

## Entrar {#signing-in}

O cartão [[ui:connection]] fica no topo da página.

1. Preencha os campos [[ui:accountName]] e [[ui:password]].
2. Selecione [[ui:signIn]]. Uma sessão dura 12 horas.
3. O console preenche o campo [[ui:repository]] com o primeiro repositório que você pode ler. Para trabalhar em outro repositório, digite o nome dele ou escolha-o na lista.

Para se conectar com uma chave em vez de uma senha, abra [[ui:keySignIn]], cole a chave e selecione [[ui:connect]]. A chave fica na memória desta aba do navegador. O console nunca a salva.

O botão [[ui:signUp]] aparece somente quando o administrador permite o autocadastro. O botão [[ui:disconnect]] encerra a conexão.

Depois de entrar com uma senha, você pode usar [[ui:changeOwnPassword]] e [[ui:personalAccessTokens]]. Um token de acesso pessoal é uma chave para as suas próprias ferramentas. Consulte [Contas e acesso](../use/accounts).

### O primeiro proprietário {#the-first-owner}

Uma instalação nova não tem contas. No Windows, o instalador cria o proprietário. Nas outras instalações, crie o proprietário no console:

1. Abra [[ui:navStart]] e expanda [[ui:welcomeOwner]].
2. Cole a chave de recuperação de `config/bootstrap-token.txt`, no diretório da instalação.
3. Informe um nome e uma senha de pelo menos 12 caracteres e selecione [[ui:welcomeCreate]].
4. Entre com o novo nome e a nova senha.

O formulário só funciona enquanto não há contas. O proprietário é um administrador. Ele também recebe acesso de gravação ao repositório `releases` por meio do grupo `arkvory-owners`.

## Biblioteca {#library}

### Artefatos {#artifacts}

A seção [[ui:catalog]] lista os arquivos publicados do repositório. Pesquise por nome ou por um valor de metadados. Use [[ui:labelFilter]] para mostrar um único rótulo e [[ui:metadataFilter]] para uma chave e um valor exatos. Cada linha mostra o nome, o tamanho, o horário de publicação, os estágios e os rótulos. Selecione [[ui:download]] para baixar um arquivo ou [[ui:open]] para ver os detalhes dele. O botão [[ui:more]] mostra a próxima página.

### Pacotes {#packages}

A seção [[ui:packages]] lista as versões UPack registradas. Filtre por [[ui:packageGroup]] e [[ui:packageName]], escolha [[ui:sortBy]] e [[ui:groupBy]] e selecione [[ui:apply]]. A coluna de estágios mostra onde cada versão foi promovida. Consulte [Pacotes](../use/packages).

### Histórico de arquivos {#file-history}

Um caminho de arquivo, como `builds/game/1.4/GameSetup.exe`, pode apontar para conteúdo novo muitas vezes. Cada alteração é uma nova versão. Em [[ui:history]], informe um caminho e selecione [[ui:historyLoad]]. Você vê cada versão com o autor e o horário. Você pode abrir qualquer versão para baixar o conteúdo original dela. Restaurar uma versão antiga cria uma nova versão; nada é excluído. Consulte [Arquivos e caminhos](../use/files).

### Detalhes do artefato {#artifact-details}

A seção [[ui:metadata]] mostra um artefato:

- **Resumo**: [[ui:summarySize]], [[ui:summaryCreated]] e [[ui:summaryHash]] com um botão [[ui:copyHash]].
- **Propriedades**: [[ui:labels]], [[ui:collections]] e [[ui:metadataFields]]. Selecione [[ui:save]] para armazená-los. O arquivo em si não muda.
- **Ações**: [[ui:download]]; [[ui:downloadLink]] cria um link que funciona por uma hora sem uma chave; [[ui:register]] indexa um arquivo UPack.
- [[ui:assetTitle]]: [[ui:assign]] torna este artefato o conteúdo atual de um caminho de arquivo.
- [[ui:promotionTitle]]: [[ui:stageAdd]] marca o artefato com um estágio, como `qa` ou `release`. [[ui:promoteSubmit]] o publica em outro repositório. Consulte [Promoção](../use/promotion).
- [[ui:attachmentsTitle]]: [[ui:attachmentAdd]] vincula um manifesto, um SBOM, uma assinatura, um relatório ou outro arquivo a este build. [[ui:attachmentHistory]] mostra os conjuntos anteriores.
- [[ui:deletionTitle]]: [[ui:deletionInspect]] mostra o que ainda usa o artefato. Para excluir, cole o ID do artefato e selecione [[ui:deletionSubmit]].

## Transferências {#transfers}

### Upload {#upload}

Em [[ui:upload]], escolha um arquivo e selecione [[ui:startUpload]]. O console primeiro calcula o SHA-256 do arquivo e depois o envia em partes. O botão [[ui:pause]] interrompe a transferência e mantém as partes já enviadas.

Para continuar depois, guarde o ID do upload. Abra [[ui:resumeTitle]], selecione o mesmo arquivo e preencha o campo [[ui:uploadId]]. O navegador avisa antes de você sair da página durante um upload. Consulte [Transferências](../use/transfers).

### Downloads {#downloads}

A seção [[ui:downloads]] é uma fila dos arquivos que você baixa pelo console. O console verifica o SHA-256 de cada arquivo antes de salvar o arquivo final.

- Em [[ui:downloadSettings]], você define [[ui:downloadConcurrency]] (de 1 a 8), [[ui:downloadInterval]] e [[ui:downloadWait]].
- Os botões [[ui:downloadsPause]], [[ui:downloadsResume]], [[ui:downloadsClearWaiting]], [[ui:downloadsCancel]] e [[ui:downloadsClearFinished]] controlam a fila inteira.
- Depois de recarregar a página, entre novamente e selecione [[ui:downloadRestore]]. Em seguida, retome cada arquivo e escolha onde salvá-lo.

Downloads grandes exigem o Chrome ou o Edge em um endereço seguro (HTTPS ou o computador local). Os dados temporários ficam no armazenamento privado do navegador.

## Recursos {#resources}

### Usuários e acesso {#users-and-access}

Os administradores gerenciam as pessoas aqui. O bloco [[ui:accountsHeading]] lista as contas; o bloco [[ui:groupsHeading]] lista os grupos. Use [[ui:createUser]], [[ui:resetPassword]], [[ui:createGroup]] e [[ui:manageMembers]]. Em [[ui:manageGrants]], dê a um grupo o acesso [[ui:read]] ou [[ui:write]] a um repositório pelo nome. Um repositório não tem uma etapa de criação separada: ele passa a existir assim que uma regra de acesso ou uma política de serviço o menciona.

### Repositórios {#repositories}

A seção [[ui:repositories]] mostra os repositórios que você pode ver, com [[ui:repositoryRights]]. Cada cartão tem [[ui:repositoryOpen]], [[ui:repositoryStorage]] (cota, limpeza automática e limpeza física) e, para os administradores, [[ui:repositoryAccess]]. Um repositório espelhado mostra o selo [[ui:mirrorBadge]]. Consulte [Repositórios](../use/repositories) e [Armazenamento](../operate/storage).

### Acesso de serviços {#service-access}

Aqui você cria contas para ferramentas e sistemas de CI. Para ver esta seção, conecte-se com a chave de recuperação ou com uma chave de operador. Selecione [[ui:serviceCreate]] e depois defina [[ui:servicePolicy]]. Os botões [[ui:bindingRead]] e [[ui:bindingPublish]] preenchem conjuntos de permissões típicos.

Para emitir uma chave, abra [[ui:serviceKeys]] e selecione [[ui:keyIssue]]. O segredo é exibido uma única vez. Copie-o, confirme [[ui:keySaved]] e selecione [[ui:keyActivate]]. Uma chave que não é ativada expira após 15 minutos. Use [[ui:keyRotate]] para substituir uma chave e [[ui:keyRevoke]] para cancelá-la. A seção [[ui:delegations]] permite que o proprietário dê a um operador direitos administrativos limitados.

### Atualizações {#updates}

A seção [[ui:updates]] mostra a [[ui:updateCurrent]] e a [[ui:updateLatest]]. Selecione [[ui:updateCheck]] ou [[ui:updateInstall]]. Em [[ui:updateSettings]], ative [[ui:updateAutomatic]] e escolha a [[ui:updateHour]]. Consulte [Atualizações](../install/updates).

### Backups {#backups}

A seção [[ui:backups]] mostra se os backups estão em ordem, o último backup, a próxima execução, o agente de backup e o armazenamento de backups. Selecione [[ui:backupRun]] para iniciar um backup. A lista [[ui:backupPoints]] mostra os pontos de restauração; você pode verificar cada byte de um ponto ou fixá-lo. Em [[ui:backupPlan]], você define o horário diário, o fuso horário e quantos pontos manter. A restauração é um comando no servidor. Consulte [Backups](../operate/backups).

### Primeiros passos e referência da API {#getting-started-and-api-reference}

A seção [[ui:navStart]] mostra os primeiros passos para um servidor novo. A seção [[ui:help]] lista comandos de exemplo. O botão [[ui:helpLoad]] mostra as operações da API que sua conta ou chave atual pode chamar.

## Feedback {#feedback}

Depois de entrar, o botão [[ui:reportOpen]] envia uma mensagem para a ProAnimaStudio por meio do hub. Você pode adicionar até 6 imagens e um endereço de e-mail para receber a resposta. Os administradores podem anexar o log do servidor. Selecione [[ui:reportShow]] para ver exatamente o que será enviado.

## Aparência e idioma {#appearance-and-language}

A opção [[ui:theme]] tem três valores: [[ui:system]], [[ui:light]] e [[ui:dark]]. A lista [[ui:language]] mostra todos os idiomas do console pelo nome próprio de cada um: English, Русский, Español, Français, Deutsch, Português, 中文, 日本語, 한국어, हिन्दी e العربية. A página muda na hora, sem recarregar e sem perder o que você digitou; em árabe, ela é lida da direita para a esquerda. Na primeira visita, o console segue os idiomas do navegador e, se nenhum estiver disponível, usa o inglês. O link [[ui:helpDocs]] em [[ui:help]] abre esta documentação no idioma do console. O navegador salva apenas o tema e o idioma, nada sobre sua conta ou seus repositórios.

## Páginas relacionadas {#related-pages}

- [Início rápido](./quick-start)
- [Conceitos](./concepts)
- [Contas e acesso](../use/accounts)
- [Solução de problemas](../operate/troubleshooting)
