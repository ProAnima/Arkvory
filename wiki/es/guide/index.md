---
title: Descripción general
description: 'ProAnima Arkvory es un repositorio propio para artefactos de compilación y archivos: qué almacena, qué puede hacer y cómo funciona.'
---

# Descripción general

ProAnima Arkvory es un repositorio autoalojado para artefactos de compilación y archivos. Se instala en su propio servidor. Almacena los archivos que generan sus compilaciones y los entrega a las personas y los sistemas que los necesitan: agentes de despliegue, pipelines de CI/CD, equipos de prueba y desarrolladores.

Arkvory es gratuito para todos, también para las empresas. Su código fuente está abierto a la lectura, pero no es de código abierto. Puede usarlo y modificarlo dentro de su organización. No puede distribuir copias, venderlo ni ofrecerlo como servicio. Consulte la [licencia](https://github.com/ProAnima/Arkvory/blob/main/LICENSE.md).

## A quién va dirigido {#who-it-is-for}

- **Ingenieros de CI/CD** que necesitan un único lugar para publicar compilaciones, encontrar una compilación por versión o por etapa y descargarla en un trabajo de despliegue.
- **Administradores** que quieren un servicio de almacenamiento que se ejecute en un solo servidor, se reinicie por sí solo, haga sus propias copias de seguridad y se actualice solo.
- **Estudios de videojuegos** que trabajan con Unity o Unreal Engine. Arkvory almacena recursos binarios grandes mediante Git LFS, paquetes de Unity mediante un registro npm y resultados de compilación de decenas de gigabytes.
- **Equipos con varias sedes** que quieren una copia de solo lectura de un repositorio cerca de las personas que descargan de él.

## Qué almacena {#what-it-stores}

Todo se guarda en **repositorios**. Un repositorio puede contener varios tipos de contenido a la vez:

| Contenido                      | Cómo se trabaja con él                                                                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Artefactos (cualquier archivo) | Se suben con la consola, el [cliente de línea de comandos](../protocols/cli), el [SDK](../protocols/sdk) o la API HTTP                                                     |
| Paquetes UPack                 | Paquetes con versiones, con un grupo, un nombre y una versión SemVer. Consulte [Paquetes](../use/packages).                                                                |
| Archivos por ruta              | Una ruta como `builds/game/1.4/Setup.exe` que conserva todas las versiones anteriores. Consulte [Archivos y rutas](../use/files) y [Archivos raw](../protocols/raw-files). |
| Imágenes de contenedor         | Un registro OCI para Docker, Podman, Helm y ORAS. Consulte [Imágenes de contenedor](../protocols/containers).                                                              |
| Objetos de Git LFS             | Un servidor Git LFS con bloqueo de archivos. Consulte [Git LFS](../protocols/git-lfs).                                                                                     |
| Paquetes npm y de Unity        | Un registro npm que Unity Package Manager puede usar. Consulte [Unity y npm](../protocols/unity-npm).                                                                      |

Cada archivo almacenado es un **artefacto** inmutable con una suma de comprobación SHA-256. El contenido nuevo nunca reemplaza los bytes anteriores; crea un artefacto nuevo. Consulte [Conceptos](./concepts).

## Funciones principales {#main-capabilities}

- **Archivos grandes.** Las subidas se envían en partes y pueden continuar tras un fallo de red o un reinicio. Un objeto puede ocupar hasta unos 10 TiB. Las descargas admiten rangos HTTP, así que también pueden continuar.
- **Control de acceso.** Cuentas de usuario, grupos, tokens de acceso personal y cuentas de servicio con claves. Cada clave recibe solo las acciones de repositorio que necesita.
- **Etapas y promoción.** Marque una compilación como `qa`, `release` o `prod`, o publíquela en otro repositorio sin una nueva subida. Un agente de despliegue puede pedir «la compilación `release` más reciente del rango `^1.4`».
- **Metadatos.** Etiquetas, metadatos de texto, colecciones y archivos adjuntos, como manifiestos, SBOM y firmas.
- **Retención.** Conserve las últimas N compilaciones de cada paquete, establezca cuotas y elimine el contenido antiguo en segundo plano.
- **Copias de seguridad.** Un agente de copias de seguridad copia a diario la base de datos y todo el contenido en un almacén de copias situado en otro disco o en un NAS, y verifica las copias.
- **Espejos.** Una segunda instalación puede mantener una copia de solo lectura de un repositorio y servirla cuando el servidor principal no está disponible.
- **Puertas de enlace de lectura.** Procesos de descarga adicionales sobre el mismo almacenamiento compartido, que comparten un único presupuesto de descarga.
- **Autorrecuperación.** Los servicios se reinician tras una caída o cuando dejan de responder. Las transferencias largas pueden continuar tras el reinicio.
- **Actualizaciones.** El servidor comprueba en el hub las versiones estables firmadas que aprueba ProAnimaStudio. Las instala manualmente o de forma automática en una hora de mantenimiento, y puede volver a la versión anterior.
- **Consola web.** Temas claro y oscuro, en once idiomas: inglés, ruso, español, francés, alemán, portugués, chino, japonés, coreano, hindi y árabe (de derecha a izquierda). Esta documentación está en los mismos idiomas. Consulte [La consola web](./console).

## Cómo se ejecuta {#how-it-runs}

Arkvory se ejecuta en un solo servidor. Usa PostgreSQL para el catálogo y un directorio local para el contenido. Tres servicios trabajan juntos:

| Servicio                      | Función                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| API                           | El servidor HTTP: la API, la consola y los registros. También ejecuta la retención y la limpieza física. |
| Proceso de trabajo (worker)   | Tareas en segundo plano: finalizar las subidas grandes y sincronizar los espejos                         |
| Agente de copias de seguridad | Copias de seguridad programadas en el almacén de copias                                                  |

Puede instalarlo de tres maneras:

| Plataforma                    | Instalador                                | Detalles                                                                                                                                                                                 |
| ----------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows 10/11, Windows Server | `Arkvory-Setup-x64.exe`                   | Un asistente de instalación. Incluye Node.js y PostgreSQL y funciona sin internet. Los servicios se ejecutan sin un usuario con sesión iniciada. Consulte [Windows](../install/windows). |
| Linux                         | `Arkvory-amd64.deb`, `Arkvory-x86_64.rpm` | Paquetes para apt y dnf, con servicios de systemd. Consulte [Linux](../install/linux).                                                                                                   |
| Docker                        | Docker Compose                            | La API, el worker, el agente de copias de seguridad y PostgreSQL en contenedores. Consulte [Docker](../install/docker).                                                                  |

De forma predeterminada, el servidor escucha solo en `127.0.0.1:8080`. Antes de que se conecten otros equipos, configure [HTTPS](../install/https).

Una instalación es un servidor. No es un clúster de alta disponibilidad: si el servidor se detiene, los clientes esperan hasta que vuelva a estar disponible. Use [copias de seguridad](../operate/backups) y, si hace falta, [espejos](../operate/mirrors) en un segundo sitio.

## Dónde continuar {#where-to-go-next}

1. [Inicio rápido](./quick-start): instale Arkvory y suba su primer archivo.
2. [Conceptos](./concepts): las palabras que usa el resto de la documentación.
3. [Instalación](../install/index): requisitos y opciones de cada plataforma.
4. [Cliente de línea de comandos](../protocols/cli): use Arkvory desde scripts y CI.
5. [Copias de seguridad](../operate/backups): proteja sus datos antes de pasar a producción.
