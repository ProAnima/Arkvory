---
title: Atualizações
description: 'Como o Arkvory encontra, verifica e instala novos releases, com atualizações manuais e automáticas, o backup antes de uma alteração de esquema, rollback, fixação de versão e atualizações offline.'
---

# Atualizações

A ProAnimaStudio anuncia cada release estável do Arkvory por meio de um hub. Seu servidor pergunta ao hub qual versão ele pode instalar, baixa o release, verifica sua assinatura e o instala. Nada é instalado a menos que você o inicie, ou a menos que você ative as atualizações automáticas. As atualizações automáticas ficam desativadas por padrão.

Uma atualização não é uma atualização contínua (rolling update). Os serviços param por um curto período, e as transferências em andamento são interrompidas. Os clientes que conseguem retomar continuam suas transferências. Atualize em uma janela de manutenção.

## Como as atualizações funcionam {#how-it-works}

- **Releases.** Somente releases publicados e estáveis com uma versão `x.y.z` são instalados. Prereleases, branches, endereços arbitrários e versões mais antigas são recusados.
- **O hub decide.** A cada 6 horas o servidor pergunta ao hub qual versão está aprovada para ele. O hub retém uma nova versão ou a libera passo a passo. Os próprios arquivos vêm do GitHub por meio de links de curta duração que o hub emite. O servidor não precisa de um token do GitHub para isso.
- **Assinatura.** Cada manifesto de release é assinado pela ProAnimaStudio. O servidor verifica a assinatura com uma chave pública embutida no programa instalado, e depois o SHA-256 do arquivo. Um release sem assinatura ou alterado não é instalado, venha ele do hub ou do GitHub. O hub não é confiável para integridade.
- **O atualizador do host.** Um timer no servidor (`arkvory-update.timer` no Linux, a tarefa `ProAnimaArkvoryUpdate` no Windows) executa o atualizador a cada minuto. Ele recolhe solicitações do console, verifica releases quando 6 horas se passaram desde a última verificação e inicia a atualização automática em sua hora. As verificações são executadas mesmo quando a instalação automática está desativada.

### O que uma atualização faz {#what-an-update-does}

1. Enquanto os serviços continuam em execução, ela baixa o release, verifica a assinatura e o SHA-256, e descompacta os arquivos em `releases/<version>/` na raiz da instalação. Para o Compose, ela compila a nova imagem.
2. Se o release alterar o esquema do banco de dados, ela faz e verifica um backup novo primeiro. Consulte [O backup antes de uma atualização](#backup).
3. Ela para o agente de backup, o worker e a API. Cada um recebe até 120 segundos para terminar.
4. Ela muda a instalação para a nova versão. Uma alteração de esquema executa sua migração agora.
5. Ela inicia a API e o worker e espera até que a API informe prontidão três vezes seguidas. Em seguida, inicia o agente de backup. O agente não faz parte da verificação: se ele não informar em cerca de 90 segundos, a atualização imprime um aviso e permanece.
6. Ela envia o evento anônimo `updated` ao hub, se as estatísticas estiverem ativadas. Uma falha aqui nunca desfaz a atualização.

A versão antiga permanece em `releases/`. Todos os dados, chaves e configuração permanecem como estavam.

## Verificar atualizações {#check}

Entre no console como administrador e abra [[ui:updates]]. A página mostra [[ui:updateCurrent]], [[ui:updateLatest]] e [[ui:updateChecked]]. Selecione [[ui:updateCheck]] para perguntar ao hub agora. Depois que você entrar, um banner com [[ui:updateOpen]] informa quando existe um release mais recente.

Se uma verificação falhar, por exemplo sem acesso à rede, a página mantém o último release que encontrou e o marca como possivelmente desatualizado. A verificação é tentada novamente após 6 horas, ou quando você seleciona [[ui:updateCheck]].

No servidor, `arkvory status --root <root>` mostra a versão instalada, a configuração de atualização automática e a fixação de versão.

Se a página disser que o atualizador do host não está conectado, execute `arkvory updates-connect --root <root>`. Ele conecta o console e o timer de atualização de uma instalação que foi atualizada a partir de um release antigo. Se a página disser que o atualizador parou de informar, o timer ou a tarefa não é executado há 5 minutos. Consulte [Solução de problemas](#troubleshooting).

## Instalar manualmente {#manual}

### No console {#manual-console}

1. Abra [[ui:updates]] e verifique se [[ui:updateLatest]] mostra a versão que você deseja.
2. Selecione [[ui:updateInstall]]. A caixa de diálogo nomeia a versão e avisa que as transferências podem ser interrompidas.
3. Selecione [[ui:updateConfirmButton]]. O console envia a versão e o SHA-256 que você viu. Se os bytes publicados mudaram desde então, a solicitação é recusada.
4. Aguarde. A solicitação é aceita de imediato; o atualizador do host a recolhe em até um minuto. A página pode perder a conexão enquanto os serviços reiniciam e se reconecta sozinha. Não envie uma segunda solicitação.

O console recusa uma instalação quando a versão está fixada. Consulte [Fixar uma versão](#pin).

### Com um comando {#manual-command}

```bash
sudo arkvory update --root /opt/proanima-arkvory
sudo arkvory update --root /opt/proanima-arkvory --version 1.2.3
```

Sem `--version`, o comando instala a versão que o hub aprova para este servidor. Com `--version`, ele instala exatamente essa versão estável, que deve ser mais nova que a instalada. O comando termina com um código de erro quando a atualização falha. Como executar o comando em cada plataforma está em [Configuração](./configuration#lifecycle-commands).

## Atualizações automáticas {#automatic}

Ative as atualizações automáticas de uma de três maneiras:

- No console, abra [[ui:updates]], selecione [[ui:updateAutomatic]] em [[ui:updateSettings]], escolha [[ui:updateHour]] e selecione [[ui:updateSave]].
- No servidor: `arkvory configure --root <root> --enable-updates`.
- Ao instalar com um script: `--automatic` para `install.sh`, `-AutomaticUpdates` para `install.ps1`.

Desative-as com o console ou `arkvory configure --root <root> --disable-updates`.

| Regra           | Valor                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Janela          | A hora UTC escolhida. O padrão é 03:00 a 03:59 UTC. Somente o console define a hora                                  |
| Tentativas      | No máximo uma por dia UTC, seja ela bem-sucedida ou não. Uma janela perdida não é recuperada mais tarde no mesmo dia |
| Ignorada quando | A versão está fixada, a última verificação falhou, ou nenhum release mais recente é conhecido                        |
| Release         | O release mais recente que o hub aprovou na última verificação                                                       |

Agende seus backups fora da janela de atualização. Uma atualização para o agente de backup, e um backup em execução é interrompido e enfileirado novamente.

## O backup antes de uma atualização {#backup}

Uma atualização que não altera o esquema do banco de dados não faz backup. Conte com seus backups agendados.

Um release que altera o esquema do banco de dados só é instalado atrás de um backup novo e verificado. O atualizador faz isso enquanto os serviços ainda estão em execução:

1. Ele pede ao agente de backup um novo backup e espera até que o backup seja feito e verificado. Ele espera até 6 horas. O console mostra que o release está sendo instalado durante esse período.
2. Só então ele para os serviços, migra o banco de dados e inicia a nova versão.

O backup precisa de três coisas: um armazenamento de backups conectado que esteja disponível, um agente de backup que esteja online e pelo menos um backup que tenha sido concluído anteriormente. O primeiro backup completo de terabytes é trabalho planejado, nunca um efeito colateral de uma atualização. Se uma das três estiver faltando, a atualização é **recusada antes que qualquer coisa mude**. Os serviços continuam em execução, o console mostra que a instalação foi recusada, e uma atualização automática tenta novamente no dia seguinte. Conecte o armazenamento de backups e execute o primeiro backup: consulte [Backups](../operate/backups).

Alterações que chegam após o snapshot e antes de os serviços pararem não estão nesse backup. O backup importa somente se a nova versão falhar após sua migração: consulte [Reverter e recuperar](#rollback).

### Atualizar com um backup próprio {#manual-upgrade}

Sem um armazenamento de backups integrado, faça e verifique seu próprio backup do banco de dados e de todo o armazenamento, e então forneça ao atualizador um arquivo que o registre:

```bash
sudo arkvory upgrade --root /opt/proanima-arkvory --version 1.2.3 --backup-record /secure/backup-record.txt
```

O arquivo é sua própria anotação. O atualizador apenas verifica que ele existe; ele não prova que o backup está completo. O journal e a reversão são iguais aos de `update`. Este comando funciona somente para frente e é recusado quando a versão está fixada em outra versão.

## Reverter e recuperar {#rollback}

### Reversão automática {#automatic-rollback}

- **Sem alteração de esquema.** Se a nova versão não ficar pronta, o atualizador a para, restaura o release anterior, espera a prontidão e informa `Update failed; previous release restored`.
- **Alteração de esquema, migração com falha.** A migração é executada em uma transação. Uma migração com falha é revertida, e o release anterior inicia novamente sobre o esquema inalterado.
- **Alteração de esquema, a nova versão não inicia após a migração.** O release anterior não pode ler o novo esquema, então não há caminho automático de volta. O atualizador marca o journal como `maintenance-required` e nomeia o ponto de backup. Corrija a causa e execute `recover`, que conclui a atualização. Ou restaure o ponto de backup nomeado em `journal.json` e execute a versão anterior.

O Arkvory não tem comando de downgrade. O comando recusa uma versão mais antiga. A versão anterior permanece em `releases/` apenas para a reversão automática.

### Recuperar uma atualização interrompida {#recover-update}

Uma falha ou uma perda de energia durante uma atualização deixa duas coisas: o bloqueio `operation.lock` e o registro `journal.json` na raiz da instalação. Novas atualizações e a maioria dos comandos se recusam a executar até que você recupere. Nunca exclua o bloqueio antes de saber o estado.

1. Pare o timer de atualização, para que nenhuma nova execução comece. No Linux: `sudo systemctl stop arkvory-update.timer`. No Windows: `Disable-ScheduledTask -TaskName ProAnimaArkvoryUpdate`. Em uma instalação Compose sem o timer, pare sua tarefa agendada.
2. Certifique-se de que nenhum processo do atualizador esteja em execução. Salve `journal.json` e os logs.
3. Só então exclua `operation.lock`.
4. Execute `arkvory recover --root <root>`. Ele avança na direção que o journal permite:
   - para uma atualização sem alteração de esquema, ou antes de a migração começar, ele retorna à versão anterior,
   - depois de a migração começar, ele segue em frente: repete a migração, que é segura de repetir, e inicia a nova versão.
5. Verifique se os serviços estão prontos e se um download de teste funciona. Inicie o timer novamente: `sudo systemctl start arkvory-update.timer`, ou `Enable-ScheduledTask -TaskName ProAnimaArkvoryUpdate`.

Se a solicitação do console que iniciou a atualização ainda estiver armazenada, `arkvory updates-reset --root <root>` a remove. Execute-o somente depois de ter verificado o estado. Ele não remove o bloqueio.

## Fixar uma versão {#pin}

Fixe uma versão para impedir toda atualização para outra versão.

```bash
sudo arkvory configure --root <root> --pin                  # pin the installed version
sudo arkvory configure --root <root> --pin --version 1.2.3  # pin another stable version
sudo arkvory configure --root <root> --unpin
```

Enquanto uma versão está fixada:

- as atualizações automáticas não fazem nada,
- o console se recusa a instalar um release e pede que você remova a fixação no servidor,
- `arkvory update` instala a versão fixada e recusa outro `--version`,
- as verificações continuam sendo executadas, então o console ainda mostra releases mais recentes.

Para instalar uma versão mais nova depois de ter fixado uma mais antiga, fixe a versão mais nova e execute `arkvory update`. Você também pode fixar durante a instalação com um script: `--pin` para `install.sh`, `-Pin` para `install.ps1`.

## O hub, o canal e as estatísticas {#hub}

### O que o servidor envia ao hub {#hub-data}

| Quando                                                    | O que é enviado                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verificação de atualização, a cada 6 horas ou sob demanda | Uma solicitação de atualização do projeto `arkvory` com a versão instalada, o sistema operacional (`linux` ou `windows`), o processador (`x86_64` ou `aarch64`) e o canal. Com as estatísticas ativadas, o cabeçalho `X-Install-Id` com um ID de instalação aleatório é adicionado |
| Uma atualização concluída, com as estatísticas ativadas   | Um evento `updated` com o ID de instalação, a nova versão, o sistema operacional, o processador e o canal                                                                                                                                                                          |
| Download de um release                                    | O hub responde com um link para o GitHub. Os arquivos vêm de lá                                                                                                                                                                                                                    |

Nenhuma chave, conta, nome de host ou conteúdo armazenado é enviado, e nenhuma credencial chega ao hub. O ID de instalação é um valor aleatório que não identifica nada além da instalação. Segundo o projeto, o hub não armazena endereços IP, nomes ou conteúdo. O hub também recebe o feedback que um usuário envia pelo console. Essa é uma ação separada do usuário.

Com as estatísticas desativadas, o servidor não envia ID de instalação nem eventos. O hub então oferece uma versão somente quando a liberou para todas as instalações.

### Opções {#hub-options}

| Configuração    | Padrão                     | Como alterar                                                                                                               |
| --------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Estatísticas    | ativadas                   | Console: [[ui:updateStatistics]] em [[ui:updateSettings]]. Comando: `--statistics off` ou `--statistics on`                |
| Canal           | `stable`                   | `--update-channel beta` para receber versões que a ProAnimaStudio oferece mais cedo, `--update-channel stable` para voltar |
| Endereço do hub | `https://hub.proanima.net` | `--hub-url https://hub.example` para um hub próprio, `--hub-off` para usar somente o GitHub. O endereço deve usar HTTPS    |

Todas elas são opções de `arkvory configure --root <root>` e entram em vigor sem reinicialização. As configurações são armazenadas em `config/hub.json`. Uma mudança do endereço do hub também altera para onde o console envia o feedback, após a próxima reinicialização dos serviços.

### Quando o hub está inacessível {#hub-unreachable}

Se o hub não responder (falha de rede, tempo limite ou um erro de servidor), o atualizador lê o release estável mais recente no GitHub e registra um aviso. Ele faz as mesmas verificações de assinatura e SHA-256. Uma recusa do hub (status 4xx), um arquivo ausente ou uma assinatura inválida é um erro, e não há fallback.

Se os releases no GitHub exigirem autenticação, crie o arquivo `github-token.txt` na raiz da instalação com um token que possa ler o conteúdo do repositório. Somente administradores podem ler o arquivo. O atualizador o usa, os serviços não o usam, e ele nunca é passado como opção de comando. Com `--hub-off`, o atualizador sempre usa o GitHub.

O servidor precisa de acesso HTTPS a `hub.proanima.net`, `api.github.com`, `github.com` e aos hosts de download do GitHub.

## Instalações offline {#offline}

Um servidor sem acesso à internet não pode verificar releases. A página [[ui:updates]] então mostra que a verificação falhou. Isso não afeta os serviços. Atualize a partir de arquivos em vez disso.

1. Em um computador com acesso à internet, baixe o kit para a plataforma do seu servidor: `Arkvory-Linux.tar.gz` ou `Arkvory-Windows.zip`. Compare o SHA-256 deles com `release-checksums.json` do release.
2. Copie o kit para o servidor e descompacte-o. O diretório contém `arkvory-release.json`, `arkvory-runtime.zip` e `arkvory-setup.mjs`. O kit não tem arquivo de assinatura. Baixe `arkvory-release.json.sig` da mesma página de release e coloque-o ao lado de `arkvory-release.json`: o atualizador então verifica a assinatura também.
3. Execute a atualização com o caminho absoluto do diretório:

   ```bash
   sudo arkvory update --root /opt/proanima-arkvory --artifact /media/release
   ```

   ```powershell
   & 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' update --root C:\ProgramData\ProAnima\Arkvory --artifact D:\release
   ```

O atualizador verifica o SHA-256 do arquivo em relação ao manifesto. Ele verifica a assinatura somente quando `arkvory-release.json.sig` está ao lado do manifesto. Um diretório local é escolha sua, então a atualização não exige a assinatura. Sem ela, a comparação do kit com `release-checksums.json` na etapa 1 é sua única prova de origem. As mesmas regras para uma alteração de esquema se aplicam: você precisa de um backup verificado primeiro.

Um pacote nativo ou `Arkvory-Setup-x64.exe` carrega seu release e não precisa de acesso à internet. Uma atualização do Compose compila a imagem no host. Ela precisa do Docker Hub somente quando a imagem base `node:24.21.0-bookworm-slim` ainda não está no host.

## Atualização por plataforma {#platforms}

### Windows {#platform-windows}

Execute um `Arkvory-Setup-x64.exe` mais recente sobre o instalado. O Setup encontra os dados e não pede o proprietário novamente. Ele atualiza os programas, os serviços e o release do banco de dados da mesma forma que uma atualização pelo console. Um Setup de uma versão mais antiga é recusado, e um Setup da mesma versão repara os serviços. Não inicie o Setup enquanto uma atualização está em execução. O instalador está disponível somente em inglês e russo. Você também pode atualizar pelo console ou com o comando.

### Pacotes Linux {#platform-linux}

Baixe o pacote mais recente na página de release e instale-o como o primeiro: `sudo apt install ./Arkvory-amd64.deb` ou `sudo dnf install ./Arkvory-x86_64.rpm`. Não há repositório apt ou dnf, então `apt upgrade` e `dnf upgrade` não encontram novas versões. A etapa de configuração do pacote executa a mesma atualização que o comando, com o release dentro do pacote. Os serviços em execução continuam atendendo até a troca.

Se a atualização for recusada, por exemplo porque uma alteração de esquema precisa de um backup que não existe, a versão antiga continua em execução e a etapa de configuração falha. Corrija a causa e repita a etapa com `sudo dpkg --configure -a` no Debian e Ubuntu, ou instalando o mesmo pacote novamente em sistemas RPM.

Após uma atualização pelo console, a versão mostrada pelo gerenciador de pacotes pode ser mais antiga que a versão em execução. Um pacote mais antigo que a versão em execução é recusado.

### Instalação por script {#platform-script}

Uma instalação por script não tem o comando `arkvory`. Atualize pelo console, ou execute `manage.mjs update` com o Node.js da instalação. Consulte [Configuração](./configuration#lifecycle-commands).

### Docker Compose {#platform-compose}

Atualize pelo console ou com `manage.mjs update`. O atualizador compila a imagem da nova versão, substitui os contêineres `backup`, `worker` e `api` e mantém os volumes. Uma instalação Compose sem `root` precisa de um `updates-poll` agendado. Consulte [Docker Compose](./docker#updates-compose).

## Após a atualização {#after}

- Verifique `arkvory status --root <root>` e entre no console.
- Exclua de `releases/` as versões que você não precisa mais. Mantenha a versão atual e a anterior nomeada em `journal.json`. Versões antigas, arquivos baixados e staging nunca são excluídos pelo atualizador.
- Uma atualização não atualiza o Node.js de uma instalação por script, os programas do PostgreSQL, o sistema operacional ou o mecanismo de contêineres. Atualize-os separadamente. Uma mudança da versão principal do PostgreSQL é uma migração por si só: faça backup primeiro.

## Solução de problemas {#troubleshooting}

| O que você vê                                                            | O que fazer                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A página diz que o atualizador do host não está conectado                | Execute `arkvory updates-connect --root <root>` em uma janela de manutenção                                                                                                                                                             |
| A página diz que o atualizador parou de informar                         | Verifique o timer ou a tarefa. No Linux: `systemctl status arkvory-update.timer` e `journalctl -u arkvory-update`. No Windows: a tarefa `ProAnimaArkvoryUpdate` e `logs\updater.log`. Verifique se `operation.lock` não ficou para trás |
| A verificação de release falhou                                          | Verifique o acesso ao hub e ao GitHub a partir do servidor. Os serviços não são afetados                                                                                                                                                |
| A instalação foi recusada porque um backup é necessário                  | Conecte o armazenamento de backups, espere pelo primeiro backup, verifique o status novamente. Consulte [O backup antes de uma atualização](#backup)                                                                                    |
| A atualização falhou                                                     | Leia `journal.json`, o log do atualizador e os logs dos serviços antes de tentar novamente                                                                                                                                              |
| É necessária recuperação manual                                          | Siga [Recuperar uma atualização interrompida](#recover-update)                                                                                                                                                                          |
| As configurações mudaram enquanto a solicitação esperava                 | Atualize a página e envie a solicitação novamente                                                                                                                                                                                       |
| `Installation is locked`                                                 | Outra operação está em execução, ou uma travou. Consulte [Recuperar uma atualização interrompida](#recover-update)                                                                                                                      |
| `Interrupted deployment; use recover after inspecting journal.json`      | Uma atualização anterior não terminou. Recupere primeiro                                                                                                                                                                                |
| `Downgrades are forbidden`                                               | A versão não é mais nova que a instalada                                                                                                                                                                                                |
| `Version is pinned`                                                      | Remova a fixação, ou instale a versão fixada                                                                                                                                                                                            |
| `Interrupted update request; inspect installation and use updates-reset` | Uma solicitação do console foi aceita mas não concluída. Verifique o estado e então execute `updates-reset`                                                                                                                             |

Mais dicas estão em [Solução de problemas](../operate/troubleshooting) e [Autorrecuperação](../operate/self-healing).
