---
title: Arquivos brutos
description: Armazene e leia um arquivo pelo seu caminho com uma única solicitação HTTP, usando curl, wget ou PowerShell, sem instalar nada.
---

# Arquivos brutos

Um caminho de arquivo em um repositório funciona como um arquivo em um servidor web. `PUT` armazena um corpo como a próxima versão de um caminho. `GET` retorna a versão atual. Use-o em scripts de build e jobs de CI que têm `curl` ou PowerShell e nada mais.

O endereço é o mesmo para os três métodos:

```text
https://<host>/api/v1/repositories/<repository>/raw/<path>
```

Por exemplo: `https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe`.

## Armazenar um arquivo {#store-a-file}

Você precisa de um repositório e de uma chave com acesso de escrita. Consulte [Contas e chaves](../use/accounts). Envie a chave como `Authorization: Bearer <key>`. Arquivos brutos não aceitam nenhum outro tipo de autenticação.

```bash
export ARKVORY_KEY="$(cat ~/.arkvory/key)"
URL="https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe"

curl --fail-with-body -sS -T ./GameSetup.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  "$URL"
```

```powershell
$headers = @{ Authorization = "Bearer $env:ARKVORY_KEY" }
$url = 'https://arkvory.example/api/v1/repositories/releases/raw/builds/game/1.4/GameSetup.exe'
Invoke-RestMethod -Method Put -InFile .\GameSetup.exe -Headers $headers -Uri $url
```

```bash
wget -qO- --method=PUT --body-file=GameSetup.exe \
  --header="Authorization: Bearer $ARKVORY_KEY" "$URL"
```

Passe ao `curl -T` o endereço completo do arquivo, não de uma pasta. Codifique os caracteres no caminho que uma URL não permite: escreva um espaço como `%20`, `#` como `%23` e `?` como `%3F`.

A resposta é JSON. Um novo arquivo ou novos bytes retornam `201`:

```json
{
  "path": "builds/game/1.4/GameSetup.exe",
  "revision": 1,
  "created": true,
  "artifact": { "id": "00000000-0000-4000-8000-000000000001", "size": "1048576", "sha256": "…" }
}
```

Se o caminho já contém exatamente esses bytes, a resposta é `200` com `"created": false` e a mesma versão. Nada é armazenado. Uma etapa de um job de CI pode ser executada novamente sem criar uma nova versão. `size` é uma string de dígitos decimais.

### Enviar uma soma de verificação {#send-a-checksum}

Envie o SHA-256 do arquivo com `X-Checksum-Sha256`, e o comprimento com `Content-Length`. `curl -T` e o PowerShell enviam o comprimento de um arquivo. Então o servidor grava os bytes diretamente no armazenamento em uma única passagem e os verifica lá. Uma soma de verificação errada retorna `422` com o código `integrity_mismatch`, não armazena nada e mantém o caminho como estava.

```bash
curl --fail-with-body -sS -T ./GameSetup.exe \
  -H "Authorization: Bearer $ARKVORY_KEY" \
  -H "X-Checksum-Sha256: $(sha256sum GameSetup.exe | cut -d' ' -f1)" \
  "$URL"
```

```powershell
$headers['X-Checksum-Sha256'] = (Get-FileHash .\GameSetup.exe -Algorithm SHA256).Hash.ToLower()
Invoke-RestMethod -Method Put -InFile .\GameSetup.exe -Headers $headers -Uri $url
```

Sem a soma de verificação, ou com um corpo em chunks que não tem `Content-Length`, o servidor primeiro grava o corpo em um arquivo temporário e calcula o hash. Depois o armazena. Isso exige, por um curto período, até o dobro do tamanho do arquivo no disco do servidor, e uma segunda passagem sobre os bytes. O servidor remove após um dia os arquivos temporários que uma falha deixou para trás.

Quando você envia a soma de verificação e o comprimento, e o caminho já contém esses bytes, o servidor responde `200` sem ler o corpo e fecha a conexão.

### Criar somente {#create-only}

Um `PUT` lê somente uma condição, `If-None-Match: *`. Com ela, o servidor armazena o arquivo somente se o caminho não existir. Caso contrário, responde `409` com o motivo `already_exists`, inclusive quando os bytes são os mesmos. Qualquer outro valor de `If-None-Match` em um `PUT` retorna `400`.

```bash
curl --fail-with-body -sS -T ./notes.txt \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "If-None-Match: *" \
  "https://arkvory.example/api/v1/repositories/releases/raw/docs/notes.txt"
```

### Dois escritores {#two-writers}

Quando duas solicitações alteram o mesmo caminho ao mesmo tempo, a primeira vence. A última recebe `409` com o motivo `revision_mismatch`, e o caminho mantém o conteúdo do vencedor. Execute a solicitação novamente para criar uma nova versão. Os bytes enviados pelo perdedor permanecem como um artefato sem caminho até que a retenção os remova.

## Ler um arquivo {#read-a-file}

`GET` retorna a versão atual do caminho. `HEAD` retorna somente os cabeçalhos.

```bash
curl --fail-with-body -sS -H "Authorization: Bearer $ARKVORY_KEY" -o GameSetup.exe "$URL"
```

```powershell
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -Headers $headers -Uri $url -OutFile .\GameSetup.exe
```

```bash
wget --header="Authorization: Bearer $ARKVORY_KEY" -O GameSetup.exe "$URL"
```

Os cabeçalhos da resposta:

| Cabeçalho               | Valor                                                              |
| ----------------------- | ------------------------------------------------------------------ |
| `ETag`                  | `"sha256:<digest>"`: o SHA-256 do conteúdo, entre aspas            |
| `Content-Length`        | O tamanho do arquivo                                               |
| `Accept-Ranges`         | `bytes`                                                            |
| `Content-Type`          | Sempre `application/octet-stream`                                  |
| `Content-Disposition`   | `attachment` com o último segmento do caminho como nome do arquivo |
| `X-Arkvory-Artifact-Id` | O ID do artefato que contém esta versão                            |

Um caminho desconhecido retorna `404`.

### Ranges e solicitações condicionais {#ranges-and-conditional-requests}

| Cabeçalho da solicitação    | Efeito                                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Range: bytes=0-1023`       | `206` com a parte solicitada e `Content-Range`. Um início após o fim do arquivo retorna `416` com `Content-Range: bytes */<size>`. |
| `Range: bytes=-1024`        | Os últimos 1024 bytes                                                                                                              |
| `Range: bytes=1048576-`     | Do deslocamento até o fim                                                                                                          |
| `If-Range: "sha256:…"`      | Aplica o `Range` somente se o ETag for exatamente este. Se o caminho tiver uma nova versão, você recebe o arquivo novo inteiro.    |
| `If-None-Match: "sha256:…"` | `304` sem corpo se o ETag for o mesmo. Também funciona com `HEAD`.                                                                 |

Somente um range por solicitação é suportado. Uma solicitação com vários ranges retorna o arquivo inteiro.

Um caminho pode receber uma nova versão a qualquer momento, e um `GET` resolve o caminho novamente. Para continuar um download com segurança, lembre-se do `ETag` da primeira resposta e envie-o como `If-Range`:

```bash
etag=$(curl -sSI -H "Authorization: Bearer $ARKVORY_KEY" "$URL" | awk 'tolower($1)=="etag:" {print $2}' | tr -d '\r')
curl -sS -H "Authorization: Bearer $ARKVORY_KEY" -H "If-Range: $etag" \
  -H "Range: bytes=1048576-" "$URL" >> GameSetup.part
```

Para pular um download quando o arquivo não mudou, envie o ETag que você armazenou da última vez:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $ARKVORY_KEY" \
  -H 'If-None-Match: "sha256:<digest>"' "$URL"
```

Para arquivos grandes, o [`arkvoryctl get`](./cli) baixa com retomada e verifica o SHA-256 para você.

## Caminhos e versões {#paths-and-versions}

Um arquivo bruto é um [arquivo por caminho](../use/files). Cada `PUT` com novos bytes adiciona uma versão ao caminho: versão 1, 2, 3 e assim por diante. As versões anteriores permanecem. Os bytes nunca são substituídos, porque cada versão aponta para seu próprio artefato imutável, nomeado a partir do último segmento do caminho.

- `GET` no endereço bruto sempre retorna a versão atual.
- Para ver todas as versões de um caminho, leia seu histórico: [`getAssetHistory`](../api/reference/files#getAssetHistory), ou [[ui:history]] no console.
- Para ler uma versão mais antiga, [`getAssetRevision`](../api/reference/files#getAssetRevision) retorna seu artefato. Baixe-o com o endereço de conteúdo do artefato.
- Para voltar a uma versão antiga, use [`restoreAsset`](../api/reference/files#restoreAsset). Ele adiciona uma nova versão que aponta para os bytes antigos.
- Para listar os caminhos de um repositório por prefixo, use [`listAssetPage`](../api/reference/files#listAssetPage).
- Um caminho não pode ser excluído. O histórico permanece. A retenção não remove artefatos que uma versão de caminho usa.

As mesmas operações estão no [SDK](./sdk#raw-files-by-path) (`client.raw.putRawFile`, `downloadRawFile`) e no [`arkvoryctl`](./cli#transfers) (`put`, `get`).

### Regras de caminho {#path-rules}

| Regra         | Valor                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Comprimento   | 1 a 1024 caracteres                                                                            |
| Pastas        | Segmentos separados por `/`                                                                    |
| Não permitido | Um segmento vazio (`a//b`), `.` ou `..`, barra invertida, dois-pontos e caracteres de controle |

`curl` e os navegadores removem `.` e `..` de uma URL antes de enviá-la, então esse caminho nunca chega. Um caminho que quebra as regras retorna `400`.

## Permissões {#permissions}

Tokens pessoais e chaves de arquivo recebem acesso de leitura ou de escrita ao repositório. Chaves de serviço recebem ações exatas.

| Operação      | Ações da chave de serviço                                                                        | Token pessoal ou chave de arquivo               |
| ------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `GET`, `HEAD` | `content.read`                                                                                   | Acesso de leitura                               |
| `PUT`         | `upload.create`, `upload.write`, `upload.complete`, `asset.read`, `asset.write`, `artifact.read` | Acesso de escrita, escopo do token `read-write` |

Um agente de implantação que apenas baixa precisa da ação `content.read`.

Um [gateway de leitura](../operate/read-gateways) aceita somente `GET` e `HEAD`. Um [espelho](../operate/mirrors) atende leituras e recusa `PUT` com `409` e o motivo `mirror_read_only`.

## Limites {#limits}

| Limite                   | Valor                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tamanho do arquivo       | O tamanho máximo de objeto da instalação, `ARKVORY_MAX_OBJECT_BYTES` (cerca de 10 TiB por padrão)                                                                                           |
| Uma solicitação `PUT`    | Deve terminar em até 30 minutos e não pode pausar por mais de 30 segundos (`ARKVORY_UPLOAD_DEADLINE_MS`, `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`). Esses também são os valores máximos permitidos. |
| Uploads ao mesmo tempo   | 2 por servidor e 1 por chave por padrão (`ARKVORY_MAX_UPLOADS`, `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`). Uma solicitação em espera desiste após 20 segundos com `503`.                         |
| Downloads ao mesmo tempo | 16 por servidor e 4 por chave por padrão                                                                                                                                                    |
| Cota                     | O arquivo conta para a cota do repositório e para a capacidade da instalação                                                                                                                |

Um único `PUT` não tem retomada: após uma falha, ele reinicia a partir do primeiro byte. Use arquivos brutos para arquivos pequenos e médios e para scripts. Para arquivos grandes ou redes lentas, use [`arkvoryctl put`](./cli) ou o [SDK](./sdk). Eles fazem upload em partes, continuam após uma falha e verificam o SHA-256. Eles também armazenam o arquivo como uma versão de um caminho. As variáveis são descritas em [Variáveis de ambiente](../reference/environment#transfers-and-bandwidth).

## Unity Addressables {#addressables}

Addressables carregam o catálogo e os bundles com requisições `GET` comuns, então uma pasta de build pode ficar em um caminho raw. Isso serve para builds internos, QA e ferramentas. Não serve para jogadores na internet pública: a leitura raw sempre exige uma chave, um link de download expira em 24 horas e uma chave dentro de um cliente distribuído não é secreta.

Envie a pasta com `arkvoryctl put`. Arquivos cujos bytes não mudaram não são enviados de novo. Use uma pasta por build, pois um caminho sempre devolve a sua revisão mais recente e um catálogo antigo não deve encontrar bundles novos:

```bash
cd ServerData/StandaloneWindows64
find . -type f | while read -r file; do
  arkvoryctl put "$file" "addressables/game/$BUILD/StandaloneWindows64/${file#./}" || exit 1
done
```

```powershell
$root = (Resolve-Path .\ServerData\StandaloneWindows64).Path
Get-ChildItem $root -Recurse -File | ForEach-Object {
  $relative = $_.FullName.Substring($root.Length + 1) -replace '\\', '/'
  arkvoryctl put $_.FullName "addressables/game/$env:BUILD/StandaloneWindows64/$relative"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

Defina o caminho de carregamento remoto do perfil do Addressables como o endereço raw dessa pasta, por exemplo `https://arkvory.example/api/v1/repositories/releases/raw/addressables/game/<build>/[BuildTarget]`. Dê ao cliente uma chave somente de leitura: um token de acesso pessoal com leitura ou uma chave de serviço com a ação `content.read`. O raw aceita a chave apenas no cabeçalho `Authorization`; defina-a em cada requisição:

```csharp
Addressables.WebRequestOverride = request =>
{
    if (request.url.StartsWith("https://arkvory.example/"))
        request.SetRequestHeader("Authorization", "Bearer " + readKey);
};
```

No Addressables 1.x a propriedade é `Addressables.WebRequestOverride`; confira o nome na sua versão. Isto é um padrão, não uma integração testada.

## Solução de problemas {#troubleshooting}

Os erros são documentos JSON com `code`, `reason`, `message` e `requestId`. Consulte [Erros](../api/errors). Informe o `requestId` ao seu administrador para encontrar a solicitação no log do servidor.

| Status          | Motivo                                                      | Causa                                                                                         | O que fazer                                                                                  |
| --------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `400`           | `validation`                                                | O caminho, `Content-Length`, `X-Checksum-Sha256` ou `If-None-Match` não é válido              | Verifique as regras de caminho e codifique a URL                                             |
| `401`           | `credential_missing`, `credential_invalid`, `token_expired` | Sem chave, chave errada, ou token expirado                                                    | Envie `Authorization: Bearer <key>`. A autenticação Basic não funciona para arquivos brutos. |
| `403`           | `permission_missing`, `read_only_token`                     | A chave não pode escrever, ou é um token somente leitura                                      | Use uma chave com as ações de [Permissões](#permissions)                                     |
| `404`           |                                                             | O caminho não existe, ou a chave não vê o repositório                                         | Verifique o nome do repositório e o caminho                                                  |
| `409`           | `already_exists`                                            | `If-None-Match: *` e o caminho existe                                                         | Remova o cabeçalho para adicionar uma versão                                                 |
| `409`           | `revision_mismatch`                                         | Outra solicitação alterou o caminho primeiro                                                  | Execute a solicitação novamente                                                              |
| `409`           | `mirror_read_only`                                          | O repositório é um espelho                                                                    | Escreva no servidor principal                                                                |
| `416`           | `range_not_satisfiable`                                     | O range começa após o fim do arquivo                                                          | Verifique o tamanho com `HEAD`                                                               |
| `422`           | `integrity_mismatch`                                        | O corpo não corresponde a `X-Checksum-Sha256` ou a `Content-Length`                           | Calcule a soma de verificação novamente; verifique o proxy                                   |
| `503`           | `busy`                                                      | Transferências demais ao mesmo tempo                                                          | Aguarde o tempo em `Retry-After` e tente novamente                                           |
| `507`           | `storage_quota`                                             | A cota do repositório ou a capacidade da instalação foi atingida                              | Libere espaço ou peça uma cota maior                                                         |
| Não é um status | `curl: (55)` ou `(56)` ao enviar                            | O servidor fechou a conexão. Quando o caminho já contém os bytes, ele responde `200` e fecha. | Execute `curl -i` e leia a resposta                                                          |
| Não é um status | A conexão fecha após 30 minutos                             | O prazo de upload                                                                             | Use `arkvoryctl put`                                                                         |

## Páginas relacionadas {#related-pages}

- [Clientes e protocolos](./index)
- [Linha de comando (arkvoryctl)](./cli)
- [SDK TypeScript](./sdk)
- [Arquivos e caminhos](../use/files)
- [Referência da API: arquivos por caminho](../api/reference/files)
