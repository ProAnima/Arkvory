---
title: Árboles de directorios
description: Publique un directorio como un único archivo comprimido, obténgalo en una carpeta, compare una carpeta con él y repare solo los archivos que difieren.
---

# Árboles de directorios

Un agente de despliegue o un trabajo de CI a menudo necesita un directorio completo: una compilación de un juego, un conjunto de herramientas, un árbol de configuración. `arkvoryctl tree` publica un directorio como un único artefacto ZIP, lo obtiene en una carpeta, compara una carpeta con él y repara solo los archivos que difieren. El artefacto es un archivo ZIP corriente: lo leen la consola, la API y cualquier herramienta ZIP, y las copias de seguridad lo conservan como cualquier otro artefacto.

Estos comandos forman parte del núcleo gratuito. Necesitan los mismos permisos que las subidas y las descargas: consulte [Subidas y descargas](./transfers).

## Publicar un directorio {#push}

```bash
arkvoryctl tree push ./Build/Game --name game-1.4.zip --label release
```

| Opción                 | Significado                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `--name NAME.zip`      | Nombre del artefacto. Por defecto, el nombre de la carpeta con `.zip`. El nombre debe terminar en `.zip`. |
| `--label TAG`          | Una etiqueta para el artefacto                                                                            |
| `--file METADATA.json` | Etiquetas y metadatos, como en `upload`                                                                   |
| `--compress`           | Comprime las entradas (deflate). Sin esta opción, los archivos se guardan tal como están.                 |

El resultado muestra el `id` del artefacto, su `size`, su `sha256` y el número de archivos en `entries`.

- **La misma carpeta produce el mismo archivo comprimido.** Los archivos van en orden de ruta, cada entrada lleva la fecha 1980-01-01 y solo se conserva una propiedad del sistema de archivos: un archivo que su propietario puede ejecutar recibe el modo 755 y cualquier otro, el 644. Volver a publicar una carpeta sin cambios produce los mismos bytes y el mismo SHA-256.
- **Interrupciones.** El archivo comprimido se genera junto a la carpeta (`.<folder>.arkvory-tree.zip`) y se sube por partes con un punto de control. Tras Ctrl+C o un fallo de red, ejecute de nuevo el mismo comando: genera el mismo archivo comprimido y continúa la subida. Ambos archivos se eliminan cuando termina con éxito.
- **Qué se rechaza.** Los enlaces simbólicos, las uniones (junctions), los dispositivos y las canalizaciones dentro de la carpeta (`tree_entry_unsupported`), los nombres que Windows no admite (`unsafe_name`) y dos nombres que solo difieren en mayúsculas y minúsculas (`case_collision`). Las carpetas vacías no se conservan.
- **Sin comprimir o comprimido.** Sin `--compress`, los bytes de cada archivo forman un rango continuo del archivo comprimido. Así el servidor puede servir un archivo por un rango de bytes, y las reparaciones transfieren exactamente los bytes de los archivos que difieren. Con `--compress` el archivo comprimido es más pequeño y un archivo reparado se descomprime en su equipo.

## Obtener un directorio {#pull}

```bash
arkvoryctl tree pull 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game
```

- **Una carpeta vacía o inexistente** recibe el archivo comprimido completo. Se descarga junto a la carpeta con puntos de control, de modo que una obtención interrumpida continúa donde se detuvo. Una vez verificado su SHA-256, los archivos se extraen en una carpeta nueva junto al destino, que después ocupa el lugar del destino.
- **Una carpeta con archivos** se convierte en el árbol. Cuando el servidor tiene el [índice](#table-of-contents), solo se descargan los archivos que difieren, cada uno por su rango de bytes, y se eliminan los archivos que el árbol no tiene. Sin índice se descarga el archivo comprimido completo, y la carpeta extraída sustituye a la anterior.

La carpeta principal debe existir. Un archivo dentro del destino se reemplaza en un solo paso: se escribe en un archivo temporal junto a él, se comprueba y se renombra. Un programa que lea el archivo ve la versión antigua o la nueva.

## Comprobar un directorio {#verify}

```bash
arkvoryctl tree verify 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game
```

El resultado enumera los archivos que faltan (`missing`), los que no coinciden (`mismatched`: otro tamaño u otro SHA-256) y los archivos sobrantes que el árbol no tiene (`extra`), con sus cantidades en `counts`. Cada lista muestra como máximo 1000 rutas. `ok` es `true` cuando no falta ni difiere nada; los archivos sobrantes no lo cambian. El código de salida es 0 cuando `ok` es true y 5 en caso contrario.

## Reparar un directorio {#repair}

```bash
arkvoryctl tree repair 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game
```

La reparación vuelve a escribir todos los archivos que faltan o no coinciden y conserva los sobrantes. Con índice descarga solo las entradas de esos archivos; `fetchedBytes` en el resultado indica cuántos bytes del archivo comprimido leyó. Sin índice descarga primero el archivo comprimido completo.

## El índice {#table-of-contents}

Después de publicar un archivo comprimido, el proceso de trabajo (worker) del servidor lo lee una vez y registra cada archivo: su ruta, su tamaño, su SHA-256 y dónde están sus bytes dentro del archivo comprimido. Esto se hace con los artefactos cuyo nombre termina en `.zip` o `.upack`. Hasta que termina, o cuando el archivo comprimido no se puede indexar, los comandos trabajan con el archivo comprimido completo.

Un servidor que tiene el índice ofrece `zip-tree` en `tree` de `GET /api/v1/capabilities` (consulte `arkvoryctl doctor`); con un servidor más antiguo, los comandos usan el archivo comprimido completo. El índice en sí es la operación [getArtifactTree](../api/reference/artifacts#getArtifactTree): `status` es `ready`, `pending` o `unavailable` con un `reason`.

| `reason`             | Significado                                                                            |
| -------------------- | -------------------------------------------------------------------------------------- |
| `not_archive`        | El nombre del artefacto no termina en `.zip` ni en `.upack`                            |
| `invalid_archive`    | El archivo no es un archivo ZIP legible                                                |
| `unsafe_entry`       | Una ruta sale del archivo comprimido, o una entrada es un enlace o un archivo especial |
| `encrypted_entry`    | Una entrada está cifrada                                                               |
| `duplicate_entry`    | Dos entradas tienen la misma ruta, también sin distinguir mayúsculas y minúsculas      |
| `unsupported_method` | Una entrada usa un método de compresión distinto de stored o deflate                   |
| `crc_mismatch`       | Los bytes de una entrada no coinciden con su suma de comprobación en el archivo        |
| `too_many_entries`   | Más de 100 000 entradas                                                                |
| `too_large`          | Más de 100 GiB sin comprimir                                                           |

## Cómo se comprueban los archivos {#checks}

- **Cada archivo se verifica antes de ocupar su lugar.** Con índice, su tamaño y su SHA-256 deben coincidir con los valores que el servidor calculó a partir del archivo comprimido publicado. Sin índice, primero se verifica el SHA-256 del archivo comprimido completo y después el tamaño y el CRC-32 de cada archivo. Una discrepancia detiene el comando con `checksum_mismatch` (código de salida 5), y el archivo de la carpeta queda como estaba.
- **No se escribe nada fuera de la carpeta.** Las rutas del archivo comprimido y del servidor se tratan como datos no fiables. Una ruta que sale de la carpeta se rechaza con `path_outside_root`. Un enlace dentro de la carpeta en el camino hacia un archivo nunca se sigue. Los nombres que Windows no admite (`CON`, `aux.txt`, `a:b`, un punto o un espacio final) se rechazan con `unsafe_name` en todos los sistemas, de modo que un árbol significa lo mismo en Windows y en Linux.
- **Modos.** Un archivo extraído del archivo comprimido recibe el modo 755 si el archivo comprimido lo marca como ejecutable y, si no, el 644 (Linux y macOS). Un archivo reparado por rango conserva el modo del archivo al que sustituye.

## Transferencias más rápidas {#extensions}

La subida del archivo comprimido completo de `tree push` y la descarga de `tree pull` pasan por la misma transferencia que `upload` y `download`. Un [módulo de cliente](../protocols/cli#client-modules) con una extensión de transferencia puede llevarlas a cabo cuando el servidor ofrece la misma extensión; el archivo comprimido sigue siendo un ZIP corriente, y su SHA-256 y cada archivo se comprueban como se describe arriba. Sin módulo, o cuando el servidor no la ofrece, `arkvoryctl` usa su propia transferencia.

## Páginas relacionadas {#related-pages}

- [Subidas y descargas](./transfers)
- [Línea de comandos](../protocols/cli)
- [Referencia de artefactos](../api/reference/artifacts)
