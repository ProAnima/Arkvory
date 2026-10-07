---
title: Solución de problemas
description: 'Síntomas, causas y soluciones de los fallos que ocurren en un servidor Arkvory, y cómo encontrar los registros y el ID de solicitud.'
---

# Solución de problemas

Encuentre su síntoma, lea la causa y aplique la solución. Cada sección indica el evento de registro o el error que debería ver. Para el significado de un código de error, consulte [Errores](../api/errors).

## Primeros pasos {#first-steps}

1. Consulte el endpoint de estado: `curl -fsS http://127.0.0.1:8080/health/status`. `{"status":"ready"}` significa que la API alcanza su base de datos y su almacenamiento.
2. Lea las líneas de registro más recientes del servicio que falla. Consulte [Registros y comentarios](#logs-and-feedback).
3. Busque el evento `startup.failed` o `worker.unavailable`. Su campo `reason` indica la causa.
4. Si un cliente informa de un error, pida el ID de solicitud y búsquelo en el registro.

## El servidor no se inicia {#server-does-not-start}

El gestor de servicios inicia de nuevo un servicio que falla cada 10 segundos. El registro entonces repite `startup.failed`. Lea el campo `reason`, y los campos `errno` y `sqlstate`.

### El puerto está ocupado {#port-busy}

**Causa.** `startup.failed` tiene `errno` `EADDRINUSE`. Otro programa escucha en el puerto 8080 (`ARKVORY_PORT`), o un proceso antiguo de Arkvory sigue ejecutándose.

**Solución.** Encuentre el propietario del puerto y deténgalo, o cambie el puerto.

```bash
sudo ss -ltnp 'sport = :8080'
```

```powershell
Get-NetTCPConnection -LocalPort 8080 | Select-Object LocalAddress, OwningProcess
```

Para cambiar el puerto, edite `ARKVORY_PORT` en `config/runtime.json` y reinicie los servicios. La dirección de la consola cambia con él.

### La base de datos es inaccesible o rechaza el inicio de sesión {#database-problems}

**Causa.** El registro muestra uno de estos motivos:

| `reason`                                                           | Significado                                                                  |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `dependency unavailable`, con `errno` `ECONNREFUSED` o `ETIMEDOUT` | PostgreSQL está detenido, escucha en otro sitio, o un cortafuegos lo bloquea |
| `database authentication failed`                                   | El usuario o la contraseña de `ARKVORY_DATABASE_URL` son incorrectos         |
| `database does not exist`                                          | Falta la base de datos indicada en la URL                                    |
| `database role lacks a required privilege`                         | El rol no puede crear o cambiar las tablas                                   |

**Solución.** Inicie PostgreSQL, o corrija `ARKVORY_DATABASE_URL` en `config/runtime.json` y reinicie los servicios. La base de datos administrada escucha en `127.0.0.1:54329` (servicio `Arkvorydatabase` en Windows, `arkvory-database` en Linux). Los servicios arrancan por sí solos cuando la base de datos responde. No elimine la carpeta `database/`.

### La base de datos y el programa no coinciden {#migrations}

**Causa.** El motivo empieza por `unavailable:` y dice `Database migrations 1 through N are required; run migrate`, o `Database schema is newer than this release`, o `database schema is missing; run migrations`. Esto ocurre tras una actualización que se detuvo a medias, o tras arrancar una versión antigua sobre una base de datos más reciente.

**Solución.** No arranque una versión más antigua sobre una base de datos más reciente. Compruebe el estado con `arkvory status --root <root>` y termine o deshaga la actualización con `recover`. Consulte [Una actualización falló](#update-failed). Para mantener los datos a salvo, restaure desde una copia de seguridad solo cuando `recover` no pueda terminar.

### Otro proceso posee el almacenamiento {#storage-identity}

**Causa.** El motivo es `busy: Another writer or maintenance process owns this database`, o `conflict: Database belongs to a different storage directory`. Una segunda API se ejecuta contra la misma base de datos, o el directorio de datos no es el que se usó con esta base de datos. Cada directorio de almacenamiento tiene un archivo `storage-id`, y la base de datos lo registra.

**Solución.** Detenga el otro proceso. Use el directorio de datos que pertenece a esta base de datos. Nunca copie `storage-id` en otro directorio, y nunca conecte dos instalaciones a la misma base de datos.

### Permisos en la raíz o en el directorio de datos {#root-permissions}

**Causa.** El `errno` es `EACCES` o `EPERM`, o el motivo es `Cannot read ARKVORY_KEYS_FILE (EACCES)`. La cuenta de servicio no puede leer la configuración o escribir el directorio de datos. Las causas típicas son una instalación en el perfil de un usuario, una carpeta copiada a mano o un propietario cambiado.

**Solución.**

- Linux: la raíz y `config/` pertenecen a `root:arkvory` con modos 0750. `config/runtime.json` y `config/keys.json` tienen modo 0640. `data/` y `logs/` pertenecen a `arkvory:arkvory`.
- Windows: la cuenta `NT AUTHORITY\LocalService` debe leer cada carpeta principal de la raíz, y cambiar `data\`, `logs\` y la bandeja de entrada de actualizaciones. Ejecute de nuevo el instalador gráfico para restaurar las reglas de acceso.
- Instale en una carpeta dedicada fuera de los directorios personales y de los perfiles de usuario.

### Se rechaza un ajuste o un certificado {#invalid-configuration}

**Causa.** El motivo indica una variable, por ejemplo `Invalid ARKVORY_PORT`, o un problema de certificado: `TLS certificate has expired`, `TLS certificate and key do not match`, `TLS key is not an unencrypted PEM private key`. El servidor nunca se inicia en HTTP sin cifrar cuando el certificado es incorrecto.

**Solución.** Corrija la variable indicada en `config/runtime.json`. Un valor fuera de su rango detiene el inicio. Renueve o sustituya los archivos de certificado. Use `arkvory configure --tls-off` para volver a HTTP sin cifrar mientras arregla los archivos. Consulte [Variables de entorno](../reference/environment).

## La consola no puede alcanzar la API {#console-unreachable}

| Mensaje en la consola       | Causa                                                                                                                                                                                                              | Solución                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [[ui:errorNetwork]]         | El navegador no recibe respuesta: el servicio está caído, la dirección o el puerto son incorrectos, un cortafuegos lo bloquea, el servidor solo escucha en `127.0.0.1`, o el certificado no coincide con el nombre | Pruebe `/health/status` desde el mismo equipo que el navegador. Compruebe el servicio, la dirección de escucha y el cortafuegos                 |
| [[ui:errorGateway]]         | Un proxy inverso responde, pero la API que hay detrás no                                                                                                                                                           | Compruebe que la API se ejecuta y que el proxy apunta a su puerto. Aumente el tiempo de espera de lectura del proxy para transferencias grandes |
| [[ui:errorTimeout]]         | El servidor no respondió a tiempo                                                                                                                                                                                  | Busque `upload.deadline` o una base de datos ocupada en el registro                                                                             |
| [[ui:errorUnavailable]]     | Una dependencia, como la base de datos, no está disponible por un momento                                                                                                                                          | Espere y vuelva a intentarlo. Consulte [Ocupado y no disponible](#retry-after)                                                                  |
| [[ui:errorOriginForbidden]] | Una consola externa se ejecuta en una dirección que `ARKVORY_CORS_ORIGINS` no enumera                                                                                                                              | Añada el origen exacto (esquema, host y puerto) y reinicie la API                                                                               |
| [[ui:sessionEnded]]         | Cerró la sesión en otro sitio, cambió la contraseña, o se revocó el acceso                                                                                                                                         | Inicie sesión de nuevo                                                                                                                          |

Durante una actualización, la consola se reconecta por sí sola. No envíe la solicitud de instalación de nuevo. Si se usa Docker Desktop, el servidor no está disponible hasta que Docker Desktop se ejecuta. Consulte [Docker](#docker).

## Problemas de inicio de sesión {#sign-in}

### Nombre o contraseña incorrectos {#wrong-password}

**Causa.** El mensaje es [[ui:signInFailed]] (401 `invalid_credentials`). El servidor da la misma respuesta para un nombre incorrecto, una contraseña incorrecta y una cuenta desactivada, para que nadie pueda averiguar qué nombres existen.

**Solución.** Un administrador puede comprobar la cuenta en [[ui:administration]] y usar [[ui:enableUser]] si está desactivada, o [[ui:resetPassword]] para establecer una contraseña nueva.

### Demasiados intentos {#too-many-attempts}

**Causa.** La respuesta es 429 `rate_limited` con `login_attempts` y `Retry-After`. La dirección ha usado sus 10 intentos, o la cuenta está en su espera tras muchas contraseñas incorrectas (hasta 2 minutos). Incluso la contraseña correcta espera durante este tiempo.

**Solución.** Espere el número de segundos de `Retry-After`. Un administrador puede borrar la espera de una cuenta restableciendo la contraseña. Un reinicio de la API borra los contadores de las direcciones, pero no la espera de una cuenta.

### Todos están bloqueados detrás de un proxy {#blocked-behind-proxy}

**Causa.** El servidor ve la dirección del proxy como la dirección de cada cliente, así que todos los clientes comparten un presupuesto.

**Solución.** Configure `ARKVORY_TRUSTED_PROXIES` con las direcciones del proxy y reinicie la API. El proxy debe enviar `X-Forwarded-For`. Consulte [Seguridad](./security#sign-in-limits).

### Se ha perdido el propietario {#owner-lost}

**Causa.** Nadie recuerda la contraseña de un administrador.

**Solución.** Use la clave de recuperación en el servidor:

1. Lea la clave de `config/bootstrap-token.txt` como root o Administrador.
2. En la consola, abra [[ui:keySignIn]], pegue la clave y seleccione [[ui:connect]].
3. Abra [[ui:administration]]. Use [[ui:resetPassword]] para la cuenta, o [[ui:createUser]] para crear un administrador nuevo.
4. Seleccione [[ui:disconnect]] e inicie sesión con la cuenta.

El formulario [[ui:welcomeOwner]] solo funciona mientras el servidor no tiene ninguna cuenta.

### Se ha perdido la clave de recuperación {#recovery-key-lost}

**Causa.** El archivo `config/bootstrap-token.txt` se eliminó o nunca se guardó. El servidor solo contiene el hash de la clave.

**Solución.** Con derechos de root o Administrador en el servidor, escriba una clave nueva y su hash. Consulte [Configuración](../install/configuration). No vuelva a eliminar el archivo: las herramientas de instalación lo leen.

## Subidas {#uploads}

### Una subida no termina {#upload-stuck}

**Causa.** Hay varias causas posibles:

- El cliente perdió la conexión. Una subida en varias partes conserva sus partes registradas durante 7 días.
- Una subida grande espera al worker. El worker está detenido, o falla. Un segundo worker espera como reserva.
- Se ejecutan demasiadas subidas a la vez. De forma predeterminada se ejecutan 2, 1 por cuenta, y las demás esperan 20 segundos, después reciben 503 `busy`.
- Un proxy inverso rechaza un cuerpo grande (413) o detiene una solicitud lenta (502 o 504).

**Solución.**

1. Consulte el estado de la subida: `arkvoryctl uploads status <id>`. Reanude con el mismo archivo y el mismo archivo de estado. Consulte [Línea de comandos](../protocols/cli#resume-interrupted-transfers).
2. Compruebe el worker: `systemctl status arkvory-worker`, `Get-Service Arkvoryworker`. Busque `completion.failed` y `completion.attempts_exhausted` con el `uploadId`. La métrica `arkvory_completion_oldest_queued_seconds` muestra un trabajo en espera.
3. Aumente los límites del proxy para el tamaño del cuerpo y el tiempo de lectura. Una solicitud de subida se detiene tras 30 segundos sin datos y tras 30 minutos en total.
4. Una sesión de más de 7 días ha desaparecido (409 `upload_expired`). Empiece una subida nueva.

### integrity_mismatch {#integrity-mismatch}

**Causa.** La respuesta es 422 `integrity_mismatch`, o el cliente sale con el código 5. Los bytes no coinciden con el tamaño declarado o el SHA-256. El archivo cambió mientras se enviaba, el hash declarado se calculó para otro archivo, o un proxy o un dispositivo de red cambió el cuerpo.

**Solución.** Envíe el archivo de nuevo desde una copia sin cambios. La sesión permanece abierta, así que se puede enviar un archivo corregido a ella. Si una descarga falla su comprobación una y otra vez, descárguela una vez más por otra ruta y después informe del ID de solicitud. Consulte [Registros y comentarios](#logs-and-feedback).

## Ocupado, limitado o no disponible {#retry-after}

Los códigos `busy`, `unavailable` y `rate_limited` son temporales. La respuesta tiene la cabecera `Retry-After` y el campo `retryAfterSeconds`. Espere ese tiempo. El SDK y el cliente de línea de comandos repiten estas respuestas un número limitado de veces.

| Respuesta                          | Causa                                                                                                                                                    | Qué hacer                                                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 503 `busy`, motivo `request_limit` | El servidor atiende `ARKVORY_MAX_REQUESTS` solicitudes a la vez (128 de forma predeterminada)                                                            | Espere. Aumente el límite solo con suficiente memoria. Compruebe `arkvory_http_requests_in_flight`                                                        |
| 503 `busy`                         | La cola de transferencias está llena, una transferencia esperó más de `ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS` (20 s), o el servidor drena antes de detenerse | Espere y repita. Aumente `ARKVORY_MAX_UPLOADS` o `ARKVORY_MAX_DOWNLOADS` si es frecuente. `arkvory_transfer_admission_failures_total` cuenta los rechazos |
| 503 `unavailable`                  | La base de datos se reinicia, el proceso perdió la propiedad del almacenamiento, o el hub es inaccesible (`hub_unreachable`)                             | Espere. Los servicios se reinician por sí solos. Consulte [Autorrecuperación](./self-healing)                                                             |
| 429 `rate_limited`                 | Demasiados intentos de inicio de sesión, registro, contraseña o comentarios                                                                              | Espere. Consulte [Demasiados intentos](#too-many-attempts)                                                                                                |

Un 500 `internal` no tiene `Retry-After`. No lo repita a ciegas. Busque su ID de solicitud en el registro e infórmelo.

## Disco lleno y cuota {#disk-full}

| Respuesta, motivo   | Causa                                                                                                                                                                                   | Solución                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 507 `storage_full`  | El espacio libre del volumen de almacenamiento está por debajo de la reserva `ARKVORY_STORAGE_RESERVE_BYTES` (1 GiB de forma predeterminada), o el disco de la base de datos está lleno | Libere espacio en el volumen. Compruebe `df -h` o `Get-PSDrive`, y el volumen de PostgreSQL                    |
| 507 `storage_quota` | La cuota del repositorio está agotada                                                                                                                                                   | Elimine compilaciones antiguas, cambie la política de retención o aumente la cuota en [[ui:repositoryStorage]] |
| 507 `catalog_limit` | La suma de todo el contenido reservado superaría `ARKVORY_CAPACITY_BYTES` (10 TiB de forma predeterminada)                                                                              | Elimine contenido, o aumente el valor en `config/runtime.json`                                                 |
| 507 `queue_full`    | Una cuenta tiene 100 trabajos de finalización abiertos, o el servidor tiene 10 000                                                                                                      | Espere a que el worker los termine                                                                             |

Mientras el disco está lleno, las descargas y la consola siguen funcionando. `/health/ready` muestra `"writable": false`. Eliminar un artefacto en Arkvory no libera el disco de inmediato: el archivo espera a la limpieza física después de su período de gracia. Consulte [Almacenamiento](./storage). No reduzca la reserva para hacer sitio a más datos, porque la base de datos y los registros la necesitan.

## Fallan las copias de seguridad {#backups-failing}

Empiece por la advertencia en [[ui:backups]] o `arkvoryctl backup status`, y los eventos de registro `backup.request.failed` y `backup.agent.failed` con su `errorCode`. Consulte [Copias de seguridad](./backups).

| Advertencia o mensaje                                                               | Causa                                                                                                          | Solución                                                                                                                                                  |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_offline`                                                                     | El servicio de copias está detenido, o no arranca                                                              | Inicie `arkvory-backup` o `Arkvorybackup`. Lea su registro                                                                                                |
| `vault_unavailable`                                                                 | El volumen del almacén no está montado, no tiene `vault.json`, o la cuenta de servicio no puede escribir en él | Monte el volumen antes de que arranque el servicio. Compruebe el propietario y los permisos. En Windows reinicie el agente si el volumen se montó después |
| `The vault directory does not exist; create it or mount its volume first`           | La ruta es incorrecta o falta el volumen                                                                       | Cree o monte el directorio                                                                                                                                |
| `The vault directory is not writable`                                               | La cuenta de servicio no tiene acceso de escritura                                                             | En Linux monte un recurso compartido con los `uid` y `gid` del usuario `arkvory`. En Windows use un volumen local o iSCSI                                 |
| `The directory has no vault.json: mount the vault volume, or pass --init-vault ...` | Un directorio vacío podría ser un recurso compartido no montado, así que el comando lo rechaza                 | Monte el volumen correcto, o pase `--init-vault --vault-no-encryption` para un almacén vacío nuevo                                                        |
| `The vault must be outside the installation root and the storage directory`         | El almacén se solapa con los datos                                                                             | Elija un directorio separado en otro volumen                                                                                                              |
| `Network share paths are not supported ...`                                         | Una ruta UNC en Windows. `LocalService` no puede iniciar sesión en recursos compartidos SMB                    | Use una letra de unidad de un volumen local o iSCSI                                                                                                       |
| `The backup service cannot reach /home, /root, /run/user, /tmp or /var/tmp`         | El sandbox de systemd oculta estas carpetas                                                                    | Elija otro directorio                                                                                                                                     |
| `vault_full`, `vault_low_space`                                                     | El volumen del almacén está casi lleno                                                                         | Libere espacio o conserve menos puntos. Los puntos anteriores permanecen intactos                                                                         |
| `vault_key_missing`, `vault_key_invalid`                                            | El vault está cifrado y el agente no tiene clave, o tiene una incorrecta                                       | Ejecute `arkvory configure --backup-vault DIR --vault-key-file FILE` con la clave del agente. Véase [Cifrar el vault](./backups#encryption)               |
| `last_run_failed`                                                                   | La copia de seguridad más reciente falló                                                                       | Lea el `errorCode` con `arkvoryctl backup jobs`                                                                                                           |
| `verify_failed`                                                                     | Un punto falló su comprobación                                                                                 | No cambie el almacén. Consérvelo para el análisis e infórmelo                                                                                             |

`arkvory configure --backup-vault` restaura los ajustes anteriores cuando el agente no informa del almacén nuevo en 150 segundos. Una actualización detiene el agente de copias de seguridad, así que una copia que se ejecuta en ese momento se repite después. Cuando las actualizaciones automáticas están activadas, mantenga la hora de la copia fuera de la hora de actualización (03:00 UTC de forma predeterminada).

## Un espejo no se sincroniza {#mirror-not-syncing}

Mire la insignia [[ui:mirrorFailing]] del repositorio, en `GET /api/v1/repositories/{repository}/mirror` y en los eventos del worker `mirror.step_failed`. Las descargas siguen funcionando con lo que está copiado. Consulte [Espejos](./mirrors).

| `errorCode`                                                               | Causa                                                                                 | Solución                                                                                                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mirror_failed`, o un código del origen como `unauthorized` o `forbidden` | El origen es inaccesible, su clave es incorrecta o ha caducado, o le falta un derecho | Pruebe el origen con la clave. Sustituya la clave con `arkvory configure --mirror ... --mirror-token-file`. El worker vuelve a leer la clave tras cada fallo |
| `mirror_mismatch`                                                         | El mismo ID tiene otro contenido en el origen                                         | Se conserva la copia. Investigue el artefacto                                                                                                                |
| `mirror_source_changed`                                                   | El repositorio ya contiene una copia de otro origen                                   | Sepárelo con `--mirror-detach`, y haga un espejo del origen nuevo en un repositorio nuevo                                                                    |
| `mirror_source_behind`                                                    | El origen se restauró o se reinstaló                                                  | Se vuelve a sembrar por sí solo y el código desaparece                                                                                                       |
| Un error de certificado                                                   | El origen usa un certificado de empresa o autofirmado                                 | Pase `--mirror-ca-file` a `arkvory configure`. La comprobación nunca se desactiva                                                                            |

El origen necesita una versión con el feed de espejo. El worker espera 2 segundos tras un fallo, duplicándose hasta 5 minutos. `ArkvoryMirrorStale` se dispara tras una hora sin una puesta al día.

## Una actualización falló {#update-failed}

1. Lea el fallo. En la consola, [[ui:updates]] muestra un mensaje. El actualizador escribe `logs\updater.log` en Windows, y `journalctl -u arkvory-update` en Linux.
2. Compruebe la versión instalada: `arkvory status --root <root>`.
3. Encuentre su caso.

| Caso                                                             | Qué ocurrió                                                                                                                        | Qué hacer                                                                                                                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Mismo esquema de base de datos, fallo normal                     | El instalador arrancó de nuevo la versión anterior                                                                                 | Arregle la causa y actualice de nuevo                                                                                                        |
| La consola muestra [[ui:updateMaintenance]]                      | Una versión con un cambio de esquema necesita una copia de seguridad verificada, y el instalador se negó antes de cualquier cambio | Conecte un almacén, espere la primera copia de seguridad y compruebe de nuevo                                                                |
| La migración falló                                               | Su transacción se revirtió, y la versión anterior se ejecuta sobre el esquema anterior                                             | Arregle la causa y actualice de nuevo                                                                                                        |
| La versión nueva no arrancó tras una migración correcta          | El diario dice `maintenance-required` y nombra un punto de copia de seguridad                                                      | Arregle la causa y ejecute `recover`, que termina la actualización. O restaure el punto con la versión anterior                              |
| El actualizador se mató o la máquina perdió energía              | El bloqueo `operation.lock` y el diario permanecen. Nada continúa por sí solo                                                      | El procedimiento de abajo                                                                                                                    |
| La consola muestra [[ui:updateStale]] o [[ui:updateUnavailable]] | El planificador del host no se ejecuta o no está conectado                                                                         | Compruebe la tarea `ProAnimaArkvoryUpdate` (Windows) o `arkvory-update.timer` (Linux). Conéctela con `arkvory updates-connect --root <root>` |

Tras un actualizador interrumpido:

1. Detenga el planificador y asegúrese de que no se ejecuta ningún actualizador. Guarde `journal.json` y los registros.
2. Solo entonces elimine el archivo `operation.lock` en la raíz de la instalación. Nunca lo elimine mientras se ejecuta una actualización.
3. Ejecute `recover`:

   ```bash
   sudo arkvory recover --root /opt/proanima-arkvory
   ```

   ```powershell
   & 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' recover --root C:\ProgramData\ProAnima\Arkvory
   ```

   Antes de que empezara la migración, restaura la versión anterior. Después de que empezara la migración, repite la migración y arranca la versión nueva.

4. Compruebe `/health/ready`, la cola de finalización y una descarga de prueba. Después vuelva a activar el planificador.

`arkvory updates-reset --root <root>` borra una solicitud de actualización aceptada después de que haya reconciliado el estado. Una degradación no es posible. Consulte [Actualizaciones](../install/updates).

## Docker {#docker}

- **No se ejecuta nada tras reiniciar Windows.** Docker Desktop se inicia cuando el usuario inicia sesión. Active **Start Docker Desktop when you sign in**, o use los servicios nativos.
- **No se ejecuta nada tras reiniciar un host Linux.** Compruebe que el motor se inicia al arrancar: `systemctl is-enabled docker`.
- **Un contenedor no puede leer un archivo de `config/`.** Los contenedores se ejecutan con el usuario `node` (uid 1000). El instalador hace que `runtime.json`, `keys.json` y `health-token.txt` sean legibles para él. Si una edición manual cambió el propietario o el modo a 0600, la API se detiene con `Cannot read ARKVORY_KEYS_FILE (EACCES)`. Restaure el modo 0644 de estos tres archivos. La carpeta `config/` en sí permanece cerrada.
- **El almacén no es escribible.** El agente se ejecuta con uid 1000, así que el almacén debe pertenecerle. `arkvory configure --backup-vault` lo configura con el archivo `config/compose.vault.yml`. Un recurso compartido que monte usted mismo necesita `uid=1000`. Incluya `-f config/compose.vault.yml` en cada comando Compose manual, o `up` crea el contenedor de copias sin el almacén.
- **Un contenedor está `unhealthy`.** La comprobación de estado llama a `/health/ready` cada 10 segundos. Docker marca el contenedor pero no lo reinicia. Lea el registro del contenedor de la API.

Muestre el registro de un contenedor:

```bash
docker logs --tail 100 proanima-arkvory-api-1
```

## Un servicio de Windows no arranca {#windows-service}

1. Lea el estado y la salida de error:

   ```powershell
   Get-Service Arkvoryapi, Arkvoryworker, Arkvorybackup, Arkvorydatabase
   Get-Content C:\ProgramData\ProAnima\Arkvory\logs\arkvory-api.err.log -Tail 50
   ```

2. Abra el Visor de eventos de Windows, **Registros de Windows > Sistema**, y busque eventos del Administrador de control de servicios.
3. Encuentre su causa:

| Causa                                                                                             | Solución                                                                |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| La raíz está dentro de un perfil de usuario, o `LocalService` no puede leer una carpeta principal | Instale en una carpeta dedicada. Consulte [Permisos](#root-permissions) |
| El puerto está ocupado                                                                            | Consulte [El puerto está ocupado](#port-busy)                           |
| El servicio de base de datos no se ejecuta                                                        | Inicie `Arkvorydatabase`. La API reintenta cada 10 segundos             |
| Los servicios arrancaron "tarde" tras un arranque                                                 | Su tipo de inicio es Automático (inicio retrasado). Espere unos minutos |
| El software antivirus puso en cuarentena Node.js                                                  | Permita los archivos de `runtime\`                                      |
| `Another installation owns this service`                                                          | Existen servicios de una instalación en otra raíz. Elimínelos primero   |
| Un servicio permanece detenido                                                                    | Usted o una actualización lo detuvo. Inícielo con `Start-Service`       |

Ejecute de nuevo el instalador gráfico para restaurar los tipos de inicio y las acciones de recuperación de los servicios. Consulte [Windows](../install/windows).

## Registros, ID de solicitud y comentarios {#logs-and-feedback}

**Encuentre los registros.** Linux: `journalctl -u arkvory-api -u arkvory-worker -u arkvory-backup`. Windows: `logs\` en la raíz de la instalación. Compose: `docker logs <container>`. Los formatos y los eventos están en [Monitorización](./monitoring#logs).

**Encuentre el ID de solicitud.** Cada respuesta tiene la cabecera `X-Request-Id`. Cada cuerpo de error tiene `requestId`. La consola lo muestra como [[ui:requestIdLabel]] bajo el mensaje, y el cliente de línea de comandos lo imprime en la línea de error. Busque este valor en los registros de la API y del worker para ver la solicitud y los trabajos que inició.

**Envíe comentarios con registros.**

1. Inicie sesión y seleccione [[ui:reportOpen]] en la barra superior.
2. Describa el problema y añada el ID de solicitud. Puede añadir hasta 6 capturas.
3. Si es administrador, active [[ui:reportServerLog]]. Esto adjunta las líneas de registro más recientes de la API (unos 1.5 MiB) y un resumen del sistema sin direcciones ni secretos.
4. Seleccione [[ui:reportShow]] para ver exactamente lo que se enviará, y después [[ui:reportSend]].

El servidor envía el informe al hub de ProAnimaStudio. Si no se puede alcanzar el hub o los comentarios están desactivados, la consola muestra la dirección `info@proanima.net` a la que escribir. Consulte [Seguridad](./security#hub) para saber qué se envía.

## Páginas relacionadas {#related-pages}

- [Monitorización](./monitoring)
- [Autorrecuperación](./self-healing)
- [Seguridad](./security)
- [Errores](../api/errors)
- [Windows](../install/windows)
