---
title: HTTPS e proxy reverso
description: Torne o Arkvory acessível com segurança de outros computadores, com TLS integrado ou proxy reverso, e configure o console e CORS para outro endereço.
---

# HTTPS e proxy reverso

Uma nova instalação escuta em `127.0.0.1:8080` por HTTP simples. Somente programas no servidor podem acessá-la. Antes de conectar clientes de outros computadores, coloque HTTPS à frente. Chaves, senhas e links de download viajam nas solicitações: nunca os envie por HTTP simples entre computadores.

## Escolha um método {#choose}

|                                | TLS integrado                                  | Proxy reverso                                                |
| ------------------------------ | ---------------------------------------------- | ------------------------------------------------------------ |
| Instalações                    | Serviços Windows e Linux (nativo). Não Compose | Todas, e o único método para Compose                         |
| Configuração                   | Um comando `arkvory configure` com rollback    | Configuração do proxy e `ARKVORY_TRUSTED_PROXIES` no Arkvory |
| Porta                          | A porta da API, 8080 por padrão                | Qualquer uma, como 443                                       |
| Renovação do certificado       | A API lê os arquivos renovados sozinha         | Gerenciada pelo proxy                                        |
| Certificados de cliente (mTLS) | Não suportados                                 | Possíveis no proxy                                           |

## Antes de começar {#before-you-start}

- Obtenha um certificado para o nome usado pelos clientes, de uma autoridade em que confiem, por exemplo com certbot, win-acme ou sua autoridade corporativa. Você precisa do certificado com sua cadeia e da chave privada em arquivos PEM. A chave não pode ter senha.
- Crie um nome DNS que aponte para o servidor.
- Abra somente a porta HTTPS no firewall, e só para as redes dos clientes. Nunca abra a porta do banco de dados 54329.

## TLS integrado {#built-in-tls}

### Prepare os arquivos {#tls-files}

Os arquivos devem cumprir estas regras. O comando verifica todas antes de alterar qualquer coisa.

- Os caminhos são absolutos.
- Cada arquivo é PEM com no máximo 1 MiB. O arquivo do certificado contém o certificado e, depois, a cadeia.
- A chave é uma chave privada PEM não criptografada que corresponde ao certificado.
- O certificado não expirou.
- A conta de serviço pode ler ambos: `arkvory` no Linux, `LocalService` no Windows.

O Arkvory referencia os arquivos, sem copiá-los. Coloque-os onde permanecerão ao serem renovados. No Linux, não use `/home`: as unidades não podem acessá-lo. Alguns diretórios de ferramentas de certificados só permitem leitura por `root`; copie os arquivos renovados para um diretório legível pelo grupo do serviço, por exemplo com um hook de renovação. Exemplo para Linux:

```bash
sudo install -d -m 0750 -o root -g arkvory /etc/arkvory/tls
sudo install -m 0644 -o root -g arkvory fullchain.pem /etc/arkvory/tls/fullchain.pem
sudo install -m 0640 -o root -g arkvory privkey.pem /etc/arkvory/tls/privkey.pem
```

No Windows, coloque os arquivos em uma pasta legível por `LocalService` e permita somente a SYSTEM, Administrators e `LocalService` ler a chave.

### Ative o TLS integrado {#tls-enable}

1. Execute o comando com os caminhos e o endereço de escuta. `0.0.0.0` escuta em todas as interfaces IPv4, `::` em todas as interfaces, ou forneça o endereço de uma interface.

   ```bash
   sudo arkvory configure --root /opt/proanima-arkvory \
     --tls-cert /etc/arkvory/tls/fullchain.pem \
     --tls-key /etc/arkvory/tls/privkey.pem \
     --listen-host 0.0.0.0
   ```

   ```powershell
   & 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' configure --root C:\ProgramData\ProAnima\Arkvory `
     --tls-cert C:\ProgramData\ProAnima\Arkvory\tls\fullchain.pem `
     --tls-key C:\ProgramData\ProAnima\Arkvory\tls\privkey.pem `
     --listen-host 0.0.0.0
   ```

   O comando escreve `ARKVORY_TLS_CERT_FILE`, `ARKVORY_TLS_KEY_FILE` e `ARKVORY_HOST` em `config/runtime.json`, reinicia os serviços e espera a API responder à verificação de prontidão por HTTPS. A verificação aceita somente o certificado configurado. Se funcionar, imprime a data de expiração. Se algo falhar, restaura o `runtime.json` anterior, reinicia os serviços com ele e informa o motivo.

2. Abra a porta da API no firewall para as redes dos clientes.
3. Teste de um computador cliente. A porta continua sendo 8080, a menos que você altere `ARKVORY_PORT`:

   ```bash
   curl https://arkvory.example.com:8080/health/status
   ```

   A resposta é status 200 com `{"status":"ready"}`. O console fica em `https://arkvory.example.com:8080/console/`.

No Linux, a conta de serviço normalmente não pode escutar em portas abaixo de 1024. Para servir HTTPS na porta 443, use um [proxy reverso](#reverse-proxy).

Se o certificado for inválido na inicialização, a API para com erro. Nunca recorre a HTTP simples.

### Configurações {#tls-settings}

`configure` define os arquivos e o endereço. Mais duas configurações entram manualmente em `runtime.json`. Reinicie os serviços após alterá-las: consulte [Aplique uma alteração](./configuration#apply-change).

| Variável                     | Padrão    | Significado                                                                                                |
| ---------------------------- | --------- | ---------------------------------------------------------------------------------------------------------- |
| `ARKVORY_TLS_MIN_VERSION`    | `TLSv1.2` | `TLSv1.2` ou `TLSv1.3`                                                                                     |
| `ARKVORY_TLS_RELOAD_SECONDS` | `300`     | Frequência com que a API relê os certificados: de 30 a 86400 segundos, ou `0` para ler só na inicialização |

Toda resposta contém `Strict-Transport-Security: max-age=31536000`.

### Renove o certificado {#tls-renewal}

Grave o certificado e a chave renovados nos mesmos caminhos. Não precisa executar comandos nem reiniciar.

- A API compara os arquivos a cada `ARKVORY_TLS_RELOAD_SECONDS`. Novas conexões usam o novo certificado. Conexões abertas mantêm o antigo até terminar.
- Uma renovação inválida (arquivos ilegíveis, chave incompatível, certificado expirado) nunca substitui o certificado em funcionamento. A API registra `tls.reload_failed` e tenta novamente no próximo intervalo.
- Nos últimos 14 dias antes da expiração, a API registra `tls.expiring` uma vez por dia. A métrica `arkvory_tls_certificate_expiry_timestamp_seconds` serve para alertas. Consulte [Monitoramento](../operate/monitoring).

### Desative o TLS integrado {#tls-off}

```bash
sudo arkvory configure --root /opt/proanima-arkvory --tls-off --listen-host 127.0.0.1
```

`--tls-off` sozinho mantém o endereço de escuta. Sem `--listen-host 127.0.0.1`, a API passaria a servir HTTP simples em todas as interfaces abertas.

## Proxy reverso {#reverse-proxy}

O proxy aceita HTTPS dos clientes e encaminha HTTP simples à API. Mantenha a API em `127.0.0.1:8080` e instale o proxy no mesmo host. Uma instalação Compose sempre publica somente `127.0.0.1:8080`, então um proxy no host se encaixa diretamente.

1. Instale o proxy e obtenha um certificado para ele.
2. Configure conforme [O que o proxy deve fazer](#proxy-requirements).
3. Acrescente seu endereço a `ARKVORY_TRUSTED_PROXIES`. Consulte [Proxies confiáveis](#trusted-proxies).
4. Garanta que a porta da API não seja acessível de outros computadores.
5. Teste: `curl https://arkvory.example.com/health/status` retorna `{"status":"ready"}`.

### O que o proxy deve fazer {#proxy-requirements}

| Requisito                                                                                                          | Motivo                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Aceitar corpos de qualquer tamanho (`client_max_body_size 0` no nginx)                                             | Os arquivos têm dezenas de gigabytes ou mais. Uma parte pode ter até 1 GiB                                  |
| Não armazenar corpos de solicitações ou respostas em buffer (`proxy_request_buffering off`, `proxy_buffering off`) | Os bytes passam em fluxo. O buffer enche o disco do proxy e atrasa a transferência                          |
| Permitir solicitações de pelo menos 1900 segundos (`proxy_read_timeout`, `proxy_send_timeout`)                     | Uma solicitação de upload pode levar até 30 minutos (`ARKVORY_UPLOAD_DEADLINE_MS`, 1 800 000 ms por padrão) |
| Usar HTTP/1.1 com a API e manter a conexão                                                                         | Necessário para transmissão em fluxo                                                                        |
| Encaminhar o nome público em `Host`                                                                                | O servidor o usa para montar links absolutos, como nas respostas Git LFS e npm                              |
| Enviar `X-Forwarded-For` e `X-Forwarded-Proto: https`                                                              | Endereço do cliente para logs e limites de login, e esquema dos links absolutos                             |
| Sobrescrever `X-Request-Id` com um ID próprio                                                                      | A API mantém o ID de um proxy confiável. Um cliente não deve escolhê-lo                                     |
| Não escrever a query string no log de acesso                                                                       | Links de download carregam um segredo em `?token=`                                                          |
| Definir `Strict-Transport-Security` por conta própria, se desejar                                                  | A API só o envia pelo listener integrado                                                                    |

### nginx {#nginx}

Coloque isto no contexto `http` de um nginx existente. Substitua o nome e os caminhos dos certificados. `log_format` grava o caminho sem a query string.

```nginx
log_format arkvory_path '$remote_addr [$time_local] "$request_method $uri $server_protocol" '
                        '$status $body_bytes_sent $request_time $request_id';
server {
    listen 443 ssl;
    server_name arkvory.example.com;
    ssl_certificate /etc/arkvory/tls/fullchain.pem;
    ssl_certificate_key /etc/arkvory/tls/privkey.pem;
    access_log /var/log/nginx/arkvory.access.log arkvory_path;
    client_max_body_size 0;
    client_body_timeout 60s;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Request-Id $request_id;
        proxy_set_header Connection "";
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 1900s;
        proxy_send_timeout 1900s;
    }
}
```

Com esta configuração, liste o proxy em `ARKVORY_TRUSTED_PROXIES`, por exemplo `127.0.0.1`. A diretiva `proxy_set_header X-Request-Id $request_id` deve permanecer: ela sobrescreve um ID enviado pelo cliente.

### Caddy {#caddy}

```caddyfile
arkvory.example.com {
    reverse_proxy 127.0.0.1:8080 {
        header_up X-Request-Id {http.request.uuid}
        flush_interval -1
    }
}
```

O Caddy obtém o certificado sozinho, transmite corpos em fluxo, não tem limite de tamanho nem timeout do upstream por padrão e define `X-Forwarded-For`, `X-Forwarded-Proto` e `X-Forwarded-Host`. Não grava log de acesso a menos que você ative `log`. Se ativar, remova a query string do endereço registrado.

### IIS e outros proxies {#iis}

A configuração de referência do projeto é o nginx acima. Estas são as configurações equivalentes para IIS com Application Request Routing e URL Rewrite. O projeto não as testa. Confira os nomes na sua versão do IIS.

- Aumente o timeout do proxy do servidor para pelo menos 1900 segundos e defina o limite de buffer da resposta como `0`.
- Aumente `maxAllowedContentLength` no filtro de solicitações ao máximo: 4 294 967 295 bytes. O IIS não aceita corpos de 4 GiB ou mais, então um único upload `curl -T` desse tamanho falha. `arkvoryctl` envia arquivos grandes em partes.
- Envie o host original, `X-Forwarded-Proto: https` e o endereço do cliente em `X-Forwarded-For`. Defina um novo `X-Request-Id` em uma regra URL Rewrite.
- Mantenha a query string fora do log do IIS.

### Proxies confiáveis {#trusted-proxies}

`ARKVORY_TRUSTED_PROXIES` recebe até 32 endereços ou intervalos CIDR separados por vírgulas. Nomes de host e curingas são recusados. Somente solicitações vindas desses endereços podem definir:

- o endereço do cliente, com `X-Forwarded-For`. A API usa o endereço mais próximo que não é confiável,
- o ID da solicitação, com `X-Request-Id`,
- o host dos links absolutos, com `X-Forwarded-Host`.

Sem a lista, todos os clientes parecem vir do endereço do proxy. O limite de login conta todos como um cliente, e o log mostra o endereço do proxy em `clientIp`. Liste somente proxies que você controla.

Em um host Compose, a API pode ver o proxy no endereço do gateway da rede Compose em vez de `127.0.0.1`. Envie uma solicitação pelo proxy, encontre `clientIp` no registro `http.access` do log da API e liste esse endereço.

Edite `config/runtime.json` e reinicie os serviços. Consulte [Aplique uma alteração](./configuration#apply-change).

```json
{ "ARKVORY_TRUSTED_PROXIES": "127.0.0.1,::1" }
```

Quando a API escuta fora do loopback sem TLS e sem proxy confiável, registra `http.plaintext_exposed` ao iniciar. Uma configuração correta de proxy não o gera.

## O console e seu endereço de API {#console-api-address}

O console servido pelo Arkvory usa o endereço pelo qual foi aberto. Fala somente com seu próprio servidor: sua política de segurança de conteúdo não permite outros endereços. Atrás de um proxy, funciona sem alterações em `https://arkvory.example.com/console/`.

Para hospedar o console em outro servidor web, por exemplo junto a um portal:

1. Copie os arquivos do console de `releases/<version>/apps/web/public/` na raiz da instalação para o outro servidor. Sirva em `/console/` por HTTPS, com os tipos MIME corretos para `.js` e `.css`. Copie novamente após cada atualização do Arkvory.
2. No `index.html` copiado, defina o endereço do Arkvory:

   ```html
   <meta name="arkvory-api-base-url" content="https://arkvory.example.com/" />
   ```

3. Se o outro servidor define uma política de segurança de conteúdo, permita `connect-src` para o endereço do Arkvory e o worker local de script.
4. Permita a origem do console no Arkvory. Consulte [CORS](#cors).

### CORS {#cors}

Defina as origens de aplicativos web em outros endereços em `ARKVORY_CORS_ORIGINS` e reinicie a API.

```json
{ "ARKVORY_CORS_ORIGINS": "https://portal.example.com,https://tools.example.com" }
```

- A lista contém até 16 origens, cada uma com esquema, host e porta opcional, sem caminho. HTTPS é obrigatório. HTTP simples é aceito somente para `localhost`, `127.0.0.1` e `[::1]`.
- CORS se aplica a `/api/v1/*` e `/health/ready`. Uma origem não listada recebe status 403 com motivo `origin_not_allowed`. O endereço do próprio servidor não precisa de entrada.
- Uma origem na lista não recebe direitos. Cada solicitação ainda precisa de chave ou sessão e passa pelas verificações de acesso. O aplicativo envia a chave no cabeçalho `Authorization`, não em cookie.
- Os métodos permitidos são GET, HEAD, POST, PUT, PATCH e DELETE. Navegadores podem guardar a resposta de preflight por 10 minutos.

Teste uma solicitação preflight. A resposta deve ser status 204 com sua origem em `Access-Control-Allow-Origin`:

```bash
curl -i -X OPTIONS https://arkvory.example.com/api/v1/auth/me \
  -H 'Origin: https://portal.example.com' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'
```

## Verifique a configuração {#check}

1. `curl https://arkvory.example.com/health/status` retorna status 200 e `{"status":"ready"}`. A cadeia do certificado é verificada sem exceções.
2. Abra o console, faça login e envie um arquivo grande pelo mesmo endereço.
3. Execute `arkvoryctl doctor` com um perfil que use HTTPS. Não desative a verificação do certificado nos clientes: o cliente de linha de comando não permite isso e aceita HTTP simples somente para o computador local. Consulte [Cliente de linha de comando](../protocols/cli).
4. Após reiniciar a API, o log não tem registros `http.plaintext_exposed`.

## Solução de problemas {#troubleshooting}

| Problema                                                                     | Causa e correção                                                                                                                                                                   |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HTTPS was not enabled; the previous configuration is restored`              | O motivo vem na mensagem: arquivos não são PEM, a chave tem senha ou não combina, o certificado expirou ou a conta de serviço não pode ler um arquivo. Corrija e execute novamente |
| `TLS files must be given as absolute paths`                                  | Forneça caminhos completos                                                                                                                                                         |
| `Built-in TLS is for native installations; use a reverse proxy with Compose` | Compose não tem TLS integrado. Use um [proxy reverso](#reverse-proxy)                                                                                                              |
| Status 413 do proxy                                                          | O limite de corpo é baixo. Use `client_max_body_size 0` no nginx                                                                                                                   |
| Status 502 ou 504, ou upload interrompido após minutos                       | O proxy armazena o corpo em buffer ou seus timeouts são menores que 1900 segundos                                                                                                  |
| Todos são limitados no login, ou `clientIp` é sempre o proxy                 | O proxy não está em `ARKVORY_TRUSTED_PROXIES`                                                                                                                                      |
| Links nas respostas Git LFS ou npm mostram `http` ou um nome interno         | O proxy não encaminha `Host` ou `X-Forwarded-Proto: https`                                                                                                                         |
| Um aplicativo no navegador recebe 403 `origin_not_allowed`                   | Acrescente sua origem a `ARKVORY_CORS_ORIGINS` e reinicie                                                                                                                          |

Mais dicas em [Solução de problemas](../operate/troubleshooting) e [Segurança](../operate/security).
