---
title: Concepts
description: 'Les notions que le reste de la documentation emploie, de l’installation et des dépôts jusqu’aux accès, à la rétention, aux sauvegardes et aux miroirs.'
---

# Concepts

Cette page explique les termes que les autres pages emploient. Chaque section est courte et renvoie à la page qui traite le sujet en détail. Pour des définitions en une ligne, consultez le [Glossaire](../reference/glossary).

## L’installation et ses services {#installation}

Une installation correspond à un serveur. Elle exécute trois services Arkvory à côté d’une base de données PostgreSQL :

| Partie              | Rôle                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API                 | Le serveur HTTP : l’API HTTP, la [console web](./console) et les registres pour les conteneurs, Git LFS et npm. Il exécute aussi la rétention et le nettoyage physique. |
| Worker              | Tâches d’arrière-plan : il finalise les gros téléversements et synchronise les miroirs.                                                                                 |
| Agent de sauvegarde | Sauvegardes planifiées vers le stockage des sauvegardes.                                                                                                                |
| PostgreSQL          | Le catalogue : artefacts, paquets, révisions, comptes, clés et tâches.                                                                                                  |

Le contenu des fichiers réside dans un répertoire local du serveur, pas dans la base de données. Toutes les parties se trouvent dans la **racine d’installation** (`C:\ProgramData\ProAnima\Arkvory` sous Windows, `/opt/proanima-arkvory` sous Linux). Les services démarrent sans utilisateur connecté et redémarrent après un plantage ou un blocage ([Autoréparation](../operate/self-healing)).

Une installation n’est pas un cluster à haute disponibilité. Si le serveur s’arrête, les clients attendent puis reprennent leurs transferts. Voir [Choisir une installation](../install/index). Sous Linux, deux ou trois serveurs peuvent former un [cluster à haute disponibilité](../operate/cluster).

## Dépôts {#repositories}

Un **dépôt** est un espace nommé pour le contenu. Il a ses propres règles d’accès, sa propre politique de stockage (quota et rétention) et, éventuellement, une source de miroir. Un nom de dépôt comporte 1 à 64 caractères : lettres latines minuscules, chiffres, `-` et `_`, en commençant par une lettre ou un chiffre.

Vous ne créez pas un dépôt avec une commande séparée. Un dépôt existe dès qu’un groupe obtient l’accès à son nom ou qu’une politique de compte de service le nomme. Une nouvelle installation dispose d’un emplacement pour le premier, `releases`. Voir [Dépôts](../use/repositories).

## Artefacts {#artifacts}

Un **artefact** est un fichier stocké. Il est **immuable** : ses octets ne changent jamais. Il possède un UUID, un nom (jusqu’à 240 caractères, sans `/` ni `\`), une taille et une somme de contrôle SHA-256. Un nouveau contenu crée un nouvel artefact ; il ne remplace jamais un ancien.

Un artefact ne devient visible qu’après que le serveur a vérifié que les octets correspondent à la taille et au SHA-256 déclarés. Un téléchargement renvoie les mêmes octets, avec la somme de contrôle comme `ETag` fort. Tout le reste dans Arkvory repose sur les artefacts : une version de paquet, une révision de chemin, une couche de conteneur et un objet Git LFS sont tous des artefacts.

## Téléversements {#uploads}

Un **téléversement** réserve un futur artefact. Vous créez une **session de téléversement** avec le nom, la taille et le SHA-256 du fichier, ainsi qu’une `Idempotency-Key` qui rend la requête sûre à répéter. Ensuite, vous envoyez les octets :

- en une seule requête, pour les fichiers petits et moyens ; ou
- en **parties**, pour les fichiers volumineux. Le serveur choisit la taille des parties : au moins 8 MiB, doublée pour les fichiers très volumineux afin que le téléversement n’ait jamais besoin de plus de 10 000 parties. Une partie ne dépasse jamais 1 GiB. Chaque partie porte son propre SHA-256, et une partie répétée est sans danger.

Vous **finalisez** ensuite le téléversement. Le serveur vérifie le fichier entier et le publie. Pour les gros fichiers, le worker finalise le téléversement dans une **tâche de finalisation** que le client suit ; le SDK et le client en ligne de commande choisissent ce mode pour les fichiers de 16 GiB et plus. Une session de téléversement vit 7 jours. Un téléversement interrompu reprend à partir des parties que le serveur possède déjà. Le plus gros objet fait 10 000 GiB, sauf si l’administrateur définit un `ARKVORY_MAX_OBJECT_BYTES` plus bas.

Le [client en ligne de commande](../protocols/cli) et le [SDK](../protocols/sdk) font tout cela pour vous. Voir [Transferts](../use/transfers) et la [référence des téléversements](../api/reference/uploads).

## Paquets {#packages}

Un **paquet** est une archive UPack qu’Arkvory a enregistrée. Son identité est un **groupe**, un **nom** et une **version SemVer**, par exemple `acme` / `game-server` / `1.4.2`. Le groupe fait partie de l’identité : deux paquets de même nom dans des groupes différents sont des paquets différents. Une version publiée ne change jamais ; publier la même version avec un autre contenu est refusé.

Un agent de déploiement demande un paquet par version exacte, par une **plage de versions** telle que `^1.4`, ou par la version la plus récente à une **étape**. Les versions préliminaires n’apparaissent que si vous les demandez. Voir [Paquets](../use/packages).

## Fichiers par chemin {#files-by-path}

Un **fichier par chemin** a une adresse telle que `builds/game/1.4/Setup.exe` et pointe vers un artefact. Lorsque vous stockez de nouveaux octets à ce chemin, le chemin obtient une nouvelle **révision** (1, 2, 3, etc.). Les révisions précédentes restent dans l’**historique**, et vous pouvez en **restaurer** une : restaurer ajoute une nouvelle révision avec l’ancien contenu. Stocker à nouveau les mêmes octets n’ajoute rien.

Un chemin comporte au plus 1 024 caractères, utilise `/` comme séparateur et ne contient ni segment vide, ni `.`, ni `..`, ni `:`. Une modification nomme la révision qu’elle attend ; si une autre modification est arrivée avant, le serveur répond `409`. Utilisez `0` pour un chemin qui n’existe pas encore. Voir [Fichiers et chemins](../use/files) et [Fichiers bruts](../protocols/raw-files).

## Étiquettes, métadonnées, collections et pièces jointes {#annotations}

Vous pouvez décrire un artefact sans toucher à ses octets :

| Élément        | Règle                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Étiquettes     | Jusqu’à 32 étiquettes courtes telles que `nightly` ou `tested`.                                                                             |
| Métadonnées    | Jusqu’à 32 champs texte ; une clé comporte jusqu’à 64 caractères, une valeur jusqu’à 1 024.                                                 |
| Collections    | Ensembles nommés qui regroupent des artefacts.                                                                                              |
| Pièces jointes | Jusqu’à 32 liens d’un build vers d’autres artefacts du même dépôt : un manifeste, un SBOM, une signature, un rapport ou tout autre fichier. |

Les étiquettes, les métadonnées et les collections changent comme un ensemble révisionné unique. Les pièces jointes ont leur propre révision et leur propre historique.

## Étapes et promotion {#stages-and-promotion}

Une **étape** est une marque contrôlée sur un build, telle que `qa`, `release` ou `prod`. Un nom d’étape utilise des lettres minuscules, des chiffres, `.`, `_` et `-` (jusqu’à 32 caractères), et un artefact peut avoir jusqu’à 16 étapes. Changer une étape nécessite une autorisation dédiée, `artifact.promote`, et chaque changement est enregistré avec l’acteur, l’heure et un commentaire.

La **promotion** publie un build dans un autre dépôt sans renvoyer les octets. `copy` conserve la source ; `move` retire en plus le build du dépôt source. Répéter une promotion renvoie la copie qui existe. **Résoudre** trouve le build que désignent une étape et une plage de versions. Voir [Promotion](../use/promotion).

## Comptes, groupes et autorisations {#access}

Les personnes utilisent des **comptes**. Un compte a un nom (3 à 64 caractères) et un mot de passe (12 à 128 caractères). Un compte **administrateur** gère les comptes et les groupes. Les comptes appartiennent à des **groupes**, et un groupe obtient un accès `read` ou `write` (« Lecture et écriture ») à un dépôt. Les droits sont recalculés à chaque requête, donc un changement s’applique immédiatement.

L’automatisation utilise plutôt un **compte de service**. Sa **politique** liste des **actions** exactes par dépôt, telles que `upload.create` ou `content.read`, et ses clés ne peuvent que restreindre cette politique. Le serveur vérifie chaque action ; masquer un bouton dans la console n’est pas une protection. Voir [Comptes et accès](../use/accounts) et [Authentification](../api/authentication).

## Clés et jetons {#keys-and-tokens}

Chaque requête porte un identifiant. Il y a quatre types que vous créez, et un intégré :

| Identifiant                 | Pour                                                  | Durée de vie                                    |
| --------------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| **Session** de console      | Une personne connectée avec un nom et un mot de passe | 12 heures                                       |
| **Jeton d’accès personnel** | Les scripts et outils d’une personne                  | 90 jours par défaut, 365 au maximum             |
| **Clé de service**          | CI/CD et agents de déploiement                        | 90 jours par défaut, 365 au maximum             |
| **Lien de téléchargement**  | Remettre un artefact à quelqu’un sans clé             | de 60 secondes à 24 heures (1 heure par défaut) |
| **Clé de récupération**     | L’installation elle-même                              | N’expire pas                                    |

Une clé de service est émise une fois, affichée une fois, et ne devient utilisable qu’après son **activation**. Vous pouvez la **renouveler** (émettre une nouvelle clé, puis retirer l’ancienne) et la **révoquer** définitivement. Voir [Authentification](../api/authentication).

## Le propriétaire et la clé de récupération {#owner-and-recovery-key}

Le **propriétaire** est le premier compte. C’est un administrateur et un membre du groupe `arkvory-owners`, qui a un accès `write` à `releases`. Le programme d’installation Windows le crée ; sous Linux et Docker, vous le créez dans la console avec la clé de récupération.

La **clé de récupération** est un secret que le programme d’installation écrit dans `config/bootstrap-token.txt` à la racine d’installation. Elle peut créer le premier propriétaire et des comptes, gérer les comptes de service et leurs délégations, exécuter des sauvegardes et demander des mises à jour. Les outils d’installation la lisent sur le serveur. Elle n’est pas destinée au CI ni au travail quotidien : gardez-la sur le serveur et ne la copiez pas. Voir [Choisir une installation](../install/index#recovery-key) et [Sécurité](../operate/security).

## Rétention, quotas et nettoyage {#retention}

Une **politique de stockage** appartient à un dépôt. Elle peut conserver les N derniers builds de chaque paquet (ou de chaque paquet et canal), protéger les étiquettes et les étapes contre la suppression, attendre un âge minimum avant de supprimer quoi que ce soit, et définir un **quota** avec des seuils d’avertissement et critique. Elle est désactivée jusqu’à ce qu’un administrateur l’active. La suppression d’un artefact est d’abord logique : les octets restent sur le disque pendant un **délai de grâce** (24 heures par défaut), puis le **nettoyage physique** libère l’espace en arrière-plan, par petits lots, sans arrêter le serveur.

Le serveur conserve aussi une réserve d’espace disque libre (1 GiB par défaut) que les téléversements n’utilisent jamais. Voir [Stockage](../operate/storage).

## Sauvegardes {#backups}

L’**agent de sauvegarde** copie la base de données et tout le contenu publié dans le **stockage des sauvegardes**, un dossier sur un autre disque ou sur un partage réseau. Une copie complète est un **point de restauration**. L’agent vérifie chaque point, applique la rétention aux points (7 quotidiens, 4 hebdomadaires et 6 mensuels par défaut) et vous permet d’**épingler** un point pour que la rétention le conserve. Le plan quotidien est désactivé jusqu’à ce qu’un administrateur l’active dans [[ui:backupPlan]].

La restauration est une commande sur le serveur. Elle écrit dans une base de données vide et un répertoire de stockage vide. Voir [Sauvegardes](../operate/backups).

## Miroirs et passerelles de lecture {#mirrors-and-gateways}

Un **miroir** est une copie en lecture seule d’un dépôt qu’une seconde installation entretient en suivant la première, la **source**. Il refuse les changements et sert les téléchargements. Si la source est perdue, un opérateur détache le miroir et celui-ci devient un dépôt ordinaire ; la bascule est manuelle et n’est pas un basculement automatique. Voir [Miroirs](../operate/mirrors).

Une **passerelle de lecture** est un processus d’API supplémentaire sur le même stockage qui ne répond qu’aux requêtes `GET` et `HEAD`. L’écrivain et les passerelles partagent un même budget de bande passante de téléchargement. Voir [Passerelles de lecture](../operate/read-gateways).

## Pour aller plus loin {#next}

1. [Démarrage rapide](./quick-start) : installez Arkvory et téléversez un premier fichier.
2. [Comptes et accès](../use/accounts) : personnes, groupes, jetons et clés de service.
3. [Aperçu de l’API HTTP](../api/index) : les règles dont chaque intégration a besoin.
4. [Glossaire](../reference/glossary) : de courtes définitions de chaque terme.
