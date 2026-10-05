---
title: Variables de entorno
---

# Variables de entorno

Arkvory se configura con variables de entorno cuyos nombres empiezan por `ARKVORY_`. Esta página enumera todas las variables que leen los procesos del servidor, el cliente de línea de comandos y los scripts del instalador.

## De dónde proceden los valores {#where-the-values-come-from}

Los instaladores escriben los ajustes del servidor en un único archivo, `config/runtime.json`, en la raíz de la instalación. El lanzador de cada servicio lee este archivo y pasa sus valores a la API, al worker y al agente de copias de seguridad. Cada clave debe empezar por `ARKVORY_` y cada valor debe ser una cadena.

```json
{
  "ARKVORY_HOST": "127.0.0.1",
  "ARKVORY_PORT": "8080",
  "ARKVORY_CAPACITY_BYTES": "10995116277760",
  "ARKVORY_DATABASE_URL": "postgresql://arkvory:PASSWORD@127.0.0.1:54329/arkvory",
  "ARKVORY_DATA_DIR": "/opt/proanima-arkvory/data",
  "ARKVORY_KEYS_FILE": "/opt/proanima-arkvory/config/keys.json",
  "ARKVORY_MAX_DOWNLOADS": "32"
}
```

El archivo contiene la contraseña de la base de datos. Conserve sus permisos de acceso tal como los estableció el instalador.

Para cambiar un ajuste, edite `config/runtime.json` y reinicie los servicios. Prefiera el comando `arkvory configure` cuando cubra el ajuste (HTTPS, almacén de copias, espejos, actualizaciones). Comprueba el cambio y restaura el archivo anterior si los servicios no se inician. Consulte [Configuración](../install/configuration).

```bash
sudo systemctl restart arkvory-api arkvory-worker arkvory-backup
```

```powershell
Restart-Service Arkvoryapi, Arkvoryworker, Arkvorybackup
```

Un valor fuera de su rango permitido detiene el proceso al iniciarse, con un mensaje que nombra la variable. En ese caso, Arkvory no recurre a un valor predeterminado.

La columna «Leída por» usa estos nombres: **API** es el servidor HTTP (también una puerta de enlace de lectura), **worker** es el proceso de trabajo (worker) en segundo plano, **agente** es el agente de copias de seguridad y **CLI** es `arkvoryctl`.

## Núcleo {#core}

| Variable                     | Leída por                      | Valor predeterminado | Significado                                                                                                                                                                    |
| ---------------------------- | ------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ARKVORY_DATABASE_URL`       | API, worker, agente, migración | obligatoria          | URL de conexión de PostgreSQL (`postgres://` o `postgresql://`). Use una base de datos distinta para cada instalación.                                                         |
| `ARKVORY_DATA_DIR`           | API, worker, agente            | obligatoria          | Directorio de almacenamiento local: área de preparación (staging), contenido y el archivo `storage-id`. No use un recurso compartido de red.                                   |
| `ARKVORY_HOST`               | API                            | `127.0.0.1`          | Dirección en la que escuchar. Los instaladores escriben `127.0.0.1`; en Docker Compose es `0.0.0.0` dentro del contenedor y el puerto se publica solo en el loopback del host. |
| `ARKVORY_PORT`               | API                            | `8080`               | Puerto TCP, 1–65535.                                                                                                                                                           |
| `ARKVORY_WEB_DIR`            | API                            | `apps/web/public`    | Directorio con los archivos de la consola web. El lanzador lo establece en la versión actual en cada inicio.                                                                   |
| `ARKVORY_DATABASE_POOL_SIZE` | API                            | `10`                 | Tamaño del grupo de conexiones de la API, 4–200. Siempre hay hasta tres conexiones en uso.                                                                                     |

## Almacenamiento y límites {#storage-and-limits}

| Variable                        | Leída por           | Valor predeterminado | Significado                                                                                                                                                                                                                 |
| ------------------------------- | ------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_CAPACITY_BYTES`        | API, worker         | 10 TiB               | Límite superior, en bytes, de todo el contenido reservado: el publicado, las subidas sin terminar y el contenido que espera la limpieza. No es una comprobación de disco. El worker lo lee solo para las copias de espejos. |
| `ARKVORY_STORAGE_RESERVE_BYTES` | API, worker, agente | `1073741824`         | Espacio libre, en bytes, que las subidas nunca usan. Se reserva para la base de datos, los registros y el sistema. `0` desactiva la reserva.                                                                                |
| `ARKVORY_MAX_OBJECT_BYTES`      | API                 | unos 10 TiB          | Objeto más grande, en bytes. El valor máximo permitido es 10 000 partes de 1 GiB. Establezca un valor menor para limitar el tamaño de los archivos.                                                                         |

## Transferencias y ancho de banda {#transfers-and-bandwidth}

Estos límites pertenecen a un proceso de la API. Las velocidades se expresan en bytes por segundo: `0` significa sin límite y cualquier otro valor debe estar entre 65 536 y 1 TiB.

| Variable                                          | Leída por | Valor predeterminado | Significado                                                                                                                                                                                                        |
| ------------------------------------------------- | --------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ARKVORY_MAX_UPLOADS`                             | API       | `2`                  | Subidas que se ejecutan a la vez, 1–32.                                                                                                                                                                            |
| `ARKVORY_MAX_DOWNLOADS`                           | API       | `16`                 | Descargas que se ejecutan a la vez, 1–256.                                                                                                                                                                         |
| `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`               | API       | `1`                  | Subidas simultáneas de una cuenta o clave, hasta el límite total de subidas.                                                                                                                                       |
| `ARKVORY_MAX_DOWNLOADS_PER_PRINCIPAL`             | API       | `4`                  | Descargas simultáneas de una cuenta o clave, hasta el límite total de descargas.                                                                                                                                   |
| `ARKVORY_TRANSFER_QUEUE_LIMIT`                    | API       | `64`                 | Transferencias que pueden esperar una plaza libre, 1–1024.                                                                                                                                                         |
| `ARKVORY_TRANSFER_QUEUE_PER_PRINCIPAL`            | API       | `8`                  | Transferencias en espera de una cuenta o clave, hasta el límite de la cola.                                                                                                                                        |
| `ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS`               | API       | `20000`              | Cuánto tiempo puede esperar una transferencia en la cola, 1–120 000 ms.                                                                                                                                            |
| `ARKVORY_MAX_REQUESTS`                            | API       | `128`                | Solicitudes autenticadas simultáneas, 1–4096. Debe ser mayor que las subidas más las descargas. Si no se define y los límites de transferencia son altos, el valor predeterminado es subidas más descargas más 64. |
| `ARKVORY_UPLOAD_BYTES_PER_SECOND`                 | API       | `0`                  | Velocidad total de subida del proceso.                                                                                                                                                                             |
| `ARKVORY_DOWNLOAD_BYTES_PER_SECOND`               | API       | `0`                  | Velocidad total de descarga del proceso.                                                                                                                                                                           |
| `ARKVORY_UPLOAD_BYTES_PER_SECOND_PER_PRINCIPAL`   | API       | `0`                  | Velocidad de subida de una cuenta o clave, entre todas sus conexiones.                                                                                                                                             |
| `ARKVORY_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL` | API       | `0`                  | Velocidad de descarga de una cuenta o clave, entre todas sus conexiones.                                                                                                                                           |
| `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`                  | API       | `30000`              | Una solicitud de subida que no envía datos durante este tiempo se detiene, 1–1 800 000 ms.                                                                                                                         |
| `ARKVORY_UPLOAD_DEADLINE_MS`                      | API       | `1800000`            | Tiempo máximo de una solicitud de subida, 1–1 800 000 ms. No puede ser menor que el tiempo de inactividad.                                                                                                         |

## Red, HTTPS y navegadores {#network-https-and-browsers}

| Variable                     | Leída por | Valor predeterminado | Significado                                                                                                                                                                                                                                                                             |
| ---------------------------- | --------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_TLS_CERT_FILE`      | API       | sin definir          | Certificado PEM (con su cadena) para el HTTPS integrado. Defínalo junto con el archivo de clave.                                                                                                                                                                                        |
| `ARKVORY_TLS_KEY_FILE`       | API       | sin definir          | Clave privada PEM sin contraseña.                                                                                                                                                                                                                                                       |
| `ARKVORY_TLS_MIN_VERSION`    | API       | `TLSv1.2`            | `TLSv1.2` o `TLSv1.3`.                                                                                                                                                                                                                                                                  |
| `ARKVORY_TLS_RELOAD_SECONDS` | API       | `300`                | Cada cuánto se leen los archivos de certificado renovados: 30–86 400 segundos, o `0` para leerlos solo al iniciar.                                                                                                                                                                      |
| `ARKVORY_CORS_ORIGINS`       | API       | vacío                | Lista separada por comas de hasta 16 orígenes de navegador, para una consola en otra dirección. Solo HTTPS, o HTTP en loopback.                                                                                                                                                         |
| `ARKVORY_TRUSTED_PROXIES`    | API       | vacío                | Hasta 32 direcciones de proxy inverso (IP o CIDR). Solo estas pueden establecer la dirección del cliente con `X-Forwarded-For`, el ID de la solicitud con `X-Request-Id` y el host y el protocolo de los enlaces absolutos (Git LFS, npm) con `X-Forwarded-Host` y `X-Forwarded-Proto`. |

El HTTPS integrado es para las instalaciones nativas. Con Docker Compose, use un proxy inverso. Consulte [HTTPS](../install/https).

## Identidad y claves {#identity-and-keys}

| Variable                     | Leída por   | Valor predeterminado | Significado                                                                                                                                          |
| ---------------------------- | ----------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_KEYS_FILE`          | API, worker | obligatoria          | Archivo JSON con las claves de archivo, como la clave de recuperación y la clave de comprobación de estado. Guarda hashes SHA-256, nunca las claves. |
| `ARKVORY_ALLOW_REGISTRATION` | API         | desactivado          | `true` permite que las personas creen sus propias cuentas en la página de inicio de sesión. Cualquier otro valor lo mantiene desactivado.            |

## Copias de seguridad {#backups}

| Variable                          | Leída por               | Valor predeterminado | Significado                                                                                                                                                            |
| --------------------------------- | ----------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_BACKUP_VAULT`            | agente                  | sin definir          | Directorio de un almacén inicializado. Sin él, el agente se ejecuta e informa de que no hay ningún almacén configurado. `arkvory configure --backup-vault` lo escribe. |
| `ARKVORY_BACKUP_BYTES_PER_SECOND` | agente                  | sin límite           | Límite de velocidad de copia de una copia de seguridad, al menos 65 536.                                                                                               |
| `ARKVORY_BACKUP_POLL_SECONDS`     | agente                  | `15`                 | Cada cuánto consulta el agente si hay tareas de copia de seguridad nuevas, 1–3600 segundos.                                                                            |
| `ARKVORY_BACKUP_LEASE_SECONDS`    | agente                  | `60`                 | Tiempo de arrendamiento (lease) que impide que un segundo agente se ejecute a la vez, 2–3600 segundos.                                                                 |
| `ARKVORY_BACKUP_SNAPSHOT_SECONDS` | agente                  | `1800`               | Límite de tiempo para la parte de instantánea de la base de datos de una copia de seguridad, 60–86 400 segundos.                                                       |
| `ARKVORY_BACKUP_BARRIER_SECONDS`  | agente                  | `30`                 | Cuánto espera una copia de seguridad a que termine un paso de limpieza en curso, 1–600 segundos.                                                                       |
| `ARKVORY_RESTORE_DATABASE_URL`    | comando de restauración | sin definir          | Base de datos de destino de una restauración. Es más seguro que `--database-url`, porque otros usuarios no pueden verla en la lista de procesos.                       |

Consulte [Copias de seguridad](../operate/backups).

## Espejos {#mirrors}

| Variable                  | Leída por   | Valor predeterminado | Significado                                                                                                                         |
| ------------------------- | ----------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_MIRRORS_FILE`    | API, worker | sin definir          | Archivo JSON que enumera los repositorios espejo (hasta 64). `arkvory configure --mirror` lo escribe.                               |
| `ARKVORY_MIRRORS_CA_FILE` | worker      | sin definir          | Ruta absoluta a un archivo PEM con autoridades de certificación adicionales para los servidores de origen. TLS siempre se verifica. |

Consulte [Espejos](../operate/mirrors).

## Actualizaciones y el hub {#updates-and-the-hub}

| Variable                     | Leída por | Valor predeterminado       | Significado                                                                                                                                                                                                                                                |
| ---------------------------- | --------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_HUB_URL`            | API       | `https://hub.proanima.net` | Dirección del hub de ProAnimaStudio, que usan solo los comentarios de la consola (el hub de actualizaciones se guarda en `config/hub.json` y se cambia con `arkvory configure`). Un valor vacío desactiva los comentarios. Solo HTTPS, o HTTP en loopback. |
| `ARKVORY_HUB_PROJECT`        | API       | `arkvory`                  | Nombre del proyecto en el hub.                                                                                                                                                                                                                             |
| `ARKVORY_UPDATE_CONTROL_DIR` | API       | sin definir                | Directorio que la API comparte con el actualizador del host. Lo establecen los instaladores. Sin él, la consola no puede solicitar actualizaciones.                                                                                                        |

Consulte [Actualizaciones](../install/updates).

## Registro y apagado {#logging-and-shutdown}

| Variable                   | Leída por           | Valor predeterminado | Significado                                                                                         |
| -------------------------- | ------------------- | -------------------- | --------------------------------------------------------------------------------------------------- |
| `ARKVORY_LOG_LEVEL`        | API, worker, agente | `info`               | `debug`, `info`, `warning` o `error`.                                                               |
| `ARKVORY_ACCESS_LOG`       | API                 | `true`               | `true` escribe una línea JSON por cada solicitud HTTP; `false` lo desactiva.                        |
| `ARKVORY_DRAIN_TIMEOUT_MS` | API                 | `30000`              | Tras una señal de parada, tiempo que tienen las solicitudes en curso para terminar, 0–3 600 000 ms. |

## Puertas de enlace de lectura {#read-gateways}

Cuando se define cualquiera de estas variables, se requieren el slot, el número de slots y la velocidad compartida. El proceso de escritura usa el rol `api` y el slot `0`. Cada puerta de enlace de lectura usa el rol `reader` y su propio slot. Consulte [Puertas de enlace de lectura](../operate/read-gateways).

| Variable                                                 | Leída por | Valor predeterminado | Significado                                                                                                                |
| -------------------------------------------------------- | --------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_ROLE`                                           | API       | `api`                | `api` (el proceso de escritura) o `reader` (una puerta de enlace de lectura).                                              |
| `ARKVORY_GATEWAY_SLOTS`                                  | API       | sin definir          | Número de procesos que comparten el presupuesto de descarga, 2–16.                                                         |
| `ARKVORY_GATEWAY_SLOT`                                   | API       | sin definir          | Slot de este proceso, de `0` al número de slots menos uno.                                                                 |
| `ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND`               | API       | sin definir          | Velocidad total de descarga de todos los procesos. Cada slot recibe una parte igual, de al menos 65 536 bytes por segundo. |
| `ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL` | API       | `0`                  | Velocidad total de descarga de una cuenta o clave entre todos los procesos; `0` significa sin límite.                      |

## Watchdog {#watchdog}

| Variable                   | Leída por           | Valor predeterminado | Significado                                                                                                                                                                                            |
| -------------------------- | ------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ARKVORY_WATCHDOG_SECONDS` | API, worker, agente | `60`                 | Un proceso que permanece bloqueado durante este tiempo termina por sí mismo, y el administrador de servicios lo inicia de nuevo. `0` lo desactiva (para un depurador); en otro caso, 10–3600 segundos. |

Consulte [Autorrecuperación](../operate/self-healing).

## Cliente de línea de comandos {#command-line-client}

| Variable              | Leída por | Valor predeterminado                        | Significado                                                                           |
| --------------------- | --------- | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| `ARKVORY_BASE_URL`    | CLI       | el perfil y después `http://127.0.0.1:8080` | Dirección del servidor. Si está definida, la clave también debe proceder del entorno. |
| `ARKVORY_TOKEN`       | CLI       | sin definir                                 | La propia clave. Tiene prioridad sobre un archivo de clave.                           |
| `ARKVORY_TOKEN_FILE`  | CLI       | archivo de clave del perfil                 | Ruta de un archivo que contiene la clave.                                             |
| `ARKVORY_CLI_HOME`    | CLI       | `~/.config/arkvory`                         | Directorio del archivo `profiles.json`.                                               |
| `ARKVORY_CLI_VERSION` | CLI       | `development`                               | Versión que muestra `--version`. Los paquetes de versión la contienen.                |

Consulte [Cliente de línea de comandos](../protocols/cli).

## Scripts del instalador {#installer-scripts}

Estas variables las lee `install.sh` en Linux. En Windows, `install.ps1` usa en su lugar parámetros como `-Root` y `-Artifact`.

| Variable                  | Valor predeterminado      | Significado                                                                                      |
| ------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| `ARKVORY_INSTALL_ROOT`    | `/opt/proanima-arkvory`   | Raíz de la instalación. No coloque una instalación nativa en un directorio personal.             |
| `ARKVORY_ARTIFACT_DIR`    | sin definir               | Directorio de una versión descomprimida. El script la instala en lugar de descargar una versión. |
| `ARKVORY_RELEASE_VERSION` | la última versión estable | Versión estable exacta que se instalará, como `1.2.3`.                                           |

## Establecidas por el instalador {#set-by-the-installer}

El instalador establece estas variables para sus propios procesos auxiliares. No las establezca usted.

| Variable                  | Significado                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_IMAGE`           | Imagen de contenedor de la versión actual, en `config/compose.env`.                                                       |
| `ARKVORY_SERVICE_WRAPPER` | Ruta al envoltorio (wrapper) del servicio de copias de seguridad de Windows, que se usa cuando el servicio está detenido. |
| `ARKVORY_PROTECT_ROOT`    | Raíz de la instalación cuyas reglas de acceso se establecen en Windows.                                                   |
| `ARKVORY_ENGINE_USER`     | En Windows con Docker Desktop, concede al usuario actual acceso a la raíz.                                                |

## Páginas relacionadas {#related-pages}

- [Configuración](../install/configuration)
- [Monitorización](../operate/monitoring)
- [Seguridad](../operate/security)
- [Almacenamiento](../operate/storage)
