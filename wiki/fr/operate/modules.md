---
title: Modules
description: Installer des paquets de modules signés sur un hôte, les activer, les vérifier, les supprimer et conserver les clés des auteurs de plugins auxquels vous faites confiance.
---

# Modules

Un paquet de module ajoute une fonction à Arkvory. Arkvory n'installe que les paquets dont il peut vérifier la signature. Les commandes de cette page s'exécutent sur l'hôte de l'installation, en root sous Linux ou en administrateur sous Windows. La console et l'API HTTP ne peuvent ni installer de modules ni faire confiance à des clés : un compte administrateur de la console volé ne permet donc pas d'exécuter du code sur le serveur.

Les services vérifient de nouveau les modules installés et les chargent à chaque démarrage. Un module ne s’exécute qu’une fois que vous l’avez activé.

## Installer un paquet {#install}

1. Copiez le fichier du paquet `arkvory-module-<id>-<version>.tgz` sur l'hôte.
2. Vérifiez-le et lisez ses conditions :

   ```bash
   sudo arkvory module install /root/arkvory-module-sample-1.0.0.tgz --root /opt/proanima-arkvory
   ```

   La commande affiche le module, ses rôles, les données qu'il conserve, la clé de signature et le SHA-256 du paquet, puis les conditions du module. Rien ne change encore.

3. Installez-le :

   ```bash
   sudo arkvory module install /root/arkvory-module-sample-1.0.0.tgz --root /opt/proanima-arkvory --yes
   ```

Arkvory refuse un paquet quand :

| Raison                                                                                                                    | Code dans le message                                           |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| La signature ne vient pas d'une clé de modules ProAnimaStudio, ou le manifeste a changé                                   | `unknown_key`, `wrong_key_class`, `signature_invalid`          |
| Un fichier manque, a changé ou n'est pas listé dans le manifeste                                                          | `file_missing`, `file_mismatch`, `file_unlisted`               |
| L'archive contient des liens, des périphériques, des chemins hors du paquet ou des noms qui ne diffèrent que par la casse | `link_entry`, `special_entry`, `unsafe_path`, `case_collision` |
| L'archive contient un module natif (`.node`)                                                                              | `native_addon`                                                 |
| Le module a besoin d'une autre version d'Arkvory                                                                          | `module_incompatible`                                          |
| ProAnimaStudio a révoqué cette version                                                                                    | `module_revoked`, avec la version de remplacement              |
| Aucune liste de révocation à jour (voir plus bas)                                                                         | `stale_revocations`                                            |

Limites : 1 Gio par paquet, 256 Mio par fichier, 4096 fichiers. Un paquet plus grand est refusé avant la lecture de ses données.

Une version déjà installée avec les mêmes octets reste telle quelle. La même version avec d'autres octets est refusée.

## Activer et charger un module {#load}

Un module installé reste désactivé jusqu’à ce que vous l’activiez. Les services ne chargent les modules qu’au démarrage.

1. Ajoutez le module au fichier des modules (`ARKVORY_MODULES_FILE`, voir [Variables d’environnement](../reference/environment#core)). Les paramètres du module vont dans `config` :

   ```json
   { "format": 1, "modules": { "sample": { "enabled": true } } }
   ```

2. Si le module conserve des fichiers, approuvez la taille de son répertoire de données avec `resources`, par exemple `"resources": { "dataMiB": 512, "dataFiles": 10000 }` à côté de `enabled`. Elle remplace la taille demandée par le paquet. Voir [Répertoire de données d’un module](#data).
3. Redémarrez les services, comme dans [Appliquer une modification](../install/configuration#apply-change).
4. Vérifiez le module en tant qu’administrateur global : `GET /api/v1/system/modules` l’affiche avec `running: true` et `health.status` `ok` sur l’API et sur chaque passerelle de lecture.

Les modules signés fonctionnent dans l’API, les passerelles de lecture, le worker et l’agent de sauvegarde selon leurs rôles déclarés. Chaque processus fournit uniquement les services de son rôle déclarés dans `uses`. Les routes nécessitent `routes`. Docker Compose ne charge pas encore les modules.

Les stockages des modules sont enregistrés sous `<module>.<name>` et peuvent recevoir les nouveaux téléversements. Si un stockage refuse de nouvelles écritures, les nouveaux téléversements reviennent à `default`. Le cœur vérifie tous les octets avant de publier un objet assemblé. Le nettoyage attend les lecteurs actifs, toutes les protections des sauvegardes et la barrière de capture. Les calculs utilisent des threads limités. Les abonnements acquittent les événements après un traitement réussi et peuvent les livrer de nouveau après une erreur.

Avant qu’un service importe le moindre code d’un module, il vérifie de nouveau le paquet :

1. Seuls root (sous Windows : SYSTEM et Administrators) ou le propriétaire du répertoire d’installation peuvent modifier le répertoire d’installation, `modules/`, l’ensemble des modules, la liste de révocation et son répertoire. L’installation le prévoit ainsi. Un fichier qu’un autre compte peut modifier et un lien dans un paquet sont refusés (`access_unsafe`, `access_link`).
2. La signature, chaque fichier et la version d’Arkvory, comme `module install` les vérifie.
3. La liste de révocation. Une version révoquée n’est jamais chargée. Une liste expirée ou l’absence de liste n’arrêtent pas un module.

Un module qui échoue à une vérification n’est pas chargé ; les autres modules et Arkvory continuent. `GET /api/v1/system/modules` l’affiche avec `running: false` :

| `health.status` | Signification                                                              | Codes                                                                                                                |
| --------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `failed`        | Le paquet a été refusé, ou son code ne s’est pas chargé ou n’a pas démarré | `file_mismatch`, `unknown_key`, `module_incompatible`, `access_unsafe`, `config_invalid`, `start_failed` et d’autres |
| `revoked`       | ProAnimaStudio a révoqué cette version                                     | le motif de la liste de révocation                                                                                   |
| `unavailable`   | Le répertoire du paquet manque sur l’hôte                                  | `module_unavailable`                                                                                                 |

Un module en échec ne rend Arkvory non prêt (`/health/ready` répond 503 avec `module_failed`) que si un autre module activé en a besoin. Un module qui stocke les octets des fichiers publiés (données `layout`) ne le fait jamais : Arkvory continue de servir ses données et écrit les nouveaux envois dans son propre stockage au lieu de celui du module. Le journal enregistre `module.refused` et `module.failed` avec le code dans `errorCode`.

Pour réparer un paquet modifié ou absent, installez-le de nouveau. Tous les services de l’installation doivent voir les mêmes modules, activés ou non : une passerelle de lecture ou un worker avec d’autres modules n’est pas prêt (`module_plan_mismatch`). Installez les mêmes paquets sur l’hôte de chaque passerelle de lecture.

### Répertoire de données d’un module {#data}

Un module qui conserve ses propres index, caches ou état obtient un répertoire sur le volume de données : `module-data/<id>/` dans le répertoire de stockage `default`. Sa partie `data` est destinée aux sauvegardes, sa partie `cache` ne l’est pas. Arkvory compte chaque écriture dans la taille approuvée, en Mio et en fichiers, pour les deux parties ensemble. Une écriture au-delà est refusée (`module_quota_exceeded`) et le module continue de fonctionner. Sans taille approuvée, le module peut seulement lire. La [réserve du volume](./storage#disk) s’applique aussi. Sur une passerelle de lecture, le module lit les mêmes fichiers et ne peut pas les modifier.

La suppression d’un module conserve son répertoire. Supprimez `module-data/<id>/` vous-même lorsque vous n’avez plus besoin des données. Les sauvegardes n’incluent pas encore les répertoires des modules.

Avant de passer à extension API 0.7.0, arrêtez tous les anciens processus API et worker qui écrivent des données de modules. Les nouveaux processus partagent le suivi des quotas via le coordinateur PostgreSQL de l’installation ; les fichiers temporaires comptent aussi. L’écriture simultanée par des anciens et des nouveaux processus n’est pas prise en charge. Après un arrêt brutal, Arkvory reconstruit le suivi si nécessaire et ne supprime les répertoires temporaires du nouveau protocole qu’après avoir acquis le verrou en base de données de leur ancien propriétaire. Les anciens fichiers temporaires ne sont pas supprimés automatiquement et restent comptabilisés ; examinez-les séparément, une fois les processus d’écriture arrêtés. Les processus backup ont uniquement accès en lecture.

## Routes des modules {#routes}

Un module peut ajouter des routes HTTP sous son propre préfixe `/api/ext/<id>/v<major>/`, par exemple `/api/ext/sample/v1/`. Arkvory vérifie chaque requête avant que le code du module ne s’exécute :

| Vérification     | Comme pour `/api/v1`                                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identifiants     | Les mêmes clés, sessions et jetons ; une route est ouverte à tout appelant connecté ou seulement à l’administrateur global                                                                      |
| Permission       | La permission que la route nomme sur le dépôt de son chemin, comme `content.read` ou `upload.create` : une clé de service en a besoin, un compte a besoin de son droit de lecture ou d’écriture |
| Corps de requête | La limite de taille de la route, les limites de téléversement, les délais et la bande passante du serveur                                                                                       |
| Fichiers         | Envoyés par Arkvory lui-même : ETag, Range, `If-Range`, 304, la file de téléchargements et la bande passante de téléchargement                                                                  |

Les erreurs ont le format d’erreur de l’API. Un module ne voit jamais les identifiants ni les autres en-têtes. Une passerelle de lecture sert les routes de lecture d’un module et répond `read_only` aux autres.

Chaque module décrit ses routes dans un document OpenAPI, et Arkvory compare les deux au démarrage du module. Un module dont les routes enfreignent les règles ne démarre pas et ne sert rien ; Arkvory continue. `GET /api/v1/system/modules` l’affiche avec `running: false` et `health.status` `failed` :

| Code                     | Signification                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `routes_invalid`         | Une route enfreint les règles, par exemple un chemin hors du préfixe du module ou une modification ouverte à tout appelant connecté |
| `openapi_invalid`        | Le document OpenAPI manque ou n’est pas valide                                                                                      |
| `openapi_route_mismatch` | Une route n’a pas d’opération dans le document, ou une opération n’a pas de route                                                   |
| `transfer_invalid`       | Le module propose un protocole de transfert qu’il ne peut pas proposer                                                              |

Les documents des routes :

| Adresse                                                                                     | Qui peut la lire        | Contenu                                                                                                |
| ------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /api/ext/openapi.json`                                                                 | Tout appelant connecté  | Les routes de tous les modules que ce service exécute, avec les opérations que l’appelant peut appeler |
| [`GET /api/v1/system/modules/{id}/openapi`](../api/reference/system#getSystemModuleOpenApi) | L’administrateur global | Les routes d’un module                                                                                 |

`/api/v1/openapi.json` ne liste jamais les routes des modules. Un module du type `transfer` peut proposer une autre façon de transférer les fichiers : `GET /api/v1/capabilities` la liste dans `transfer`. Un client ne l’utilise qu’avec une extension correspondante ; sinon, il transfère les fichiers comme d’habitude.

## Mettre à jour, épingler, revenir en arrière {#versions}

Installez le fichier de la nouvelle version avec `--yes`. Le paquet précédent reste sur l'hôte jusqu'au prochain changement de modules.

| Tâche                                  | Commande                                                        |
| -------------------------------------- | --------------------------------------------------------------- |
| Garder la version installée            | `sudo arkvory module pin sample 1.0.0 --root …`                 |
| Autoriser de nouveau d'autres versions | `sudo arkvory module pin sample --unpin --root …`               |
| Installer une version plus ancienne    | `sudo arkvory module install <file> --downgrade --yes --root …` |

Un module épinglé refuse toute autre version jusqu'à ce que vous retiriez l'épinglage. Une version plus ancienne que la version installée, ou qu'une version supprimée dont le paquet est encore sur l'hôte, exige `--downgrade`.

## Vérifier les modules installés {#list}

```bash
sudo arkvory module list --root /opt/proanima-arkvory
```

La commande vérifie de nouveau chaque paquet installé, comme le font les services avant de le charger : la signature, chaque fichier et l'archive. Chaque module affiche un état :

| État                 | Signification                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ok`                 | Le paquet est intact                                                                                                |
| `refused: <code>`    | Un fichier a été modifié, ajouté ou remplacé par un lien (`file_mismatch`, `file_unlisted`, `link_entry` et autres) |
| `revoked (<reason>)` | ProAnimaStudio a révoqué cette version. `read path only` signifie que ses données restent lisibles                  |

Un paquet refusé n'est jamais utilisé. Pour le réparer, installez de nouveau le fichier du paquet.

## Supprimer un module {#remove}

```bash
sudo arkvory module remove sample --root /opt/proanima-arkvory
```

Le module quitte l'installation et son paquet reste sur l'hôte jusqu'au prochain changement de modules. Un module qui stocke les octets des fichiers publiés (données `layout`) ne peut pas être supprimé : Arkvory refuse avec `module_owns_data`, pour que ses données ne deviennent jamais illisibles.

## Liste de révocation {#revocations}

ProAnimaStudio publie une liste signée des versions de modules révoquées. Chaque liste porte un numéro, et Arkvory n'accepte jamais une liste dont le numéro est inférieur à celui de la liste qu'il possède. Un paquet de module peut contenir une liste plus récente : Arkvory la conserve quand vous installez le paquet. Sur un hôte sans accès au hub, enregistrez vous-même un fichier de liste :

```bash
sudo arkvory module revocations /root/module-revocations.json --root /opt/proanima-arkvory
```

Chaque liste est signée avec une date d'expiration : 90 jours par défaut, jamais plus de 180. `module install` et `module pin <id> <version>` exigent une liste à jour ; avec une liste expirée ou sans liste, ils refusent avec `stale_revocations`. Un paquet qui porte une liste à jour compte. Pour continuer malgré tout, ajoutez `--allow-stale-revocations` : Arkvory affiche un avertissement et enregistre la décision dans `modules/audit.jsonl`. Une liste expirée n'arrête jamais les modules installés : ils continuent de fonctionner et leurs données restent lisibles ; seule une entrée de révocation arrête une version. Une liste de numéro supérieur remplace toujours la liste stockée, même si elle a expiré.

Lorsque ProAnimaStudio remplace sa clé de signature des modules, une version porte les deux clés et la liste suivante est signée avec la nouvelle clé ; seule une version ultérieure retire l'ancienne clé. La mise à jour vers cette version est refusée tant que l'hôte stocke une liste signée avec l'ancienne clé : stockez d'abord une liste à jour. `sudo arkvory module check-revocations --root …` indique si cette version fait confiance à la clé de la liste stockée.

## Faire confiance à un auteur de plugins {#trust}

Les plugins de votre équipe ou d'un autre auteur sont signés avec la clé de l'auteur. Ajoutez la clé à la liste de confiance de l'hôte avant d'installer ces plugins. La liste de confiance appartient à l'hôte : les services peuvent la lire, mais pas la modifier.

1. Obtenez de l'auteur le fichier de clé publique (`.pub`, format minisign), et son empreinte par un autre canal.
2. Affichez la clé et comparez l'empreinte :

   ```bash
   sudo arkvory module trust add /root/acme.pub --label "Acme platform team" --plugins "op-acme-*" --root /opt/proanima-arkvory
   ```

3. Ajoutez-la avec `--yes`.

| Option               | Signification                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `--label`            | Qui détient la clé ; obligatoire                                                                                        |
| `--plugins`          | Ids de plugins que la clé peut signer, séparés par des virgules : un id exact ou un préfixe avec `*`. Par défaut `op-*` |
| `--expires`          | Heure UTC comme `2027-01-31T00:00:00Z`. Ensuite, la clé n'accepte plus de nouvelle installation                         |
| `--allow-in-process` | Permet aux plugins de la clé de s'exécuter dans le processus d'Arkvory. Ce code reçoit tous les droits du service       |

Les ids de plugins commencent toujours par `op-`. Une clé de plugins ne signe jamais de modules ProAnimaStudio, et les clés ProAnimaStudio ne signent jamais de plugins `op-`. Une clé que l'hôte connaît déjà sous un autre id ou comme clé d'une autre sorte est refusée (`duplicate_key`). Les signatures doivent être pré-hachées, le choix par défaut des versions actuelles de minisign ; les anciennes signatures sont refusées avec `signature_algorithm`.

`sudo arkvory module trust list --root …` affiche les clés de confiance. `sudo arkvory module trust remove <key id> --root …` en supprime une.

Cette version tient la liste de confiance ; les plugins seront installés par une version ultérieure.

## Après une interruption {#recover}

Chaque changement de l'ensemble des modules est enregistré dans le journal des mises à jour. Si une commande s'arrête en cours de route, la commande de déploiement suivante est refusée avec `Interrupted deployment`. Exécutez `sudo arkvory recover --root …` : elle rétablit l'ensemble de modules précédent. D'ici là, toute commande de modules qui modifie quelque chose est refusée, y compris `module trust` et `module revocations`.

## Durée de la requête du module {#request-scope}

La route utilise les droits de l’appelant jusqu’à la fin de la réponse, y compris en flux. L’annulation ou la fin révoque les droits et ferme les ressources de lecture. `upload-read` lit les parties acceptées des envois inachevés et vérifie le propriétaire, `upload.read`, la plage et l’annulation. Les modules peuvent retirer leurs offres de transfert en cours d’exécution. Les prochaines requêtes de capacités les omettent ; routes et transferts actifs restent disponibles. Le client peut garder des offres en cache : la route doit vérifier chaque opération.

## Récupération du cache dérivé {#derived-cache}

Les modules signés peuvent déclarer `derived-cache` (extension API 0.9.0). API et worker construisent et lisent des générations immuables ; reader lit seulement et backup ne reçoit pas le service. Les droits sur la source sont vérifiés à chaque requête. Le budget couvre les anciens fichiers/cache et les générations retenues. Une absence du cache nécessite une régénération ou un repli.

La perte d’une session PostgreSQL ne prouve pas l’arrêt des E/S de fichiers. Les réservations des propriétaires incertains et les références persistantes des lecteurs restent comptabilisées. Appliquez d’abord les migrations de cette version du noyau. Avant récupération, arrêtez tous les hôtes participants et confirmez la fin de leurs processus et E/S, ou prouvez la fin de l’instance exacte du processus propriétaire et l’impossibilité de sa reprise ; isolez par fencing les hôtes injoignables. Relevez l’UUID exact dans les diagnostics et consignez les preuves. PID, délai expiré ou absence de verrou SQL ne suffisent pas.

Sur l’hôte de confiance, avec `ARKVORY_DATABASE_URL` configuré, exécutez la commande ci-dessous avec les paquets compilés de cette version. Le drapeau atteste l’arrêt physique ; un verrou actif du propriétaire interdit toujours la récupération. Sans confirmation, aucune action. Reprenez ensuite la réconciliation et vérifiez la libération : la confirmation ne rend pas immédiatement le quota. Il s’agit de maintenance de l’hôte, pas d’un droit de module ou de CLI distant.

```sh
node scripts/recover-derived-cache.mjs --owner UUID --confirm-owner-stopped
```

## État de coordination des modules {#module-state}

Extension API 0.10.0 ajoute un registre d’état atomique et limité pour les modules signés. Il survit au basculement HA, mais ne figure pas dans les sauvegardes logiques portables. Après restauration, suivez la procédure explicite de réinitialisation du module ; la lecture et la restauration des objets doivent rester disponibles. Cet état est distinct du stockage des objets et une réinstallation du module ne le réinitialise pas.
