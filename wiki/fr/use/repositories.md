---
title: Dépôts
description: 'Ce qu’est un dépôt, comment voir les dépôts que vous pouvez utiliser, comment en choisir un dans la console et ce que sont les dépôts en lecture seule.'
---

# Dépôts

Un dépôt est un emplacement nommé dans Arkvory où les fichiers sont stockés et où l’accès est décidé. Tout ce que vous publiez entre dans un dépôt, et chaque requête le nomme.

## Ce qu’est un dépôt {#what-it-is}

Un dépôt possède un ID : lettres latines minuscules, chiffres, `-` et `_`, en commençant par une lettre ou un chiffre, 64 caractères au plus. Des exemples sont `releases`, `builds` et `game-prod`. L’ID fait partie de chaque adresse :

| Quoi                                               | Adresse                               |
| -------------------------------------------------- | ------------------------------------- |
| Artefacts, paquets, fichiers par chemin (API HTTP) | `/api/v1/repositories/<repository>/…` |
| Images de conteneurs                               | `/v2/<repository>/<image>/…`          |
| Git LFS                                            | `/lfs/<repository>`                   |
| Paquets npm et Unity                               | `/npm/<repository>/…`                 |

Voir [Images de conteneurs](../protocols/containers), [Git LFS](../protocols/git-lfs) et [Unity et npm](../protocols/unity-npm).

Un dépôt contient des artefacts immuables. Il en existe deux vues : les paquets UPack avec une version ([Paquets](./packages)) et les fichiers par chemin avec un historique ([Fichiers par chemin](./files)). Les étapes et la promotion déplacent les builds entre les dépôts ([Étapes et promotion](./promotion)).

Aujourd’hui, un dépôt n’a ni nom d’affichage, ni description, ni réglages propres en dehors de l’accès, des [réglages de stockage](#settings) et, pour une copie d’un autre serveur, de son [état de miroir](#read-only). Vous ne pouvez pas renommer un dépôt. Vous ne pouvez pas en supprimer un : retirez l’accès et les fichiers restent sur le disque.

## Créer un dépôt {#create}

Aucune commande ne crée un dépôt. Un dépôt existe dès que l’accès à celui-ci est accordé. Le dépôt est vide jusqu’au premier téléversement.

Un administrateur fait l’une de ces actions :

- Accorder à un groupe l’accès au nouveau nom. Dans la console, ouvrez [[ui:administration]], développez [[ui:manageGrants]], choisissez le groupe, saisissez le nom dans [[ui:repository]], choisissez [[ui:read]] ou [[ui:write]] et sélectionnez [[ui:saveGrant]]. Le groupe `arkvory-owners`, auquel appartient le propriétaire, est un bon choix pour la première autorisation. Voir [Groupes et accès aux dépôts](./accounts#groups).
- Nommer le dépôt dans la politique d’un compte de service. Voir [Comptes de service et clés pour la CI](./accounts#service-accounts).

Avec l’API, `setGroupGrant` et `setServicePolicy` font la même chose. Une faute de frappe crée un nouveau nom erroné : vérifiez l’orthographe. Le nom `releases` existe après l’installation, avec un accès en écriture pour le groupe `arkvory-owners`.

## Voir les dépôts que vous pouvez utiliser {#list}

Vous ne voyez que les dépôts sur lesquels votre identifiant possède un droit. Un dépôt sur lequel vous n’avez aucun droit n’apparaît pas, et le demander directement renvoie `404`. Un dépôt vide auquel vous avez accès apparaît aussi.

Dans la console, ouvrez [[ui:repositories]]. Chaque carte affiche le nom du dépôt et, sous [[ui:repositoryRights]], les actions dont vous disposez. Les boutons sont :

- [[ui:repositoryOpen]] ouvre le catalogue du dépôt. Il apparaît lorsque vous pouvez lister les artefacts.
- [[ui:repositoryStorage]] ouvre le catalogue avec les réglages de stockage. Il apparaît lorsque vous pouvez lire la politique de stockage ou les diagnostics.
- [[ui:repositoryAccess]] mène à l’administration des utilisateurs et des services. Il apparaît pour les administrateurs et les administrateurs de service.

La liste affiche 50 dépôts à la fois ; [[ui:managementMore]] charge la page suivante et [[ui:managementReload]] l’actualise. Un miroir affiche le badge [[ui:mirrorBadge]].

Avec `arkvoryctl` :

```bash
arkvoryctl repositories
arkvoryctl doctor
```

`repositories` affiche chaque dépôt avec ses `formats` et vos `permissions`. Lorsque la réponse contient une valeur `next`, passez-la comme `--after`. `doctor` affiche le serveur, les fonctionnalités et les autorisations de la clé courante.

Avec l’API, `listRepositories` prend `limit` (de 1 à 100, 50 par défaut) et `after`, le dernier ID de la page précédente. `getRepository` renvoie une carte.

```bash
curl -H "Authorization: Bearer $ARKVORY_KEY" "$ARKVORY/api/v1/repositories?limit=100"
```

```typescript
const page = await client.repositories({ limit: 50 });
const card = await client.repository('releases');
```

Une carte contient `id`, `formats` (toujours `upack` et `assets`) et `permissions`. Elle ne dit rien de la taille ni du nombre de fichiers. Voir [Autorisations](./accounts#permissions) pour les noms d’action.

## Choisir un dépôt dans la console {#choose}

La carte [[ui:connection]] contient le champ [[ui:repository]] avec une liste des dépôts que vous pouvez lire. Le champ commence par `releases`. Après votre connexion, la console le conserve si vous pouvez le lire, sinon elle choisit le premier dépôt que vous pouvez lire. Pour travailler dans un autre, saisissez son nom ou choisissez-le dans la liste. Le catalogue, les paquets, les téléversements et les détails utilisent alors ce dépôt. [[ui:repositoryOpen]] sur une carte remplit le champ pour vous.

L’adresse d’un artefact dans la console contient son dépôt : `#/artifact/<repository>/<id>`. Un lien vers un artefact d’un dépôt que vous ne pouvez pas lire affiche un message et le catalogue.

`arkvoryctl` utilise le dépôt du profil, `releases` sauf si vous en définissez un autre à l’ajout du profil. Remplacez-le pour une commande avec `--repository` :

```bash
arkvoryctl profile add production --server https://arkvory.example --token-file ~/.arkvory/key --repository builds
arkvoryctl list --repository releases
```

Dans le SDK, `client.inRepository('builds')` renvoie un client lié à un dépôt. En HTTP, le dépôt figure dans le chemin.

## Réglages du dépôt {#settings}

Ce que vous pouvez régler pour un dépôt aujourd’hui :

- **Accès.** Qui peut lire et écrire. Voir [Comptes et accès](./accounts).
- **Stockage.** Un quota en GiB, des seuils d’avertissement et critique, la rétention (conserver les N derniers builds de chaque paquet et canal, les étiquettes protégées, un âge minimum), le nettoyage automatique et le nettoyage physique. Les réglages nécessitent les actions `storage.read` pour les consulter et `storage.manage` pour les modifier ; le niveau de groupe d’une personne ne les donne pas, une clé de service si. Dans la console, ils se trouvent sous [[ui:storageTitle]], que [[ui:repositoryStorage]] ouvre. Avec `arkvoryctl`, `storage usage` et `storage policy` les lisent. Un nouveau téléversement qui dépasserait le quota est refusé avec `507 storage_quota`. Voir [Stockage et rétention](../operate/storage).
- **Miroir.** Un administrateur de serveur peut faire du dépôt une copie du dépôt d’un autre serveur. Voir la section suivante.

## Dépôts en lecture seule {#read-only}

Un **miroir** est une copie en lecture seule du dépôt d’un autre serveur Arkvory. Le serveur le tient à jour de lui-même. Toute personne ayant le droit de lire peut lister et télécharger. Personne ne peut le modifier : téléversement, publication, changement d’étiquettes, ajout d’étapes, attribution de chemins et suppression sont tous refusés avec `409 mirror_read_only`, quel que soit le niveau de groupe de la personne ou les actions de la clé. Pour modifier le contenu, utilisez le serveur principal.

La console affiche un miroir avec un badge au-dessus du catalogue et masque le bouton de téléversement :

| Badge                | Signification                                                                        |
| -------------------- | ------------------------------------------------------------------------------------ |
| [[ui:mirrorBadge]]   | La copie est à jour                                                                  |
| [[ui:mirrorBehind]]  | Le serveur est encore en train de rattraper son retard                               |
| [[ui:mirrorFailing]] | La dernière synchronisation a échoué ; les téléchargements continuent de fonctionner |

Sélectionnez [[ui:mirrorHelpLabel]] à côté du badge pour voir la source, l’heure de la dernière synchronisation et le code d’erreur.

Un second type est l’**import**. C’est un dépôt ordinaire qui reprend automatiquement les versions qui portent certaines étapes dans un dépôt d’un autre serveur (par exemple de `dev` à `prod`). Son badge est [[ui:mirrorImport]]. Les téléversements y restent possibles, et les modifications ou suppressions ultérieures à la source n’affectent pas ce qui a été copié.

Avec l’API, `getRepositoryMirror` renvoie l’état : `mode` (`mirror` ou `import`), `phase` (`pending`, `seeding` ou `following`), `caughtUp`, `syncedAt` et `errorCode`. Elle répond `404` pour un dépôt ordinaire.

Les miroirs sont configurés par l’administrateur du serveur. Voir [Miroirs](../operate/mirrors). Une **passerelle de lecture** est autre chose : une adresse qui ne sert que les téléchargements pour les mêmes dépôts. Les modifications qui passent par elle sont refusées avec `405 read_only`. Voir [Passerelles de lecture](../operate/read-gateways).

## Pages associées {#related-pages}

- [Comptes et accès](./accounts)
- [Fichiers par chemin](./files) et [Paquets](./packages)
- [Stockage et rétention](../operate/storage)
- Référence API : [Dépôts](../api/reference/repositories), [Miroirs](../api/reference/mirrors)
