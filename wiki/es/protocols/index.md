---
title: Clientes y protocolos
---

# Clientes y protocolos

Arkvory tiene un único almacenamiento y un único modelo de acceso, pero varias formas de llegar a ellos. Cada forma es un cliente o un protocolo que una herramienta ya habla. Todas guardan los datos como artefactos de Arkvory. Por eso se aplican los mismos permisos, cuotas, comprobaciones SHA-256, reglas de retención, copias de seguridad y espejos, sea cual sea la forma que use.

Esta página enumera todas las formas de comunicarse con Arkvory, para qué sirve cada una y qué credenciales acepta. Úsela para elegir la herramienta adecuada para cada tarea.

## Resumen {#overview}

| Forma                          | Dirección                                      | Para qué sirve                                                                                               | Credenciales                                                                     |
| ------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Consola web                    | `https://arkvory.example/console/`             | Explorar repositorios, subir y descargar en un navegador, administrar usuarios, claves y copias de seguridad | Inicio de sesión con nombre de usuario y contraseña, o una clave de servicio     |
| Línea de comandos `arkvoryctl` | `/api/v1`                                      | Scripts de CI, subidas y descargas reanudables, archivos por ruta, promoción, copias de seguridad            | Clave de un archivo o de una variable de entorno (se envía como Bearer)          |
| SDK de TypeScript              | `/api/v1`                                      | Sus propias herramientas en TypeScript o JavaScript, en Node.js o en un navegador                            | Clave obtenida de una función de devolución de llamada (se envía como Bearer)    |
| API REST                       | `/api/v1/...`                                  | Integraciones en cualquier lenguaje                                                                          | Solo `Authorization: Bearer <key>`                                               |
| Registro de contenedores (OCI) | `/v2/`                                         | Docker, Podman, Buildx, containerd, charts de Helm, artefactos de ORAS                                       | Basic con la clave como contraseña (`docker login`), o Bearer                    |
| Git LFS                        | `/lfs/<repository>`                            | Archivos grandes de un repositorio git, bloqueo de archivos para Unity y Unreal                              | Basic con la clave como contraseña (asistente de credenciales de git), o Bearer  |
| Registro npm                   | `/npm/<repository>/`                           | Registros con ámbito (scoped registries) de Unity Package Manager, `npm publish` y `npm install`             | Bearer (`_authToken` en `.npmrc`, `token` en `.upmconfig.toml`), o Basic `_auth` |
| Archivos raw por ruta          | `/api/v1/repositories/<repository>/raw/<path>` | Una sola solicitud con `curl -T` o PowerShell                                                                | Solo `Authorization: Bearer <key>`                                               |
| Webhooks                       | La URL de su receptor                          | Iniciar un despliegue o una tarea cuando cambia un repositorio                                               | Firma HMAC de cada petición                                                      |

Las rutas bajo `/v2`, `/lfs` y `/npm` siguen las especificaciones de sus protocolos. No forman parte del documento OpenAPI de `/api/v1` y notifican los errores en el formato que esperan sus clientes.

## Credenciales {#credentials}

Toda solicitud necesita una credencial, salvo las comprobaciones de estado públicas. Arkvory acepta estos tipos:

| Tipo                     | Aspecto           | Origen                                                                                                                                             | Uso habitual                                                   |
| ------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Token de acceso personal | `pat_...`         | Lo crea un usuario en la consola. Ámbito `read` o `read-write`. Caduca (a los 90 días de forma predeterminada, como máximo a los 365).             | Desarrolladores: Unity, git, Docker en una estación de trabajo |
| Clave de servicio        | `arkvory_...`     | Se emite para una cuenta de servicio, con acciones exactas por repositorio, con la clave de recuperación o mediante una clave de operador delegada | CI/CD, agentes de despliegue, servidores de compilación        |
| Clave de archivo         | cualquier secreto | El archivo de claves del servidor (`ARKVORY_KEYS_FILE`), con `read` o `write` por repositorio; la clave del propietario también administra         | Propietario de la instalación, integraciones heredadas         |
| Sesión                   | `dps_...`         | Inicio de sesión en la consola; válida durante 12 horas                                                                                            | Trabajo interactivo en la consola                              |
| Enlace de descarga       | URL con `?token=` | Se crea para un artefacto; de 60 segundos a 24 horas                                                                                               | Entregar un archivo a alguien que no tiene una clave           |

Los protocolos se diferencian solo en cómo envían la clave:

- `/api/v1`, la CLI, el SDK y los archivos raw usan `Authorization: Bearer <key>`.
- `/v2`, `/lfs` y `/npm` también aceptan HTTP Basic. El nombre de usuario no se comprueba. La contraseña es la clave de Arkvory. Así envían las credenciales `docker login`, los asistentes de credenciales de git y `_auth` de npm.
- Un token personal de solo lectura nunca modifica datos. Aun así, puede descargar objetos de Git LFS, porque la solicitud batch de Git LFS es un `POST` también para las descargas.

Cómo crear tokens y claves: [Cuentas y claves](../use/accounts). Detalles de las cabeceras: [Autenticación](../api/authentication).

## ¿Cuál debo usar? {#which-one-should-i-use}

| Tarea                                                                                    | Forma recomendada                                                    |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Subir un artefacto de compilación desde CI y reanudar la subida tras un fallo de red     | [`arkvoryctl upload`](./cli) o [`arkvoryctl put`](./cli)             |
| Publicar un paquete UPack desde CI                                                       | [`arkvoryctl packages publish`](./cli)                               |
| Desplegar en un servidor «la versión 1.4 más reciente»                                   | [`arkvoryctl packages download --range ^1.4 --stage release`](./cli) |
| Colocar un archivo pequeño o mediano por ruta desde un script de shell sin instalar nada | [Archivos raw](./raw-files) con `curl -T` o PowerShell               |
| Almacenar imágenes de contenedor o charts de Helm                                        | [Imágenes de contenedor](./containers)                               |
| Mantener las texturas, los modelos y los niveles de un juego fuera del host de git       | [Git LFS](./git-lfs)                                                 |
| Compartir paquetes de Unity entre proyectos                                              | [Paquetes de Unity y npm](./unity-npm)                               |
| Crear su propia herramienta o interfaz web                                               | [SDK de TypeScript](./sdk)                                           |
| Integrar desde Python, Go, C# u otro lenguaje                                            | [API REST](../api/index)                                             |
| Explorar, administrar usuarios, claves y copias de seguridad                             | [Consola web](../guide/console)                                      |

Reglas prácticas:

- **Archivos grandes (muchos gigabytes):** use `arkvoryctl` o el SDK. Suben en partes y continúan tras una interrupción. Una única solicitud `PUT` (archivos raw, objetos de Git LFS, `npm publish`, una capa de Docker) vuelve a empezar desde el byte cero tras un fallo.
- **La herramienta ya habla un protocolo:** use ese protocolo. Docker, git y Unity no necesitan software adicional.
- **La máquina solo lee:** dele un token de solo lectura o una clave de servicio solo con acciones de lectura.

## Reglas comunes {#shared-rules}

**HTTPS.** Use HTTPS para todos los clientes. La CLI y el SDK rechazan HTTP sin cifrar salvo en loopback (`localhost`, `127.0.0.1`, `[::1]`). Docker necesita un certificado de confianza. Git envía la clave con cada solicitud. Consulte [HTTPS](../install/https).

**Mismo almacenamiento.** Una capa de imagen, un objeto de Git LFS, un tarball de npm y un archivo raw son todos artefactos. Cuentan para las cuotas de los repositorios y para la capacidad de la instalación. Se verifican con SHA-256 al almacenarlos. Se incluyen en las copias de seguridad.

**Puertas de enlace de lectura y espejos.** Una puerta de enlace de lectura solo acepta `GET` y `HEAD`. Un espejo es una copia de solo lectura de un repositorio en otra instalación.

| Forma                    | En una puerta de enlace de lectura             | En un espejo                                               |
| ------------------------ | ---------------------------------------------- | ---------------------------------------------------------- |
| `/api/v1`, CLI, SDK      | Solo lecturas                                  | Lecturas; los cambios se rechazan (`409 mirror_read_only`) |
| Registro de contenedores | Pull                                           | Pull; el push se rechaza                                   |
| Git LFS                  | No se admite (la solicitud batch es un `POST`) | Clone y fetch; el push y los bloqueos se rechazan          |
| Registro npm             | Instalación y búsqueda                         | Instalación y búsqueda; la publicación se rechaza          |
| Archivos raw             | `GET` y `HEAD`                                 | `GET` y `HEAD`                                             |

Consulte [Puertas de enlace de lectura](../operate/read-gateways) y [Espejos](../operate/mirrors).

## Páginas relacionadas {#related-pages}

- [Línea de comandos (arkvoryctl)](./cli)
- [SDK de TypeScript](./sdk)
- [Imágenes de contenedor](./containers)
- [Git LFS](./git-lfs)
- [Paquetes de Unity y npm](./unity-npm)
- [Archivos raw](./raw-files)
- [Webhooks](./webhooks)
- [Resumen de la API](../api/index) y [Errores](../api/errors)
