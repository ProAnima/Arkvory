---
title: Sitios
description: Vea todas las instalaciones de su clúster en un solo lugar, empareje sitios con un código de un solo uso y siga su estado.
---

# Sitios

Un **sitio** es una instalación de Arkvory: la principal, un espejo en otra ubicación, una instalación que importa versiones de otra. En [[ui:fleet]], una instalación, el **controlador**, muestra cada sitio que gestiona: si responde, su versión, sus copias de HA y pasarelas de lectura, sus espejos y cuánto van retrasados, y su cola de descargas. Solo los administradores globales ven la página.

## Cómo funciona {#how-it-works}

- El controlador guarda una lista de sitios. Lee cada sitio cada 30 segundos por HTTPS y conserva la última respuesta, así que un sitio que deja de responder sigue mostrando su último estado conocido.
- Al emparejarse, el sitio da al controlador una clave propia, una **clave de flota**. Solo alcanza lo que necesita un controlador: hoy, el estado del sitio. No puede leer ni cambiar repositorios, archivos, cuentas ni claves.
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

## Quién gestiona este sitio {#managed-by}

En [[ui:fleetThisSite]], cada sitio enumera los controladores que lo gestionan: nombre, quién los emparejó, cuándo y su última solicitud. [[ui:fleetRevoke]] rechaza la clave del controlador de inmediato.

## Configuración {#settings}

| Variable                 | Predeterminado                        | Significado                                                                                                   |
| ------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `ARKVORY_SITE_NAME`      | el nombre del host                    | Cómo se llama esta instalación en otros sitios                                                                |
| `ARKVORY_FLEET_KEY_FILE` | `fleet.key` en el directorio de datos | La clave que sella las claves de los sitios gestionados; se crea en el primer inicio del proceso de escritura |

## Límites {#limits}

- La página muestra el estado de los sitios. Los espejos, las actualizaciones, la cola de descargas y la HA se configuran en cada sitio, en su consola o con `arkvory configure`; cambiarlos desde el controlador llegará a continuación.
- Un controlador gestiona hasta 256 sitios y lee como mucho ocho a la vez.
- El controlador tiene una clave de cada sitio que gestiona: proteja a sus administradores globales y su directorio de datos con el mismo cuidado que los propios sitios.
