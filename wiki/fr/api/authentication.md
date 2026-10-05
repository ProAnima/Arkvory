---
title: Authentification
description: Toutes les façons de s’authentifier auprès de l’API HTTP d’Arkvory, ce que chaque identifiant peut faire, et comment fonctionnent les règles d’accès et les actions de dépôt.
---

# Authentification

Chaque appel à `/api/v1` exige un identifiant, hormis les contrôles de santé publics, les options de connexion, la connexion et l’inscription. Cette page liste les types d’identifiants, comment obtenir et envoyer chacun d’eux, et ce que signifient les règles d’accès de la [référence de l’API](./index#reference-pages). Pour les règles des personnes qui gèrent l’accès, voir [Comptes et accès](../use/accounts).

## Les identifiants en un coup d’œil {#credentials}

| Identifiant             | Aspect                   | Comment l’obtenir                                                     | Durée de vie                        | Utilisation                                                                  |
| ----------------------- | ------------------------ | --------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| Session de console      | `dps_…`                  | En se connectant avec un nom et un mot de passe                       | 12 heures                           | Une personne dans la console, ou un script qui se connecte                   |
| Jeton d’accès personnel | `pat_…`                  | En le créant depuis une session                                       | 90 jours par défaut, 365 au maximum | Les scripts et outils d’une personne                                         |
| Clé de service          | `arkvory_…`              | En l’émettant pour un compte de service, puis en l’activant           | 90 jours par défaut, 365 au maximum | CI/CD, agents de déploiement, autres systèmes                                |
| Clé de récupération     | 64 chiffres hexadécimaux | Le programme d’installation l’écrit dans `config/bootstrap-token.txt` | N’expire pas                        | Créer le propriétaire, administrer les comptes de service, récupérer l’accès |
| Lien de téléchargement  | `dtl_…`                  | En le créant pour un artefact                                         | De 60 secondes à 24 heures          | Donner un artefact à quelqu’un sans clé                                      |

Utilisez une clé de service pour l’automatisation et un jeton d’accès personnel pour les outils d’une personne. N’utilisez pas la clé de récupération pour le travail quotidien.

## Formats d’en-tête {#headers}

`/api/v1` accepte un identifiant dans un seul en-tête :

```http
Authorization: Bearer <credential>
```

- Un identifiant comporte de 32 à 512 caractères. Toute autre valeur est `credential_invalid` immédiatement.
- Le registre de conteneurs (`/v2`), Git LFS (`/lfs`) et le registre npm (`/npm`) acceptent aussi HTTP Basic, car `docker login`, git et npm envoient les identifiants de cette façon. Le nom d’utilisateur n’est pas vérifié ; le mot de passe est l’identifiant. Voir [Clients et protocoles](../protocols/index#credentials).
- Un lien de téléchargement se place dans la chaîne de requête, sous la forme `?token=dtl_…`, et ne fonctionne que sur la route de contenu d’un artefact. Voir [Liens de téléchargement](#download-links). Un en-tête `Authorization` l’emporte toujours sur la requête.
- Une requête sans identifiant valide reçoit `401` avec `WWW-Authenticate: Bearer` et une raison : `credential_missing`, `credential_invalid`, `session_expired` ou `token_expired`. Seul le détenteur du secret exact d’un identifiant expiré apprend qu’il a expiré.
- **Pas de cookies.** Arkvory n’en pose aucun et n’en lit aucun : un navigateur n’attache donc jamais d’identifiant de lui-même, et il n’y a pas de falsification de requête intersite à contrer. Un script envoie l’en-tête à chaque appel. La console garde son jeton de session dans la mémoire de l’onglet du navigateur et l’oublie lorsque vous fermez l’onglet.
- **Autres origines.** Une page à la même adresse qu’Arkvory n’a besoin de rien. Une page à une autre adresse est refusée avec `403` et la raison `origin_not_allowed`, sauf si l’administrateur a listé son origine dans `ARKVORY_CORS_ORIGINS`, même avec un identifiant valide. Utilisez HTTPS : un identifiant en HTTP en clair est lisible sur le réseau. Voir [HTTPS](../install/https).

Vérifiez ce qu’est un identifiant et ce qu’il peut faire :

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_KEY" "$ARKVORY_URL/api/v1/auth/me"
curl -fsS -H "Authorization: Bearer $ARKVORY_KEY" "$ARKVORY_URL/api/v1/auth/permissions"
```

## Sessions de connexion à la console {#sessions}

Une personne se connecte avec un nom et un mot de passe et reçoit une session. La console le fait pour vous ; un script peut faire de même.

1. Placez le nom et le mot de passe dans un fichier privé, `login.json`, afin qu’ils n’apparaissent jamais dans une ligne de commande ou une liste de processus :

   ```json
   { "name": "alice", "password": "a long password of 12 to 128 characters" }
   ```

2. Appelez `login` :

   ```bash
   curl -fsS -X POST "$ARKVORY_URL/api/v1/auth/login" \
     -H "Content-Type: application/json" -d @login.json
   ```

3. La réponse contient le jeton de session et son heure de fin :

   ```json
   {
     "token": "dps_…",
     "expiresAt": "2026-10-05T21:30:00.000Z",
     "account": { "id": "…", "name": "alice", "administrator": false, "enabled": true }
   }
   ```

4. Envoyez le jeton comme `Authorization: Bearer dps_…`.

Règles d’une session :

- Elle dure 12 heures et ne se prolonge pas. Ensuite, chaque appel renvoie `401` avec la raison `session_expired`. Reconnectez-vous.
- Un compte a au plus 32 sessions. Une nouvelle connexion met fin aux plus anciennes au-delà de cette limite.
- `POST /api/v1/auth/logout` met fin à la session. Changer votre mot de passe, ou le réinitialiser par un administrateur, met fin à toutes les sessions et à tous les jetons personnels du compte. Désactiver le compte les arrête.
- Une session porte toute l’autorité du compte, y compris l’indicateur d’administrateur. Seule une session peut créer et révoquer des jetons personnels et changer le mot de passe du compte lui-même.
- Les noms sont comparés sans tenir compte de la casse. Un nom erroné, un mot de passe erroné et un compte désactivé donnent le même `401` avec la raison `invalid_credentials`.
- Une passerelle de lecture ne connecte personne ; utilisez le processus d’écriture.

### Inscription autonome {#self-registration}

`GET /api/v1/auth/options` est public et indique si les personnes peuvent créer leurs propres comptes. L’inscription autonome est désactivée sauf si l’administrateur définit `ARKVORY_ALLOW_REGISTRATION=true` ; `POST /api/v1/auth/register` avec le même corps que la connexion crée alors un compte ordinaire (pas un administrateur, sans accès à aucun dépôt) et renvoie une session avec `201`. Sinon, elle répond `403` avec la raison `registration_disabled`. L’inscription autonome s’arrête à 900 comptes, afin que les administrateurs puissent encore créer des comptes jusqu’à la limite de 1 000.

## Jetons d’accès personnels {#personal-tokens}

Un jeton d’accès personnel permet à un script d’agir en votre nom sans votre mot de passe. Seule une session connectée peut en créer un.

```bash
curl -fsS -X POST "$ARKVORY_URL/api/v1/auth/tokens" \
  -H "Authorization: Bearer $SESSION" -H "Content-Type: application/json" \
  -d '{"name":"laptop-cli","scope":"read-write","expiresAt":"2026-12-31T00:00:00Z"}'
```

Dans la console, ouvrez [[ui:personalAccessTokens]] dans la carte [[ui:connection]], saisissez un [[ui:tokenName]], choisissez [[ui:tokenScope]] et [[ui:tokenExpiry]], puis sélectionnez [[ui:generateToken]].

| Champ       | Règle                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `name`      | De 1 à 64 caractères.                                                                                                        |
| `scope`     | `read` ou `read-write`. L’API utilise `read-write` si vous l’omettez ; la console propose [[ui:tokenScopeRead]] en premier.  |
| `expiresAt` | Une heure RFC 3339 dans le futur, à au plus 365 jours. La valeur par défaut est 90 jours. Il n’existe pas de jeton sans fin. |

La réponse `201` contient le jeton une seule fois, sous `token`. Enregistrez-le à ce moment-là : le serveur ne conserve qu’un hachage, et la liste affiche un court préfixe. Ensuite :

- Un jeton a l’accès aux dépôts de son compte, et rien de plus. Il ne porte jamais l’indicateur d’administrateur, il ne peut donc pas gérer les comptes, les groupes, les mises à jour ou les sauvegardes.
- Un jeton `read` ne peut que lire. Toute requête qui modifie quelque chose, hormis `logout`, est refusée avec `403` et la raison `read_only_token`, avant l’exécution de l’opération.
- Un jeton ne peut pas créer de jetons ni changer un mot de passe ; cela exige une session.
- Un compte a au plus 50 jetons actifs. `GET /api/v1/auth/tokens` les liste avec leur préfixe, leur portée, leur fin et leur dernière utilisation. `DELETE /api/v1/auth/tokens/{id}` en révoque un immédiatement ([[ui:revokeToken]] dans la console). Un administrateur peut lister et révoquer les jetons de n’importe quel compte.
- Un jeton expiré renvoie `401` avec la raison `token_expired`.

## Comptes de service et clés {#service-accounts}

Un **compte de service** est une identité pour un outil, comme un agent de build. Il a une **politique** : une liste de **liaisons**, chacune nommant un dépôt et les **actions** exactes autorisées sur celui-ci (voir [Actions de dépôt](#repository-actions)). Une politique a au plus 64 liaisons. Le compte possède les téléversements et les tâches que ses clés démarrent, donc renouveler une clé ne perd rien. Un serveur a au plus 1 000 comptes de service.

Seule la [clé de récupération](#recovery-key) crée un compte de service. Elle, ou un opérateur disposant d’une [délégation](#delegation), modifie les comptes existants. Dans la console, utilisez [[ui:services]] : [[ui:serviceCreate]], puis définissez [[ui:servicePolicy]]. [[ui:bindingRead]] remplit les sept actions de lecture, et [[ui:bindingPublish]] ajoute les actions nécessaires pour téléverser et enregistrer des paquets.

```bash
curl -fsS -X POST "$ARKVORY_URL/api/v1/service-accounts" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" \
  -d '{"name":"ci-release","bindings":[{"resource":{"kind":"repository","id":"releases"},
       "actions":["repository.read","artifact.read","upload.create","upload.read","upload.write",
                  "upload.complete","upload.cancel","job.read","package.publish"]}]}'
```

Les noms utilisent de 3 à 64 lettres, chiffres, `_`, `.` et `-`. Pour changer la politique, envoyez `PUT /api/v1/service-accounts/{id}/policy` avec l’`expectedRevision` que vous avez lue ([compare-and-swap](./index#revisions)). Pour désactiver le compte, envoyez `PATCH /api/v1/service-accounts/{id}` avec `{"expectedRevision": n, "enabled": false}` ; toutes ses clés cessent de fonctionner jusqu’à ce que vous le réactiviez.

### Clés de service {#service-keys}

Une clé est le secret avec lequel un compte de service se connecte. Elle a la forme `arkvory_<uuid>.<secret>`. Une clé passe par trois états : `pending`, `active` et `revoked`.

1. **Émettre.** Envoyez `POST /api/v1/service-accounts/{id}/keys` avec un `Idempotency-Key`, un `name`, les `bindings` que la clé peut utiliser et, si vous le souhaitez, un `expiresAt` (UTC, dans les 365 jours ; la valeur par défaut est 90). Les liaisons de la clé doivent être incluses dans la politique du compte. La réponse, `201`, contient les métadonnées de la clé et, uniquement cette fois, son `secret`. Une répétition avec la même clé d’idempotence renvoie `200` avec les métadonnées et sans secret.
2. **Activer.** La nouvelle clé est `pending` et inutilisable, sauf pour un appel, `POST /api/v1/auth/activate-key`, avec le nouveau secret comme identifiant. La réponse est `204`. Faites-le dans les 15 minutes ; passé ce délai, la clé expire sans être utilisée. Dans la console, copiez le secret, sélectionnez [[ui:keySaved]] puis [[ui:keyActivate]]. Activer de nouveau est sans danger.
3. **Utiliser.** La clé fonctionne jusqu’à son `expiresAt`, ou jusqu’à sa révocation ou la désactivation de son compte.

```bash
curl -fsS -X POST "$ARKVORY_URL/api/v1/service-accounts/$ACCOUNT/keys" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Idempotency-Key: ci-release-2026-10" \
  -H "Content-Type: application/json" \
  -d '{"name":"ci-release-2026-10","bindings":[{"resource":{"kind":"repository","id":"releases"},
       "actions":["upload.create","upload.read","upload.write","upload.complete","job.read"]}]}'
curl -fsS -X POST "$ARKVORY_URL/api/v1/auth/activate-key" -H "Authorization: Bearer $NEW_SECRET"
```

Limites : un compte a au plus 3 clés actives et 2 clés en attente à la fois (`507` avec la raison `key_limit`).

**Renouveler.** `POST /api/v1/api-keys/{id}/rotate` émet une nouvelle clé en attente pour le même compte, avec le même corps qu’une émission et un `Idempotency-Key`. Ses liaisons doivent être incluses dans celles de l’ancienne clé. Lorsque vous activez la nouvelle clé, la fin de l’ancienne est ramenée à au plus 24 heures à partir de ce moment. Déplacez vos outils vers la nouvelle clé, puis révoquez l’ancienne. Dans la console : [[ui:keyRotate]].

**Révoquer.** `POST /api/v1/api-keys/{id}/revoke` met fin à une clé définitivement ; le répéter est sans danger. Dans la console : [[ui:keyRevoke]]. Révoquer une clé n’arrête pas un transfert déjà commencé. Vous avez perdu le secret d’une clé en attente ? Révoquez-la et émettez-en une autre avec une nouvelle clé d’idempotence.

### Délégation {#delegation}

La clé de récupération peut confier une partie de l’administration à un **opérateur** : un compte de service dont la clé peut gérer d’autres comptes de service. Une **délégation** nomme la clé de l’opérateur, le compte cible, les **actions d’administration** que l’opérateur peut utiliser sur lui, et un **plafond**, les actions de dépôt qu’il peut accorder. Les sept actions d’administration sont :

| Action                   | Permet                                           |
| ------------------------ | ------------------------------------------------ |
| `service-account.read`   | Voir le compte dans les listes et lire sa fiche. |
| `service-account.manage` | Activer ou désactiver le compte.                 |
| `policy.read`            | Lire la politique du compte.                     |
| `policy.manage`          | Remplacer la politique du compte.                |
| `credential.read`        | Lister les clés du compte et lire une clé.       |
| `credential.manage`      | Émettre, renouveler et révoquer des clés.        |
| `service-audit.read`     | Lire l’historique des clés du compte.            |

Règles : la clé de l’opérateur doit être une clé émise par la clé de récupération ; un opérateur ne gère jamais son propre compte ; il ne peut rien accorder en dehors de son plafond ni au-delà de la politique du compte ; une clé qu’il émet ne peut pas survivre à sa propre clé ; et mettre fin à une délégation ne révoque pas les clés déjà activées. Seule la clé de récupération crée des comptes et définit des délégations (`PUT` et `DELETE /api/v1/api-keys/{id}/delegations/{accountId}`). Une clé d’opérateur peut avoir jusqu’à 64 délégations. Dans la console, utilisez [[ui:delegations]]. Un opérateur qui a besoin de quelque chose en dehors de sa délégation reçoit `404` pour un compte qu’il ne gère pas, ou `403`.

## La clé de récupération {#recovery-key}

Le programme d’installation crée la **clé de récupération** une seule fois et l’écrit dans `config/bootstrap-token.txt` à la [racine d’installation](../install/index#installation-directory). Seul le groupe Administrateurs sous Windows, ou root sous Linux, peut lire le fichier. Son hachage se trouve dans le fichier de clés du serveur (`ARKVORY_KEYS_FILE`), sous le nom `bootstrap-owner`. Le programme d’installation crée aussi `config/health-token.txt`, une seconde clé sans aucun droit sur les dépôts, qui peut appeler les contrôles de santé authentifiés et les métriques.

Ce que la clé de récupération peut faire :

- Créer le premier compte et tous les comptes suivants, réinitialiser les mots de passe, désactiver des comptes et gérer les groupes et leurs droits de dépôt.
- Lire l’audit de sécurité et révoquer les jetons personnels de n’importe quel compte.
- Créer des comptes de service, définir leurs politiques, émettre et révoquer leurs clés, et définir des délégations.
- Lire et demander des sauvegardes et des mises à jour, et télécharger le journal du serveur pour les commentaires.
- Lire et écrire le dépôt `releases` comme un membre d’un groupe avec l’accès [[ui:write]].

Ce qu’elle ne peut pas faire : elle n’a accès à aucun dépôt autre que `releases`, ne peut pas supprimer d’artefacts ni gérer les politiques de stockage (ces actions n’existent que pour les clés de service), et n’est pas une session, elle ne peut donc pas créer de jetons personnels ni changer un mot de passe. Gardez-la sur le serveur. Les outils d’installation la lisent là. Ne la mettez pas dans la CI et ne la collez pas dans des outils ; créez plutôt une clé de service. Pour la remplacer, voir [Configuration](../install/configuration).

Le formulaire [[ui:welcomeOwner]] de la console (sous [[ui:navStart]]) utilise la clé de récupération pour créer le premier propriétaire. Il ne fonctionne que tant qu’aucun compte n’existe. Pour réinitialiser le mot de passe d’un compte existant sans session, trouvez son ID avec `GET /api/v1/users`, placez le nouveau mot de passe (de 12 à 128 caractères) dans un fichier privé et envoyez-le avec la clé de récupération. La réinitialisation met fin à toutes les sessions et à tous les jetons de ce compte.

```bash
echo '{"password": "a new password of 12 to 128 characters"}' > reset.json
curl -fsS -X PATCH "$ARKVORY_URL/api/v1/users/$USER_ID" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" -d @reset.json
rm reset.json
```

D’autres clés de fichier peuvent être ajoutées par un administrateur dans le fichier de clés. Chaque entrée a un `id`, le `sha256` du secret, les `repositories` et les `permissions` (`read` et `write`) qu’elle obtient, et éventuellement les indicateurs `administrator` et `serviceAdministrator`. Le fichier est lu au démarrage, redémarrez donc l’API et le processus de traitement après un changement.

## Liens de téléchargement {#download-links}

`POST /api/v1/repositories/{repository}/artifacts/{id}/links` renvoie un `token` (`dtl_…`) et une `url` pour un artefact. Demandez une durée de vie avec `ttlSeconds` : de 60 à 86 400, et 3 600 par défaut. L’appelant a besoin de `content.read`.

Le lien ne fonctionne que comme `GET` ou `HEAD` de `/api/v1/repositories/{repository}/artifacts/{id}/content?token=…`, pour cet artefact dans ce dépôt, et uniquement en lecture. C’est un secret. Le serveur ne peut pas le révoquer avant son expiration, et il n’apparaît pas dans les journaux. Créez des liens de la durée de vie la plus courte dont vous avez besoin.

## Ce que signifie une règle d’accès {#access-rules}

Chaque opération de la référence a une ligne **Access**. Voici les types de règles :

| Règle dans la référence                            | Ce qu’elle exige                                                                                                                                                                                                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anyone, without a key                              | Rien. Vivacité, statut de disponibilité, options de connexion, connexion et inscription.                                                                                                                                                                                           |
| Any valid key or session                           | Tout identifiant valide. Exemples : capabilities, la liste des opérations, votre propre identité, les détails de disponibilité et les métriques.                                                                                                                                   |
| A signed-in account session (not a key)            | Une session d’une personne. Les jetons personnels et les clés sont refusés (`session_required`). Exemples : créer et révoquer vos propres jetons, changer votre mot de passe.                                                                                                      |
| Administrator                                      | La session d’un compte administrateur, ou une clé de fichier avec l’indicateur d’administrateur, comme la clé de récupération. Les jetons personnels et les clés de service sont refusés (`administrator_required`). Exemples : comptes, groupes, audit de sécurité, mises à jour. |
| Bootstrap key (installation recovery key)          | Une clé de fichier avec l’indicateur d’administration de service. La clé de récupération l’a. Exemples : créer des comptes de service et définir des délégations.                                                                                                                  |
| Bootstrap key, or the key itself                   | La clé de récupération, ou la clé dont les délégations sont listées.                                                                                                                                                                                                               |
| The issued key, before or after activation         | La seule opération qui accepte une clé en attente : l’activation.                                                                                                                                                                                                                  |
| Repositories the caller may see                    | L’action `repository.read` sur ce dépôt, ou tout accès à celui-ci pour une session ou une clé de fichier. Un dépôt que l’appelant ne peut pas voir est exclu des listes et répond `404`.                                                                                           |
| System permission `backup.read` or `backup.manage` | Détenue par les sessions d’administrateur et par les clés de fichier avec un indicateur d’administrateur. Les clés de service et les jetons personnels ne l’ont jamais. `backup.manage` inclut `backup.read`.                                                                      |
| Service administration permission                  | Une des sept [actions d’administration](#delegation) sur le compte cible, issue d’une délégation, ou la clé de récupération.                                                                                                                                                       |
| Repository permission                              | **Toutes** les actions de dépôt listées sur le dépôt nommé dans le chemin. Plusieurs règles d’accès ajoutent des conditions : le téléversement, la tâche ou la référence doit appartenir à l’appelant.                                                                             |

La seconde partie d’une ligne de dépôt, comme « file keys: `read`, `write` », est le droit général dont les personnes et les clés de fichier ont besoin à la place des actions exactes. Voir [Droits de groupe](#group-grants).

Au-delà de la règle d’accès, le serveur refuse aussi une modification dans un dépôt qui est un miroir (`409`, `mirror_read_only`), et une passerelle de lecture refuse toute modification (`405`, `read_only`).

## Autorisations de dépôt {#repository-permissions}

### Droits de groupe {#group-grants}

Les personnes obtiennent l’accès aux dépôts par des **groupes**. Un administrateur accorde à un groupe `read` ou `write` (affiché « Read and write ») sur un dépôt, et ajoute des comptes au groupe. Dans la console : [[ui:administration]], puis [[ui:manageGrants]] et [[ui:saveGrant]]. Les appels d’API sont `PUT /api/v1/access-groups/{id}/grants/{repository}` avec `{"access": "read"}` ou `{"access": "write"}`, et `PUT /api/v1/access-groups/{id}/members/{userId}`. Les droits sont recalculés à chaque requête, une modification s’applique donc immédiatement.

Un droit `read` donne ces actions : `repository.read`, `artifact.read`, `artifact.list`, `content.read`, `package.read`, `asset.read` et `annotation.read`. Un droit `write` ajoute `upload.create`, `upload.read`, `upload.write`, `upload.complete`, `upload.cancel`, `job.read`, `package.publish`, `asset.write`, `asset.restore`, `annotation.write`, `reference.write`, `artifact.promote` et `audit.read`. Les actions `artifact.delete`, `storage.read`, `storage.manage` et `diagnostics.read` ne peuvent pas venir d’un groupe : seule une clé de service peut les avoir.

### Actions de dépôt {#repository-actions}

Une clé de service porte des actions exactes, dépôt par dépôt. Il y en a 24 :

| Action             | Permet                                                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repository.read`  | Voir le dépôt et son statut de miroir.                                                                                                                |
| `artifact.read`    | Lire les détails d’un artefact, ses étapes et ses promotions. Nécessaire aussi avec chaque modification d’un artefact.                                |
| `artifact.list`    | Lister et rechercher les artefacts, lister les artefacts étagés, lire le journal de promotion et le flux de changements.                              |
| `artifact.promote` | Définir et retirer des étapes, et promouvoir (copier ou déplacer) vers un autre dépôt.                                                                |
| `artifact.delete`  | Supprimer des artefacts, prévisualiser et appliquer la rétention, et retirer les images de conteneurs et déverrouiller de force les fichiers Git LFS. |
| `content.read`     | Télécharger des octets par ID, par paquet ou par chemin, et créer des liens de téléchargement.                                                        |
| `upload.create`    | Créer des sessions de téléversement. Le push vers les registres et Git LFS l’utilise.                                                                 |
| `upload.read`      | Lire vos propres sessions de téléversement et leurs parties.                                                                                          |
| `upload.write`     | Envoyer les parties ou le contenu entier de votre propre téléversement.                                                                               |
| `upload.complete`  | Finaliser votre propre téléversement, ou mettre sa finalisation en file d’attente.                                                                    |
| `upload.cancel`    | Annuler votre propre téléversement en attente.                                                                                                        |
| `job.read`         | Lire vos propres tâches de finalisation.                                                                                                              |
| `package.read`     | Lister les paquets, résoudre les versions et télécharger les paquets.                                                                                 |
| `package.publish`  | Enregistrer une archive UPack comme paquet.                                                                                                           |
| `asset.read`       | Lister les fichiers par chemin et lire leurs pointeurs, leur historique et leurs révisions. Télécharger les octets exige `content.read`.              |
| `asset.write`      | Pointer un chemin vers un artefact, ou stocker un fichier brut.                                                                                       |
| `asset.restore`    | Restaurer une révision antérieure d’un chemin.                                                                                                        |
| `annotation.read`  | Lire les étiquettes, les métadonnées, les collections et les pièces jointes.                                                                          |
| `annotation.write` | Remplacer les étiquettes, les métadonnées, les collections et les pièces jointes.                                                                     |
| `reference.write`  | Ajouter et retirer des références qui protègent un artefact.                                                                                          |
| `audit.read`       | Lire l’audit du catalogue du dépôt.                                                                                                                   |
| `storage.read`     | Lire le quota, l’utilisation, la politique de stockage et les réglages de nettoyage.                                                                  |
| `storage.manage`   | Changer la politique de stockage et les réglages de nettoyage, et lancer le nettoyage.                                                                |
| `diagnostics.read` | Lire les événements de stockage.                                                                                                                      |

L’ensemble exact dont une opération a besoin figure sur sa ligne dans la référence, par exemple `upload.write` et `upload.complete` pour `putUploadContent`. Une modification d’un dépôt exige aussi l’action `read` correspondante, comme `artifact.read` avec `annotation.write`.

Des conditions de propriétaire s’appliquent aux téléversements et aux tâches : vous n’agissez que sur les sessions de téléversement et les tâches de finalisation créées par votre compte. Toutes les clés d’un même compte de service, et toutes les sessions et tous les jetons d’une même personne, comptent comme le même propriétaire. Plusieurs services dans un même dépôt sont donc séparés par comptes et par dépôts, non par des préfixes de chemin.

### Autorisations d’administration et système {#administration-permissions}

Deux autres types d’autorisation ne sont pas des actions de dépôt. Les sept actions d’administration sont listées sous [Délégation](#delegation). Les deux autorisations système, `backup.read` et `backup.manage`, n’appartiennent qu’aux administrateurs et à la clé de récupération.

## Limites de connexion {#sign-in-limits}

Le serveur ralentit la devinette de mots de passe avant de vérifier le moindre mot de passe. Les compteurs vivent dans la mémoire de chaque processus API et repartent à zéro après un redémarrage. Ils s’appliquent par adresse de client, une adresse IPv6 étant comptée par son préfixe /64. Derrière un proxy inverse, définissez `ARKVORY_TRUSTED_PROXIES`, sinon chaque client apparaît comme le proxy.

| Limite                              | Valeur                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tentatives de connexion par adresse | Une rafale de 10, puis une de plus toutes les 15 secondes. Une connexion réussie ne consomme pas de tentative.                                                                                                                                                                                                                              |
| Mots de passe erronés par compte    | Chaque mot de passe erroné ajoute 1 à une dette qui diminue de 1 toutes les 6 secondes. Au-dessus de 20, le compte refuse les essais pendant 1 seconde, ce délai doublant à chaque nouvel échec jusqu’à 2 minutes ; pendant ce temps, même le bon mot de passe reçoit `429`. Une connexion réussie ou une réinitialisation efface la dette. |
| Inscriptions par adresse            | 3, puis une de plus toutes les 20 minutes.                                                                                                                                                                                                                                                                                                  |
| Inscriptions par serveur            | 20, puis une de plus toutes les 3 minutes.                                                                                                                                                                                                                                                                                                  |
| Demandes de connexion en cours      | 16 par processus API, et le corps dispose de 10 secondes pour arriver. Au-delà, renvoie `503` avec le code `busy`.                                                                                                                                                                                                                          |

Une tentative refusée renvoie `429` avec le code `rate_limited`, la raison `login_attempts`, `registration_attempts` ou `password_attempts`, et `Retry-After` en secondes. Attendez cette durée ; ne réessayez pas en boucle. Changer ou réinitialiser un mot de passe a sa propre barrière et la raison `password_attempts`. Toutes les connexions, inscriptions, changements de mot de passe et changements de jeton sont écrits dans l’audit de sécurité (`GET /api/v1/security/audit`, administrateurs uniquement), qui conserve 365 jours.

## Pages associées {#related}

- [Vue d’ensemble de l’API HTTP](./index)
- [Erreurs](./errors)
- [Comptes et accès](../use/accounts)
- [Sécurité](../operate/security)
- [Clients et protocoles](../protocols/index)
- Référence : [Comptes et connexion](./reference/accounts), [Comptes de service et clés](./reference/services)
