---
title: Modules
description: Installer des paquets de modules signés sur un hôte, les vérifier, les supprimer et conserver les clés des auteurs de plugins auxquels vous faites confiance.
---

# Modules

Un paquet de module ajoute une fonction à Arkvory. Arkvory n'installe que les paquets dont il peut vérifier la signature. Les commandes de cette page s'exécutent sur l'hôte de l'installation, en root sous Linux ou en administrateur sous Windows. La console et l'API HTTP ne peuvent ni installer de modules ni faire confiance à des clés : un compte administrateur de la console volé ne permet donc pas d'exécuter du code sur le serveur.

Cette version stocke et vérifie les paquets de modules. Les services n'exécutent pas encore le code des modules : une version ultérieure chargera les modules installés.

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

Limites : 1 Gio par paquet, 256 Mio par fichier, 4096 fichiers. Un paquet plus grand est refusé avant la lecture de ses données.

Une version déjà installée avec les mêmes octets reste telle quelle. La même version avec d'autres octets est refusée.

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

La commande vérifie de nouveau chaque paquet installé, comme le feront les services avant de le charger : la signature, chaque fichier et l'archive. Chaque module affiche un état :

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
