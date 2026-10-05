---
title: Cuentas y acceso
description: Cree usuarios y grupos, concédales acceso a los repositorios y emita tokens personales y claves de servicio para CI.
---

# Cuentas y acceso

Arkvory distingue cuatro tipos de credenciales. Las personas inician sesión con una contraseña. Sus propias herramientas usan tokens de acceso personal. Los sistemas de CI y los agentes de despliegue usan claves de servicio. El instalador crea una clave más, la clave de recuperación, para la configuración inicial y las emergencias. El servidor comprueba cada solicitud con la credencial que la acompaña.

## Quién puede hacer qué {#overview}

| Credencial               | La crea                                                       | Duración                                         | Administración                                             | Acceso a los repositorios                                      |
| ------------------------ | ------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------- |
| Sesión con contraseña    | Al iniciar sesión                                             | 12 horas                                         | Usuarios y grupos, si la cuenta es de administrador        | Lectura o escritura por repositorio, mediante grupos           |
| Token de acceso personal | Usted, desde una sesión con contraseña                        | 90 días de forma predeterminada, 365 como máximo | Nunca                                                      | Sus grupos, opcionalmente solo lectura                         |
| Clave de servicio        | La clave de recuperación o un operador con derechos delegados | 90 días de forma predeterminada, 365 como máximo | Solo lo que el propietario delegó                          | La política de la cuenta de servicio, restringida por la clave |
| Clave de recuperación    | El instalador                                                 | Hasta que la reemplace                           | Usuarios, grupos, cuentas de servicio, copias de seguridad | Lectura y escritura en `releases`                              |

Hay tres cosas que es fácil pasar por alto:

- Una cuenta de administrador gestiona usuarios y grupos. No da acceso a los archivos. A los archivos solo se llega mediante los accesos concedidos a los grupos.
- Una clave de servicio la crea la clave de recuperación o una clave de operador, no una sesión con contraseña. Un administrador que inició sesión con una contraseña no puede crear cuentas de servicio.
- Un token personal o una clave de servicio nunca pueden crear usuarios, grupos ni otros tokens.

## El propietario y la clave de recuperación {#owner}

La primera cuenta es la del propietario, que es administrador. La crea el asistente de instalación de Windows. En Linux y Docker se crea en la consola con la clave de recuperación, como describe [La consola web](../guide/console#the-first-owner).

El propietario es miembro del grupo `arkvory-owners`, que tiene acceso de escritura al repositorio `releases`. Para cualquier otro repositorio, conceda usted mismo el acceso a un grupo. Consulte [Grupos y acceso a los repositorios](#groups).

La clave de recuperación es el archivo `config/bootstrap-token.txt` del directorio de la instalación. Solo un administrador del servidor puede leerlo. No lo copie a CI ni a los equipos de los clientes. Las herramientas de instalación y de actualización lo leen, así que no lo elimine. Consulte [Seguridad](../operate/security).

## Crear usuarios {#users}

Solo los administradores crean usuarios. El nombre tiene de 3 a 64 caracteres, entre letras, dígitos, `.`, `_` y `-`. La contraseña tiene de 12 a 128 caracteres. Una instalación admite como máximo 1000 cuentas.

En la consola:

1. Inicie sesión como administrador y abra [[ui:administration]].
2. Expanda [[ui:createUser]].
3. Rellene los campos [[ui:accountName]] y [[ui:password]]. Marque la casilla [[ui:administrator]] solo para las personas que administran usuarios.
4. Seleccione [[ui:createUser]].

La tabla [[ui:accountsHeading]] enumera las cuentas. [[ui:disableUser]] bloquea una cuenta: sus sesiones terminan de inmediato y sus tokens personales dejan de funcionar hasta que seleccione [[ui:enableUser]]. Para asignar una contraseña nueva a otra persona, expanda [[ui:resetPassword]]. Esto cierra las sesiones de la cuenta y revoca todos sus tokens personales.

Con la API, una sesión de administrador o la clave de recuperación llama a estas operaciones: `createUser`, `updateUser` y `listUsers`.

```bash
curl -X POST "$ARKVORY/api/v1/users" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"anna","password":"a long password here","administrator":false}'
```

```typescript
await client.administration.users.create('anna', 'a long password here', false);
```

`arkvoryctl` no tiene comandos para las cuentas. Use la consola o la API.

El autorregistro está desactivado de forma predeterminada. El administrador del servidor lo activa con `ARKVORY_ALLOW_REGISTRATION=true` (consulte [Variables de entorno](../reference/environment)). Entonces aparece [[ui:signUp]] en la tarjeta de inicio de sesión. Una cuenta nueva no tiene acceso a ningún repositorio hasta que un administrador la agregue a un grupo. El autorregistro se detiene en 900 cuentas, de modo que quedan 100 plazas libres para los administradores.

## Grupos y acceso a los repositorios {#groups}

Las personas obtienen acceso mediante grupos. Un grupo tiene miembros y, para cada repositorio, un nivel de acceso:

| Nivel en la consola | Significado                                                                           |
| ------------------- | ------------------------------------------------------------------------------------- |
| [[ui:read]]         | Ver y descargar                                                                       |
| [[ui:write]]        | Todo lo de lectura, y además subir, publicar, cambiar metadatos, promover y restaurar |

Un repositorio no tiene un paso de creación independiente. Existe en cuanto lo nombra una concesión de acceso o una política de servicio. El nombre usa letras latinas minúsculas, dígitos, `-` y `_`, empieza por una letra o un dígito y tiene como máximo 64 caracteres. Consulte [Repositorios](./repositories).

En la consola, abra [[ui:administration]]:

1. Expanda [[ui:createGroup]], escriba el nombre en el campo [[ui:accessGroup]] (de 2 a 64 caracteres, entre letras, dígitos, `.`, `_` y `-`) y seleccione [[ui:createGroup]].
2. Expanda [[ui:manageMembers]], elija el grupo y la cuenta, y seleccione [[ui:addMember]]. [[ui:removeMember]] quita la cuenta del grupo.
3. Expanda [[ui:manageGrants]], elija el grupo, escriba el nombre del [[ui:repository]], elija el nivel de [[ui:access]] y seleccione [[ui:saveGrant]]. [[ui:removeGrant]] retira el acceso.

La tabla situada debajo de los formularios muestra los apartados [[ui:members]] y [[ui:grants]] de cada grupo. Quitar un miembro o un acceso surte efecto en la siguiente solicitud de la cuenta. Los archivos permanecen donde están.

Una instalación admite como máximo 100 grupos, 10 000 pertenencias y 10 000 accesos concedidos en total.

Con la API, las operaciones son `createAccessGroup`, `addGroupMember`, `removeGroupMember`, `setGroupGrant` y `removeGroupGrant`:

```bash
curl -X PUT "$ARKVORY/api/v1/access-groups/$GROUP_ID/grants/builds" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"access":"write"}'
```

```typescript
await client.administration.groups.setGrant(groupId, 'builds', 'write');
```

## Permisos {#permissions}

Detrás de los dos niveles, lectura y escritura, hay 24 acciones de repositorio. Una clave de servicio nombra estas acciones una por una. `arkvoryctl doctor` y `GET /api/v1/auth/permissions` muestran las acciones que tiene la credencial actual, por repositorio.

| Acción             | Etiqueta en la consola             | Qué permite                                                                         |
| ------------------ | ---------------------------------- | ----------------------------------------------------------------------------------- |
| `repository.read`  | [[ui:permission.repository.read]]  | Enumerar los repositorios y ver los derechos propios. Sin acceso a los archivos.    |
| `artifact.list`    | [[ui:permission.artifact.list]]    | Enumerar y buscar artefactos, leer la lista de etapas y el diario de promociones    |
| `artifact.read`    | [[ui:permission.artifact.read]]    | Detalles, etapas e historial de promociones de un artefacto                         |
| `content.read`     | [[ui:permission.content.read]]     | Descargar bytes, crear enlaces de descarga, resolver un paquete para descargarlo    |
| `upload.create`    | [[ui:permission.upload.create]]    | Iniciar una subida                                                                  |
| `upload.read`      | [[ui:permission.upload.read]]      | Leer el estado y las partes de su propia subida                                     |
| `upload.write`     | [[ui:permission.upload.write]]     | Enviar los bytes de su propia subida                                                |
| `upload.complete`  | [[ui:permission.upload.complete]]  | Terminar su propia subida, iniciar una tarea de finalización                        |
| `upload.cancel`    | [[ui:permission.upload.cancel]]    | Cancelar su propia subida                                                           |
| `job.read`         | [[ui:permission.job.read]]         | Leer su propia tarea de finalización                                                |
| `package.read`     | [[ui:permission.package.read]]     | Enumerar paquetes UPack y resolver una versión                                      |
| `package.publish`  | [[ui:permission.package.publish]]  | Registrar un archivo subido como paquete                                            |
| `asset.read`       | [[ui:permission.asset.read]]       | Leer las rutas de archivo, su historial y sus revisiones                            |
| `asset.write`      | [[ui:permission.asset.write]]      | Hacer que un artefacto sea el contenido actual de una ruta                          |
| `asset.restore`    | [[ui:permission.asset.restore]]    | Restaurar una revisión anterior de una ruta                                         |
| `annotation.read`  | [[ui:permission.annotation.read]]  | Leer etiquetas, metadatos, colecciones y adjuntos                                   |
| `annotation.write` | [[ui:permission.annotation.write]] | Cambiar etiquetas, metadatos, colecciones y adjuntos                                |
| `artifact.promote` | [[ui:permission.artifact.promote]] | Agregar y quitar etapas, promover hacia el repositorio                              |
| `reference.write`  | [[ui:permission.reference.write]]  | Agregar y quitar su propia referencia externa en un artefacto                       |
| `audit.read`       | [[ui:permission.audit.read]]       | Leer la auditoría del catálogo del repositorio                                      |
| `artifact.delete`  | [[ui:permission.artifact.delete]]  | Comprobar y eliminar artefactos, previsualizar y aplicar la retención               |
| `storage.read`     | [[ui:permission.storage.read]]     | Leer la política de almacenamiento, el uso y la configuración de limpieza           |
| `storage.manage`   | [[ui:permission.storage.manage]]   | Cambiar la política de almacenamiento y la configuración de limpieza, y ejecutarlas |
| `diagnostics.read` | [[ui:permission.diagnostics.read]] | Leer los eventos de almacenamiento                                                  |

Cómo se corresponden los niveles de un grupo con las acciones:

- **Lectura** da `repository.read`, `artifact.list`, `artifact.read`, `content.read`, `package.read`, `asset.read` y `annotation.read`.
- **Escritura** da todo lo de lectura y además `upload.create`, `upload.read`, `upload.write`, `upload.complete`, `upload.cancel`, `job.read`, `package.publish`, `asset.write`, `asset.restore`, `annotation.write`, `artifact.promote`, `reference.write` y `audit.read`.
- **Ningún nivel de grupo da** `artifact.delete`, `storage.read`, `storage.manage` ni `diagnostics.read`. La eliminación de artefactos y la administración del almacenamiento corresponden a las claves de servicio que nombran estas acciones. Consulte [Almacenamiento y retención](../operate/storage).

Un espejo es una copia de solo lectura de otro repositorio ([Espejos](../operate/mirrors)). Cualquier acción que lo modifique se rechaza con `409 mirror_read_only`, sea cual sea el acceso concedido.

## Contraseñas y sesiones {#passwords}

Inicie sesión con [[ui:accountName]] y [[ui:password]] en la tarjeta [[ui:connection]]. Una sesión dura 12 horas. [[ui:disconnect]] la termina.

Para cambiar su propia contraseña, use [[ui:changeOwnPassword]] en la misma tarjeta. Rellene los campos [[ui:currentPassword]] y [[ui:newPassword]]. Todas sus sesiones y todos sus tokens personales terminan, así que debe iniciar sesión de nuevo y crear tokens nuevos. Un administrador puede restablecer la contraseña de otra cuenta sin conocer la anterior.

El servidor dificulta que se adivinen contraseñas:

- Una dirección de red puede intentar 10 inicios de sesión seguidos y, después, uno más cada 15 segundos.
- Tras muchas contraseñas incorrectas para una cuenta, esa cuenta espera cada vez más, hasta 2 minutos. Durante esta espera se rechaza incluso la contraseña correcta. La respuesta es `429 rate_limited` con `Retry-After`.
- Detrás de un proxy inverso, el administrador incluye el proxy en `ARKVORY_TRUSTED_PROXIES`. De lo contrario, todas las personas comparten una sola dirección.

Con la API, `login` intercambia un nombre y una contraseña por una sesión Bearer, y `changeOwnPassword` cambia la contraseña:

```bash
curl -X POST "$ARKVORY/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"name":"anna","password":"a long password here"}'
```

## Tokens de acceso personal {#tokens}

Un token de acceso personal es una clave para sus propias herramientas: un script de su equipo, `arkvoryctl` o el SDK. Actúa en su nombre, con los repositorios de sus grupos.

Solo una sesión con contraseña crea tokens. Un token no puede crear otro token y no tiene derechos de administrador.

1. Inicie sesión con su contraseña.
2. En la tarjeta [[ui:connection]], expanda [[ui:personalAccessTokens]].
3. Rellene el campo [[ui:tokenName]]. En el campo [[ui:tokenExpiry]] elija [[ui:tokenDays30]], [[ui:tokenDays90]] o [[ui:tokenDays365]].
4. En el campo [[ui:tokenScope]] elija [[ui:tokenScopeRead]] o [[ui:tokenScopeReadWrite]]. Un token de solo lectura rechaza cualquier cambio con `403 read_only_token`.
5. Seleccione [[ui:generateToken]] y después [[ui:copyToken]]. El token se muestra una sola vez. Empieza por `pat_`.

La tabla muestra de cada token las columnas [[ui:tokenPrefix]], [[ui:tokenCreated]], [[ui:tokenExpires]], [[ui:tokenLastUsed]] y [[ui:tokenStatus]], esta última con los valores [[ui:tokenActive]], [[ui:tokenExpired]] o [[ui:tokenRevokedState]]. Para anular un token, seleccione [[ui:revokeToken]] y confirme con [[ui:tokenRevokeConfirmSubmit]]. Los clientes que lo usan pierden el acceso de inmediato.

Una cuenta puede tener 50 tokens activos. Un administrador puede enumerar y revocar los tokens de cualquier cuenta con `listAccountTokens` y `revokeAccountToken`.

Con la API, un token tiene un nombre y, de forma opcional, una caducidad (hasta 365 días a partir de ahora) y un ámbito:

```bash
curl -X POST "$ARKVORY/api/v1/auth/tokens" \
  -H "Authorization: Bearer $SESSION" \
  -H "Content-Type: application/json" \
  -d '{"name":"laptop","scope":"read-write","expiresAt":"2027-01-31T00:00:00Z"}'
```

```typescript
const created = await client.identity.createToken('laptop', { scope: 'read-write' });
console.log(created.token); // se muestra una sola vez
```

El ámbito predeterminado de la API es `read-write`. La consola preselecciona [[ui:tokenScopeRead]].

Proporcione el token a `arkvoryctl` en un archivo privado. Consulte [Línea de comandos](../protocols/cli#connect-to-a-server).

## Cuentas de servicio y claves para CI {#service-accounts}

Una cuenta de servicio es una identidad para una herramienta, no para una persona. Tiene una **política**: los repositorios y las acciones que puede usar. Una cuenta de servicio tiene claves. Cada clave tiene también su propia lista de repositorios y acciones. Los derechos efectivos son la intersección de las dos listas, acción por acción. Una política vacía no da acceso a los archivos.

El acceso de servicio se administra con la clave de recuperación o con una clave de operador a la que el propietario delegó derechos. En la consola:

1. Si tiene una sesión iniciada, seleccione [[ui:disconnect]]. Después abra [[ui:keySignIn]], pegue la clave de recuperación en el campo [[ui:serviceKey]] y seleccione [[ui:connect]].
2. Abra [[ui:services]]. La sección aparece solo con la clave de recuperación y con las claves de operador.

### Crear una cuenta y su política {#service-policy}

1. En [[ui:services]], expanda [[ui:serviceCreate]].
2. Rellene el campo [[ui:serviceName]] (de 3 a 64 caracteres, entre letras, dígitos, `.`, `_` y `-`).
3. En [[ui:servicePolicy]], seleccione [[ui:bindingAdd]] y escriba el nombre del [[ui:repository]].
4. Defina los permisos: [[ui:bindingRead]] y [[ui:bindingPublish]] establecen conjuntos habituales, [[ui:bindingNone]] los borra y [[ui:bindingPermissions]] enumera todas las acciones. Seleccione [[ui:bindingRemove]] para descartar un repositorio.
5. Seleccione [[ui:serviceCreate]].

Los dos conjuntos predefinidos son:

| Conjunto              | Acciones                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [[ui:bindingRead]]    | `repository.read`, `artifact.read`, `artifact.list`, `content.read`, `package.read`, `asset.read`, `annotation.read`                                                                 |
| [[ui:bindingPublish]] | El conjunto de lectura y además `upload.create`, `upload.read`, `upload.write`, `upload.complete`, `upload.cancel`, `job.read`, `package.publish`, `asset.write`, `annotation.write` |

Ninguno de los dos conjuntos incluye promoción, restauración ni eliminación. Agregue `artifact.promote` para una tarea de promoción. Un agente de despliegue que solo descarga necesita el conjunto de lectura para `arkvoryctl`. Para una descarga HTTP simple de un paquete por nombre, basta con `content.read`.

Una política tiene como máximo 64 repositorios y una instalación admite como máximo 1000 cuentas de servicio. Una política guardada tiene una versión. Si alguien la cambia entretanto, la consola muestra un conflicto y conserva su borrador: seleccione [[ui:serviceRefresh]] y aplique de nuevo su cambio. [[ui:serviceDisable]] bloquea todas las claves de la cuenta. Las transferencias que ya están en curso pueden terminar.

### Emitir, guardar y activar una clave {#service-key-issue}

1. Abra la cuenta y su apartado [[ui:serviceKeys]].
2. Expanda [[ui:keyIssue]]. Rellene el campo [[ui:keyName]]. Indique la caducidad en [[ui:keyExpiry]] o déjelo vacío para que sean 90 días. La caducidad máxima es de 365 días.
3. Restrinja los permisos si la clave necesita menos que la cuenta. Seleccione [[ui:keyIssue]].
4. La ventana [[ui:keySecret]] muestra el secreto una sola vez. Seleccione [[ui:keyCopy]] y guárdelo en el almacén de secretos de su CI. El secreto empieza por `arkvory_`.
5. Marque la casilla [[ui:keySaved]] y seleccione [[ui:keyActivate]].

Una clave que no se activa no sirve y caduca a los 15 minutos. Aparece como [[ui:keyPending]] hasta que la active. Una cuenta puede tener a la vez 3 claves activas y 2 pendientes. Los estados son [[ui:keyPending]], [[ui:keyActive]], [[ui:keyRevoked]] y [[ui:keyExpired]]; [[ui:keyDetails]] muestra el ID y los permisos de una clave.

Si se pierde la respuesta antes de que copie el secreto, el servidor no puede mostrarlo de nuevo. Revoque la clave y emita otra.

Con la API, la clave de recuperación crea la cuenta y después emite la clave. La cabecera `Idempotency-Key` (de 1 a 128 caracteres, entre letras, dígitos, `.`, `_`, `:` y `-`) hace que repetir la solicitud sea seguro, pero la repetición no devuelve ningún secreto. La clave se activa a sí misma cuando llama a `activateServiceKey`:

```bash
curl -X POST "$ARKVORY/api/v1/service-accounts" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" \
  -d '{"name":"ci-prod","bindings":[{"resource":{"kind":"repository","id":"releases"},"actions":["repository.read","artifact.read","artifact.list","content.read","package.read","upload.create","upload.read","upload.write","upload.complete","job.read","package.publish","asset.read","asset.write"]}]}'

curl -X POST "$ARKVORY/api/v1/service-accounts/$ACCOUNT_ID/keys" \
  -H "Authorization: Bearer $RECOVERY_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: ci-prod-2026-10" \
  -d '{"name":"pipeline-2026","bindings":[{"resource":{"kind":"repository","id":"releases"},"actions":["content.read","package.read","artifact.read"]}]}'

curl -X POST "$ARKVORY/api/v1/auth/activate-key" -H "Authorization: Bearer $NEW_SECRET"
```

Los mismos pasos con el SDK:

```typescript
const account = await root.administration.services.create('ci-prod', bindings);
const issued = await root.administration.credentials.issue(account.id, requestId, {
  name: 'pipeline-2026',
  bindings,
});
if (!issued.secret) throw new Error('Lost response: revoke the key and issue another');
await saveToSecretStore(issued.secret);
await new ArkvoryClient(url, () => issued.secret ?? '').identity.activateKey();
```

Proporcione la clave activada al trabajo como `ARKVORY_TOKEN_FILE` o `ARKVORY_TOKEN`. Consulte el [ejemplo de CI](../protocols/cli#ci-example).

### Rotar y revocar {#service-key-rotate}

Rote una clave antes de que caduque, sin interrupciones:

1. Junto a la clave, seleccione [[ui:keyRotate]]. El formulario se rellena con los permisos de la clave anterior. Solo puede mantenerlos o reducirlos.
2. Emita la clave nueva, guarde su secreto y actívela.
3. Cambie sus trabajos al secreto nuevo.
4. Seleccione [[ui:keyRevoke]] en la clave anterior.

Al activar la clave nueva, la anterior queda limitada a 24 horas más como máximo, de modo que una clave antigua olvidada no siga vigente. Revocar es permanente y pide el nombre de la clave. Las solicitudes nuevas con esa clave se rechazan de inmediato. Las transferencias que ya están en curso pueden terminar. Con la API, las operaciones son `rotateServiceKey` y `revokeServiceKey`.

[[ui:serviceAudit]], en la cuenta, muestra quién emitió, activó, rotó y revocó claves, con la hora. No guarda secretos. El servidor conserva los últimos 100 000 eventos de todas las cuentas.

### Administración delegada {#delegation}

En el uso diario, no utilice la clave de recuperación. El propietario puede ceder partes de la administración de servicios a una **clave de operador** y mantener la clave de recuperación fuera de línea.

1. Con la clave de recuperación, cree para el operador una cuenta de servicio con una política vacía, y emita y active una clave para ella.
2. Abra [[ui:serviceKeys]] de esa cuenta y seleccione [[ui:delegations]] en la clave.
3. Expanda [[ui:delegationNew]]. Rellene el campo [[ui:delegationTarget]] con la cuenta que administrará el operador.
4. En [[ui:delegationActions]], marque las acciones que correspondan y, en [[ui:delegationCeiling]], defina lo máximo que el operador puede conceder en los repositorios.
5. Seleccione [[ui:delegationSave]].

Las siete acciones son:

| Acción                   | Etiqueta en la consola                   | El operador puede                  |
| ------------------------ | ---------------------------------------- | ---------------------------------- |
| `service-account.read`   | [[ui:permission.service-account.read]]   | Ver la cuenta                      |
| `service-account.manage` | [[ui:permission.service-account.manage]] | Habilitarla y deshabilitarla       |
| `policy.read`            | [[ui:permission.policy.read]]            | Leer su política                   |
| `policy.manage`          | [[ui:permission.policy.manage]]          | Reemplazar su política             |
| `credential.read`        | [[ui:permission.credential.read]]        | Enumerar sus claves                |
| `credential.manage`      | [[ui:permission.credential.manage]]      | Emitir, rotar y revocar sus claves |
| `service-audit.read`     | [[ui:permission.service-audit.read]]     | Leer su registro de actividad      |

Reglas:

- Todo lo que establece el operador debe permanecer dentro del límite máximo. Una clave que emite caduca, como muy tarde, cuando caduca la propia clave del operador.
- Un operador puede emitir claves para la cuenta de destino, así que trate la delegación como confianza en todo lo que permite el límite máximo.
- Un operador no puede administrar su propia cuenta ni delegar a su vez. Una cuenta no puede ser a la vez destino y operador.
- Quitar una delegación con [[ui:delegationRemove]] no revoca las claves que el operador ya activó. Revóquelas usted mismo.
- El operador ve sus propias asignaciones en [[ui:delegationOwn]].

Solo la clave de recuperación establece delegaciones. Las operaciones son `listServiceDelegations`, `setServiceDelegation` y `removeServiceDelegation`.

## Auditoría {#audit}

Los administradores pueden leer el registro de seguridad de la instalación: inicios de sesión y fallos, autorregistros, cambios y restablecimientos de contraseñas, cambios de usuarios, grupos y accesos, y creación y revocación de tokens. Cada entrada tiene la hora, el actor, el tipo de credencial, la dirección del cliente, el destino y el resultado (`success`, `failure` o `denied`). No contiene contraseñas ni secretos. El servidor conserva las entradas durante 365 días o hasta 1 000 000 de entradas, lo que ocurra primero.

La consola no tiene ninguna pantalla para este registro. Léalo con la API, con una sesión de administrador o con la clave de recuperación. Las páginas contienen 50 entradas de forma predeterminada y 100 como máximo, de la más reciente a la más antigua. Pase `next` como `after` para obtener la página siguiente.

```bash
curl -H "Authorization: Bearer $ADMIN_KEY" "$ARKVORY/api/v1/security/audit?limit=20"
```

```typescript
const page = await client.administration.security.audit({ limit: 20 });
```

El registro de actividad de una cuenta de servicio es independiente. Consulte [Emitir, guardar y activar una clave](#service-key-issue).

## Si el propietario no puede acceder {#recovery}

Cuando nadie puede iniciar sesión como administrador, use la clave de recuperación:

1. Lea la clave en el servidor: `config/bootstrap-token.txt`, en el directorio de la instalación. Solo un administrador del servidor puede hacerlo.
2. En la consola, abra [[ui:keySignIn]], pegue la clave en el campo [[ui:serviceKey]] y seleccione [[ui:connect]].
3. Abra [[ui:administration]]. Expanda [[ui:resetPassword]], elija la cuenta, escriba una [[ui:newPassword]] y seleccione [[ui:resetPassword]]. Si la cuenta aparece como deshabilitada, seleccione [[ui:enableUser]].
4. Inicie sesión con la contraseña nueva.

También puede crear un administrador nuevo con [[ui:createUser]] y marcar la casilla [[ui:administrator]].

El formulario [[ui:welcomeOwner]] funciona solo mientras la instalación no tiene cuentas. Más adelante, use la clave de recuperación para reparar cuentas, no para empezar de cero.

Si se pierde la propia clave de recuperación, el administrador del servidor sustituye el SHA-256 de la clave en `config/keys.json` y reinicia la API. Consulte [Seguridad](../operate/security).

## Páginas relacionadas {#related-pages}

- [La consola web](../guide/console)
- [Repositorios](./repositories)
- [Línea de comandos (arkvoryctl)](../protocols/cli)
- [Autenticación](../api/authentication) y la referencia de la API: [Cuentas e inicio de sesión](../api/reference/accounts), [Cuentas de servicio y claves](../api/reference/services)
- [Seguridad](../operate/security)
