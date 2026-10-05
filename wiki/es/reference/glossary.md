---
title: Glosario
description: 'Definiciones breves de los términos que se usan en Arkvory y en su documentación, en orden alfabético, cada una con un enlace a la página que la explica.'
---

# Glosario

Los términos están en orden alfabético. Para las ideas que hay detrás, consulte [Conceptos](../guide/concepts).

## A {#letter-a}

### Cuenta {#account}

El inicio de sesión de una persona en el servidor: un nombre de 3 a 64 caracteres y una contraseña de 12 a 128 caracteres. Las concesiones de grupo dan a una cuenta acceso a repositorios. Consulte [Cuentas y acceso](../use/accounts).

### Acción {#action}

Un derecho exacto sobre un repositorio, como `upload.create` o `content.read`. Las claves de servicio llevan acciones, y la referencia de la API nombra las acciones que necesita cada operación. Consulte [Autenticación](../api/authentication#repository-actions).

### Administrador {#administrator}

Una cuenta que gestiona cuentas, grupos, actualizaciones y copias de seguridad. Un administrador no lee los archivos de un repositorio a menos que un grupo también conceda ese acceso. Consulte [Cuentas y acceso](../use/accounts).

### Admisión {#admission}

El límite de cuántas solicitudes y transferencias atiende el servidor a la vez. Por encima de él, una transferencia espera brevemente y después el servidor responde `503` con el código `busy` y una cabecera `Retry-After`. Consulte [Límites de velocidad y servidores ocupados](../api/index#rate-limits).

### Artefacto {#artifact}

Un archivo almacenado inmutable con su SHA-256. El contenido nuevo crea un artefacto nuevo. Consulte [Conceptos](../guide/concepts#artifacts).

### Adjunto {#attachment}

Un enlace de una compilación a otro artefacto del mismo repositorio: un manifiesto, un SBOM, una firma, un informe u otro archivo. Una compilación tiene hasta 32 adjuntos. Consulte [Conceptos](../guide/concepts#annotations).

## B {#letter-b}

### Copia de seguridad {#backup}

Una copia programada de la base de datos y de todo el contenido publicado en el almacén de copias. Consulte [Copias de seguridad](../operate/backups).

### Agente de copias de seguridad {#backup-agent}

El servicio que hace las copias, las verifica y aplica la retención a los puntos de restauración. Consulte [Copias de seguridad](../operate/backups).

### Token Bearer {#bearer-token}

La forma en que cada cliente envía una credencial a `/api/v1`: la cabecera `Authorization: Bearer <credential>`. Consulte [Autenticación](../api/authentication#headers).

### Vinculación {#binding}

Una entrada de una política de servicio: un repositorio y la lista de acciones permitidas en él. Una política tiene hasta 64 vinculaciones. Consulte [Autenticación](../api/authentication#service-accounts).

### Compilación {#build}

El resultado de una ejecución de CI, almacenado como artefacto o como versión de paquete. Consulte [Paquetes](../use/packages).

## C {#letter-c}

### Catálogo {#catalog}

La lista de artefactos de un repositorio, con sus nombres, tamaños, etiquetas y etapas. Consulte [Referencia de artefactos](../api/reference/artifacts).

### Límite máximo {#ceiling}

El límite de una delegación: las acciones de repositorio que un operador puede incluir en las políticas y claves de las cuentas que administra. El operador no puede ir más allá de su límite máximo. Consulte [Autenticación](../api/authentication#delegation).

### Suma de comprobación {#checksum}

El SHA-256 que demuestra que los bytes son los esperados. Las subidas lo declaran antes de que lleguen los bytes, y el servidor y los clientes lo verifican. Consulte [Transferencias](../use/transfers).

### Limpieza {#cleanup}

También llamada limpieza física. Libera en segundo plano el espacio en disco del contenido eliminado, en lotes pequeños. Consulte [Almacenamiento](../operate/storage).

### Colección {#collection}

Un conjunto con nombre de artefactos. Una colección es parte de las anotaciones de un artefacto. Consulte [Conceptos](../guide/concepts#annotations).

### Comparación e intercambio {#compare-and-swap}

Un cambio que nombra la revisión que espera, como `expectedRevision`. Si otro cambio llegó antes, el servidor responde `409` con el motivo `revision_mismatch` y no cambia nada. Consulte [Descripción general de la API HTTP](../api/index#revisions).

### Tarea de finalización {#completion-job}

Una tarea en segundo plano del proceso de trabajo (worker) que comprueba y publica una subida grande. La sigue con `GET /api/v1/jobs/{id}`. Su estado es `queued`, `running`, `completed` o `failed`. Consulte [Referencia de subidas](../api/reference/uploads#getCompletionJob).

### Consola {#console}

La interfaz web de Arkvory, servida en `/console/`. Consulte [La consola web](../guide/console).

### CORS {#cors}

La regla del navegador para las páginas que llaman a una API en otra dirección. Una página de otro origen funciona solo si el administrador incluye ese origen en `ARKVORY_CORS_ORIGINS`. Consulte [Variables de entorno](./environment).

### Cursor {#cursor}

El valor `next` de una página de resultados. Envíelo de vuelta como `after` para leer la página siguiente; cuando `next` es `null`, la lista está completa. Consulte [Descripción general de la API HTTP](../api/index#pagination).

## D {#letter-d}

### Delegación {#delegation}

Una concesión de la clave de recuperación a una clave de operador: puede administrar cuentas de servicio nombradas, con acciones de administración nombradas, dentro de un límite máximo. Consulte [Autenticación](../api/authentication#delegation).

### Digest {#digest}

La dirección de contenido de una imagen de contenedor, escrita `sha256:…`. Consulte [Imágenes de contenedor](../protocols/containers).

### Enlace de descarga {#download-link}

Un enlace limitado en el tiempo que descarga un artefacto sin clave. Dura de 60 segundos a 24 horas (1 hora de forma predeterminada), y nadie puede revocarlo antes de que caduque. Consulte [Autenticación](../api/authentication#download-links).

## E {#letter-e}

### ETag {#etag}

El validador de una descarga: el valor fuerte `"sha256:<hex>"` del artefacto. Úselo con `If-Range` para reanudar de forma segura y con `If-None-Match` para omitir una descarga repetida. Consulte [Descripción general de la API HTTP](../api/index#range-downloads).

## F {#letter-f}

### Conmutación al espejo {#failover}

Trasladar los clientes a un espejo cuando se pierde el origen. El operador separa el espejo, y este pasa a ser un repositorio normal que acepta cambios. Nada conmuta por sí solo. Consulte [Espejos](../operate/mirrors).

### Comentarios {#feedback}

Un informe con capturas de pantalla y registros que un usuario con sesión iniciada envía a ProAnimaStudio desde la consola. La consola muestra lo que se adjunta antes de enviar nada. Consulte [La consola web](../guide/console#feedback).

### Archivo por ruta {#file-by-path}

Un archivo direccionado por una ruta en el repositorio, como `builds/game/Setup.exe`, que conserva sus revisiones anteriores. Consulte [Archivos y rutas](../use/files).

### Clave de archivo {#file-key}

Un secreto cuyo SHA-256 figura en el archivo de claves del servidor (`ARKVORY_KEYS_FILE`). La clave de recuperación es una clave de archivo. Consulte [Autenticación](../api/authentication#recovery-key).

## G {#letter-g}

### Período de gracia {#grace-period}

El tiempo que el contenido eliminado permanece en disco antes de que la limpieza lo elimine: 24 horas de forma predeterminada. Consulte [Almacenamiento](../operate/storage).

### Grupo {#group}

Un conjunto de cuentas que comparten el acceso a repositorios. Un grupo recibe acceso `read` o `write` (lectura y escritura) por repositorio. Consulte [Cuentas y acceso](../use/accounts).

## H {#letter-h}

### Historial {#history}

Las revisiones anteriores de un archivo por ruta, o de un conjunto de adjuntos. Consulte [Archivos y rutas](../use/files).

### Hub {#hub}

El servicio de ProAnimaStudio en `https://hub.proanima.net` que anuncia las versiones estables y recibe comentarios. Consulte [Actualizaciones](../install/updates).

## I {#letter-i}

### Clave de idempotencia {#idempotency-key}

La cabecera `Idempotency-Key`: un valor de 1 a 128 caracteres que hace que una solicitud repetida surta efecto una sola vez. Consulte [Descripción general de la API HTTP](../api/index#idempotency).

### Imagen {#image}

Una imagen de contenedor almacenada en el registro integrado. Consulte [Imágenes de contenedor](../protocols/containers).

### Raíz de la instalación {#installation-root}

La carpeta con los datos, la configuración y los registros: `C:\ProgramData\ProAnima\Arkvory` en Windows y `/opt/proanima-arkvory` en Linux. Consulte [Elegir una instalación](../install/index#installation-directory).

## L {#letter-l}

### Etiqueta {#label}

Una marca corta en un artefacto, como `nightly` o `tested`. Un artefacto tiene hasta 32 etiquetas. Consulte [Conceptos](../guide/concepts#annotations).

### Arrendamiento {#lease}

Un derecho temporal que un proceso mantiene durante un tiempo breve y debe renovar, de modo que solo un proceso haga una tarea. El agente de copias de seguridad mantiene un arrendamiento de 60 segundos de forma predeterminada, así que nunca se ejecutan dos agentes a la vez. Consulte [Variables de entorno](./environment#backups).

### Actividad {#liveness}

La respuesta de `GET /health/live`: el proceso se ejecuta. Es pública. Consulte [Referencia del sistema](../api/reference/system).

### Bloqueo {#lock}

Un bloqueo de archivo de Git LFS que impide que dos personas cambien el mismo archivo binario. Consulte [Git LFS](../protocols/git-lfs).

## M {#letter-m}

### Hora de mantenimiento {#maintenance-hour}

La hora del día en UTC en la que pueden instalarse las actualizaciones automáticas. La predeterminada es las 03:00. Consulte [Actualizaciones](../install/updates).

### Metadatos {#metadata}

Campos de texto de clave/valor de un artefacto: hasta 32 campos, con valores de hasta 1.024 caracteres. Consulte [Conceptos](../guide/concepts#annotations).

### Espejo {#mirror}

Una copia de solo lectura de un repositorio que una segunda instalación mantiene siguiendo el origen. Consulte [Espejos](../operate/mirrors).

### Origen del espejo {#mirror-source}

La instalación de la que copia un espejo. El espejo inicia sesión en ella con una clave de solo lectura. Consulte [Espejos](../operate/mirrors).

### Traslado {#move}

Una promoción que además elimina la compilación del repositorio de origen. Consulte [Promoción](../use/promotion).

## O {#letter-o}

### Primeros pasos {#onboarding}

Los primeros pasos tras la instalación, que se muestran en la consola en la sección Primeros pasos. Consulte [Inicio rápido](../guide/quick-start).

### OpenAPI {#openapi}

La descripción legible por máquina de la API HTTP, servida en `/api/v1/openapi.json`. Consulte [Descripción general de la API HTTP](../api/index#discovery).

### Propietario {#owner}

La primera cuenta, creada durante la instalación. Es administrador y miembro del grupo `arkvory-owners`, que puede escribir en `releases`. Consulte [Conceptos](../guide/concepts#owner-and-recovery-key).

## P {#letter-p}

### Paquete {#package}

Un paquete UPack con versiones, con un grupo, un nombre y una versión SemVer. Consulte [Paquetes](../use/packages).

### Grupo del paquete {#package-group}

La primera parte del nombre de un paquete. Los paquetes con el mismo nombre en grupos distintos son paquetes distintos. Consulte [Paquetes](../use/packages).

### Parte {#part}

Una pieza de un archivo grande que se envía como su propia solicitud. Una parte es de al menos 8 MiB, excepto la última, y como máximo 1 GiB. Consulte [Transferencias](../use/transfers).

### Permiso {#permission}

El derecho a hacer una acción. Las personas obtienen `read` o `write` mediante grupos; las claves de servicio obtienen acciones exactas. Consulte [Autenticación](../api/authentication#access-rules).

### Token de acceso personal {#personal-access-token}

El secreto de una persona para scripts y la línea de comandos. Empieza por `pat_`, caduca a los 90 días de forma predeterminada (365 como máximo) y es de solo lectura o de lectura y escritura. Consulte [Autenticación](../api/authentication#personal-tokens).

### Fijar {#pin}

Evitar que algo se elimine automáticamente, como un punto de restauración. Consulte [Copias de seguridad](../operate/backups).

### Política {#policy}

Las reglas guardadas de una cuenta de servicio (sus vinculaciones), de un repositorio (su política de almacenamiento) o del plan de copias de seguridad. Consulte [Autenticación](../api/authentication#service-accounts).

### Promover {#promote}

El verbo de la promoción: publicar una compilación en otro repositorio, o marcarla con una etapa. Consulte [Promoción](../use/promotion).

### Promoción {#promotion}

Publicar una compilación en otro repositorio sin volver a subirla. Consulte [Promoción](../use/promotion).

## Q {#letter-q}

### Cuota {#quota}

El máximo de espacio que puede usar un repositorio. Una subida nueva que lo supere se rechaza con `507` y el motivo `storage_quota`. Consulte [Almacenamiento](../operate/storage).

## R {#letter-r}

### Rango {#range}

La cabecera HTTP `Range: bytes=start-end` que pide parte de un archivo. Las descargas admiten un rango por solicitud, que es lo que necesita la reanudación. Consulte [Descripción general de la API HTTP](../api/index#range-downloads).

### Límite de velocidad {#rate-limit}

Un límite de con qué frecuencia puede intentarse algo. Arkvory limita los intentos de inicio de sesión, registro, contraseña y comentarios, y responde `429` con `Retry-After`. Consulte [Autenticación](../api/authentication#sign-in-limits).

### Puerta de enlace de lectura {#read-gateway}

Un proceso de API adicional de solo descarga sobre el mismo almacenamiento. Responde a `GET` y `HEAD` y rechaza los cambios con `405`. Consulte [Puertas de enlace de lectura](../operate/read-gateways).

### Preparación {#readiness}

Si el servidor puede hacer su trabajo. `GET /health/status` es pública y responde `{"status":"ready"}` o `unavailable`; `GET /health/ready` necesita una credencial y da detalles. Consulte [Referencia del sistema](../api/reference/system).

### Clave de recuperación {#recovery-key}

También llamada clave de arranque (bootstrap). El secreto de la instalación en `config/bootstrap-token.txt`: crea al propietario, administra las cuentas de servicio y recupera el acceso. Consulte [Autenticación](../api/authentication#recovery-key).

### Registro {#registry}

Un servidor al que se sube y del que se descarga, como Docker o npm. Arkvory tiene un registro de contenedores (`/v2/`) y un registro npm (`/npm/`). Consulte [Clientes y protocolos](../protocols/index).

### Repositorio {#repository}

Un espacio con nombre para el contenido, con sus propias reglas de acceso y política de almacenamiento. Consulte [Repositorios](../use/repositories).

### ID de solicitud {#request-id}

El identificador de una solicitud, que se devuelve en la cabecera `X-Request-Id` y en todos los errores. Proporciónelo al servicio de soporte. Consulte [Descripción general de la API HTTP](../api/index#request-ids).

### Resolver {#resolve}

Encontrar la compilación a la que apuntan una etapa y un rango de versiones. Consulte [Promoción](../use/promotion).

### Restaurar {#restore}

Hacer que una revisión anterior de un archivo vuelva a ser la actual, lo que añade una revisión nueva. También recuperar toda la instalación desde un punto de restauración. Consulte [Archivos y rutas](../use/files) y [Copias de seguridad](../operate/backups).

### Punto de restauración {#restore-point}

Una copia de seguridad completa que puede restaurarse. Consulte [Copias de seguridad](../operate/backups).

### Reanudar {#resume}

Continuar una subida o una descarga interrumpida desde donde se detuvo. Consulte [Transferencias](../use/transfers).

### Retención {#retention}

Las reglas sobre cuánto tiempo se conservan el contenido o las copias de seguridad. Consulte [Almacenamiento](../operate/storage).

### Política de retención {#retention-policy}

Las reglas de retención guardadas de un repositorio: cuántas compilaciones conservar, qué etiquetas proteger y qué antigüedad debe tener una compilación antes de eliminarla. Está desactivada hasta que un administrador la activa. Consulte [Almacenamiento](../operate/storage).

### Retry-After {#retry-after}

La cabecera, y el campo `retryAfterSeconds` de un error, que indica cuántos segundos esperar antes de reintentar tras un `429` o un `503`. Consulte [Descripción general de la API HTTP](../api/index#rate-limits).

### Revisión {#revision}

Una versión numerada de un archivo por ruta, de las anotaciones de un artefacto o de un ajuste. Las revisiones se cuentan a partir de 1. Consulte [Descripción general de la API HTTP](../api/index#revisions).

### Revocar {#revoke}

Cancelar definitivamente una clave o un token. Consulte [Autenticación](../api/authentication#service-keys).

### Reversión {#rollback}

Volver a la versión anterior tras una actualización que no llegó a iniciarse. Consulte [Actualizaciones](../install/updates).

### Rotar {#rotate}

Sustituir una clave por otra nueva mientras la antigua sigue funcionando. Activar la clave nueva limita la antigua a 24 horas. Consulte [Autenticación](../api/authentication#service-keys).

## S {#letter-s}

### SBOM {#sbom}

Una lista de materiales de software: la lista de componentes de una compilación. Puede adjuntarla a una compilación. Consulte [Conceptos](../guide/concepts#annotations).

### Autorrecuperación {#self-healing}

El reinicio automático de los servicios tras una caída o un bloqueo. Consulte [Autorrecuperación](../operate/self-healing).

### SemVer {#semver}

Versionado semántico: `MAJOR.MINOR.PATCH`, con una parte de prelanzamiento opcional, como `1.4.2` o `2.0.0-rc.1`. Consulte [Paquetes](../use/packages).

### Cuenta de servicio {#service-account}

Una cuenta para CI o automatización. Tiene una política y se identifica con claves. Consulte [Autenticación](../api/authentication#service-accounts).

### Clave de servicio {#service-key}

El secreto con el que se identifica una cuenta de servicio. Empieza por `arkvory_`, se muestra una sola vez y hay que activarla. Consulte [Autenticación](../api/authentication#service-keys).

### Sesión {#session}

Una sesión de consola iniciada. Empieza por `dps_` y dura 12 horas. Consulte [Autenticación](../api/authentication#sessions).

### SHA-256 {#sha-256}

La función hash que Arkvory usa para artefactos, partes y versiones. Se escribe como 64 dígitos hexadecimales en minúsculas. Consulte [Transferencias](../use/transfers).

### Versión estable {#stable-release}

Una versión que ProAnimaStudio ha aprobado para instalaciones en el canal estable. Consulte [Actualizaciones](../install/updates).

### Etapa {#stage}

Una marca en una compilación, como `qa`, `release` o `prod`. Consulte [Promoción](../use/promotion).

### Superficie {#surface}

Uno de los seis grupos de operaciones de la API: `discovery`, `identity`, `catalog`, `transfers`, `administration` y `operations`. Consulte [Descripción general de la API HTTP](../api/index#surfaces).

## T {#letter-t}

### Tag {#tag}

El nombre de una versión de una imagen de contenedor, como `latest` o `1.4`. Consulte [Imágenes de contenedor](../protocols/containers).

## U {#letter-u}

### UPack {#upack}

El formato de paquete que registra Arkvory: un archivo con un manifiesto llamado `upack.json` que indica el grupo, el nombre y la versión. Consulte [Paquetes](../use/packages).

### Actualización {#update}

Una versión estable más reciente de Arkvory, e instalarla. Consulte [Actualizaciones](../install/updates).

### Subida {#upload}

El acto de enviar un archivo al servidor. La palabra también nombra la sesión de subida que reserva el archivo. Consulte [Transferencias](../use/transfers).

### Sesión de subida {#upload-session}

Una reserva para un archivo. Dura 7 días y se completa una vez que han llegado todos los bytes. Consulte [Referencia de subidas](../api/reference/uploads).

## V {#letter-v}

### Almacén de copias {#vault}

El almacenamiento de las copias de seguridad: una carpeta en otro disco o un recurso compartido de red. Consulte [Copias de seguridad](../operate/backups).

### Versión {#version}

Una versión SemVer de un paquete, como `1.4.2`. Consulte [Paquetes](../use/packages).

### Rango de versiones {#version-range}

Un conjunto de versiones, como `^1.4`. Consulte [Paquetes](../use/packages).

## W {#letter-w}

### Proceso de trabajo (worker) {#worker}

El servicio que termina las subidas grandes y sincroniza los espejos. Consulte [Elegir una instalación](../install/index).

### Proceso de escritura (writer) {#writer}

El proceso de la API que acepta cambios, a diferencia de una puerta de enlace de lectura. Consulte [Puertas de enlace de lectura](../operate/read-gateways).
