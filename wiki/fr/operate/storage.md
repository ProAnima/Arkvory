---
title: Stockage
description: 'Planifier l’espace disque, définir des quotas et des politiques de rétention par dépôt, libérer de l’espace sans arrêter le serveur et réagir quand le disque se remplit.'
---

# Stockage

Arkvory conserve chaque fichier publié une seule fois, inchangé, dans un répertoire de stockage sur un disque local du serveur. Cette page explique ce qui occupe l’espace disque, comment le limiter par des quotas et des politiques de rétention, comment les fichiers supprimés quittent le disque et quoi faire lorsque le disque est plein.

## Où se trouvent les contenus {#location}

Le répertoire de stockage est défini par `ARKVORY_DATA_DIR`. Les programmes d’installation utilisent ces emplacements :

| Installation   | Stockage                                       |
| -------------- | ---------------------------------------------- |
| Windows        | `data\` dans `C:\ProgramData\ProAnima\Arkvory` |
| Linux          | `data/` dans `/opt/proanima-arkvory`           |
| Docker Compose | Le volume Docker `proanima-arkvory_storage`    |

À l’intérieur, `blobs/` contient les fichiers terminés, `staging/` et `parts/` contiennent les téléversements en cours, et le fichier `storage-id` lie le répertoire à la base de données. Le catalogue, avec tous les noms, étiquettes, versions et autorisations, est dans PostgreSQL. Les fichiers et la base de données vont ensemble.

- Utilisez un système de fichiers local qui prend en charge les liens physiques. N’utilisez pas un partage réseau pour le stockage.
- N’ajoutez, ne modifiez et ne supprimez pas de fichiers dans le répertoire à la main. Arkvory supprime les fichiers lui-même, comme décrit ci-dessous.
- Un fichier publié n’est jamais modifié. Un nouveau contenu est un nouveau fichier avec un nouvel ID.

## Planifier le disque {#disk}

Ce qui suit occupe de l’espace disque sur le volume de stockage :

| Élément                                               | Remarques                                                                                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fichiers publiés                                      | Toutes les versions que vous conservez                                                                                                                             |
| Téléversements en cours                               | Les parties et les fichiers de staging, jusqu’à la fin du téléversement                                                                                            |
| Fichiers des téléversements terminés dans les parties | Les parties temporaires restent à côté du fichier terminé jusqu’à ce qu’une passe de nettoyage physique les supprime. Voir [Nettoyage physique](#physical-cleanup) |
| Fichiers supprimés                                    | Ils restent sur le disque jusqu’à la fin du délai de grâce et qu’une passe de nettoyage les supprime                                                               |
| Copies de miroir                                      | Une partie dans `mirror-staging` pendant qu’un miroir copie un fichier. Voir [Miroirs](./mirrors)                                                                  |

En plus du stockage, prévoyez si possible la base de données PostgreSQL, les journaux et le stockage des sauvegardes (coffre) sur leurs propres volumes. Voir [Sauvegardes](./backups).

Arkvory conserve une **réserve** d’espace libre sur le volume de stockage. Par défaut, elle est de 1 GiB (`ARKVORY_STORAGE_RESERVE_BYTES`). Un téléversement qui entamerait la réserve est refusé avec HTTP 507 et la raison `storage_full`. Les téléchargements continuent de fonctionner. `GET /health/ready` affiche `writable: false` tant qu’il n’y a pas de place pour de nouvelles données.

Deux limites fonctionnent indépendamment du disque :

- `ARKVORY_CAPACITY_BYTES` limite tout le contenu réservé de l’installation. La valeur par défaut est 10 TiB. C’est une limite logique, pas une vérification du disque. Lorsqu’elle est atteinte, les téléversements échouent avec HTTP 507 et la raison `catalog_limit`.
- `ARKVORY_MAX_OBJECT_BYTES` limite la taille d’un fichier.

Voir [Variables d’environnement](../reference/environment#storage-and-limits). Arkvory n’a pas de métrique pour l’espace libre du stockage ou de la base de données. Surveillez les volumes avec les outils de votre système d’exploitation ou un node exporter.

## Qui peut gérer le stockage {#permissions}

Les paramètres de stockage ne font pas partie des droits normaux de lecture et d’écriture. Une clé de service a besoin d’actions explicites sur le dépôt :

| Action             | Permet                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `storage.read`     | Voir la politique, l’utilisation et les paramètres de nettoyage                                           |
| `storage.manage`   | Modifier la politique, le quota et les paramètres de nettoyage, et demander un lot de nettoyage           |
| `artifact.delete`  | Prévisualiser les suppressions, supprimer des artefacts et activer une politique de rétention automatique |
| `diagnostics.read` | Lire les événements de stockage                                                                           |

Les comptes avec un mot de passe et la clé de récupération n’ont pas ces droits par eux-mêmes. Pour gérer le stockage dans la console :

1. Créez un compte de service avec une politique pour le dépôt qui inclut les quatre actions. Voir [Comptes et accès](../use/accounts).
2. Émettez et activez une clé pour ce compte.
3. Dans la console, ouvrez [[ui:keySignIn]], collez la clé et sélectionnez [[ui:connect]].
4. Ouvrez [[ui:repositories]], et sur la carte du dépôt, sélectionnez [[ui:repositoryStorage]].

Le panneau [[ui:storageTitle]] apparaît au-dessus du catalogue. Sans les droits, le panneau reste masqué.

Une politique de rétention activée est liée à la **clé qui l’a activée**. Chaque exécution automatique vérifie à nouveau que cette clé est toujours active, non expirée et qu’elle possède encore `storage.manage` et `artifact.delete`. Si vous révoquez la clé ou réduisez ses droits, la suppression s’arrête et l’événement `retention.failed` apparaît. Après avoir renouvelé la clé, enregistrez à nouveau la politique avec la nouvelle clé.

## Quotas et seuils d’avertissement {#quotas}

Un dépôt peut avoir un quota. Sans quota, seule la limite globale s’applique.

| Paramètre             | Champ de la console           | Signification                                                                                                                            | Valeur par défaut |
| --------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Quota                 | [[ui:storageQuota]]           | L’espace maximal que le dépôt peut utiliser. L’API accepte des octets exacts, de 1 à 9 007 199 254 740 991, et `null` pour aucune limite | Aucune limite     |
| Seuil d’avertissement | [[ui:storageWarningPercent]]  | La part du quota qui déclenche un avertissement. 1–98                                                                                    | 80                |
| Seuil critique        | [[ui:storageCriticalPercent]] | La part qui déclenche une erreur. 2–99, supérieure au seuil d’avertissement                                                              | 95                |

L’utilisation qui compte contre le quota est la taille de tous les fichiers du dépôt qui ne sont pas encore supprimés du disque : les fichiers publiés, les téléversements inachevés et les fichiers supprimés qui attendent le nettoyage. Un fichier supprimé continue donc d’occuper du quota jusqu’à ce qu’une passe de nettoyage le supprime.

- **Vérification.** Le serveur vérifie le quota au démarrage d’un téléversement. Un nouveau téléversement qui dépasserait le quota échoue avec HTTP 507 et la raison `storage_quota`. Une nouvelle tentative avec la même clé d’idempotence ne réserve pas l’espace deux fois.
- **Abaissement.** Vous pouvez définir un quota inférieur à l’utilisation actuelle. Les téléversements en cours peuvent se terminer. Les nouveaux téléversements au-dessus de la limite sont refusés.
- **Aucune libération automatique.** Le quota ne provoque jamais de suppression. La rétention ne supprime pas de builds supplémentaires pour respecter un quota.
- **États.** L’état est `unlimited`, `normal`, `warning`, `critical` ou `exceeded`. Un changement d’état est enregistré une fois comme un événement de stockage.
- **Surveillance.** Le serveur revérifie les états de 20 dépôts au plus chaque minute, même lorsque la suppression automatique est désactivée.

Les chiffres sont des réservations logiques, pas de l’espace disque libre. Un dépôt peut être sous son quota alors que le disque est plein, car le disque contient aussi les fichiers de staging et d’autres dépôts.

## Politique de rétention {#retention}

Une politique de rétention supprime automatiquement les anciens **builds UPack enregistrés** et conserve les N derniers. Elle ne supprime pas les autres fichiers : les fichiers simples par chemin, les images de conteneurs, les objets Git LFS et les paquets npm en sont exclus. Sans politique, rien n’est supprimé automatiquement.

### Les paramètres {#retention-settings}

| Paramètre            | Champ de la console     | Signification                                                                                                                        | Valeur par défaut                     |
| -------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| Activer              | [[ui:storageEnabled]]   | Active la suppression automatique                                                                                                    | Désactivé                             |
| Regroupement         | [[ui:storageGrouping]]  | L’unité comptée : [[ui:storagePerChannel]], [[ui:storagePerPackage]] ou [[ui:storageGlobal]]                                         | Paquet et canal                       |
| Derniers N           | [[ui:storageKeep]]      | Combien de builds conserver par compteur, 1–100 000                                                                                  | 10                                    |
| Canaux               | [[ui:storageChannels]]  | N propre à une étiquette, sous la forme `label=N`, un par ligne, 32 au plus. Utilisé uniquement avec le regroupement paquet et canal | `test=10`, `staging=10`, `release=10` |
| Âge minimal          | [[ui:storageAge]]       | Un build plus récent que cette valeur est conservé, en heures, 0–87 600                                                              | 24                                    |
| Étiquettes protégées | [[ui:storageProtected]] | Les builds portant l’une de ces étiquettes ne sont jamais supprimés, 32 au plus, séparées par des virgules                           | `bse`, `release`                      |
| Intervalle           | [[ui:storageInterval]]  | Minutes entre les exécutions, 1–10 080                                                                                               | 60                                    |

Une étiquette compte de 1 à 64 lettres, chiffres ou caractères `_ . : -`.

### Comment les builds sont choisis {#retention-rules}

1. Le serveur classe les builds de chaque compteur par **heure de publication**, du plus récent au plus ancien. L’ordre n’est pas l’ordre SemVer des versions.
2. Le compteur dépend du regroupement. Avec paquet et canal, un build est compté séparément pour chaque étiquette de canal configurée qu’il porte, par paquet (`group/name`). Un build sans étiquette configurée entre dans un compteur partagé du paquet, avec le N par défaut. Avec paquet, chaque paquet a un compteur. Avec le dépôt entier, tous les builds partagent un compteur. Les noms de paquets ignorent la casse, les étiquettes non.
3. Un build est conservé s’il fait partie des N derniers de **n’importe quel** compteur auquel il appartient.
4. Un build plus récent que l’âge minimal est conservé.
5. Un build portant une étiquette protégée est conservé. Ses étiquettes proviennent de l’annotation actuelle, ou du téléversement lorsqu’il n’a pas d’annotation. Les builds protégés participent quand même au classement, de sorte que le nombre conservé peut être supérieur à N.

Un build n’est jamais supprimé tant que quelque chose en a encore besoin :

- Un service externe en détient une référence.
- Un chemin de fichier, actuel ou issu de l’historique, l’utilise.
- Un autre build le liste comme pièce jointe, maintenant ou dans l’historique.
- Il est promu vers une étape. Retirez d’abord l’étape.
- Une image de conteneur, une entrée Git LFS ou npm l’utilise.

La suppression d’un build est logique : il quitte les listes et les nouveaux téléchargements échouent avec 404. Les octets quittent le disque plus tard, lors du [nettoyage physique](#physical-cleanup). La version du paquet reste réservée, de sorte que la même version ne peut pas être publiée à nouveau avec un autre contenu.

### Activer une politique en toute sécurité {#retention-enable}

Prévisualisez d’abord, puis activez. Un aperçu montre ce que la politique enregistrée supprimerait, et il ne supprime rien.

1. Connectez-vous avec une clé disposant des quatre actions, et ouvrez le panneau de stockage du dépôt.
2. Renseignez les champs et laissez [[ui:storageEnabled]] désactivé. Sélectionnez [[ui:storageSave]].
3. Sélectionnez [[ui:storagePreview]]. La liste affiche jusqu’à 100 builds que la politique enregistrée supprimerait en un lot. S’il reste plus de candidats, la console le signale.
4. Si la liste est correcte, cochez [[ui:storageEnabled]] et l’accusé de réception [[ui:storageAcknowledge]], puis enregistrez à nouveau. Cela nécessite `artifact.delete`.

Remarques :

- L’aperçu montre un instant donné. Lorsque la politique s’exécute, elle reclasse et revérifie les dépendances.
- La politique est enregistrée avec une révision. Si quelqu’un d’autre l’a modifiée, rechargez et enregistrez à nouveau.
- [[ui:storageRefresh]] recharge les paramètres et l’utilisation.

### Comment elle s’exécute {#retention-run}

Le processus d’API qui écrit (pas une passerelle de lecture) vérifie toutes les 60 secondes et traite jusqu’à 20 politiques arrivées à échéance. Un lot supprime au plus 100 builds. S’il reste des candidats, le lot suivant démarre après une minute. Sinon, l’exécution suivante arrive après l’intervalle. Le calendrier est enregistré dans la base de données et survit à un redémarrage.

Vous pouvez aussi exécuter vous-même un lot avec l’opération d’API [runStoragePolicy](../api/reference/storage#runStoragePolicy). L’utilisation, l’aperçu et les événements disposent d’opérations dans la même [référence de l’API Storage](../api/reference/storage).

## Nettoyage physique {#physical-cleanup}

Supprimer un artefact, par une personne ou par une politique, ne le retire que du catalogue. Le **nettoyage physique** supprime ses octets du disque, en arrière-plan et sans arrêter l’API, le worker ou les passerelles de lecture. Il effectue aussi les opérations suivantes :

- Annule les téléversements arrivés à expiration sans être terminés, et supprime leurs parties.
- Supprime les parties temporaires des téléversements terminés.

Il ne choisit pas les builds à supprimer. Il ne supprime que ce qui est déjà supprimé ou annulé.

**Le nettoyage physique est désactivé par défaut, et il se définit par dépôt.** Activez-le dans chaque dépôt que vous utilisez. D’ici là, les fichiers supprimés, les téléversements expirés et les parties des téléversements terminés restent sur le disque, et le quota compte les fichiers supprimés.

### Paramètres {#cleanup-settings}

Dans le panneau du dépôt, ouvrez [[ui:cleanupTitle]] :

| Paramètre      | Champ de la console    | Signification                                                       | Valeur par défaut | Plage    |
| -------------- | ---------------------- | ------------------------------------------------------------------- | ----------------- | -------- |
| Activer        | [[ui:cleanupEnabled]]  | Active le nettoyage en arrière-plan                                 | Désactivé         |          |
| Délai de grâce | [[ui:cleanupGrace]]    | Combien de temps un fichier supprimé reste sur le disque, en heures | 24                | 0–8760   |
| Lot            | [[ui:cleanupBatch]]    | Fichiers traités par lot                                            | 25                | 1–100    |
| Intervalle     | [[ui:cleanupInterval]] | Secondes entre les lots                                             | 60                | 5–86 400 |
| Délai          | [[ui:cleanupDelay]]    | Millisecondes de pause entre les fichiers                           | 50                | 0–1000   |

Sélectionnez [[ui:cleanupSave]] pour les appliquer. Le changement agit immédiatement. Si vous désactivez le nettoyage, il s’arrête après le fichier en cours. [[ui:cleanupRun]] demande un lot prochainement, il ne supprime pas immédiatement. Sélectionnez [[ui:cleanupRefresh]] pour voir le résultat du dernier lot.

Le délai de grâce n’est pas une corbeille. Avec la valeur 0, un fichier peut disparaître juste après sa suppression et si aucun lecteur ne l’a ouvert. Arkvory ne peut pas restaurer un artefact supprimé.

### Ce que fait le nettoyage et ce qu’il ignore {#cleanup-rules}

- Il ne supprime que les fichiers annulés ou supprimés, au-delà du délai de grâce. Il revérifie que rien ne les utilise : aucune référence, aucun historique de chemin de fichier ni d’historique de pièce jointe.
- Un téléchargement ouvert, un téléversement en cours d’écriture et un fichier dont une sauvegarde en cours a besoin font que le nettoyage **ignore** ce fichier. Le lot suivant réessaie. Le dernier résultat indique combien de fichiers il a traités, ignorés et échoués, et combien d’octets il a libérés.
- Le quota et la capacité logique ne sont libérés qu’après la suppression des fichiers du disque.
- Un lot est limité par sa taille et par le délai, ce qui réduit la charge du disque. Il ne garantit pas un débit disque strict et ne peut pas promettre une influence nulle sur la latence des autres requêtes.
- Le nettoyage s’exécute dans l’API d’écriture, une fois par base de données. L’écrivain vérifie un dépôt arrivé à échéance toutes les 5 secondes. Sans écrivain en cours, rien n’est nettoyé.
- N’activez le nettoyage qu’après avoir mis à jour chaque processus Arkvory, y compris les passerelles et le worker. Un ancien processus sans le protocole de nettoyage fait que le nettoyage reporte son travail.

## Supprimer un artefact {#delete-artifacts}

Vous pouvez supprimer à la main un artefact publié. Vous avez besoin de `artifact.delete` sur le dépôt.

1. Ouvrez l’artefact dans [[ui:metadata]], et trouvez [[ui:deletionTitle]].
2. Sélectionnez [[ui:deletionInspect]]. La console montre ce qui utilise encore l’artefact. Si quelque chose bloque la suppression, vous devez d’abord retirer cette dépendance.
3. Collez l’ID de l’artefact pour le confirmer, puis sélectionnez [[ui:deletionSubmit]].

Supprimer de cette façon ne vérifie pas les étiquettes protégées, car vous choisissez vous-même l’objet. Les dépendances sont toujours vérifiées. Après la suppression :

- L’artefact quitte les listes et les recherches. Un nouveau téléchargement échoue avec 404. Un téléchargement déjà en cours peut se terminer.
- La version du paquet reste réservée.
- Les octets restent sur le disque jusqu’à ce que le [nettoyage physique](#physical-cleanup) les supprime après le délai de grâce.
- Vous ne pouvez pas l’annuler dans la console ni dans l’API.

Pour de nombreux artefacts, l’API propose [previewRetention](../api/reference/storage#previewRetention) et [applyRetention](../api/reference/storage#applyRetention). Un aperçu liste les candidats publiés avant une date avec leurs raisons de blocage. Apply ne supprime que les ID que vous transmettez, 100 au plus par appel, et renvoie un résultat pour chaque ID : `deleted`, `already_deleted`, `protected`, `changed`, `not_eligible` ou `not_found`. Vérifiez chaque résultat, pas seulement le statut HTTP.

## Diagnostics et événements de stockage {#diagnostics}

La section [[ui:storageEvents]] liste ce qui s’est passé dans le dépôt, du plus ancien au plus récent, 100 par page. Sélectionnez [[ui:storageMore]] pour la page suivante. Sa lecture nécessite `diagnostics.read`. L’opération d’API est [getStorageEvents](../api/reference/storage#getStorageEvents), avec un filtre par niveau (`info`, `warning`, `error`).

| Événement                                                                                             | Niveau                 | Signification                                                                                                   |
| ----------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `storage.policy_updated`                                                                              | info                   | La politique de rétention a été enregistrée                                                                     |
| `retention.completed`                                                                                 | info                   | Un lot a supprimé des builds. L’événement contient le nombre                                                    |
| `retention.failed`                                                                                    | error                  | La suppression automatique s’est arrêtée, par exemple parce que la clé d’autorisation a été révoquée            |
| `cleanup.configured`                                                                                  | info                   | Les paramètres de nettoyage ont été enregistrés                                                                 |
| `cleanup.completed`                                                                                   | info ou error          | Un lot de nettoyage a traité, ignoré ou échoué sur des fichiers. Il liste les nombres et les octets libérés     |
| `capacity.normal`, `capacity.warning`, `capacity.critical`, `capacity.exceeded`, `capacity.unlimited` | info, warning ou error | L’état du quota a changé                                                                                        |
| Codes d’erreur HTTP                                                                                   | warning ou error       | Une requête d’une clé gérée vers ce dépôt a échoué. L’événement conserve l’ID de requête, la route et le statut |

L’historique est borné : 1000 événements par dépôt et 20 000 au total, et les plus anciens sont supprimés. Il s’agit de diagnostics au mieux, pas d’un journal à livraison garantie. Exportez ce dont vous avez besoin à temps, et utilisez le journal du serveur comme preuve à long terme. Voir [Supervision](./monitoring).

Le panneau affiche aussi l’utilisation : les octets publiés, les téléversements inachevés, les octets qui attendent le nettoyage, et le total par rapport au quota. L’opération d’API est [getStorageUsage](../api/reference/storage#getStorageUsage).

## Quand le disque est plein {#disk-full}

Signes : les téléversements échouent avec HTTP 507 et la raison `storage_full`, `GET /health/ready` affiche `writable: false`, ou le système d’exploitation signale qu’il n’y a plus d’espace libre. Les téléchargements continuent de fonctionner. Les clients peuvent reprendre leurs téléversements après que vous avez libéré de l’espace.

1. **Trouvez la cause.** Vérifiez l’espace libre du volume de stockage, du volume de la base de données et du volume du coffre. Comparez les chiffres d’utilisation dans le panneau de stockage. Des chiffres élevés pour « en attente de nettoyage » signifient que des données supprimées sont encore sur le disque. Un chiffre élevé pour « téléversements inachevés » signifie des téléversements abandonnés.
2. **Lancez le nettoyage.** Si le nettoyage est désactivé, activez-le dans chaque dépôt, avec un court délai de grâce tel que 0 si vous acceptez que les fichiers supprimés disparaissent immédiatement. Sélectionnez [[ui:cleanupRun]]. Il supprime aussi les parties temporaires des téléversements terminés et les téléversements expirés. Attendez les lots et lisez le dernier résultat. Le nettoyage ignore les fichiers en cours d’utilisation, alors répétez-le.
3. **Supprimez ce dont vous n’avez pas besoin.** Appliquez une politique de rétention, ou supprimez des artefacts. Cela ne libère de l’espace qu’après que le nettoyage a supprimé les octets.
4. **Ajoutez de l’espace.** Étendez le volume ou le disque. Déplacez le coffre ou d’autres données hors du volume s’ils le partagent.
5. **Vérifiez la reprise.** Une fois l’espace libre, `writable` repasse à `true` et les téléversements fonctionnent à nouveau.

Ne supprimez pas de fichiers dans `blobs/`, `staging/` ou `parts/` à la main : cela rompt le lien entre la base de données et le disque. Si la réserve est trop petite pour vos journaux et votre base de données sur le même volume, augmentez `ARKVORY_STORAGE_RESERVE_BYTES`.

Si un téléversement échoue avec la raison `storage_quota` ou `catalog_limit` à la place, le disque n’est pas le problème. Augmentez le quota ou la limite globale, ou supprimez des données.

## Limites {#limits}

- La politique de rétention ne traite que les builds UPack enregistrés. Elle ne supprime jamais d’autres fichiers.
- L’ordre de rétention est l’heure de publication, pas le numéro de version.
- Le stockage, les quotas et le nettoyage nécessitent des actions explicites de clé de service. Les comptes à mot de passe et la clé de récupération ne les ont pas.
- Le nettoyage physique est désactivé par défaut et se définit pour chaque dépôt.
- Un artefact supprimé ne peut pas être restauré. Restaurez les données depuis une sauvegarde. Voir [Sauvegardes](./backups).
- Les dépôts en miroir n’exécutent aucune politique de stockage. Voir [Miroirs](./mirrors).
- Le stockage doit être un système de fichiers local. Les partages réseau et les multiples backends de stockage ne sont pas pris en charge.

## Pages associées {#related-pages}

- [Sauvegardes](./backups)
- [Miroirs](./mirrors)
- [Supervision](./monitoring)
- [Dépannage](./troubleshooting)
- [Variables d’environnement](../reference/environment)
- [Dépôts](../use/repositories)
