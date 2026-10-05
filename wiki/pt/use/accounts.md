---
title: Contas e acesso
description: Crie usuários e grupos, dê-lhes acesso a repositórios e emita tokens pessoais e chaves de serviço para o CI.
---

# Contas e acesso

O Arkvory conhece quatro tipos de credenciais. Pessoas entram com uma senha. Suas próprias ferramentas usam tokens de acesso pessoal. Sistemas de CI e agentes de implantação usam chaves de serviço. O instalador cria mais uma chave, a chave de recuperação, para configuração e emergências. O servidor verifica cada solicitação em relação à credencial com que ela veio.

## Quem pode fazer o quê {#overview}

| Credencial              | Criada por                                     | Validade                          | Administração                                    | Acesso ao repositório                                  |
| ----------------------- | ---------------------------------------------- | --------------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| Sessão por senha        | Entrar                                         | 12 horas                          | Usuários e grupos, se a conta for administradora | Leitura ou escrita por repositório, por grupos         |
| Token de acesso pessoal | Você, a partir de uma sessão por senha         | 90 dias por padrão, no máximo 365 | Nunca                                            | Seus grupos, opcionalmente somente leitura             |
| Chave de serviço        | A chave de recuperação ou um operador delegado | 90 dias por padrão, no máximo 365 | Somente o que o proprietário delegou             | A política da conta de serviço, restringida pela chave |
| Chave de recuperação    | O instalador                                   | Até você substituí-la             | Usuários, grupos, contas de serviço, backups     | Leitura e escrita em `releases`                        |

Três coisas são fáceis de esquecer:

- Uma conta de administrador gerencia usuários e grupos. Ela não dá acesso a arquivos. Os arquivos são alcançados somente por meio de concessões de grupo.
- Uma chave de serviço é criada pela chave de recuperação ou por uma chave de operador, não por uma sessão por senha. Um administrador que entrou com uma senha não pode criar contas de serviço.
- Um token pessoal ou uma chave de serviço nunca pode criar usuários, grupos ou outros tokens.

## O proprietário e a chave de recuperação {#owner}

A primeira conta é o proprietário. É um administrador. O assistente de configuração do Windows a cria. No Linux e no Docker, você a cria no console com a chave de recuperação, como descreve [O console web](../guide/console#the-first-owner).

O proprietário é membro do grupo `arkvory-owners`, que tem acesso de escrita ao repositório `releases`. Para qualquer outro repositório, conceda acesso a um grupo você mesmo. Consulte [Grupos e acesso a repositórios](#groups).

A chave de recuperação é o arquivo `config/bootstrap-token.txt` no diretório de instalação. Somente um administrador do servidor pode lê-lo. Não o copie para o CI nem para máquinas de clientes. As ferramentas de instalação e atualização o leem, então não o exclua. Consulte [Segurança](../operate/security).

## Criar usuários {#users}

Somente administradores criam usuários. Um nome tem de 3 a 64 letras, dígitos, `.`, `_` ou `-`. Uma senha tem de 12 a 128 caracteres. Uma instalação contém no máximo 1000 contas.

No console:

1. Entre como administrador e abra [[ui:administration]].
2. Expanda [[ui:createUser]].
3. Informe [[ui:accountName]] e [[ui:password]]. Marque [[ui:administrator]] apenas para pessoas que gerenciam usuários.
4. Selecione [[ui:createUser]].

A tabela [[ui:accountsHeading]] lista as contas. [[ui:disableUser]] bloqueia uma conta: suas sessões terminam imediatamente e seus tokens pessoais param de funcionar até você selecionar [[ui:enableUser]]. Para definir uma nova senha para alguém, expanda [[ui:resetPassword]]. Isso encerra as sessões da conta e revoga todos os seus tokens pessoais.

Com a API, uma sessão de administrador ou a chave de recuperação chama estas operações: `createUser`, `updateUser` e `listUsers`.

```bash
curl -X POST "$ARKVORY/api/v1/users" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"anna","password":"a long password here","administrator":false}'
```

```typescript
await client.administration.users.create('anna', 'a long password here', false);
```

`arkvoryctl` não tem comandos para contas. Use o console ou a API.

O autocadastro fica desativado por padrão. O administrador do servidor o ativa com `ARKVORY_ALLOW_REGISTRATION=true` (consulte [Variáveis de ambiente](../reference/environment)). Então [[ui:signUp]] aparece no cartão de entrada. Uma nova conta não tem acesso a nenhum repositório até que um administrador a adicione a um grupo. O autocadastro para em 900 contas, então 100 lugares ficam livres para administradores.

## Grupos e acesso a repositórios {#groups}

As pessoas obtêm acesso por meio de grupos. Um grupo tem membros e, para cada repositório, um nível de acesso:

| Nível no console | Significado                                                                  |
| ---------------- | ---------------------------------------------------------------------------- |
| [[ui:read]]      | Ver e baixar                                                                 |
| [[ui:write]]     | Tudo de leitura, e enviar, publicar, alterar metadados, promover e restaurar |

Um repositório não tem uma etapa separada de criação. Ele existe assim que uma concessão ou uma política de serviço o nomeia. Um nome usa letras latinas minúsculas, dígitos, `-` e `_`, começa com uma letra ou um dígito e tem no máximo 64 caracteres. Consulte [Repositórios](./repositories).

No console, abra [[ui:administration]]:

1. Expanda [[ui:createGroup]], informe um nome em [[ui:accessGroup]] (de 2 a 64 letras, dígitos, `.`, `_` ou `-`) e selecione [[ui:createGroup]].
2. Expanda [[ui:manageMembers]], escolha o grupo e a conta e selecione [[ui:addMember]]. [[ui:removeMember]] tira a conta do grupo.
3. Expanda [[ui:manageGrants]], escolha o grupo, digite o nome em [[ui:repository]], escolha o nível em [[ui:access]] e selecione [[ui:saveGrant]]. [[ui:removeGrant]] remove o acesso.

A tabela abaixo dos formulários mostra os [[ui:members]] e as [[ui:grants]] de cada grupo. Remover um membro ou uma concessão tem efeito na próxima solicitação da conta. Os arquivos permanecem onde estão.

Uma instalação contém no máximo 100 grupos, 10 000 associações e 10 000 concessões no total.

Com a API, as operações são `createAccessGroup`, `addGroupMember`, `removeGroupMember`, `setGroupGrant` e `removeGroupGrant`:

```bash
curl -X PUT "$ARKVORY/api/v1/access-groups/$GROUP_ID/grants/builds" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"access":"write"}'
```

```typescript
await client.administration.groups.setGrant(groupId, 'builds', 'write');
```

## Permissões {#permissions}

Por trás dos dois níveis leitura e escrita há 24 ações de repositório. Uma chave de serviço nomeia essas ações uma a uma. `arkvoryctl doctor` e `GET /api/v1/auth/permissions` mostram as ações que a credencial atual possui, por repositório.

| Ação               | Rótulo no console                  | Permite                                                                        |
| ------------------ | ---------------------------------- | ------------------------------------------------------------------------------ |
| `repository.read`  | [[ui:permission.repository.read]]  | Listar repositórios e ver seus próprios direitos. Sem acesso a arquivos.       |
| `artifact.list`    | [[ui:permission.artifact.list]]    | Listar e pesquisar artefatos, ler a lista de estágios e o diário de promoção   |
| `artifact.read`    | [[ui:permission.artifact.read]]    | Detalhes do artefato, estágios e histórico de promoção de um artefato          |
| `content.read`     | [[ui:permission.content.read]]     | Baixar bytes, criar links de download, resolver um pacote para download        |
| `upload.create`    | [[ui:permission.upload.create]]    | Iniciar um upload                                                              |
| `upload.read`      | [[ui:permission.upload.read]]      | Ler o estado e as partes do seu próprio upload                                 |
| `upload.write`     | [[ui:permission.upload.write]]     | Enviar os bytes do seu próprio upload                                          |
| `upload.complete`  | [[ui:permission.upload.complete]]  | Concluir seu próprio upload, iniciar uma tarefa de conclusão                   |
| `upload.cancel`    | [[ui:permission.upload.cancel]]    | Cancelar seu próprio upload                                                    |
| `job.read`         | [[ui:permission.job.read]]         | Ler sua própria tarefa de conclusão                                            |
| `package.read`     | [[ui:permission.package.read]]     | Listar pacotes UPack e resolver uma versão                                     |
| `package.publish`  | [[ui:permission.package.publish]]  | Registrar um arquivo enviado como pacote                                       |
| `asset.read`       | [[ui:permission.asset.read]]       | Ler caminhos de arquivo, seu histórico e suas revisões                         |
| `asset.write`      | [[ui:permission.asset.write]]      | Tornar um artefato o conteúdo atual de um caminho                              |
| `asset.restore`    | [[ui:permission.asset.restore]]    | Restaurar uma revisão anterior de um caminho                                   |
| `annotation.read`  | [[ui:permission.annotation.read]]  | Ler rótulos, metadados, coleções e anexos                                      |
| `annotation.write` | [[ui:permission.annotation.write]] | Alterar rótulos, metadados, coleções e anexos                                  |
| `artifact.promote` | [[ui:permission.artifact.promote]] | Adicionar e remover estágios, promover para o repositório                      |
| `reference.write`  | [[ui:permission.reference.write]]  | Adicionar e remover sua própria referência externa em um artefato              |
| `audit.read`       | [[ui:permission.audit.read]]       | Ler a auditoria do catálogo do repositório                                     |
| `artifact.delete`  | [[ui:permission.artifact.delete]]  | Verificar e excluir artefatos, pré-visualizar e aplicar retenção               |
| `storage.read`     | [[ui:permission.storage.read]]     | Ler a política de armazenamento, o uso e as configurações de limpeza           |
| `storage.manage`   | [[ui:permission.storage.manage]]   | Alterar a política de armazenamento e as configurações de limpeza, executá-las |
| `diagnostics.read` | [[ui:permission.diagnostics.read]] | Ler eventos de armazenamento                                                   |

Como os níveis de um grupo mapeiam para ações:

- **Leitura** concede `repository.read`, `artifact.list`, `artifact.read`, `content.read`, `package.read`, `asset.read` e `annotation.read`.
- **Escrita** concede tudo de leitura, e `upload.create`, `upload.read`, `upload.write`, `upload.complete`, `upload.cancel`, `job.read`, `package.publish`, `asset.write`, `asset.restore`, `annotation.write`, `artifact.promote`, `reference.write` e `audit.read`.
- **Nenhum nível de grupo concede** `artifact.delete`, `storage.read`, `storage.manage` e `diagnostics.read`. Excluir artefatos e gerenciar armazenamento são para chaves de serviço que nomeiam essas ações. Consulte [Armazenamento e retenção](../operate/storage).

Um espelho é uma cópia somente leitura de outro repositório ([Espelhos](../operate/mirrors)). Toda ação que o altera é recusada com `409 mirror_read_only`, independentemente do que as concessões digam.

## Senhas e sessões {#passwords}

Entre com [[ui:accountName]] e [[ui:password]] no cartão [[ui:connection]]. Uma sessão dura 12 horas. [[ui:disconnect]] a encerra.

Para alterar sua própria senha, use [[ui:changeOwnPassword]] no mesmo cartão. Informe a [[ui:currentPassword]] e a [[ui:newPassword]]. Todas as suas sessões e tokens pessoais terminam, então você entra novamente e cria novos tokens. Um administrador pode redefinir a senha de outra conta sem saber a antiga.

O servidor retarda a adivinhação:

- Um endereço de rede pode tentar 10 entradas em uma rajada e depois mais uma a cada 15 segundos.
- Após muitas senhas erradas para uma conta, a conta espera cada vez mais, até 2 minutos. Mesmo a senha correta é recusada durante essa espera. A resposta é `429 rate_limited` com `Retry-After`.
- Atrás de um proxy reverso, o administrador lista o proxy em `ARKVORY_TRUSTED_PROXIES`. Caso contrário, todas as pessoas compartilham um mesmo endereço.

Com a API, `login` troca um nome e uma senha por uma sessão bearer, e `changeOwnPassword` altera a senha:

```bash
curl -X POST "$ARKVORY/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"name":"anna","password":"a long password here"}'
```

## Tokens de acesso pessoal {#tokens}

Um token de acesso pessoal é uma chave para suas próprias ferramentas: um script no seu computador, o `arkvoryctl` ou o SDK. Ele age como você, com os repositórios dos seus grupos.

Somente uma sessão por senha cria tokens. Um token não pode criar outro token e não tem direitos de administrador.

1. Entre com sua senha.
2. No cartão [[ui:connection]], expanda [[ui:personalAccessTokens]].
3. Informe um [[ui:tokenName]]. Escolha [[ui:tokenExpiry]]: [[ui:tokenDays30]], [[ui:tokenDays90]] ou [[ui:tokenDays365]].
4. Escolha [[ui:tokenScope]]: [[ui:tokenScopeRead]] ou [[ui:tokenScopeReadWrite]]. Um token de leitura recusa toda alteração com `403 read_only_token`.
5. Selecione [[ui:generateToken]] e depois [[ui:copyToken]]. O token é mostrado uma vez. Ele começa com `pat_`.

A tabela mostra o [[ui:tokenPrefix]], o [[ui:tokenCreated]], o [[ui:tokenExpires]], o [[ui:tokenLastUsed]] e o [[ui:tokenStatus]] de cada token: [[ui:tokenActive]], [[ui:tokenExpired]] ou [[ui:tokenRevokedState]]. Para interromper um token, selecione [[ui:revokeToken]] e confirme com [[ui:tokenRevokeConfirmSubmit]]. Os clientes que o usam perdem o acesso imediatamente.

Uma conta pode conter 50 tokens ativos. Um administrador pode listar e revogar os tokens de qualquer conta com `listAccountTokens` e `revokeAccountToken`.

Com a API, um token tem um nome e, opcionalmente, uma validade (de até 365 dias a partir de agora) e um escopo:

```bash
curl -X POST "$ARKVORY/api/v1/auth/tokens" \
  -H "Authorization: Bearer $SESSION" \
  -H "Content-Type: application/json" \
  -d '{"name":"laptop","scope":"read-write","expiresAt":"2027-01-31T00:00:00Z"}'
```

```typescript
const created = await client.identity.createToken('laptop', { scope: 'read-write' });
console.log(created.token); // shown once
```

O escopo padrão da API é `read-write`. O console pré-seleciona [[ui:tokenScopeRead]].

Forneça o token ao `arkvoryctl` em um arquivo privado. Consulte [Linha de comando](../protocols/cli#connect-to-a-server).

## Contas de serviço e chaves para CI {#service-accounts}

Uma conta de serviço é uma identidade para uma ferramenta, não para uma pessoa. Ela tem uma **política**: os repositórios e as ações que pode usar. Uma conta de serviço tem chaves. Uma chave também tem sua própria lista de repositórios e ações. Os direitos efetivos são a interseção das duas listas, ação por ação. Uma política vazia não dá acesso a arquivos.

Você gerencia o acesso de serviço com a chave de recuperação ou com uma chave de operador à qual o proprietário delegou direitos. No console:

1. Selecione [[ui:disconnect]] se você estiver conectado. Depois abra [[ui:keySignIn]], cole a chave de recuperação em [[ui:serviceKey]] e selecione [[ui:connect]].
2. Abra [[ui:services]]. A seção aparece somente para a chave de recuperação e para chaves de operador.

### Criar uma conta e sua política {#service-policy}

1. Em [[ui:services]], expanda [[ui:serviceCreate]].
2. Informe um [[ui:serviceName]] (de 3 a 64 letras, dígitos, `.`, `_` ou `-`).
3. Em [[ui:servicePolicy]], selecione [[ui:bindingAdd]] e digite o nome em [[ui:repository]].
4. Preencha as permissões: [[ui:bindingRead]] e [[ui:bindingPublish]] definem conjuntos típicos, [[ui:bindingNone]] os limpa, e [[ui:bindingPermissions]] lista todas as ações. Selecione [[ui:bindingRemove]] para remover um repositório.
5. Selecione [[ui:serviceCreate]].

Os dois predefinidos são:

| Predefinido           | Ações                                                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [[ui:bindingRead]]    | `repository.read`, `artifact.read`, `artifact.list`, `content.read`, `package.read`, `asset.read`, `annotation.read`                                                          |
| [[ui:bindingPublish]] | O conjunto de leitura, e `upload.create`, `upload.read`, `upload.write`, `upload.complete`, `upload.cancel`, `job.read`, `package.publish`, `asset.write`, `annotation.write` |

Nenhum predefinido inclui promoção, restauração ou exclusão. Adicione `artifact.promote` para uma tarefa de promoção. Um agente de implantação que apenas baixa precisa do conjunto de leitura para o `arkvoryctl`. Para um download HTTP simples de um pacote por nome, só `content.read` é suficiente.

Uma política tem no máximo 64 repositórios e uma instalação no máximo 1000 contas de serviço. Uma política salva tem uma versão. Se alguém a alterar nesse meio-tempo, o console mostra um conflito e mantém seu rascunho: selecione [[ui:serviceRefresh]] e aplique sua alteração novamente. [[ui:serviceDisable]] bloqueia todas as chaves da conta. Transferências que já estão em execução podem terminar.

### Emitir, salvar e ativar uma chave {#service-key-issue}

1. Abra a conta e suas [[ui:serviceKeys]].
2. Expanda [[ui:keyIssue]]. Informe um [[ui:keyName]]. Defina a validade em [[ui:keyExpiry]] ou deixe em branco para 90 dias. A validade mais longa é de 365 dias.
3. Restrinja as permissões se a chave precisar de menos que a conta. Selecione [[ui:keyIssue]].
4. A janela [[ui:keySecret]] mostra o segredo uma vez. Selecione [[ui:keyCopy]] e guarde-o no seu armazenamento de segredos de CI. O segredo começa com `arkvory_`.
5. Marque [[ui:keySaved]] e selecione [[ui:keyActivate]].

Uma chave que não é ativada é inútil e expira após 15 minutos. Ela aparece como [[ui:keyPending]] até você ativá-la. Uma conta pode conter 3 chaves ativas e 2 chaves pendentes ao mesmo tempo. Os estados são [[ui:keyPending]], [[ui:keyActive]], [[ui:keyRevoked]] e [[ui:keyExpired]]; [[ui:keyDetails]] lista o id e as permissões de uma chave.

Se a resposta se perder antes de você copiar o segredo, o servidor não poderá mostrá-lo novamente. Revogue a chave e emita outra.

Com a API, a chave de recuperação cria a conta e depois emite a chave. O cabeçalho `Idempotency-Key` (de 1 a 128 letras, dígitos, `.`, `_`, `:` ou `-`) torna uma solicitação repetida segura, mas uma repetição não retorna segredo. A chave se ativa quando chama `activateServiceKey`:

```bash
curl -X POST "$ARKVORY/api/v1/service-accounts" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" \
  -d '{"name":"ci-prod","bindings":[{"resource":{"kind":"repository","id":"releases"},"actions":["repository.read","artifact.read","artifact.list","content.read","package.read","upload.create","upload.read","upload.write","upload.complete","job.read","package.publish","asset.read","asset.write"]}]}'

curl -X POST "$ARKVORY/api/v1/service-accounts/$ACCOUNT_ID/keys" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: ci-prod-2026-10" \
  -d '{"name":"pipeline-2026","bindings":[{"resource":{"kind":"repository","id":"releases"},"actions":["content.read","package.read","artifact.read"]}]}'

curl -X POST "$ARKVORY/api/v1/auth/activate-key" -H "Authorization: Bearer $NEW_SECRET"
```

As mesmas etapas no SDK:

```typescript
const account = await root.administration.services.create('ci-prod', bindings);
const issued = await root.administration.credentials.issue(account.id, requestId, {
  name: 'pipeline-2026',
  bindings,
});
if (!issued.secret) throw new Error('Lost response: revoke the key and issue another');
await saveToSecretStore(issued.secret);
await new ArkvoryClient(url, () => issued.secret ?? '').identity.activateKey();
```

Forneça a chave ativada à tarefa como `ARKVORY_TOKEN_FILE` ou `ARKVORY_TOKEN`. Consulte o [exemplo de CI](../protocols/cli#ci-example).

### Rotacionar e revogar {#service-key-rotate}

Rotacione uma chave antes que ela expire, sem lacuna:

1. Ao lado da chave, selecione [[ui:keyRotate]]. O formulário é preenchido com as permissões da chave antiga. Você só pode mantê-las ou reduzi-las.
2. Emita a nova chave, salve seu segredo e ative-a.
3. Migre suas tarefas para o novo segredo.
4. Selecione [[ui:keyRevoke]] na chave antiga.

Ativar a nova chave limita a antiga a no máximo mais 24 horas, então uma chave antiga esquecida não continua viva. Revogar é permanente e pede o nome da chave. Novas solicitações com a chave são recusadas imediatamente. Transferências que já estão em execução podem terminar. Com a API, as operações são `rotateServiceKey` e `revokeServiceKey`.

[[ui:serviceAudit]] na conta mostra quem emitiu, ativou, rotacionou e revogou chaves, com o horário. Ele não guarda segredos. O servidor mantém os últimos 100 000 eventos de todas as contas.

### Administração delegada {#delegation}

No dia a dia, não use a chave de recuperação. O proprietário pode entregar partes da administração de serviço a uma **chave de operador** e manter a chave de recuperação offline.

1. Com a chave de recuperação, crie uma conta de serviço para o operador com uma política vazia e emita e ative uma chave para ela.
2. Abra [[ui:serviceKeys]] dessa conta e selecione [[ui:delegations]] na chave.
3. Expanda [[ui:delegationNew]]. Informe o [[ui:delegationTarget]], a conta que o operador gerenciará.
4. Marque as [[ui:delegationActions]] e defina o [[ui:delegationCeiling]], o máximo que o operador pode conceder em repositórios.
5. Selecione [[ui:delegationSave]].

As sete ações são:

| Ação                     | Rótulo no console                        | O operador pode                          |
| ------------------------ | ---------------------------------------- | ---------------------------------------- |
| `service-account.read`   | [[ui:permission.service-account.read]]   | Ver a conta                              |
| `service-account.manage` | [[ui:permission.service-account.manage]] | Ativá-la e desativá-la                   |
| `policy.read`            | [[ui:permission.policy.read]]            | Ler sua política                         |
| `policy.manage`          | [[ui:permission.policy.manage]]          | Substituir sua política                  |
| `credential.read`        | [[ui:permission.credential.read]]        | Listar suas chaves                       |
| `credential.manage`      | [[ui:permission.credential.manage]]      | Emitir, rotacionar e revogar suas chaves |
| `service-audit.read`     | [[ui:permission.service-audit.read]]     | Ler seu registro de atividade            |

Regras:

- Tudo o que o operador define deve permanecer dentro do teto. Uma chave que ele emite expira no máximo junto com sua própria chave.
- Um operador pode emitir chaves para a conta alvo, então trate a delegação como confiança em tudo o que o teto permite.
- Um operador não pode gerenciar sua própria conta e não pode delegar mais adiante. Uma conta não pode ser ao mesmo tempo alvo e operador.
- Remover uma delegação com [[ui:delegationRemove]] não revoga as chaves que o operador já ativou. Revogue-as você mesmo.
- O operador vê suas próprias atribuições em [[ui:delegationOwn]].

Somente a chave de recuperação define delegações. As operações são `listServiceDelegations`, `setServiceDelegation` e `removeServiceDelegation`.

## Auditoria {#audit}

Administradores podem ler o diário de segurança da instalação: entradas e falhas, registros, alterações e redefinições de senha, alterações de usuário, grupo e concessão, e criação e revogação de tokens. Cada entrada tem o horário, o autor, o tipo de credencial, o endereço do cliente, o alvo e o resultado (`success`, `failure` ou `denied`). Ela não contém senhas nem segredos. O servidor mantém as entradas por 365 dias ou 1 000 000 de entradas, o que ocorrer primeiro.

O console não tem tela para esse diário. Leia-o com a API, com uma sessão de administrador ou a chave de recuperação. As páginas contêm 50 entradas por padrão e no máximo 100, as mais recentes primeiro. Passe `next` como `after` para a próxima página.

```bash
curl -H "Authorization: Bearer $ADMIN_KEY" "$ARKVORY/api/v1/security/audit?limit=20"
```

```typescript
const page = await client.administration.security.audit({ limit: 20 });
```

O registro de atividade de uma conta de serviço é separado. Consulte [Emitir, salvar e ativar uma chave](#service-key-issue).

## Se o proprietário ficar bloqueado {#recovery}

Quando ninguém consegue entrar como administrador, use a chave de recuperação:

1. Leia a chave no servidor: `config/bootstrap-token.txt` no diretório de instalação. Somente um administrador do servidor pode fazer isso.
2. No console, abra [[ui:keySignIn]], cole a chave em [[ui:serviceKey]] e selecione [[ui:connect]].
3. Abra [[ui:administration]]. Expanda [[ui:resetPassword]], escolha a conta, informe uma [[ui:newPassword]] e selecione [[ui:resetPassword]]. Se a conta aparecer como desativada, selecione [[ui:enableUser]].
4. Entre com a nova senha.

Você também pode criar um novo administrador com [[ui:createUser]] e marcar [[ui:administrator]].

O formulário [[ui:welcomeOwner]] funciona somente enquanto a instalação não tem contas. Depois, use a chave de recuperação para reparar contas, não para começar de novo.

Se a própria chave de recuperação for perdida, o administrador do servidor substitui o SHA-256 da chave em `config/keys.json` e reinicia a API. Consulte [Segurança](../operate/security).

## Páginas relacionadas {#related-pages}

- [O console web](../guide/console)
- [Repositórios](./repositories)
- [Linha de comando (arkvoryctl)](../protocols/cli)
- [Autenticação](../api/authentication) e a referência da API: [Contas e login](../api/reference/accounts), [Contas de serviço e chaves](../api/reference/services)
- [Segurança](../operate/security)
