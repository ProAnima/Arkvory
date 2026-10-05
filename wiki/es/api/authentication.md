---
title: Autenticación
description: Todas las formas de autenticarse en la API HTTP de Arkvory, lo que cada credencial puede hacer y cómo funcionan las reglas de acceso y las acciones de repositorio.
---

# Autenticación

Toda llamada a `/api/v1` necesita una credencial, excepto las comprobaciones públicas de estado, las opciones de inicio de sesión, el inicio de sesión y el registro. Esta página enumera los tipos de credencial, cómo obtener y enviar cada una, y qué significan las reglas de acceso de la [referencia de la API](./index#reference-pages). Para las reglas de las personas que gestionan el acceso, véase [Cuentas y acceso](../use/accounts).

## Las credenciales de un vistazo {#credentials}

| Credencial               | Aspecto                  | Cómo se obtiene                                          | Duración                        | Para qué se usa                                                            |
| ------------------------ | ------------------------ | -------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| Sesión de consola        | `dps_…`                  | Iniciando sesión con un nombre y una contraseña          | 12 horas                        | Una persona en la consola, o un script que inicia sesión                   |
| Token de acceso personal | `pat_…`                  | Creándolo desde una sesión                               | 90 días por defecto, máximo 365 | Los scripts y herramientas de una persona                                  |
| Clave de servicio        | `arkvory_…`              | Emitiéndola para una cuenta de servicio y activándola    | 90 días por defecto, máximo 365 | CI/CD, agentes de despliegue, otros sistemas                               |
| Clave de recuperación    | 64 dígitos hexadecimales | El instalador la escribe en `config/bootstrap-token.txt` | No caduca                       | Crear el propietario, administrar cuentas de servicio, recuperar el acceso |
| Enlace de descarga       | `dtl_…`                  | Creándolo para un artefacto                              | de 60 segundos a 24 horas       | Entregar un artefacto a alguien sin clave                                  |

Use una clave de servicio para la automatización y un token de acceso personal para las herramientas de una persona. No use la clave de recuperación para el trabajo diario.

## Formatos del encabezado {#headers}

`/api/v1` acepta una credencial en un encabezado:

```http
Authorization: Bearer <credential>
```

- Una credencial tiene de 32 a 512 caracteres. Cualquier otra cosa es `credential_invalid` de inmediato.
- El registro de contenedores (`/v2`), Git LFS (`/lfs`) y el registro npm (`/npm`) también aceptan HTTP Basic, porque `docker login`, git y npm envían las credenciales así. El nombre de usuario no se comprueba; la contraseña es la credencial. Véase [Clientes y protocolos](../protocols/index#credentials).
- Un enlace de descarga va en la cadena de consulta, como `?token=dtl_…`, y funciona solo en la ruta de contenido de un artefacto. Véase [Enlaces de descarga](#download-links). Un encabezado `Authorization` siempre gana sobre la consulta.
- Una solicitud sin una credencial válida recibe `401` con `WWW-Authenticate: Bearer` y un motivo: `credential_missing`, `credential_invalid`, `session_expired` o `token_expired`. Solo el poseedor del secreto exacto de una credencial caducada se entera de que caducó.
- **Sin cookies.** Arkvory no establece ni lee ninguna, así que un navegador nunca adjunta una credencial por sí solo y no hay falsificación de solicitud entre sitios contra la que defenderse. Un script envía el encabezado en cada llamada. La consola guarda su token de sesión en la memoria de la pestaña del navegador y lo olvida cuando cierra la pestaña.
- **Otros orígenes.** Una página en la misma dirección que Arkvory no necesita nada. Una página en otra dirección se rechaza con `403` y el motivo `origin_not_allowed` salvo que el administrador haya listado su origen en `ARKVORY_CORS_ORIGINS`, incluso con una credencial válida. Use HTTPS: una credencial en HTTP sin cifrar es legible en la red. Véase [HTTPS](../install/https).

Compruebe qué es una credencial y qué puede hacer:

```bash
curl -fsS -H "Authorization: Bearer $ARKVORY_KEY" "$ARKVORY_URL/api/v1/auth/me"
curl -fsS -H "Authorization: Bearer $ARKVORY_KEY" "$ARKVORY_URL/api/v1/auth/permissions"
```

## Sesiones de consola {#sessions}

Una persona inicia sesión con un nombre y una contraseña y recibe una sesión. La consola lo hace por usted; un script puede hacer lo mismo.

1. Ponga el nombre y la contraseña en un archivo privado, `login.json`, para que nunca aparezcan en una línea de comandos ni en una lista de procesos:

   ```json
   { "name": "alice", "password": "a long password of 12 to 128 characters" }
   ```

2. Llame a `login`:

   ```bash
   curl -fsS -X POST "$ARKVORY_URL/api/v1/auth/login" \
     -H "Content-Type: application/json" -d @login.json
   ```

3. La respuesta contiene el token de sesión y su hora de fin:

   ```json
   {
     "token": "dps_…",
     "expiresAt": "2026-10-05T21:30:00.000Z",
     "account": { "id": "…", "name": "alice", "administrator": false, "enabled": true }
   }
   ```

4. Envíe el token como `Authorization: Bearer dps_…`.

Reglas de una sesión:

- Dura 12 horas y no se prorroga. Después, cada llamada devuelve `401` con el motivo `session_expired`. Inicie sesión de nuevo.
- Una cuenta tiene como máximo 32 sesiones. Un inicio de sesión nuevo termina las más antiguas por encima de eso.
- `POST /api/v1/auth/logout` termina la sesión. Cambiar su contraseña, o que un administrador la restablezca, termina todas las sesiones y todos los tokens personales de la cuenta. Deshabilitar la cuenta los detiene.
- Una sesión lleva toda la autoridad de la cuenta, incluida la marca de administrador. Solo una sesión puede crear y revocar tokens personales y cambiar la propia contraseña de la cuenta.
- Los nombres se comparan sin distinguir mayúsculas. Un nombre incorrecto, una contraseña incorrecta y una cuenta deshabilitada dan el mismo `401` con el motivo `invalid_credentials`.
- Una puerta de enlace de lectura no inicia sesión a nadie; use el escritor.

### Autorregistro {#self-registration}

`GET /api/v1/auth/options` es pública e indica si las personas pueden crear sus propias cuentas. El autorregistro está desactivado salvo que el administrador fije `ARKVORY_ALLOW_REGISTRATION=true`; entonces `POST /api/v1/auth/register` con el mismo cuerpo que el inicio de sesión crea una cuenta normal (no administrador, sin acceso a ningún repositorio) y devuelve una sesión con `201`. En caso contrario responde `403` con el motivo `registration_disabled`. El autorregistro se detiene a las 900 cuentas, para que los administradores aún puedan crear cuentas hasta el límite de 1.000.

## Tokens de acceso personal {#personal-tokens}

Un token de acceso personal permite que un script actúe como usted sin su contraseña. Solo una sesión con sesión iniciada puede crear uno.

```bash
curl -fsS -X POST "$ARKVORY_URL/api/v1/auth/tokens" \
  -H "Authorization: Bearer $SESSION" -H "Content-Type: application/json" \
  -d '{"name":"laptop-cli","scope":"read-write","expiresAt":"2026-12-31T00:00:00Z"}'
```

En la consola, abra [[ui:personalAccessTokens]] en la tarjeta [[ui:connection]], introduzca un [[ui:tokenName]], elija [[ui:tokenScope]] y [[ui:tokenExpiry]], y seleccione [[ui:generateToken]].

| Campo       | Regla                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| `name`      | De 1 a 64 caracteres.                                                                                            |
| `scope`     | `read` o `read-write`. La API usa `read-write` cuando lo omite; la consola ofrece [[ui:tokenScopeRead]] primero. |
| `expiresAt` | Una hora RFC 3339 en el futuro, como máximo a 365 días. El valor por defecto es 90 días. No hay tokens sin fin.  |

La respuesta `201` contiene el token una vez, como `token`. Guárdelo entonces: el servidor conserva solo un hash, y la lista muestra un prefijo corto. Luego:

- Un token tiene el acceso a repositorios de su cuenta, y nada más. Nunca tiene la marca de administrador, así que no puede gestionar cuentas, grupos, actualizaciones ni copias de seguridad.
- Un token `read` solo puede leer. Cualquier solicitud que cambie algo, aparte de `logout`, se rechaza con `403` y el motivo `read_only_token`, antes de que se ejecute la operación.
- Un token no puede crear tokens ni cambiar una contraseña; eso necesita una sesión.
- Una cuenta tiene como máximo 50 tokens activos. `GET /api/v1/auth/tokens` los lista con su prefijo, alcance, fin y último uso. `DELETE /api/v1/auth/tokens/{id}` revoca uno al instante ([[ui:revokeToken]] en la consola). Un administrador puede listar y revocar los tokens de cualquier cuenta.
- Un token caducado devuelve `401` con el motivo `token_expired`.

## Cuentas de servicio y claves {#service-accounts}

Una **cuenta de servicio** es una identidad para una herramienta, como un agente de compilación. Tiene una **política**: una lista de **enlaces**, cada uno con un repositorio y las **acciones** exactas permitidas allí (véase [Acciones de repositorio](#repository-actions)). Una política tiene como máximo 64 enlaces. La cuenta posee las subidas y los trabajos que inician sus claves, así que rotar una clave no pierde nada. Un servidor tiene como máximo 1.000 cuentas de servicio.

Solo la [clave de recuperación](#recovery-key) crea una cuenta de servicio. Ella, o un operador con una [delegación](#delegation), cambia las cuentas que existen. En la consola, use [[ui:services]]: [[ui:serviceCreate]] y luego fije [[ui:servicePolicy]]. [[ui:bindingRead]] rellena las siete acciones de lectura, y [[ui:bindingPublish]] añade las acciones necesarias para subir y registrar paquetes.

```bash
curl -fsS -X POST "$ARKVORY_URL/api/v1/service-accounts" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" \
  -d '{"name":"ci-release","bindings":[{"resource":{"kind":"repository","id":"releases"},
       "actions":["repository.read","artifact.read","upload.create","upload.read","upload.write",
                  "upload.complete","upload.cancel","job.read","package.publish"]}]}'
```

Los nombres usan de 3 a 64 letras, dígitos, `_`, `.` y `-`. Para cambiar la política, envíe `PUT /api/v1/service-accounts/{id}/policy` con el `expectedRevision` que leyó ([compare-and-swap](./index#revisions)). Para desactivar la cuenta, envíe `PATCH /api/v1/service-accounts/{id}` con `{"expectedRevision": n, "enabled": false}`; todas sus claves dejan de funcionar hasta que la active de nuevo.

### Claves de servicio {#service-keys}

Una clave es el secreto con el que inicia sesión una cuenta de servicio. Se parece a `arkvory_<uuid>.<secret>`. Una clave pasa por tres estados: `pending`, `active` y `revoked`.

1. **Emitir.** Envíe `POST /api/v1/service-accounts/{id}/keys` con una `Idempotency-Key`, un `name`, los `bindings` que la clave puede usar y, si quiere, un `expiresAt` (UTC, dentro de 365 días; por defecto 90). Los enlaces de la clave deben estar dentro de la política de la cuenta. La respuesta, `201`, contiene los metadatos de la clave y, solo esta vez, su `secret`. Una repetición con la misma clave de idempotencia devuelve `200` con los metadatos y sin secreto.
2. **Activar.** La clave nueva es `pending` e inutilizable salvo para una llamada, `POST /api/v1/auth/activate-key`, con el secreto nuevo como credencial. La respuesta es `204`. Hágalo dentro de 15 minutos; después la clave caduca sin usarse. En la consola, copie el secreto, seleccione [[ui:keySaved]] y luego [[ui:keyActivate]]. Activar de nuevo es inofensivo.
3. **Usar.** La clave funciona hasta su `expiresAt` o hasta que se revoque o se deshabilite su cuenta.

```bash
curl -fsS -X POST "$ARKVORY_URL/api/v1/service-accounts/$ACCOUNT/keys" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Idempotency-Key: ci-release-2026-10" \
  -H "Content-Type: application/json" \
  -d '{"name":"ci-release-2026-10","bindings":[{"resource":{"kind":"repository","id":"releases"},
       "actions":["upload.create","upload.read","upload.write","upload.complete","job.read"]}]}'
curl -fsS -X POST "$ARKVORY_URL/api/v1/auth/activate-key" -H "Authorization: Bearer $NEW_SECRET"
```

Límites: una cuenta tiene como máximo 3 claves activas y 2 claves pendientes a la vez (`507` con el motivo `key_limit`).

**Rotar.** `POST /api/v1/api-keys/{id}/rotate` emite una clave pendiente nueva para la misma cuenta, con el mismo cuerpo que una emisión y una `Idempotency-Key`. Sus enlaces deben estar dentro de los de la clave antigua. Cuando active la clave nueva, el fin de la clave antigua se recorta a como máximo 24 horas desde entonces. Mueva sus herramientas a la clave nueva y luego revoque la antigua. En la consola: [[ui:keyRotate]].

**Revocar.** `POST /api/v1/api-keys/{id}/revoke` termina una clave para siempre; repetirlo es inofensivo. En la consola: [[ui:keyRevoke]]. Revocar una clave no detiene una transferencia que ya empezó. ¿Perdió el secreto de una clave pendiente? Revoquela y emita otra con una clave de idempotencia nueva.

### Delegación {#delegation}

La clave de recuperación puede ceder parte de la administración a un **operador**: una cuenta de servicio cuya clave puede gestionar otras cuentas de servicio. Una **delegación** nombra la clave del operador, la cuenta destino, las **acciones de administración** que el operador puede usar sobre ella y un **techo**, las acciones de repositorio que puede conceder. Las siete acciones de administración son:

| Acción                   | Permite                                          |
| ------------------------ | ------------------------------------------------ |
| `service-account.read`   | Ver la cuenta en las listas y leer su ficha.     |
| `service-account.manage` | Activar o desactivar la cuenta.                  |
| `policy.read`            | Leer la política de la cuenta.                   |
| `policy.manage`          | Reemplazar la política de la cuenta.             |
| `credential.read`        | Listar las claves de la cuenta y leer una clave. |
| `credential.manage`      | Emitir, rotar y revocar claves.                  |
| `service-audit.read`     | Leer el historial de claves de la cuenta.        |

Reglas: la clave del operador debe ser una emitida por la clave de recuperación; un operador nunca gestiona su propia cuenta; no puede conceder nada fuera de su techo ni más allá de la política de la cuenta; una clave que emite no puede durar más que su propia clave; y terminar una delegación no revoca las claves que ya se activaron. Solo la clave de recuperación crea cuentas y fija delegaciones (`PUT` y `DELETE /api/v1/api-keys/{id}/delegations/{accountId}`). Una clave de operador puede tener hasta 64 delegaciones. En la consola, use [[ui:delegations]]. Un operador que necesita algo fuera de su delegación recibe `404` para una cuenta que no gestiona, o `403`.

## La clave de recuperación {#recovery-key}

El instalador crea la **clave de recuperación** una vez y la escribe en `config/bootstrap-token.txt` en la [raíz de la instalación](../install/index#installation-directory). Solo el grupo Administradores en Windows, o root en Linux, pueden leer el archivo. Su hash está en el archivo de claves del servidor (`ARKVORY_KEYS_FILE`), bajo el nombre `bootstrap-owner`. El instalador también crea `config/health-token.txt`, una segunda clave sin ningún derecho de repositorio, que puede llamar a las comprobaciones autenticadas de estado y a las métricas.

Qué puede hacer la clave de recuperación:

- Crear la primera cuenta y todas las posteriores, restablecer contraseñas, deshabilitar cuentas y gestionar grupos y sus concesiones de repositorio.
- Leer la auditoría de seguridad y revocar los tokens personales de cualquier cuenta.
- Crear cuentas de servicio, fijar sus políticas, emitir y revocar sus claves y fijar delegaciones.
- Leer y solicitar copias de seguridad y actualizaciones, y descargar el registro del servidor para los comentarios.
- Leer y escribir el repositorio `releases` como un miembro de un grupo con acceso [[ui:write]].

Qué no puede hacer: no tiene acceso a repositorios distintos de `releases`, no puede eliminar artefactos ni gestionar políticas de almacenamiento (esas acciones existen solo para claves de servicio), y no es una sesión, así que no puede crear tokens personales ni cambiar una contraseña. Guárdela en el servidor. Las herramientas de instalación la leen allí. No la ponga en CI ni la pegue en herramientas; cree una clave de servicio. Para reemplazarla, véase [Configuración](../install/configuration).

El formulario [[ui:welcomeOwner]] de la consola (en [[ui:navStart]]) usa la clave de recuperación para crear el primer propietario. Funciona solo mientras no exista ninguna cuenta. Para restablecer la contraseña de una cuenta existente sin una sesión, encuentre su ID con `GET /api/v1/users`, ponga la contraseña nueva (de 12 a 128 caracteres) en un archivo privado y envíela con la clave de recuperación. El restablecimiento termina todas las sesiones y tokens de esa cuenta.

```bash
echo '{"password": "a new password of 12 to 128 characters"}' > reset.json
curl -fsS -X PATCH "$ARKVORY_URL/api/v1/users/$USER_ID" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" -d @reset.json
rm reset.json
```

Un administrador puede añadir otras claves de archivo en el archivo de claves. Cada entrada tiene un `id`, el `sha256` del secreto, los `repositories` y `permissions` (`read` y `write`) que recibe y, opcionalmente, las banderas `administrator` y `serviceAdministrator`. El archivo se lee al arrancar, así que reinicie la API y el worker tras un cambio.

## Enlaces de descarga {#download-links}

`POST /api/v1/repositories/{repository}/artifacts/{id}/links` devuelve un `token` (`dtl_…`) y una `url` para un artefacto. Pida una duración con `ttlSeconds`: de 60 a 86.400, y 3.600 por defecto. El llamante necesita `content.read`.

El enlace funciona solo como `GET` o `HEAD` de `/api/v1/repositories/{repository}/artifacts/{id}/content?token=…`, para ese artefacto en ese repositorio, y solo para lectura. Es un secreto. El servidor no puede revocarlo antes de que caduque, y no aparece en los registros. Cree enlaces con la vida más corta que necesite.

## Qué significa una regla de acceso {#access-rules}

Toda operación de la referencia tiene una línea **Access**. Estos son los tipos de reglas:

| Regla en la referencia                                      | Qué pide                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cualquiera, sin clave                                       | Nada. Estado de vida, estado de disponibilidad, opciones de inicio de sesión, inicio de sesión y registro.                                                                                                                                                                                     |
| Cualquier clave o sesión válida                             | Cualquier credencial válida. Ejemplos: capacidades, la lista de operaciones, su propia identidad, detalles de disponibilidad y métricas.                                                                                                                                                       |
| Una sesión de cuenta con sesión iniciada (no una clave)     | Una sesión de una persona. Los tokens personales y las claves se rechazan (`session_required`). Ejemplos: crear y revocar sus propios tokens, cambiar su contraseña.                                                                                                                           |
| Administrador                                               | La sesión de una cuenta de administrador, o una clave de archivo con la bandera de administrador, como la clave de recuperación. Los tokens personales y las claves de servicio se rechazan (`administrator_required`). Ejemplos: cuentas, grupos, la auditoría de seguridad, actualizaciones. |
| Clave de arranque (clave de recuperación de la instalación) | Una clave de archivo con la bandera de administración de servicios. La clave de recuperación la tiene. Ejemplos: crear cuentas de servicio y fijar delegaciones.                                                                                                                               |
| Clave de arranque, o la propia clave                        | La clave de recuperación, o la clave cuyas delegaciones se listan.                                                                                                                                                                                                                             |
| La clave emitida, antes o después de la activación          | La única operación que acepta una clave pendiente: la activación.                                                                                                                                                                                                                              |
| Repositorios que el llamante puede ver                      | La acción `repository.read` sobre ese repositorio, o cualquier acceso a él para una sesión o clave de archivo. Un repositorio que el llamante no puede ver queda fuera de las listas y responde `404`.                                                                                         |
| Permiso del sistema `backup.read` o `backup.manage`         | Lo tienen las sesiones de administrador y las claves de archivo con bandera de administrador. Las claves de servicio y los tokens personales nunca los tienen. `backup.manage` incluye `backup.read`.                                                                                          |
| Permiso de administración de servicios                      | Una de las siete [acciones de administración](#delegation) sobre la cuenta destino, desde una delegación, o la clave de recuperación.                                                                                                                                                          |
| Permiso de repositorio                                      | **Todas** las acciones de repositorio listadas sobre el repositorio nombrado en la ruta. Varias reglas de acceso añaden condiciones: la subida, el trabajo o la referencia deben pertenecer al llamante.                                                                                       |

La segunda parte de una línea de repositorio, como "file keys: `read`, `write`", es la concesión general que las personas y las claves de archivo necesitan en lugar de las acciones exactas. Véase [Concesiones de grupo](#group-grants).

Más allá de la regla de acceso, el servidor también rechaza un cambio en un repositorio que es un espejo (`409`, `mirror_read_only`), y una puerta de enlace de lectura rechaza todo cambio (`405`, `read_only`).

## Permisos de repositorio {#repository-permissions}

### Concesiones de grupo {#group-grants}

Las personas obtienen acceso a los repositorios a través de **grupos**. Un administrador concede a un grupo `read` o `write` (mostrado como "Read and write") sobre un repositorio, y añade cuentas al grupo. En la consola: [[ui:administration]], luego [[ui:manageGrants]] y [[ui:saveGrant]]. Las llamadas de la API son `PUT /api/v1/access-groups/{id}/grants/{repository}` con `{"access": "read"}` o `{"access": "write"}`, y `PUT /api/v1/access-groups/{id}/members/{userId}`. Los derechos se recalculan en cada solicitud, así que un cambio se aplica de inmediato.

Una concesión `read` da estas acciones: `repository.read`, `artifact.read`, `artifact.list`, `content.read`, `package.read`, `asset.read` y `annotation.read`. Una concesión `write` añade `upload.create`, `upload.read`, `upload.write`, `upload.complete`, `upload.cancel`, `job.read`, `package.publish`, `asset.write`, `asset.restore`, `annotation.write`, `reference.write`, `artifact.promote` y `audit.read`. Las acciones `artifact.delete`, `storage.read`, `storage.manage` y `diagnostics.read` no pueden venir de un grupo: solo una clave de servicio puede tenerlas.

### Acciones de repositorio {#repository-actions}

Una clave de servicio lleva acciones exactas, repositorio por repositorio. Hay 24:

| Acción             | Permite                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `repository.read`  | Ver el repositorio y su estado de espejo.                                                                                                 |
| `artifact.read`    | Leer los detalles, las etapas y las promociones de un artefacto. También se necesita con cada cambio en un artefacto.                     |
| `artifact.list`    | Listar y buscar artefactos, listar artefactos con etapas, leer el diario de promociones y la fuente de cambios.                           |
| `artifact.promote` | Fijar y quitar etapas, y promover (copiar o mover) a otro repositorio.                                                                    |
| `artifact.delete`  | Eliminar artefactos, previsualizar y aplicar la retención, y quitar imágenes de contenedor y forzar el desbloqueo de archivos de Git LFS. |
| `content.read`     | Descargar bytes por ID, por paquete o por ruta, y crear enlaces de descarga.                                                              |
| `upload.create`    | Crear sesiones de subida. El push a los registros y a Git LFS lo usa.                                                                     |
| `upload.read`      | Leer sus propias sesiones de subida y sus partes.                                                                                         |
| `upload.write`     | Enviar las partes o todo el contenido de su propia subida.                                                                                |
| `upload.complete`  | Completar su propia subida, o encolar su finalización.                                                                                    |
| `upload.cancel`    | Cancelar su propia subida pendiente.                                                                                                      |
| `job.read`         | Leer sus propios trabajos de finalización.                                                                                                |
| `package.read`     | Listar paquetes, resolver versiones y descargar paquetes.                                                                                 |
| `package.publish`  | Registrar un archivo UPack como paquete.                                                                                                  |
| `asset.read`       | Listar archivos por ruta y leer sus punteros, historial y revisiones. Descargar los bytes necesita `content.read`.                        |
| `asset.write`      | Apuntar una ruta a un artefacto, o almacenar un archivo raw.                                                                              |
| `asset.restore`    | Restaurar una revisión anterior de una ruta.                                                                                              |
| `annotation.read`  | Leer etiquetas, metadatos, colecciones y adjuntos.                                                                                        |
| `annotation.write` | Reemplazar etiquetas, metadatos, colecciones y adjuntos.                                                                                  |
| `reference.write`  | Añadir y quitar referencias que protegen un artefacto.                                                                                    |
| `audit.read`       | Leer la auditoría del catálogo del repositorio.                                                                                           |
| `storage.read`     | Leer la cuota, el uso, la política de almacenamiento y la configuración de limpieza.                                                      |
| `storage.manage`   | Cambiar la política de almacenamiento y la configuración de limpieza, y ejecutar la limpieza.                                             |
| `diagnostics.read` | Leer los eventos de almacenamiento.                                                                                                       |

El conjunto exacto que necesita una operación está en su línea de la referencia, por ejemplo `upload.write` y `upload.complete` para `putUploadContent`. Un cambio en un repositorio necesita también la acción `read` correspondiente, como `artifact.read` con `annotation.write`.

Las condiciones de propietario se aplican a las subidas y los trabajos: usted actúa solo sobre las sesiones de subida y los trabajos de finalización que creó su cuenta. Todas las claves de una cuenta de servicio, y todas las sesiones y tokens de una persona, cuentan como el mismo propietario. Varios servicios en un repositorio se separan, por tanto, por cuentas y repositorios, no por prefijos de una ruta.

### Permisos de administración y del sistema {#administration-permissions}

Otros dos tipos de permiso no son acciones de repositorio. Las siete acciones de administración se listan en [Delegación](#delegation). Los dos permisos del sistema, `backup.read` y `backup.manage`, pertenecen solo a los administradores y a la clave de recuperación.

## Límites de inicio de sesión {#sign-in-limits}

El servidor frena la adivinación de contraseñas antes de comprobar ninguna contraseña. Los contadores viven en la memoria de cada proceso API y se reinician tras un reinicio. Se aplican por dirección de cliente, con una dirección IPv6 contada por su prefijo /64. Detrás de un proxy inverso, fije `ARKVORY_TRUSTED_PROXIES`, o cada cliente aparece como el proxy.

| Límite                           | Valor                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Intentos de inicio por dirección | Una ráfaga de 10, luego uno más cada 15 segundos. Un inicio de sesión correcto no consume un intento.                                                                                                                                                                                                                                      |
| Contraseñas fallidas por cuenta  | Cada contraseña incorrecta suma 1 a una deuda que baja 1 cada 6 segundos. Por encima de 20, la cuenta rechaza los intentos durante 1 segundo, que se duplica con cada fallo adicional hasta 2 minutos; durante ese tiempo incluso la contraseña correcta recibe `429`. Un inicio de sesión correcto o un restablecimiento borran la deuda. |
| Registros por dirección          | 3, luego uno más cada 20 minutos.                                                                                                                                                                                                                                                                                                          |
| Registros por servidor           | 20, luego uno más cada 3 minutos.                                                                                                                                                                                                                                                                                                          |
| Solicitudes de inicio en curso   | 16 por proceso API, y el cuerpo tiene 10 segundos para llegar. Más devuelve `503` con el código `busy`.                                                                                                                                                                                                                                    |

Un intento rechazado devuelve `429` con el código `rate_limited`, el motivo `login_attempts`, `registration_attempts` o `password_attempts`, y `Retry-After` en segundos. Espere ese tiempo; no reintente en bucle. Cambiar o restablecer una contraseña tiene su propia puerta y el motivo `password_attempts`. Todos los inicios de sesión, registros, cambios de contraseña y cambios de token se escriben en la auditoría de seguridad (`GET /api/v1/security/audit`, solo administradores), que conserva 365 días.

## Páginas relacionadas {#related}

- [Descripción general de la API HTTP](./index)
- [Errores](./errors)
- [Cuentas y acceso](../use/accounts)
- [Seguridad](../operate/security)
- [Clientes y protocolos](../protocols/index)
- Referencia: [Cuentas e inicio de sesión](./reference/accounts), [Cuentas de servicio y claves](./reference/services)
