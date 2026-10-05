---
title: Configuración
description: 'Dónde reside la configuración de Arkvory, qué comandos del ciclo de vida la cambian, los ajustes principales por tarea y cómo aplicar un cambio.'
---

# Configuración

Arkvory tiene dos tipos de ajustes:

- **Ajustes del servidor** son variables `ARKVORY_*` en el archivo `config/runtime.json`. Establecen la dirección, los límites, el almacenamiento y cosas similares. La API, el proceso de trabajo (worker) y el agente de copias de seguridad los leen al iniciarse.
- **Política de instalación** es la política de actualización, los archivos HTTPS, el almacén de copias y los espejos. Se cambia con el comando `arkvory configure`. El comando comprueba el cambio, reinicia lo necesario y restaura el estado anterior cuando los servicios no arrancan.

Esta página muestra dónde están los archivos, qué comandos existen y cómo funcionan los ajustes principales. La lista completa de variables, con valores predeterminados y rangos, está en [Variables de entorno](../reference/environment).

## Dónde se guarda la configuración {#where-it-lives}

La raíz de la instalación contiene todo. Es `C:\ProgramData\ProAnima\Arkvory` en Windows y `/opt/proanima-arkvory` en Linux. Una instalación de Compose usa la misma raíz en el host. Las rutas siguientes son relativas a la raíz.

| Archivo                                                                        | Contenido                                                                                                                           | Cómo cambiarlo                                                         |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `config/runtime.json`                                                          | Los ajustes del servidor. Las claves empiezan por `ARKVORY_` y cada valor es una cadena. Contiene la contraseña de la base de datos | A mano, o con `configure`                                              |
| `config/keys.json`                                                             | Hashes SHA-256 de la clave de recuperación y de la clave de disponibilidad. Nunca contiene una clave                                | Solo para [reemplazar la clave de recuperación](#replace-recovery-key) |
| `config/bootstrap-token.txt`                                                   | La clave de recuperación                                                                                                            | Solo para reemplazarla                                                 |
| `config/health-token.txt`                                                      | La clave que usan las herramientas de instalación para la comprobación de disponibilidad                                            | No cambiar                                                             |
| `config/hub.json`                                                              | La dirección del hub, el canal de actualización y el ajuste de estadísticas                                                         | Con `configure`                                                        |
| `config/install-id`                                                            | Un ID de instalación aleatorio, enviado al hub solo con las estadísticas activadas                                                  | No cambiar                                                             |
| `config/mirrors/`                                                              | La lista de espejos y las claves que usa el worker para los orígenes                                                                | Con `configure --mirror`                                               |
| `installation.json`                                                            | El modo, el motor, el ajuste de actualización automática, la fijación de versión y la versión instalada                             | Solo con comandos                                                      |
| `github-token.txt`                                                             | Token de GitHub opcional para descargar versiones. Consulte [Actualizaciones](./updates#hub-unreachable)                            | A mano                                                                 |
| `config/compose.env`, `config/compose.vault.yml`, `config/compose.mirrors.yml` | Solo Compose: la imagen, el montaje del almacén y el montaje del espejo                                                             | Solo con comandos                                                      |

En una instalación nativa de Linux, `runtime.json` y `keys.json` son `root:arkvory` con modo `0640`, y los archivos de credenciales en `config/` solo los puede leer `root`. Una instalación de Compose usa el modo `0644` para los archivos que leen los contenedores: consulte [Docker Compose](./docker#owners). Mantenga los propietarios y los modos que establece el instalador.

## Comandos del ciclo de vida {#lifecycle-commands}

Todos los comandos necesitan derechos de administrador y la opción `--root` con la raíz de la instalación.

| Instalación                     | Cómo ejecutar un comando                                                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paquete de Linux                | `sudo arkvory <command> --root /opt/proanima-arkvory`                                                                                                     |
| Windows, instalador gráfico     | En un PowerShell con privilegios elevados: `& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' <command> --root C:\ProgramData\ProAnima\Arkvory`           |
| Instalación por script, Compose | `sudo <root>/runtime/node-v24.21.0-linux-x64/bin/node <root>/manage.mjs <command> --root <root>`. En Windows use `runtime\node-v24.21.0-win-x64\node.exe` |

`arkvory help` lista los comandos sin necesidad de derechos especiales. Los ejemplos de este sitio usan la forma corta `arkvory <command>`.

| Comando                         | Uso                                                                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                        | Muestra el modo de instalación, el motor, el ajuste de actualización automática, la fijación de versión y la versión instalada                                   |
| `configure`                     | Cambia una política. Consulte [El comando configure](#configure-command)                                                                                         |
| `update`                        | Instala ahora una versión estable más reciente. Consulte [Actualizaciones](./updates)                                                                            |
| `upgrade`                       | Instala una versión que cambia el esquema de la base de datos con un registro de copia de seguridad propio. Consulte [Actualizaciones](./updates#manual-upgrade) |
| `recover`                       | Termina una actualización interrumpida. Consulte [Actualizaciones](./updates#recover-update)                                                                     |
| `finish-install`                | Continúa una primera instalación interrumpida                                                                                                                    |
| `updates-connect`               | Conecta la consola y el temporizador de actualizaciones, y registra los servicios que le faltan a una instalación antigua                                        |
| `updates-poll`, `updates-reset` | Los ejecuta el temporizador de actualizaciones y sirven para la recuperación. Consulte [Actualizaciones](./updates#recover-update)                               |

Solo se ejecuta un comando a la vez. Un segundo comando se detiene con `Installation is locked`. Nunca ponga una clave ni una contraseña en una opción de comando: use archivos.

### El comando configure {#configure-command}

Una llamada cambia un tipo de ajuste. Los cuatro tipos no se pueden mezclar en una sola llamada.

| Tipo              | Opciones                                                                                                                                                                         | Efecto                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| HTTPS             | `--tls-cert FILE --tls-key FILE [--listen-host ADDRESS]`, o `--tls-off [--listen-host ADDRESS]`                                                                                  | Activa o desactiva el HTTPS integrado. Reinicia los servicios y comprueba la disponibilidad. Consulte [HTTPS](./https)               |
| Almacén de copias | `--backup-vault DIRECTORY [--init-vault]`, o `--backup-vault-off`                                                                                                                | Conecta o desconecta el almacén. Reinicia solo el agente de copias de seguridad. Consulte [Copias de seguridad](../operate/backups)  |
| Espejos           | `--mirror REPOSITORY --mirror-upstream URL --mirror-token-file FILE [--mirror-source REPOSITORY] [--mirror-stages LIST] [--mirror-ca-file FILE]`, o `--mirror-detach REPOSITORY` | Convierte un repositorio en espejo o en destino de importación, o vuelve a hacerlo ordinario. Consulte [Espejos](../operate/mirrors) |
| Actualizaciones   | `--enable-updates`, `--disable-updates`, `--pin [--version X.Y.Z]`, `--unpin`, `--update-channel stable` o `beta`, `--statistics on` o `off`, `--hub-url URL`, `--hub-off`       | Cambia la política de actualización. Consulte [Actualizaciones](./updates)                                                           |

Los cambios de HTTPS, almacén y espejos reinician servicios y restauran la configuración anterior cuando el cambio no funciona. Las opciones de actualización solo reescriben `installation.json` y `hub.json`; no reinician nada. Las rutas de archivo son absolutas.

## Ajustes por tarea {#settings-by-task}

### Dirección y puerto {#address-and-port}

| Variable       | Valor predeterminado | Significado                           |
| -------------- | -------------------- | ------------------------------------- |
| `ARKVORY_HOST` | `127.0.0.1`          | La dirección en la que escucha la API |
| `ARKVORY_PORT` | `8080`               | El puerto TCP                         |

Con el valor predeterminado, solo los programas del servidor pueden conectarse. Para aceptar otros equipos, elija una de dos formas:

- **HTTPS integrado.** `arkvory configure --tls-cert … --tls-key … --listen-host 0.0.0.0`. Consulte [HTTPS](./https#built-in-tls).
- **Un proxy inverso en otro equipo.** Establezca `ARKVORY_HOST` en la dirección de la interfaz de red para el proxy e incluya el proxy en `ARKVORY_TRUSTED_PROXIES`. Edite `runtime.json`, o ejecute `arkvory configure --tls-off --listen-host <address>`. Restrinja el puerto con un cortafuegos al proxy.

`--listen-host` por sí solo se rechaza: úselo con los archivos TLS o con `--tls-off`. Después de `--tls-off`, agregue `--listen-host 127.0.0.1` para volver a loopback, o la API seguirá escuchando en la dirección establecida.

Cuando la API escucha en una dirección que no es loopback sin TLS y sin un proxy de confianza, registra la advertencia `http.plaintext_exposed` al iniciarse. Nunca envíe claves por HTTP sin cifrar entre equipos.

En Linux los servicios se ejecutan como una cuenta sin privilegios, que normalmente no puede escuchar en un puerto inferior a 1024. Los accesos directos a la consola (menú Inicio, entrada de menú) siguen apuntando al puerto 8080. Los comandos del ciclo de vida siguen la dirección y el puerto de `runtime.json`. En una instalación de Compose, la dirección y el puerto son fijos: consulte [Docker Compose](./docker#ports).

### Dirección pública y cabeceras reenviadas {#public-address}

No hay un ajuste para una URL pública. El servidor construye los enlaces absolutos, como los enlaces de Git LFS y las respuestas de npm, a partir de la solicitud: el esquema es `https` cuando la conexión es TLS o cuando el proxy envía `X-Forwarded-Proto: https`, y el host es la cabecera `Host`. Un proxy incluido en `ARKVORY_TRUSTED_PROXIES` también puede establecer el host con `X-Forwarded-Host`. Por lo tanto, su proxy debe reenviar el nombre público. Consulte [HTTPS](./https#reverse-proxy).

`ARKVORY_TRUSTED_PROXIES` admite hasta 32 direcciones o rangos CIDR, separados por comas. Solo estos pares pueden establecer la dirección del cliente con `X-Forwarded-For` y el ID de solicitud con `X-Request-Id`. Sin la lista, todos los clientes parecen venir de la dirección del proxy y el límite de inicio de sesión los cuenta como uno solo.

### Navegadores en otra dirección {#browsers}

`ARKVORY_CORS_ORIGINS` lista hasta 16 orígenes de una consola u otra aplicación web que se ejecuta en una dirección diferente, separados por comas. Cada origen tiene un esquema, un host y un puerto opcional, y ninguna ruta. Debe usar HTTPS; el HTTP sin cifrar solo se acepta para `localhost`, `127.0.0.1` y `[::1]`. Consulte [HTTPS](./https#console-api-address). `ARKVORY_ALLOW_REGISTRATION=true` permite que las personas creen sus propias cuentas en la página de inicio de sesión; está desactivado de forma predeterminada.

### Base de datos {#database}

| Variable                     | Valor predeterminado       | Significado                                                                                 |
| ---------------------------- | -------------------------- | ------------------------------------------------------------------------------------------- |
| `ARKVORY_DATABASE_URL`       | la establece el instalador | La URL de conexión de PostgreSQL. Una base de datos gestionada escucha en `127.0.0.1:54329` |
| `ARKVORY_DATABASE_POOL_SIZE` | `10`                       | El tamaño del grupo de conexiones de la API, de 4 a 200                                     |

No apunte una instalación a otra base de datos. Los archivos almacenados y el catálogo van juntos. Mudarse a una nueva base de datos es una restauración desde una copia de seguridad: consulte [Copias de seguridad](../operate/backups). Para un PostgreSQL externo, establezca `max_connections` lo bastante alto para el grupo de la API, una conexión por cada subida simultánea para los bloqueos de escritura, 5 para el worker y las conexiones del agente de copias de seguridad.

### Directorio de almacenamiento y espacio libre {#storage}

| Variable                        | Valor predeterminado | Significado                                                                                                      |
| ------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_DATA_DIR`              | `<root>/data`        | Dónde se almacena el contenido de los archivos. Lo establece el instalador. Use un disco local                   |
| `ARKVORY_CAPACITY_BYTES`        | 10 TiB               | Lo máximo que puede usar todo el contenido reservado. Es un límite sobre las reservas, no una medición del disco |
| `ARKVORY_STORAGE_RESERVE_BYTES` | 1 GiB                | Espacio libre que las subidas nunca usan. `0` desactiva la reserva                                               |
| `ARKVORY_MAX_OBJECT_BYTES`      | unos 10 TiB          | El objeto individual más grande. Establezca un valor menor para limitar el tamaño de archivo                     |

Mantenga `ARKVORY_DATA_DIR` donde lo puso el instalador. Las unidades de Linux solo pueden escribir en `data/`, `logs/` y `updates/inbox/` de la raíz, por lo que otra ruta es de solo lectura para ellas. Para usar un disco más grande, detenga los servicios, copie el contenido al disco nuevo, monte el disco en `data/` con el propietario `arkvory` e inicie los servicios. En Windows y Linux también puede elegir la propia raíz cuando instala con un script (`-Root`, `ARKVORY_INSTALL_ROOT`). Consulte [Almacenamiento](../operate/storage).

### Límites de transferencia {#limits}

Los límites pertenecen a un proceso de la API. Una tasa de `0` significa sin límite.

| Variable                              | Valor predeterminado | Significado                                                               |
| ------------------------------------- | -------------------- | ------------------------------------------------------------------------- |
| `ARKVORY_MAX_UPLOADS`                 | `2`                  | Subidas al mismo tiempo, de 1 a 32                                        |
| `ARKVORY_MAX_DOWNLOADS`               | `16`                 | Descargas al mismo tiempo, de 1 a 256                                     |
| `ARKVORY_MAX_UPLOADS_PER_PRINCIPAL`   | `1`                  | Subidas simultáneas de una cuenta o clave                                 |
| `ARKVORY_MAX_DOWNLOADS_PER_PRINCIPAL` | `4`                  | Descargas simultáneas de una cuenta o clave                               |
| `ARKVORY_UPLOAD_BYTES_PER_SECOND`     | `0`                  | Tasa de subida total en bytes por segundo                                 |
| `ARKVORY_DOWNLOAD_BYTES_PER_SECOND`   | `0`                  | Tasa de descarga total en bytes por segundo                               |
| `ARKVORY_UPLOAD_DEADLINE_MS`          | `1800000`            | El tiempo máximo de una solicitud de subida, 30 minutos                   |
| `ARKVORY_UPLOAD_IDLE_TIMEOUT_MS`      | `30000`              | Una solicitud de subida que no envía datos durante este tiempo se detiene |

Un proxy delante de la API debe permitir una solicitud al menos tan larga como `ARKVORY_UPLOAD_DEADLINE_MS`. Consulte [HTTPS](./https#reverse-proxy). Todos los demás límites, como la cola de espera y las tasas por cuenta, están en [Variables de entorno](../reference/environment#transfers-and-bandwidth).

### Copias de seguridad y espejos {#backups-mirrors}

Use `configure` para ambos. `--backup-vault` escribe `ARKVORY_BACKUP_VAULT`, concede a la cuenta de servicio acceso al directorio, reinicia solo el agente de copias de seguridad y conserva el cambio solo cuando el agente informa que el almacén está disponible. El almacén debe estar fuera de la raíz de la instalación y fuera del almacenamiento. `--mirror` escribe `ARKVORY_MIRRORS_FILE` y los archivos de claves, reinicia la API y el worker, y comprueba el origen con su clave antes de cambiar nada.

### Actualizaciones y el hub {#updates-and-hub}

La política de actualización está en `installation.json` y `config/hub.json`. Las opciones están en [El comando configure](#configure-command) y su significado en [Actualizaciones](./updates). `ARKVORY_HUB_URL` en `runtime.json` es aparte: establece dónde envía la consola los comentarios. `configure --hub-url` o `--hub-off` cambia ambos, y la dirección de comentarios se actualiza tras el siguiente reinicio de los servicios.

### Registros y apagado {#logs-and-shutdown}

| Variable                   | Valor predeterminado | Significado                                                                                                 |
| -------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `ARKVORY_LOG_LEVEL`        | `info`               | `debug`, `info`, `warning` o `error`. Los niveles `warning` y `error` también ocultan el registro de acceso |
| `ARKVORY_ACCESS_LOG`       | `true`               | Un registro JSON por cada solicitud HTTP. La cadena de consulta nunca se escribe                            |
| `ARKVORY_DRAIN_TIMEOUT_MS` | `30000`              | Tras una solicitud de parada, el tiempo para que terminen las solicitudes en curso                          |

Los supervisores dan a un servicio 120 segundos para detenerse. Si establece un tiempo de drenaje superior a unos 90 segundos, aumente también el tiempo de espera de parada del gestor de servicios: `TimeoutStopSec` en las unidades de systemd, el tiempo de espera de parada de los servicios de Windows y `stop_grace_period` en Compose. Consulte [Monitorización](../operate/monitoring).

## Aplicar un cambio {#apply-change}

`configure` aplica su propio cambio. Para todo lo que edite en `config/runtime.json`:

1. Haga una copia del archivo, por ejemplo `sudo cp -p /opt/proanima-arkvory/config/runtime.json /root/runtime.json.bak`. Contiene la contraseña de la base de datos: mantenga la copia en privado.
2. Edite el archivo en su sitio. Mantenga el JSON válido, con cada valor como una cadena.
3. Compruebe el propietario y el modo. En Linux deben seguir siendo `root:arkvory` y `0640`. Repárelos con `sudo chown root:arkvory runtime.json` y `sudo chmod 0640 runtime.json`.
4. Reinicie los servicios. Los ajustes se leen solo al iniciar.

   ```bash
   sudo systemctl restart arkvory-api arkvory-worker arkvory-backup
   ```

   ```powershell
   Restart-Service Arkvoryapi, Arkvoryworker, Arkvorybackup
   ```

   En una instalación de Compose, detenga e inicie los contenedores con el comando `compose` de [Docker Compose](./docker#manage):

   ```bash
   "${compose[@]}" stop --timeout 120 backup worker api
   "${compose[@]}" up -d --wait api worker
   "${compose[@]}" up -d backup
   ```

5. Compruebe el resultado. Un valor fuera de su rango detiene el proceso al iniciar con un mensaje que nombra la variable, nunca su valor. En Linux léalo con `journalctl -u arkvory-api -n 50`. En ese caso Arkvory no recurre a un valor predeterminado.

Un reinicio interrumpe las transferencias en curso. Los clientes las reanudan.

## Reemplazar la clave de recuperación {#replace-recovery-key}

Reemplace la clave de recuperación si sospecha que alguien ha leído `config/bootstrap-token.txt`. La clave se guarda en dos lugares que deben cambiar juntos: el archivo `bootstrap-token.txt` contiene la clave, y la entrada `bootstrap-owner` en `keys.json` contiene su SHA-256. Mantenga la entrada `deployment-health` tal cual.

1. Haga una copia de `config/keys.json`.
2. Guarde este script como `replace-recovery-key.mjs`:

   ```js
   import { createHash, randomBytes } from 'node:crypto';
   import { readFileSync, writeFileSync } from 'node:fs';

   const directory = process.argv[2];
   const token = randomBytes(32).toString('hex');
   const keys = JSON.parse(readFileSync(`${directory}/keys.json`, 'utf8'));
   const owner = keys.find((key) => key.id === 'bootstrap-owner');
   if (!owner) throw new Error('No bootstrap-owner entry');
   owner.sha256 = createHash('sha256').update(token).digest('hex');
   writeFileSync(`${directory}/keys.json`, JSON.stringify(keys, null, 2));
   writeFileSync(`${directory}/bootstrap-token.txt`, token);
   ```

3. Ejecútelo como `root` o Administrador con el Node.js de la instalación. El script escribe en los archivos existentes, así que los propietarios y las reglas de acceso permanecen como están.

   ```bash
   sudo /opt/proanima-arkvory/runtime/node ./replace-recovery-key.mjs /opt/proanima-arkvory/config
   ```

   ```powershell
   & 'C:\ProgramData\ProAnima\Arkvory\runtime\node.exe' .\replace-recovery-key.mjs 'C:\ProgramData\ProAnima\Arkvory\config'
   ```

   Tras una instalación por script, use el Node.js que está en `runtime\node-v24.21.0-…` en su lugar.

4. Reinicie los servicios como se muestra en [Aplicar un cambio](#apply-change).
5. Lea la nueva clave de `config/bootstrap-token.txt`, y elimine el script y la copia de `keys.json`.

Las cuentas, los tokens personales y las claves de servicio no se ven afectados. Viven en la base de datos.
