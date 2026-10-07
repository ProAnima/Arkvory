---
title: Segurança
description: Como proteger um servidor Arkvory, onde ficam seus segredos, quais limites protegem o login, o que é registrado e auditado e o que é enviado ao hub da ProAnimaStudio.
---

# Segurança

Esta página é para o administrador que opera um servidor. Ela começa com os passos para proteger uma nova instalação e depois descreve cada proteção em detalhes.

O projeto informa que um modelo de ameaças e uma revisão de segurança externa ainda estão pendentes. Não publique o servidor na Internet aberta. Deixe apenas as redes dos seus clientes alcançá-lo.

## Proteja um novo servidor {#checklist}

1. Mantenha o endereço de escuta padrão `127.0.0.1` até que o HTTPS funcione. Consulte [Rede e HTTPS](#network).
2. Ative o HTTPS e abra somente a porta HTTPS para as redes dos clientes. Nunca abra a porta do banco de dados.
3. Crie contas pessoais para os administradores. Guarde a chave de recuperação para emergências. Consulte [Chave de recuperação](../install/index#recovery-key).
4. Dê a cada ferramenta ou sistema de CI sua própria conta de serviço, com uma chave que tenha o mínimo de direitos. Consulte [Chaves e tokens](#keys).
5. Deixe o autorregistro desativado. Ele já vem desativado por padrão.
6. Se houver um proxy reverso na frente do Arkvory, defina `ARKVORY_TRUSTED_PROXIES`. Consulte [Limites de login](#sign-in-limits).
7. Use um vault criptografado (o padrão) e guarde o kit de recuperação fora do servidor. Coloque-o também em um volume criptografado que somente a conta de serviço e o administrador de backups possam ler. Veja [Backups](./backups#encryption).
8. Mantenha cópias dos arquivos de segredos fora do servidor. Consulte [Faça backup dos seus segredos](#secret-backups).
9. Conecte as métricas e os alertas. Consulte [Monitoramento](./monitoring).

## Rede e HTTPS {#network}

O servidor escuta em `127.0.0.1:8080` por padrão. Uma instalação nativa pode escutar em outro endereço depois que você configurar o HTTPS:

```bash
sudo arkvory configure --root /opt/proanima-arkvory --tls-cert /etc/arkvory/fullchain.pem --tls-key /etc/arkvory/privkey.pem --listen-host 0.0.0.0
```

O comando verifica os arquivos, reinicia os serviços e restaura as configurações antigas quando os serviços não sobem. Consulte [HTTPS e proxy reverso](../install/https) para o procedimento completo e para o Docker Compose, que precisa de um proxy reverso.

- O certificado e a chave devem ser legíveis, combinar entre si e não estar expirados. Caso contrário, a API não inicia e nunca recorre ao HTTP simples.
- A versão mínima do TLS é 1.2. Defina `ARKVORY_TLS_MIN_VERSION=TLSv1.3` para exigir 1.3. Certificados de cliente não são suportados.
- O servidor responde com `Strict-Transport-Security: max-age=31536000` quando ele mesmo serve HTTPS. Um proxy é responsável por esse cabeçalho quando ele termina o TLS.
- Os arquivos de certificado renovados são lidos de novo a cada 300 segundos (`ARKVORY_TLS_RELOAD_SECONDS`), sem reinicialização. As novas conexões recebem o novo certificado. Um arquivo que não pode ser lido deixa o certificado em funcionamento no lugar e registra `tls.reload_failed`. `tls.expiring` é registrado diariamente nos últimos 14 dias.
- Um endereço que não seja de loopback, sem TLS e sem proxy confiável, registra o aviso `http.plaintext_exposed` na inicialização. Corrija isso antes de permitir a entrada de clientes.
- O Arkvory nunca desativa a verificação de um certificado que recebe: nem para espelhos, nem para o hub, nem no cliente de linha de comando. Adicione sua própria autoridade certificadora com `--mirror-ca-file` para espelhos.

Através de um proxy reverso, a API permanece no loopback. O proxy deve transmitir os corpos em fluxo, sem armazenar arquivos inteiros em buffer. Não registre a query string no proxy, porque um link de download carrega seu segredo ali.

## Segredos no servidor {#secrets}

Os instaladores criam estes arquivos na raiz da instalação. Mantenha as permissões definidas pelo instalador.

| Arquivo                      | Conteúdo                                                                          | Acesso                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `config/bootstrap-token.txt` | A chave de recuperação. Tem direitos de administrador                             | Linux: somente root (modo 0600). Windows: SYSTEM e Administrators           |
| `config/keys.json`           | Hashes SHA-256 da chave de recuperação e da chave de integridade, nunca as chaves | Linux: root escreve, o grupo do serviço lê (0640). Windows: herdado da raiz |
| `config/health-token.txt`    | A chave de integridade `deployment-health`. Não tem direitos sobre repositórios   | Linux: somente root. Compose: legível no contêiner                          |
| `config/runtime.json`        | Todas as configurações do servidor, incluindo a URL do banco de dados com a senha | Linux: root escreve, o grupo do serviço lê (0640). Windows: herdado da raiz |
| `config/postgres.env`        | A senha do banco de dados de uma instalação Compose                               | Somente root, ou SYSTEM e Administrators                                    |
| `github-token.txt`           | Um token opcional do GitHub para atualizações                                     | Somente root, ou SYSTEM e Administrators                                    |
| `config/mirrors/*.token`     | Chaves de leitura dos servidores de origem dos espelhos                           | A conta de serviço                                                          |
| A chave TLS                  | A chave privada do certificado                                                    | Você escolhe o local. Permita somente a conta de serviço                    |

No Windows, a raiz concede controle total a SYSTEM e Administrators. A conta de serviço `LocalService` lê a raiz e escreve somente em `data\`, `logs\` e na caixa de entrada de atualizações. O banco de dados usa outra conta, de modo que a API não pode ler seus arquivos.

Regras para todos os segredos:

- Passe-os em arquivos ou variáveis de ambiente, nunca em argumentos de comandos. Os argumentos aparecem na lista de processos.
- Não copie a chave de recuperação para clientes, sistemas de CI ou scripts. Crie contas e chaves de serviço para o trabalho diário.
- O servidor nunca escreve chaves, senhas, tokens, cabeçalhos `Authorization` ou query strings no log. Consulte [Monitoramento](./monitoring#never-logged).
- A saída dos comandos do instalador oculta URLs de banco de dados, chaves e segredos longos.

Para substituir a chave de recuperação, altere o arquivo `bootstrap-token.txt` e seu hash em `config/keys.json` juntos, mantenha a entrada `deployment-health` e reinicie a API e o worker. Consulte [Configuração](../install/configuration).

## Senhas e limites de login {#sign-in-limits}

As senhas têm de 12 a 128 caracteres e são armazenadas somente como hash com salt (scrypt). Um login dura 12 horas. Uma conta tem no máximo 32 sessões ativas; um novo login encerra a mais antiga. Alterar ou redefinir a senha encerra todas as sessões e revoga todos os tokens pessoais da conta.

O Arkvory não tem um bloqueio definitivo que permitiria a qualquer pessoa que conhece um nome bloquear seu proprietário. Ele desacelera ataques em camadas:

| Camada                            | Limite                                                                                                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Por endereço, login               | 10 tentativas de uma vez, depois mais 1 a cada 15 segundos. Uma senha correta devolve a tentativa. IPv6 conta por rede /64                                                                                                                              |
| Por endereço, autorregistro       | 3 tentativas, depois 1 a cada 20 minutos; 20 por processo, depois 1 a cada 3 minutos                                                                                                                                                                    |
| Por conta                         | Cada senha incorreta acrescenta uma unidade de débito. O débito diminui em 1 a cada 6 segundos. Acima de 20 unidades, cada senha incorreta acrescenta uma espera que dobra de 1 segundo até 2 minutos. Durante a espera, até a senha correta recebe 429 |
| Solicitações de login simultâneas | No máximo 16, e o corpo da solicitação deve chegar em até 10 segundos                                                                                                                                                                                   |
| Verificações de senha             | Verificações anônimas e de administradores usam filas separadas, de modo que uma enxurrada de logins não bloqueia um administrador                                                                                                                      |

A resposta é 429 `rate_limited`, com o motivo `login_attempts` e o cabeçalho `Retry-After`. Os contadores por endereço ficam no processo e são zerados ao reiniciar. O débito da conta fica no banco de dados. Uma redefinição de senha pelo administrador o elimina.

Atrás de um proxy reverso, defina `ARKVORY_TRUSTED_PROXIES` com os endereços do proxy (até 32, IP ou CIDR). Somente esses endereços podem informar o endereço do cliente com `X-Forwarded-For`. Sem a configuração, todos os clientes compartilham o endereço do proxy, e alguns logins malsucedidos bloqueiam todos por um tempo.

## Chaves, tokens e validade {#keys}

| Credencial                                  | Validade                                                                                              | Rotação                                                                                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Sessão de login                             | 12 horas                                                                                              | Faça login novamente                                                                                                                      |
| Token de acesso pessoal                     | 90 dias por padrão, no máximo 365. Escopo `read` ou `read-write`. Nunca tem direitos de administrador | Crie um novo token em [[ui:personalAccessTokens]] e revogue o antigo                                                                      |
| Chave de serviço                            | 90 dias por padrão, no máximo 365. Uma chave emitida, mas não ativada, expira após 15 minutos         | [[ui:keyRotate]] emite uma nova chave. A antiga funciona por no máximo mais 24 horas. [[ui:keyRevoke]] interrompe uma chave imediatamente |
| Link de download                            | Uma hora no console                                                                                   | Crie um novo link                                                                                                                         |
| Chave de recuperação e chave de integridade | Não expiram                                                                                           | Substitua-as manualmente. Consulte [Segredos no servidor](#secrets)                                                                       |

Crie tokens pessoais e altere senhas somente em uma sessão autenticada. Um token não pode criar tokens. Um token pessoal não tem direitos de administrador, independentemente de quem o possui.

Privilégio mínimo para ferramentas:

- Crie uma conta de serviço para cada consumidor em [[ui:services]], com [[ui:servicePolicy]] nos repositórios exatos e nas ações exatas de que precisa. [[ui:bindingRead]] e [[ui:bindingPublish]] preenchem conjuntos típicos.
- Criar contas e concessões exige o direito separado da chave de recuperação ou de uma delegação. [[ui:delegations]] permite ao proprietário passar direitos limitados a um operador. Uma chave delegada nunca dura mais que a chave de quem a emitiu.
- Dê ao coletor de métricas sua própria chave com direitos mínimos.
- Revogar uma concessão bloqueia uma chave que aguarda ativação, mas não revoga chaves já ativas. Revogue ou desative essas chaves separadamente. Um download iniciado continua após uma revogação.
- Uma alteração de direitos vale a partir da próxima solicitação. O servidor verifica novamente o acesso em cada solicitação, para listas, metadados e bytes dos arquivos.

## Logs de auditoria {#audit}

| Registro                      | Conteúdo                                                                                                                                                                | Onde ler                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Registro de segurança         | Logins e falhas, registros, alterações de contas, grupos, concessões, senhas e tokens pessoais, com autor, tipo de credencial, destino, resultado e endereço do cliente | `GET /api/v1/security/audit`, para uma sessão de administrador ou a chave de recuperação |
| Auditoria do catálogo         | Alterações de artefatos, caminhos, anotações e estágios em um repositório                                                                                               | `GET /api/v1/repositories/{repository}/audit`, com permissão para ler a auditoria        |
| Atividade da conta de serviço | Criação, alterações, chaves emitidas e revogadas de uma conta de serviço                                                                                                | [[ui:serviceAudit]] no console                                                           |
| Log do processo               | Uma linha `http.access` por solicitação, com `principal` e `clientIp`                                                                                                   | Consulte [Monitoramento](./monitoring#logs)                                              |

O registro de segurança permite apenas acrescentar entradas: o banco de dados recusa alterar ou excluir uma linha. O servidor mantém 365 dias e no máximo 1.000.000 de linhas, removendo as mais antigas em lotes. Solicitações recusadas pelos limites de taxa não são registradas, de modo que uma enxurrada não aumenta a tabela. Exporte o registro para seu próprio armazenamento de eventos se precisar de um histórico mais longo.

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_KEY" "https://arkvory.example/api/v1/security/audit?limit=100"
```

Use o parâmetro `after` com o último ID para ler linhas mais antigas.

## Console e navegador {#console-headers}

O servidor define estes cabeçalhos nas respostas do console:

| Cabeçalho                 | Valor                                                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy` | `default-src 'none'; img-src 'self' blob:; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` |
| `Referrer-Policy`         | `no-referrer`                                                                                                                                                                       |
| `X-Content-Type-Options`  | `nosniff`                                                                                                                                                                           |
| `Cache-Control`           | `private, no-store`                                                                                                                                                                 |
| `X-Request-Id`            | O ID da solicitação da resposta                                                                                                                                                     |

Toda resposta da API também contém `X-Content-Type-Options`, `Cache-Control` e `X-Request-Id`. A CSP não permite scripts inline ou externos, incorporação em frames nem conexão com outros hosts. As imagens de `blob:` são as capturas de tela que você acrescenta a uma mensagem de feedback.

O servidor não define cookies. O console mantém uma chave ou token de sessão somente na memória da aba do navegador. O navegador armazena apenas a escolha de tema e idioma e os arquivos privados da fila de downloads. Uma página de outro endereço não pode chamar a API: `ARKVORY_CORS_ORIGINS` está vazio por padrão. Ele lista até 16 origens exatas para um console externo, com HTTPS ou HTTP em loopback. Uma origem permitida não recebe direitos extras, porque cada solicitação precisa de uma chave.

## Assinatura das atualizações {#update-signing}

Cada release tem um manifesto `arkvory-release.json` com o SHA-256 do arquivo e do instalador e uma assinatura `arkvory-release.json.sig`. A assinatura é Ed25519 no formato minisign. O atualizador contém as chaves públicas em seu código.

- Um release do hub ou do GitHub só é instalado quando sua assinatura corresponde a uma chave incorporada e os valores SHA-256 correspondem ao manifesto. Uma assinatura incorreta é um erro, e o atualizador não procura outra origem.
- A chave privada de assinatura fica com o mantenedor e nunca no seu servidor. Um release pode conter uma chave pública antiga e uma nova para rotacioná-las.
- Uma pasta local passada com `--artifact` é uma escolha sua. Um arquivo de assinatura nela é verificado quando presente.
- O instalador gráfico e os pacotes `.deb` e `.rpm` ainda não são assinados com um certificado de editor. O Windows mostra o editor como desconhecido. Baixe-os somente do [GitHub Releases](https://github.com/ProAnima/Arkvory/releases) e compare os valores SHA-256 com `release-checksums.json`.
- Um release que muda o esquema do banco de dados só é instalado depois que o servidor cria e verifica um backup recente. Consulte [Atualizações](../install/updates).

## O que é enviado ao hub da ProAnimaStudio {#hub}

As atualizações são aprovadas no hub da ProAnimaStudio (`https://hub.proanima.net`). O servidor o contata nestes casos:

| Dados                      | Quando                                                       | Conteúdo                                                                                                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verificação de atualização | A cada 6 horas                                               | A versão atual, o sistema operacional e a arquitetura fazem parte do endereço. Com as estatísticas ativadas, um ID aleatório da instalação no cabeçalho `X-Install-Id`                                                                                              |
| Evento `updated`           | Após uma atualização instalada, com as estatísticas ativadas | A versão e o ID da instalação                                                                                                                                                                                                                                       |
| Feedback                   | Somente quando um usuário envia o formulário no console      | O texto, um endereço de email opcional para resposta, até 6 capturas de tela e o log da página do navegador. Um administrador pode acrescentar os últimos 1,5 MiB do log da API e um resumo do sistema. O formulário mostra tudo antes do envio ([[ui:reportShow]]) |

O ID da instalação é um UUID aleatório em `config/install-id`. Não contém nome, endereço ou conteúdo. O projeto informa que o hub não armazena endereços IP, nomes ou conteúdo de arquivos. Sem estatísticas, o ID não é enviado e o hub oferece uma versão somente quando ela é liberada para todas as instalações. O resumo do sistema contém versões, o número do esquema e o estado de atualizações e espelhos, sem endereços ou segredos. O log da API também não tem segredos.

Para desativar:

```bash
sudo arkvory configure --root /opt/proanima-arkvory --statistics off
sudo arkvory configure --root /opt/proanima-arkvory --hub-off
```

- `--statistics off` interrompe o envio do ID da instalação e do evento `updated`. O console tem a mesma opção: [[ui:updateStatistics]] em [[ui:updates]].
- `--hub-off` interrompe todo contato com o hub. As atualizações passam a vir somente do GitHub, e o feedback do console é desativado após a próxima reinicialização dos serviços. Os usuários recebem o endereço de contato mostrado no console.
- `--hub-url https://hub.example` aponta o servidor para outro hub. Somente HTTPS, ou HTTP em loopback, é aceito.

As verificações a cada 6 horas também acontecem quando a instalação automática está desativada. Um servidor sem acesso à Internet instala de uma cópia local de um release. Consulte [Atualizações](../install/updates).

## Faça backup dos seus segredos {#secret-backups}

O vault guarda o catálogo, os hashes de senhas e todos os arquivos publicados. O Arkvory o criptografa ao criá-lo, e o kit de recuperação deve ficar fora do servidor (veja [Backups](./backups#encryption)). O vault não guarda os arquivos da sua configuração. Guarde uma segunda cópia desses arquivos em um lugar criptografado fora do servidor:

- o kit de recuperação do vault de backups: é a única forma de ler os backups se o servidor e o arquivo de chave dele forem perdidos; guarde duas cópias em dois lugares.
- `config/keys.json` e `config/bootstrap-token.txt` (a chave de recuperação),
- `config/runtime.json`,
- o certificado e a chave TLS,
- `config/mirrors/` com as chaves dos espelhos,
- `config/hub.json` e `github-token.txt`, se você os usa.

Uma restauração cria uma nova instância com suas próprias configurações e seu próprio arquivo de chaves. Após uma restauração, as sessões desaparecem, os tokens pessoais e as chaves de serviço são revogados e as políticas de limpeza física e retenção ficam desativadas. Emita novas chaves e ative as políticas novamente de forma deliberada. As senhas voltam ao estado do momento do snapshot. Trate cada cópia desses arquivos como um segredo. Consulte [Backups](./backups).

## Relate uma vulnerabilidade {#vulnerabilities}

Não descreva uma vulnerabilidade nem publique chaves em uma issue pública. O proprietário do projeto é Ian Panaev (conta GitHub `ProAnima`). O projeto ainda não publicou um canal privado dedicado para relatos de segurança. Envie uma mensagem curta sem detalhes de exploração pela conta GitHub do projeto ou para o endereço do estúdio mostrado no console, `info@proanima.net`, e peça uma forma privada de continuar. Consulte `SECURITY.md` no repositório.

## Páginas relacionadas {#related-pages}

- [Monitoramento](./monitoring)
- [Autorrecuperação](./self-healing)
- [Contas e acesso](../use/accounts)
- [HTTPS e proxy reverso](../install/https)
- [Autenticação](../api/authentication)
- [Erros](../api/errors)
