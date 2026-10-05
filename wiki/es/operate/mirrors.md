---
title: Espejos y un segundo sitio
description: Mantenga una copia de solo lectura de los repositorios en una segunda instalación, vigile su sincronización y conmute a ella cuando se pierda el origen.
---

# Espejos y un segundo sitio

Un **espejo** es un repositorio de una instalación de Arkvory que es una copia de solo lectura de un repositorio de otra instalación, el **origen**. La instalación del espejo obtiene los cambios del origen mediante HTTPS. Mantiene su propia base de datos, su propio almacenamiento, sus propias cuentas y sus propias claves.

Use un espejo para servir descargas desde una segunda ubicación y para mantener un segundo sitio que pueda tomar el relevo cuando se pierda el origen. Un espejo no es una copia de seguridad del origen ni una alta disponibilidad automática. La conmutación la hace usted. Para otras protecciones, consulte [Copias de seguridad](./backups) y [Puertas de enlace de lectura](./read-gateways).

## Qué es un espejo {#what-a-mirror-is}

En un repositorio espejo, la instalación del espejo copia:

- Los archivos publicados, con sus bytes y los **mismos ID de artefacto** que en el origen.
- Las etiquetas, los metadatos y las colecciones.
- El registro de UPack, las etapas y las rutas de archivo actuales.
- Las imágenes de contenedor, los objetos de Git LFS y los paquetes npm del repositorio.
- Las eliminaciones. Un archivo eliminado en el origen se elimina en el espejo.

Las descargas por ID, por paquete (versión, rango, etapa) y por ruta de archivo responden en el espejo tal como respondían en el origen en la última sincronización. Siguen funcionando cuando el origen no está disponible.

Un espejo no copia:

- Las cuentas, los grupos, las claves ni los permisos. El espejo tiene los suyos y son independientes: revocar una clave en el origen no afecta al espejo.
- Las referencias que protegen los archivos de la limpieza, los adjuntos de las compilaciones, los registros de auditoría ni las políticas de almacenamiento.
- El historial de las rutas de archivo anterior a la primera sincronización. Los números de revisión de las etiquetas y de las rutas en el espejo son propios.

Los clientes no pueden escribir en un repositorio espejo. Las subidas, los cambios de etiquetas, las rutas de archivo, las etapas, las eliminaciones y las promociones hacia él reciben HTTP 409 con el motivo `mirror_read_only`. Los demás repositorios de la instalación del espejo funcionan como siempre. Las políticas de almacenamiento no se ejecutan en un repositorio espejo, y solo la sincronización elimina en él.

## Configurar un espejo {#set-up}

Necesita una clave en el origen y un comando en el espejo.

### Crear una clave en el origen {#source-key}

El espejo necesita una clave que solo pueda leer el repositorio de origen. No hace falta una clave de escritura.

1. En el origen, abra [[ui:services]] con la clave de recuperación o con una clave de operador.
2. Seleccione [[ui:serviceCreate]] y, en [[ui:servicePolicy]], añada el repositorio. Seleccione [[ui:bindingRead]] para rellenar los permisos que necesita un espejo. Incluyen `artifact.list`, `artifact.read`, `content.read`, `annotation.read`, `asset.read` y `package.read`.
3. Seleccione [[ui:keyIssue]], copie el secreto, confirme la opción [[ui:keySaved]] y seleccione [[ui:keyActivate]]. Una clave que no se activa caduca a los 15 minutos.
4. Guarde el secreto en un archivo del servidor del espejo. El archivo contiene solo la clave, en una línea, de 16 a 4000 caracteres imprimibles. Solo root o el grupo Administradores pueden leerlo.

El origen debe ser una versión que incluya el flujo de cambios. El comando del paso siguiente lo comprueba.

### Vincular el repositorio en el espejo {#attach}

Use el nombre de un repositorio **nuevo y vacío** en el espejo. La sincronización hace que el repositorio sea igual al origen, pero nunca elimina lo que el origen nunca tuvo.

```bash
sudo arkvory configure --root /opt/proanima-arkvory \
  --mirror releases \
  --mirror-upstream https://arkvory.example \
  --mirror-token-file /root/mirror-releases.key
```

```powershell
$root = 'C:\ProgramData\ProAnima\Arkvory'
& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' configure --root $root `
  --mirror releases --mirror-upstream https://arkvory.example `
  --mirror-token-file C:\secure\mirror-releases.key
```

| Opción                     | Significado                                                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--mirror NAME`            | El repositorio de esta instalación. De 1 a 64 caracteres: letras minúsculas, dígitos, `_` y `-`, empezando por una letra o un dígito                                 |
| `--mirror-upstream URL`    | La dirección base del origen: `https://host`, sin ruta, sin credenciales y sin consulta. Se acepta `http://` sin cifrar solo para `localhost`, `127.0.0.1` y `[::1]` |
| `--mirror-token-file FILE` | Una ruta absoluta al archivo de la clave                                                                                                                             |
| `--mirror-source NAME`     | El repositorio del origen. Valor predeterminado: el mismo nombre que `--mirror`                                                                                      |
| `--mirror-ca-file FILE`    | Un archivo PEM con la entidad de certificación del origen. Consulte [HTTPS con su propia entidad de certificación](#ca-file)                                         |

Indique un repositorio por comando. No puede combinar un cambio de espejo con cambios de HTTPS, del almacén de copias o de las actualizaciones en la misma llamada.

1. El comando comprueba el origen con la clave antes de cambiar nada. El origen debe informar del flujo de cambios del espejo, y el flujo del repositorio de origen debe responder.
2. Guarda la clave en `config/mirrors/NAME.token`, escribe `config/mirrors/mirrors.json` y define `ARKVORY_MIRRORS_FILE` en `config/runtime.json`.
3. Reinicia la API y el worker y espera a que estén listos. Si algo falla, restaura los archivos anteriores y vuelve a reiniciar.

En Docker Compose, el comando escribe además `config/compose.mirrors.yml`, que monta los archivos del espejo en los contenedores de la API y del worker. Añádalo a los comandos de Compose que ejecute usted mismo.

Repita el comando con un `--mirror-token-file` nuevo para sustituir la clave de un repositorio. El worker vuelve a leer el archivo de la clave después de cada fallo, por lo que una clave nueva funciona sin reiniciar. Un repositorio que ya replica un origen rechaza otro origen con el mensaje `NAME mirrors another source; detach it first`.

En la instalación del espejo, dé acceso al repositorio a las personas y las herramientas. Un repositorio existe en cuanto lo nombra un permiso o una política de servicio. Use [[ui:manageGrants]] en [[ui:administration]] para las personas y una política de servicio para las herramientas. Los permisos del origen no se trasladan.

### HTTPS con su propia entidad de certificación {#ca-file}

Si el origen usa un certificado de una entidad corporativa o autofirmada, añada `--mirror-ca-file /path/ca.pem` al comando `--mirror`. El comando comprueba que cada certificado se puede leer y no ha caducado, y guarda de 1 a 64 certificados en `config/mirrors/ca.pem` (el archivo no puede superar 1 MiB). A partir de entonces, el worker confía en ellos además de en los estándar.

- El archivo sirve a todos los espejos de la instalación. Un `--mirror-ca-file` nuevo se suma al archivo, y un certificado que ya está se conserva una sola vez. Al desvincular el último espejo, se elimina el archivo.
- El worker confía en todo el conjunto para todas sus conexiones, no solo para un espejo.
- La comprobación de los certificados nunca se desactiva.

## Qué se copia y con qué frecuencia {#sync}

El worker de la instalación del espejo hace la sincronización. No hay un servicio aparte. Para cada repositorio espejo ejecuta estos pasos:

1. **Carga inicial.** El worker anota la posición actual del flujo de cambios del origen. Después lee la lista de artefactos, paquetes y rutas de archivo página por página y hace que el espejo sea igual a ella.
2. **Seguimiento.** El worker lee el flujo del origen. Cuando está al día, vuelve a comprobar cada 10 segundos. Guarda su posición después de cada cambio que aplicó.
3. **Copia de archivos.** Un archivo se copia en partes. El worker comprueba el SHA-256 de cada parte y del archivo completo. Tras una interrupción, continúa con la primera parte que falta. Una parte espera en `mirror-staging`, dentro del directorio de almacenamiento del espejo.
4. **Tras un error.** El worker repite el paso después de una pausa que empieza en 2 segundos y se duplica hasta 5 minutos. Un espejo que falla no detiene a los demás.

Una instalación puede tener hasta 64 repositorios espejo. Las copias cuentan para el límite de capacidad y para el disco del espejo, por lo que debe prever el mismo espacio que necesita el repositorio de origen. Consulte [Almacenamiento](./storage).

Si la clave del origen se revoca o el origen no está accesible, el espejo sigue sirviendo lo que ya tiene y muestra el error en su estado.

## Comprobar el estado de la sincronización {#status}

### En la consola {#status-console}

Conecte la consola de la instalación del espejo al repositorio espejo. Sobre el catálogo, una insignia muestra el estado:

- [[ui:mirrorBadge]] significa que el espejo está al día.
- [[ui:mirrorBehind]] significa que todavía está copiando o que aún no ha empezado.
- [[ui:mirrorFailing]] significa que el último intento falló. Las descargas siguen funcionando.

Abra la ayuda de la insignia ([[ui:mirrorHelpLabel]]) para ver el origen, la hora de la última sincronización y el código de error. La consola oculta los botones de subida y de cambio en un repositorio espejo.

### Con la API {#status-api}

[getRepositoryMirror](../api/reference/mirrors#getRepositoryMirror) devuelve el estado de un repositorio. Requiere el permiso para leer el repositorio. Para un repositorio normal, la respuesta es 404.

| Campo                            | Significado                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `mode`                           | `mirror` o `import`                                                                                                             |
| `phase`                          | `pending` (el worker no ha empezado), `seeding` (carga inicial) o `following`                                                   |
| `caughtUp`                       | `true` cuando la posición guardada es igual a la posición más reciente del origen. `null` antes de que termine la carga inicial |
| `checkedAt`, `syncedAt`          | Cuándo leyó el worker el flujo por última vez y cuándo estuvo al día por última vez                                             |
| `copiedArtifacts`, `copiedBytes` | Totales copiados hasta ahora (`copiedBytes` es una cadena decimal)                                                              |
| `errorCode`, `errorAt`           | El último fallo de un paso, o `null`                                                                                            |

### Códigos de error {#error-codes}

| `errorCode`             | Significado y qué hacer                                                                                                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mirror_mismatch`       | El mismo ID de artefacto tiene contenido distinto en el origen. El espejo conserva su archivo. Investigue el artefacto; no elimine ninguna de las copias hasta conocer la causa                                            |
| `mirror_source_changed` | El repositorio ya contiene una copia de otro origen. Desvincúlelo o replique el origen nuevo en un repositorio nuevo                                                                                                       |
| `mirror_source_behind`  | El origen se restauró o se reinstaló, y su flujo va por detrás del espejo. El espejo lo lee de nuevo y el código desaparece cuando se pone al día. Los archivos que le faltan al origen restaurado permanecen en el espejo |
| `mirror_delete_blocked` | El origen eliminó un archivo que el espejo no puede eliminar porque algo aquí todavía lo usa, como una referencia o el historial de una ruta de archivo                                                                    |
| `mirror_failed`         | Un fallo sin un código más específico. Lea el registro del worker                                                                                                                                                          |
| otros códigos           | El código de la solicitud que falló, por ejemplo `unauthorized` cuando se revocó la clave o `capacity_exceeded` cuando el espejo está lleno                                                                                |

El registro del worker (`component` es `mirror`) contiene `mirror.started`, `mirror.step_failed` con `errorCode` y `attempts`, `mirror.recovered` y `mirror.stopped`.

## Monitorizar los espejos {#monitoring}

La API de la instalación del espejo expone tres métricas por cada repositorio espejo, con las etiquetas `repository` y `mode`:

- `arkvory_mirror_last_sync_timestamp_seconds`: la última vez que el espejo estuvo al día.
- `arkvory_mirror_last_check_timestamp_seconds`: la última vez que leyó el flujo.
- `arkvory_mirror_failing`: 1 mientras el último intento falló.

Las reglas de Prometheus ya preparadas son `ArkvoryMirrorStale` (sin estar al día durante más de una hora) y `ArkvoryMirrorFailing` (el fallo dura 15 minutos). Consulte [Monitorización](./monitoring). Un espejo al que el worker aún no ha llegado no tiene hora de sincronización, por lo que la regla de retraso no se activa antes de su primera sincronización.

## Importación por etapa {#import}

Con `--mirror-stages`, el repositorio de la segunda instalación **no** es un espejo. Es un repositorio normal con permiso de escritura que adopta las versiones que llevan una de las etapas en el origen. Úselo para trasladar compilaciones de un servidor de desarrollo a un servidor de producción.

```bash
sudo arkvory configure --root /opt/proanima-arkvory \
  --mirror releases --mirror-upstream https://dev.example \
  --mirror-token-file /root/dev.key --mirror-stages release
```

- Indique de 1 a 16 nombres de etapa distintos, separados por comas.
- Una versión se copia una sola vez, con el mismo ID, los mismos bytes, las mismas etiquetas y el mismo registro de UPack, y con las etapas correspondientes.
- Después pertenece a esta instalación. Los cambios, la retirada de etapas y la eliminación en el origen no llegan a ella. Una versión que usted elimina aquí no se vuelve a importar nunca.
- Las subidas y la política de almacenamiento del repositorio funcionan como siempre.
- Los datos del registro de imágenes de contenedor, de Git LFS y de npm no se trasladan.
- Un cambio de etapas inicia una nueva carga inicial. Solo añade y omite lo que ya está.

La consola muestra la insignia [[ui:mirrorImport]], o [[ui:mirrorImportFailing]] cuando el último intento falló. La clave del origen necesita los mismos permisos de solo lectura que para un espejo.

## Conmutar al espejo cuando se pierde el origen {#failover}

Es una conmutación manual para dos instalaciones independientes en dos sitios. No es automática. Los cambios que el espejo aún no había obtenido se pierden.

### Prepararse con antelación {#failover-prepare}

1. Instale el segundo sitio con la misma versión que el origen cuando sea posible, con su propio PostgreSQL y su propio disco. Los dos sitios no comparten nada.
2. Cree una clave de solo lectura en el origen y vincule cada repositorio como espejo. Un repositorio creado más tarde en el origen no aparece por sí solo en el espejo, así que vincúlelo del mismo modo.
3. En el espejo, emita las claves que usarán sus consumidores, incluidas las claves que podrán escribir después de la conmutación. Los permisos del origen no se trasladan, de modo que un origen comprometido no da acceso al espejo.
4. Configure los consumidores (CI, agentes de despliegue) con la dirección del espejo como alternativa para las descargas. Esto también descarga el enlace con el origen.
5. Haga copias de seguridad del origen en un almacén de copias fuera de su sitio. Consulte [Copias de seguridad](./backups). Un espejo no sustituye esto.
6. Monitorice el espejo con las reglas anteriores.

### Conmutar {#failover-switch}

1. Asegúrese de que el origen está realmente inaccesible para los clientes y no volverá por sí solo. Dos sitios que aceptan escrituras en un mismo repositorio lógico no se pueden fusionar después. Si el origen es accesible en parte, detenga sus servicios o cierre su puerto.
2. En el espejo, lea `syncedAt` de cada repositorio. Los cambios hechos en el origen después de esa hora no están en el espejo.
3. Desvincule cada repositorio espejo en el espejo. Se convierte en un repositorio normal con permiso de escritura, con los mismos ID de artefacto y todos sus datos.

   ```bash
   sudo arkvory configure --root /opt/proanima-arkvory --mirror-detach releases
   ```

   El comando reinicia la API y el worker, así que espere una breve interrupción.

4. Dirija al espejo los clientes que escriben, mediante DNS o la configuración de su CI.
5. Suba y descargue un archivo de control en el espejo.

Qué ven los clientes:

- Antes de la conmutación, las descargas desde el espejo funcionan y las escrituras reciben 409 `mirror_read_only`.
- Tras desvincular, las escrituras funcionan. La insignia desaparece.
- Las claves y las contraseñas del origen no funcionan en el espejo, a menos que haya creado allí las mismas cuentas.

No hay vuelta atrás. No vuelva a vincular como espejo un repositorio desvinculado. Para recuperar el origen anterior, límpielo o instálelo de nuevo y vincule como espejos los repositorios del nuevo primario. No ejecute nunca el origen anterior y el nuevo primario a la vez con las escrituras activadas.

### Ensayar {#failover-rehearse}

Ensaye la conmutación cada trimestre y después de las actualizaciones. Desvincule un repositorio en una copia de reserva, compruebe `syncedAt`, una descarga y una subida, y anote la fecha y el resultado. Pruebe por separado la restauración de una copia de seguridad del origen en una instalación vacía. Consulte [Probar la restauración con regularidad](./backups#test-restore).

## Límites {#limits}

- Un espejo es de solo lectura hasta que lo desvincula. Un repositorio desvinculado no puede volver a ser un espejo.
- El espejo no es una copia de seguridad. No tiene una copia de las cuentas, las claves ni los permisos, y no copia las referencias, los adjuntos, los registros de auditoría ni las políticas de almacenamiento.
- El modo de importación no copia imágenes de contenedor, Git LFS ni datos de npm.
- Una sincronización solo añade y actualiza. Tras una restauración del origen, los archivos que el origen perdió permanecen en el espejo.
- Cada instalación se actualiza por separado. El origen debe ofrecer el flujo de cambios del espejo.
- El conjunto de entidades de certificación de confianza del origen se aplica a todo el worker.
- No hay conmutación automática, ni aislamiento del origen anterior, ni sincronización inversa.

## Páginas relacionadas {#related-pages}

- [Copias de seguridad](./backups)
- [Puertas de enlace de lectura](./read-gateways)
- [Almacenamiento](./storage)
- [Monitorización](./monitoring)
- [Variables de entorno](../reference/environment#mirrors)
- [Cuentas y acceso](../use/accounts)
