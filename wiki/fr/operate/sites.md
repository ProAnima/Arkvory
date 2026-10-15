---
title: Sites
description: Voir toutes les installations de votre cluster au même endroit, appairer les sites avec un code à usage unique et suivre leur état.
---

# Sites

Un **site** est une installation Arkvory : la principale, un miroir sur un autre emplacement, une installation qui importe des versions d’une autre. Sur [[ui:fleet]], une installation, le **contrôleur**, affiche chaque site qu’il gère : s’il répond, sa version, ses copies HA et passerelles de lecture, ses miroirs et leur retard, et sa file des téléchargements. Seuls les administrateurs globaux voient la page.

## État du cluster {#overview}

La page commence par [[ui:fleetOverview]] : ce qui demande de l’attention sur les sites et quel site alimente quel autre. Le contrôleur l’établit à partir des dernières lectures des sites, au plus une fois toutes les 5 secondes, et s’y inclut comme « ce site ».

### Alertes {#alerts}

Chaque alerte nomme le site et le problème. Les plus graves viennent en premier : [[ui:fleetSeverityCritical]], puis [[ui:fleetSeverityWarning]], puis [[ui:fleetSeverityInfo]]. Quand rien ne demande d’attention, la liste le dit.

| Alerte                                | Gravité                      | Quand                                                                                                                                                                                | Que faire                                                                          |
| ------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Injoignable                           | [[ui:fleetSeverityCritical]] | Pas de réponse pendant 2 minutes. Une seule lecture échouée n’est pas une alerte                                                                                                     | Vérifier le site et le réseau                                                      |
| Certificat, révoqué, refusé, invalide | [[ui:fleetSeverityCritical]] | Immédiatement, avec l’[état](#states) du même nom                                                                                                                                    | Appairer de nouveau, ou mettre les deux installations à jour                       |
| Périmé                                | [[ui:fleetSeverityWarning]]  | Le site répondait, mais n’a pas été lu depuis trois périodes de lecture (90 secondes) plus la durée d’un tour de lectures : les lectures en arrière-plan du contrôleur sont bloquées | Vérifier le processus API du contrôleur                                            |
| Écriture impossible                   | [[ui:fleetSeverityCritical]] | Un processus d’écriture refuse les écritures sans être en cours de vidage                                                                                                            | Vérifier sa base de données et son disque                                          |
| Copies                                | [[ui:fleetSeverityCritical]] | Il manque des copies des données d’un site HA ; les écritures sont suspendues jusqu’à leur retour                                                                                    | Ramener le nœud manquant, voir [Cluster à haute disponibilité](./cluster#failures) |
| Copie unique                          | [[ui:fleetSeverityWarning]]  | Des copies manquent, mais un opérateur a accepté [une seule copie](./cluster#single-copy) jusqu’à une heure donnée                                                                   | Ramener le nœud manquant avant cette heure                                         |
| Miroir en échec                       | [[ui:fleetSeverityWarning]]  | La dernière synchronisation d’un miroir a échoué. Relire une source restaurée ne compte pas                                                                                          | Lire le [code d’erreur](./mirrors#error-codes) du miroir                           |
| Miroir en retard                      | [[ui:fleetSeverityWarning]]  | Un miroir a `ARKVORY_FLEET_LAG_ALERT` changements (1000 par défaut) ou plus de retard sur sa source                                                                                  | Vérifier la source, le réseau et le miroir                                         |
| Mises à jour en échec                 | [[ui:fleetSeverityWarning]]  | Le programme de mise à jour du site signale un échec                                                                                                                                 | Ouvrir [[ui:updates]] dans les [réglages du site](#site-settings)                  |
| Autre version                         | [[ui:fleetSeverityInfo]]     | Le site exécute une autre version que le contrôleur                                                                                                                                  | Mettre les sites à la même version                                                 |

Les alertes n’utilisent que des lectures récentes : un site qui ne répond pas déclenche sa propre alerte, pas d’alertes sur ce qu’il a signalé en dernier. Un tour de lectures dure jusqu’à 15 secondes par groupe de huit sites, car le contrôleur lit au plus huit sites à la fois et attend chacun jusqu’à 15 secondes ; l’alerte « Périmé » ajoute ce temps, afin que de nombreux sites injoignables ne fassent pas paraître bloqués les sites sains. Prometheus alerte au même `ARKVORY_FLEET_LAG_ALERT`, voir [Supervision](./monitoring#alerts).

### Liens {#map}

[[ui:fleetMap]] montre quel site alimente quel autre. Chaque miroir et chaque import est une flèche du site source vers le site qui porte le miroir.

- Une source à l’adresse de laquelle aucun site géré ne répond est dessinée par son adresse, avec une bordure en tirets. Si cette source est le contrôleur lui-même, définissez `ARKVORY_SITE_URL`, voir [Réglages](#settings).
- Un lien en échec est en tirets rouges.
- Le nombre sur un lien indique de combien de changements le miroir est en retard sur sa source.
- Tant qu’un site ne répond pas, ses liens et leur retard restent tels qu’il les a signalés en dernier, marqués comme derniers connus : en tirets sur la carte, et avec l’indication [[ui:fleetLinkStale]] dans le tableau.

Sous la carte, un tableau reprend les mêmes informations : [[ui:fleetLinkFrom]], [[ui:fleetLinkTo]], [[ui:fleetMirrorRepository]], [[ui:fleetMirrorSourceRepository]] et [[ui:fleetLinkBehind]].

Les administrateurs globaux du contrôleur obtiennent les mêmes alertes et liens par `GET /api/v1/fleet/overview`, ou dans le SDK avec `client.fleet.overview()`. Pour Prometheus, le contrôleur exporte l’état de ses sites et le nombre d’alertes : voir [Supervision](./monitoring#metrics).

## Fonctionnement {#how-it-works}

- Le contrôleur tient une liste de sites. Il lit chaque site toutes les 30 secondes en HTTPS et garde la dernière réponse : un site qui ne répond plus affiche encore son dernier état connu.
- Lors du couplage, le site donne au site de contrôle une clé propre, la **clé de flotte**. Elle n’atteint que ce dont le site de contrôle a besoin : l’état du site, les descriptions de son catalogue et les modifications listées : la file de téléchargements, les demandes de mise à jour et les modifications de miroirs et de HA pour l’agent du site. Elle ne peut ni télécharger les octets des fichiers, ni écrire dans les dépôts, ni lire ou modifier les comptes et les clés.
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

## Réglages d’un site {#site-settings}

[[ui:fleetSettings]] dans la ligne d’un site ouvre ses réglages sous la liste ; [[ui:fleetThisSettings]] ouvre la même carte pour ce site. La carte a trois parties :

- **[[ui:fleetQueueSettings]]** : combien de téléchargements tournent à la fois, les places réservées aux personnes, la stratégie, les poids des classes et les autres valeurs de la file du [contrôle du trafic](../reference/environment#transfers-and-bandwidth). Un champ vide garde la valeur de l’environnement du site, affichée en gris. [[ui:fleetQueueSave]] applique les valeurs aussitôt, sans redémarrage : les nouvelles décisions les suivent, les téléchargements actifs gardent leur place. [[ui:fleetQueueReset]] revient à l’environnement.
- **[[ui:updates]]** : la version installée et la dernière, l’installation automatique et l’heure de maintenance, [[ui:updateCheck]] et [[ui:updateInstall]]. Le programme de mise à jour du site prend une demande en moins d’une minute ; d’ici là la carte l’affiche comme acceptée.
- **[[ui:fleetAgent]]** : les miroirs et imports du site avec [[ui:fleetMirrorKeySave]] et [[ui:fleetMirrorDetach]], [[ui:fleetMirrorAttach]] avec la clé de source et, sur un cluster HA, [[ui:fleetSwitchover]] vers un nœud qui a une copie complète (nom du nœud saisi deux fois) ainsi que la décision d’une seule copie. L’agent du site applique chaque demande en moins d’une minute avec les vérifications et le retour arrière de `arkvory configure` et `cluster-*` ; [[ui:fleetRequests]] montre comment chacune s’est terminée. La clé de source va à l’agent une seule fois, dans un fichier à part, et n’est plus jamais affichée. L’agent est le programme de mise à jour du site : connectez-le avec `updates-connect`.

Chaque modification porte la révision dont elle part. Si quelqu’un a modifié les réglages entre-temps, le site refuse la modification et la carte affiche les valeurs actuelles : vérifiez-les et enregistrez à nouveau. Le site note qui a modifié sa file : la clé du site de contrôle et le nom de son administrateur.

Depuis le site de contrôle, un miroir ou un import n’est rattaché que comme nouveau dépôt, et le certificat de l’autorité d’une source se règle sur le site lui-même (`arkvory configure --mirror-ca-file`) : ce à quoi un site fait confiance ne change jamais à distance. La liste des demandes montre par un code comment chaque modification s’est terminée ; les propres mots de l’agent restent dans son journal sur le site. Si une modification a été interrompue à mi-chemin, l’agent n’en prend aucune autre tant qu’un administrateur du site ne l’a pas vérifié et n’y a pas lancé `arkvory changes-reset --root <racine>`.

## Qui gère ce site {#managed-by}

Sous [[ui:fleetThisSite]], chaque site liste les contrôleurs qui le gèrent : nom, qui les a appairés, quand, et leur dernière requête. [[ui:fleetRevoke]] refuse immédiatement la clé du contrôleur.

## Réglages {#settings}

| Variable                  | Par défaut                                | Signification                                                                                                                                                                                                                   |
| ------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_SITE_NAME`       | le nom d’hôte                             | Le nom de cette installation sur les autres sites                                                                                                                                                                               |
| `ARKVORY_FLEET_KEY_FILE`  | `fleet.key` dans le répertoire de données | La clé qui scelle les clés des sites gérés ; créée au premier démarrage du processus d’écriture                                                                                                                                 |
| `ARKVORY_SITE_URL`        | non défini                                | L’adresse `https://host[:port]` par laquelle les autres sites joignent cette installation. Avec elle, les miroirs dont la source est cette installation la relient sur [[ui:fleetMap]]. Une valeur invalide arrête le démarrage |
| `ARKVORY_FLEET_LAG_ALERT` | `1000`                                    | Retard sur sa source, en changements, à partir duquel un miroir d’un site géré déclenche une alerte ; nombre entier, 1 ou plus                                                                                                  |

## Limites {#limits}

- Les tests d’isolement et l’ajout ou le retrait de nœuds du cluster restent des commandes locales sur les nœuds. Les passerelles de lecture gardent la file de téléchargements de leur environnement.
- Un contrôleur gère jusqu’à 256 sites et en lit au plus huit à la fois.
- Le contrôleur détient une clé de chaque site qu’il gère : protégez ses administrateurs globaux et son répertoire de données aussi soigneusement que les sites eux-mêmes.
