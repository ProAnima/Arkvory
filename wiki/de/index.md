---
layout: home
title: Arkvory
titleTemplate: Dokumentation
hero:
  name: Arkvory
  text: Ihr eigenes Repository für Builds, Pakete und große Dateien
  tagline: Ein Server für CI-Pipelines, Deployment-Agents und Spieleteams. Uploads beliebiger Größe mit Fortsetzung, Zugriff pro Repository, Backups, Spiegel und eine Konsole in elf Sprachen.
  image:
    src: /arkvory.svg
    alt: ''
  actions:
    - theme: brand
      text: Erste Schritte
      link: /de/guide/
    - theme: alt
      text: Installation
      link: /de/install/
    - theme: alt
      text: HTTP-API
      link: /de/api/
features:
  - title: Dateien beliebiger Größe
    details: Uploads von mehreren zehn Gigabyte laufen in Teilen und werden nach einem Verbindungsabbruch fortgesetzt. Downloads setzen sich mit Bereichsanfragen fort. Jede Datei wird per SHA-256 geprüft.
    link: /de/use/transfers
  - title: Pakete und Images
    details: UPack-Pakete mit Versionen, Container-Images für Docker und Podman, Git LFS für Spiele-Assets, npm- und Unity-Pakete sowie einfache Dateien nach Pfad.
    link: /de/protocols/
  - title: Nachvollziehbarer Zugriff
    details: Konten, Gruppen, persönliche Zugriffstoken und Dienstkonten mit Schlüsseln, die auf die nötigen Repositorys und Aktionen beschränkt sind. Anmeldungen und Änderungen am Zugriff werden im Audit-Protokoll erfasst.
    link: /de/use/accounts
  - title: Stufen und Hochstufung
    details: Markieren Sie einen Build als getestet oder freigegeben, stufen Sie ihn in ein anderes Repository hoch und lassen Sie einen Deployment-Agent den neuesten Build einer Stufe abrufen.
    link: /de/use/promotion
  - title: Backups und Spiegel
    details: Geplante, geprüfte Backups auf einen lokalen Datenträger oder eine Netzwerkfreigabe. Spiegel halten einen zweiten Standort synchron und übernehmen, wenn der erste ausfällt.
    link: /de/operate/backups
  - title: Läuft von selbst
    details: Windows-Dienste, Linux-Pakete oder Docker Compose. Die Dienste starten nach einem Absturz oder Stillstand neu, und Updates werden signiert geliefert und erst nach einem frischen Backup installiert.
    link: /de/operate/self-healing
---
