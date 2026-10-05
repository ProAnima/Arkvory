---
title: Autoréparation
description: 'Ce qu’Arkvory redémarre et reprend tout seul après un plantage, un blocage ou une session de base de données perdue, et ce qui nécessite encore un opérateur.'
---

# Autoréparation

Arkvory redémarre seul un service en échec et reprend le travail interrompu sans opérateur. Cette page liste ce qui est redémarré, combien de temps prend chaque reprise et quels problèmes nécessitent encore votre intervention. Un serveur unique n’est pas un système à haute disponibilité : un redémarrage interrompt les connexions pendant un court laps de temps, et les clients reprennent leurs transferts.

## Ce qui redémarre tout seul {#overview}

Chaque service s’exécute sous le gestionnaire de services de la plateforme. L’API, le processus de traitement (worker) et l’agent de sauvegarde terminent leur propre processus lorsqu’ils ne peuvent pas continuer en toute sécurité. Le gestionnaire de services démarre alors un nouveau processus.

| Situation                                                       | Linux (systemd)                                     | Services Windows                                                  | Docker Compose                                                                     |
| --------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Plantage, kill, manque de mémoire                               | Redémarrage après 10 s                              | Redémarrage après 10 s                                            | Le moteur redémarre le conteneur avec une pause croissante                         |
| Sortie sans demande d’arrêt, y compris avec le code de sortie 0 | Redémarrage                                         | Le lanceur transforme la sortie en code 1, redémarrage après 10 s | Redémarrage                                                                        |
| Perte de la propriété du stockage ou du bail                    | Sortie 1, redémarrage                               | Sortie 1, redémarrage                                             | Sortie 1, redémarrage                                                              |
| Thread principal bloqué                                         | Le chien de garde termine le processus, redémarrage | Idem                                                              | Idem                                                                               |
| Base de données injoignable au démarrage                        | Sortie 1, nouvelle tentative toutes les 10 s        | Sortie 1, nouvelle tentative toutes les 10 s                      | Sortie 1, nouvelle tentative avec une pause croissante                             |
| Redémarrage de la machine                                       | Les services sont activés dans `multi-user.target`  | Automatique (démarrage différé)                                   | Avec le moteur de conteneurs. Docker Desktop : après la connexion de l’utilisateur |
| Vous arrêtez le service                                         | Il reste arrêté jusqu’au prochain démarrage         | Il reste arrêté jusqu’au prochain démarrage                       | `docker compose stop` le laisse arrêté                                             |

Une vérification de disponibilité qui échoue d’elle-même ne redémarre pas un service. Elle peut échouer parce que le processus termine ses requêtes en cours avant un arrêt, ou parce qu’un dossier du répertoire de stockage est manquant. Un redémarrage ne corrigerait pas ces causes.

## Services Windows {#windows}

Le programme d’installation graphique et `install.ps1` enregistrent `Arkvoryapi`, `Arkvoryworker` et `Arkvorybackup`, qui partagent le compte `NT AUTHORITY\LocalService`, ainsi que le service de base de données `Arkvorydatabase` pour la base de données gérée. Voir [Windows](../install/windows#services).

- **Type de démarrage.** L’API, le processus de traitement (worker) et l’agent de sauvegarde utilisent Automatique (démarrage différé). La base de données utilise Automatique. Un démarrage différé signifie que les services démarrent quelque temps après le lancement de la machine, pas au même moment.
- **Actions de récupération.** Après une défaillance, Windows redémarre le service après 10 secondes. La même action se répète à chaque défaillance suivante. Le compteur de défaillances se réinitialise après une heure. Les actions de récupération s’appliquent aussi lorsque le processus se termine avec un code d’erreur.
- **Délai d’arrêt.** 120 secondes, pour laisser une requête en cours se terminer.
- **Journaux.** La sortie de chaque service va dans `logs\` et tourne à 20 MiB avec 5 anciens fichiers.

Affichez les actions de récupération d’un service :

```powershell
sc.exe qfailure Arkvoryapi
```

Relancer le programme d’installation graphique restaure les types de démarrage et les actions de récupération. Un service que vous avez arrêté vous-même reste arrêté.

## Unités systemd Linux {#linux}

Les paquets et `install.sh` créent `arkvory-api`, `arkvory-worker` et `arkvory-backup`, ainsi que `arkvory-database` lorsque la base de données est gérée.

- `Restart=always` avec `RestartSec=10` redémarre l’API, le processus de traitement (worker) et l’agent de sauvegarde après chaque sortie que vous n’avez pas demandée, y compris le code de sortie 0.
- `StartLimitIntervalSec=0` supprime la limite des tentatives de redémarrage, de sorte que systemd n’abandonne jamais un service en échec. Un défaut permanent tel qu’un mauvais paramètre entraîne un redémarrage toutes les 10 secondes, jusqu’à ce que vous le corrigiez.
- L’unité de base de données utilise `Restart=on-failure` avec les mêmes 10 secondes.
- `TimeoutStopSec=120` accorde deux minutes à un service qui s’arrête.
- Les unités sont activées pour `multi-user.target`.

```bash
systemctl is-enabled arkvory-api arkvory-worker arkvory-backup
systemctl status arkvory-api arkvory-worker arkvory-backup
```

Seul systemd est pris en charge pour les services natifs. Sur un système doté d’un autre système d’init, utilisez Docker Compose.

## Docker Compose {#compose}

Tous les services du projet `proanima-arkvory` utilisent `restart: unless-stopped`. Les étapes ponctuelles `initialize` et `migrate` ne redémarrent pas.

- Le conteneur de l’API dispose d’une vérification de santé : toutes les 10 secondes, il interroge `/health/ready` avec la clé de santé, avec une période de démarrage de 20 secondes. Un conteneur en mauvaise santé est marqué, mais Docker ne le redémarre pas. Le processus de traitement (worker) attend une API en bonne santé au démarrage.
- Les conteneurs disposent de 120 secondes pour s’arrêter.
- Le moteur de conteneurs doit démarrer au lancement. Sous Linux, vérifiez `systemctl is-enabled docker`. Arkvory ne modifie pas le moteur.
- Docker Desktop sous Windows est une application propre à un utilisateur. Aucun conteneur ne s’exécute avant que l’utilisateur ne se connecte et que Docker Desktop ne démarre. Activez **Start Docker Desktop when you sign in**. Le programme d’installation et `arkvory status` avertissent lorsqu’elle est désactivée. Pour un serveur qui doit démarrer sans connexion, utilisez les services Windows natifs.

## Redémarrage après un blocage {#hang}

Un processus peut cesser de fonctionner sans se terminer : une boucle infinie, un appel bloquant ou un blocage dans du code natif. Le gestionnaire de services ne le voit pas, car le processus existe toujours. L’API, le processus de traitement (worker) et l’agent de sauvegarde disposent donc chacun d’un chien de garde.

1. Le thread principal incrémente un compteur une fois par seconde.
2. Un second thread vérifie le compteur une fois par seconde.
3. Lorsque le compteur n’a pas bougé pendant `ARKVORY_WATCHDOG_SECONDS` vérifications d’affilée (60 par défaut), le chien de garde écrit l’enregistrement `process.stalled` avec le champ `stalledSeconds` sur la sortie d’erreur et termine le processus.
4. Le gestionnaire de services redémarre le processus comme après un plantage.

Le chien de garde compte ses propres battements, pas le temps d’horloge. Lorsque l’hôte se met en veille ou qu’une machine virtuelle est mise en pause, les deux threads s’arrêtent, et aucun blocage n’est inventé après le réveil. Un blocage coûte donc jusqu’à 60 secondes plus les 10 secondes du redémarrage.

`ARKVORY_WATCHDOG_SECONDS` accepte de 10 à 3600. La valeur `0` désactive le chien de garde. Utilisez-la uniquement lorsqu’un débogueur met le processus en pause, car un processus en pause plus longtemps que la limite est redémarré. Une longue opération bloquante compte aussi comme un blocage. Si le chien de garde lui-même ne peut pas démarrer, le service écrit `process.watchdog_failed` et continue de fonctionner sans lui. Le PostgreSQL géré n’a pas de chien de garde. Son gestionnaire de services le redémarre après un plantage. Voir [Variables d’environnement](../reference/environment#watchdog).

## Perte de session de base de données ou de propriété du stockage {#ownership}

L’API prouve au moyen d’une session de base de données qu’elle est le seul écrivain du répertoire de stockage. La session est vérifiée toutes les 2 secondes, et une vérification qui ne répond pas dans les 8 secondes est considérée comme perdue. Le processus de traitement (worker) prouve son rôle de la même manière. La propriété n’est jamais restaurée à l’intérieur d’un processus en cours, car un second processus aurait pu en prendre la main.

Lorsque la propriété est perdue, par exemple après un redémarrage de PostgreSQL, le processus :

1. écrit `api.ownership_lost` ou `worker.ownership_lost`,
2. cesse d’accepter du travail et annule les transferts,
3. se termine avec le code 1.

Le gestionnaire de services démarre un nouveau processus, qui vérifie tout à nouveau depuis le début. Tant que la base de données est indisponible, le nouveau processus ne peut pas démarrer, et l’API se termine et redémarre toutes les 10 secondes jusqu’à ce que PostgreSQL réponde. C’est le comportement attendu. Les clients reçoivent entre-temps 503 `unavailable` avec `Retry-After`. Un agent de sauvegarde en cours ne se termine pas lorsque la base de données est absente. Il journalise l’erreur et réessaie après son intervalle d’interrogation (15 secondes par défaut).

## Ce qui arrive au travail en cours {#work}

Un plantage rompt les connexions ouvertes. Les données qui ont été acquittées restent. La suite dépend du type de travail.

| Travail                                                               | Après un redémarrage                                                                                                                                                                                                                               |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Téléchargement                                                        | Le client reprend avec une requête de plage. Le SDK et le client en ligne de commande le font d’eux-mêmes                                                                                                                                          |
| Téléversement multipartie                                             | Les parties enregistrées restent sur le serveur. Le client demande quelles parties existent et envoie les manquantes. La session reste ouverte pendant 7 jours à partir de sa création                                                             |
| Téléversement d’un fichier entier en une seule requête                | Le client renvoie le fichier depuis le premier octet                                                                                                                                                                                               |
| Finalisation du téléversement par le processus de traitement (worker) | Voir ci-dessous                                                                                                                                                                                                                                    |
| Sauvegarde                                                            | Voir ci-dessous                                                                                                                                                                                                                                    |
| Synchronisation de miroir                                             | Le processus de traitement (worker) enregistre sa position après chaque changement appliqué et copie un fichier à partir de la première partie manquante. Après un échec, il attend 2 secondes, en doublant jusqu’à 5 minutes entre les tentatives |
| Mise à jour                                                           | Le programme d’installation conserve son verrou et son journal. Il ne continue pas de lui-même. Voir [Dépannage](./troubleshooting#update-failed)                                                                                                  |

Le SDK et le client en ligne de commande répètent les échecs réseau et les réponses 408, 429, 502, 503 et 504 un nombre limité de fois. Les autres clients ont besoin de leur propre logique de nouvelle tentative. Voir [Transferts](../use/transfers).

**Tâches de finalisation.** Un gros téléversement est finalisé par le processus de traitement (worker) (le SDK et le client en ligne de commande le font à partir de 16 GiB). Le worker détient un bail de 30 secondes sur une tâche et le renouvelle toutes les 2 secondes. Lorsque le worker plante, le bail expire dans les 30 secondes, et le worker redémarré reprend la tâche. Une tâche s’exécute au plus 5 fois. Après un échec, elle attend 2 secondes, en doublant jusqu’à 60 secondes. Ces erreurs terminent une tâche immédiatement : `forbidden`, `invalid_input`, `integrity_mismatch` et `not_found`. Une tâche qui a épuisé toutes ses tentatives reçoit l’enregistrement `completion.attempts_exhausted`. Demander à nouveau la finalisation du même téléversement remet la tâche en file d’attente. La finalisation vérifie les octets stockés, elle est donc sûre à répéter.

Un second worker sur la même base de données attend en veille (`worker.standby`) et vérifie toutes les 5 secondes si le premier a disparu.

**Agent de sauvegarde.** L’agent détient un bail de 60 secondes (`ARKVORY_BACKUP_LEASE_SECONDS`) et le renouvelle toutes les 20 secondes. Après un plantage, un autre agent, ou celui redémarré, prend le bail lorsqu’il expire, de sorte qu’une sauvegarde attend jusqu’à une minute. La tâche interrompue s’exécute à nouveau avec la même clé, jusqu’à 5 fois. Une nouvelle capture libère les verrous d’une capture morte. L’avertissement `agent_offline` apparaît après 2 minutes sans battement de cœur. Pendant une mise à jour, le programme d’installation arrête d’abord l’agent, et la sauvegarde en cours se termine comme `interrupted` et est remise en file d’attente.

**Limites de débit.** Les compteurs de connexion par adresse vivent dans le processus et se réinitialisent au redémarrage. Le délai d’attente d’un compte est dans la base de données et persiste.

## Vérifications au démarrage {#startup-checks}

Chaque processus vérifie son environnement avant de servir. Une vérification échouée termine le processus avec le code de sortie 1 et une ligne `startup.failed` (API) ou `worker.unavailable` (worker). `reason` nomme la cause sans secrets.

| Processus           | Ce qui est vérifié                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API                 | Chaque paramètre a une valeur valide ; le message nomme la variable, jamais sa valeur. Le fichier de clé se lit comme du JSON jusqu’à 1 MiB. TLS intégré : le certificat et la clé se lisent, correspondent et n’ont pas expiré ; il n’y a pas de repli vers HTTP. Le répertoire de stockage est inscriptible. La base de données répond et possède chaque migration de cette version et aucune d’une version plus récente. Le fichier `storage-id` dans le répertoire de stockage est égal à l’identité stockée dans la base de données. Aucun autre écrivain ne détient la base de données |
| Worker              | Les mêmes paramètres, la base de données, l’identité du stockage et le verrou du worker unique. Un second worker attend en veille                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Agent de sauvegarde | L’identité du stockage, le numéro de schéma, et le fait que le coffre ne chevauche pas le répertoire de stockage. Un coffre manquant ou non monté n’est pas fatal. L’agent le signale comme un avertissement                                                                                                                                                                                                                                                                                                                                                                                 |

Après une mise à jour, le programme d’installation attend trois réponses de disponibilité réussies d’affilée et un worker en cours d’exécution. Il attend ensuite environ 90 secondes le battement de cœur de l’agent de sauvegarde. Un agent manquant n’est qu’un avertissement et n’annule jamais une mise à jour.

## Ce qui nécessite encore votre intervention {#operator}

L’autoréparation couvre les défaillances d’un processus. Celles-ci nécessitent un opérateur :

- **Un défaut permanent.** Un mauvais paramètre, une base de données injoignable, un disque plein ou de mauvaises autorisations font redémarrer le service toutes les 10 secondes sans succès. Lisez `startup.failed` et corrigez la cause. Voir [Dépannage](./troubleshooting).
- **Une mise à jour échouée.** Une mise à jour interrompue conserve son verrou et son journal jusqu’à ce que vous exécutiez `recover`.
- **Des sauvegardes endommagées.** `verify_failed` et `vault_unavailable` nécessitent une personne. L’agent laisse le coffre inchangé.
- **Les certificats.** Arkvory relit les fichiers de certificat renouvelés sans redémarrage (toutes les 300 secondes par défaut), mais vos outils doivent les renouveler.
- **Un service arrêté.** Un service que vous avez arrêté reste arrêté.
- **La plateforme.** Docker doit démarrer au lancement. Les versions majeures de PostgreSQL, Node.js et le système d’exploitation sont mis à jour par vous.
- **Un serveur ou un disque perdu.** Il n’y a pas de basculement. Restaurez depuis une sauvegarde. Voir [Sauvegardes](./backups).

## Pages associées {#related-pages}

- [Supervision](./monitoring)
- [Dépannage](./troubleshooting)
- [Windows](../install/windows)
- [Variables d’environnement](../reference/environment)
