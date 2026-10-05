---
title: Elegir una instalación
---

# Elegir una instalación

Arkvory se ejecuta en un solo servidor. Toda instalación tiene las mismas partes:

- **API**: la API HTTP y la consola web.
- **Proceso de trabajo (worker)**: finaliza las subidas y ejecuta las tareas en segundo plano.
- **Agente de copias de seguridad**: realiza copias de seguridad programadas en un almacén de copias.
- **PostgreSQL**: la base de datos del catálogo.

El contenido de los archivos se almacena en un disco local del servidor. Esta configuración no es un sistema de alta disponibilidad. Una actualización o un fallo del servidor provoca una breve interrupción, y los clientes reanudan sus transferencias.

## Opciones de instalación {#installation-options}

| Opción                                                                                           | Plataforma                                 | Se inicia tras un reinicio sin iniciar sesión                                                            | Base de datos                                                       | Actualizaciones automáticas tras la instalación                   | Recomendada para                                                                  |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [Instalador gráfico](./windows) `Arkvory-Setup-x64.exe`                                          | Windows x64                                | Sí (servicios de Windows)                                                                                | PostgreSQL 18.4 incluido, administrado por Arkvory                  | Desactivadas                                                      | Servidores y estaciones de trabajo con Windows, instalación sin acceso a internet |
| [Paquete de Linux](./linux) `Arkvory-amd64.deb`, `Arkvory-x86_64.rpm`                            | Linux x64 con systemd                      | Sí (unidades de systemd)                                                                                 | Clúster de PostgreSQL dedicado de su distribución (versión 16 a 19) | Desactivadas                                                      | Servidores Debian, Ubuntu y basados en RPM                                        |
| Script, servicios nativos: `install.sh` ([Linux](./linux)), `install.ps1` ([Windows](./windows)) | Linux x64 o arm64 con systemd, Windows x64 | Sí                                                                                                       | Su servidor PostgreSQL existente                                    | Desactivadas, o activadas con `--automatic` / `-AutomaticUpdates` | Automatización, un servidor PostgreSQL existente, Linux arm64                     |
| [Docker Compose](./docker)                                                                       | Linux con Docker Engine                    | Sí, si el motor de contenedores se inicia con el sistema                                                 | Contenedor de PostgreSQL 18.4                                       | Desactivadas, o activadas con `--automatic`                       | Hosts de contenedores                                                             |
| [Docker Desktop](./docker)                                                                       | Windows x64                                | No. Los contenedores se ejecutan solo después de que el usuario inicia sesión y Docker Desktop se inicia | Contenedor de PostgreSQL 18.4                                       | Desactivadas, o activadas con `-AutomaticUpdates`                 | Evaluación en una estación de trabajo                                             |

Todas las opciones instalan la misma API, el mismo worker y el mismo agente de copias de seguridad. El HTTPS integrado solo está disponible para las instalaciones nativas. Una instalación con Compose necesita un proxy inverso para HTTPS. Consulte [HTTPS y proxy inverso](./https).

### Instalación remota por SSH {#remote-installation-over-ssh}

**Arkvory Remote Setup** forma parte de los paquetes de cliente. Se ejecuta en el equipo del administrador, se conecta a un servidor mediante SSH e instala allí el paquete nativo de Linux o de Windows. Después crea la cuenta del propietario y abre la consola a través de un túnel SSH privado.

| Servidor    | Requisitos                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| Linux x64   | SSH y SFTP, systemd, `apt-get` o `dnf`, root o un usuario con `sudo -n` (sin solicitud de contraseña) |
| Windows x64 | OpenSSH Server con SFTP, Windows PowerShell, una cuenta de administrador                              |

El túnel funciona solo mientras se ejecuta Remote Setup. No publica Arkvory para otros equipos. No se admiten `sudo` protegido con contraseña, agentes SSH, hosts de salto (jump hosts) ni servidores ARM.

## Qué contiene una versión {#what-a-release-contains}

Las versiones se publican en [github.com/ProAnima/Arkvory/releases](https://github.com/ProAnima/Arkvory/releases).

| Archivo                                                                                                                                   | Finalidad                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Arkvory-Setup-x64.exe`                                                                                                                   | Instalador gráfico de Windows. Incluye Node.js, PostgreSQL, WinSW y el entorno de ejecución de Microsoft Visual C++                 |
| `Arkvory-amd64.deb`, `Arkvory-x86_64.rpm`                                                                                                 | Paquetes de Linux. Incluyen Node.js                                                                                                 |
| `install.sh`, `install.ps1`                                                                                                               | Instaladores de línea de comandos para servicios nativos o para Docker Compose                                                      |
| `Arkvory-Linux.tar.gz`, `Arkvory-Windows.zip`                                                                                             | Kits de automatización: el instalador de línea de comandos y los archivos de la versión, para instalar sin acceso a GitHub Releases |
| `Arkvory-CLI-Setup-x64.exe`, `Arkvory-CLI-amd64.deb`, `Arkvory-CLI-x86_64.rpm`                                                            | Paquetes de cliente: el cliente de línea de comandos `arkvoryctl` y Arkvory Remote Setup                                            |
| `arkvoryctl.mjs`, `arkvory-remote.mjs`                                                                                                    | Las mismas herramientas de cliente como archivos únicos para Node.js 24                                                             |
| `arkvory-runtime.zip`, `arkvory-setup.mjs`, `arkvory-release.json`, `arkvory-release.json.sig`, `release-checksums.json`, `native-*.json` | Archivos del programa, manifiestos, sumas de comprobación y la firma. Los instaladores y el actualizador los leen                   |

## Requisitos {#requirements}

| Elemento                    | Requisito                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows, instalador gráfico | x64, Windows compilación 10.0.17763 o posterior (Windows 10 versión 1809, Windows Server 2019). Derechos de administrador                               |
| Windows, script             | x64, Windows PowerShell. Derechos de administrador para los servicios nativos                                                                           |
| Paquetes de Linux           | x64, systemd, glibc 2.28 o posterior, Python 3. El administrador de paquetes instala PostgreSQL 16 o posterior                                          |
| Linux, script               | x64 o arm64, systemd para los servicios nativos, glibc, Bash, curl, Python 3, tar y xz                                                                  |
| Docker Compose              | Docker Engine con el complemento Compose, o Docker Desktop en modo de contenedores Linux. Es posible usar Podman con un proveedor de compose compatible |
| PostgreSQL                  | Una base de datos para cada instalación de Arkvory. No conecte nunca dos instalaciones a la misma base de datos                                         |
| Almacenamiento de archivos  | Un sistema de archivos local que admita vínculos físicos (hard links). No use un recurso compartido de red para el almacenamiento de archivos           |
| Almacén de copias           | Un volumen independiente, montado antes de que se inicien los servicios. Consulte [Copias de seguridad](../operate/backups)                             |

Arkvory no define mínimos fijos de procesador ni de memoria. Planifique el espacio en disco para sus archivos, la base de datos y el almacén de copias. De forma predeterminada, Arkvory mantiene libre 1 GiB en el volumen de almacenamiento y acepta hasta 10 TiB de subidas reservadas. Puede cambiar ambos límites. Consulte [Configuración](./configuration).

### Acceso de red durante la instalación y las actualizaciones {#network-access-during-installation-and-updates}

El instalador gráfico funciona sin acceso a internet. Las demás opciones descargan archivos por HTTPS:

| Host                                                             | Lo usan                                                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `nodejs.org`                                                     | `install.sh` e `install.ps1` descargan Node.js 24.21.0 y comprueban su SHA-256                         |
| `api.github.com`, `github.com` y los hosts de descarga de GitHub | Los instaladores por script y las actualizaciones cuando no se puede acceder al hub de actualizaciones |
| `hub.proanima.net`                                               | Comprobaciones y descargas de actualizaciones. Consulte [Actualizaciones](./updates)                   |
| Docker Hub                                                       | Compose crea su imagen a partir de `node:24.21.0-bookworm-slim` y ejecuta `postgres:18.4`              |

Sin acceso a internet, instale y actualice desde una copia local de una versión. Consulte [Actualizaciones](./updates).

## Puertos {#ports}

| Puerto    | Servicio                                                                  | Exposición predeterminada                                                                                                                                |
| --------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8080/TCP  | API y consola (HTTP, o HTTPS con TLS integrado)                           | Solo `127.0.0.1`. Una instalación nativa puede escuchar en otras direcciones después de configurar HTTPS. Compose siempre lo publica en `127.0.0.1:8080` |
| 54329/TCP | PostgreSQL administrado del instalador gráfico y de los paquetes de Linux | Solo `127.0.0.1`                                                                                                                                         |
| 5432/TCP  | Contenedor de PostgreSQL de una instalación con Compose                   | No se publica. Solo es accesible dentro de la red de Compose                                                                                             |

Abra solo el puerto HTTPS a las redes de los clientes. No abra nunca el puerto de la base de datos.

## Directorio de instalación {#installation-directory}

La raíz de la instalación es `C:\ProgramData\ProAnima\Arkvory` en Windows y `/opt/proanima-arkvory` en Linux. Use un directorio dedicado y vacío, fuera de los directorios personales y de los perfiles de usuario.

| Ruta dentro de la raíz           | Contenido                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `installation.json`              | Versión instalada, modo de instalación, ajuste de actualización automática y fijación de versión |
| `journal.json`, `operation.lock` | Estado de la última actualización y bloqueo de una operación en curso                            |
| `launcher.mjs`, `manage.mjs`     | Inician los servicios y contienen los comandos de administración                                 |
| `releases/<version>/`            | Código del programa de cada versión instalada. Los servicios no escriben aquí                    |
| `runtime/`                       | Node.js. El instalador gráfico también coloca aquí PostgreSQL y WinSW                            |
| `config/`                        | Configuración, claves y la clave de recuperación. Consulte [Configuración](./configuration)      |
| `data/`                          | Almacenamiento de archivos de una instalación nativa                                             |
| `database/`                      | Clúster de PostgreSQL administrado. En Windows, también sus registros                            |
| `logs/`                          | Registros de los servicios de Windows y registro del actualizador de Windows                     |
| `service/`                       | Envoltorios (wrappers) de los servicios de Windows                                               |
| `updates/`                       | Solicitudes de actualización de la consola y estado del actualizador                             |

Una instalación con Compose guarda sus datos en los volúmenes de Docker `proanima-arkvory_storage` (archivos) y `proanima-arkvory_catalog` (base de datos), no en `data/`.

Las versiones antiguas de `releases/` no se eliminan automáticamente. Tras una actualización correcta puede eliminar las versiones que no use. Conserve la versión actual y la versión anterior que indica `journal.json`.

## Clave de recuperación {#recovery-key}

El instalador crea `config/bootstrap-token.txt`. Este archivo contiene la **clave de recuperación**: una clave con derechos de administrador. Solo root o el grupo Administradores pueden leerlo.

- Úsela una vez para crear la primera cuenta de propietario si el instalador no la creó. La consola la solicita en el primer inicio.
- Las herramientas de instalación la leen en el servidor: la creación del propietario, `arkvory configure --backup-vault`, la comprobación de la copia de seguridad tras una actualización y la copia de seguridad previa a un cambio del esquema de la base de datos. **No elimine este archivo.**
- No la copie en clientes, sistemas de CI ni scripts. Para el trabajo diario, cree cuentas de usuario y claves de servicio con derechos limitados. Consulte [Cuentas y acceso](../use/accounts).

Para sustituir la clave de recuperación, consulte [Configuración](./configuration).

## Siguientes pasos {#next-steps}

1. Instale con la página de su plataforma: [Windows](./windows), [Linux](./linux) o [Docker Compose](./docker).
2. Inicie sesión y publique un primer archivo. Consulte [Inicio rápido](../guide/quick-start).
3. Configure [HTTPS](./https) antes de que los clientes se conecten desde otros equipos.
4. Conecte un almacén de copias y ejecute una primera copia de seguridad. Consulte [Copias de seguridad](../operate/backups).
5. Elija una [política de actualización](./updates).
