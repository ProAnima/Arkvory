---
title: Sites
description: Voir toutes les installations de votre cluster au même endroit, appairer les sites avec un code à usage unique et suivre leur état.
---

# Sites

Un **site** est une installation Arkvory : la principale, un miroir sur un autre emplacement, une installation qui importe des versions d’une autre. Sur [[ui:fleet]], une installation, le **contrôleur**, affiche chaque site qu’il gère : s’il répond, sa version, ses copies HA et passerelles de lecture, ses miroirs et leur retard, et sa file des téléchargements. Seuls les administrateurs globaux voient la page.

## Fonctionnement {#how-it-works}

- Le contrôleur tient une liste de sites. Il lit chaque site toutes les 30 secondes en HTTPS et garde la dernière réponse : un site qui ne répond plus affiche encore son dernier état connu.
- Lors du couplage, le site donne au site de contrôle une clé propre, la **clé de flotte**. Elle n’atteint que ce dont le site de contrôle a besoin : l’état du site et les descriptions de son catalogue. Elle ne peut ni télécharger les octets des fichiers, ni rien modifier, ni lire les comptes et les clés.
- Le contrôleur conserve les clés de flotte scellées par une clé de son répertoire de données (`fleet.key`). La base de données et ses sauvegardes seules ne les révèlent pas. Après une restauration, appairez de nouveau les sites.
- Chaque site montre quels contrôleurs le gèrent et peut les révoquer à tout moment.

## Appairer un site {#pair}

1. Sur le site : ouvrez [[ui:fleet]] et, sous [[ui:fleetThisSite]], choisissez [[ui:fleetMakeCode]]. Le site affiche un code valable dix minutes et, avec le HTTPS intégré, l’empreinte de son certificat.
2. Sur le contrôleur : ouvrez [[ui:fleet]], saisissez l’adresse du site sous [[ui:fleetAdd]] et choisissez [[ui:fleetCheck]]. Le contrôleur se connecte et affiche l’empreinte du certificat reçu.
3. Comparez les deux empreintes. Elles doivent être identiques. Si elles diffèrent, l’adresse est fausse ou quelque chose s’interpose entre les installations : n’appairez pas.
4. Saisissez le code et choisissez [[ui:fleetPair]]. Le site apparaît dans la liste avec son état.

Un code ne sert qu’une fois. Un code utilisé ou expiré est refusé : créez-en un nouveau.

L’adresse est l’adresse HTTPS de l’API du site, par exemple `https://branch.example:8443`. Le HTTP simple n’est accepté que sur le même ordinateur (`127.0.0.1`). Si TLS se termine sur un proxy devant le site, le site ne peut pas montrer le certificat du proxy : comparez avec l’empreinte SHA-256 que votre navigateur affiche pour l’adresse du site.

Le contrôleur fait ensuite confiance à exactement ce certificat. Quand le site reçoit un nouveau certificat, il affiche [[ui:fleetStateCertificate]] : retirez le site et appairez-le de nouveau.

## États {#states}

| État                         | Signification                                                   | Que faire                                                                  |
| ---------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [[ui:fleetStateOk]]          | Le site a répondu à la dernière lecture                         | Rien                                                                       |
| [[ui:fleetStatePending]]     | Le site n’a pas encore été lu                                   | Attendre la prochaine lecture ou choisir [[ui:fleetReadSite]]              |
| [[ui:fleetStateUnreachable]] | Pas de réponse : site arrêté ou réseau en panne                 | Vérifier le site et le réseau. Le dernier état connu reste visible         |
| [[ui:fleetStateCertificate]] | Le site présente un autre certificat que celui confirmé         | Si le certificat a été renouvelé, retirer le site et l’appairer de nouveau |
| [[ui:fleetStateRevoked]]     | L’administrateur du site a révoqué ce contrôleur                | Appairer de nouveau avec un nouveau code                                   |
| [[ui:fleetStateInvalid]]     | Le site a répondu d’une façon que cette version ne comprend pas | Mettre les deux installations à la même version                            |
| [[ui:fleetStateRefused]]     | Le site a refusé la requête                                     | Appairer de nouveau avec un nouveau code                                   |

## Ce que montre la liste {#list}

- **[[ui:fleetVersion]]** : la version du site et son rôle, écriture ou passerelle de lecture.
- **[[ui:fleetCopies]]** : dans un cluster HA, les copies complètes et combien une écriture en exige ; les passerelles de lecture qui tiennent leur emplacement.
- **[[ui:fleetMirrors]]** : les miroirs et imports du site ; de combien de changements le plus en retard suit sa source, ou combien sont arrêtés.
- **[[ui:fleetQueue]]** : les téléchargements en cours et ceux qui attendent dans la file.
- **[[ui:fleetSeen]]** : quand le site a répondu pour la dernière fois.

[[ui:fleetReadAll]] lit tous les sites tout de suite au lieu d’attendre le prochain tour. [[ui:fleetRemoveSite]] oublie un site ici ; révoquez aussi le contrôleur sur le site, car jusque-là sa clé y reste valable.

## Contenu d’un site {#content}

[[ui:fleetContent]] dans la ligne d’un site ouvre sous la liste ses dépôts, artefacts et fichiers. Choisissez un dépôt ; [[ui:fleetFind]] cherche les artefacts par nom ou étiquette et liste les fichiers dont le chemin commence par ce que vous avez saisi. [[ui:fleetMore]] lit la page suivante.

Le site de contrôle les lit sur le site avec sa clé de flotte et affiche la réponse telle que le site l’a donnée. Seules les descriptions transitent : noms, tailles, étiquettes, étapes, chemins et révisions. Pour télécharger un fichier, utilisez le site lui-même.

## Qui gère ce site {#managed-by}

Sous [[ui:fleetThisSite]], chaque site liste les contrôleurs qui le gèrent : nom, qui les a appairés, quand, et leur dernière requête. [[ui:fleetRevoke]] refuse immédiatement la clé du contrôleur.

## Réglages {#settings}

| Variable                 | Par défaut                                | Signification                                                                                   |
| ------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `ARKVORY_SITE_NAME`      | le nom d’hôte                             | Le nom de cette installation sur les autres sites                                               |
| `ARKVORY_FLEET_KEY_FILE` | `fleet.key` dans le répertoire de données | La clé qui scelle les clés des sites gérés ; créée au premier démarrage du processus d’écriture |

## Limites {#limits}

- La page montre l’état des sites. Les miroirs, les mises à jour, la file des téléchargements et la HA se configurent sur chaque site, dans sa console ou avec `arkvory configure` ; les modifier depuis le contrôleur viendra ensuite.
- Un contrôleur gère jusqu’à 256 sites et en lit au plus huit à la fois.
- Le contrôleur détient une clé de chaque site qu’il gère : protégez ses administrateurs globaux et son répertoire de données aussi soigneusement que les sites eux-mêmes.
