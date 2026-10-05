---
title: SDK TypeScript
---

# SDK TypeScript

O SDK TypeScript é a biblioteca cliente que o console e o `arkvoryctl` usam. Ele encapsula a API REST `/api/v1`. Valida cada resposta em tempo de execução, envia em partes, continua transferências interrompidas e verifica os downloads por SHA-256. Usa apenas APIs web padrão (`fetch`, streams, Web Crypto), então funciona no Node.js e em navegadores.

## Obter o SDK {#get-the-sdk}

O SDK é o pacote de workspace `@proanima/arkvory-sdk`, na pasta `packages/sdk` do repositório de código-fonte `ProAnima/Arkvory`. Ele **não é publicado no registro npm**. Depende do pacote de workspace `@proanima/arkvory-contracts`.

- Para usá-lo, compile o repositório de código-fonte (`npm ci` e depois `npm run build`) e escreva sua ferramenta dentro desse workspace, como fazem os scripts do próprio repositório.
- A partir de outra linguagem, ou de um projeto que não possa usar o workspace, chame a [API REST](../api/index) diretamente com `Authorization: Bearer <key>`.

O código-fonte está disponível sob a licença do Arkvory. Você pode usá-lo e alterá-lo dentro da sua organização. Você não pode distribuir cópias.

## Criar um cliente {#create-a-client}

```typescript
import { ArkvoryClient } from '@proanima/arkvory-sdk';

const client = new ArkvoryClient('https://arkvory.example/', () => process.env.ARKVORY_KEY ?? '', {
  requestTimeoutMs: 60_000,
  attemptTimeoutMs: 120_000,
  maxRetries: 20,
});
const releases = client.inRepository('releases');
```

- **URL base.** HTTPS é obrigatório. HTTP simples é permitido somente para `localhost`, `127.0.0.1` e `[::1]`. A URL não pode conter usuário, senha, query nem fragmento. Ela pode conter um prefixo de caminho. Redirecionamentos são tratados como erros.
- **Callback do token.** O SDK o chama a cada solicitação e nunca guarda o resultado em cache. Você pode rotacionar chaves sem criar um novo cliente.
- **`inRepository(id)`** retorna um cliente vinculado a um repositório. É uma conveniência, não uma barreira de segurança.

| Opção              | Padrão | Significado                                                                                                              |
| ------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| `signal`           | nenhum | Cancela todas as solicitações deste cliente                                                                              |
| `requestTimeoutMs` | nenhum | Prazo de uma solicitação que não tem sinal próprio (1 a 3600000)                                                         |
| `maxAttempts`      | 5      | Tentativas de uma solicitação de transferência, incluindo a primeira (1 a 10)                                            |
| `maxRetries`       | 20     | Novas tentativas compartilhadas por uma operação de upload ou de download (0 a 100)                                      |
| `attemptTimeoutMs` | 120000 | Limite de uma tentativa de transferência (1 a 1800000)                                                                   |
| `baseDelayMs`      | 500    | Primeiro atraso do backoff (1 a 60000)                                                                                   |
| `maxDelayMs`       | 60000  | Maior atraso, incluindo `Retry-After`                                                                                    |
| `onRequest`        | nenhum | Chamado uma vez por solicitação HTTP com método, caminho, status, duração e ID da solicitação. Nunca recebe credenciais. |

As novas tentativas automáticas se aplicam somente às transferências: `create`, as etapas dentro de `resume` e `downloadVerified`. Elas repetem em caso de falhas de rede e de HTTP 408, 429, 502, 503 e 504, com backoff exponencial, e nunca antes do `Retry-After`. As outras chamadas são executadas uma única vez. Alterações protegidas por uma revisão nunca são repetidas automaticamente.

## Tarefas comuns {#common-tasks}

### Descobrir e listar {#discover-and-list}

```typescript
const permissions = await client.permissions();
const repositories = await client.repositories({ limit: 50 });
const page = await releases.artifacts.list();
const found = await releases.artifacts.search({ q: 'build-42', label: 'staging' });
for (const item of found.items) console.log(item.id, item.name, item.size);
const artifact = await releases.artifacts.get('00000000-0000-4000-8000-000000000001');
```

As páginas retornam `next`. Passe esse valor como `after` para ler a próxima página.

### Enviar um arquivo grande com retomada (Node.js) {#upload-a-large-file-with-resume-node-js}

```typescript
import { openAsBlob } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const file = await openAsBlob('./build/Game.zip'); // não é lido para a memória
const hash = createHash('sha256');
for await (const chunk of file.stream()) hash.update(chunk);

const key = randomUUID(); // salve-o com o estado do job antes da primeira solicitação
const session = await releases.uploads.create(key, {
  name: 'Game.zip',
  size: String(file.size),
  sha256: hash.digest('hex'),
  labels: ['test'],
  metadata: { commit: 'abc123' },
});
const uploaded = await releases.uploads.resume(session.id, file, {
  onProgress: (bytes) => console.log(`${bytes} de ${file.size} bytes`),
});
await releases.assets.assign('builds/game/1.4/Game.zip', uploaded.id, 0); // 0: o caminho é novo
```

- A mesma chave de idempotência com o mesmo descritor retorna a mesma sessão, então uma resposta perdida não cria um segundo upload.
- `resume` lê as partes que o servidor já tem, confere os hashes delas com o seu arquivo e envia somente as partes que faltam. Depois de uma falha, chame `resume` novamente com o ID da sessão salvo.
- O servidor escolhe o tamanho da parte: 8 MiB, maior somente para arquivos que precisariam de mais de 10.000 partes. O SDK mantém uma parte na memória por vez.
- Arquivos de 16 GiB ou mais são concluídos pelo worker do servidor. `resume` espera por ele.
- `assets.assign(path, artifactId, expectedRevision)` falha com um conflito se o caminho tiver outra revisão. Leia antes o caminho com `assets.get(path)`.

### Download com verificação {#download-with-verification}

```typescript
import { createWriteStream } from 'node:fs';
import { rename } from 'node:fs/promises';
import { Writable } from 'node:stream';

const stream = await releases.artifacts.downloadVerified(uploaded.id);
await stream.pipeTo(Writable.toWeb(createWriteStream('./Game.zip.part')));
await rename('./Game.zip.part', './Game.zip'); // somente depois que pipeTo for bem-sucedido
```

O SDK lê o conteúdo em faixas de 8 MiB e verifica o tamanho, o `Content-Range` e o `ETag` de cada faixa. Ele verifica o SHA-256 do arquivo inteiro antes de entregar o último bloco. Se a verificação falhar, o stream falha com `ArkvoryIntegrityError`. Nunca implante diretamente a partir do stream: grave em um arquivo temporário e use-o somente depois que o stream terminar com sucesso.

Para continuar depois de uma reinicialização, passe como `prefix` os bytes que você já salvou. O stream passa a conter somente o restante:

```typescript
const prefix = await openAsBlob('./Game.zip.part');
const rest = await releases.artifacts.downloadVerified(uploaded.id, { prefix });
await rest.pipeTo(Writable.toWeb(createWriteStream('./Game.zip.part', { flags: 'a' })));
```

Para uma única faixa de bytes sem verificação, `releases.artifacts.download(id, { start: 0, end: 1023 })` retorna a `Response` bruta (status 206).

### Arquivos brutos por caminho {#raw-files-by-path}

```typescript
const body = new Blob([JSON.stringify({ level: 3 })]);
const result = await client.raw.putRawFile('releases', 'config/settings.json', body, {
  createOnly: true, // opcional: recusa se o caminho já existir
});
console.log(result.revision, result.created); // created é false quando os bytes já estavam lá
const response = await client.raw.downloadRawFile('releases', 'config/settings.json');
```

A opção `sha256` (64 dígitos hexadecimais) permite que o servidor grave os bytes em uma única passada e rejeite uma divergência. `releases.assets.put(path, blob, options)` e `releases.assets.download(path, range)` são as mesmas chamadas. Cada upload é uma única solicitação, então use-as para arquivos pequenos e médios. Consulte [Arquivos brutos](./raw-files).

### Pacotes, promoção e links {#packages-promotion-and-links}

```typescript
await releases.packages.register(uploaded.id); // arquivo UPack
const selected = await releases.packages.resolve({ name: 'app', range: '^1.4', stage: 'release' });
await releases.promotions.promote(selected.artifactId, {
  target: 'prod',
  mode: 'copy',
  stages: ['release'],
});
const link = await releases.artifacts.link(selected.artifactId, { ttlSeconds: 900 });
```

A URL do link é um segredo que lê um artefato até `expiresAt`. Ela não pode ser revogada antes do prazo.

### Backups {#backups}

```typescript
const status = await client.backup.status();
const job = await client.backup.run(); // colocada na fila para o agente de backup
const points = await client.backup.points({ limit: 20 });
```

As chamadas de backup exigem uma sessão de administrador de conta ou a chave de arquivo do proprietário. Chaves de serviço e tokens pessoais recebem 403.

## Erros {#errors}

```typescript
import {
  ArkvoryClientError,
  ArkvoryHttpError,
  ArkvoryIntegrityError,
  ArkvoryNetworkError,
} from '@proanima/arkvory-sdk';

try {
  await releases.artifacts.get(id);
} catch (error) {
  if (error instanceof ArkvoryHttpError) {
    console.error(error.status, error.code, error.reason, error.requestId, error.retryAfterSeconds);
  } else if (error instanceof ArkvoryClientError) {
    console.error(error.code);
  }
}
```

| Classe                  | Significado                                                                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ArkvoryHttpError`      | O servidor respondeu com um erro. Campos: `status`, `code`, `reason`, `details`, `requestId`, `retryAfterMs`, `retryAfterSeconds`, `serverMessage`. `code` é `http_error` quando um proxy respondeu sem o formato do Arkvory. |
| `ArkvoryNetworkError`   | A conexão falhou ou excedeu o tempo limite depois de todas as novas tentativas                                                                                                                                                |
| `ArkvoryIntegrityError` | Os bytes baixados não correspondem ao artefato                                                                                                                                                                                |
| `ArkvoryClientError`    | Falha local com `code`: `invalid_argument`, `insecure_url`, `invalid_response`, `response_too_large`, `size_mismatch`, `file_changed`, `upload_cancelled`, `completion_failed`                                                |

Decida por `code` e `reason`, não pelo texto da mensagem. Trate códigos desconhecidos pelo status HTTP. `Error.message` nunca contém texto do servidor. Consulte [Erros](../api/errors).

## Navegador e Node.js {#browser-and-node-js}

- **Navegador em outra origem.** O administrador precisa listar a origem exata da sua página em `ARKVORY_CORS_ORIGINS` no servidor. O SDK envia a chave no cabeçalho `Authorization` e nunca envia cookies.
- **Chaves em um navegador.** Mantenha a chave somente na memória. Não a coloque em URLs, no `localStorage`, em logs nem no código-fonte da página. Um usuário pode entrar com `client.login(name, password)` para obter um token de sessão.
- **Arquivos no Node.js.** Use `openAsBlob` de `node:fs` para passar um arquivo sem lê-lo para a memória.
- **Fila de downloads.** `DownloadQueue` e `checkpointedDownload` oferecem uma fila limitada com pausar, retomar e cancelar. Você fornece o adaptador de armazenamento.

## Limites {#limits}

- As respostas JSON são limitadas a 2 MiB (páginas de pacotes, 8 MiB; listas de artefatos, 24 MiB). Respostas maiores falham com `response_too_large`.
- Os tamanhos são strings decimais, então valores acima de 2^53 mantêm a precisão total.

## Páginas relacionadas {#related-pages}

- [Linha de comando (arkvoryctl)](./cli)
- [Transferências](../use/transfers)
- [Visão geral da API](../api/index) e [Autenticação](../api/authentication)
- [Arquivos brutos](./raw-files)
