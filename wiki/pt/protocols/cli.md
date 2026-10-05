---
title: Linha de comando (arkvoryctl)
---

# Linha de comando (arkvoryctl)

O `arkvoryctl` é o cliente remoto do Arkvory para pessoas e para CI/CD. Ele envia e baixa em partes, continua depois de interrupções e verifica o SHA-256. Funciona com as permissões da chave que você fornece.

## Instalação {#install}

| Sistema                                                        | Pacote                      | Como instalar                                                                                                                                              |
| -------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows 10/11, Windows Server 2019+ (x64)                      | `Arkvory-CLI-Setup-x64.exe` | Execute o arquivo. Ele instala para o usuário atual, sem direitos de administrador, e adiciona o `arkvoryctl` ao `PATH` do usuário. Abra um novo terminal. |
| Debian, Ubuntu (x64)                                           | `Arkvory-CLI-amd64.deb`     | `sudo apt install ./Arkvory-CLI-amd64.deb`                                                                                                                 |
| Fedora, compatíveis com RHEL (x64)                             | `Arkvory-CLI-x86_64.rpm`    | `sudo dnf install ./Arkvory-CLI-x86_64.rpm`                                                                                                                |
| Qualquer sistema com Node.js 24 (por exemplo, um runner de CI) | `arkvoryctl.mjs`            | `node ./arkvoryctl.mjs --help`                                                                                                                             |

Os pacotes nativos incluem o próprio Node.js. O arquivo único `arkvoryctl.mjs` não tem dependências npm. Obtenha os arquivos de um release confiável de `ProAnima/Arkvory` e compare o SHA-256 deles com `release-checksums.json`. Ainda não há pacotes para ARM64. Para atualizar, instale uma versão estável mais recente. A desinstalação mantém seus perfis, arquivos de chave e checkpoints.

## Conectar a um servidor {#connect-to-a-server}

1. Obtenha uma chave: um token de acesso pessoal do console ou uma chave de serviço do seu administrador. Consulte [Contas e chaves](../use/accounts).
2. Salve a chave em um arquivo privado, fora de qualquer repositório. No Linux, use o modo `0600`. No Windows, permita o acesso somente à sua conta.
3. Adicione um perfil e verifique a conexão:

```bash
arkvoryctl profile add production --server https://arkvory.example --token-file "$HOME/.secrets/arkvory.key" --repository releases
arkvoryctl doctor
arkvoryctl repositories
```

```powershell
arkvoryctl profile add production --server https://arkvory.example --token-file C:\Private\arkvory.key --repository releases
arkvoryctl doctor
```

O `doctor` mostra o servidor, o repositório, as capacidades (capabilities) e as permissões da chave. A chave nunca é um argumento de comando.

## Perfis e ambiente {#profiles-and-environment}

Os perfis ficam em `profiles.json`, em `~/.config/arkvory` (no Windows, `.config\arkvory` na sua pasta de usuário). Um perfil guarda a URL do servidor, o repositório padrão e o **caminho** do arquivo de chave, não a chave.

| Comando                                                                 | Efeito                                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `profile add NAME --server URL [--token-file PATH] [--repository NAME]` | Adiciona um perfil. O primeiro perfil se torna o padrão. O repositório padrão é `releases`. |
| `profile list`                                                          | Mostra todos os perfis e o ativo                                                            |
| `profile use NAME`                                                      | Torna um perfil o padrão                                                                    |
| `profile remove NAME`                                                   | Remove um perfil                                                                            |

| Variável             | Significado                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_TOKEN`      | A própria chave. Tem prioridade sobre qualquer arquivo.                                                                                      |
| `ARKVORY_TOKEN_FILE` | Caminho de um arquivo de chave. Tem prioridade sobre o arquivo do perfil.                                                                    |
| `ARKVORY_BASE_URL`   | URL do servidor. Quando definida, o arquivo de chave do perfil **não** é usado: informe a chave por `ARKVORY_TOKEN` ou `ARKVORY_TOKEN_FILE`. |
| `ARKVORY_CLI_HOME`   | Outra pasta para o `profiles.json`                                                                                                           |

A URL do servidor deve usar HTTPS. HTTP simples é permitido somente para `localhost`, `127.0.0.1` e `[::1]`. A verificação de TLS não pode ser desativada.

## Opções globais {#global-options}

| Opção                      | Padrão       | Significado                                                                                                             |
| -------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `--profile NAME`           | perfil ativo | Perfil somente para este comando                                                                                        |
| `--repository NAME`        | do perfil    | Repositório somente para este comando                                                                                   |
| `--json`                   | desativada   | Um único resultado JSON compacto em stdout; erros em JSON em stderr                                                     |
| `--lang en` ou `--lang ru` | de `LANG`    | Idioma da ajuda e das mensagens                                                                                         |
| `--timeout MS`             | 60000        | Limite para solicitações de gerenciamento (1 a 3600000)                                                                 |
| `--attempt-timeout MS`     | 120000       | Limite de uma tentativa de transferência (1 a 1800000)                                                                  |
| `--retries N`              | 20           | Novas tentativas de rede para uma operação (0 a 100); `0` as desativa                                                   |
| `--verbose`                | desativada   | Uma linha em stderr por solicitação HTTP: método, caminho, status, tempo, ID da solicitação. Sem cabeçalhos nem chaves. |
| `--help`, `--version`      |              | Ajuda; versão do cliente em JSON                                                                                        |
| `--`                       |              | Encerra as opções, para nomes de arquivo que começam com `-`                                                            |

Cada opção pode aparecer uma vez. Opções desconhecidas são recusadas.

## Comandos {#commands}

### Descoberta e catálogo {#discovery-and-catalog}

| Comando                                                                    | Resultado                                            |
| -------------------------------------------------------------------------- | ---------------------------------------------------- |
| `doctor`                                                                   | Conexão, capacidades e permissões                    |
| `repositories [--after CURSOR]`                                            | Repositórios visíveis para a chave                   |
| `operations [--after CURSOR]`                                              | Operações da API disponíveis no repositório          |
| `list [--after CURSOR]`                                                    | Artefatos do repositório                             |
| `search [--query TEXT] [--label TAG] [--collection NAME] [--after CURSOR]` | Pesquisa por nome e por texto de metadados           |
| `search --metadata-key KEY --metadata-value VALUE`                         | Correspondência exata de metadados (informe os dois) |
| `inspect ID`                                                               | Metadados de um artefato                             |
| `storage usage` / `storage policy`                                         | Uso do repositório e política de armazenamento       |

As páginas retornam `next`. Passe esse valor com `--after` para ler a próxima página.

### Transferências {#transfers}

| Comando                                                                        | Resultado                                                                                                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `upload FILE [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]`   | Upload retomável de qualquer arquivo                                                                               |
| `download ID OUTPUT`                                                           | Download retomável e verificado por SHA-256                                                                        |
| `put FILE PATH [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]` | Envia o arquivo e o torna a próxima revisão de um caminho. Se o caminho já contém os mesmos bytes, nada é enviado. |
| `get PATH OUTPUT`                                                              | Baixa a revisão atual de um caminho, com verificação e de forma retomável                                          |
| `link ID [--ttl SECONDS]`                                                      | Uma URL de download sem chave, válida de 60 segundos a 24 horas (1 hora por padrão)                                |
| `uploads status ID` / `uploads cancel ID`                                      | Estado de uma sessão de upload; cancela a sessão (cancelar não é pausar)                                           |

O `METADATA.json` contém `labels` e `metadata` (um mapa de strings). Ele tem prioridade sobre `--label`.

```bash
arkvoryctl put "./Build/Game Setup.exe" builds/game/1.4/GameSetup.exe
arkvoryctl get builds/game/1.4/GameSetup.exe ./GameSetup.exe
arkvoryctl link 00000000-0000-4000-8000-000000000001 --ttl 900
```

Um link de download é um segredo. Ele não pode ser revogado antes de expirar.

### Pacotes e promoção {#packages-and-promotion}

| Comando                                                                                                               | Resultado                                                              |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `packages list [--group G] [--name N] [--after CURSOR]`                                                               | Pacotes UPack                                                          |
| `packages publish FILE [--label TAG] [--file METADATA.json] [--state CHECKPOINT.json]`                                | Envia um arquivo UPack e o registra                                    |
| `packages register ID`                                                                                                | Registra um UPack já enviado                                           |
| `packages resolve NAME [--group G] [--exact V] [--range R] [--stage S] [--prerelease] [--order promoted]`             | Seleciona uma versão (`--exact` e `--range` são mutuamente exclusivos) |
| `packages download NAME OUTPUT [mesmos filtros]`                                                                      | Seleciona uma versão e depois a baixa com verificação                  |
| `promote ID --to REPOSITORY [--move] [--stage S1,S2] [--comment TEXT]`                                                | Publica o artefato em outro repositório sem enviar os bytes de novo    |
| `stages list ID` / `stages add ID STAGE [--comment TEXT]` / `stages remove ID STAGE` / `stages artifacts [--stage S]` | Estágios dos artefatos                                                 |
| `promotions history ID` / `promotions journal [--after CURSOR]`                                                       | Histórico de promoções                                                 |

```bash
arkvoryctl packages publish ./build.upack --label test --state ./job-state/build.json --json
arkvoryctl promote 00000000-0000-4000-8000-000000000001 --to prod --stage release
arkvoryctl packages download app ./app.upack --range ^1.4 --stage release
```

Use `--exact` para uma versão exata; `--version` mostra a versão do cliente. Consulte [Pacotes](../use/packages) e [Promoção](../use/promotion).

### Anotações e anexos {#annotations-and-attachments}

`annotations get ID` e `annotations set ID --revision N --file ANNOTATIONS.json` leem e substituem rótulos, metadados e coleções. `attachments get ID`, `attachments history ID` e `attachments set ID --revision N --file ATTACHMENTS.json` fazem o mesmo com os arquivos vinculados de um build. Leia primeiro e depois envie o novo estado completo com a revisão que você leu. Uma alteração concorrente retorna um conflito (código de saída 6).

### Backups {#backups}

| Comando                                                           | Resultado                                                                                            |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `backup status`                                                   | Armazenamento de backups, agente, plano, último ponto, avisos; código de saída 9 em um aviso crítico |
| `backup run`                                                      | Coloca uma tarefa de backup na fila                                                                  |
| `backup jobs [--after CURSOR]` / `backup points [--after CURSOR]` | Tarefas e pontos de restauração, os mais recentes primeiro                                           |
| `backup verify POINT_ID`                                          | Coloca na fila uma verificação completa de um ponto                                                  |
| `backup pin POINT_ID [--off]`                                     | Mantém um ponto além da retenção, ou o libera                                                        |

Esses comandos exigem a chave de arquivo do proprietário da instalação (bootstrap) ou uma sessão de administrador de conta. Tokens pessoais e chaves de serviço recebem 403 (código de saída 3). Quem faz o trabalho é o agente de backup do servidor. Exemplo de monitoramento: `arkvoryctl backup status --json || alert`. Consulte [Backups](../operate/backups).

## Retomar transferências interrompidas {#resume-interrupted-transfers}

Depois de Ctrl+C ou de uma falha de rede, execute **o mesmo comando com as mesmas opções** novamente.

- `upload`, `put` e `packages publish` mantêm um checkpoint ao lado do arquivo de origem: `<source>.arkvory-upload.json`, ou o arquivo informado em `--state`. Ele guarda a chave de idempotência antes da primeira solicitação, então uma resposta perdida nunca cria uma segunda cópia.
- Para publicar os mesmos bytes como um artefato **novo**, use um novo arquivo `--state`.
- `download` e `get` mantêm `<output>.arkvory-part` e `<output>.arkvory-download.json` ao lado da saída. O arquivo final só aparece depois da verificação do SHA-256. Um arquivo de saída existente nunca é sobrescrito.
- No CI, crie a pasta de estado antes do job e mantenha-a, junto com o arquivo de origem, entre as novas tentativas.

Mantenha os checkpoints em um disco local com suporte a links físicos (NTFS, ext4, XFS), e não em FAT, exFAT ou compartilhamentos de rede. Depois de uma falha grave, um arquivo `.lock` permanece. Confirme que o processo com o PID indicado nele parou e exclua somente o arquivo `.lock`.

## Exemplo de CI {#ci-example}

```bash
# A chave vem do armazenamento de segredos do CI. Nunca a imprima.
export ARKVORY_BASE_URL=https://arkvory.example
export ARKVORY_TOKEN_FILE=/run/secrets/arkvory-key
mkdir -p job-state
node ./arkvoryctl.mjs packages publish ./build.upack --label test --state ./job-state/upload.json --json
```

Se o registro falhar depois do upload, o erro em JSON contém `stage: "register"` e o `artifactId`. Repita o mesmo comando. Registrar o mesmo artefato de novo é seguro.

## Saída {#output}

- Os resultados são JSON em stdout. Sem `--json`, o JSON sai indentado. Os comandos de backup imprimem linhas legíveis, a menos que você adicione `--json`.
- O progresso aparece somente em um stderr interativo.
- Um erro sem `--json` é uma linha em stderr com o código do servidor, o motivo, a mensagem, o próximo passo e o ID da solicitação. Com `--json`, o stderr contém `{"error": {...}}` com `code`, `exitCode`, `status`, `serverCode`, `reason`, `requestId` e `retryAfterSeconds`. Decida pelo `exitCode` quando um código for desconhecido.

## Códigos de saída {#exit-codes}

| Código | Significado                                                                       |
| ------ | --------------------------------------------------------------------------------- |
| 0      | Sucesso                                                                           |
| 2      | Argumentos ou configuração incorretos                                             |
| 3      | Sem chave, ou acesso negado (401, 403)                                            |
| 4      | Erro de HTTP ou de rede, tempo limite, servidor ocupado, não encontrado           |
| 5      | Falha de integridade (SHA-256 divergente, 422 `integrity_mismatch`)               |
| 6      | Conflito: revisão, estado, bloqueio, arquivo existente, checkpoint alterado (409) |
| 7      | Erro de arquivo local ou resposta inválida do servidor                            |
| 8      | Limite de capacidade do servidor: cota, disco, fila (507 `capacity_exceeded`)     |
| 9      | `backup status`: há um aviso crítico de backup ativo                              |
| 130    | Interrompido                                                                      |

O cliente repete a tentativa apenas em falhas de rede e em HTTP 408, 429, 502, 503 e 504, dentro do limite de `--retries`.

## Solução de problemas {#troubleshooting}

| Mensagem                               | Causa e solução                                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `credential_required` (saída 3)        | Nenhuma chave encontrada. Verifique `--token-file`, `ARKVORY_TOKEN_FILE` ou informe a chave quando `ARKVORY_BASE_URL` for usada. |
| `forbidden` (saída 3)                  | A chave não tem a permissão. Execute `doctor` para ver as permissões.                                                            |
| `checkpoint_mismatch` (saída 6)        | O arquivo, o servidor, o repositório ou as opções diferem do checkpoint salvo. Use as opções originais ou um novo `--state`.     |
| `state_locked` (saída 6)               | Outro processo usa o checkpoint, ou um `.lock` antigo permaneceu após uma falha.                                                 |
| `destination_exists` (saída 6)         | O arquivo de saída existe. Escolha outro nome.                                                                                   |
| `revision_mismatch` em `put` (saída 6) | Alguém alterou o caminho nesse meio-tempo. Verifique o histórico do caminho e depois decida.                                     |
| saída 8                                | A cota ou o disco está cheio. Fale com o administrador.                                                                          |

## Páginas relacionadas {#related-pages}

- [Clientes e protocolos](./index)
- [Transferências](../use/transfers) e [Arquivos por caminho](../use/files)
- [SDK TypeScript](./sdk)
- [Erros](../api/errors)
