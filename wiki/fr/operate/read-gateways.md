---
title: Passerelles de lecture
description: 'Exécutez des processus API supplémentaires réservés au téléchargement sur le même serveur et le même stockage, partagez un même budget de téléchargement entre eux et supervisez-les.'
---

# Passerelles de lecture

Une **passerelle de lecture** est un processus API supplémentaire qui ne sert que les téléchargements. Elle s’exécute sur le même serveur que l’API principale (le **processus d’écriture**), utilise la même base de données PostgreSQL et le même répertoire de stockage, et partage un même budget de téléchargement avec le processus d’écriture et les autres passerelles.

Utilisez les passerelles pour répartir de nombreux téléchargements parallèles sur plusieurs processus, tandis que le débit de téléchargement total reste sous une limite que vous fixez. Une passerelle ne copie pas de données. Elle lit les fichiers que le processus d’écriture a publiés, de sorte qu’une passerelle n’est jamais en retard. Elle ne vous protège pas non plus de la perte du serveur ou du disque. Pour cela, voir [Sauvegardes](./backups) et [Miroirs](./mirrors).

## Fonctionnement {#how-it-works}

- L’installation comporte un processus d’écriture et jusqu’à 15 passerelles de lecture. Ensemble, ils forment au plus 16 **emplacements**. Le processus d’écriture utilise toujours l’emplacement 0. Chaque passerelle utilise son propre emplacement, de 1 au nombre d’emplacements moins un.
- Tous les processus utilisent une seule base de données PostgreSQL et un seul répertoire de stockage. Une passerelle vérifie que le stockage existe et appartient à la base de données. Elle ne le crée jamais.
- Vous fixez un débit de téléchargement total pour tous les processus. Chaque processus reçoit une part fixe égale : le total divisé par le nombre d’emplacements, arrondi à l’inférieur.
- Un processus occupe son emplacement au moyen d’un bail dans la base de données. S’il perd le bail, il cesse de servir de nouvelles données utiles et doit être redémarré. Cela maintient la somme de toutes les parts sous le total.

Le processus d’écriture conserve son rôle normal. Il prend en charge les téléversements, la console, le nettoyage en arrière-plan et tous les changements. Une passerelle n’exécute jamais le nettoyage.

## Ce qu’une passerelle refuse {#refusals}

Une passerelle n’accepte que `GET` et `HEAD`. Toute requête qui modifie quelque chose reçoit HTTP 405 avec l’en-tête `Allow: GET, HEAD` et le code `read_only`, même lorsque la clé possède des droits d’écriture. Cela inclut la connexion et l’auto-enregistrement. La console fait partie du seul processus d’écriture, elle n’est donc pas disponible sur une passerelle.

Les autorisations de dépôt sont vérifiées à chaque lecture, comme sur le processus d’écriture. Les sessions, les jetons d’accès personnels et les clés de service fonctionnent sur une passerelle pour la lecture.

## Prérequis {#requirements}

- **Le même serveur.** La passerelle doit voir exactement les fichiers que le processus d’écriture a publiés, sans délai. Des disques indépendants avec `rsync` ou une autre copie asynchrone ne conviennent pas. Aucun système de fichiers réseau n’est encore certifié, alors utilisez les passerelles pour plusieurs processus sur un seul serveur.
- **Les mêmes clés de service.** Donnez à chaque processus le même contenu de `ARKVORY_KEYS_FILE`, afin que les clés de fichier et leurs ID correspondent. Les clés de service gérées vivent dans la base de données, elles correspondent donc d’elles-mêmes.
- **Son propre port.** Chaque processus sur le même hôte a besoin de son propre `ARKVORY_PORT`.
- **Une vue en lecture seule des fichiers.** Lorsque vous le pouvez, montez le répertoire de stockage en lecture seule pour la passerelle. Le refus HTTP ne remplace pas les droits du système d’exploitation. Notez que la passerelle écrit quand même dans la base de données : les baux, les diagnostics de stockage, l’heure de dernière utilisation des jetons d’accès personnels et les verrous qui protègent les fichiers en cours de lecture.
- **Connexions à la base de données.** Chaque passerelle a besoin d’une connexion de plus que `ARKVORY_DATABASE_POOL_SIZE`. Comptez-les dans `max_connections` de PostgreSQL.

## Exécuter une passerelle {#run}

Les programmes d’installation enregistrent l’API, le processus de traitement et l’agent de sauvegarde. Ils n’enregistrent pas de passerelle, et `arkvory status` ne la gère pas. Vous démarrez vous-même une passerelle, comme une instance supplémentaire du programme API de la version installée, avec son propre environnement et sous votre propre gestionnaire de services.

Paramètres identiques pour tous les processus, pour deux processus au total avec 64 MiB/s au global et 16 MiB/s pour un compte ou une clé :

```dotenv
ARKVORY_GATEWAY_SLOTS=2
ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND=67108864
ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL=16777216
```

Le processus d’écriture ajoute :

```dotenv
ARKVORY_ROLE=api
ARKVORY_GATEWAY_SLOT=0
```

Une passerelle ajoute :

```dotenv
ARKVORY_ROLE=reader
ARKVORY_GATEWAY_SLOT=1
ARKVORY_PORT=8081
```

La passerelle a aussi besoin du reste des paramètres de l’API : `ARKVORY_DATABASE_URL` de la même base de données, `ARKVORY_DATA_DIR` qui mène au même stockage (le chemin peut différer, l’identité du stockage doit correspondre), `ARKVORY_KEYS_FILE` et les paramètres HTTPS si la passerelle est joignable depuis d’autres ordinateurs. Voir [Variables d’environnement](../reference/environment#read-gateways).

| Variable                                                 | Règle                                                                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_GATEWAY_SLOTS`                                  | Le nombre de processus, processus d’écriture compris, 2–16                                                                            |
| `ARKVORY_GATEWAY_SLOT`                                   | L’emplacement de ce processus, de 0 au nombre d’emplacements moins un. Le processus d’écriture vaut 0, une passerelle ne vaut pas 0   |
| `ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND`               | Obligatoire. Le débit total de tous les processus, au moins 65 536 fois le nombre d’emplacements, au plus 1 TiB par seconde           |
| `ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL` | Le débit total pour un compte ou une clé sur l’ensemble des processus. `0` signifie aucune limite. Sinon, la même plage que ci-dessus |

Si vous définissez l’une de ces variables, définissez l’emplacement, le nombre d’emplacements et le débit total sur chaque processus. Une valeur invalide arrête le processus au démarrage avec un message qui nomme la variable. Une passerelle sans configuration de téléchargement partagé refuse de démarrer.

1. Décidez du nombre d’emplacements et des débits.
2. Ajoutez les trois variables communes et les deux variables propres au processus d’écriture à celui-ci, puis redémarrez-le. Il enregistre la politique dans la base de données.
3. Démarrez la passerelle avec ses propres variables. Si ses valeurs diffèrent de la politique enregistrée, elle ne démarre pas.
4. Vérifiez la disponibilité de chaque processus, et testez un téléchargement par plage sur chacun. Voir [Superviser les passerelles](#monitoring).
5. Ajoutez seulement alors la passerelle à votre répartiteur de charge.

Quelques règles protègent le profil :

- Une passerelle ne peut démarrer qu’après que le processus d’écriture a enregistré la politique.
- Une fois la politique présente dans la base de données, un processus d’écriture sans ces variables ne démarre pas. Il s’arrête avec le message indiquant que la base de données exige la configuration de téléchargement partagé.
- Vous ne pouvez pas modifier les débits ni le nombre d’emplacements sur une installation en cours d’exécution. Voir [Modifier la configuration](#change).

## Le budget de téléchargement {#budget}

Chaque processus reçoit `total / slots`, arrondi à l’inférieur. Il en va de même pour le débit d’un compte ou d’une clé. Par exemple, avec 64 MiB/s et 2 emplacements, chaque processus sert jusqu’à 32 MiB/s, et un compte obtient jusqu’à 8 MiB/s dans chaque processus.

- Un processus ne peut pas utiliser la part d’un autre. Si l’un des deux processus est arrêté, vous obtenez la moitié du total. Cela garde la limite simple et vérifiable.
- Les paramètres locaux `ARKVORY_DOWNLOAD_BYTES_PER_SECOND` et `ARKVORY_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL` peuvent abaisser une part, pas l’augmenter.
- Les budgets de téléversement restent sur le processus d’écriture, car les passerelles ne prennent aucun téléversement.
- La file des transferts en attente et la limite des transferts actifs restent locales à chaque processus, de sorte que les capacités de tous les processus s’additionnent.

La limite s’applique aux données utiles de l’application, avec une petite rafale. Ce n’est pas une limite sur l’interface réseau. Voir [Variables d’environnement](../reference/environment#transfers-and-bandwidth).

## Baux et défaillances {#leases}

La base de données réserve un emplacement pendant 10 secondes. Un processus le renouvelle toutes les 2 secondes, et il fait localement confiance au bail pendant au plus 8 secondes. Un bail arrivé à expiration n’est jamais ranimé, même lorsqu’une réponse tardive arrive.

- **Bail perdu.** Le processus cesse de distribuer de nouvelles données utiles, répond aux nouvelles requêtes autorisées avec 503 et nécessite un redémarrage. Un téléchargement interrompu peut reprendre avec une nouvelle tentative ou une requête par plage. Cela s’applique aussi au processus d’écriture.
- **Redémarrage du même emplacement.** Le nouveau processus attend que l’ancienne réservation expire, jusqu’à 10 secondes après son dernier renouvellement, et jusqu’à 15 secondes au total. Si une passerelle en cours d’exécution détient encore l’emplacement, le nouveau processus s’arrête avec `busy`.
- **Horloges.** Les baux reposent sur des horloges stables. Un saut de l’horloge du serveur de base de données, ou une machine virtuelle arrêtée, peut laisser un processus servir au-delà de son bail. Dans ce cas, arrêtez les anciens processus avant de démarrer un remplaçant.
- **Défaillance de la base de données.** La base de données est le point faible. Si elle devient injoignable, les baux expirent et tous les processus cessent de servir des données utiles.

Le serveur ne peut remarquer un processus mort qui a perdu son réseau que par le keepalive TCP. Définissez `tcp_keepalives_idle`, `tcp_keepalives_interval` et `tcp_keepalives_count` sur PostgreSQL, par exemple à 10, 5 et 3 secondes, ou définissez `tcp_user_timeout`. Sans eux, un nouveau processus d’écriture ou de traitement peut attendre le long délai d’expiration par défaut du système d’exploitation.

## Superviser les passerelles {#monitoring}

- `GET /health/status` est public et renvoie uniquement `ready`, `unavailable` ou `draining`, avec 503 lorsque le processus ne peut pas servir (emplacement ou bail perdu, vidage). Utilisez-le pour votre répartiteur de charge.
- `GET /health/ready` nécessite une clé. Il renvoie `role`, `writable` (toujours `false` sur une passerelle), `sharedDownloads` avec `slot`, `slots`, `active` et `leaseSeconds`, et les nombres des files de transfert locales. Il répond 503 lorsque l’emplacement est perdu. Pour une installation autonome, `sharedDownloads` vaut `null`.
- `GET /health/live` montre seulement que le processus HTTP fonctionne. Il n’indique pas si une passerelle peut servir.
- `GET /health/metrics` de chaque processus ne montre que ce processus. Collectez chaque passerelle et utilisez les métriques HTTP et de transfert au niveau du processus.

Vérifiez chaque processus séparément. Une passerelle avec `writable` à false est normale. Voir [Supervision](./monitoring).

## Acheminer les requêtes {#routing}

Le répartiteur de charge est le vôtre. Arkvory ne fournit aucun répartiteur.

- Envoyez au processus d’écriture toute requête qui modifie des données, ainsi que `/console/`.
- Vous pouvez répartir les lectures d’octets entre le processus d’écriture et les passerelles : `GET` et `HEAD` pour `/api/v1/repositories/NAME/artifacts/ID/content`, pour `.../packages/content` et pour `.../asset/content`. Gardez les autres requêtes sur le processus d’écriture.
- Transmettez les en-têtes `Authorization`, `Range`, `If-Range` et `ETag`. Diffusez le corps en flux sans mettre en mémoire tout le fichier. Ne redirigez pas un client vers une URL qui porte une clé.
- N’ajoutez un backend au répartiteur que lorsque sa disponibilité authentifiée est correcte.

Le SDK TypeScript peut poursuivre un téléchargement interrompu via un autre backend sain derrière la même adresse. Une connexion TCP en cours ne se déplace pas d’un serveur à l’autre.

## Modifier la configuration {#change}

Vous ne pouvez pas modifier les débits ni le nombre d’emplacements pendant que l’installation fonctionne, et vous ne pouvez pas revenir à un seul processus tant que la politique existe. Même si toutes les passerelles sont arrêtées, la politique enregistrée empêche un démarrage sans limites.

1. Arrêtez le trafic entrant. Arrêtez le processus d’écriture, chaque passerelle et le processus de traitement, et confirmez qu’ils sont réellement arrêtés.
2. Attendez que les baux dans la base de données aient expiré.
3. Faites une sauvegarde. Voir [Sauvegardes](./backups).
4. Un administrateur de la base de données Arkvory supprime toutes les lignes des tables `arkvory_gateway_leases` et `arkvory_download_policy` dans une seule transaction. Cela réinitialise uniquement l’état de coordination, pas le catalogue.
5. Démarrez le processus d’écriture avec les nouveaux paramètres, puis les passerelles.

Ne faites jamais cela tant qu’un processus peut encore s’exécuter.

Une mise à jour demande le même soin. Arrêtez chaque passerelle avant que l’installation ne se mette à jour, et redémarrez-les depuis la nouvelle version ensuite. Une passerelle qui continue d’exécuter l’ancien code face à un schéma de base de données plus récent se signale comme non disponible. Les outils de réparation hors ligne pour le nettoyage nécessitent eux aussi l’arrêt de toutes les passerelles. Le nettoyage en ligne du processus d’écriture, non.

## Passerelles ou miroirs {#gateways-or-mirrors}

|                                                     | Passerelles de lecture                                                     | Miroirs                                                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Ce que c’est                                        | Plusieurs processus API sur le même serveur et le même stockage            | Une seconde installation indépendante avec une copie des données                                 |
| Données                                             | Une seule copie, lue en direct                                             | Une seconde copie, tirée avec un délai                                                           |
| Comptes et clés                                     | Les mêmes que le processus d’écriture                                      | Les siens                                                                                        |
| Disque supplémentaire                               | Aucun                                                                      | Oui, autant que les dépôts en ont besoin                                                         |
| Nécessite                                           | La même base de données et le même système de fichiers                     | Un lien HTTPS vers la source et une clé en lecture seule                                         |
| Protège contre la perte d’un serveur ou d’un disque | Non                                                                        | Partiellement : il sert pendant que la source est indisponible, et vous pouvez basculer vers lui |
| Utilisez-le pour                                    | Plus de téléchargements parallèles avec une seule limite de débit partagée | Un second site, un bureau plus proche des utilisateurs, une instance de secours                  |

Les deux s’ajoutent aux sauvegardes, ils ne les remplacent pas.

## Limites {#limits}

- Tous les processus doivent partager un seul serveur et un seul répertoire de stockage. Des machines différentes nécessitent un système de fichiers testé pour cela, et aucun ne l’a encore été.
- Il n’y a ni prise en charge par le programme d’installation, ni basculement automatique, ni répartiteur intégré.
- Une seule base de données et un seul processus d’écriture restent un point de défaillance unique.
- Le budget est fixe par emplacement et n’est pas redistribué, et il n’y a pas d’ordonnancement par priorité.
- Vous ne pouvez pas modifier la politique sur une installation en cours d’exécution.

## Pages associées {#related-pages}

- [Miroirs](./mirrors)
- [Supervision](./monitoring)
- [Autoréparation](./self-healing)
- [Variables d’environnement](../reference/environment#read-gateways)
- [Mises à jour](../install/updates)
