---
title: Sitios
description: Vea todas las instalaciones de su clúster en un solo lugar, empareje sitios con un código de un solo uso y siga su estado.
---

# Sitios

Un **sitio** es una instalación de Arkvory: la principal, un espejo en otra ubicación, una instalación que importa versiones de otra. En [[ui:fleet]], una instalación, el **controlador**, muestra cada sitio que gestiona: si responde, su versión, sus copias de HA y pasarelas de lectura, sus espejos y cuánto van retrasados, y su cola de descargas. Solo los administradores globales ven la página.

## Cómo funciona {#how-it-works}

- El controlador guarda una lista de sitios. Lee cada sitio cada 30 segundos por HTTPS y conserva la última respuesta, así que un sitio que deja de responder sigue mostrando su último estado conocido.
- Al emparejarse, el sitio da al sitio de control una clave propia, la **clave de flota**. Solo alcanza lo que el sitio de control necesita: el estado del sitio, las descripciones de su catálogo y los cambios indicados: la cola de descargas, las solicitudes de actualización y los cambios de espejos y HA para el agente del sitio. No puede descargar bytes de archivos, escribir en repositorios ni leer o cambiar cuentas y claves.
- El controlador guarda las claves de flota selladas con una clave de su directorio de datos (`fleet.key`). La base de datos y sus copias de seguridad por sí solas no las revelan. Tras una restauración, empareje los sitios de nuevo.
- Cada sitio muestra qué controladores lo gestionan y puede revocarlos en cualquier momento.

## Emparejar un sitio {#pair}

1. En el sitio: abra [[ui:fleet]] y, en [[ui:fleetThisSite]], seleccione [[ui:fleetMakeCode]]. El sitio muestra un código válido diez minutos y, con HTTPS integrado, la huella de su certificado.
2. En el controlador: abra [[ui:fleet]], introduzca la dirección del sitio en [[ui:fleetAdd]] y seleccione [[ui:fleetCheck]]. El controlador se conecta y muestra la huella del certificado que recibió.
3. Compare las dos huellas. Deben ser iguales. Si difieren, la dirección es incorrecta o algo se interpone entre las instalaciones: no empareje.
4. Introduzca el código y seleccione [[ui:fleetPair]]. El sitio aparece en la lista con su estado.

Un código sirve una vez. Un código usado o caducado se rechaza: cree uno nuevo.

La dirección es la dirección HTTPS de la API del sitio, por ejemplo `https://branch.example:8443`. HTTP simple solo se acepta en el mismo equipo (`127.0.0.1`). Si TLS termina en un proxy delante del sitio, el sitio no puede mostrar el certificado del proxy: compare con la huella SHA-256 que su navegador muestra para la dirección del sitio.

A partir de ahí, el controlador confía exactamente en ese certificado. Cuando el sitio recibe un certificado nuevo, muestra [[ui:fleetStateCertificate]]: quite el sitio y empareje de nuevo.

## Estados {#states}

| Estado                       | Significado                                                  | Qué hacer                                                         |
| ---------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| [[ui:fleetStateOk]]          | El sitio respondió a la última lectura                       | Nada                                                              |
| [[ui:fleetStatePending]]     | El sitio aún no se ha leído                                  | Espere la siguiente lectura o seleccione [[ui:fleetReadSite]]     |
| [[ui:fleetStateUnreachable]] | Sin respuesta: el sitio está detenido o la red caída         | Revise el sitio y la red. El último estado conocido sigue visible |
| [[ui:fleetStateCertificate]] | El sitio presenta otro certificado que el confirmado         | Si el certificado se renovó, quite el sitio y empareje de nuevo   |
| [[ui:fleetStateRevoked]]     | El administrador del sitio revocó este controlador           | Empareje de nuevo con un código nuevo                             |
| [[ui:fleetStateInvalid]]     | El sitio respondió de una forma que esta versión no entiende | Actualice ambas instalaciones a la misma versión                  |
| [[ui:fleetStateRefused]]     | El sitio rechazó la solicitud                                | Empareje de nuevo con un código nuevo                             |

## Qué muestra la lista {#list}

- **[[ui:fleetVersion]]**: la versión del sitio y su rol, escritura o pasarela de lectura.
- **[[ui:fleetCopies]]**: en un clúster HA, las copias completas y cuántas necesita una escritura; las pasarelas de lectura que mantienen su puesto.
- **[[ui:fleetMirrors]]**: los espejos e importaciones del sitio; cuántos cambios lleva de retraso el más atrasado respecto a su origen, o cuántos están detenidos.
- **[[ui:fleetQueue]]**: descargas en curso y descargas que esperan en la cola.
- **[[ui:fleetSeen]]**: cuándo respondió el sitio por última vez.

[[ui:fleetReadAll]] lee todos los sitios ahora en lugar de esperar a la siguiente ronda. [[ui:fleetRemoveSite]] olvida un sitio aquí; revoque también el controlador en el sitio, porque hasta entonces su clave sigue válida allí.

## Contenido de un sitio {#content}

[[ui:fleetContent]] en la fila de un sitio abre bajo la lista sus repositorios, artefactos y archivos. Elija un repositorio; [[ui:fleetFind]] busca artefactos por nombre o etiqueta y muestra los archivos cuya ruta empieza por lo escrito. [[ui:fleetMore]] lee la página siguiente.

El sitio de control lo lee en el sitio con su clave de flota y muestra la respuesta tal como la dio el sitio. Solo viajan descripciones: nombres, tamaños, etiquetas, etapas, rutas y revisiones. Para descargar un archivo, use el propio sitio.

## Ajustes de un sitio {#site-settings}

[[ui:fleetSettings]] en la fila de un sitio abre sus ajustes bajo la lista; [[ui:fleetThisSettings]] abre la misma tarjeta para este sitio. La tarjeta tiene tres partes:

- **[[ui:fleetQueueSettings]]**: cuántas descargas van a la vez, plazas reservadas para personas, la estrategia, los pesos de las clases y los demás valores de la cola de [Control de tráfico](../reference/environment#transfers-and-bandwidth). Un campo vacío mantiene el valor del entorno del sitio, mostrado en gris. [[ui:fleetQueueSave]] aplica los valores al instante, sin reiniciar: las nuevas decisiones los siguen y las descargas activas conservan su lugar. [[ui:fleetQueueReset]] vuelve al entorno.
- **[[ui:updates]]**: la versión instalada y la última, la instalación automática y la hora de mantenimiento, [[ui:updateCheck]] e [[ui:updateInstall]]. El actualizador del sitio toma una solicitud en menos de un minuto; hasta entonces la tarjeta la muestra como aceptada.
- **[[ui:fleetAgent]]**: los espejos e importaciones del sitio con [[ui:fleetMirrorKeySave]] y [[ui:fleetMirrorDetach]], [[ui:fleetMirrorAttach]] con la clave de origen y, en un clúster HA, [[ui:fleetSwitchover]] a un nodo con copia completa (el nombre del nodo se escribe dos veces) y la decisión de una sola copia. El agente del sitio aplica cada solicitud en menos de un minuto con las comprobaciones y la reversión de `arkvory configure` y `cluster-*`; [[ui:fleetRequests]] muestra cómo terminó cada una. La clave de origen llega al agente una vez, en un archivo propio, y no vuelve a mostrarse. El agente es el actualizador del sitio: conéctelo con `updates-connect`.

Cada cambio lleva la revisión de la que parte. Si alguien cambió los ajustes mientras tanto, el sitio rechaza el cambio y la tarjeta muestra los valores actuales: revíselos y guarde de nuevo. El sitio registra quién cambió su cola: la clave del sitio de control y el nombre de su administrador.

Desde el sitio de control un espejo o una importación solo se conecta como repositorio nuevo, y el certificado de la autoridad de un origen se configura en el propio sitio (`arkvory configure --mirror-ca-file`): aquello en lo que confía un sitio nunca cambia en remoto. La lista de solicitudes muestra con un código cómo terminó cada cambio; las palabras del agente quedan en su registro en el sitio. Si un cambio se interrumpió a medias, el agente no toma otro hasta que un administrador del sitio lo revise y ejecute allí `arkvory changes-reset --root <raíz>`.

## Quién gestiona este sitio {#managed-by}

En [[ui:fleetThisSite]], cada sitio enumera los controladores que lo gestionan: nombre, quién los emparejó, cuándo y su última solicitud. [[ui:fleetRevoke]] rechaza la clave del controlador de inmediato.

## Configuración {#settings}

| Variable                 | Predeterminado                        | Significado                                                                                                   |
| ------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_SITE_NAME`      | el nombre del host                    | Cómo se llama esta instalación en otros sitios                                                                |
| `ARKVORY_FLEET_KEY_FILE` | `fleet.key` en el directorio de datos | La clave que sella las claves de los sitios gestionados; se crea en el primer inicio del proceso de escritura |

## Límites {#limits}

- Las pruebas de aislamiento y añadir o retirar nodos del clúster siguen siendo comandos locales en los nodos. Las pasarelas de lectura mantienen la cola de descargas de su entorno.
- Un controlador gestiona hasta 256 sitios y lee como mucho ocho a la vez.
- El controlador tiene una clave de cada sitio que gestiona: proteja a sus administradores globales y su directorio de datos con el mismo cuidado que los propios sitios.
