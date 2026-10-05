---
title: 'Comptes et accès'
description: 'Créez des utilisateurs et des groupes, donnez-leur accès aux dépôts, et émettez des jetons personnels et des clés de service pour la CI.'
---

# Comptes et accès

Arkvory connaît quatre types de justificatifs d’identité. Les personnes se connectent avec un mot de passe. Leurs propres outils utilisent des jetons d’accès personnels. Les systèmes de CI et les agents de déploiement utilisent des clés de service. Le programme d’installation crée une clé supplémentaire, la clé de récupération, pour la configuration et les urgences. Le serveur vérifie chaque requête par rapport au justificatif d’identité qui l’accompagne.

## Qui peut faire quoi {#overview}

| Justificatif d’identité  | Créé par                                       | Durée de vie                        | Administration                                           | Accès au dépôt                                           |
| ------------------------ | ---------------------------------------------- | ----------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| Session par mot de passe | Connexion                                      | 12 heures                           | Utilisateurs et groupes, si le compte est administrateur | Lecture ou écriture par dépôt, via les groupes           |
| Jeton d’accès personnel  | Vous, depuis une session par mot de passe      | 90 jours par défaut, 365 au maximum | Jamais                                                   | Vos groupes, éventuellement en lecture seule             |
| Clé de service           | La clé de récupération ou un opérateur délégué | 90 jours par défaut, 365 au maximum | Uniquement ce que le propriétaire a délégué              | La politique du compte de service, restreinte par la clé |
| Clé de récupération      | Le programme d’installation                    | Jusqu’à ce que vous la remplaciez   | Utilisateurs, groupes, comptes de service, sauvegardes   | Lecture et écriture sur `releases`                       |

Trois choses sont faciles à manquer :

- Un compte administrateur gère les utilisateurs et les groupes. Il ne donne pas accès aux fichiers. Les fichiers ne sont accessibles que par les autorisations de groupe.
- Une clé de service est créée par la clé de récupération ou par une clé d’opérateur, pas par une session par mot de passe. Un administrateur connecté avec un mot de passe ne peut pas créer de comptes de service.
- Un jeton personnel ou une clé de service ne peut jamais créer d’utilisateurs, de groupes ni d’autres jetons.

## Le propriétaire et la clé de récupération {#owner}

Le premier compte est le propriétaire. C’est un administrateur. L’assistant d’installation Windows le crée. Sous Linux et Docker, vous le créez dans la console avec la clé de récupération, comme le décrit [La console web](../guide/console#the-first-owner).

Le propriétaire est membre du groupe `arkvory-owners`, qui a l’accès en écriture au dépôt `releases`. Pour tout autre dépôt, accordez vous-même l’accès à un groupe. Voir [Groupes et accès au dépôt](#groups).

La clé de récupération est le fichier `config/bootstrap-token.txt` dans le répertoire d’installation. Seul un administrateur du serveur peut le lire. Ne la copiez pas dans la CI ni sur des machines clientes. Les outils d’installation et de mise à jour la lisent, donc ne la supprimez pas. Voir [Sécurité](../operate/security).

## Créer des utilisateurs {#users}

Seuls les administrateurs créent des utilisateurs. Un nom compte 3 à 64 lettres, chiffres, `.`, `_` ou `-`. Un mot de passe compte 12 à 128 caractères. Une installation contient au plus 1000 comptes.

Dans la console :

1. Connectez-vous en tant qu’administrateur et ouvrez [[ui:administration]].
2. Développez [[ui:createUser]].
3. Saisissez [[ui:accountName]] et [[ui:password]]. Cochez [[ui:administrator]] uniquement pour les personnes qui gèrent les utilisateurs.
4. Sélectionnez [[ui:createUser]].

Le tableau [[ui:accountsHeading]] liste les comptes. [[ui:disableUser]] bloque un compte : ses sessions prennent fin immédiatement et ses jetons personnels cessent de fonctionner jusqu’à ce que vous sélectionniez [[ui:enableUser]]. Pour définir un nouveau mot de passe pour quelqu’un, développez [[ui:resetPassword]]. Cela met fin aux sessions du compte et révoque tous ses jetons personnels.

Avec l’API, une session d’administrateur ou la clé de récupération appelle ces opérations : `createUser`, `updateUser` et `listUsers`.

```bash
curl -X POST "$ARKVORY/api/v1/users" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"anna","password":"a long password here","administrator":false}'
```

```typescript
await client.administration.users.create('anna', 'a long password here', false);
```

`arkvoryctl` n’a pas de commandes pour les comptes. Utilisez la console ou l’API.

L’auto-inscription est désactivée par défaut. L’administrateur du serveur l’active avec `ARKVORY_ALLOW_REGISTRATION=true` (voir [Variables d’environnement](../reference/environment)). [[ui:signUp]] apparaît alors sur la carte de connexion. Un nouveau compte n’a accès à aucun dépôt tant qu’un administrateur ne l’a pas ajouté à un groupe. L’auto-inscription s’arrête à 900 comptes, ce qui laisse 100 places libres pour les administrateurs.

## Groupes et accès au dépôt {#groups}

Les personnes obtiennent l’accès par les groupes. Un groupe a des membres et, pour chaque dépôt, un niveau d’accès :

| Niveau dans la console | Signification                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [[ui:read]]            | Voir et télécharger                                                                                                                    |
| [[ui:write]]           | Tout ce que permet la lecture, plus le téléversement, la publication, la modification des métadonnées, la promotion et la restauration |

Un dépôt n’a pas d’étape de création distincte. Il existe dès qu’une autorisation ou une politique de service le nomme. Un nom utilise des lettres latines minuscules, des chiffres, `-` et `_`, commence par une lettre ou un chiffre et compte au plus 64 caractères. Voir [Dépôts](./repositories).

Dans la console, ouvrez [[ui:administration]] :

1. Développez [[ui:createGroup]], saisissez un nom [[ui:accessGroup]] (2 à 64 lettres, chiffres, `.`, `_` ou `-`) et sélectionnez [[ui:createGroup]].
2. Développez [[ui:manageMembers]], choisissez le groupe et le compte, puis sélectionnez [[ui:addMember]]. [[ui:removeMember]] retire le compte du groupe.
3. Développez [[ui:manageGrants]], choisissez le groupe, saisissez le nom [[ui:repository]], choisissez le niveau [[ui:access]] et sélectionnez [[ui:saveGrant]]. [[ui:removeGrant]] retire l’accès.

Le tableau sous les formulaires affiche les [[ui:members]] et les [[ui:grants]] de chaque groupe. Le retrait d’un membre ou d’une autorisation prend effet à la prochaine requête du compte. Les fichiers restent où ils sont.

Une installation contient au plus 100 groupes, 10 000 appartenances et 10 000 autorisations au total.

Avec l’API, les opérations sont `createAccessGroup`, `addGroupMember`, `removeGroupMember`, `setGroupGrant` et `removeGroupGrant` :

```bash
curl -X PUT "$ARKVORY/api/v1/access-groups/$GROUP_ID/grants/builds" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"access":"write"}'
```

```typescript
await client.administration.groups.setGrant(groupId, 'builds', 'write');
```

## Autorisations {#permissions}

Derrière les deux niveaux lecture et écriture se trouvent 24 actions de dépôt. Une clé de service nomme ces actions une par une. `arkvoryctl doctor` et `GET /api/v1/auth/permissions` affichent les actions que détient le justificatif d’identité courant, par dépôt.

| Action             | Libellé dans la console            | Elle permet                                                                                 |
| ------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `repository.read`  | [[ui:permission.repository.read]]  | Lister les dépôts et voir vos propres droits. Aucun accès aux fichiers.                     |
| `artifact.list`    | [[ui:permission.artifact.list]]    | Lister et rechercher les artefacts, lire la liste des étapes et le journal des promotions   |
| `artifact.read`    | [[ui:permission.artifact.read]]    | Détails d’un artefact, étapes et historique de promotion d’un artefact                      |
| `content.read`     | [[ui:permission.content.read]]     | Télécharger les octets, créer des liens de téléchargement, résoudre un paquet à télécharger |
| `upload.create`    | [[ui:permission.upload.create]]    | Démarrer un téléversement                                                                   |
| `upload.read`      | [[ui:permission.upload.read]]      | Lire l’état et les parties de votre propre téléversement                                    |
| `upload.write`     | [[ui:permission.upload.write]]     | Envoyer les octets de votre propre téléversement                                            |
| `upload.complete`  | [[ui:permission.upload.complete]]  | Terminer votre propre téléversement, démarrer une tâche de finalisation                     |
| `upload.cancel`    | [[ui:permission.upload.cancel]]    | Annuler votre propre téléversement                                                          |
| `job.read`         | [[ui:permission.job.read]]         | Lire votre propre tâche de finalisation                                                     |
| `package.read`     | [[ui:permission.package.read]]     | Lister les paquets UPack et résoudre une version                                            |
| `package.publish`  | [[ui:permission.package.publish]]  | Enregistrer une archive téléversée comme paquet                                             |
| `asset.read`       | [[ui:permission.asset.read]]       | Lire les chemins de fichiers, leur historique et leurs révisions                            |
| `asset.write`      | [[ui:permission.asset.write]]      | Faire d’un artefact le contenu actuel d’un chemin                                           |
| `asset.restore`    | [[ui:permission.asset.restore]]    | Restaurer une révision antérieure d’un chemin                                               |
| `annotation.read`  | [[ui:permission.annotation.read]]  | Lire les étiquettes, les métadonnées, les collections et les pièces jointes                 |
| `annotation.write` | [[ui:permission.annotation.write]] | Modifier les étiquettes, les métadonnées, les collections et les pièces jointes             |
| `artifact.promote` | [[ui:permission.artifact.promote]] | Ajouter et retirer des étapes, promouvoir dans le dépôt                                     |
| `reference.write`  | [[ui:permission.reference.write]]  | Ajouter et retirer votre propre référence externe sur un artefact                           |
| `audit.read`       | [[ui:permission.audit.read]]       | Lire l’audit du catalogue du dépôt                                                          |
| `artifact.delete`  | [[ui:permission.artifact.delete]]  | Vérifier et supprimer des artefacts, prévisualiser et appliquer la rétention                |
| `storage.read`     | [[ui:permission.storage.read]]     | Lire la politique de stockage, l’utilisation et les paramètres de nettoyage physique        |
| `storage.manage`   | [[ui:permission.storage.manage]]   | Modifier la politique de stockage et les paramètres de nettoyage physique, les exécuter     |
| `diagnostics.read` | [[ui:permission.diagnostics.read]] | Lire les événements de stockage                                                             |

Correspondance entre les niveaux d’un groupe et les actions :

- **Lecture** donne `repository.read`, `artifact.list`, `artifact.read`, `content.read`, `package.read`, `asset.read` et `annotation.read`.
- **Écriture** donne tout ce que permet la lecture, plus `upload.create`, `upload.read`, `upload.write`, `upload.complete`, `upload.cancel`, `job.read`, `package.publish`, `asset.write`, `asset.restore`, `annotation.write`, `artifact.promote`, `reference.write` et `audit.read`.
- **Aucun niveau de groupe ne donne** `artifact.delete`, `storage.read`, `storage.manage` ni `diagnostics.read`. La suppression d’artefacts et la gestion du stockage sont réservées aux clés de service qui nomment ces actions. Voir [Stockage et rétention](../operate/storage).

Un miroir est une copie en lecture seule d’un autre dépôt ([Miroirs](../operate/mirrors)). Toute action qui le modifie est refusée avec `409 mirror_read_only`, quelles que soient les autorisations.

## Mots de passe et sessions {#passwords}

Connectez-vous avec [[ui:accountName]] et [[ui:password]] dans la carte [[ui:connection]]. Une session dure 12 heures. [[ui:disconnect]] y met fin.

Pour changer votre propre mot de passe, utilisez [[ui:changeOwnPassword]] dans la même carte. Saisissez le [[ui:currentPassword]] et le [[ui:newPassword]]. Toutes vos sessions et tous vos jetons personnels prennent fin ; vous vous reconnectez donc et créez de nouveaux jetons. Un administrateur peut réinitialiser le mot de passe d’un autre compte sans connaître l’ancien.

Le serveur ralentit les tentatives :

- Une adresse réseau peut tenter 10 connexions en rafale, puis une de plus toutes les 15 secondes.
- Après de nombreux mots de passe incorrects pour un compte, l’attente de ce compte augmente progressivement, jusqu’à 2 minutes. Même le bon mot de passe est refusé pendant cette attente. La réponse est `429 rate_limited` avec `Retry-After`.
- Derrière un proxy inverse, l’administrateur liste le proxy dans `ARKVORY_TRUSTED_PROXIES`. Sinon, toutes les personnes partagent une même adresse.

Avec l’API, `login` échange un nom et un mot de passe contre une session bearer, et `changeOwnPassword` change le mot de passe :

```bash
curl -X POST "$ARKVORY/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"name":"anna","password":"a long password here"}'
```

## Jetons d’accès personnels {#tokens}

Un jeton d’accès personnel est une clé pour vos propres outils : un script sur votre ordinateur, `arkvoryctl` ou le SDK. Il agit en votre nom, avec les dépôts de vos groupes.

Seule une session par mot de passe crée des jetons. Un jeton ne peut pas créer un autre jeton et n’a aucun droit d’administrateur.

1. Connectez-vous avec votre mot de passe.
2. Dans la carte [[ui:connection]], développez [[ui:personalAccessTokens]].
3. Saisissez un [[ui:tokenName]]. Choisissez [[ui:tokenExpiry]] : [[ui:tokenDays30]], [[ui:tokenDays90]] ou [[ui:tokenDays365]].
4. Choisissez [[ui:tokenScope]] : [[ui:tokenScopeRead]] ou [[ui:tokenScopeReadWrite]]. Un jeton en lecture refuse toute modification avec `403 read_only_token`.
5. Sélectionnez [[ui:generateToken]], puis [[ui:copyToken]]. Le jeton est affiché une seule fois. Il commence par `pat_`.

Le tableau affiche pour chaque jeton [[ui:tokenPrefix]], [[ui:tokenCreated]], [[ui:tokenExpires]], [[ui:tokenLastUsed]] et [[ui:tokenStatus]] : [[ui:tokenActive]], [[ui:tokenExpired]] ou [[ui:tokenRevokedState]]. Pour arrêter un jeton, sélectionnez [[ui:revokeToken]] et confirmez avec [[ui:tokenRevokeConfirmSubmit]]. Les clients qui l’utilisent perdent l’accès immédiatement.

Un compte peut détenir 50 jetons actifs. Un administrateur peut lister et révoquer les jetons de n’importe quel compte avec `listAccountTokens` et `revokeAccountToken`.

Avec l’API, un jeton a un nom et, éventuellement, une expiration (jusqu’à 365 jours à partir de maintenant) et une portée :

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

La portée par défaut de l’API est `read-write`. La console présélectionne [[ui:tokenScopeRead]].

Remettez le jeton à `arkvoryctl` dans un fichier privé. Voir [Ligne de commande](../protocols/cli#connect-to-a-server).

## Comptes de service et clés pour la CI {#service-accounts}

Un compte de service est une identité pour un outil, pas pour une personne. Il a une **politique** : les dépôts et les actions qu’il peut utiliser. Un compte de service a des clés. Une clé a aussi sa propre liste de dépôts et d’actions. Les droits effectifs sont l’intersection des deux listes, action par action. Une politique vide ne donne aucun accès aux fichiers.

Vous gérez l’accès des services avec la clé de récupération, ou avec une clé d’opérateur à laquelle le propriétaire a délégué des droits. Dans la console :

1. Sélectionnez [[ui:disconnect]] si vous êtes connecté. Ouvrez ensuite [[ui:keySignIn]], collez la clé de récupération dans [[ui:serviceKey]] et sélectionnez [[ui:connect]].
2. Ouvrez [[ui:services]]. Cette section n’apparaît que pour la clé de récupération et pour les clés d’opérateur.

### Créer un compte et sa politique {#service-policy}

1. Dans [[ui:services]], développez [[ui:serviceCreate]].
2. Saisissez un [[ui:serviceName]] (3 à 64 lettres, chiffres, `.`, `_` ou `-`).
3. Sous [[ui:servicePolicy]], sélectionnez [[ui:bindingAdd]] et saisissez le nom [[ui:repository]].
4. Remplissez les autorisations : [[ui:bindingRead]] et [[ui:bindingPublish]] définissent des ensembles types, [[ui:bindingNone]] les efface, et [[ui:bindingPermissions]] liste chaque action. Sélectionnez [[ui:bindingRemove]] pour retirer un dépôt.
5. Sélectionnez [[ui:serviceCreate]].

Les deux préréglages sont :

| Préréglage            | Actions                                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [[ui:bindingRead]]    | `repository.read`, `artifact.read`, `artifact.list`, `content.read`, `package.read`, `asset.read`, `annotation.read`                                                             |
| [[ui:bindingPublish]] | L’ensemble de lecture, plus `upload.create`, `upload.read`, `upload.write`, `upload.complete`, `upload.cancel`, `job.read`, `package.publish`, `asset.write`, `annotation.write` |

Aucun des deux préréglages n’inclut la promotion, la restauration ou la suppression. Ajoutez `artifact.promote` pour une tâche de promotion. Un agent de déploiement qui ne fait que télécharger a besoin de l’ensemble de lecture pour `arkvoryctl`. Pour un simple téléchargement HTTP d’un paquet par son nom, `content.read` seul suffit.

Une politique compte au plus 64 dépôts et une installation au plus 1000 comptes de service. Une politique enregistrée a une version. Si quelqu’un la modifie entre-temps, la console signale un conflit et conserve votre brouillon : sélectionnez [[ui:serviceRefresh]] et appliquez votre modification de nouveau. [[ui:serviceDisable]] bloque toutes les clés du compte. Les transferts déjà en cours peuvent se terminer.

### Émettre, enregistrer et activer une clé {#service-key-issue}

1. Ouvrez le compte et ses [[ui:serviceKeys]].
2. Développez [[ui:keyIssue]]. Saisissez un [[ui:keyName]]. Définissez l’expiration dans [[ui:keyExpiry]] ou laissez-la vide pour 90 jours. L’expiration maximale est de 365 jours.
3. Restreignez les autorisations si la clé a besoin de moins que le compte. Sélectionnez [[ui:keyIssue]].
4. La fenêtre [[ui:keySecret]] affiche le secret une seule fois. Sélectionnez [[ui:keyCopy]] et conservez-le dans votre magasin de secrets de CI. Le secret commence par `arkvory_`.
5. Cochez [[ui:keySaved]] et sélectionnez [[ui:keyActivate]].

Une clé non activée est inutile et expire au bout de 15 minutes. Elle apparaît comme [[ui:keyPending]] jusqu’à ce que vous l’activiez. Un compte peut détenir 3 clés actives et 2 clés en attente à la fois. Les états sont [[ui:keyPending]], [[ui:keyActive]], [[ui:keyRevoked]] et [[ui:keyExpired]] ; [[ui:keyDetails]] liste l’identifiant et les autorisations d’une clé.

Si la réponse est perdue avant que vous ne copiiez le secret, le serveur ne peut plus l’afficher. Révoquez la clé et émettez-en une autre.

Avec l’API, la clé de récupération crée le compte, puis émet la clé. L’en-tête `Idempotency-Key` (1 à 128 lettres, chiffres, `.`, `_`, `:` ou `-`) rend une requête répétée sûre, mais une répétition ne renvoie aucun secret. La clé s’active elle-même lorsqu’elle appelle `activateServiceKey` :

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

Les mêmes étapes dans le SDK :

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

Remettez la clé activée à la tâche sous la forme `ARKVORY_TOKEN_FILE` ou `ARKVORY_TOKEN`. Voir l’[exemple de CI](../protocols/cli#ci-example).

### Renouveler et révoquer {#service-key-rotate}

Renouvelez une clé avant son expiration, sans interruption :

1. À côté de la clé, sélectionnez [[ui:keyRotate]]. Le formulaire est prérempli avec les autorisations de l’ancienne clé. Vous ne pouvez que les conserver ou les réduire.
2. Émettez la nouvelle clé, enregistrez son secret et activez-la.
3. Basculez vos tâches vers le nouveau secret.
4. Sélectionnez [[ui:keyRevoke]] sur l’ancienne clé.

L’activation de la nouvelle clé limite l’ancienne à 24 heures supplémentaires au maximum, afin qu’une ancienne clé oubliée ne survive pas. La révocation est définitive et demande le nom de la clé. Les nouvelles requêtes avec la clé sont refusées immédiatement. Les transferts déjà en cours peuvent se terminer. Avec l’API, les opérations sont `rotateServiceKey` et `revokeServiceKey`.

[[ui:serviceAudit]] sur le compte indique qui a émis, activé, renouvelé et révoqué des clés, avec l’heure. Il ne conserve aucun secret. Le serveur conserve les 100 000 derniers événements de tous les comptes.

### Administration déléguée {#delegation}

Au quotidien, n’utilisez pas la clé de récupération. Le propriétaire peut confier une partie de l’administration des services à une **clé d’opérateur** et garder la clé de récupération hors ligne.

1. Avec la clé de récupération, créez un compte de service pour l’opérateur avec une politique vide, puis émettez et activez une clé pour ce compte.
2. Ouvrez [[ui:serviceKeys]] de ce compte et sélectionnez [[ui:delegations]] sur la clé.
3. Développez [[ui:delegationNew]]. Saisissez le [[ui:delegationTarget]], le compte que l’opérateur gérera.
4. Cochez les [[ui:delegationActions]] et définissez le [[ui:delegationCeiling]], le maximum que l’opérateur peut accorder en dépôts.
5. Sélectionnez [[ui:delegationSave]].

Les sept actions sont :

| Action                   | Libellé dans la console                  | L’opérateur peut                         |
| ------------------------ | ---------------------------------------- | ---------------------------------------- |
| `service-account.read`   | [[ui:permission.service-account.read]]   | Voir le compte                           |
| `service-account.manage` | [[ui:permission.service-account.manage]] | L’activer et le désactiver               |
| `policy.read`            | [[ui:permission.policy.read]]            | Lire sa politique                        |
| `policy.manage`          | [[ui:permission.policy.manage]]          | Remplacer sa politique                   |
| `credential.read`        | [[ui:permission.credential.read]]        | Lister ses clés                          |
| `credential.manage`      | [[ui:permission.credential.manage]]      | Émettre, renouveler et révoquer ses clés |
| `service-audit.read`     | [[ui:permission.service-audit.read]]     | Lire son journal d’activité              |

Règles :

- Tout ce que l’opérateur définit doit rester dans le plafond. Une clé qu’il émet expire au plus tard en même temps que sa propre clé.
- Un opérateur peut émettre des clés pour le compte cible ; considérez donc la délégation comme une confiance dans tout ce que le plafond autorise.
- Un opérateur ne peut pas gérer son propre compte et ne peut pas déléguer davantage. Un compte ne peut pas être à la fois cible et opérateur.
- Le retrait d’une délégation avec [[ui:delegationRemove]] ne révoque pas les clés que l’opérateur a déjà activées. Révoquez-les vous-même.
- L’opérateur voit ses propres attributions dans [[ui:delegationOwn]].

Seule la clé de récupération définit les délégations. Les opérations sont `listServiceDelegations`, `setServiceDelegation` et `removeServiceDelegation`.

## Audit {#audit}

Les administrateurs peuvent lire le journal de sécurité de l’installation : connexions et échecs, inscriptions, changements et réinitialisations de mots de passe, modifications d’utilisateurs, de groupes et d’autorisations, ainsi que la création et la révocation de jetons. Chaque entrée contient l’heure, l’acteur, le type de justificatif d’identité, l’adresse du client, la cible et le résultat (`success`, `failure` ou `denied`). Il ne contient ni mots de passe ni secrets. Le serveur conserve les entrées pendant 365 jours ou 1 000 000 d’entrées, selon ce qui survient en premier.

La console n’a pas d’écran pour ce journal. Lisez-le avec l’API, avec une session d’administrateur ou la clé de récupération. Les pages contiennent 50 entrées par défaut et 100 au plus, de la plus récente à la plus ancienne. Passez `next` comme `after` pour la page suivante.

```bash
curl -H "Authorization: Bearer $ADMIN_KEY" "$ARKVORY/api/v1/security/audit?limit=20"
```

```typescript
const page = await client.administration.security.audit({ limit: 20 });
```

Le journal d’activité d’un compte de service est distinct. Voir [Émettre, enregistrer et activer une clé](#service-key-issue).

## Si le propriétaire est bloqué {#recovery}

Quand personne ne peut se connecter en tant qu’administrateur, utilisez la clé de récupération :

1. Lisez la clé sur le serveur : `config/bootstrap-token.txt` dans le répertoire d’installation. Seul un administrateur du serveur peut le faire.
2. Dans la console, ouvrez [[ui:keySignIn]], collez la clé dans [[ui:serviceKey]] et sélectionnez [[ui:connect]].
3. Ouvrez [[ui:administration]]. Développez [[ui:resetPassword]], choisissez le compte, saisissez un [[ui:newPassword]] et sélectionnez [[ui:resetPassword]]. Si le compte apparaît comme désactivé, sélectionnez [[ui:enableUser]].
4. Connectez-vous avec le nouveau mot de passe.

Vous pouvez aussi créer un nouvel administrateur avec [[ui:createUser]] et cocher [[ui:administrator]].

Le formulaire [[ui:welcomeOwner]] ne fonctionne que tant que l’installation n’a aucun compte. Ensuite, utilisez la clé de récupération pour réparer les comptes, pas pour repartir de zéro.

Si la clé de récupération elle-même est perdue, l’administrateur du serveur remplace son SHA-256 dans `config/keys.json` et redémarre l’API. Voir [Sécurité](../operate/security).

## Pages associées {#related-pages}

- [La console web](../guide/console)
- [Dépôts](./repositories)
- [Ligne de commande (arkvoryctl)](../protocols/cli)
- [Authentification](../api/authentication) et la référence de l’API : [Comptes et connexion](../api/reference/accounts), [Comptes de service et clés](../api/reference/services)
- [Sécurité](../operate/security)
