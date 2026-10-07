---
title: Preguntas frecuentes
description: Respuestas cortas y exactas a preguntas comunes sobre los límites, la disponibilidad, las bases de datos, las actualizaciones, el traslado de servidores, el acceso y la licencia.
---

# Preguntas frecuentes

## Tamaño y disponibilidad {#size-and-availability}

### ¿Cuál es el archivo más grande que puedo almacenar? {#max-object-size}

10.000 GiB (10 737 418 240 000 bytes). Una subida tiene como máximo 10.000 partes de como máximo 1 GiB cada una. El administrador puede fijar un límite menor con `ARKVORY_MAX_OBJECT_BYTES`. Un tamaño declarado mayor se rechaza con `400`. En la práctica, el espacio libre en disco, la cuota del repositorio y la reserva de 1 GiB de espacio libre le detienen antes: responden `507`. Véase [Conceptos](../guide/concepts#uploads) y [Variables de entorno](./environment).

### ¿Cuánto puede contener un servidor? {#capacity}

Arkvory reserva hasta 10 TiB de contenido por defecto (`ARKVORY_CAPACITY_BYTES`), contando los archivos publicados, las subidas sin terminar y el contenido que espera limpieza. Es un contador, no una comprobación del disco. El disco y la reserva son el límite real. Un repositorio puede tener su propia cuota. Véase [Almacenamiento](../operate/storage).

### ¿Arkvory tiene alta disponibilidad? {#high-availability}

No. Una instalación es un servidor con una base de datos PostgreSQL y un directorio de contenido local. Si el servidor se detiene, los clientes esperan y luego reanudan sus transferencias; los servicios se reinician solos tras un fallo o un bloqueo. Para protegerse de la pérdida del servidor, use [copias de seguridad](../operate/backups). Para leer desde una segunda sede, use [espejos](../operate/mirrors); el cambio a un espejo es un paso manual, y los cambios que el espejo aún no había recibido se pierden.

### ¿Funciona sin conexión? {#offline}

El servidor funciona sin acceso a internet. El instalador de Windows incluye Node.js y PostgreSQL y se instala sin conexión. Los paquetes de Linux incluyen Node.js, y el gestor de paquetes instala PostgreSQL. Los instaladores por script y Docker descargan archivos. Las actualizaciones pueden instalarse desde una copia local de una versión. Si no se puede alcanzar el hub de actualizaciones, la comprobación de actualizaciones falla y se muestra en la consola; nada más se ve afectado. Véase [Elegir una instalación](../install/index) y [Actualizaciones](../install/updates).

## Almacenamiento y base de datos {#storage-and-database}

### ¿Qué base de datos usa? {#database}

PostgreSQL, una base de datos por instalación. El instalador de Windows incluye PostgreSQL 18.4. Los paquetes de Linux usan un clúster dedicado de un servidor PostgreSQL 16 a 19 de su distribución. La pila de Docker Compose ejecuta PostgreSQL 18.4 en un contenedor. Los instaladores por script usan su propio servidor. Nunca conecte dos instalaciones a una misma base de datos. El contenido de los archivos no está en la base de datos: está en el directorio de datos.

### ¿Puedo usar S3 u otro almacén de objetos? {#s3}

No. El contenido de los archivos se almacena en un directorio local, que debe estar en un sistema de archivos local que admita enlaces duros, no en un recurso compartido de red. Arkvory no almacena contenido en S3 ni ofrece una interfaz S3. El almacén de copias de seguridad es una carpeta en otro disco o en un recurso compartido de red montado (en Windows, un volumen local o iSCSI).

### ¿Puedo usar el inicio de sesión único de mi empresa? {#sso}

No. Las cuentas, los grupos y las contraseñas pertenecen a Arkvory. La automatización inicia sesión con claves de servicio. Véase [Autenticación](../api/authentication).

## Ejecutar el servidor {#running}

### ¿Cómo veo qué versión está instalada? {#version}

En la consola, abra [[ui:updates]]: [[ui:updateCurrent]] la muestra. En el servidor, ejecute `arkvory status --root <installation root>` y lea `current`; en Windows con el instalador gráfico, ejecute `& 'C:\Program Files\ProAnima\Arkvory\arkvory.ps1' status --root 'C:\ProgramData\ProAnima\Arkvory'` en un PowerShell elevado. Un administrador también puede llamar a `GET /api/v1/system/updates`, que devuelve `currentVersion`. El comando `arkvoryctl --version` muestra la versión del cliente, no la del servidor.

### ¿Cómo activo las actualizaciones automáticas? {#automatic-updates}

En la consola, abra [[ui:updates]], seleccione [[ui:updateAutomatic]], elija la [[ui:updateHour]] y seleccione [[ui:updateSave]]. En el servidor, ejecute `arkvory configure --root <installation root> --enable-updates`; `--disable-updates` las desactiva. Los instaladores las dejan desactivadas salvo que pase `--automatic`.

El servidor busca una versión cada 6 horas incluso cuando la instalación automática está desactivada. Con ella activada, una versión estable se instala una vez al día durante la hora de mantenimiento (03:00 UTC por defecto), salvo que la versión esté fijada. Una versión que cambia el esquema de la base de datos se instala solo después de que el servidor haya hecho y verificado una copia de seguridad nueva. Véase [Actualizaciones](../install/updates).

### ¿Qué envía Arkvory a ProAnimaStudio? {#hub-traffic}

Sus archivos y datos permanecen en su servidor. El servidor contacta con el hub de ProAnimaStudio (`hub.proanima.net`), y con GitHub cuando no se puede alcanzar el hub, por tres cosas:

- **Comprobaciones de actualizaciones.** La solicitud lleva el nombre del proyecto, el sistema operativo, la arquitectura del procesador, la versión instalada y el canal de actualizaciones. Con las estadísticas activadas, también lleva un ID de instalación aleatorio.
- **Estadísticas anónimas.** Un evento tras cada actualización instalada, con el ID de instalación, la versión, el sistema, la arquitectura y el canal. No se almacenan nombres, direcciones, contenido ni direcciones IP. Las estadísticas están activadas por defecto; desactívelas con [[ui:updateStatistics]] en [[ui:updates]] o con `arkvory configure --statistics off`. Sin estadísticas, una versión nueva le llega solo cuando se despliega para todos.
- **Comentarios.** Solo cuando una persona con sesión iniciada los envía desde [[ui:reportOpen]]. Contiene el mensaje, una dirección de correo opcional, hasta 6 capturas de pantalla y el registro de la consola. Un administrador puede añadir el registro del servidor y un resumen de versiones y estados sin secretos. [[ui:reportShow]] muestra exactamente lo que se enviará.

`arkvory configure --hub-off` deja de contactar con el hub: entonces las versiones llegan solo desde GitHub, y los comentarios se desactivan tras reiniciar los servicios. Un `ARKVORY_HUB_URL` vacío desactiva solo los comentarios. Véase [Licencia](https://github.com/ProAnima/Arkvory/blob/main/LICENSE.md), sección 7.

### ¿Las copias de seguridad se ejecutan solas? {#automatic-backups}

No hasta que las configure. Conecte un almacén con `arkvory configure --backup-vault <folder> --vault-key-file <file>` y luego active el programa diario en [[ui:backupPlan]] en [[ui:backups]]. El plan empieza a las 02:00 UTC y conserva 7 puntos de restauración diarios, 4 semanales y 6 mensuales. Hasta que el programa esté activado, la consola muestra el aviso de que el programa diario está desactivado. Véase [Copias de seguridad](../operate/backups).

### ¿Cómo me traslado a otro servidor? {#move-server}

1. Instale Arkvory de la misma versión o de una más nueva en el servidor nuevo.
2. Restaure el punto de restauración más reciente del almacén en una base de datos vacía y un directorio de almacenamiento vacío con el comando `arkvory-backup restore`. Comprueba cada archivo por SHA-256. Véase [Copias de seguridad](../operate/backups).
3. Apunte `ARKVORY_DATABASE_URL` y `ARKVORY_DATA_DIR` en `config/runtime.json` a la base de datos y el directorio restaurados, reinicie los servicios y compruebe la consola, una descarga y una subida.
4. Mueva la dirección (DNS o la configuración de CI) al servidor nuevo.

Los usuarios, los grupos y las contraseñas vuelven. Las sesiones no se conservan, los tokens personales y las claves de servicio quedan revocados, así que inicie sesión de nuevo y emita claves nuevas. Las políticas de retención y limpieza vuelven desactivadas; actívelas a propósito. Las subidas que no se terminaron quedan canceladas. Para un repositorio que quiera trasladar mientras el servidor antiguo sigue en marcha, también puede dejar que el servidor nuevo lo siga como [espejo](../operate/mirrors) y separarlo cuando cambie; un espejo lleva los archivos, los paquetes y las imágenes, pero no las cuentas, las claves, los adjuntos ni las políticas.

### ¿Qué le pasa a una transferencia cuando el servidor se reinicia? {#interrupted-transfers}

El cliente continúa. Una sesión de subida vive 7 días y conserva las partes que llegaron; el cliente de línea de comandos y el SDK preguntan al servidor qué tiene y envían el resto. Una descarga continúa con una solicitud `Range`. Una única solicitud `PUT`, como un archivo raw o una capa de Docker, empieza otra vez desde el primer byte. Véase [Reanudar transferencias interrumpidas](../protocols/cli#resume-interrupted-transfers).

### ¿Dónde miro cuando algo falla? {#logs}

Todo error tiene un ID de solicitud, en el campo `requestId` y el encabezado `X-Request-Id`. Búsquelo en el registro de acceso del servidor. Los servicios escriben sus registros en la carpeta `logs` en Windows y en el journal (`journalctl -u arkvory-api`) en Linux. Envíe un informe con [[ui:reportOpen]] para incluir los registros. Véase [Solución de problemas](../operate/troubleshooting) y [Monitorización](../operate/monitoring).

## Acceso {#access}

### ¿Cómo restablezco la contraseña del propietario? {#reset-owner-password}

Otro administrador puede usar [[ui:resetPassword]] en [[ui:administration]]. Si nadie puede iniciar sesión, use la clave de recuperación de `config/bootstrap-token.txt`: encuentre el ID de la cuenta con `GET /api/v1/users` y envíe `PATCH /api/v1/users/<id>` con `{"password": "…"}`. La contraseña nueva tiene de 12 a 128 caracteres. El restablecimiento termina todas las sesiones y los tokens personales de la cuenta. Véase [Autenticación](../api/authentication#recovery-key).

### ¿Qué es la clave de recuperación y qué pasa si la pierdo? {#lost-recovery-key}

Es un secreto en `config/bootstrap-token.txt` en la raíz de la instalación, legible solo por el administrador del sistema. Crea el primer propietario y administra las cuentas de servicio. Las herramientas de instalación leen el archivo, así que no lo borre. Si el archivo se pierde pero aún tiene una cuenta de administrador, puede seguir trabajando con la cuenta; para crear una clave de recuperación nueva, siga [Configuración](../install/configuration). Véase [Conceptos](../guide/concepts#owner-and-recovery-key).

### ¿Qué clave debe usar mi CI? {#ci-key}

Una clave de servicio de una cuenta de servicio cuya política tenga solo las acciones que el trabajo necesita, por ejemplo `upload.create`, `upload.write`, `upload.complete`, `upload.read` y `job.read` para publicar. Los preajustes [[ui:bindingRead]] y [[ui:bindingPublish]] de la consola rellenan conjuntos típicos. No use la clave de recuperación ni el token de una persona en CI. Las claves duran 90 días por defecto y están limitadas a 365, así que planifique una rotación. Véase [Autenticación](../api/authentication#service-accounts).

### ¿Por qué un administrador no puede eliminar un artefacto ni cambiar una política de almacenamiento? {#delete-forbidden}

Las acciones `artifact.delete`, `storage.read`, `storage.manage` y `diagnostics.read` existen solo para claves de servicio. Una concesión de grupo, un token personal, una sesión y la clave de recuperación nunca las llevan. Cree una cuenta de servicio que tenga estas acciones sobre el repositorio, emita una clave y use esa clave para la llamada (la API, `arkvoryctl` o [[ui:keySignIn]] en la consola). El error es `403` con el motivo `permission_missing`. Véase [Autenticación](../api/authentication#repository-actions).

### ¿Docker, Git LFS y Unity funcionan con él? {#protocols}

Sí. Arkvory sirve un registro de contenedores en `/v2/`, un servidor Git LFS en `/lfs/<repository>` y un registro npm en `/npm/<repository>/` que el Unity Package Manager puede usar. Aceptan la clave de Arkvory como contraseña. Véase [Clientes y protocolos](../protocols/index).

## Licencia {#license}

### ¿Arkvory es de código abierto? {#open-source}

No. Arkvory es gratuito y su código fuente está abierto a la lectura, pero no es de código abierto. Está bajo la Licencia ProAnima Arkvory 1.0 de Ian Panaev, que no permite distribuir bifurcaciones ni copias. Por favor, no lo llame "código abierto". El texto completo está en [LICENSE.md](https://github.com/ProAnima/Arkvory/blob/main/LICENSE.md); el texto ruso prevalece si los dos difieren.

### ¿Qué puedo hacer con él? {#license-allowed}

Puede instalar y usar cualquier número de copias para cualquier propósito, incluso en una empresa; leer y estudiar el código; modificarlo; y usar su versión modificada dentro de su organización. Puede almacenar y entregar sus propios artefactos a través de él, también a sus propios clientes.

### ¿Qué no está permitido? {#license-forbidden}

No puede distribuir el software ni versiones modificadas a nadie fuera de su organización, publicar bifurcaciones, compilaciones, imágenes de contenedor o parches que contengan su código, venderlo, alquilarlo o prestarlo, ni el acceso a él, cobrar por él, ni ofrecerlo a terceros como servicio alojado o gestionado. No puede quitar los avisos de derechos de autor, la licencia ni los nombres ProAnima Arkvory y ProAnimaStudio, ni presentar una versión modificada como la original. Cuando describa públicamente un sistema construido sobre Arkvory, nombre la fuente: "ProAnima Arkvory by ProAnimaStudio (Ian Panaev), https://github.com/ProAnima/Arkvory". Obtenga copias solo de las fuentes oficiales. Para otros permisos, escriba a info@proanima.net.

### ¿Dónde informo de un problema o una vulnerabilidad? {#report}

Para un problema con su instalación, use [[ui:reportOpen]] en la consola. Para un problema de seguridad, siga [SECURITY.md](https://github.com/ProAnima/Arkvory/blob/main/SECURITY.md) en el repositorio y no lo publique.
