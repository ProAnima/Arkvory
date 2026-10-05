---
layout: home
title: Arkvory
titleTemplate: Documentation
hero:
  name: Arkvory
  text: Votre propre dépôt pour les builds, les paquets et les fichiers volumineux
  tagline: Un seul serveur pour les pipelines CI, les agents de déploiement et les équipes de jeu vidéo. Téléversements de toute taille avec reprise, accès par dépôt, sauvegardes, miroirs et console en onze langues.
  image:
    src: /arkvory.svg
    alt: ''
  actions:
    - theme: brand
      text: Prise en main
      link: /fr/guide/
    - theme: alt
      text: Installation
      link: /fr/install/
    - theme: alt
      text: API HTTP
      link: /fr/api/
features:
  - title: Des fichiers de toute taille
    details: Les téléversements de plusieurs dizaines de gigaoctets se font par parties et reprennent après une coupure de connexion. Les téléchargements reprennent grâce aux plages d’octets. Chaque fichier est vérifié par SHA-256.
    link: /fr/use/transfers
  - title: Paquets et images
    details: Paquets UPack versionnés, images de conteneurs pour Docker et Podman, Git LFS pour les ressources de jeu, paquets npm et Unity, et fichiers simples par chemin.
    link: /fr/protocols/
  - title: Des accès que vous pouvez justifier
    details: Comptes, groupes, jetons personnels et comptes de service dotés de clés limitées aux dépôts et aux actions dont ils ont besoin. Les connexions et les modifications d’accès font l’objet d’un audit.
    link: /fr/use/accounts
  - title: Étapes et promotion
    details: Marquez un build comme testé ou livré, promouvez-le vers un autre dépôt et laissez un agent de déploiement récupérer le dernier build d’une étape.
    link: /fr/use/promotion
  - title: Sauvegardes et miroirs
    details: Sauvegardes planifiées et vérifiées vers un disque local ou un partage réseau. Les miroirs maintiennent un second site à jour et prennent le relais si le premier est perdu.
    link: /fr/operate/backups
  - title: Fonctionne en autonomie
    details: Services Windows, paquets Linux ou Docker Compose. Les services redémarrent après un plantage ou un blocage, et les mises à jour arrivent signées, après une sauvegarde récente.
    link: /fr/operate/self-healing
---
