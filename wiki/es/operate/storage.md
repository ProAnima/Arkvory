---
title: Almacenamiento
description: Planifique el espacio en disco, defina cuotas y políticas de retención por repositorio, libere espacio sin detener el servidor y sepa qué hacer cuando el disco se llena.
---

# Almacenamiento

Arkvory guarda cada archivo publicado una sola vez, sin cambios, en un directorio de almacenamiento de un disco local del servidor. Esta página explica qué ocupa espacio en disco, cómo limitarlo con cuotas y políticas de retención, cómo salen del disco los archivos eliminados y qué hacer cuando el disco está lleno.

## Dónde está el contenido {#location}

El directorio de almacenamiento se define con `ARKVORY_DATA_DIR`. Los instaladores usan estas ubicaciones:

| Instalación    | Almacenamiento                                  |
| -------------- | ----------------------------------------------- |
| Windows        | `data\` en `C:\ProgramData\ProAnima\Arkvory`    |
| Linux          | `data/` en `/opt/proanima-arkvory`              |
| Docker Compose | El volumen de Docker `proanima-arkvory_storage` |

Dentro de él, `blobs/` contiene los archivos terminados, `staging/` y `parts/` contienen las subidas en curso, y el archivo `storage-id` vincula el directorio con la base de datos. El catálogo, con todos los nombres, etiquetas, versiones y permisos, está en PostgreSQL. Los archivos y la base de datos van juntos.

- Use un sistema de archivos local que admita enlaces físicos. No use un recurso compartido de red para el almacenamiento.
- No añada, cambie ni elimine archivos del directorio a mano. Arkvory elimina los archivos por sí mismo, como se describe más abajo.
- Un archivo publicado nunca cambia. El contenido nuevo es un archivo nuevo con un ID nuevo.

## Planificar el disco {#disk}

Lo siguiente ocupa espacio en el volumen de almacenamiento:

| Qué                                      | Notas                                                                                                                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Archivos publicados                      | Todas las versiones que conserva                                                                                                                               |
| Subidas en curso                         | Las partes y los archivos de staging, hasta que termina la subida                                                                                              |
| Archivos de subidas terminadas en partes | Las partes temporales permanecen junto al archivo terminado hasta que una pasada de limpieza física las elimina. Consulte [Limpieza física](#physical-cleanup) |
| Archivos eliminados                      | Permanecen en el disco hasta que termina el período de gracia y una pasada de limpieza los elimina                                                             |
| Copias de espejo                         | Una parte en `mirror-staging` mientras un espejo copia un archivo. Consulte [Espejos](./mirrors)                                                               |

Además del almacenamiento, prevea PostgreSQL, los registros y el almacén de copias, si es posible en volúmenes propios. Consulte [Copias de seguridad](./backups).

Arkvory mantiene una **reserva** de espacio libre en el volumen de almacenamiento. De forma predeterminada es 1 GiB (`ARKVORY_STORAGE_RESERVE_BYTES`). Una subida que usaría la reserva se rechaza con HTTP 507 y el motivo `storage_full`. Las descargas siguen funcionando. `GET /health/ready` muestra `writable: false` mientras no hay espacio para datos nuevos.

Dos límites funcionan con independencia del disco:

- `ARKVORY_CAPACITY_BYTES` limita todo el contenido reservado de la instalación. El valor predeterminado es 10 TiB. Es un límite lógico, no una comprobación del disco. Cuando se alcanza, las subidas fallan con HTTP 507 y el motivo `catalog_limit`.
- `ARKVORY_MAX_OBJECT_BYTES` limita el tamaño de un archivo.

Consulte [Variables de entorno](../reference/environment#storage-and-limits). Arkvory no tiene una métrica del espacio libre del almacenamiento ni de la base de datos. Vigile los volúmenes con las herramientas de su sistema operativo o con un node exporter.

## Quién puede administrar el almacenamiento {#permissions}

Los ajustes del almacenamiento no forman parte de los permisos normales de lectura y escritura. Una clave de servicio necesita acciones explícitas sobre el repositorio:

| Acción             | Permite                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `storage.read`     | Ver la política, el uso y los ajustes de limpieza                                               |
| `storage.manage`   | Cambiar la política, la cuota y los ajustes de limpieza, y solicitar un lote de limpieza        |
| `artifact.delete`  | Previsualizar eliminaciones, eliminar artefactos y activar una política de retención automática |
| `diagnostics.read` | Leer los eventos del almacenamiento                                                             |

Las cuentas con contraseña y la clave de recuperación no tienen estos permisos por sí mismas. Para administrar el almacenamiento en la consola:

1. Cree una cuenta de servicio con una política para el repositorio que incluya las cuatro acciones. Consulte [Cuentas y acceso](../use/accounts).
2. Emita y active una clave para ella.
3. En la consola, abra [[ui:keySignIn]], pegue la clave y seleccione [[ui:connect]].
4. Abra [[ui:repositories]] y, en la tarjeta del repositorio, seleccione [[ui:repositoryStorage]].

El panel [[ui:storageTitle]] aparece sobre el catálogo. Sin los permisos, el panel permanece oculto.

Una política de retención activada queda vinculada a la **clave que la activó**. Cada ejecución automática vuelve a comprobar que esa clave sigue activa, no ha caducado y conserva `storage.manage` y `artifact.delete`. Si revoca la clave o reduce sus permisos, la eliminación se detiene y aparece el evento `retention.failed`. Después de rotar la clave, guarde de nuevo la política con la clave nueva.

## Cuotas y umbrales de advertencia {#quotas}

Un repositorio puede tener una cuota. Sin cuota, solo se aplica el límite global.

| Ajuste                | Campo de la consola           | Significado                                                                                                                                | Valor predeterminado |
| --------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| Cuota                 | [[ui:storageQuota]]           | El máximo de espacio que puede usar el repositorio. La API acepta bytes exactos, de 1 a 9 007 199 254 740 991, y `null` para ningún límite | Sin límite           |
| Umbral de advertencia | [[ui:storageWarningPercent]]  | La parte de la cuota que genera una advertencia. 1–98                                                                                      | 80                   |
| Umbral crítico        | [[ui:storageCriticalPercent]] | La parte que genera un error. 2–99, mayor que el umbral de advertencia                                                                     | 95                   |

El uso que cuenta para la cuota es el tamaño de todos los archivos del repositorio que todavía no se han eliminado del disco: archivos publicados, subidas sin terminar y archivos eliminados que esperan la limpieza. Por eso, un archivo eliminado sigue ocupando cuota hasta que una pasada de limpieza lo elimina.

- **Comprobación.** El servidor comprueba la cuota cuando empieza una subida. Una subida nueva que superaría la cuota falla con HTTP 507 y el motivo `storage_quota`. Un reintento con la misma clave de idempotencia no reserva espacio dos veces.
- **Reducción.** Puede fijar una cuota inferior al uso actual. Las subidas en curso pueden terminar. Las subidas nuevas que superen el límite se rechazan.
- **Sin liberación automática.** La cuota nunca provoca una eliminación. La retención no elimina compilaciones adicionales para cumplir una cuota.
- **Estados.** El estado es `unlimited`, `normal`, `warning`, `critical` o `exceeded`. Un cambio de estado se registra una sola vez como evento del almacenamiento.
- **Supervisión.** El servidor vuelve a comprobar cada minuto los estados de hasta 20 repositorios, también cuando la eliminación automática está desactivada.

Las cifras son reservas lógicas, no espacio libre en disco. Un repositorio puede estar por debajo de su cuota mientras el disco está lleno, porque el disco también contiene archivos de staging y otros repositorios.

## Política de retención {#retention}

Una política de retención elimina automáticamente las **compilaciones UPack registradas** antiguas y conserva las últimas N. No elimina otros archivos: los archivos sueltos por ruta, las imágenes de contenedor, los objetos de Git LFS y los paquetes npm quedan fuera de ella. Sin una política, no se elimina nada automáticamente.

### Los ajustes {#retention-settings}

| Ajuste               | Campo de la consola     | Significado                                                                                                                | Valor predeterminado                  |
| -------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Activar              | [[ui:storageEnabled]]   | Activa la eliminación automática                                                                                           | Desactivado                           |
| Agrupación           | [[ui:storageGrouping]]  | La unidad que se cuenta: [[ui:storagePerChannel]], [[ui:storagePerPackage]] o [[ui:storageGlobal]]                         | Paquete y canal                       |
| Últimas N            | [[ui:storageKeep]]      | Cuántas compilaciones se conservan por contador, 1–100 000                                                                 | 10                                    |
| Canales              | [[ui:storageChannels]]  | Una N propia para una etiqueta, como `label=N`, una por línea, hasta 32. Solo se usa con la agrupación por paquete y canal | `test=10`, `staging=10`, `release=10` |
| Antigüedad mínima    | [[ui:storageAge]]       | Una compilación más reciente que este valor se conserva, en horas, 0–87 600                                                | 24                                    |
| Etiquetas protegidas | [[ui:storageProtected]] | Las compilaciones con una de estas etiquetas nunca se eliminan, hasta 32, separadas por comas                              | `bse`, `release`                      |
| Intervalo            | [[ui:storageInterval]]  | Minutos entre ejecuciones, 1–10 080                                                                                        | 60                                    |

Una etiqueta tiene de 1 a 64 letras, dígitos o los caracteres `_ . : -`.

### Cómo se eligen las compilaciones {#retention-rules}

1. El servidor ordena las compilaciones de cada contador por **hora de publicación**, de la más reciente a la más antigua. El orden no es el orden SemVer de las versiones.
2. El contador depende de la agrupación. Con paquete y canal, una compilación se cuenta por separado para cada etiqueta de canal configurada que lleva, por paquete (`group/name`). Una compilación sin ninguna etiqueta configurada pasa a un contador compartido del paquete, con la N predeterminada. Con paquete, cada paquete tiene un contador. Con todo el repositorio, todas las compilaciones comparten un contador. Los nombres de paquete no distinguen mayúsculas de minúsculas; las etiquetas, sí.
3. Una compilación se conserva si está entre las últimas N de **cualquier** contador al que pertenece.
4. Una compilación más reciente que la antigüedad mínima se conserva.
5. Una compilación con una etiqueta protegida se conserva. Sus etiquetas proceden de la anotación actual o, si no tiene anotación, de la subida. Las compilaciones protegidas también participan en la clasificación, por lo que el número conservado puede ser mayor que N.

Una compilación nunca se elimina mientras algo la necesite:

- Un servicio externo mantiene una referencia a ella.
- Una ruta de archivo, actual o del historial, la usa.
- Otra compilación la enumera como adjunto, ahora o en el historial.
- Está promovida a una etapa. Retire primero la etapa.
- Una entrada de imagen de contenedor, de Git LFS o de npm la usa.

Eliminar una compilación es una operación lógica: sale de las listas y las descargas nuevas fallan con 404. Los bytes salen del disco más tarde, en la [Limpieza física](#physical-cleanup). La versión del paquete sigue reservada, por lo que la misma versión no se puede publicar de nuevo con otro contenido.

### Activar una política con seguridad {#retention-enable}

Primero previsualice y después active. Una vista previa muestra lo que eliminaría la política guardada y no elimina nada.

1. Conéctese con una clave que tenga las cuatro acciones y abra el panel de almacenamiento del repositorio.
2. Rellene los campos y deje [[ui:storageEnabled]] desactivado. Seleccione [[ui:storageSave]].
3. Seleccione [[ui:storagePreview]]. La lista muestra hasta 100 compilaciones que la política guardada eliminaría en un lote. Si quedan más candidatas, la consola lo indica.
4. Si la lista es correcta, marque [[ui:storageEnabled]] y la confirmación [[ui:storageAcknowledge]], y guarde de nuevo. Esto requiere `artifact.delete`.

Notas:

- La vista previa muestra un instante concreto. Cuando la política se ejecuta, vuelve a clasificar y a comprobar las dependencias.
- La política se guarda con una revisión. Si otra persona la cambió, recargue y guarde de nuevo.
- [[ui:storageRefresh]] vuelve a cargar los ajustes y el uso.

### Cómo se ejecuta {#retention-run}

El proceso de la API que escribe (no una puerta de enlace de lectura) comprueba cada 60 segundos y atiende hasta 20 políticas pendientes. Un lote elimina como máximo 100 compilaciones. Si quedan candidatas, el lote siguiente empieza al cabo de un minuto. En caso contrario, la siguiente ejecución llega después del intervalo. La programación se guarda en la base de datos y sobrevive a un reinicio.

También puede ejecutar usted mismo un lote con la operación de la API [runStoragePolicy](../api/reference/storage#runStoragePolicy). El uso, la vista previa y los eventos tienen operaciones en la misma [referencia de la API de almacenamiento](../api/reference/storage).

## Limpieza física {#physical-cleanup}

Eliminar un artefacto, por una persona o por una política, solo lo quita del catálogo. La **limpieza física** elimina sus bytes del disco, en segundo plano y sin detener la API, el worker ni las puertas de enlace de lectura. Además:

- Cancela las subidas que caducaron sin terminar y elimina sus partes.
- Elimina las partes temporales de las subidas terminadas.

No elige qué compilaciones eliminar. Solo elimina lo que ya está eliminado o cancelado.

**La limpieza física está desactivada de forma predeterminada y se configura por repositorio.** Actívela en cada repositorio que use. Hasta entonces, los archivos eliminados, las subidas caducadas y las partes de las subidas terminadas permanecen en el disco, y la cuota cuenta los archivos eliminados.

### Ajustes {#cleanup-settings}

En el panel del repositorio, abra [[ui:cleanupTitle]]:

| Ajuste            | Campo de la consola    | Significado                                                        | Valor predeterminado | Intervalo |
| ----------------- | ---------------------- | ------------------------------------------------------------------ | -------------------- | --------- |
| Activar           | [[ui:cleanupEnabled]]  | Activa la limpieza en segundo plano                                | Desactivado          |           |
| Período de gracia | [[ui:cleanupGrace]]    | Cuánto tiempo permanece en el disco un archivo eliminado, en horas | 24                   | 0–8760    |
| Lote              | [[ui:cleanupBatch]]    | Archivos que se procesan en un lote                                | 25                   | 1–100     |
| Intervalo         | [[ui:cleanupInterval]] | Segundos entre lotes                                               | 60                   | 5–86 400  |
| Pausa             | [[ui:cleanupDelay]]    | Milisegundos de pausa entre archivos                               | 50                   | 0–1000    |

Seleccione [[ui:cleanupSave]] para aplicarlos. El cambio surte efecto de inmediato. Si desactiva la limpieza, se detiene después del archivo actual. [[ui:cleanupRun]] solicita un lote para dentro de poco, no elimina de inmediato. Seleccione [[ui:cleanupRefresh]] para ver el resultado del último lote.

El período de gracia no es una papelera de reciclaje. Con el valor 0, un archivo puede eliminarse justo después de borrarlo, siempre que ningún lector lo tenga abierto. Arkvory no puede restaurar un artefacto eliminado.

### Qué hace la limpieza y qué omite {#cleanup-rules}

- Elimina solo los archivos cancelados o eliminados que han superado el período de gracia. Vuelve a comprobar que nada los usa: ni una referencia, ni el historial de rutas de archivo, ni el historial de adjuntos.
- Una descarga abierta, una subida que se está escribiendo y un archivo que necesita una copia de seguridad en curso hacen que la limpieza **omita** ese archivo. El lote siguiente lo intenta de nuevo. El último resultado muestra cuántos archivos procesó, omitió y falló, y cuántos bytes liberó.
- La cuota y la capacidad lógica se liberan solo después de eliminar los archivos del disco.
- Un lote está limitado por el tamaño del lote y la pausa, lo que reduce la carga del disco. No garantiza una velocidad de disco estricta ni puede prometer que no influya en la latencia de otras solicitudes.
- La limpieza se ejecuta en la API writer, una vez por base de datos. El writer comprueba cada 5 segundos un repositorio pendiente. Sin un writer en ejecución, no se limpia nada.
- Active la limpieza solo después de actualizar todos los procesos de Arkvory, incluidas las puertas de enlace y el worker. Un proceso antiguo sin el protocolo de limpieza hace que la limpieza posponga su trabajo.

## Eliminar un artefacto {#delete-artifacts}

Puede eliminar a mano un artefacto publicado. Necesita `artifact.delete` en el repositorio.

1. Abra el artefacto en [[ui:metadata]] y busque [[ui:deletionTitle]].
2. Seleccione [[ui:deletionInspect]]. La consola muestra qué sigue usando el artefacto. Si algo bloquea la eliminación, primero debe quitar esa dependencia.
3. Pegue el ID del artefacto para confirmarlo y seleccione [[ui:deletionSubmit]].

Eliminar de esta forma no comprueba las etiquetas protegidas, porque usted elige el objeto. Las dependencias se comprueban siempre. Después de la eliminación:

- El artefacto sale de las listas y de las búsquedas. Una descarga nueva falla con 404. Una descarga que ya está en curso puede terminar.
- La versión del paquete sigue reservada.
- Los bytes permanecen en el disco hasta que la [limpieza física](#physical-cleanup) los elimina después del período de gracia.
- No se puede deshacer ni en la consola ni en la API.

Para muchos artefactos, la API ofrece [previewRetention](../api/reference/storage#previewRetention) y [applyRetention](../api/reference/storage#applyRetention). Una vista previa enumera los candidatos publicados antes de una fecha con los motivos que los bloquean. Apply elimina solo los ID que usted pasa, hasta 100 por llamada, y devuelve un resultado para cada ID: `deleted`, `already_deleted`, `protected`, `changed`, `not_eligible` o `not_found`. Compruebe cada resultado, no solo el estado HTTP.

## Diagnóstico y eventos del almacenamiento {#diagnostics}

La sección [[ui:storageEvents]] enumera lo que ocurrió en el repositorio, del más antiguo al más reciente, 100 por página. Seleccione [[ui:storageMore]] para la página siguiente. Leerla requiere `diagnostics.read`. La operación de la API es [getStorageEvents](../api/reference/storage#getStorageEvents), con un filtro por nivel (`info`, `warning`, `error`).

| Evento                                                                                                | Nivel                 | Significado                                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `storage.policy_updated`                                                                              | info                  | Se guardó la política de retención                                                                                           |
| `retention.completed`                                                                                 | info                  | Un lote eliminó compilaciones. El evento contiene el recuento                                                                |
| `retention.failed`                                                                                    | error                 | La eliminación automática se detuvo, por ejemplo porque se revocó la clave que la autorizaba                                 |
| `cleanup.configured`                                                                                  | info                  | Se guardaron los ajustes de limpieza                                                                                         |
| `cleanup.completed`                                                                                   | info o error          | Un lote de limpieza procesó archivos, omitió algunos o falló. Enumera los recuentos y los bytes liberados                    |
| `capacity.normal`, `capacity.warning`, `capacity.critical`, `capacity.exceeded`, `capacity.unlimited` | info, warning o error | Cambió el estado de la cuota                                                                                                 |
| Códigos de error HTTP                                                                                 | warning o error       | Falló una solicitud de una clave administrada a este repositorio. El evento conserva el ID de solicitud, la ruta y el estado |

El historial es limitado: 1000 eventos por repositorio y 20 000 en total, y se descartan los más antiguos. Es un diagnóstico de mejor esfuerzo, no un registro con entrega garantizada. Exporte a tiempo lo que necesite y use el registro del servidor como evidencia a largo plazo. Consulte [Monitorización](./monitoring).

El panel también muestra el uso: bytes publicados, subidas sin terminar, bytes que esperan la limpieza y el total frente a la cuota. La operación de la API es [getStorageUsage](../api/reference/storage#getStorageUsage).

## Cuando el disco está lleno {#disk-full}

Señales: las subidas fallan con HTTP 507 y el motivo `storage_full`, `GET /health/ready` muestra `writable: false` o el sistema operativo informa de que no queda espacio libre. Las descargas siguen funcionando. Los clientes pueden reanudar sus subidas cuando usted libere espacio.

1. **Encuentre la causa.** Compruebe el espacio libre del volumen de almacenamiento, del volumen de la base de datos y del volumen del almacén de copias. Compare las cifras de uso del panel de almacenamiento. Unas cifras grandes de «pendiente de limpieza» significan que los datos eliminados siguen en el disco. Una cifra grande de «subidas sin terminar» significa subidas abandonadas.
2. **Ejecute la limpieza.** Si la limpieza está desactivada, actívela en cada repositorio, con un período de gracia corto, como 0 si acepta que los archivos eliminados se vayan de inmediato. Seleccione [[ui:cleanupRun]]. También elimina las partes temporales de las subidas terminadas y las subidas caducadas. Espere a los lotes y lea el último resultado. La limpieza omite los archivos que están en uso, así que repítala.
3. **Elimine lo que no necesita.** Aplique una política de retención o elimine artefactos. Esto libera espacio solo después de que la limpieza elimine los bytes.
4. **Añada espacio.** Amplíe el volumen o el disco. Traslade el almacén de copias u otros datos fuera del volumen si lo comparten.
5. **Compruebe la recuperación.** Cuando hay espacio libre, `writable` vuelve a `true` y las subidas funcionan de nuevo.

No elimine a mano archivos de `blobs/`, `staging/` ni `parts/`: esto rompe el vínculo entre la base de datos y el disco. Si la reserva es demasiado pequeña para sus registros y su base de datos en el mismo volumen, aumente `ARKVORY_STORAGE_RESERVE_BYTES`.

Si una subida falla en cambio con el motivo `storage_quota` o `catalog_limit`, el problema no es el disco. Aumente la cuota o el límite global, o elimine datos.

## Límites {#limits}

- La política de retención solo atiende compilaciones UPack registradas. Nunca elimina otros archivos.
- El orden de retención es la hora de publicación, no el número de versión.
- El almacenamiento, las cuotas y la limpieza requieren acciones explícitas de la clave de servicio. Las cuentas con contraseña y la clave de recuperación no las tienen.
- La limpieza física está desactivada de forma predeterminada y se configura para cada repositorio.
- Un artefacto eliminado no se puede restaurar. Restaure los datos desde una copia de seguridad. Consulte [Copias de seguridad](./backups).
- Los repositorios espejo no ejecutan ninguna política de almacenamiento. Consulte [Espejos](./mirrors).
- El almacenamiento debe ser un sistema de archivos local. No se admiten recursos compartidos de red ni varios backends de almacenamiento.

## Páginas relacionadas {#related-pages}

- [Copias de seguridad](./backups)
- [Espejos](./mirrors)
- [Monitorización](./monitoring)
- [Solución de problemas](./troubleshooting)
- [Variables de entorno](../reference/environment)
- [Repositorios](../use/repositories)
