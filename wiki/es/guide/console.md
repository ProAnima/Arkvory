---
title: La consola web
---

# La consola web

La consola web es la interfaz de Arkvory en el navegador. Forma parte del servidor, por lo que no se instala por separado. Abra `/console/` en la dirección de su servidor, por ejemplo `http://127.0.0.1:8080/console/` en el propio servidor o `https://arkvory.example/console/` después de configurar [HTTPS](../install/https).

La consola usa la misma API HTTP que el [cliente de línea de comandos](../protocols/cli) y el [SDK](../protocols/sdk). El servidor comprueba cada solicitud. Si un botón no aparece, significa únicamente que su cuenta o su clave no pueden usar esa operación.

## Disposición {#layout}

La barra lateral agrupa las secciones. En una pantalla estrecha, la barra lateral pasa a ser el botón [[ui:navigationMenu]].

| Grupo               | Secciones                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [[ui:navLibrary]]   | [[ui:catalog]], [[ui:packages]], [[ui:history]], [[ui:metadata]]                                                          |
| [[ui:navTransfers]] | [[ui:upload]], [[ui:downloads]]                                                                                           |
| [[ui:navResources]] | [[ui:administration]], [[ui:repositories]], [[ui:services]], [[ui:updates]], [[ui:backups]], [[ui:navStart]], [[ui:help]] |

La barra superior muestra el título de la sección, el botón [[ui:uploadFile]], el botón [[ui:reportOpen]] y los controles de apariencia y de idioma.

Cada sección tiene su propia dirección, como `#/catalog`, `#/packages` o `#/backups`. Un artefacto abierto tiene la dirección `#/artifact/<repository>/<id>`. Puede guardar estas direcciones como marcadores y enviarlas a otras personas. La dirección nunca contiene una contraseña, una clave ni un texto de búsqueda. Si abre un enlace antes de iniciar sesión, la consola lo abre después de que inicie sesión.

Algunas secciones solo aparecen para determinados usuarios:

| Sección               | Quién la ve                                                              |
| --------------------- | ------------------------------------------------------------------------ |
| [[ui:administration]] | Administradores                                                          |
| [[ui:repositories]]   | Todos los que han iniciado sesión                                        |
| [[ui:services]]       | La clave de recuperación y las claves de operador con derechos delegados |
| [[ui:updates]]        | Administradores                                                          |
| [[ui:backups]]        | Los administradores y la clave de recuperación                           |

## Inicio de sesión {#signing-in}

La tarjeta [[ui:connection]] está en la parte superior de la página.

1. Rellene los campos [[ui:accountName]] y [[ui:password]].
2. Seleccione [[ui:signIn]]. Una sesión dura 12 horas.
3. En el campo [[ui:repository]], la consola selecciona el primer repositorio que usted puede leer. Para trabajar en otro, escriba su nombre o elíjalo en la lista.

Para conectarse con una clave en lugar de una contraseña, abra [[ui:keySignIn]], pegue la clave y seleccione [[ui:connect]]. La clave permanece en la memoria de esta pestaña del navegador. La consola nunca la guarda.

El botón [[ui:signUp]] aparece solo cuando el administrador permite el autorregistro. El botón [[ui:disconnect]] cierra la conexión.

Después de iniciar sesión con una contraseña, puede usar [[ui:changeOwnPassword]] y [[ui:personalAccessTokens]]. Un token de acceso personal es una clave para sus propias herramientas. Consulte [Cuentas y acceso](../use/accounts).

### El primer propietario {#the-first-owner}

Una instalación nueva no tiene cuentas. En Windows, el instalador crea al propietario. En las demás instalaciones, cree al propietario en la consola:

1. Abra [[ui:navStart]] y expanda [[ui:welcomeOwner]].
2. Pegue la clave de recuperación de `config/bootstrap-token.txt`, en el directorio de la instalación.
3. Introduzca un nombre y una contraseña de al menos 12 caracteres, y seleccione [[ui:welcomeCreate]].
4. Inicie sesión con el nuevo nombre y la nueva contraseña.

El formulario funciona solo mientras no existan cuentas. El propietario es administrador. Además, obtiene acceso de escritura al repositorio `releases` mediante el grupo `arkvory-owners`.

## Biblioteca {#library}

### Artefactos {#artifacts}

La sección [[ui:catalog]] muestra los archivos publicados del repositorio. Busque por nombre o por un valor de metadatos. Use [[ui:labelFilter]] para mostrar una etiqueta y [[ui:metadataFilter]] para una clave y un valor exactos. Cada fila muestra el nombre, el tamaño, la hora de publicación, las etapas y las etiquetas. Seleccione [[ui:download]] para descargar un archivo o [[ui:open]] para ver sus detalles. El botón [[ui:more]] muestra la página siguiente.

### Paquetes {#packages}

La sección [[ui:packages]] muestra las versiones de UPack registradas. Filtre por [[ui:packageGroup]] y [[ui:packageName]], elija [[ui:sortBy]] y [[ui:groupBy]], y seleccione [[ui:apply]]. La columna de etapas muestra dónde se ha promovido cada versión. Consulte [Paquetes](../use/packages).

### Historial de archivos {#file-history}

Una ruta de archivo, como `builds/game/1.4/GameSetup.exe`, puede apuntar a contenido nuevo muchas veces. Cada cambio es una versión nueva. En [[ui:history]], introduzca una ruta y seleccione [[ui:historyLoad]]. Verá cada versión con su autor y su hora. Puede abrir cualquier versión para descargar su contenido original. Restaurar una versión antigua crea una versión nueva; no elimina nada. Consulte [Archivos y rutas](../use/files).

### Detalles del artefacto {#artifact-details}

La sección [[ui:metadata]] muestra un artefacto:

- **Resumen**: [[ui:summarySize]], [[ui:summaryCreated]] y [[ui:summaryHash]] con un botón [[ui:copyHash]].
- **Propiedades**: [[ui:labels]], [[ui:collections]] y [[ui:metadataFields]]. Seleccione [[ui:save]] para guardarlos. El archivo en sí no cambia.
- **Acciones**: [[ui:download]]; [[ui:downloadLink]] crea un enlace que funciona durante una hora sin clave; [[ui:register]] indexa un archivo UPack.
- [[ui:assetTitle]]: [[ui:assign]] convierte este artefacto en el contenido actual de una ruta de archivo.
- [[ui:promotionTitle]]: [[ui:stageAdd]] marca el artefacto con una etapa, como `qa` o `release`. [[ui:promoteSubmit]] lo publica en otro repositorio. Consulte [Promoción](../use/promotion).
- [[ui:attachmentsTitle]]: [[ui:attachmentAdd]] vincula un manifiesto, un SBOM, una firma, un informe u otro archivo a esta compilación. [[ui:attachmentHistory]] muestra los conjuntos anteriores.
- [[ui:deletionTitle]]: [[ui:deletionInspect]] muestra qué sigue usando el artefacto. Para eliminarlo, pegue el ID del artefacto y seleccione [[ui:deletionSubmit]]. Eliminar requiere una clave de servicio con la acción `artifact.delete`: una sesión con contraseña, un token personal y la clave de recuperación no pueden eliminar.

## Transferencias {#transfers}

### Subida {#upload}

En [[ui:upload]], elija un archivo y seleccione [[ui:startUpload]]. La consola calcula primero el SHA-256 del archivo y después lo envía en partes. El botón [[ui:pause]] detiene la transferencia y conserva las partes ya subidas.

Para continuar más tarde, conserve el ID de la subida. Abra [[ui:resumeTitle]], seleccione el mismo archivo e introduzca el valor de [[ui:uploadId]]. El navegador le avisa antes de que abandone la página durante una subida. Consulte [Transferencias](../use/transfers).

### Descargas {#downloads}

La sección [[ui:downloads]] es una cola de los archivos que descarga desde la consola. La consola comprueba el SHA-256 de cada archivo antes de guardar el archivo final.

- En [[ui:downloadSettings]] se establecen [[ui:downloadConcurrency]] (de 1 a 8), [[ui:downloadInterval]] y [[ui:downloadWait]].
- Los botones [[ui:downloadsPause]], [[ui:downloadsResume]], [[ui:downloadsClearWaiting]], [[ui:downloadsCancel]] y [[ui:downloadsClearFinished]] controlan toda la cola.
- Tras recargar la página, vuelva a iniciar sesión y seleccione [[ui:downloadRestore]]. Después reanude cada archivo y elija dónde guardarlo.

Las descargas grandes requieren Chrome o Edge en una dirección segura (HTTPS o el equipo local). Los datos temporales se quedan en el almacenamiento privado del navegador.

## Recursos {#resources}

### Usuarios y acceso {#users-and-access}

Aquí los administradores gestionan las cuentas de las personas. [[ui:accountsHeading]] enumera las cuentas y [[ui:groupsHeading]] enumera los grupos. Use [[ui:createUser]], [[ui:resetPassword]], [[ui:createGroup]] y [[ui:manageMembers]]. En [[ui:manageGrants]], conceda a un grupo acceso [[ui:read]] o [[ui:write]] a un repositorio por su nombre. Un repositorio no tiene un paso de creación independiente: existe en cuanto lo nombra una concesión de acceso o una política de servicio.

### Repositorios {#repositories}

La sección [[ui:repositories]] muestra los repositorios que usted puede ver, con el apartado [[ui:repositoryRights]]. Cada tarjeta tiene [[ui:repositoryOpen]], [[ui:repositoryStorage]] (cuota, limpieza automática y limpieza física; requiere una clave de servicio con las acciones `storage.read` o `storage.manage`) y, para los administradores, [[ui:repositoryAccess]]. Un repositorio espejo muestra la insignia [[ui:mirrorBadge]]. Consulte [Repositorios](../use/repositories) y [Almacenamiento](../operate/storage).

### Acceso de servicios {#service-access}

Aquí se crean cuentas para herramientas y sistemas de CI. Para ver esta sección, conéctese con la clave de recuperación o con una clave de operador. Seleccione [[ui:serviceCreate]] y después defina [[ui:servicePolicy]]. Los botones [[ui:bindingRead]] y [[ui:bindingPublish]] rellenan conjuntos de permisos habituales.

Para emitir una clave, abra [[ui:serviceKeys]] y seleccione [[ui:keyIssue]]. El secreto se muestra una sola vez. Cópielo, confirme la opción [[ui:keySaved]] y seleccione [[ui:keyActivate]]. Una clave que no se activa caduca a los 15 minutos. Use [[ui:keyRotate]] para sustituir una clave por otra y [[ui:keyRevoke]] para cancelarla de forma definitiva. La sección [[ui:delegations]] permite al propietario conceder a un operador derechos administrativos limitados.

### Actualizaciones {#updates}

La sección [[ui:updates]] muestra la [[ui:updateCurrent]] y la [[ui:updateLatest]]. Seleccione [[ui:updateCheck]] o [[ui:updateInstall]]. En [[ui:updateSettings]], active [[ui:updateAutomatic]] y elija la [[ui:updateHour]]. Consulte [Actualizaciones](../install/updates).

### Copias de seguridad {#backups}

La sección [[ui:backups]] muestra si las copias de seguridad están en buen estado, la última copia, la próxima ejecución, el agente de copias de seguridad y el almacén de copias. Seleccione [[ui:backupRun]] para iniciar una copia. El apartado [[ui:backupPoints]] enumera los puntos de restauración; puede verificar cada byte de un punto o fijarlo. El apartado [[ui:backupPlan]] define la hora diaria, la zona horaria y cuántos puntos se conservan. La restauración es un comando que se ejecuta en el servidor. Consulte [Copias de seguridad](../operate/backups).

### Primeros pasos y referencia de la API {#getting-started-and-api-reference}

La sección [[ui:navStart]] muestra los primeros pasos para un servidor nuevo. La sección [[ui:help]] enumera comandos de ejemplo. El botón [[ui:helpLoad]] muestra las operaciones de la API que puede invocar su cuenta o clave actual.

## Comentarios {#feedback}

Después de iniciar sesión, el botón [[ui:reportOpen]] envía un mensaje a ProAnimaStudio a través del hub. Puede agregar hasta 6 imágenes y una dirección de correo electrónico para recibir la respuesta. Los administradores pueden adjuntar el registro del servidor. Seleccione [[ui:reportShow]] para ver exactamente qué se envía.

## Apariencia e idioma {#appearance-and-language}

El control [[ui:theme]] tiene tres opciones: [[ui:system]], [[ui:light]] y [[ui:dark]]. El control [[ui:language]] enumera todos los idiomas de la consola con su propio nombre: English, Русский, Español, Français, Deutsch, Português, 中文, 日本語, 한국어, हिन्दी y العربية. La página cambia al instante, sin recargarse y sin perder lo que haya escrito; en árabe se lee de derecha a izquierda. En la primera visita, la consola sigue los idiomas del navegador y, si ninguno coincide, recurre al inglés. El botón [[ui:helpDocs]] de la sección [[ui:help]] abre esta documentación en el idioma de la consola. El navegador guarda solo el tema y el idioma, nada sobre su cuenta ni sobre sus repositorios.

## Páginas relacionadas {#related-pages}

- [Inicio rápido](./quick-start)
- [Conceptos](./concepts)
- [Cuentas y acceso](../use/accounts)
- [Solución de problemas](../operate/troubleshooting)
