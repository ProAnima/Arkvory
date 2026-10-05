---
title: Paquetes UPack
description: 'Publique paquetes UPack con versiones, lístelos y fíltrelos, y descargue una versión por número exacto, rango, más reciente o etapa.'
---

# Paquetes UPack

Un paquete UPack es un archivo ZIP con un nombre y una versión SemVer. Arkvory registra cada versión una vez y nunca la cambia. Un trabajo de despliegue pide «app, versión `^1.4`, etapa `release`» y obtiene exactamente un archivo.

## Qué es un paquete {#what-it-is}

Un UPack es un archivo ZIP con un archivo `upack.json` en su raíz. El manifiesto nombra el paquete:

```json
{
  "group": "acme/game",
  "name": "game-client",
  "version": "1.4.2"
}
```

| Campo     | Regla                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `name`    | Obligatorio. 1 a 128 letras, dígitos, `.`, `_` o `-`                                                                                 |
| `version` | Obligatorio. SemVer: `1.4.2`, `1.5.0-rc.1`, `2.0.0+build.7`. Como máximo 128 caracteres                                              |
| `group`   | Opcional. Segmentos de letras, dígitos, `.`, `_` o `-`, separados por `/`. Como máximo 128 caracteres. Vacío de forma predeterminada |

Los demás campos permanecen tal como los escribió y vuelven a aparecer en la lista de paquetes. El manifiesto ocupa como máximo 64 KiB. El archivo no debe contener rutas absolutas, `..`, enlaces simbólicos, entradas cifradas ni nombres duplicados, y tiene como máximo 100 000 entradas. Arkvory almacena el archivo byte a byte y no lo descomprime.

La identidad de un paquete es su grupo, nombre y versión, comparados sin distinguir mayúsculas de minúsculas. Dentro de un repositorio, una identidad pertenece a un archivo para siempre. Registrar un archivo distinto bajo una identidad existente se rechaza con `409 version_exists`. Volver a registrar el mismo archivo es seguro y no cambia nada. Publique una corrección como una versión nueva.

## Publicar un paquete {#publish}

Publicar es una subida seguida de un registro. El registro lee `upack.json` y anota la identidad. Necesita las acciones `package.publish` y `artifact.read`, además de las acciones de subida. Consulte [Permisos](./accounts#permissions).

### En la consola {#publish-console}

1. Suba el archivo en [[ui:upload]]. Consulte [Subidas y descargas](./transfers).
2. Abra el artefacto en [[ui:catalog]] con [[ui:open]].
3. En [[ui:metadata]] seleccione [[ui:register]]. La consola muestra el nombre y la versión que registró.

El paquete aparece ahora en [[ui:packages]].

### Con arkvoryctl {#publish-cli}

```bash
arkvoryctl packages publish ./build.upack --label test --state ./job-state/build.json --json
arkvoryctl packages register 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11
```

`packages publish` sube el archivo con reanudación y lo registra. Si el registro falla después de la subida, el error contiene el `artifactId` y la etapa `register`. Ejecute el mismo comando otra vez: la subida no se repite y registrar dos veces es seguro. `packages register ID` registra un artefacto que ya está subido. Consulte [Línea de comandos](../protocols/cli#packages-and-promotion).

### Con la API HTTP y el SDK {#publish-api}

Suba el archivo como en [Subidas y descargas](./transfers#upload-http) y después regístrelo:

```bash
curl -X POST "$ARKVORY/api/v1/repositories/releases/artifacts/$ID/package" \
  -H "Authorization: Bearer $ARKVORY_KEY"
```

```typescript
const entry = await releases.packages.register(uploaded.id);
console.log(entry.group, entry.name, entry.version);
```

La operación es `registerPackage`. Un archivo dañado, un `upack.json` ausente o una versión incorrecta dan `400 invalid_input`.

## Listar y filtrar {#list}

En la consola abra [[ui:packages]]. Escriba un [[ui:packageGroup]] o un [[ui:packageName]]: ambos coinciden exactamente, sin distinguir mayúsculas de minúsculas. Elija una columna en [[ui:sortBy]], un orden en [[ui:direction]] ([[ui:ascending]] o [[ui:descending]]) y una agrupación en [[ui:groupBy]] ([[ui:packageGroup]], [[ui:packageName]] o [[ui:noGrouping]]), y después seleccione [[ui:apply]]. [[ui:clearFilters]] restablece el formulario. La tabla muestra el grupo, el nombre, la versión y las etapas de cada versión. [[ui:open]] muestra el artefacto. [[ui:previousPage]] y [[ui:nextPage]] se mueven entre páginas.

```bash
arkvoryctl packages list --group acme/game --name game-client
arkvoryctl packages list --after <next from the previous answer>
```

Con la API, `listPackages` acepta `group`, `name`, `sort` (`group`, `name` o `version`), `direction` (`asc` o `desc`), `groupBy` (`none`, `group` o `package`), `after` y `limit` (1 a 100, 50 de forma predeterminada). La respuesta tiene `items` (grupo, nombre, versión, `artifactId` y el manifiesto completo), `groups` y `next`. Un cursor pertenece a los filtros de los que proviene. Úselo solo con los mismos filtros.

```typescript
const page = await releases.packages.list({
  name: 'game-client',
  sort: 'version',
  direction: 'desc',
});
```

Listar necesita `package.read`. Para buscar por etiquetas o metadatos, consulte [Archivos por ruta](./files#labels).

## Versiones y rangos {#versions}

Arkvory compara las versiones por precedencia SemVer. `1.10.0` es más reciente que `1.9.0`. Una versión con una parte de prelanzamiento, como `1.5.0-rc.1`, es anterior a `1.5.0`.

Una selección toma un `name` de paquete y, opcionalmente, estos filtros:

| Filtro         | Significado                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `group`        | El grupo. Vacío de forma predeterminada: un paquete que tiene grupo se encuentra solo cuando lo indica |
| versión exacta | Una versión. No se distingue mayúsculas de minúsculas                                                  |
| rango          | Un rango SemVer                                                                                        |
| `stage`        | Solo las versiones que llevan esta etapa (consulte [Etapas y promoción](./promotion))                  |
| prelanzamiento | Incluir prelanzamientos. Desactivado de forma predeterminada                                           |
| orden          | `version` (predeterminado) o `promoted`                                                                |

Los rangos se pueden escribir como `1.2.3`, `^1.2`, `~1.2.3`, `1.x`, `>=1.0.0 <2.0.0`, `1.0.0 - 1.4.0` y `^1 || ^3`. Un rango ocupa como máximo 256 caracteres. Una versión exacta y un rango no se pueden combinar.

Sin una versión exacta ni un rango, la selección devuelve la versión estable más alta, que es la más reciente. Los prelanzamientos se eligen solo con el filtro de prelanzamiento activado, o cuando la versión exacta o el propio rango nombran un prelanzamiento del mismo `major.minor.patch`. `order promoted` elige la versión que se marcó con etapa más recientemente, no la más alta, y necesita una etapa. Si nada coincide, el servidor responde `404 not_found`.

## Descargar un paquete {#download}

Resuelva primero si quiere ver lo que obtiene, o descargue directamente.

```bash
arkvoryctl packages resolve game-client --group acme/game --range ^1.4 --stage release
arkvoryctl packages download game-client ./game-client.upack --group acme/game --range ^1.4 --stage release
arkvoryctl packages download game-client ./game-client.upack --exact 1.4.2 --group acme/game
arkvoryctl packages download game-client ./game-client.upack --group acme/game
```

Las opciones son `--group`, `--exact`, `--range`, `--stage`, `--prerelease` y `--order promoted`. Use `--exact` para una versión exacta, porque `--version` imprime la versión del cliente. `resolve` imprime el grupo, el nombre, la versión, `artifactId`, `sha256`, `size`, `publishedAt`, `stagedAt` y las etapas. `download` resuelve y después descarga ese artefacto con reanudación y una comprobación SHA-256, como en [Subidas y descargas](./transfers#download-cli). El cliente necesita `package.read`, `artifact.read` y `content.read`.

Con HTTP hay dos operaciones. `resolvePackage` necesita `package.read` y devuelve los mismos datos que `resolve`. `downloadPackageContent` envía los bytes de la versión elegida y necesita solo `content.read`. Agrega las cabeceras `X-Arkvory-Artifact-Id` y `X-Arkvory-Package-Version`.

```bash
curl -fL -G -H "Authorization: Bearer $ARKVORY_KEY" -o game-client.upack \
  --data-urlencode "name=game-client" --data-urlencode "group=acme/game" \
  --data-urlencode "range=^1.4" --data-urlencode "stage=release" \
  "$ARKVORY/api/v1/repositories/prod/packages/content"
```

La dirección por nombre se resuelve en cada solicitud. Si reanuda una descarga con un rango, el archivo puede haber cambiado entre las dos llamadas. Descargue el `artifactId` de `resolve` en su lugar, o envíe el `ETag` en `If-Range`.

```typescript
const found = await prod.packages.resolve({
  name: 'game-client',
  group: 'acme/game',
  range: '^1.4',
  stage: 'release',
});
const stream = await prod.artifacts.downloadVerified(found.artifactId);
```

Un agente de despliegue que solo debe obtener compilaciones recibe una clave de servicio con `content.read` únicamente para la dirección HTTP, o el preajuste de lectura para `arkvoryctl`. Consulte [Cuentas de servicio y claves para CI](./accounts#service-accounts).

## Etiquetas, metadatos y adjuntos {#labels}

Una versión de paquete es un artefacto normal, así que todo lo de [Archivos por ruta](./files#labels) se aplica a ella: etiquetas como `test`, `staging` y `release`, metadatos de texto como `git.commit`, colecciones y adjuntos como un SBOM o una firma. Establezca las primeras etiquetas al subir con `--label test`. Las etiquetas no cambian nada del archivo. Son texto libre, no un estado controlado. Para una aprobación en la que un despliegue pueda confiar, use una etapa. Consulte [Etapas y promoción](./promotion).

## Conservar versiones antiguas {#retention}

Los paquetes registrados son lo que cuenta la política de retención de un repositorio. De forma predeterminada, cuando está activada, conserva las últimas 10 compilaciones de cada paquete y canal. Un canal es la etiqueta `test`, `staging` o `release`. Una versión con una etapa, una etiqueta protegida, una ruta de archivo o un enlace de adjunto nunca se elimina por la retención. La retención está desactivada hasta que un administrador la activa y acepta la eliminación. Consulte [Almacenamiento y retención](../operate/storage).

## Errores {#errors}

| Respuesta                        | Significado                                                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400 invalid_input` al registrar | No es un ZIP UPack válido, no hay `upack.json` en la raíz, o un nombre o versión incorrectos                                                                  |
| `409 version_exists`             | La identidad ya pertenece a otro archivo. Publique una versión nueva. Promover a un repositorio que tiene la versión con otros bytes falla de la misma manera |
| `404 not_found` al resolver      | Nada coincide con los filtros. Compruebe el grupo, el rango y la etapa                                                                                        |
| `403 permission_missing`         | A la clave le falta `package.read`, `package.publish` o `content.read`                                                                                        |

## Páginas relacionadas {#related-pages}

- [Subidas y descargas](./transfers)
- [Etapas y promoción](./promotion)
- [Línea de comandos (arkvoryctl)](../protocols/cli)
- Referencia de la API: [Paquetes](../api/reference/packages), [Etapas y promoción](../api/reference/promotion)
