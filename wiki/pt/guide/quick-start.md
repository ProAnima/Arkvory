---
title: Início rápido
---

# Início rápido

Esta página mostra o caminho mais curto para sair do zero e chegar a um servidor Arkvory em execução com um arquivo enviado. Escolha um método de instalação no passo 1 e siga os outros passos em ordem.

Baixe os instaladores somente da [página de releases](https://github.com/ProAnima/Arkvory/releases) do projeto e compare o SHA-256 deles com os arquivos de soma de verificação do release.

## Passo 1. Instalar o servidor {#step-1-install-the-server}

### Windows {#windows}

Você precisa do Windows 10 versão 1809 ou posterior, ou do Windows Server 2019 ou posterior, em x64, e de direitos de administrador. Não é necessária uma conexão com a internet.

1. Execute `Arkvory-Setup-x64.exe` e confirme a solicitação de permissão de administrador.
2. Escolha o idioma e aceite a licença.
3. Na página do proprietário, informe um nome (3–64 letras latinas, dígitos, `.`, `-` ou `_`) e uma senha de pelo menos 12 caracteres. Essa é a primeira conta de administrador.
4. Conclua o assistente. Ele pode abrir o console para você.

O instalador coloca o programa em `C:\Program Files\ProAnima\Arkvory` e os dados em `C:\ProgramData\ProAnima\Arkvory`. Ele cria quatro serviços do Windows: `Arkvorydatabase`, `Arkvoryapi`, `Arkvoryworker` e `Arkvorybackup`. Eles são executados sem nenhum usuário conectado. Consulte [Windows](../install/windows).

### Linux {#linux}

Use o pacote da sua distribuição. O gerenciador de pacotes também instala o servidor PostgreSQL (há suporte para as versões 16 a 19).

```bash
# Debian, Ubuntu
sudo apt install ./Arkvory-amd64.deb

# Fedora, compatíveis com RHEL
sudo dnf install ./Arkvory-x86_64.rpm
```

A raiz da instalação é `/opt/proanima-arkvory`. O pacote cria os serviços systemd `arkvory-database`, `arkvory-api`, `arkvory-worker` e `arkvory-backup`. Verifique-os:

```bash
systemctl status arkvory-api arkvory-worker arkvory-backup
```

Consulte [Linux](../install/linux).

### Docker Compose {#docker-compose}

Você precisa do Docker com Compose. No Windows, use o Docker Desktop com contêineres Linux. O script baixa o Node.js e os arquivos da versão, então precisa de acesso à internet.

Baixe `install.sh` ou `install.ps1` do release e leia o script antes de executá-lo.

```bash
sudo bash ./install.sh --mode compose
```

No Windows, execute o PowerShell com o mesmo usuário que executa o Docker Desktop, sem direitos de administrador:

```powershell
.\install.ps1 -Mode compose
```

A raiz da instalação é `/opt/proanima-arkvory` no Linux e `C:\ProgramData\ProAnima\Arkvory` no Windows. O conjunto de contêineres inclui a API, o worker, o agente de backup e o PostgreSQL 18. Consulte [Docker](../install/docker).

## Passo 2. Abrir o console {#step-2-open-the-console}

Abra `http://127.0.0.1:8080/console/` em um navegador no servidor.

No início, o servidor escuta somente no endereço local `127.0.0.1`. Para abrir o console no seu próprio computador, encaminhe a porta por SSH:

```bash
ssh -L 8080:127.0.0.1:8080 admin@arkvory.example
```

Depois, abra `http://127.0.0.1:8080/console/` no seu computador. Para dar acesso a outras máquinas, configure primeiro o [HTTPS](../install/https).

## Passo 3. Criar o proprietário {#step-3-create-the-owner}

No Windows, pule este passo: o instalador já criou o proprietário.

No Linux e no Docker, a primeira conta é criada com a **chave de recuperação**. O instalador grava a chave em `config/bootstrap-token.txt`, na raiz da instalação. Somente um administrador pode ler o arquivo.

```bash
sudo cat /opt/proanima-arkvory/config/bootstrap-token.txt
```

```powershell
Get-Content C:\ProgramData\ProAnima\Arkvory\config\bootstrap-token.txt
```

1. No console, abra [[ui:navStart]] e expanda [[ui:welcomeOwner]].
2. Cole a chave no campo [[ui:welcomeRecovery]].
3. Informe o nome do proprietário e uma senha de pelo menos 12 caracteres e selecione [[ui:welcomeCreate]].
4. Entre com o novo nome e a nova senha no cartão [[ui:connection]].

Mantenha a chave de recuperação em segredo e não exclua o arquivo. As ferramentas de instalação e atualização a usam. Consulte [Segurança](../operate/security).

O proprietário é um administrador e pode gravar no repositório `releases`. Para criar outro repositório, abra [[ui:administration]], expanda [[ui:manageGrants]], dê ao grupo `arkvory-owners` o acesso [[ui:write]] a um novo nome, como `builds`, e selecione [[ui:saveGrant]]. O nome de um repositório usa letras latinas minúsculas, dígitos, `-` e `_`, e tem no máximo 64 caracteres.

## Passo 4. Criar uma chave para suas ferramentas {#step-4-create-a-key-for-your-tools}

Scripts e o cliente de linha de comando precisam de uma chave. Para um primeiro teste, use um token de acesso pessoal:

1. Expanda [[ui:personalAccessTokens]] no cartão [[ui:connection]].
2. Preencha [[ui:tokenName]], defina [[ui:tokenScope]] como [[ui:tokenScopeReadWrite]] e selecione [[ui:generateToken]].
3. Copie o token. Ele é exibido uma única vez.
4. Salve-o em um arquivo que somente você possa ler, por exemplo `~/.arkvory/key`.

Para CI/CD e agentes de implantação, crie em vez disso uma conta de serviço com uma chave própria. Consulte [Contas e acesso](../use/accounts).

## Passo 5. Enviar e baixar com o curl {#step-5-upload-and-download-with-curl}

Um caminho de arquivo em um repositório funciona como um arquivo em um servidor web. `PUT` armazena uma nova versão do caminho, e `GET` retorna a versão atual.

```bash
export ARKVORY_KEY="$(cat ~/.arkvory/key)"

# Upload
curl -T ./Setup.exe -H "Authorization: Bearer $ARKVORY_KEY" \
  http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe

# Download
curl -fL -H "Authorization: Bearer $ARKVORY_KEY" -o Setup-copy.exe \
  http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe
```

O upload retorna um JSON como este:

```json
{
  "path": "builds/game/1.0/Setup.exe",
  "revision": 1,
  "created": true,
  "artifact": { "id": "…", "size": "1048576", "sha256": "…" }
}
```

Se você enviar os mesmos bytes novamente, a resposta é `200` com `"created": false`, e nenhuma nova versão é criada. Um arquivo novo recebe o status `201`.

No PowerShell:

```powershell
$headers = @{ Authorization = "Bearer $env:ARKVORY_KEY" }
$url = 'http://127.0.0.1:8080/api/v1/repositories/releases/raw/builds/game/1.0/Setup.exe'
Invoke-WebRequest -Method Put -InFile .\Setup.exe -Headers $headers -Uri $url
Invoke-WebRequest -Headers $headers -Uri $url -OutFile .\Setup-copy.exe
```

Uma solicitação `PUT` precisa ser concluída em até 30 minutos. Para arquivos muito grandes ou redes lentas, use o cliente de linha de comando: ele envia em partes e continua depois de uma falha. Consulte [Arquivos brutos](../protocols/raw-files).

## Passo 6. Usar o cliente de linha de comando {#step-6-use-the-command-line-client}

Instale o `arkvoryctl` no seu próprio computador: `Arkvory-CLI-Setup-x64.exe` no Windows, `Arkvory-CLI-amd64.deb` ou `Arkvory-CLI-x86_64.rpm` no Linux. Em uma máquina de CI com Node.js 24, o `arkvoryctl.mjs` também funciona.

```bash
arkvoryctl profile add local --server http://127.0.0.1:8080 --token-file ~/.arkvory/key
arkvoryctl doctor
arkvoryctl put ./Setup.exe builds/game/1.0/Setup.exe
arkvoryctl get builds/game/1.0/Setup.exe ./Setup-copy.exe
```

O perfil usa o repositório `releases`, a menos que você adicione `--repository`. Se uma transferência parar, execute o mesmo comando de novo: ele continua de onde parou e verifica o SHA-256 no final. O cliente aceita HTTP simples somente para o computador local; use HTTPS para um servidor remoto. Consulte [Cliente de linha de comando](../protocols/cli).

## Próximos passos {#next-steps}

- [Conceitos](./concepts): repositórios, artefatos, estágios e chaves.
- [HTTPS](../install/https): abra o servidor a outras máquinas com segurança.
- [Backups](../operate/backups): conecte um armazenamento de backups antes de guardar dados importantes.
- [Pacotes](../use/packages) e [Promoção](../use/promotion): builds versionados para implantação.
- [O console web](./console): um tour por todas as seções.
