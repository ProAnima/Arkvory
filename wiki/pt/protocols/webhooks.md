---
title: 'Webhooks'
description: 'Receba uma requisição HTTP quando um repositório mudar: configure uma assinatura, verifique a assinatura digital e trate entregas repetidas.'
---

# Webhooks

Um webhook avisa o seu sistema de que algo mudou em um repositório, para que ele não precise consultar o servidor. O worker do Arkvory envia um `POST` HTTP para a sua URL a cada evento do [feed de alterações](../api/reference/artifacts#listCatalogChanges) do repositório. Use-o para iniciar uma implantação quando um build é publicado ou para atualizar um cache quando um caminho recebe uma nova versão.

O administrador define as assinaturas em um arquivo. Ainda não há API nem página do console para elas. Você também pode ler o feed por conta própria com `GET /api/v1/repositories/<repository>/changes`.

## Como a entrega funciona {#how-it-works}

- **Uma assinatura acompanha um repositório** e envia para uma URL.
- **Os eventos chegam em ordem, um de cada vez.** O próximo espera até o receptor responder com um status `2xx`.
- **A entrega ocorre pelo menos uma vez.** Após uma falha ou uma resposta perdida, o mesmo evento pode chegar de novo. Cada evento tem um `id` estável: desduplique por ele.
- **Uma assinatura nova recebe apenas eventos novos.** Eventos anteriores à sua criação não são enviados.
- **Um receptor fora do ar atrasa só a sua própria assinatura.** O evento espera. O Arkvory tenta de novo após 12 segundos, dobra a pausa até uma hora e envia os eventos em ordem quando o receptor voltar a responder. Uploads e downloads nunca esperam por um webhook.

## Configurar uma assinatura {#set-up}

Você precisa de acesso aos arquivos do servidor e de permissão para reiniciar o worker. Veja [Configuração](../install/configuration).

1. Crie um arquivo de segredo com pelo menos 16 caracteres aleatórios, por exemplo `config/webhooks/ci.secret`. Somente a conta de serviço pode lê-lo. O receptor precisa do mesmo segredo.
2. Escreva o arquivo de assinaturas, por exemplo `config/webhooks/webhooks.json`:

```json
{
  "webhooks": [
    {
      "id": "ci",
      "repository": "releases",
      "url": "https://ci.example.com/hooks/arkvory",
      "secretFile": "/opt/proanima-arkvory/config/webhooks/ci.secret",
      "actions": ["artifact.publish"]
    }
  ]
}
```

3. Defina `ARKVORY_WEBHOOKS_FILE` com o caminho absoluto desse arquivo em `config/runtime.json` e reinicie o worker. Veja [Aplicar uma alteração](../install/configuration#apply-change).
4. Procure `webhook.started` no log do worker, publique um arquivo e observe o seu receptor.

Um arquivo incorreto interrompe o worker na inicialização com `worker.unavailable`. São permitidas até 16 assinaturas. Uma instalação com Compose exige montar os arquivos no contêiner do worker manualmente.

| Campo            | Significado                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | Nome da assinatura: de 1 a 64 caracteres `a-z`, `0-9`, `_` e `-`. O progresso dela é guardado com esse nome.                                                                          |
| `repository`     | O repositório cujo feed é enviado.                                                                                                                                                    |
| `url`            | O receptor. HTTPS, sem nome de usuário, query nem fragmento, até 2048 caracteres. HTTP simples só é permitido para `localhost`, `127.0.0.1` e `[::1]`.                                |
| `secretFile`     | Caminho absoluto do arquivo com o segredo de assinatura.                                                                                                                              |
| `nextSecretFile` | Segundo segredo opcional para uma [rotação](#rotate-the-secret).                                                                                                                      |
| `actions`        | Lista opcional de ações do feed a enviar, por exemplo `artifact.publish`, `artifact.delete`, `asset.replace`, `stage.add` e `package.register`. Sem ela, todas as ações são enviadas. |

## A requisição {#request}

| Cabeçalho             | Valor                                                                      |
| --------------------- | -------------------------------------------------------------------------- |
| `Content-Type`        | `application/json`                                                         |
| `X-Arkvory-Delivery`  | O `id` do evento. É o mesmo em cada repetição de um evento.                |
| `X-Arkvory-Event`     | A ação do feed, por exemplo `artifact.publish`.                            |
| `X-Arkvory-Timestamp` | Hora Unix em segundos em que a requisição foi assinada.                    |
| `X-Arkvory-Signature` | `sha256=<hex>`. Durante uma rotação há dois valores separados por vírgula. |

O corpo é JSON:

```json
{
  "id": "releases:128",
  "repository": "releases",
  "sequence": "128",
  "action": "artifact.publish",
  "artifactId": "00000000-0000-4000-8000-000000000001",
  "detail": null
}
```

`sequence` é a posição no feed, uma string decimal. `detail` é o caminho do arquivo ou o estágio nas ações que o têm. O corpo não tem autor, conteúdo de arquivo nem metadados: use `artifactId` para ler o estado atual pela [API](../api/index).

Responda com qualquer status `2xx` em até 10 segundos. Um status `3xx` (redirecionamentos não são seguidos), `4xx`, `5xx`, um erro de conexão ou um tempo esgotado conta como falha. O Arkvory lê no máximo 4 KiB da resposta e a ignora.

## Verificar a assinatura {#verify}

A assinatura é HMAC-SHA256 com o seu segredo sobre o texto `<timestamp>.<body>`, escrita como `sha256=` e o resumo em hexadecimal. Verifique-a antes de confiar em uma requisição:

1. Leia o corpo bruto, antes de qualquer análise de JSON.
2. Recuse a requisição se o carimbo de tempo diferir do seu relógio em mais de 5 minutos.
3. Calcule a assinatura e compare com uma função de tempo constante. Se o cabeçalho tiver dois valores, aceite qualquer um.

Node.js:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(secret, headers, rawBody) {
  const timestamp = headers['x-arkvory-timestamp'];
  if (!/^\d{1,12}$/.test(timestamp ?? '')) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = Buffer.from(
    'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex'),
  );
  return String(headers['x-arkvory-signature'] ?? '')
    .split(',')
    .some((given) => {
      const actual = Buffer.from(given.trim());
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    });
}
```

Python:

```python
import hashlib, hmac, time

def verify(secret: bytes, headers, raw_body: bytes) -> bool:
    timestamp = headers.get("X-Arkvory-Timestamp", "")
    if not timestamp.isdigit() or abs(time.time() - int(timestamp)) > 300:
        return False
    digest = hmac.new(secret, timestamp.encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    expected = "sha256=" + digest
    given = headers.get("X-Arkvory-Signature", "").split(",")
    return any(hmac.compare_digest(part.strip(), expected) for part in given)
```

## Tratar entregas repetidas {#repeats}

- Guarde o `id` de cada evento tratado e ignore uma repetição.
- Responda rápido: coloque o trabalho em uma fila e devolva `204`. Um receptor lento atrasa todos os eventos seguintes da sua assinatura.
- Uma repetição não significa que a operação ocorreu duas vezes. Trate o evento como uma dica e leia o estado atual pela API.

## Rotacionar o segredo {#rotate-the-secret}

1. Adicione `nextSecretFile` com o novo segredo e reinicie o worker. Cada requisição passa a levar duas assinaturas.
2. Troque o receptor para o novo segredo. Um receptor que aceita qualquer uma das assinaturas continua funcionando nesse meio-tempo.
3. Coloque o novo arquivo em `secretFile`, remova `nextSecretFile` e reinicie o worker.

## Receptores privados e certificados {#private-receivers}

- O Arkvory recusa receptores em endereços loopback, privados, link-local e de metadados de nuvem, e nomes que resolvem para eles. Assim o servidor não pode ser usado para alcançar serviços internos.
- Para enviar a um receptor da sua rede, liste a rede em `ARKVORY_WEBHOOKS_ALLOW_PRIVATE`, por exemplo `10.20.0.0/16`.
- Se o certificado do receptor vem da sua própria autoridade, defina `ARKVORY_WEBHOOKS_CA_FILE` com um arquivo PEM dessa autoridade. O certificado é sempre verificado.

## Monitorar webhooks {#monitor}

O worker escreve `webhook.step_failed` com um `errorCode` quando uma entrega falha e `webhook.recovered` quando volta a funcionar. As métricas `arkvory_webhook_failing` e `arkvory_webhook_last_success_timestamp_seconds` e o alerta `ArkvoryWebhookFailing` estão descritos em [Monitoramento](../operate/monitoring).

## Solução de problemas {#troubleshooting}

| `errorCode` | Causa e o que fazer                                                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blocked`   | O endereço do receptor não é permitido (loopback, privado, link-local ou de metadados). Use um endereço público ou adicione a rede a `ARKVORY_WEBHOOKS_ALLOW_PRIVATE`. |
| `timeout`   | Sem resposta em 10 segundos. Responda mais rápido e coloque o trabalho em fila.                                                                                        |
| `network`   | Conexão recusada, nome não encontrado ou conexão redefinida. Verifique a URL, o DNS e o firewall a partir do servidor.                                                 |
| `tls`       | O certificado não é confiável, expirou ou tem o nome errado. Corrija-o ou defina `ARKVORY_WEBHOOKS_CA_FILE`.                                                           |
| `redirect`  | O receptor respondeu `3xx`. Redirecionamentos não são seguidos: use a URL final.                                                                                       |
| `http_4xx`  | O receptor recusou a requisição. Verifique a checagem de assinatura, o caminho e a chave dele.                                                                         |
| `http_5xx`  | O receptor falhou. O Arkvory continua tentando, com até uma hora entre as tentativas.                                                                                  |
| `secret`    | O arquivo de segredo não existe, não pode ser lido ou tem menos de 16 bytes.                                                                                           |

Nada chega? Verifique se `webhook.started` está no log do worker, se `ARKVORY_WEBHOOKS_FILE` está definido, o nome do repositório e o filtro `actions`. Uma assinatura nova envia apenas eventos posteriores ao seu primeiro passo.

## Páginas relacionadas {#related-pages}

- [Configuração](../install/configuration)
- [Monitoramento](../operate/monitoring)
- [O feed de alterações na referência da API](../api/reference/artifacts#listCatalogChanges)
