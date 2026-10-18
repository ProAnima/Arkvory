---
title: Licences
description: Activez la licence d’un module payant en ligne ou hors ligne, vérifiez son état et voyez ce qu’Arkvory envoie et conserve.
---

# Licences

Le cœur gratuit d’Arkvory n’a besoin d’aucune licence. Toutes les fonctions de cette documentation marchent sans elle, et aucun état de licence ne les désactive ni ne rend les données illisibles. Une licence active un module payant de ProAnimaStudio (voir [Modules](modules)). Tant que vous n’avez pas activé de licence, Arkvory n’envoie rien sur les licences nulle part.

Les commandes de cette page s’exécutent sur l’hôte de l’installation, en root sous Linux ou en administrateur sous Windows. Les installations Docker Compose ne chargent pas de modules : elles refusent donc ces commandes.

## Activer en ligne {#activate}

1. Enregistrez la clé de licence du site ProAnimaStudio dans un fichier que vous seul pouvez lire, par exemple `/root/arkvory.key`.
2. Activez :

   ```bash
   sudo arkvory license activate --key-file /root/arkvory.key --root /opt/proanima-arkvory
   ```

3. Supprimez le fichier de la clé. Arkvory ne conserve pas la clé et n’en a plus besoin.

Arkvory envoie la demande au hub de l’installation (l’adresse de `config/hub.json`, la même que pour les mises à jour) en HTTPS avec vérification du certificat. Il n’accepte la réponse que si la clé de licences de ProAnimaStudio l’a signée, pour cette installation et pour cette demande. Une clé avec une faute de frappe est refusée avant tout envoi. Réactiver la même installation avec la même clé n’occupe pas de nouvelle place de la licence.

### Ce qui est envoyé {#sent}

| Demande        | Contenu                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Activation     | La clé de licence, l’id d’installation, une valeur aléatoire, la version d’Arkvory, l’id et la version des modules payants installés, l’heure |
| Renouvellement | L’id d’activation et son secret, une valeur aléatoire, le numéro de séquence, les versions                                                    |

Le nom du titulaire de la licence, des noms de personnes, des adresses, des détails de la machine, des volumes de données, des noms de dépôts, des contenus, des metadata et des statistiques d’usage ne sont jamais envoyés. Désactiver les statistiques n’ajoute ni ne retire rien ici. Avec le hub désactivé (`--hub-off`), utilisez l’[activation hors ligne](#offline).

### Ce qui est conservé {#kept}

- Le jeton : le document signé du hub, dans la base de données et dans les sauvegardes.
- Le secret d’activation : un fichier dans `config/licenses/`, lisible seulement par le compte des services. Il n’est jamais dans la base de données, les journaux ni une sauvegarde.
- La clé de licence : nulle part.

## Vérifier l’état {#status}

```bash
sudo arkvory license status --root /opt/proanima-arkvory
```

Ajoutez `--json` pour les scripts. Un administrateur global voit la même chose dans `GET /api/v1/system/license` ([référence](../api/reference/system#getSystemLicense)). Arkvory vérifie à nouveau chaque document conservé à chaque fois ; un document que ProAnimaStudio n’a pas signé est `invalid` et n’active rien.

| État            | Signification                                                                                         | Écritures payantes               |
| --------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------- |
| `valid`         | La licence est en vigueur ; `refreshFailing` quand le hub ne répond plus depuis un moment             | dans le mode du module           |
| `offline-grace` | Aucun renouvellement depuis plus d’un jour ; le jeton vaut jusqu’à `offlineGraceUntil`                | dans le mode du module           |
| `grace`         | La durée de la licence est finie ; délai de grâce de renouvellement jusqu’à `graceUntil`              | dans le mode du module           |
| `mismatch`      | Le jeton appartient à une autre installation (une restauration ailleurs) ; grâce jusqu’à `graceUntil` | dans le mode du module jusque-là |
| `expired`       | `trial_expired`, `licence_expired` ou `activation_stale` (le jeton est fini)                          | dans la forme du cœur            |
| `revoked`       | Une révocation signée ; le motif est affiché                                                          | dans la forme du cœur            |
| `invalid`       | Un document conservé ne se vérifie pas                                                                | dans la forme du cœur            |

Dans tous les états, vos données restent lisibles, les sauvegardes et les restaurations fonctionnent, et une publication n’échoue jamais à cause d’une licence : sans licence, un module payant écrit les nouvelles données dans la forme du cœur gratuit. L’écriture dans le mode du module reprend d’elle-même après un renouvellement réussi.

## Renouvellement et fenêtre hors ligne {#refresh}

Le worker renouvelle chaque activation environ une fois par jour et à son démarrage. Chaque renouvellement apporte un nouveau jeton et un nouveau secret ; le secret précédent cesse de fonctionner.

Quand le hub est injoignable, le worker réessaie après 15 minutes, puis attend chaque fois plus longtemps, jusqu’à 6 heures. La licence reste `valid` ; après un jour sans renouvellement elle passe à `offline-grace` ; quand le jeton prend fin (la fenêtre hors ligne : 30 jours par défaut, 7 pour un essai) elle passe à `expired` avec `activation_stale`. Un refus du hub, comme `licence_expired` ou `activation_suspended`, n’est pas réessayé : réglez-le, puis lancez :

```bash
sudo arkvory license refresh --root /opt/proanima-arkvory
```

Reculer l’horloge ne prolonge rien : Arkvory juge selon l’heure la plus tardive qu’il a vue. Une horloge de base de données en retard de plus d’un jour sur cette heure affiche `clockRollback`.

### Copies et restaurations {#copies}

Une copie de l’installation, comme une machine virtuelle clonée, détient le même secret. Quand les deux copies renouvellent, le hub suspend l’activation (`activation_secret_reused`). Réactivez avec la clé l’installation que vous gardez.

Une sauvegarde restaurée sur une autre installation garde son jeton, qui appartient à l’ancienne installation : l’état est `mismatch` avec un délai de grâce. Activez la nouvelle installation avec la clé, puis désactivez l’ancienne.

Une activation non renouvelée pendant sa fenêtre hors ligne et 30 jours de plus expire, et sa place est libérée. Le renouvellement suivant reprend la place tant qu’il en reste une libre ; sinon il est refusé avec `activation_lapsed`. Désactivez une autre installation, puis renouvelez.

## Désactiver {#deactivate}

```bash
sudo arkvory license deactivate lic_0123456789ABCDEFGHJKMNPQRS --root /opt/proanima-arkvory
```

Indiquez la licence ou une activation. Le hub libère la place et Arkvory supprime le secret.

## Activation hors ligne {#offline}

Pour les hôtes sans accès au hub :

1. Écrivez un fichier de demande :

   ```bash
   sudo arkvory license request --key-file /root/arkvory.key --out /root/request.json --root /opt/proanima-arkvory
   ```

   Le fichier contient le SHA-256 de la clé, jamais la clé. Arkvory n’utilise aucun réseau pour cela.

2. Téléversez le fichier dans votre compte ProAnimaStudio et téléchargez la réponse.
3. Installez la réponse :

   ```bash
   sudo arkvory license install /root/answer.json --root /opt/proanima-arkvory
   ```

La réponse doit correspondre à une demande de cette installation. Une activation hors ligne n’est pas renouvelée : elle vaut jusqu’à sa fin, 365 jours au plus, et une nouvelle demande la prolonge. Une révocation n’atteint un tel hôte qu’avec une liste de révocation de licences, qui s’installe de la même façon.

## Erreurs {#errors}

| Code                                                | Signification                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `licence_key_invalid`                               | Le hub ne connaît pas la clé                                                                                       |
| `activation_limit_reached`                          | Toutes les places de la licence sont prises ; désactivez une autre installation                                    |
| `answer_invalid`                                    | La réponse n’est pas signée par ProAnimaStudio ou concerne une autre installation ou demande ; rien n’est conservé |
| `installation_mismatch`, `nonce_unknown`            | La réponse hors ligne appartient à une autre installation ou à aucune demande en attente                           |
| `seq_replayed`                                      | Un document plus ancien que celui conservé ; refusé                                                                |
| `revocation_rollback`                               | Une liste de révocation plus ancienne que celle conservée                                                          |
| `unreachable`, `timeout`, `tls_failed`, `hub_error` | Le hub est injoignable ; le worker réessaiera                                                                      |
