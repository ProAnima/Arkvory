---
title: Conceptos
description: Las ideas que usa el resto de la documentación, desde la instalación y los repositorios hasta el acceso, la retención, las copias de seguridad y los espejos.
---

# Conceptos

Esta página explica las palabras que usan las demás páginas. Cada sección es corta y enlaza a la página que trata el tema en su totalidad. Para definiciones de una línea, véase el [Glosario](../reference/glossary).

## La instalación y sus servicios {#installation}

Una instalación es un servidor. Ejecuta tres servicios de Arkvory junto a una base de datos PostgreSQL:

| Parte            | Qué hace                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API              | El servidor HTTP: la API HTTP, la [consola web](./console) y los registros de contenedores, Git LFS y npm. También ejecuta la retención y la limpieza física. |
| Worker           | Trabajos en segundo plano: termina las subidas grandes y sincroniza los espejos.                                                                              |
| Agente de copias | Copias de seguridad programadas en el almacén.                                                                                                                |
| PostgreSQL       | El catálogo: artefactos, paquetes, revisiones, cuentas, claves y trabajos.                                                                                    |

El contenido de los archivos vive en un directorio local del servidor, no en la base de datos. Todas las partes viven en la **raíz de la instalación** (`C:\ProgramData\ProAnima\Arkvory` en Windows, `/opt/proanima-arkvory` en Linux). Los servicios arrancan sin un usuario con sesión iniciada y se reinician tras un fallo o un bloqueo ([Autorrecuperación](../operate/self-healing)).

Una instalación no es un clúster de alta disponibilidad. Si el servidor se detiene, los clientes esperan y luego continúan sus transferencias. Véase [Elegir una instalación](../install/index).

## Repositorios {#repositories}

Un **repositorio** es un espacio con nombre para el contenido. Tiene sus propias reglas de acceso, su propia política de almacenamiento (cuota y retención) y, opcionalmente, un origen de espejo. Un nombre de repositorio tiene de 1 a 64 caracteres: letras latinas minúsculas, dígitos, `-` y `_`, y empieza por una letra o un dígito.

No se crea un repositorio con un comando aparte. Un repositorio existe en cuanto se concede a un grupo acceso a su nombre o una política de cuenta de servicio lo nombra. Una instalación nueva tiene un sitio para el primero, `releases`. Véase [Repositorios](../use/repositories).

## Artefactos {#artifacts}

Un **artefacto** es un archivo almacenado. Es **inmutable**: sus bytes nunca cambian. Tiene un UUID, un nombre (hasta 240 caracteres, sin `/` ni `\`), un tamaño y una suma de comprobación SHA-256. Un contenido nuevo crea un artefacto nuevo; nunca reemplaza a uno antiguo.

Un artefacto se vuelve visible solo después de que el servidor ha comprobado que los bytes coinciden con el tamaño y el SHA-256 declarados. Una descarga devuelve los mismos bytes, con la suma como `ETag` fuerte. Todo lo demás en Arkvory se apoya en artefactos: una versión de paquete, una revisión de una ruta, una capa de contenedor y un objeto de Git LFS son todos artefactos.

## Subidas {#uploads}

Una **subida** reserva un artefacto futuro. Se crea una **sesión de subida** con el nombre, el tamaño y el SHA-256 del archivo, y con una `Idempotency-Key` que hace que la solicitud se pueda repetir sin riesgo. Luego se envían los bytes:

- en una sola solicitud, para archivos pequeños y medianos; o
- en **partes**, para archivos grandes. El servidor elige el tamaño de parte: 8 MiB como mínimo, duplicado para archivos muy grandes para que la subida nunca necesite más de 10.000 partes. Una parte nunca supera 1 GiB. Cada parte lleva su propio SHA-256, y repetir una parte es inofensivo.

Luego se **completa** la subida. El servidor comprueba el archivo completo y lo publica. Para archivos grandes, el worker completa la subida en un **trabajo de finalización** que el cliente sigue; el SDK y el cliente de línea de comandos lo eligen para archivos de 16 GiB y más. Una sesión de subida vive 7 días. Una subida interrumpida continúa desde las partes que el servidor ya tiene. El objeto más grande es 10.000 GiB salvo que el administrador fije un `ARKVORY_MAX_OBJECT_BYTES` menor.

El [cliente de línea de comandos](../protocols/cli) y el [SDK](../protocols/sdk) hacen todo esto por usted. Véase [Transferencias](../use/transfers) y la [referencia de Subidas](../api/reference/uploads).

## Paquetes {#packages}

Un **paquete** es un archivo UPack que Arkvory ha registrado. Su identidad es un **grupo**, un **nombre** y una **versión SemVer**, por ejemplo `acme` / `game-server` / `1.4.2`. El grupo es parte de la identidad: dos paquetes con el mismo nombre en grupos distintos son paquetes distintos. Una versión publicada nunca cambia; publicar la misma versión con otro contenido se rechaza.

Un agente de despliegue pide un paquete por versión exacta, por un **rango de versiones** como `^1.4`, o por la versión más reciente en una **etapa**. Las versiones preliminares aparecen solo cuando las pide. Véase [Paquetes](../use/packages).

## Archivos por ruta {#files-by-path}

Un **archivo por ruta** tiene una dirección como `builds/game/1.4/Setup.exe` y apunta a un artefacto. Cuando almacena bytes nuevos en la ruta, la ruta obtiene una nueva **revisión** (1, 2, 3 y así sucesivamente). Las revisiones anteriores permanecen en el **historial**, y puede **restaurar** una: restaurar añade una revisión nueva con el contenido antiguo. Almacenar los mismos bytes otra vez no añade nada.

Una ruta tiene como máximo 1.024 caracteres, usa `/` como separador y no tiene segmentos vacíos, `.` ni `..`, ni `:`. Un cambio nombra la revisión que espera; si otro cambio llegó primero, el servidor responde `409`. Use `0` para una ruta que aún no existe. Véase [Archivos y rutas](../use/files) y [Archivos raw](../protocols/raw-files).

## Etiquetas, metadatos, colecciones y adjuntos {#annotations}

Puede describir un artefacto sin tocar sus bytes:

| Elemento    | Regla                                                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Etiquetas   | Hasta 32 etiquetas cortas como `nightly` o `tested`.                                                                                                  |
| Metadatos   | Hasta 32 campos de texto; una clave tiene hasta 64 caracteres, un valor hasta 1.024.                                                                  |
| Colecciones | Conjuntos con nombre que agrupan artefactos.                                                                                                          |
| Adjuntos    | Hasta 32 enlaces de una compilación a otros artefactos del mismo repositorio: un manifiesto, un SBOM, una firma, un informe o cualquier otro archivo. |

Las etiquetas, los metadatos y las colecciones cambian como un único conjunto con revisión. Los adjuntos tienen su propia revisión e historial.

## Etapas y promoción {#stages-and-promotion}

Una **etapa** es una marca controlada en una compilación, como `qa`, `release` o `prod`. Un nombre de etapa usa letras minúsculas, dígitos, `.`, `_` y `-` (hasta 32 caracteres), y un artefacto puede tener hasta 16 etapas. Cambiar una etapa necesita su propio permiso, `artifact.promote`, y cada cambio se registra con el actor, la hora y un comentario.

La **promoción** publica una compilación en otro repositorio sin enviar los bytes de nuevo. `copy` conserva el origen; `move` también elimina la compilación del repositorio de origen. Repetir una promoción devuelve la copia que existe. **Resolve** encuentra la compilación a la que apuntan una etapa y un rango de versiones. Véase [Promoción](../use/promotion).

## Cuentas, grupos y permisos {#access}

Las personas usan **cuentas**. Una cuenta tiene un nombre (de 3 a 64 caracteres) y una contraseña (de 12 a 128 caracteres). Una cuenta de **administrador** gestiona cuentas y grupos. Las cuentas pertenecen a **grupos**, y a un grupo se le concede acceso `read` o `write` ("Lectura y escritura") a un repositorio. Los derechos se recalculan en cada solicitud, así que un cambio se aplica de inmediato.

La automatización usa una **cuenta de servicio** en su lugar. Su **política** lista **acciones** exactas por repositorio, como `upload.create` o `content.read`, y sus claves solo pueden reducir esa política. El servidor comprueba cada acción; ocultar un botón en la consola no es una protección. Véase [Cuentas y acceso](../use/accounts) y [Autenticación](../api/authentication).

## Claves y tokens {#keys-and-tokens}

Toda solicitud lleva una credencial. Hay cuatro tipos que usted crea y uno integrado:

| Credencial                   | Para                                                    | Duración                                       |
| ---------------------------- | ------------------------------------------------------- | ---------------------------------------------- |
| **Sesión** de consola        | Una persona con sesión iniciada con nombre y contraseña | 12 horas                                       |
| **Token de acceso personal** | Los scripts y herramientas de una persona               | 90 días por defecto, como máximo 365           |
| **Clave de servicio**        | CI/CD y agentes de despliegue                           | 90 días por defecto, como máximo 365           |
| **Enlace de descarga**       | Entregar un artefacto a alguien sin clave               | de 60 segundos a 24 horas (1 hora por defecto) |
| **Clave de recuperación**    | La propia instalación                                   | No caduca                                      |

Una clave de servicio se emite una vez, se muestra una vez y solo es utilizable después de **activarla**. Puede **rotarla** (emitir una nueva y luego retirar la antigua) y **revocarla** para siempre. Véase [Autenticación](../api/authentication).

## El propietario y la clave de recuperación {#owner-and-recovery-key}

El **propietario** es la primera cuenta. Es administrador y miembro del grupo `arkvory-owners`, que tiene acceso `write` a `releases`. El instalador de Windows lo crea; en Linux y Docker lo crea usted en la consola con la clave de recuperación.

La **clave de recuperación** es un secreto que el instalador escribe en `config/bootstrap-token.txt` en la raíz de la instalación. Puede crear el primer propietario y cuentas, gestionar cuentas de servicio y sus delegaciones, ejecutar copias de seguridad y solicitar actualizaciones. Las herramientas de instalación la leen en el servidor. No es para CI ni para el trabajo diario: guárdela en el servidor y no la copie. Véase [Elegir una instalación](../install/index#recovery-key) y [Seguridad](../operate/security).

## Retención, cuotas y limpieza {#retention}

Una **política de almacenamiento** pertenece a un repositorio. Puede conservar las últimas N compilaciones de cada paquete (o de cada paquete y canal), proteger etiquetas y etapas de la eliminación, esperar una antigüedad mínima antes de eliminar nada y fijar una **cuota** con umbrales de aviso y crítico. Está desactivada hasta que un administrador la activa. Eliminar un artefacto es primero lógico: los bytes permanecen en el disco durante un **período de gracia** (24 horas por defecto) y luego la **limpieza física** libera el espacio en segundo plano, en lotes pequeños, sin detener el servidor.

El servidor también mantiene una reserva de espacio libre en disco (1 GiB por defecto) que las subidas nunca usan. Véase [Almacenamiento](../operate/storage).

## Copias de seguridad {#backups}

El **agente de copias** copia la base de datos y todo el contenido publicado en el **almacén**, una carpeta en otro disco o en un recurso compartido de red. Una copia completa es un **punto de restauración**. El agente verifica cada punto, aplica la retención a los puntos (7 diarios, 4 semanales y 6 mensuales por defecto) y le permite **fijar** un punto para que la retención lo conserve. El programa diario está desactivado hasta que un administrador lo activa en [[ui:backupPlan]].

Restaurar es un comando en el servidor. Escribe en una base de datos vacía y en un directorio de almacenamiento vacío. Véase [Copias de seguridad](../operate/backups).

## Espejos y puertas de enlace de lectura {#mirrors-and-gateways}

Un **espejo** es una copia de solo lectura de un repositorio que una segunda instalación mantiene siguiendo a la primera, el **origen**. Rechaza los cambios y sirve las descargas. Si se pierde el origen, un operador separa el espejo y este se convierte en un repositorio normal; el cambio es manual y no es una conmutación automática. Véase [Espejos](../operate/mirrors).

Una **puerta de enlace de lectura** es un proceso API adicional sobre el mismo almacenamiento que responde solo a `GET` y `HEAD`. El escritor y las puertas de enlace comparten un único presupuesto de ancho de banda de descarga. Véase [Puertas de enlace de lectura](../operate/read-gateways).

## A dónde ir después {#next}

1. [Inicio rápido](./quick-start): instale Arkvory y suba un primer archivo.
2. [Cuentas y acceso](../use/accounts): personas, grupos, tokens y claves de servicio.
3. [Descripción general de la API HTTP](../api/index): las reglas que toda integración necesita.
4. [Glosario](../reference/glossary): definiciones cortas de cada término.
