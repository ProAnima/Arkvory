---
title: Autenticação
description: 'Todas as formas de autenticar na API HTTP do Arkvory, o que cada credencial pode fazer e como funcionam as regras de acesso e as ações de repositório.'
---

# Autenticação

Cada chamada a `/api/v1` exige uma credencial, exceto as verificações de integridade públicas, as opções de login, o login e o registro. Esta página lista os tipos de credenciais, como obter e enviar cada uma e o que significam as regras de acesso na [referência da API](./index#reference-pages). Para as regras das pessoas que gerenciam o acesso, consulte [Contas e acesso](../use/accounts).

## Credenciais em resumo {#credentials}

| Credencial              | Aparência               | Como obtê-la                                         | Validade                          | Use para                                                                |
| ----------------------- | ----------------------- | ---------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------- |
| Sessão do console       | `dps_…`                 | Entrar com um nome e uma senha                       | 12 horas                          | Uma pessoa no console, ou um script que faz login                       |
| Token de acesso pessoal | `pat_…`                 | Criá-lo a partir de uma sessão                       | 90 dias por padrão, no máximo 365 | Scripts e ferramentas de uma pessoa                                     |
| Chave de serviço        | `arkvory_…`             | Emiti-la para uma conta de serviço e depois ativá-la | 90 dias por padrão, no máximo 365 | CI/CD, agentes de implantação, outros sistemas                          |
| Chave de recuperação    | 64 dígitos hexadecimais | O instalador a grava em `config/bootstrap-token.txt` | Não expira                        | Criar o proprietário, administrar contas de serviço, recuperar o acesso |
| Link de download        | `dtl_…`                 | Criá-lo para um artefato                             | 60 segundos a 24 horas            | Entregar um artefato a alguém sem uma chave                             |

Use uma chave de serviço para automação e um token de acesso pessoal para as ferramentas de uma pessoa. Não use a chave de recuperação no trabalho diário.

## Formatos de cabeçalho {#headers}

`/api/v1` aceita uma credencial em um cabeçalho:

```http
Authorization: Bearer <credential>
```

- Uma credencial tem de 32 a 512 caracteres. Qualquer outro tamanho resulta imediatamente em `credential_invalid`.
- O registro de contêineres (`/v2`), o Git LFS (`/lfs`) e o registro npm (`/npm`) também aceitam HTTP Basic, porque `docker login`, o git e o npm enviam credenciais dessa forma. O nome de usuário não é verificado; a senha é a credencial. Consulte [Clientes e protocolos](../protocols/index#credentials).
- Um link de download vai na query string, como `?token=dtl_…`, e funciona somente na rota de conteúdo de um artefato. Consulte [Links de download](#download-links). Um cabeçalho `Authorization` sempre tem prioridade sobre a query.
- Uma solicitação sem uma credencial válida recebe `401` com `WWW-Authenticate: Bearer` e um motivo: `credential_missing`, `credential_invalid`, `session_expired` ou `token_expired`. Somente o detentor do segredo exato de uma credencial expirada descobre que ela expirou.
- **Sem cookies.** O Arkvory não define nem lê cookies, então um navegador nunca anexa uma credencial sozinho e não há cross-site request forgery a defender. Um script envia o cabeçalho em cada chamada. O console mantém o token de sessão na memória da aba do navegador e o esquece quando você fecha a aba.
- **Outras origens.** Uma página no mesmo endereço do Arkvory não precisa de nada. Uma página em outro endereço é recusada com `403` e o motivo `origin_not_allowed`, a menos que o administrador tenha listado a origem dela em `ARKVORY_CORS_ORIGINS`, mesmo com uma credencial válida. Use HTTPS: uma credencial em HTTP simples é legível na rede. Consulte [HTTPS](../install/https).

Verifique o que uma credencial é e o que ela pode fazer:

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_KEY" "$ARKVORY_URL/api/v1/auth/me"
curl -fsS -H "Authorization: Bearer $ARKVORY_KEY" "$ARKVORY_URL/api/v1/auth/permissions"
```

## Sessões de login do console {#sessions}

Uma pessoa faz login com um nome e uma senha e recebe uma sessão. O console faz isso para você; um script pode fazer o mesmo.

1. Coloque o nome e a senha em um arquivo privado, `login.json`, para que nunca apareçam em uma linha de comando ou em uma lista de processos:

   ```json
   { "name": "alice", "password": "a long password of 12 to 128 characters" }
   ```

2. Chame `login`:

   ```bash
   curl -fsS -X POST "$ARKVORY_URL/api/v1/auth/login" \
     -H "Content-Type: application/json" -d @login.json
   ```

3. A resposta contém o token de sessão e seu horário de término:

   ```json
   {
     "token": "dps_…",
     "expiresAt": "2026-10-05T21:30:00.000Z",
     "account": { "id": "…", "name": "alice", "administrator": false, "enabled": true }
   }
   ```

4. Envie o token como `Authorization: Bearer dps_…`.

Regras de uma sessão:

- Dura 12 horas e não é estendida. Depois disso, cada chamada retorna `401` com o motivo `session_expired`. Faça login novamente.
- Uma conta tem no máximo 32 sessões. Um novo login encerra as mais antigas além desse limite.
- `POST /api/v1/auth/logout` encerra a sessão. Alterar sua senha, ou um administrador redefini-la, encerra todas as sessões e todos os tokens pessoais da conta. Desativar a conta os interrompe.
- Uma sessão carrega toda a autoridade da conta, incluindo o sinalizador de administrador. Somente uma sessão pode criar e revogar tokens pessoais e alterar a senha da própria conta.
- Os nomes são comparados sem distinção entre maiúsculas e minúsculas. Um nome errado, uma senha errada e uma conta desativada retornam o mesmo `401` com o motivo `invalid_credentials`.
- Um gateway de leitura não autentica ninguém; use o writer.

### Autorregistro {#self-registration}

`GET /api/v1/auth/options` é público e informa se as pessoas podem criar suas próprias contas. O autorregistro fica desativado a menos que o administrador defina `ARKVORY_ALLOW_REGISTRATION=true`; então `POST /api/v1/auth/register` com o mesmo corpo do login cria uma conta comum (não administradora, sem acesso a nenhum repositório) e retorna uma sessão com `201`. Caso contrário, responde `403` com o motivo `registration_disabled`. O autorregistro para em 900 contas, para que os administradores ainda possam criar contas até o limite de 1.000.

## Tokens de acesso pessoal {#personal-tokens}

Um token de acesso pessoal permite que um script aja como você sem sua senha. Somente uma sessão autenticada pode criá-lo.

```bash
curl -fsS -X POST "$ARKVORY_URL/api/v1/auth/tokens" \
  -H "Authorization: Bearer $SESSION" -H "Content-Type: application/json" \
  -d '{"name":"laptop-cli","scope":"read-write","expiresAt":"2026-12-31T00:00:00Z"}'
```

No console, abra [[ui:personalAccessTokens]] no cartão [[ui:connection]], informe um [[ui:tokenName]], escolha [[ui:tokenScope]] e [[ui:tokenExpiry]] e selecione [[ui:generateToken]].

| Campo       | Regra                                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `name`      | 1 a 64 caracteres.                                                                                                    |
| `scope`     | `read` ou `read-write`. A API usa `read-write` quando você o omite; o console oferece [[ui:tokenScopeRead]] primeiro. |
| `expiresAt` | Um horário RFC 3339 no futuro, no máximo 365 dias à frente. O padrão é 90 dias. Não há tokens sem término.            |

A resposta `201` contém o token uma única vez, como `token`. Salve-o então: o servidor mantém apenas um hash, e a lista mostra um prefixo curto. Depois:

- Um token tem o acesso de repositório da conta dele, e nada mais. Ele nunca tem o sinalizador de administrador, então não pode gerenciar contas, grupos, atualizações ou backups.
- Um token `read` só pode ler. Qualquer solicitação que altere algo, exceto `logout`, é recusada com `403` e o motivo `read_only_token`, antes que a operação seja executada.
- Um token não pode criar tokens nem alterar uma senha; isso exige uma sessão.
- Uma conta tem no máximo 50 tokens ativos. `GET /api/v1/auth/tokens` os lista com o prefixo, o escopo, o término e o último uso. `DELETE /api/v1/auth/tokens/{id}` revoga um imediatamente ([[ui:revokeToken]] no console). Um administrador pode listar e revogar os tokens de qualquer conta.
- Um token expirado retorna `401` com o motivo `token_expired`.

## Contas de serviço e chaves {#service-accounts}

Uma **conta de serviço** é uma identidade para uma ferramenta, como um agente de build. Ela tem uma **política**: uma lista de **vínculos**, cada um nomeando um repositório e as **ações** exatas permitidas nele (consulte [Ações de repositório](#repository-actions)). Uma política tem no máximo 64 vínculos. A conta é proprietária dos uploads e jobs que suas chaves iniciam, então rotacionar uma chave não perde nada. Um servidor tem no máximo 1.000 contas de serviço.

Somente a [chave de recuperação](#recovery-key) cria uma conta de serviço. Ela, ou um operador com uma [delegação](#delegation), altera as contas que existem. No console, use [[ui:services]]: [[ui:serviceCreate]] e depois defina [[ui:servicePolicy]]. [[ui:bindingRead]] preenche as sete ações de leitura, e [[ui:bindingPublish]] adiciona as ações necessárias para enviar e registrar pacotes.

```bash
curl -fsS -X POST "$ARKVORY_URL/api/v1/service-accounts" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" \
  -d '{"name":"ci-release","bindings":[{"resource":{"kind":"repository","id":"releases"},
       "actions":["repository.read","artifact.read","upload.create","upload.read","upload.write",
                  "upload.complete","upload.cancel","job.read","package.publish"]}]}'
```

Os nomes usam de 3 a 64 letras, dígitos, `_`, `.` e `-`. Para alterar a política, envie `PUT /api/v1/service-accounts/{id}/policy` com o `expectedRevision` que você leu ([compare-and-swap](./index#revisions)). Para desativar a conta, envie `PATCH /api/v1/service-accounts/{id}` com `{"expectedRevision": n, "enabled": false}`; todas as chaves dela param de funcionar até você ativá-la novamente.

### Chaves de serviço {#service-keys}

Uma chave é o segredo com o qual uma conta de serviço faz login. Ela se parece com `arkvory_<uuid>.<secret>`. Uma chave passa por três estados: `pending`, `active` e `revoked`.

1. **Emissão.** Envie `POST /api/v1/service-accounts/{id}/keys` com uma `Idempotency-Key`, um `name`, os `bindings` que a chave pode usar e, se quiser, um `expiresAt` (UTC, dentro de 365 dias; o padrão é 90). Os vínculos da chave devem estar dentro da política da conta. A resposta, `201`, contém os metadados da chave e, somente desta vez, o `secret` dela. Uma repetição com a mesma chave de idempotência retorna `200` com os metadados e sem o segredo.
2. **Ativação.** A nova chave fica `pending` e inutilizável, exceto para uma chamada, `POST /api/v1/auth/activate-key`, com o novo segredo como credencial. A resposta é `204`. Faça isso em até 15 minutos; depois disso a chave expira sem uso. No console, copie o segredo, selecione [[ui:keySaved]] e depois [[ui:keyActivate]]. Ativar novamente é inofensivo.
3. **Uso.** A chave funciona até seu `expiresAt` ou até ser revogada ou a conta dela ser desativada.

```bash
curl -fsS -X POST "$ARKVORY_URL/api/v1/service-accounts/$ACCOUNT/keys" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Idempotency-Key: ci-release-2026-10" \
  -H "Content-Type: application/json" \
  -d '{"name":"ci-release-2026-10","bindings":[{"resource":{"kind":"repository","id":"releases"},
       "actions":["upload.create","upload.read","upload.write","upload.complete","job.read"]}]}'
curl -fsS -X POST "$ARKVORY_URL/api/v1/auth/activate-key" -H "Authorization: Bearer $NEW_SECRET"
```

Limites: uma conta tem no máximo 3 chaves ativas e 2 chaves pendentes ao mesmo tempo (`507` com o motivo `key_limit`).

**Rotação.** `POST /api/v1/api-keys/{id}/rotate` emite uma nova chave pendente para a mesma conta, com o mesmo corpo de uma emissão e uma `Idempotency-Key`. Os vínculos dela devem estar dentro dos da chave antiga. Quando você ativa a nova chave, o término da chave antiga é reduzido para no máximo 24 horas a partir de então. Migre suas ferramentas para a nova chave e depois revogue a antiga. No console: [[ui:keyRotate]].

**Revogação.** `POST /api/v1/api-keys/{id}/revoke` encerra uma chave de vez; repetir é inofensivo. No console: [[ui:keyRevoke]]. Revogar uma chave não interrompe uma transferência que já começou. Perdeu o segredo de uma chave pendente? Revogue-a e emita outra com uma nova chave de idempotência.

### Delegação {#delegation}

A chave de recuperação pode transferir parte da administração para um **operador**: uma conta de serviço cuja chave pode gerenciar outras contas de serviço. Uma **delegação** nomeia a chave do operador, a conta de destino, as **ações de administração** que o operador pode usar nela e um **limite máximo** (ceiling), as ações de repositório que ele pode conceder. As sete ações de administração são:

| Ação                     | Permite                                    |
| ------------------------ | ------------------------------------------ |
| `service-account.read`   | Ver a conta nas listas e ler seu cartão.   |
| `service-account.manage` | Ativar ou desativar a conta.               |
| `policy.read`            | Ler a política da conta.                   |
| `policy.manage`          | Substituir a política da conta.            |
| `credential.read`        | Listar as chaves da conta e ler uma chave. |
| `credential.manage`      | Emitir, rotacionar e revogar chaves.       |
| `service-audit.read`     | Ler o histórico de chaves da conta.        |

Regras: a chave do operador deve ser uma que a chave de recuperação emitiu; um operador nunca gerencia a própria conta; ele não pode conceder nada fora de seu limite máximo ou além da política da conta; uma chave que ele emite não pode durar mais que a própria chave dele; e encerrar uma delegação não revoga chaves que já foram ativadas. Somente a chave de recuperação cria contas e define delegações (`PUT` e `DELETE /api/v1/api-keys/{id}/delegations/{accountId}`). Uma chave de operador pode ter até 64 delegações. No console, use [[ui:delegations]]. Um operador que precisa de algo fora de sua delegação recebe `404` para uma conta que ele não gerencia, ou `403`.

## A chave de recuperação {#recovery-key}

O instalador cria a **chave de recuperação** uma vez e a grava em `config/bootstrap-token.txt` na [raiz da instalação](../install/index#installation-directory). Somente o grupo Administradores no Windows, ou root no Linux, pode ler o arquivo. Seu hash está no arquivo de chaves do servidor (`ARKVORY_KEYS_FILE`), sob o nome `bootstrap-owner`. O instalador também cria `config/health-token.txt`, uma segunda chave sem quaisquer direitos de repositório, que pode chamar as verificações de integridade autenticadas e as métricas.

O que a chave de recuperação pode fazer:

- Criar a primeira conta e todas as contas seguintes, redefinir senhas, desativar contas e gerenciar grupos e suas concessões de repositório.
- Ler a auditoria de segurança e revogar os tokens pessoais de qualquer conta.
- Criar contas de serviço, definir suas políticas, emitir e revogar suas chaves e definir delegações.
- Ler e solicitar backups e atualizações e baixar o log do servidor para feedback.
- Ler e gravar o repositório `releases` como um membro de um grupo com acesso [[ui:write]].

O que ela não pode fazer: não tem acesso a repositórios além de `releases`, não pode excluir artefatos nem gerenciar políticas de armazenamento (essas ações existem somente para chaves de serviço) e não é uma sessão, então não pode criar tokens pessoais nem alterar uma senha. Mantenha-a no servidor. As ferramentas de instalação a leem lá. Não a coloque no CI e não a cole em ferramentas; crie uma chave de serviço em vez disso. Para substituí-la, consulte a [Configuração](../install/configuration).

O formulário [[ui:welcomeOwner]] do console (em [[ui:navStart]]) usa a chave de recuperação para criar o primeiro proprietário. Ele funciona somente enquanto não existe nenhuma conta. Para redefinir a senha de uma conta existente sem uma sessão, encontre o ID dela com `GET /api/v1/users`, coloque a nova senha (12 a 128 caracteres) em um arquivo privado e envie-a com a chave de recuperação. A redefinição encerra todas as sessões e tokens dessa conta.

```bash
echo '{"password": "a new password of 12 to 128 characters"}' > reset.json
curl -fsS -X PATCH "$ARKVORY_URL/api/v1/users/$USER_ID" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" -d @reset.json
rm reset.json
```

Outras chaves de arquivo podem ser adicionadas por um administrador no arquivo de chaves. Cada entrada tem um `id`, o `sha256` do segredo, os `repositories` e as `permissions` (`read` e `write`) que ela recebe e, opcionalmente, os sinalizadores `administrator` e `serviceAdministrator`. O arquivo é lido na inicialização, então reinicie a API e o worker após uma alteração.

## Links de download {#download-links}

`POST /api/v1/repositories/{repository}/artifacts/{id}/links` retorna um `token` (`dtl_…`) e uma `url` para um artefato. Peça uma validade com `ttlSeconds`: 60 a 86.400, e 3.600 por padrão. O chamador precisa de `content.read`.

O link funciona somente como `GET` ou `HEAD` de `/api/v1/repositories/{repository}/artifacts/{id}/content?token=…`, para aquele artefato naquele repositório, e apenas para leitura. É um segredo. O servidor não pode revogá-lo antes de expirar, e ele não aparece nos logs. Crie links com a menor validade de que você precisa.

## O que significa uma regra de acesso {#access-rules}

Cada operação na referência tem uma linha **Access**. Estes são os tipos de regras:

| Regra na referência                                   | O que ela exige                                                                                                                                                                                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Qualquer pessoa, sem uma chave                        | Nada. Verificação de atividade (liveness), estado de prontidão (readiness), opções de login, login e registro.                                                                                                                                                                 |
| Qualquer chave ou sessão válida                       | Qualquer credencial válida. Exemplos: capacidades, a lista de operações, sua própria identidade, detalhes de prontidão e métricas.                                                                                                                                             |
| Uma sessão de conta autenticada (não uma chave)       | A sessão de uma pessoa. Tokens pessoais e chaves são recusados (`session_required`). Exemplos: criar e revogar seus próprios tokens, alterar sua senha.                                                                                                                        |
| Administrador                                         | A sessão de uma conta administradora, ou uma chave de arquivo com o sinalizador de administrador, como a chave de recuperação. Tokens pessoais e chaves de serviço são recusados (`administrator_required`). Exemplos: contas, grupos, a auditoria de segurança, atualizações. |
| Chave bootstrap (chave de recuperação da instalação)  | Uma chave de arquivo com o sinalizador de administração de serviço. A chave de recuperação o tem. Exemplos: criar contas de serviço e definir delegações.                                                                                                                      |
| Chave bootstrap, ou a própria chave                   | A chave de recuperação, ou a chave cujas delegações estão listadas.                                                                                                                                                                                                            |
| A chave emitida, antes ou depois da ativação          | A única operação que aceita uma chave pendente: a ativação.                                                                                                                                                                                                                    |
| Repositórios que o chamador pode ver                  | A ação `repository.read` nesse repositório, ou qualquer acesso a ele para uma sessão ou chave de arquivo. Um repositório que o chamador não pode ver fica fora das listas e responde `404`.                                                                                    |
| Permissão de sistema `backup.read` ou `backup.manage` | Detida por sessões de administrador e por chaves de arquivo com sinalizador de administrador. Chaves de serviço e tokens pessoais nunca as têm. `backup.manage` inclui `backup.read`.                                                                                          |
| Permissão de administração de serviço                 | Uma das sete [ações de administração](#delegation) na conta de destino, proveniente de uma delegação, ou a chave de recuperação.                                                                                                                                               |
| Permissão de repositório                              | **Todas** as ações de repositório listadas no repositório nomeado no caminho. Várias regras de acesso adicionam condições: o upload, o job ou a referência devem pertencer ao chamador.                                                                                        |

A segunda parte de uma linha de repositório, como "chaves de arquivo: `read`, `write`", é a concessão ampla de que as pessoas e as chaves de arquivo precisam em vez das ações exatas. Consulte [Concessões de grupo](#group-grants).

Além da regra de acesso, o servidor também recusa uma alteração em um repositório que é um espelho (`409`, `mirror_read_only`), e um gateway de leitura recusa toda alteração (`405`, `read_only`).

## Permissões de repositório {#repository-permissions}

### Concessões de grupo {#group-grants}

As pessoas obtêm acesso a repositórios por meio de **grupos**. Um administrador concede a um grupo `read` ou `write` (exibido como "Ler e gravar") em um repositório e adiciona contas ao grupo. No console: [[ui:administration]], depois [[ui:manageGrants]] e [[ui:saveGrant]]. As chamadas da API são `PUT /api/v1/access-groups/{id}/grants/{repository}` com `{"access": "read"}` ou `{"access": "write"}`, e `PUT /api/v1/access-groups/{id}/members/{userId}`. Os direitos são recalculados em cada solicitação, então uma alteração se aplica imediatamente.

Uma concessão `read` concede estas ações: `repository.read`, `artifact.read`, `artifact.list`, `content.read`, `package.read`, `asset.read` e `annotation.read`. Uma concessão `write` adiciona `upload.create`, `upload.read`, `upload.write`, `upload.complete`, `upload.cancel`, `job.read`, `package.publish`, `asset.write`, `asset.restore`, `annotation.write`, `reference.write`, `artifact.promote` e `audit.read`. As ações `artifact.delete`, `storage.read`, `storage.manage` e `diagnostics.read` não podem vir de um grupo: somente uma chave de serviço pode tê-las.

### Ações de repositório {#repository-actions}

Uma chave de serviço carrega ações exatas, repositório por repositório. São 24:

| Ação               | Permite                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `repository.read`  | Ver o repositório e seu estado de espelho.                                                                                     |
| `artifact.read`    | Ler os detalhes, os estágios e as promoções de um artefato. Também necessário em toda alteração de um artefato.                |
| `artifact.list`    | Listar e pesquisar artefatos, listar artefatos com estágio, ler o diário de promoções e o feed de alterações.                  |
| `artifact.promote` | Definir e remover estágios e promover (copiar ou mover) para outro repositório.                                                |
| `artifact.delete`  | Excluir artefatos, pré-visualizar e aplicar retenção, remover imagens de contêiner e forçar o desbloqueio de arquivos Git LFS. |
| `content.read`     | Baixar bytes por ID, por pacote ou por caminho e criar links de download.                                                      |
| `upload.create`    | Criar sessões de upload. O push para os registros e o Git LFS a utiliza.                                                       |
| `upload.read`      | Ler suas próprias sessões de upload e suas partes.                                                                             |
| `upload.write`     | Enviar as partes ou todo o conteúdo do seu próprio upload.                                                                     |
| `upload.complete`  | Concluir seu próprio upload, ou colocar sua conclusão na fila.                                                                 |
| `upload.cancel`    | Cancelar seu próprio upload pendente.                                                                                          |
| `job.read`         | Ler seus próprios jobs de conclusão.                                                                                           |
| `package.read`     | Listar pacotes, resolver versões e baixar pacotes.                                                                             |
| `package.publish`  | Registrar um arquivo UPack como um pacote.                                                                                     |
| `asset.read`       | Listar arquivos por caminho e ler seus ponteiros, histórico e revisões. Baixar os bytes exige `content.read`.                  |
| `asset.write`      | Apontar um caminho para um artefato, ou armazenar um arquivo bruto.                                                            |
| `asset.restore`    | Restaurar uma revisão anterior de um caminho.                                                                                  |
| `annotation.read`  | Ler rótulos, metadados, coleções e anexos.                                                                                     |
| `annotation.write` | Substituir rótulos, metadados, coleções e anexos.                                                                              |
| `reference.write`  | Adicionar e remover referências que protegem um artefato.                                                                      |
| `audit.read`       | Ler a auditoria do catálogo do repositório.                                                                                    |
| `storage.read`     | Ler a cota, o uso, a política de armazenamento e as configurações de limpeza.                                                  |
| `storage.manage`   | Alterar a política de armazenamento e as configurações de limpeza e executar a limpeza.                                        |
| `diagnostics.read` | Ler eventos de armazenamento.                                                                                                  |

O conjunto exato de que uma operação precisa está na linha dela na referência, por exemplo `upload.write` e `upload.complete` para `putUploadContent`. Uma alteração em um repositório também exige a ação `read` correspondente, como `artifact.read` com `annotation.write`.

As condições de proprietário se aplicam a uploads e jobs: você age somente nas sessões de upload e nos jobs de conclusão que sua conta criou. Todas as chaves de uma conta de serviço, e todas as sessões e tokens de uma pessoa, contam como o mesmo proprietário. Vários serviços em um repositório são, portanto, separados por contas e repositórios, não por prefixos de um caminho.

### Permissões de administração e de sistema {#administration-permissions}

Dois outros tipos de permissão não são ações de repositório. As sete ações de administração estão listadas em [Delegação](#delegation). As duas permissões de sistema, `backup.read` e `backup.manage`, pertencem somente a administradores e à chave de recuperação.

## Limites de login {#sign-in-limits}

O servidor desacelera a adivinhação de senhas antes de verificar qualquer senha. Os contadores ficam na memória de cada processo da API e começam de novo após uma reinicialização. Eles se aplicam por endereço de cliente, com um endereço IPv6 contado pelo prefixo /64. Atrás de um proxy reverso, defina `ARKVORY_TRUSTED_PROXIES`, ou todo cliente aparece como o proxy.

| Limite                             | Valor                                                                                                                                                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tentativas de login por endereço   | Uma rajada de 10, depois mais uma a cada 15 segundos. Um login bem-sucedido não consome uma tentativa.                                                                                                                                                                               |
| Senhas incorretas por conta        | Cada senha errada soma 1 a uma dívida que diminui 1 a cada 6 segundos. Acima de 20, a conta recusa tentativas por 1 segundo, dobrando a cada nova falha até 2 minutos; durante esse tempo, até a senha correta recebe `429`. Um login bem-sucedido ou uma redefinição zera a dívida. |
| Registros por endereço             | 3, depois mais um a cada 20 minutos.                                                                                                                                                                                                                                                 |
| Registros por servidor             | 20, depois mais um a cada 3 minutos.                                                                                                                                                                                                                                                 |
| Solicitações de login em andamento | 16 por processo da API, e o corpo tem 10 segundos para chegar. Mais que isso retorna `503` com o código `busy`.                                                                                                                                                                      |

Uma tentativa recusada retorna `429` com o código `rate_limited`, o motivo `login_attempts`, `registration_attempts` ou `password_attempts`, e `Retry-After` em segundos. Espere esse tempo; não repita em loop. Alterar ou redefinir uma senha tem seu próprio portão e o motivo `password_attempts`. Todos os logins, registros, alterações de senha e alterações de token são gravados na auditoria de segurança (`GET /api/v1/security/audit`, somente administradores), que mantém 365 dias.

## Páginas relacionadas {#related}

- [Visão geral da API HTTP](./index)
- [Erros](./errors)
- [Contas e acesso](../use/accounts)
- [Segurança](../operate/security)
- [Clientes e protocolos](../protocols/index)
- Referência: [Contas e login](./reference/accounts), [Contas de serviço e chaves](./reference/services)
