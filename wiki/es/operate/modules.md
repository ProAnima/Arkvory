---
title: Módulos
description: Instale paquetes de módulos firmados en un host, actívelos, compruébelos, elimínelos y guarde las claves de los autores de plugins en los que confía.
---

# Módulos

Un paquete de módulo añade una función a Arkvory. Arkvory solo instala paquetes cuya firma puede verificar. Los comandos de esta página se ejecutan en el host de la instalación, como root en Linux o como administrador en Windows. La consola y la API HTTP no pueden instalar módulos ni confiar en claves, así que una cuenta de administrador de la consola robada no permite ejecutar código en el servidor.

Los servicios vuelven a verificar los módulos instalados y los cargan cada vez que se inician. Un módulo solo se ejecuta después de que usted lo active.

## Instalar un paquete {#install}

1. Copie el archivo del paquete `arkvory-module-<id>-<version>.tgz` al host.
2. Compruébelo y lea sus condiciones:

   ```bash
   sudo arkvory module install /root/arkvory-module-sample-1.0.0.tgz --root /opt/proanima-arkvory
   ```

   El comando muestra el módulo, sus roles, los datos que guarda, la clave de firma y el SHA-256 del paquete, y después las condiciones del módulo. Todavía no cambia nada.

3. Instálelo:

   ```bash
   sudo arkvory module install /root/arkvory-module-sample-1.0.0.tgz --root /opt/proanima-arkvory --yes
   ```

Arkvory rechaza un paquete cuando:

| Motivo                                                                                                       | Código en el mensaje                                           |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| La firma no es de una clave de módulos de ProAnimaStudio, o el manifiesto cambió                             | `unknown_key`, `wrong_key_class`, `signature_invalid`          |
| Falta un archivo, cambió o no figura en el manifiesto                                                        | `file_missing`, `file_mismatch`, `file_unlisted`               |
| El archivo contiene enlaces, dispositivos, rutas fuera del paquete o nombres que solo difieren en mayúsculas | `link_entry`, `special_entry`, `unsafe_path`, `case_collision` |
| El archivo contiene un complemento nativo (`.node`)                                                          | `native_addon`                                                 |
| El módulo necesita otra versión de Arkvory                                                                   | `module_incompatible`                                          |
| ProAnimaStudio revocó esta versión                                                                           | `module_revoked`, con la versión de reemplazo                  |
| No hay una lista de revocación vigente (véase abajo)                                                         | `stale_revocations`                                            |

Límites: 1 GiB por paquete, 256 MiB por archivo, 4096 archivos. Un paquete mayor se rechaza antes de leer sus datos.

Una versión ya instalada con los mismos bytes se deja como está. La misma versión con otros bytes se rechaza.

## Activar y cargar un módulo {#load}

Un módulo instalado permanece desactivado hasta que usted lo active. Los servicios cargan los módulos solo al iniciarse.

1. Añada el módulo al archivo de módulos (`ARKVORY_MODULES_FILE`, consulte [Variables de entorno](../reference/environment#core)). La configuración del módulo va en `config`:

   ```json
   { "format": 1, "modules": { "sample": { "enabled": true } } }
   ```

2. Si el módulo guarda archivos, apruebe el tamaño de su directorio de datos con `resources`, por ejemplo `"resources": { "dataMiB": 512, "dataFiles": 10000 }` junto a `enabled`. Sustituye el tamaño que pide el paquete. Consulte [Directorio de datos de un módulo](#data).
3. Reinicie los servicios, como en [Aplicar un cambio](../install/configuration#apply-change).
4. Compruebe el módulo como administrador global: `GET /api/v1/system/modules` lo muestra con `running: true` y `health.status` `ok` en la API y en cada puerta de enlace de lectura.

Los módulos firmados se ejecutan en API, pasarelas de lectura, worker y agente de copias según sus roles declarados. Cada proceso proporciona solo los servicios disponibles para su rol y declarados en `uses`. Las rutas requieren `routes`. Docker Compose todavía no carga módulos.

Los almacenes de módulos se registran como `<module>.<name>` y pueden seleccionarse para nuevas cargas. Si dejan de aceptar escrituras, las nuevas cargas pasan a `default`. El núcleo verifica todos los bytes antes de publicar objetos compuestos de partes. La limpieza espera a los lectores activos, todas las retenciones de copias y la barrera de captura. Los cálculos usan hilos limitados. Las suscripciones confirman eventos tras procesarlos correctamente y pueden repetir la entrega después de un error.

Antes de que un servicio importe cualquier código de un módulo, vuelve a comprobar el paquete:

1. Solo root (en Windows: SYSTEM y Administrators) o el propietario del directorio de instalación pueden cambiar el directorio de instalación, `modules/`, el conjunto de módulos, la lista de revocación y su directorio. La instalación lo deja así. Se rechaza un archivo que otra cuenta pueda cambiar y un enlace dentro de un paquete (`access_unsafe`, `access_link`).
2. La firma, cada archivo y la versión de Arkvory, como los comprueba `module install`.
3. La lista de revocación. Una versión revocada nunca se carga. Una lista caducada o la falta de lista no detienen un módulo.

Un módulo que no supera una comprobación no se carga; los demás módulos y Arkvory siguen funcionando. `GET /api/v1/system/modules` lo muestra con `running: false`:

| `health.status` | Significado                                                 | Códigos                                                                                                          |
| --------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `failed`        | El paquete se rechazó, o su código no se cargó o no arrancó | `file_mismatch`, `unknown_key`, `module_incompatible`, `access_unsafe`, `config_invalid`, `start_failed` y otros |
| `revoked`       | ProAnimaStudio revocó esta versión                          | el motivo de la lista de revocación                                                                              |
| `unavailable`   | Falta el directorio del paquete en el host                  | `module_unavailable`                                                                                             |

Un módulo con fallo deja Arkvory fuera de servicio (`/health/ready` responde 503 con `module_failed`) solo cuando otro módulo activado lo necesita. Un módulo que guarda los bytes de los archivos publicados (datos `layout`) nunca lo hace: Arkvory sigue sirviendo sus datos y escribe las nuevas subidas en su propio almacenamiento en lugar del del módulo. El registro anota `module.refused` y `module.failed` con el código en `errorCode`.

Para reparar un paquete cambiado o ausente, instálelo de nuevo. Todos los servicios de la instalación deben ver los mismos módulos, activados o no: una puerta de enlace de lectura o un worker con otros módulos no está listo (`module_plan_mismatch`). Instale los mismos paquetes en el host de cada puerta de enlace de lectura.

### Directorio de datos de un módulo {#data}

Un módulo que guarda índices, cachés o un estado propios obtiene un directorio en el volumen de datos: `module-data/<id>/` en el directorio de almacenamiento `default`. Su parte `data` está pensada para las copias de seguridad; su parte `cache`, no. Arkvory cuenta cada escritura contra el tamaño aprobado, en MiB y en archivos, para ambas partes juntas. Una escritura que lo supera se rechaza (`module_quota_exceeded`) y el módulo sigue funcionando. Sin un tamaño aprobado, el módulo solo puede leer. También se aplica la [reserva del volumen](./storage#disk). En una puerta de enlace de lectura, el módulo lee los mismos archivos y no puede cambiarlos.

Eliminar un módulo conserva su directorio. Elimine `module-data/<id>/` usted mismo cuando ya no necesite los datos. Las copias de seguridad todavía no incluyen los directorios de los módulos.

Antes de actualizar a extension API 0.7.0, detenga todos los procesos API y worker antiguos que escriban datos de módulos. Los nuevos escritores comparten el control de cuota mediante el coordinador PostgreSQL de la instalación; los archivos temporales también cuentan. No se admite escribir simultáneamente con procesos antiguos y nuevos. Tras un fallo, Arkvory reconstruye el recuento cuando hace falta y elimina directorios temporales del nuevo protocolo solo después de adquirir el bloqueo del propietario anterior en la base de datos. Los temporales antiguos no se eliminan automáticamente y siguen contando para la cuota; revíselos por separado con los escritores detenidos. Los procesos backup solo tienen acceso de lectura.

## Rutas de los módulos {#routes}

Un módulo puede añadir rutas HTTP bajo su propio prefijo `/api/ext/<id>/v<major>/`, por ejemplo `/api/ext/sample/v1/`. Arkvory comprueba cada solicitud antes de que se ejecute código del módulo:

| Comprobación           | Como en `/api/v1`                                                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credencial             | Las mismas claves, sesiones y tokens; una ruta está abierta a cualquier llamante que haya iniciado sesión o solo al administrador global                                                       |
| Permiso                | El permiso que nombra la ruta sobre el repositorio de su ruta, como `content.read` o `upload.create`: una clave de servicio lo necesita, una cuenta necesita su permiso de lectura o escritura |
| Cuerpo de la solicitud | El límite de tamaño de la ruta, los límites de subida, los plazos y el ancho de banda del servidor                                                                                             |
| Archivos               | Los envía el propio Arkvory: ETag, Range, `If-Range`, 304, la cola de descargas y el ancho de banda de descarga                                                                                |

Los errores tienen el formato de errores de la API. Un módulo nunca ve la credencial ni otros encabezados. Una puerta de enlace de lectura sirve las rutas de lectura de un módulo y responde `read_only` a las demás.

Cada módulo describe sus rutas en un documento OpenAPI, y Arkvory compara ambos cuando el módulo arranca. Un módulo cuyas rutas incumplen las reglas no arranca ni sirve nada; Arkvory sigue funcionando. `GET /api/v1/system/modules` lo muestra con `running: false` y `health.status` `failed`:

| Código                   | Significado                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `routes_invalid`         | Una ruta incumple las reglas, por ejemplo una ruta fuera del prefijo del módulo o un cambio abierto a cualquier llamante con sesión |
| `openapi_invalid`        | El documento OpenAPI falta o no es válido                                                                                           |
| `openapi_route_mismatch` | Una ruta no tiene operación en el documento, o una operación no tiene ruta                                                          |
| `transfer_invalid`       | El módulo ofrece un protocolo de transferencia que no puede ofrecer                                                                 |

Los documentos de las rutas:

| Dirección                                                                                   | Quién puede leerla            | Contenido                                                                                                  |
| ------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET /api/ext/openapi.json`                                                                 | Cualquier llamante con sesión | Las rutas de todos los módulos que ejecuta este servicio, con las operaciones que el llamante puede llamar |
| [`GET /api/v1/system/modules/{id}/openapi`](../api/reference/system#getSystemModuleOpenApi) | El administrador global       | Las rutas de un módulo                                                                                     |

`/api/v1/openapi.json` nunca enumera rutas de módulos. Un módulo del tipo `transfer` puede ofrecer otra forma de transferir archivos: `GET /api/v1/capabilities` la enumera en `transfer`. Un cliente la usa solo si tiene una extensión que coincide; si no, transfiere los archivos como de costumbre.

## Actualizar, fijar y volver a una versión anterior {#versions}

Instale el archivo de la versión nueva con `--yes`. El paquete anterior se queda en el host hasta el siguiente cambio de módulos.

| Tarea                             | Comando                                                         |
| --------------------------------- | --------------------------------------------------------------- |
| Mantener la versión instalada     | `sudo arkvory module pin sample 1.0.0 --root …`                 |
| Volver a permitir otras versiones | `sudo arkvory module pin sample --unpin --root …`               |
| Instalar una versión anterior     | `sudo arkvory module install <file> --downgrade --yes --root …` |

Un módulo fijado rechaza cualquier otra versión hasta que lo libere. Una versión anterior a la instalada, o a una eliminada cuyo paquete sigue en el host, necesita `--downgrade`.

## Comprobar los módulos instalados {#list}

```bash
sudo arkvory module list --root /opt/proanima-arkvory
```

El comando vuelve a verificar cada paquete instalado, como hacen los servicios antes de cargarlo: la firma, cada archivo y el archivo comprimido. Cada módulo muestra un estado:

| Estado               | Significado                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `ok`                 | El paquete está intacto                                                                                            |
| `refused: <code>`    | Un archivo cambió, se añadió o se sustituyó por un enlace (`file_mismatch`, `file_unlisted`, `link_entry` y otros) |
| `revoked (<reason>)` | ProAnimaStudio revocó esta versión. `read path only` significa que sus datos siguen siendo legibles                |

Un paquete rechazado nunca se usa. Para repararlo, instale de nuevo el archivo del paquete.

## Eliminar un módulo {#remove}

```bash
sudo arkvory module remove sample --root /opt/proanima-arkvory
```

El módulo sale de la instalación y su paquete se queda en el host hasta el siguiente cambio de módulos. Un módulo que guarda los bytes de los archivos publicados (datos `layout`) no se puede eliminar: Arkvory lo rechaza con `module_owns_data`, para que sus datos nunca dejen de ser legibles.

## Lista de revocación {#revocations}

ProAnimaStudio publica una lista firmada de versiones de módulos revocadas. Cada lista tiene un número, y Arkvory nunca acepta una lista con un número menor que el de la que tiene. Un paquete de módulo puede llevar una lista más nueva: Arkvory la guarda al instalar el paquete. En un host sin acceso al hub, guarde usted mismo un archivo de lista:

```bash
sudo arkvory module revocations /root/module-revocations.json --root /opt/proanima-arkvory
```

Cada lista se firma con una fecha de caducidad: 90 días por defecto, nunca más de 180. `module install` y `module pin <id> <version>` necesitan una lista vigente; con una lista caducada o sin lista se rechazan con `stale_revocations`. Un paquete que lleva una lista vigente cuenta. Para continuar de todos modos, añada `--allow-stale-revocations`: Arkvory muestra una advertencia y registra la decisión en `modules/audit.jsonl`. Una lista caducada nunca detiene los módulos instalados: siguen funcionando y sus datos siguen legibles; solo una entrada de revocación detiene una versión. Una lista con un número mayor siempre sustituye a la guardada, aunque haya caducado.

Cuando ProAnimaStudio sustituye su clave de firma de módulos, una versión lleva ambas claves y la siguiente lista se firma con la clave nueva; solo una versión posterior retira la clave antigua. La actualización a esa versión se rechaza mientras el host guarde una lista firmada con la clave antigua: guarde antes una lista vigente. `sudo arkvory module check-revocations --root …` indica si esta versión confía en la clave de la lista guardada.

## Confiar en un autor de plugins {#trust}

Los plugins de su equipo o de otro autor se firman con la clave del autor. Añada la clave a la lista de confianza del host antes de instalar esos plugins. La lista de confianza pertenece al host: los servicios pueden leerla, pero no cambiarla.

1. Obtenga del autor el archivo de clave pública (`.pub`, formato minisign) y su huella por otro canal.
2. Muestre la clave y compare la huella:

   ```bash
   sudo arkvory module trust add /root/acme.pub --label "Acme platform team" --plugins "op-acme-*" --root /opt/proanima-arkvory
   ```

3. Añádala con `--yes`.

| Opción               | Significado                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--label`            | Quién tiene la clave; obligatoria                                                                                                 |
| `--plugins`          | Ids de plugins que la clave puede firmar, separados por comas: un id exacto o un prefijo con `*`. Por defecto `op-*`              |
| `--expires`          | Hora UTC como `2027-01-31T00:00:00Z`. Después, la clave no acepta instalaciones nuevas                                            |
| `--allow-in-process` | Permite que los plugins de la clave se ejecuten dentro del proceso de Arkvory. Ese código obtiene todos los derechos del servicio |

Los ids de plugins siempre empiezan por `op-`. Una clave de plugins nunca firma módulos de ProAnimaStudio, y las claves de ProAnimaStudio nunca firman plugins `op-`. Una clave que el host ya conoce con otro id o como clave de otro tipo se rechaza (`duplicate_key`). Las firmas deben ser prehash, lo predeterminado en las versiones actuales de minisign; las firmas heredadas se rechazan con `signature_algorithm`.

`sudo arkvory module trust list --root …` muestra las claves de confianza. `sudo arkvory module trust remove <key id> --root …` elimina una.

Esta versión mantiene la lista de confianza; los plugins se instalan con una versión posterior.

## Después de una interrupción {#recover}

Cada cambio del conjunto de módulos se registra en el diario de actualizaciones. Si un comando se detiene a medias, el siguiente comando de despliegue se rechaza con `Interrupted deployment`. Ejecute `sudo arkvory recover --root …`: restaura el conjunto de módulos anterior. Hasta entonces, todo comando de módulos que cambia algo se rechaza, incluidos `module trust` y `module revocations`.

## Duración de la solicitud del módulo {#request-scope}

La ruta usa los permisos del solicitante hasta el final de la respuesta, incluido el flujo. La cancelación o finalización revoca los permisos y cierra los recursos de lectura. `upload-read` lee partes aceptadas de cargas pendientes y comprueba el propietario, `upload.read`, el rango y la cancelación. Los módulos pueden retirar ofertas de transferencia en ejecución. Las siguientes consultas de capacidades las omiten; las rutas y transferencias activas se mantienen. El cliente puede conservar ofertas en caché, por lo que la ruta debe comprobar cada operación.

## Recuperación de la caché derivada {#derived-cache}

Los módulos firmados pueden declarar `derived-cache` (extension API 0.9.0). API y worker crean y leen generaciones inmutables; reader solo lee y backup no recibe el servicio. Los permisos del origen se comprueban en cada solicitud. El presupuesto de recursos incluye los datos/cachés anteriores y las generaciones retenidas. Un fallo de caché exige regeneración o fallback.

Perder una sesión PostgreSQL no demuestra que la E/S de archivos haya terminado. Las reservas de propietarios inciertos y las referencias persistentes de lectores siguen contabilizadas. Aplique primero las migraciones de esta versión del núcleo. Antes de recuperar, detenga todos los hosts participantes y confirme el fin de sus procesos y E/S, o demuestre el fin de la instancia exacta del proceso propietario y que no puede reanudarse; aísle mediante fencing los hosts inaccesibles. Obtenga el UUID exacto del propietario del diagnóstico y registre la prueba. Un PID, un timeout o la ausencia del bloqueo de BD no bastan.

En el host de confianza, con `ARKVORY_DATABASE_URL` configurado, ejecute el comando siguiente con los paquetes compilados de esta versión. La opción confirma la parada física; un bloqueo de propietario activo sigue impidiendo la recuperación. Sin confirmación no se actúa. Después reanude la reconciliación y compruebe la limpieza: confirmar no libera la cuota inmediatamente. Es mantenimiento del host, no un permiso del módulo ni del CLI remoto.

```sh
node scripts/recover-derived-cache.mjs --owner UUID --confirm-owner-stopped
```

## Estado de coordinación de módulos {#module-state}

Extension API 0.10.0 añade un registro de estado atómico y limitado para módulos firmados. Sobrevive a la conmutación HA, pero no se incluye en copias lógicas portátiles. Tras restaurar, siga el procedimiento explícito de reinicialización del módulo; la lectura y restauración de objetos deben seguir disponibles. Este estado está separado del almacenamiento de objetos y no se reinicia al reinstalar el módulo.

Un módulo de transferencia puede retirar temporalmente su protocolo y restaurarlo tras verificar su política, sin reiniciar Arkvory. Cada solicitud sigue sujeta a la política actual del módulo.

La API de extensiones 0.12.0 permite que un módulo de almacenamiento firmado limite los bytes lógicos. El núcleo cuenta los tamaños completos de los objetos y las cargas incompletas aceptadas en todos los repositorios, sin descuento por deduplicación. Al alcanzar el límite, las cargas nuevas usan el almacenamiento predeterminado; las aceptadas conservan su destino y los objetos siguen siendo legibles. El contador se reduce solo después de la limpieza.

## Catálogo compartido de recursos {#resource-catalog}

Extension API 0.13.0 ofrece a los módulos firmados un catálogo compartido de recursos. Los archivos están protegidos mientras las cargas o los recursos dependientes los referencien. Solo la limpieza del núcleo libera las referencias de las cargas. La eliminación física espera a los lectores y las copias de seguridad; si falla, conserva las dependencias para reintentarlo.

Antes de la primera actualización a un módulo que use este catálogo, detenga todos los procesos API y worker anteriores. No mezcle escritores antiguos y nuevos. Tras una restauración lógica, la limpieza permanece desactivada hasta que el módulo compruebe todas las recetas, archivos y dependencias. Repare los datos ausentes o dañados antes de reanudarla.
