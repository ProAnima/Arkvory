---
title: Cluster à haute disponibilité
description: Exécutez Arkvory sur deux ou trois serveurs Linux d’un même site avec une copie synchrone de toutes les données, un basculement automatique et un fencing obligatoire.
---

# Cluster à haute disponibilité

Un cluster Arkvory continue de fonctionner lorsqu’un serveur du site tombe en panne. Deux ou trois serveurs Linux détiennent la même copie d’un volume de blocs. Un serveur est **actif** et exécute Arkvory. Lorsqu’il tombe en panne, le gestionnaire du cluster l’isole (fencing) et démarre Arkvory sur un autre serveur avec les mêmes données.

Le cluster protège contre la perte d’un serveur, d’un disque ou d’une liaison réseau à l’intérieur d’un site. Il ne protège pas contre la perte du site entier. Pour cela, conservez des [miroirs](./mirrors) sur un autre site et des [sauvegardes](./backups) en dehors du cluster.

## Comment ça fonctionne {#how-it-works}

- **Un volume, des copies synchrones.** DRBD 9 copie chaque écriture du volume vers les autres serveurs avant que l’écriture ne se termine (protocole C). Toute l’installation se trouve sur le volume : la base de données, le stockage, la configuration et les versions. Le catalogue et les octets des fichiers ne divergent jamais.
- **Pacemaker décide où Arkvory s’exécute.** Corosync et Pacemaker maintiennent le quorum, choisissent le serveur actif et démarrent, dans l’ordre : le volume, le système de fichiers, les services tels que le volume les conserve (`arkvory-units`), la base de données, `arkvory-replica`, l’API, le worker, l’agent de sauvegarde, le minuteur de mise à jour et une adresse IP virtuelle. Arkvory n’a pas d’élection propre.
- **Le fencing est obligatoire.** Avant qu’un autre serveur prenne le relais, Pacemaker éteint le serveur défaillant via un dispositif d’alimentation (IPMI, iDRAC, iLO, Redfish, une PDU) ou un hyperviseur. Sans fencing, deux serveurs pourraient écrire en même temps. Un cluster sans fencing ne démarre pas.
- **Deux copies pour chaque écriture acquittée.** Arkvory répond à une écriture par un succès seulement lorsque l’écriture se trouve sur au moins deux copies complètes (voir [Écritures et copies](#writes)). Lorsqu’une copie manque, les écritures s’arrêtent et les lectures continuent.

| Profil | Serveurs de données | Témoin                                                                                      | Lorsqu’un serveur de données tombe en panne                                             |
| ------ | ------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `ha-2` | 2                   | obligatoire : un petit serveur sans données qui exécute `corosync-qnetd` et un arbitre DRBD | Les écritures s’arrêtent jusqu’au retour du serveur ou jusqu’à une décision d’opérateur |
| `ha-3` | 3                   | non utilisé : les trois serveurs décident à la majorité                                     | Les écritures continuent : deux copies subsistent                                       |

`ha-3` est le profil recommandé. `ha-2` coûte moins cher et arrête honnêtement les écritures au lieu de garder les données en une seule copie.

Le cluster est destiné aux paquets Linux natifs. Les installations Windows et Docker Compose restent des serveurs autonomes avec des miroirs et des sauvegardes.

## Écritures et copies {#writes}

Une **copie complète** est le disque local du serveur actif lorsqu’il est à jour, plus chaque autre serveur de données qui est connecté, qui réplique et qui est à jour. Un serveur en cours de resynchronisation ne compte pas tant qu’il n’est pas à jour. Le témoin n’a pas de données et ne compte jamais.

Chaque requête qui modifie des données (l’API HTTP, le registre de conteneurs, Git LFS, npm) est vérifiée deux fois :

- **avant** son exécution, d’après les copies de la dernière seconde ;
- **après** la validation et la synchronisation des données, d’après une lecture récente du volume.

Lorsqu’il existe moins de copies complètes que n’en exigent les écritures, le client reçoit HTTP 503 avec le code `unavailable`, la raison `replication_degraded` et un en-tête `Retry-After`, jamais un 2xx. L’état d’une tâche de finalisation de téléversement (`GET /api/v1/jobs/{id}`) est vérifié de la même façon, car il indique au client qu’un gros téléversement est publié.

Un 503 après la validation signifie que l’opération n’existe peut-être que sur une seule copie. Répétez la requête avec la même `Idempotency-Key` : la répétition renvoie le résultat existant, et son 2xx le confirme dès que deux copies existent de nouveau.

Les lectures, les téléchargements, la console, la connexion et la déconnexion, les retours d’information et la requête batch de Git LFS fonctionnent pendant que les écritures sont arrêtées.

Un administrateur connecté à la console voit une bannière tant que les écritures sont arrêtées ou qu’une décision de copie unique est active.

## Prérequis {#requirements}

- Deux ou trois serveurs de données avec la même distribution Linux, la même version du paquet Arkvory et, sur chacun, un disque (ou un volume logique) de la taille complète du volume. Prévoyez tout le stockage plus la base de données.
- Pour `ha-2`, un troisième petit serveur comme témoin. Il n’a besoin d’aucun disque pour les données et n’exécute pas Arkvory.
- Un réseau à faible latence entre les serveurs. Chaque écriture attend les autres serveurs, donc la latence s’ajoute à chaque écriture. Utilisez une liaison dédiée si vous le pouvez.
- DRBD 9 (le module du noyau et `drbd-utils` 9 ; de nombreuses distributions fournissent l’ancien module 8.4, utilisez donc les paquets LINBIT), `pacemaker`, `pcs`, `corosync`, `resource-agents` (sur Ubuntu, `resource-agents-base` et `resource-agents-extra`), les agents de fencing pour votre matériel. Pour `ha-2` : `corosync-qdevice` sur les serveurs de données et `corosync-qnetd` sur le témoin.
- Un dispositif de fencing pour chaque serveur de données et ses identifiants.
- Une adresse IP libre dans le réseau des serveurs. Les clients se connectent à cette adresse virtuelle.
- Un certificat TLS pour l’adresse virtuelle. Conservez le certificat et la clé sur le volume, afin que chaque serveur les trouve au même chemin.

## Construire un cluster {#build}

Les commandes ci-dessous utilisent le nom de ressource par défaut `arkvory`, le répertoire d’installation `/opt/proanima-arkvory` et `/dev/vg0/arkvory` comme disque sous-jacent. Exécutez-les en tant que root.

1. Sur chaque serveur de données, décompressez le paquet Arkvory sans l’installer. Cela ajoute les fichiers et la commande `arkvory` et ne crée rien dans `/opt/proanima-arkvory` :

   ```bash
   dpkg --unpack Arkvory-amd64.deb
   ```

   Avec le paquet RPM, installez les fichiers sans exécuter ses scripts : `rpm -i --noscripts Arkvory-x86_64.rpm`. Sur le premier serveur, vous installez plutôt le paquet normalement à l’étape 5 : établissez donc le plan de l’étape 2 sur un autre serveur de données.

2. Sur un serveur de données, établissez le plan. Il écrit la ressource DRBD et les commandes Pacemaker dans un répertoire que vous pouvez relire :

   ```bash
   arkvory cluster-plan --cluster ha-2 \
     --nodes node-a=10.0.0.11,node-b=10.0.0.12 --witness witness=10.0.0.13 \
     --disk /dev/vg0/arkvory --fence-agent fence_ipmilan \
     --virtual-ip 10.0.0.100/24 --output /root/arkvory-plan
   ```

   Pour `ha-3`, indiquez trois serveurs dans `--nodes` et omettez `--witness`. Facultatif : `--cluster-resource`, `--drbd-minor` (0 par défaut), `--drbd-port` (7789 par défaut), `--filesystem` (`xfs` ou `ext4`, `xfs` par défaut). Les noms doivent être les noms d’hôte des serveurs. Les adresses sont en IPv4.

3. Copiez `arkvory.res` dans `/etc/drbd.d/` sur chaque serveur, témoin compris. Créez les métadonnées sur les serveurs de données et activez la ressource partout :

   ```bash
   drbdadm create-md arkvory   # data servers only
   drbdadm up arkvory          # every server
   ```

   Sur le témoin, exécutez aussi `systemctl enable drbd@arkvory.service` afin que l’arbitre revienne après un redémarrage.

   Le plan permet à une copie qui revient de se resynchroniser à 20 Mo/s au minimum, même sous charge d’écriture, et à 1 Go/s au maximum. Réglez `c-min-rate` et `c-max-rate` dans la section `disk` selon ce que supporte votre liaison de réplication.

4. Sur le premier serveur de données, rendez-le primaire, créez le système de fichiers et montez-le. Avec de nouveaux disques vides, ignorez d’abord la synchronisation initiale :

   ```bash
   drbdadm new-current-uuid --clear-bitmap arkvory/0
   drbdadm primary arkvory
   mkfs.xfs /dev/drbd0
   mkdir -p /opt/proanima-arkvory && mount /dev/drbd0 /opt/proanima-arkvory
   ```

5. Installez Arkvory dans le volume monté (avec RPM : `rpm -i Arkvory-x86_64.rpm` au lieu de `dpkg --configure`), placez les fichiers TLS sur le volume et activez le mode cluster :

   ```bash
   dpkg --configure proanima-arkvory
   install -d -m 0750 -o root -g arkvory /opt/proanima-arkvory/config/tls
   install -m 0644 tls.crt /opt/proanima-arkvory/config/tls/tls.crt
   install -m 0640 -g arkvory tls.key /opt/proanima-arkvory/config/tls/tls.key
   arkvory configure --root /opt/proanima-arkvory --tls-cert /opt/proanima-arkvory/config/tls/tls.crt --tls-key /opt/proanima-arkvory/config/tls/tls.key --listen-host 0.0.0.0
   arkvory configure --root /opt/proanima-arkvory --cluster ha-2
   ```

   `configure --cluster` vérifie que le répertoire d’installation est le périphérique DRBD monté, que ce serveur est primaire et qu’au moins deux copies sont complètes. Il démarre `arkvory-replica`, fait en sorte qu’Arkvory n’acquitte les écritures qu’avec deux copies complètes et désactive le démarrage automatique des services Arkvory : désormais, c’est Pacemaker qui les démarre. Si une étape échoue, la configuration autonome est rétablie.

6. Arrêtez Arkvory sur le premier serveur et libérez le volume :

   ```bash
   arkvory cluster-release --root /opt/proanima-arkvory
   ```

   La commande arrête les services Arkvory dans l’ordre, démonte le volume et rend ce serveur secondaire.

7. Sur chacun des autres serveurs de données, à tour de rôle, préparez le serveur :

   ```bash
   arkvory cluster-node --root /opt/proanima-arkvory
   dpkg --configure proanima-arkvory   # .deb uniquement ; avec RPM, rien d’autre n’est nécessaire
   ```

   `cluster-node` prend le volume, prépare le serveur et libère de nouveau le volume, même lorsqu’une étape échoue ; c’est la première erreur qui est signalée. `--cluster-resource` n’est nécessaire que si la ressource ne s’appelle pas `arkvory`. La commande refuse de s’exécuter sur un serveur qui sert déjà le cluster avec le volume monté (libérez-le d’abord avec `cluster-release`), et tant que Pacemaker gère le groupe Arkvory, car le volume appartient alors au cluster : ajoutez un serveur à un cluster en marche comme décrit dans [Remplacer un serveur](#replace-node). `cluster-node` crée les comptes de service avec les mêmes ID d’utilisateur et de groupe que sur le premier serveur (les fichiers du volume leur appartiennent) et installe les mêmes services, dont aucun ne démarre automatiquement. Si un compte existe déjà avec d’autres ID, la commande s’arrête et indique quels ID définir. Chaque fois qu’un serveur devient actif, `arkvory-units` reprend d’abord les services depuis le volume, de sorte que les réglages modifiés ensuite sur le serveur actif (un stockage des sauvegardes, par exemple) s’appliquent aussi après un basculement.

8. Configurez le cluster Corosync avec `pcs` sur les serveurs de données (`pcs host auth`, `pcs cluster setup`, `pcs cluster start --all`). Sur Debian et Ubuntu, exécutez d’abord `pcs cluster destroy` sur chaque serveur de données : les paquets installent un exemple de configuration Corosync que `pcs` prend pour un cluster existant. N’exécutez pas `pcs cluster enable` : un serveur qui a été isolé ne doit rejoindre le cluster que lorsque vous le démarrez. Pour `ha-2`, authentifiez aussi le témoin et exécutez dessus `pcs qdevice setup model net --enable --start`. Sur Debian et Ubuntu, le paquet a déjà configuré le dispositif de quorum pour son propre compte de service : exécutez plutôt `systemctl enable --now corosync-qnetd` à cet endroit.

9. Ouvrez `/root/arkvory-plan/pacemaker.sh`. Remplacez chaque `<agent parameters: …>` par les paramètres de votre dispositif de fencing : son adresse, l’identifiant, le fichier de mot de passe ou la clé, et la prise ou le port de ce serveur. Exécutez ensuite le script sur un serveur de données :

   ```bash
   sh /root/arkvory-plan/pacemaker.sh
   ```

   Le script construit toute la configuration dans un fichier et l’applique en une seule fois : fencing, politique de quorum, la ressource DRBD, le groupe Arkvory et ses contraintes.

10. Vérifiez le cluster sur le serveur actif :

    ```bash
    arkvory cluster-check --root /opt/proanima-arkvory
    ```

    La commande vérifie le quorum, que le fencing est activé, que chaque serveur a un dispositif de fencing, les paramètres de quorum et de fencing de DRBD, qu’au moins deux copies sont complètes et qu’Arkvory s’exécute sur exactement un serveur. Elle se termine par une erreur lorsqu’une vérification échoue.

11. Prouvez le fencing une fois : isolez chaque serveur de secours et laissez-le revenir (voir [Test de fencing](#fence-test)).

Dirigez vos clients et votre nom DNS vers l’adresse virtuelle.

## Exploitation courante {#operation}

Exécutez ces commandes en tant que root. `cluster-status`, `cluster-single-copy` et `cluster-kit` lisent le volume : lancez-les sur le serveur actif ; `cluster-check`, `cluster-switchover` et `cluster-fence-test` fonctionnent sur n’importe quel serveur de données.

| Commande                                                                  | Ce qu’elle fait                                                                                                                           |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `arkvory cluster-status --root <dir>`                                     | Profil, rôle de ce serveur, copies complètes et requises et toute décision d’opérateur, en JSON                                           |
| `arkvory cluster-check --root <dir>`                                      | Toutes les vérifications d’un cluster sain ; se termine par une erreur lorsqu’une échoue                                                  |
| `arkvory cluster-switchover --root <dir> --to <server>`                   | Déplacement planifié d’Arkvory vers un autre serveur de données ; refusé tant que la cible ne détient pas de copie complète               |
| `arkvory cluster-fence-test --root <dir> --node <standby> [--yes]`        | Isole un serveur de secours pour prouver son dispositif de fencing ; le serveur actif est refusé                                          |
| `arkvory cluster-single-copy --root <dir> --until <time> --reason <text>` | Accepte les écritures avec une seule copie jusqu’à une heure donnée ; voir [Copie unique](#single-copy)                                   |
| `arkvory cluster-kit --root <dir> --output <file>`                        | Sur le serveur actif : le fichier dont un nouveau serveur a besoin pour rejoindre le cluster ; voir [Remplacer un serveur](#replace-node) |
| `arkvory cluster-node --root <dir> --kit <file>`                          | Sur un nouveau serveur : le fait rejoindre le cluster avec ce fichier, sans prendre le volume                                             |

`pcs status` montre le cluster tel que Pacemaker le voit.

### Dans la console {#console}

Les administrateurs trouvent [[ui:cluster]] dans le menu d’une installation en cluster. La page montre la topologie, le serveur qui sert actuellement, les copies complètes, si les écritures sont acceptées, ainsi que chacun des autres serveurs avec sa connexion et sa copie ([[ui:clusterCopyComplete]], [[ui:clusterCopySyncing]] ou [[ui:clusterCopyMissing]]). En dessous, [[ui:clusterNextStep]] indique l’unique étape adaptée à l’état actuel, avec sa commande : un basculement planifié lorsque tout est complet, la remise en service ou le remplacement d’un serveur lorsqu’une copie manque (également en `ha-3` tant que les écritures continuent avec deux copies), et la manière de mettre fin à une décision de copie unique. La page se rafraîchit d’elle-même toutes les 15 secondes.

Lorsque les écritures s’arrêtent, une bannière l’indique sur chaque écran ; les administrateurs peuvent ouvrir la page depuis celle-ci. Les personnes sans droits d’administration voient seulement que les téléversements sont suspendus tandis que les téléchargements continuent de fonctionner.

### Basculement planifié {#switchover}

`cluster-switchover` demande à Pacemaker de déplacer le groupe, attend jusqu’à 5 minutes qu’Arkvory s’exécute sur la cible, puis supprime la règle de placement temporaire. Il est refusé tant que la cible n’a pas de copie complète propre, par exemple pendant sa resynchronisation. Les connexions vers l’ancien serveur sont coupées pendant le déplacement ; les clients répètent leurs requêtes. Arkvory ne revient jamais de lui-même.

### Test de fencing {#fence-test}

`cluster-fence-test` exécute d’abord les vérifications de `cluster-check` et refuse si l’une d’elles échoue. En `ha-2`, isoler l’unique serveur de secours arrête les écritures jusqu’à son retour : la commande demande donc aussi `--yes`. Elle redémarre le serveur de secours via son dispositif de fencing. Après le redémarrage, démarrez le cluster sur ce serveur avec `pcs cluster start`. Les services du cluster ne démarrent pas d’eux-mêmes après un redémarrage (étape 8 de [Construire un cluster](#build)) : un serveur isolé ne rejoint donc jamais le cluster sans vous.

### Mises à jour {#updates}

Installez un nouveau paquet sur chaque serveur de données. Sur les serveurs de secours, le paquet ne remplace que les fichiers du programme, car la version se trouve sur le volume. Sur le serveur actif, le paquet applique la version : Arkvory dit à Pacemaker de laisser le groupe tranquille, arrête les services, migre, les démarre, attend qu’ils soient prêts et rend le groupe. Les mises à jour automatiques fonctionnent de la même façon sur le serveur actif. Si la mise à jour et son retour arrière échouent tous deux, le groupe reste non géré et Pacemaker ne bascule pas : corrigez la cause, puis exécutez `pcs resource cleanup arkvory` et `pcs resource manage arkvory`.

Ne démarrez pas et n’arrêtez pas les services Arkvory avec `systemctl` sur un serveur du cluster. Pacemaker y verrait une panne. Utilisez `pcs resource disable arkvory` et `pcs resource enable arkvory` pour un arrêt planifié de tout le service.

## Pannes {#failures}

| Ce qui se passe                                                            | `ha-2`                                                                                                                                     | `ha-3`                                                                        |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Un serveur de secours tombe en panne                                       | Isolé. Les lectures continuent, les écritures reçoivent 503 `replication_degraded`                                                         | Isolé. Les lectures et les écritures continuent                               |
| Le serveur actif tombe en panne                                            | Isolé, Arkvory démarre sur l’autre serveur. Les lectures reviennent, les écritures attendent la seconde copie                              | Isolé, Arkvory démarre sur un autre serveur. Lectures et écritures reviennent |
| Coupure réseau entre les serveurs de données                               | Le témoin donne le quorum à un côté ; l’autre côté est isolé. Jamais deux écrivains                                                        | Le côté majoritaire continue ; l’autre serveur est isolé                      |
| Deux membres sur trois tombent (ha-2 : un serveur de données et le témoin) | Le dernier serveur n’a pas le quorum : Arkvory s’arrête. Jamais d’écrivain sans quorum. Remettez les serveurs en service (voir ci-dessous) | Idem pour deux serveurs de données                                            |
| Le fencing ne fonctionne pas                                               | Pas de basculement. Arkvory reste arrêté jusqu’à ce que le fencing réussisse                                                               | Idem                                                                          |

Pour remettre un serveur isolé en service :

1. Réparez la cause et démarrez le serveur.
2. Exécutez `pcs cluster start` dessus.
3. Le volume resynchronise les blocs modifiés. Les écritures reprennent d’elles-mêmes lorsque toutes les copies nécessaires sont de nouveau complètes ; `arkvory cluster-status` montre la progression.

Après une perte de quorum, démarrez le cluster sur chaque serveur revenu. Pacemaker exécute de nouveau Arkvory sur le serveur qui a la copie la plus récente. Le serveur qui a perdu le quorum en dernier peut être isolé encore une fois à son retour, car il n’a pas pu s’arrêter proprement : démarrez de nouveau le cluster dessus après son redémarrage.

Lorsque le fencing a échoué et que vous l’avez réparé, effacez les tentatives échouées sur un serveur en marche pour que Pacemaker réessaie : `pcs stonith history cleanup <server>` et `pcs resource cleanup`.

### Remplacer un serveur {#replace-node}

Lorsqu’un serveur de données est définitivement perdu, remplacez-le par un nouveau serveur portant le même nom et la même adresse. Arkvory continue de servir sur le serveur actif pendant toute l’opération ; les écritures reprennent dès que la nouvelle copie est complète.

1. Sur le nouveau serveur, installez la même distribution Linux, DRBD, Pacemaker et les agents de fencing, et décompressez la même version du paquet Arkvory qu’à l’étape 1 de [Construire un cluster](#build). Pour `ha-2`, installez aussi `corosync-qdevice`.
2. Sur le serveur actif, écrivez le fichier dont le nouveau serveur a besoin : le nom de la ressource, les ID des comptes de service et les services.

   ```bash
   arkvory cluster-kit --root /opt/proanima-arkvory --output /root/arkvory-node.kit
   ```

   Copiez-le sur le nouveau serveur par un canal sûr. Il ne contient aucun secret, mais il décrit le cluster.

3. Sur le nouveau serveur, rejoignez le cluster avec ce fichier. Le volume n’est pas nécessaire :

   ```bash
   arkvory cluster-node --root /opt/proanima-arkvory --kit /root/arkvory-node.kit
   dpkg --configure proanima-arkvory   # .deb uniquement
   ```

4. Copiez `/etc/drbd.d/arkvory.res` depuis un autre serveur de données, puis créez les métadonnées et activez la ressource. La nouvelle copie commence à se remplir depuis le serveur actif :

   ```bash
   drbdadm create-md arkvory
   drbdadm up arkvory
   ```

5. Remplacez le membre du cluster : sur le serveur actif, exécutez `pcs host auth <server>`, `pcs cluster node remove <server>`, puis `pcs cluster node add <server> addr=<address> --start`. Le dispositif de fencing du serveur conserve sa configuration si le nouveau serveur répond aux mêmes paramètres de dispositif ; sinon, mettez-le à jour avec `pcs stonith update`.
6. Suivez [[ui:cluster]] dans la console ou `arkvory cluster-status` : le serveur affiche [[ui:clusterCopySyncing]] jusqu’à ce que sa copie soit complète. Les écritures reprennent alors d’elles-mêmes.
7. Prouvez le dispositif de fencing du nouveau serveur avec `arkvory cluster-fence-test --node <server> --yes`, puis exécutez `arkvory cluster-check`.

### Copie unique {#single-copy}

Lorsqu’un serveur de données reste absent longtemps (un remplacement de disque, par exemple) et que les écritures arrêtées coûtent plus cher que le risque, un opérateur peut accepter des écritures avec une seule copie pour une durée limitée :

```bash
arkvory cluster-single-copy --root /opt/proanima-arkvory --until 2026-10-12T18:00:00Z --reason "disk replacement on node-b"
```

- L’heure doit se situer dans les 7 prochains jours et porter son fuseau : `Z` pour UTC ou un décalage tel que `+03:00`. Sans fuseau, la commande refuse, car le serveur actif la lirait dans sa propre heure locale. La commande ne fonctionne que tant que des copies manquent.
- Tant que la décision est active, la perte du serveur actif entraîne la perte des écritures acquittées après elle.
- La bannière de la console, la métrique `arkvory_replication_required_copies` et l’alerte `ArkvorySingleCopyWrites` montrent la décision.
- Elle prend fin à son heure, avec `--off`, ou d’elle-même dès que toutes les copies sont de nouveau complètes. Une perte ultérieure arrête de nouveau les écritures.

## Supervision {#monitoring}

`GET /health/ready` reste 200 sur le serveur actif tant que les écritures sont arrêtées, afin qu’un moniteur ne déplace pas un serveur sain. Son champ `writable` vaut `false` et le champ `replication` indique `copies`, `required` et `singleCopyUntil` ; `replication` vaut `null` lorsque les copies ne peuvent pas être lues. Pour les administrateurs, il contient aussi `node` (le serveur qui répond), `profile` et `peers`, les autres serveurs avec leur connexion et leur copie, que montre la [page de la console](#console). Les serveurs autonomes n’ont pas de champ `replication`.

| Métrique                                   | Signification                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| `arkvory_replication_copies`               | Copies complètes lors de la dernière vérification                                |
| `arkvory_replication_required_copies`      | Copies dont une écriture a besoin : 2, ou 1 pendant une décision de copie unique |
| `arkvory_replication_writes_refused_total` | Écritures auxquelles il a été répondu par 503 `replication_degraded`             |
| `arkvory_replication_check_failures_total` | Lectures échouées de l’état des copies                                           |

Les règles d’alerte de `deploy/monitoring/arkvory-alerts.yml` comprennent `ArkvoryReplicationDegraded`, `ArkvorySingleCopyWrites` et `ArkvoryReplicationCheckFailing`. Surveillez aussi le cluster lui-même : exécutez `arkvory cluster-check` à intervalles réguliers et alertez sur son code de sortie, ou utilisez la supervision de votre installation Pacemaker. Voir [Supervision](./monitoring).

## Sauvegardes {#backups}

L’agent de sauvegarde s’exécute uniquement sur le serveur actif, au sein du groupe. Conservez le stockage des sauvegardes en dehors du volume du cluster, par exemple sur un NAS. Voir [Sauvegardes](./backups).

## Limites {#limits}

- Linux avec les paquets natifs uniquement. Les installations Windows et Docker Compose ne peuvent pas rejoindre un cluster.
- Le fencing est obligatoire. Un cluster sans dispositif de fencing pour chaque serveur de données ne démarre pas, et Pacemaker ne déplace jamais Arkvory sans fencing confirmé. Arrêter un serveur par SSH n’est pas du fencing.
- `ha-2` a besoin de son témoin sur une machine distincte qui ne partage ni l’alimentation ni l’hôte avec les serveurs de données. Un témoin sur un serveur de données ou sur le même hyperviseur transforme une seule panne en perte de quorum. `ha-3` n’a pas besoin de témoin.
- Chaque version est testée sur des machines virtuelles avec `fence_virsh`. Votre agent et votre dispositif de fencing (IPMI, iDRAC, iLO, Redfish, une PDU ou un hyperviseur) ne le sont pas : prouvez-les sur site avec `arkvory cluster-fence-test` pour chaque serveur de données avant de compter sur le cluster, puis de nouveau après le remplacement d’un serveur ou d’un dispositif de fencing.
- Un seul site. Le cluster ne protège ni contre la perte du site, ni contre une suppression ou un dommage que le volume copie sur tous les serveurs : gardez des [miroirs](./mirrors) sur un autre site et des [sauvegardes](./backups).
- Tant qu’une [décision de copie unique](#single-copy) est active, la perte du serveur actif fait perdre les écritures acquittées après elle.
- Chaque écriture attend les autres serveurs de données : la latence du lien s’ajoute donc à chaque écriture.
- Arkvory ne revient jamais de lui-même sur un serveur réparé.

Pour ha-2, le plan retarde de 15 secondes le fencing du nœud ayant le plus petit ID DRBD (`pcmk_delay_base`), sans délai pour l’autre cible. Vérifiez que ce délai dépasse la durée du fencing et l’écart de détection des pannes. Pour un cluster existant, appliquez les commandes `pcs stonith update` correspondantes et testez les deux sens. Régénérer le plan ne modifie pas le cluster. Le quorum et le fencing restent obligatoires.
