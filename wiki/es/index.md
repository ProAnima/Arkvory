---
layout: home
title: Arkvory
titleTemplate: Documentación
hero:
  name: Arkvory
  text: Su propio repositorio para compilaciones, paquetes y archivos grandes
  tagline: Un servidor para pipelines de CI, agentes de despliegue y equipos de juegos. Subidas reanudables de cualquier tamaño, acceso por repositorio, copias de seguridad, espejos y una consola en once idiomas.
  image:
    src: /arkvory.svg
    alt: ''
  actions:
    - theme: brand
      text: Comenzar
      link: /es/guide/
    - theme: alt
      text: Instalación
      link: /es/install/
    - theme: alt
      text: API HTTP
      link: /es/api/
features:
  - title: Archivos de cualquier tamaño
    details: Las subidas de decenas de gigabytes se envían en partes y continúan tras perder la conexión. Las descargas se reanudan con rangos. Cada archivo se verifica con SHA-256.
    link: /es/use/transfers
  - title: Paquetes e imágenes
    details: Paquetes UPack con versiones, imágenes de contenedor para Docker y Podman, Git LFS para los recursos de los juegos, paquetes npm y Unity, y archivos sueltos por ruta.
    link: /es/protocols/
  - title: Acceso claro y auditable
    details: Cuentas, grupos, tokens personales y cuentas de servicio con claves limitadas a los repositorios y las acciones que necesitan. Los inicios de sesión y los cambios de acceso quedan auditados.
    link: /es/use/accounts
  - title: Etapas y promoción
    details: Marque una compilación como probada o publicada, promuévala a otro repositorio y deje que un agente de despliegue tome la compilación más reciente de una etapa.
    link: /es/use/promotion
  - title: Copias de seguridad y espejos
    details: Copias de seguridad programadas y verificadas en un disco local o en un recurso compartido de red. Los espejos mantienen sincronizado un segundo sitio y toman el relevo cuando el primero se pierde.
    link: /es/operate/backups
  - title: Funciona por sí solo
    details: Servicios de Windows, paquetes de Linux o Docker Compose. Los servicios se reinician tras una caída o cuando dejan de responder, y las actualizaciones llegan firmadas y precedidas de una copia de seguridad reciente.
    link: /es/operate/self-healing
---
