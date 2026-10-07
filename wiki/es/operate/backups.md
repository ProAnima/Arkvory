---
title: Copias de seguridad
description: Conecte un almacén de copias, programe y verifique las copias de seguridad, restaure un punto de restauración en un servidor vacío y pruebe la restauración con regularidad.
---

# Copias de seguridad

El agente de copias de seguridad copia la base de datos y los archivos almacenados de su instalación en un **almacén de copias**: un directorio en otro disco o en un recurso compartido de red. Funciona mientras las personas siguen subiendo y descargando. Cada copia terminada es un **punto de restauración** que puede verificar y restaurar.

Esta página describe el almacén de copias, la programación, la retención, la verificación, las pantallas de estado y el procedimiento de restauración. La restauración es un comando que se ejecuta en el servidor. La consola no tiene un botón de restauración.

## Cómo funcionan las copias {#how-backups-work}

El agente es el tercer servicio de una instalación, junto con la API y el worker. Se llama `arkvory-backup` en Linux, `Arkvorybackup` en Windows y `backup` en Docker Compose. Solo trabaja un agente a la vez. Un segundo agente espera y toma el relevo cuando el primero se detiene.

El agente hace tres cosas:

- Ejecuta el plan diario cuando el plan está activado.
- Ejecuta las tareas que usted solicita en la consola, con `arkvoryctl` o mediante la API.
- Comprueba cada punto de restauración nuevo y aplica la retención.

Un punto de restauración contiene el estado publicado de la instalación en un momento **T**, la hora de la instantánea. Los archivos que se publican después de T pasan a la copia siguiente. La consola calcula la antigüedad de una copia a partir de T, no de la hora en que terminó la copia.

Tenga en cuenta lo siguiente:

- Una copia no detiene las subidas ni las descargas. Mientras se ejecuta, la limpieza física respeta los archivos que la copia necesita y los elimina en una pasada posterior.
- Un archivo se guarda una sola vez en el almacén, sin importar cuántos puntos de restauración lo contengan. La primera copia lo copia todo, por lo que con terabytes de contenido tarda mucho. Las copias posteriores solo copian los archivos nuevos.
- Un punto de restauración aparece únicamente cuando su copia está completa. Una copia fallida o interrumpida nunca daña los puntos anteriores.
- Una copia no es un sistema de recuperación a un instante arbitrario ni de alta disponibilidad. Se restaura el estado de un punto de restauración y se pierden los cambios posteriores a su T.

## Qué contiene una copia {#contents}

Un punto de restauración contiene:

- Las tablas del catálogo de la base de datos: artefactos, paquetes, rutas de archivo y su historial, etiquetas y metadatos, etapas, adjuntos, cuentas, grupos y permisos, cuentas de servicio y claves, los registros de auditoría, las políticas de almacenamiento y de limpieza, los datos del registro de imágenes de contenedor, de Git LFS y de npm, y el estado de los espejos.
- El contenido de cada archivo publicado.

Un punto de restauración no contiene:

- Las sesiones, los enlaces de descarga ni el estado de ejecución de las puertas de enlace de lectura.
- Las subidas sin terminar. La restauración las cancela y los clientes las inician de nuevo.
- El plan de copias ni el estado del agente. Una instalación restaurada se inicia con las copias desactivadas.
- El directorio `config/` de la instalación: la configuración, los archivos TLS, las claves de los espejos y la clave de recuperación. Conserve usted mismo copias de estos archivos.
- Los programas de Arkvory. Instale primero una versión y después restaure.

## Preparar el almacén de copias {#vault}

### Requisitos {#vault-requirements}

| Requisito                                                                                                                        | Motivo                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Un directorio nuevo o vacío, montado antes de que se inicien los servicios                                                       | El agente escribe allí `vault.json` y los puntos de restauración                                                                    |
| Fuera del directorio de la instalación y del directorio de almacenamiento, también a través de enlaces, uniones y nombres cortos | Un almacén dentro del almacenamiento se pierde con él. La comprobación rechaza una ruta que los contenga o que esté dentro de ellos |
| Con permiso de escritura para la cuenta del servicio                                                                             | En Linux, `arkvory`. En Windows, `NT AUTHORITY\LocalService`. `arkvory configure` asigna los permisos por usted                     |
| Al menos 1 GiB de espacio libre además de los datos que se copian                                                                | El almacén mantiene esta reserva. Un volumen lleno termina la copia con `vault_full` y los puntos anteriores quedan intactos        |
| En Linux, fuera de `/home`, `/root`, `/run/user`, `/tmp` y `/var/tmp`                                                            | El entorno aislado del servicio oculta estos árboles                                                                                |
| En Windows, un volumen local o iSCSI con letra de unidad                                                                         | `LocalService` no puede iniciar sesión en recursos compartidos SMB, por lo que se rechazan rutas como `\\nas\share`                 |

Use un volumen de otro disco, o de un NAS, para que el fallo del disco de almacenamiento no se lleve consigo las copias. Un almacén en el mismo disco físico que el almacenamiento protege de los errores, no del fallo del disco.

**El vault está cifrado por defecto.** Arkvory cifra los archivos, el catálogo y las descripciones de los puntos (véase [Cifrar el vault](#encryption)). Un vault creado sin cifrado guarda el catálogo, los hashes de contraseñas y todos los archivos publicados en claro: póngalo en un volumen cifrado (LUKS, BitLocker, cifrado del NAS) y permita el acceso solo a la cuenta de servicio y al administrador de copias.

### Cifrar el vault {#encryption}

Un vault se cifra al crearse y sigue así. Arkvory cifra el contenido de los archivos, el catálogo y las descripciones de los puntos con AES-256-GCM, y al leer el vault detecta un archivo modificado, cortado o sustituido. No oculta los nombres de los archivos, sus tamaños ni el número de puntos.

Cree el vault en el servidor con el programa `arkvory-backup` (véase [Antes de empezar](#restore-prepare)). Los dos archivos deben ser nuevos y estar fuera del vault y del almacenamiento:

```bash
arkvory-backup vault init /mnt/backup/arkvory \
  --kit-file /root/arkvory-recovery-kit.txt \
  --agent-key-file /root/arkvory-agent.key
```

1. El comando crea el vault con dos claves: la clave del agente (`arkvory-agent.key`) y la clave de recuperación en el kit de recuperación. Abre el vault con cada una antes de informar del éxito.
2. Saque ahora el kit de recuperación de este servidor: a un gestor de contraseñas o a una caja fuerte. Sin el kit o la clave del agente, nadie puede leer las copias y nadie puede restaurarlas por usted. Quien tenga el kit y una copia del vault puede leer todas las copias que contiene.
3. Conecte el vault con la clave del agente, como muestra la sección siguiente, y borre su copia del archivo de clave. La instalación guarda su propia copia en `config/backup/vault.key`, legible solo por la cuenta de servicio.

La clave de recuperación del kit abre solo este vault. No es la clave de recuperación de la instalación (`config/bootstrap-token.txt`).

Compruebe que el kit abre el vault ahora y de nuevo tras cada cambio de claves:

```bash
arkvory-backup vault key verify --vault /mnt/backup/arkvory --key-file /root/arkvory-recovery-kit.txt
```

Una clave pertenece a una ranura, y cada ranura abre el vault con su propia clave. Estos comandos cambian las ranuras. Ninguno muestra una clave:

| Comando                                                                  | Efecto                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vault key list --vault DIR`                                             | Lista las ranuras: id, tipo (`agent` o `recovery`) y hora de creación. No necesita clave.                                                                                                                                                                                     |
| `vault key add-recovery --vault DIR --key-file KEY --kit-file NEW`       | Añade una ranura de recuperación y escribe su kit, para otra persona u otra caja fuerte.                                                                                                                                                                                      |
| `vault key rotate-agent --vault DIR --key-file KEY --agent-key-file NEW` | Crea un archivo y una ranura nuevos para la clave del agente. La clave anterior del agente sigue funcionando: ejecute `arkvory configure` con el nuevo archivo de clave y luego elimine la ranura anterior (`backup.vault.key.previous` en la salida) con `vault key remove`. |
| `vault key remove --vault DIR --key-file KEY --slot ID`                  | Elimina una ranura. La última ranura y la última ranura de recuperación se conservan.                                                                                                                                                                                         |

Eliminar una ranura cierra el vault a quien solo tenga esa clave. No vuelve a cifrar los puntos anteriores: quien copió antes el vault y una clave sigue leyendo esa copia. Si una clave pudo filtrarse, cree un vault nuevo con claves nuevas y empiece allí nuevos puntos.

Es posible un vault sin cifrado: `arkvory-backup vault init DIR --no-encryption`. Guarda el catálogo, los hashes de contraseñas y todos los archivos en claro, por lo que necesita un volumen cifrado y acceso solo para la cuenta de servicio.

### Conectar el almacén {#connect-vault}

Ejecute el comando como root o como administrador, en el servidor. Comprueba el directorio antes de cambiar nada.

```bash
sudo arkvory configure --root /opt/proanima-arkvory --backup-vault /mnt/backup/arkvory --vault-key-file /root/arkvory-agent.key
```

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' configure --root $root --backup-vault D:\Backup\Arkvory --vault-key-file C:\Private\arkvory-agent.key
```

En una instalación por scripts en Windows, inicie `manage.mjs` como se describe en [Windows](../install/windows#manage-the-services).

1. El comando comprueba la ruta: absoluta, un directorio existente con permiso de escritura, fuera de la instalación y del almacenamiento, y visible para el servicio.
2. Un vault cifrado, el predeterminado, ya existe: lo creó con `arkvory-backup vault init`, y `--vault-key-file` entrega al servicio su clave (una clave `AK1-…`, nunca la de recuperación). Con `--init-vault --vault-no-encryption` crea en su lugar un vault sin cifrado en un directorio **vacío**. Nunca inicializa un directorio dos veces. Sin `vault.json` y sin `--init-vault` se niega, para no confundir un NAS no montado con un vault vacío.
3. Da acceso a la cuenta de servicio, copia la clave a `config/backup/vault.key`, escribe `ARKVORY_BACKUP_VAULT` y `ARKVORY_BACKUP_VAULT_KEY_FILE` en `config/runtime.json` y reinicia solo el agente.
4. Espera hasta 150 segundos a que el agente informe de que este almacén está disponible. Esta comprobación lee `config/bootstrap-token.txt`, por lo que no elimine ese archivo.
5. Si algo falla, restaura la configuración y el acceso anteriores y reinicia el agente.

Para usar un vault que ya existe, por ejemplo en un servidor nuevo, indique su clave con `--vault-key-file` y omita `--init-vault`. Para desconectar el vault, use `--backup-vault-off`: el directorio y sus archivos no cambian y se elimina el archivo de clave de la instalación. Un reinicio interrumpe una copia en curso, y el agente la repite.

En Docker Compose, el almacén es un bind mount definido en `config/compose.vault.yml`. Cuando ejecute usted mismo los comandos de Compose, añada `-f config/compose.vault.yml`. Sin esa opción, `up` crea el contenedor del agente sin el almacén.

### Almacén en un recurso compartido de red {#network-share}

En Linux, un NAS funciona mediante SMB 3 y NFS 4. Monte el recurso compartido de modo que los archivos pertenezcan a la cuenta del servicio; de lo contrario, el agente no puede escribir y `configure` se niega y restaura la configuración anterior.

```bash
sudo mount -t cifs //nas/arkvory /mnt/backup/arkvory \
  -o credentials=/etc/arkvory/smb.credentials,uid=$(id -u arkvory),gid=$(id -g arkvory),file_mode=0600,dir_mode=0700,vers=3.1.1
```

- Asigne al archivo de credenciales el modo `0600`.
- Con NFS, asigne los propietarios de modo que los archivos pertenezcan a `arkvory`. Use `no_root_squash` en la exportación, o el mismo ID de usuario en ambos lados.
- Añada el montaje a `/etc/fstab` con `_netdev`. Con SMB, añada `nofail` cuando el NAS pueda no estar disponible durante el arranque.
- Si el NAS se desconecta, el agente informa de `vault_unavailable`. No escribe en el punto de montaje vacío, porque la identidad del almacén se guarda en `vault.json`.

## Programación y retención {#schedule}

### Establecer la programación {#set-schedule}

Abra [[ui:backups]] y use [[ui:backupPlan]]. Necesita el permiso para administrar las copias de seguridad. Sin él, el formulario muestra [[ui:backupReadOnly]].

| Ajuste                                                        | Significado                                                                                                                          | Valor predeterminado |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| [[ui:backupEnabled]]                                          | Activa el plan diario. Activarlo no inicia una copia de inmediato                                                                    | Desactivado          |
| [[ui:backupTime]]                                             | Hora local de la copia diaria, con precisión de minutos                                                                              | 02:00                |
| [[ui:backupTimezone]]                                         | La zona horaria IANA de esa hora local, por ejemplo `Europe/Moscow` o `UTC`. No se aceptan desfases como `+03:00`                    | `UTC`                |
| [[ui:backupDaily]], [[ui:backupWeekly]], [[ui:backupMonthly]] | Cuántos días, semanas y meses de puntos de restauración se conservan. Consulte [Retención](#retention). Límites: 0–366, 0–260, 0–120 | 7, 4, 6              |

Seleccione [[ui:backupPlanSave]]. Si otra persona cambió el plan mientras tanto, la consola carga el plan actual, usted lo revisa y lo guarda de nuevo.

La programación sigue estas reglas:

- Una hora local que no existe el día de un cambio de hora se ejecuta en el momento del cambio. Una hora local que se repite se ejecuta una sola vez, la primera.
- Después de un período de inactividad, el agente hace una sola copia de recuperación, no una por cada día perdido. Cambiar la programación no provoca una copia de recuperación para horas anteriores.
- La ventana de actualización predeterminada de una instalación es las 03:00 UTC. Una actualización detiene el agente, y una copia en curso se interrumpe y se repite más tarde. Elija una hora de copia que no coincida con la ventana de actualización. Consulte [Actualizaciones](../install/updates).

### Retención {#retention}

La retención conserva el punto de restauración más reciente de cada uno de los últimos N días locales, de cada una de las últimas N semanas ISO y de cada uno de los últimos N meses, contados en la zona horaria del plan. Los tres grupos se unen, de modo que 7, 4 y 6 conservan como máximo 17 puntos, y normalmente menos.

La retención conserva siempre:

- Los puntos fijados.
- El punto más reciente, de modo que siempre queda al menos un punto.

La retención nunca elimina un punto que no superó la verificación y nunca toca los puntos de otra instalación en el mismo almacén.

Después de cada copia, el agente pone la retención en cola como una tarea aparte. También puede seleccionar [[ui:backupRetentionApply]]. Primero, la consola muestra qué puntos se conservan y cuáles se eliminan. Una eliminación no se puede deshacer. Después, el agente elimina el punto y, a continuación, los archivos que ningún punto restante necesita. Si el almacén contiene un punto dañado (un directorio de punto sin `COMMITTED` o con un manifiesto no válido), la eliminación se detiene con `invalid_manifest`. Deje el almacén como está, busque la causa y después elimine a mano el directorio dañado.

La retención de las copias no cambia la retención de las compilaciones de sus repositorios. Consulte [Almacenamiento](./storage).

### Fijar un punto de restauración {#pin}

Un punto fijado se conserva más allá de las reglas de retención. Por ejemplo, fije el punto anterior a una migración importante.

- Consola: seleccione [[ui:backupPin]] en la fila del punto, en [[ui:backupPoints]]. [[ui:backupUnpin]] lo libera.
- CLI: `arkvoryctl backup pin POINT_ID` y `arkvoryctl backup pin POINT_ID --off`.
- API: [setBackupPointPin](../api/reference/backups#setBackupPointPin).

## Verificación {#verification}

Hay dos tipos de verificación:

| Tipo                                                     | Qué comprueba                                                                                                         | Cuándo se ejecuta                                                                                                                                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rápida (la consola indica [[ui:backupVerifyStructural]]) | Cada archivo del punto frente al digest de su manifiesto, y que cada archivo almacenado exista con el tamaño correcto | Automáticamente después de cada copia                                                                                                                                                        |
| Completa ([[ui:backupVerifyDeep]])                       | Las comprobaciones rápidas, además de leer cada archivo almacenado y comprobar su SHA-256                             | Automáticamente una vez cada 7 días para el punto más reciente. Bajo demanda con [[ui:backupVerifyDeepAction]], con `arkvoryctl backup verify POINT_ID` o con `arkvory-backup verify --deep` |

Una verificación completa lee todo el punto, por lo que con un almacén grande requiere tiempo y velocidad de disco. Si un punto no la supera, la consola muestra [[ui:backupVerifyFailed]] con un código de error y se activa la advertencia `verify_failed`. No cambie el almacén hasta que conozca la causa.

Un punto que todavía no se ha comprobado muestra [[ui:backupVerifyNone]]. Una verificación completa del punto más reciente es también la mejor comprobación periódica de que el almacén se puede leer.

## Crear una copia ahora {#run-now}

Use cualquiera de estas opciones:

- Consola: [[ui:backupRun]] en [[ui:backups]].
- CLI: `arkvoryctl backup run`.
- API: [requestBackupRun](../api/reference/backups#requestBackupRun) responde con 202 y la tarea en cola.

El agente revisa su cola cada 15 segundos (`ARKVORY_BACKUP_POLL_SECONDS`), por lo que la tarea se inicia poco después. Las tareas se ejecutan una a una, y cerrar la consola no las detiene. Una tarea que se detiene por un reinicio o por un conflicto se repite, hasta 5 intentos. Consulte [Variables de entorno](../reference/environment#backups) para ver los ajustes del agente, incluido el límite de velocidad de copia `ARKVORY_BACKUP_BYTES_PER_SECOND`.

Una copia pasa por estas fases, que la consola muestra en [[ui:backupJobPhase]]: [[ui:backupPhasePreparing]], [[ui:backupPhaseCatalog]], [[ui:backupPhaseTransfer]], [[ui:backupPhaseFinishing]] y [[ui:backupPhaseDone]]. Una verificación rápida muestra [[ui:backupPhaseStructural]], y una completa, [[ui:backupPhaseDeep]].

No ejecute migraciones de la base de datos ni las herramientas sin conexión `gc` y `scrub` durante una copia. Esperan a que termine o se niegan con `busy`.

## Vigilar el estado {#status}

### En la consola {#status-console}

[[ui:backups]] es visible para los administradores y para la clave de recuperación. Las claves de servicio y los tokens de acceso personal nunca la ven. La página muestra:

- El estado: [[ui:backupStateOk]], [[ui:backupStateWarning]] o [[ui:backupStateCritical]].
- [[ui:backupNewest]] con su antigüedad desde T, [[ui:backupNextRun]] con [[ui:backupOverdue]] cuando una ejecución se retrasa, [[ui:backupAgent]] con su última señal y [[ui:backupVault]] con el espacio libre y si el almacén está cifrado ([[ui:backupVaultEncrypted]] o [[ui:backupVaultPlain]]). Un almacén sin cifrar recibe un aviso, no una advertencia.
- La tarea que se ejecuta en este momento y, a continuación, las advertencias, cada una con una indicación de qué hacer.
- [[ui:backupPoints]], con [[ui:backupSnapshot]], [[ui:backupCompleted]], [[ui:backupSize]], [[ui:backupFiles]], [[ui:backupVerification]] y la opción de fijar.
- [[ui:backupJobs]], con el tipo ([[ui:backupKindCapture]], [[ui:backupKindVerify]], [[ui:backupKindRetention]]), el estado, la fase, las horas, el código de error y el progreso.

Una tarea tiene uno de estos estados: [[ui:backupJobQueued]], [[ui:backupJobRunning]], [[ui:backupJobCommitting]], [[ui:backupJobCompleted]], [[ui:backupJobFailed]] o [[ui:backupJobInterrupted]]. La página se actualiza mientras se ejecuta una tarea. Use [[ui:backupRefresh]] en cualquier momento.

### Advertencias {#warnings}

| Código                 | Nivel       | Qué hacer                                                                                                                                                                                          |
| ---------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vault_not_configured` | Advertencia | Conecte un almacén. Consulte [Conectar el almacén](#connect-vault)                                                                                                                                 |
| `agent_offline`        | Crítico     | Sin señal durante 2 minutos. Inicie el servicio del agente y lea su registro                                                                                                                       |
| `schedule_disabled`    | Advertencia | Active el plan si necesita copias diarias                                                                                                                                                          |
| `no_backup_yet`        | Advertencia | Cree la primera copia                                                                                                                                                                              |
| `backup_stale`         | Crítico     | El punto más reciente tiene más de 26 horas y el plan está activado. Lea los códigos de error de las tareas y el registro del agente                                                               |
| `last_run_failed`      | Advertencia | La última copia falló. El código de error está en la lista de tareas                                                                                                                               |
| `vault_unavailable`    | Crítico     | El volumen no está montado, falta `vault.json`, el vault no admite escritura, o un vault cifrado no tiene una clave válida (el registro del agente dice `vault_key_missing` o `vault_key_invalid`) |
| `vault_low_space`      | Advertencia | Queda libre menos del 10 % del volumen, o menos del doble de los datos nuevos de la última copia. Libere espacio o conserve menos puntos                                                           |
| `verify_failed`        | Crítico     | Un punto no superó la verificación. No cambie el almacén; investigue                                                                                                                               |
| `never_deep_verified`  | Advertencia | Hace más de 8 días que no hay una verificación completa. Compruebe que el agente se ejecuta o inicie una verificación completa                                                                     |

### Con la CLI y la API {#status-cli}

```bash
arkvoryctl backup status
arkvoryctl backup jobs
arkvoryctl backup points
arkvoryctl backup status --json || echo "backup problem"
```

`backup status` termina con el código de salida 9 mientras haya una advertencia crítica activa, por lo que puede usarlo en un monitor. Estos comandos requieren la clave de archivo del propietario o una sesión de administrador de la cuenta. Consulte [Cliente de línea de comandos](../protocols/cli#backups) y [SDK de TypeScript](../protocols/sdk#backups). Las operaciones HTTP están en la [referencia de la API de copias de seguridad](../api/reference/backups).

Para Prometheus, la API expone `arkvory_backup_last_success_timestamp_seconds` (la T del punto más reciente), `arkvory_backup_agent_last_seen_timestamp_seconds` y `arkvory_backup_warnings` con una etiqueta `code`. Consulte [Monitorización](./monitoring).

## Restaurar {#restore}

Una restauración escribe en una base de datos **vacía** y en un directorio de almacenamiento **vacío**. Nunca sobrescribe una instalación en funcionamiento. Después de la restauración, inicie una instancia independiente con los datos restaurados, compruébela y solo entonces decida si sustituye al servidor anterior.

### Antes de empezar {#restore-prepare}

- **El programa.** El comando de restauración es el programa `arkvory-backup` de la versión instalada. Inícielo con el Node.js de la instalación:
  - Paquetes de Linux: `/opt/proanima-arkvory/runtime/node /opt/proanima-arkvory/releases/VERSION/apps/backup/dist/main.js COMMAND`
  - Instalador gráfico de Windows: `& "$root\runtime\node.exe" "$root\releases\VERSION\apps\backup\dist\main.js" COMMAND`

  `VERSION` es la versión instalada que consta en `installation.json`. En el resto de esta página, `arkvory-backup` representa esta línea de comandos completa. Quienes usan Docker Compose ejecutan el mismo programa desde un contenedor de la imagen de la versión. En una instalación por scripts, use la carpeta de Node.js que está en `runtime/`.

- **La versión.** Use la versión que creó el punto o una más reciente. Un punto de una versión más reciente se rechaza con `schema_mismatch`.
- **La cuenta.** Ejecute el comando con una cuenta que pueda leer el almacén. En Linux, el almacén pertenece a `arkvory` y tiene el modo 0700, así que use `sudo -u arkvory`. En Windows, use un PowerShell con privilegios elevados. El nuevo directorio de almacenamiento debe terminar siendo propiedad de la cuenta que ejecutará la API.
- **La clave.** Un vault cifrado necesita su clave. Pase el kit de recuperación o un archivo de clave como `--key-file FILE` a cada comando siguiente, o defina `ARKVORY_BACKUP_VAULT_KEY_FILE`. La clave es siempre un archivo, nunca un argumento.
- **El destino.** Cree una base de datos vacía, por ejemplo `CREATE DATABASE arkvory_restore OWNER arkvory;`. Elija un directorio de almacenamiento que no exista o esté vacío, en un volumen distinto del almacén de copias y fuera del almacenamiento de origen.
- **La URL de la base de datos.** Pásela en el entorno, no como argumento, porque los argumentos son visibles en la lista de procesos.

### Restaurar paso a paso {#restore-steps}

1. Liste los puntos de restauración y elija uno. Copie el ID del punto.

   ```bash
   arkvoryctl backup points
   arkvory-backup list --vault /mnt/backup/arkvory
   ```

2. Verifique el punto por completo.

   ```bash
   arkvory-backup verify --vault /mnt/backup/arkvory --point POINT_ID --deep
   ```

3. Defina la base de datos de destino en el entorno.

   ```bash
   export ARKVORY_RESTORE_DATABASE_URL='postgresql://arkvory@db.example/arkvory_restore'
   ```

4. Ejecute la restauración **sin** `--yes`. Es un ensayo. Comprueba el punto, los hashes de los archivos, la versión del esquema y que el destino esté vacío, y no escribe nada.

   ```bash
   arkvory-backup restore --vault /mnt/backup/arkvory --point POINT_ID --storage /srv/arkvory-restore
   ```

   Una comprobación superada termina con el código de salida 0 y la línea de registro `backup.restore.planned`.

5. Ejecute el mismo comando con `--yes`. Añada `--report` para conservar un archivo de informe. El archivo todavía no debe existir.

   ```bash
   arkvory-backup restore --vault /mnt/backup/arkvory --point POINT_ID --storage /srv/arkvory-restore --yes --report /root/restore-report.json
   ```

   La restauración pasa por las fases `verify`, `content`, `schema`, `tables`, `migrate` y `done`. Copia cada archivo y comprueba su SHA-256, crea el esquema, carga todas las tablas en una sola transacción, aplica la normalización y después ejecuta las migraciones restantes. El informe contiene solo identificadores y recuentos, nunca rutas ni credenciales.

6. Inicie una instancia independiente de la API con los datos restaurados: `ARKVORY_DATABASE_URL` de la base de datos nueva, `ARKVORY_DATA_DIR` del directorio nuevo, su propio `ARKVORY_KEYS_FILE` y otro puerto. Compruebe que `/health/ready` responde, que puede iniciar sesión, que el catálogo está completo y que un archivo de control se descarga con el mismo SHA-256.

Si una restauración falla, elimine la base de datos y el directorio de destino y créelos de nuevo. Un destino que no está vacío se rechaza con `target_not_empty`, lo que protege los datos existentes.

### Qué cambia una restauración {#after-restore}

La restauración aplica un conjunto fijo de cambios, de modo que la instancia nueva no continúa nada que estuviera en curso y no activa ninguna credencial antigua:

- Las subidas sin terminar se cancelan y liberan su cuota. Las tareas de finalización en cola o en ejecución terminan como fallidas con el código `conflict`. Las promociones sin terminar se descartan.
- No se restaura ninguna sesión. Todos vuelven a iniciar sesión.
- Todos los tokens de acceso personal se revocan y todas las claves de servicio pasan a `revoked`. Emita claves nuevas.
- La retención del almacenamiento y la limpieza física se desactivan en todos los repositorios. Vuelva a activarlas de forma deliberada.
- Las copias están desactivadas y no hay ningún almacén configurado. Los enlaces de descarga y los ajustes de las puertas de enlace de lectura no se trasladan.
- Las cuentas, los grupos y los permisos se conservan, con los hashes de las contraseñas tal como estaban en T. Una contraseña que cambió después de T vuelve a funcionar en su forma anterior, así que restablezca las contraseñas según su propia política.
- La clave de recuperación y las claves de archivo proceden del archivo de claves de la instalación que ejecuta los datos restaurados.
- Los espejos conservan su posición, pero la configuración de los espejos está en `config/`. Conéctelos de nuevo. Consulte [Espejos](./mirrors).
- Una entrada de auditoría de seguridad, `backup.restored`, registra el punto y los recuentos.

### Trasladarse a otro servidor {#move-server}

Puede usar una copia para trasladar una instalación a otro servidor:

1. Instale Arkvory en el servidor nuevo con la misma versión o una más reciente. Consulte [Elegir una instalación](../install/index).
2. Conecte al servidor nuevo el mismo almacén, o una copia de él. No use `--init-vault` con un almacén existente.
3. Restaure el punto más reciente en una base de datos nueva y vacía y en un directorio vacío, como se describe arriba, y pruebe el resultado.
4. Dirija la instalación a los datos restaurados: defina `ARKVORY_DATABASE_URL` y `ARKVORY_DATA_DIR` en `config/runtime.json` y reinicie los servicios. Consulte [Configuración](../install/configuration).
5. Emita claves nuevas, defina de nuevo las políticas de retención y de limpieza, conecte los espejos y el plan de copias, e informe a los clientes de la dirección nueva.

Los dos últimos pasos son manuales y no forman parte de un traspaso guiado. Ensaye primero toda la secuencia en un servidor de reserva. Los cambios hechos en el servidor anterior después de T se pierden, así que detenga el servidor anterior antes de que los clientes se trasladen.

## Probar la restauración con regularidad {#test-restore}

Una copia que nunca se ha restaurado es solo una esperanza. El producto verifica los bytes de un punto, pero no registra una restauración de prueba. Anote usted mismo la fecha y el resultado.

Pruebe como mínimo:

- Después de la primera copia.
- Después de cada actualización que cambie el esquema de la base de datos.
- Según un calendario propio, por ejemplo cada trimestre.

Cada prueba sigue [Restaurar paso a paso](#restore-steps) en un servidor de reserva o en una base de datos temporal, y termina con un inicio de sesión, un vistazo al catálogo y la descarga de un archivo de control. Después, elimine la base de datos temporal y el directorio.

## Códigos de salida y líneas de registro {#exit-codes}

### Códigos de salida {#exit-codes-table}

El programa `arkvory-backup` escribe un objeto JSON por línea en su salida estándar y, en caso de fallo, una línea de indicación en el error estándar.

| Código | Significado                                                                                                                                                          |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0      | Éxito. En `restore` sin `--yes`, la comprobación se superó                                                                                                           |
| 1      | La ejecución falló: base de datos o disco no disponibles, lease o instantánea perdidos, almacén o destino llenos. Los puntos de restauración no se dañan             |
| 2      | Argumentos o variables de entorno incorrectos                                                                                                                        |
| 3      | Una comprobación de seguridad lo rechazó: no hay `vault.json`, directorios que se solapan, un destino que no está vacío, un esquema no admitido, no existe tal punto |
| 4      | Fallo de integridad: un hash, un archivo ausente o un manifiesto modificado. Deje el almacén sin cambios hasta que entienda la causa                                 |
| 5      | Ocupado: se ejecuta otra copia o un mantenimiento, o una eliminación no terminó a tiempo. Inténtelo más tarde                                                        |

### Líneas de registro {#log-lines}

En cada línea, `component` es `backup`. Nunca se escriben rutas, URL ni secretos. Las líneas más útiles:

| Código                                                                                      | Significado                                                                                                                    |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `backup.phase`                                                                              | Una copia pasa a una fase: `barrier`, `pins`, `tables`, `blobs`, `manifest`, `commit`, `done`                                  |
| `backup.capture.completed`                                                                  | Una copia ha terminado. Campos: `pointId`, `outcome`, `blobs`, `copied`, `reused`, `copiedBytes`, `contentBytes`, `durationMs` |
| `backup.point`                                                                              | Un punto de restauración en la salida de `list`                                                                                |
| `backup.verify.point`, `backup.verify.problem`                                              | El resultado de una verificación y cada problema con su `errorCode`                                                            |
| `backup.restore.phase`, `backup.restore.planned`, `backup.restore.completed`                | Progreso y resultado de la restauración, con recuentos de filas y de los cambios enumerados arriba                             |
| `backup.failed`                                                                             | Un comando falló. Lea `errorCode`                                                                                              |
| `backup.agent.started`, `.standby`, `.lease_acquired`, `.lease_lost`, `.stopped`, `.failed` | La vida del agente                                                                                                             |
| `backup.request.started`, `.done`, `.failed`, `.requeued`                                   | Una tarea del agente, con `kind` y `errorCode`                                                                                 |
| `backup.schedule.due`                                                                       | El plan inició una copia                                                                                                       |
| `backup.retention.applied`                                                                  | La retención terminó. Campos: `forgotten`, `blobs`, `freedBytes`                                                               |

Lea el registro del agente con `journalctl -u arkvory-backup` en Linux, en `logs\` de la raíz de la instalación en Windows y con `docker compose logs backup` en Compose.

### Códigos de error {#error-codes}

| `errorCode`                                              | Salida | Qué hacer                                                                                                                                       |
| -------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `vault_missing`                                          | 3      | El directorio no tiene `vault.json`. Monte el volumen o ejecute `vault init` una vez                                                            |
| `vault_key_missing`                                      | 3      | El vault está cifrado y no se dio ninguna clave. Use `--key-file FILE` o `ARKVORY_BACKUP_VAULT_KEY_FILE`                                        |
| `vault_key_invalid`                                      | 3      | La clave no abre este vault: compruebe el archivo, el vault o si se eliminó la ranura. Una errata se detecta por la suma de control de la clave |
| `unsafe_path`                                            | 3      | Mantenga el almacén de copias, el almacenamiento y el destino de la restauración en árboles de directorios separados                            |
| `target_not_empty`                                       | 3      | La restauración escribe solo en una base de datos vacía y en un directorio vacío                                                                |
| `schema_mismatch`                                        | 3      | El punto es más reciente que la versión o más antiguo que la restauración admitida. Use otra versión                                            |
| `upgrade_required`                                       | 3      | Actualice todos los procesos de la API y de mantenimiento de la instalación                                                                     |
| `point_not_found`, `storage_mismatch`                    | 3      | El ID del punto es incorrecto, o `ARKVORY_DATA_DIR` no es un directorio de almacenamiento inicializado de esta instalación                      |
| `integrity_mismatch`, `invalid_manifest`, `blob_missing` | 4      | Deje el almacén sin cambios. Ejecute `verify --deep` e investigue                                                                               |
| `busy`, `barrier_timeout`                                | 5      | Se ejecuta otra operación. Inténtelo más tarde                                                                                                  |
| `vault_full`, `storage_full`                             | 1      | Libere espacio. Los puntos anteriores están intactos                                                                                            |
| `attempts_exhausted`                                     | 3      | Esta solicitud agotó sus 5 intentos. Inicie una copia nueva                                                                                     |

## Límites {#limits}

- Un plan y un almacén por instalación. El almacén es un directorio en un disco o en un recurso compartido montado, sin S3 ni perfil externo o inmutable.
- El cifrado oculta el contenido y el catálogo, no los nombres de archivo, sus tamaños ni el número de puntos. Perder las claves es perder las copias. Eliminar una ranura de clave no vuelve a cifrar los puntos anteriores.
- No se puede pausar ni cancelar una tarea de copia, y la consola no tiene un asistente de restauración ni el estado de las pruebas de restauración.
- La restauración requiere un destino vacío, y el traspaso a los datos restaurados es un paso manual.
- El agente de copias de seguridad no es un sistema de alta disponibilidad. Un segundo agente solo espera como reserva.

## Páginas relacionadas {#related-pages}

- [Elegir una instalación](../install/index)
- [Actualizaciones](../install/updates)
- [Almacenamiento](./storage)
- [Espejos](./mirrors), para un segundo sitio
- [Monitorización](./monitoring)
- [Autorrecuperación](./self-healing)
- [Solución de problemas](./troubleshooting)
- [Variables de entorno](../reference/environment#backups)
