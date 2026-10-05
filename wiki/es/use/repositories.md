---
title: Repositorios
description: Qué es un repositorio, cómo ver los repositorios que puede usar, cómo elegir uno en la consola y qué son los repositorios de solo lectura.
---

# Repositorios

Un repositorio es un lugar con nombre de Arkvory donde se almacenan los archivos y donde se decide el acceso. Todo lo que publica va a un repositorio y cada solicitud lo nombra.

## Qué es un repositorio {#what-it-is}

Un repositorio tiene un ID: letras latinas minúsculas, dígitos, `-` y `_`, que empieza por una letra o un dígito y tiene como máximo 64 caracteres. Algunos ejemplos son `releases`, `builds` y `game-prod`. El ID forma parte de todas las direcciones:

| Qué                                                | Dirección                             |
| -------------------------------------------------- | ------------------------------------- |
| Artefactos, paquetes, archivos por ruta (API HTTP) | `/api/v1/repositories/<repository>/…` |
| Imágenes de contenedor                             | `/v2/<repository>/<image>/…`          |
| Git LFS                                            | `/lfs/<repository>`                   |
| Paquetes de npm y de Unity                         | `/npm/<repository>/…`                 |

Consulte [Imágenes de contenedor](../protocols/containers), [Git LFS](../protocols/git-lfs) y [Paquetes de Unity y npm](../protocols/unity-npm).

Un repositorio contiene artefactos inmutables. Hay dos vistas de ellos: los paquetes UPack con una versión ([Paquetes UPack](./packages)) y los archivos por ruta con un historial ([Archivos por ruta](./files)). Las etapas y la promoción trasladan compilaciones entre repositorios ([Etapas y promoción](./promotion)).

Hoy un repositorio no tiene nombre para mostrar, ni descripción, ni más ajustes propios que el acceso, la [configuración de almacenamiento](#settings) y, si es una copia de otro servidor, su [estado de espejo](#read-only). No se puede cambiar el nombre de un repositorio. Tampoco se puede eliminar: si retira el acceso, los archivos permanecen en el disco.

## Crear un repositorio {#create}

No existe ningún comando que cree un repositorio. Un repositorio existe en cuanto se concede acceso a él. Permanece vacío hasta la primera subida.

Un administrador hace una de estas cosas:

- Concede a un grupo acceso al nombre nuevo. En la consola, abra [[ui:administration]], expanda [[ui:manageGrants]], elija el grupo, escriba el nombre en [[ui:repository]], elija [[ui:read]] o [[ui:write]] y seleccione [[ui:saveGrant]]. El grupo `arkvory-owners`, al que pertenece el propietario, es una buena opción para la primera concesión. Consulte [Grupos y acceso a los repositorios](./accounts#groups).
- Nombra el repositorio en la política de una cuenta de servicio. Consulte [Cuentas de servicio y claves para CI](./accounts#service-accounts).

Con la API, `setGroupGrant` y `setServicePolicy` hacen lo mismo. Un error al escribir crea un nombre nuevo y equivocado: compruebe la ortografía. El nombre `releases` existe después de la instalación, con acceso de escritura para el grupo `arkvory-owners`.

## Ver los repositorios que puede usar {#list}

Solo ve los repositorios en los que su credencial tiene algún derecho. Un repositorio en el que no tiene ningún derecho no aparece, y pedirlo directamente devuelve `404`. Un repositorio vacío al que tiene acceso también aparece.

En la consola, abra [[ui:repositories]]. Cada tarjeta muestra el nombre del repositorio y, en [[ui:repositoryRights]], las acciones que usted tiene en él. Los botones son:

- [[ui:repositoryOpen]] abre el catálogo del repositorio. Aparece cuando puede enumerar artefactos.
- [[ui:repositoryStorage]] abre el catálogo con la configuración de almacenamiento. Aparece cuando puede leer la política de almacenamiento o los diagnósticos.
- [[ui:repositoryAccess]] lleva a la administración de usuarios y de servicios. Aparece para los administradores y para los administradores de servicios.

La lista muestra 50 repositorios cada vez; [[ui:managementMore]] carga la página siguiente y [[ui:managementReload]] la actualiza. Un espejo muestra la insignia [[ui:mirrorBadge]].

Con `arkvoryctl`:

```bash
arkvoryctl repositories
arkvoryctl doctor
```

`repositories` imprime cada repositorio con sus `formats` y sus `permissions`. Cuando la respuesta tiene un valor `next`, páselo como `--after`. `doctor` muestra el servidor, las capacidades y los permisos de la clave actual.

Con la API, `listRepositories` acepta `limit` (de 1 a 100, 50 de forma predeterminada) y `after`, el último ID de la página anterior. `getRepository` devuelve una ficha.

```bash
curl -H "Authorization: Bearer $ARKVORY_KEY" "$ARKVORY/api/v1/repositories?limit=100"
```

```typescript
const page = await client.repositories({ limit: 50 });
const card = await client.repository('releases');
```

Una ficha contiene `id`, `formats` (siempre `upack` y `assets`) y `permissions`. No informa del tamaño ni del número de archivos. Para los nombres de las acciones, consulte [Permisos](./accounts#permissions).

## Elegir un repositorio en la consola {#choose}

La tarjeta [[ui:connection]] tiene el campo [[ui:repository]], con una lista de los repositorios que puede leer. El campo comienza con `releases`. Después de iniciar sesión, la consola lo conserva si puede leerlo y, si no, elige el primer repositorio que puede leer. Para trabajar en otro, escriba su nombre o elíjalo en la lista. El catálogo, los paquetes, las subidas y los detalles usan entonces ese repositorio. [[ui:repositoryOpen]], en una tarjeta, rellena el campo por usted.

La dirección de un artefacto en la consola contiene su repositorio: `#/artifact/<repository>/<id>`. Un enlace a un artefacto de un repositorio que no puede leer muestra un mensaje y el catálogo.

`arkvoryctl` usa el repositorio del perfil, `releases` a menos que indique otro al agregar el perfil. Para un solo comando, sustitúyalo con `--repository`:

```bash
arkvoryctl profile add production --server https://arkvory.example --token-file ~/.arkvory/key --repository builds
arkvoryctl list --repository releases
```

En el SDK, `client.inRepository('builds')` devuelve un cliente vinculado a un repositorio. En HTTP, el repositorio está en la ruta.

## Configuración de un repositorio {#settings}

Lo que hoy puede configurar en un repositorio:

- **Acceso.** Quién puede leer y escribir. Consulte [Cuentas y acceso](./accounts).
- **Almacenamiento.** Una cuota en GiB, umbrales de advertencia y críticos, retención (conservar las últimas N compilaciones de cada paquete y canal, etiquetas protegidas, una antigüedad mínima), limpieza automática y limpieza física. La configuración requiere las acciones `storage.read` para consultarla y `storage.manage` para cambiarla; el nivel de grupo de una persona no las da, una clave de servicio sí. En la consola están en [[ui:storageTitle]], que abre [[ui:repositoryStorage]]. Con `arkvoryctl`, `storage usage` y `storage policy` las leen. Una subida nueva que superaría la cuota se rechaza con `507 storage_quota`. Consulte [Almacenamiento y retención](../operate/storage).
- **Espejo.** Un administrador del servidor puede convertir el repositorio en una copia de un repositorio de otro servidor. Consulte la sección siguiente.

## Repositorios de solo lectura {#read-only}

Un **espejo** es una copia de solo lectura de un repositorio de otro servidor de Arkvory. El servidor la mantiene sincronizada por sí mismo. Todos los que tienen derecho de lectura pueden enumerar y descargar. Nadie puede modificarlo: subir, publicar, cambiar etiquetas, agregar etapas, asignar rutas y eliminar se rechazan con `409 mirror_read_only`, sea cual sea el nivel de grupo de la persona o las acciones de la clave. Para cambiar el contenido, use el servidor principal.

La consola muestra un espejo con una insignia sobre el catálogo y oculta el botón de subida:

| Insignia             | Significado                                                      |
| -------------------- | ---------------------------------------------------------------- |
| [[ui:mirrorBadge]]   | La copia está al día                                             |
| [[ui:mirrorBehind]]  | El servidor aún se está poniendo al día                          |
| [[ui:mirrorFailing]] | La última sincronización falló; las descargas siguen funcionando |

Seleccione [[ui:mirrorHelpLabel]], junto a la insignia, para ver el origen, la hora de la última sincronización y el código de error.

Un segundo tipo es una **importación**. Es un repositorio normal que toma automáticamente las versiones que tienen determinadas etapas en un repositorio de otro servidor (por ejemplo, de `dev` a `prod`). Su insignia es [[ui:mirrorImport]]. Las subidas a él siguen siendo posibles, y los cambios o eliminaciones posteriores en el origen no afectan a lo que ya se copió.

Con la API, `getRepositoryMirror` devuelve el estado: `mode` (`mirror` o `import`), `phase` (`pending`, `seeding` o `following`), `caughtUp`, `syncedAt` y `errorCode`. Responde `404` para un repositorio normal.

El administrador del servidor configura los espejos. Consulte [Espejos](../operate/mirrors). Una **puerta de enlace de lectura** es otra cosa: una dirección que solo sirve descargas de los mismos repositorios. Los cambios a través de ella se rechazan con `405 read_only`. Consulte [Puertas de enlace de lectura](../operate/read-gateways).

## Páginas relacionadas {#related-pages}

- [Cuentas y acceso](./accounts)
- [Archivos por ruta](./files) y [Paquetes UPack](./packages)
- [Almacenamiento y retención](../operate/storage)
- Referencia de la API: [Repositorios](../api/reference/repositories), [Espejos](../api/reference/mirrors)
