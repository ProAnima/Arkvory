---
title: Etapas y promoción
description: 'Marque compilaciones con etapas, promuévalas a otro repositorio y deje que un agente de despliegue elija la compilación más reciente de una etapa.'
---

# Etapas y promoción

Una compilación pasa de CI a producción por pasos: probada, aprobada, publicada. Arkvory tiene dos herramientas para esto. Una **etapa** es una marca en una compilación, como `qa` o `release`. La **promoción** publica una compilación en otro repositorio sin volver a enviar los bytes. Use una u otra, o ambas a la vez.

## Etapas y repositorios {#concepts}

- Una **etapa** indica dónde se aprueba una compilación. Una compilación puede tener varias etapas, hasta 16. Las etapas pertenecen a una compilación en un repositorio. Solo las operaciones de etapas las cambian, y cada cambio queda en un diario con el autor y un comentario opcional.
- Una **promoción** copia o mueve una compilación de un repositorio a otro, por ejemplo de `dev` a `staging` a `prod`. La copia es un artefacto nuevo en el destino. No se sube ningún byte.
- Una **etiqueta** es solo un tag libre sin historial. Una etapa es la marca controlada en la que un despliegue puede confiar. Consulte [Archivos por ruta](./files#labels).

Un nombre de etapa tiene de 1 a 32 caracteres: letras minúsculas, dígitos, `.`, `_` o `-`, y empieza por una letra o un dígito. Una compilación con una etapa no se puede eliminar, y la retención la conserva. Quite primero la etapa.

## Añadir y quitar etapas {#stages}

En la consola, abra el artefacto en [[ui:metadata]]. La sección [[ui:promotionTitle]] muestra [[ui:stagesTitle]] con las etapas de la compilación. Introduzca un [[ui:stageName]] y, si lo desea, un [[ui:stageComment]], y después seleccione [[ui:stageAdd]]. Cada etapa tiene un botón para quitarla, y la consola pide confirmación: los despliegues que pidan esta etapa elegirán otra versión.

Las etapas también se muestran en el catálogo, como chips en cada fila, y en la columna [[ui:packageStages]] de [[ui:packages]].

```bash
arkvoryctl stages add 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 qa --comment "smoke passed" --repository dev
arkvoryctl stages list 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository dev
arkvoryctl stages remove 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 qa --repository dev
arkvoryctl stages artifacts --stage release --repository prod
```

`stages artifacts` lista cada compilación que tiene una etapa, o una etapa, 100 a la vez. Pase `next` como `--after`.

Con la API:

```bash
curl -X PUT "$ARKVORY/api/v1/repositories/dev/artifacts/$ID/stages/qa" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"comment":"smoke passed"}'
curl -X DELETE "$ARKVORY/api/v1/repositories/dev/artifacts/$ID/stages/qa" \
  -H "Authorization: Bearer $ARKVORY_KEY"
```

```typescript
await dev.stages.add(id, 'qa', 'smoke passed');
const { items } = await prod.stages.artifacts({ stage: 'release' });
```

Las operaciones son `setArtifactStage`, `removeArtifactStage`, `listArtifactStages` y `listStagedArtifacts`. Añadir una etapa que ya está no cambia nada: se conservan el primer momento y el comentario. Quitar una etapa que no está se realiza correctamente. Una compilación con 16 etapas rechaza otra con `409 stage_limit`.

## Promover a otro repositorio {#promote}

En la consola, abra el artefacto. El formulario [[ui:promoteTitle]] aparece cuando puede leer la compilación y puede promover a al menos otro repositorio. Elija el [[ui:promoteTarget]] entre esos repositorios. Introduzca las [[ui:promoteStages]] que se establecerán en el destino, separadas por comas, y un [[ui:promoteComment]]. Seleccione [[ui:promoteSubmit]]. Si ningún otro repositorio lo permite, la consola dice [[ui:promoteNoTargets]].

```bash
arkvoryctl promote 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository staging --to prod --stage release --comment CAB-142
arkvoryctl promote 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository staging --to prod --move
```

`--repository` es el origen y `--to` el destino. El resultado tiene el `repository` de destino, el nuevo `artifactId`, el `sourceArtifactId`, el `mode`, `created` y las `stages`.

```bash
curl -X POST "$ARKVORY/api/v1/repositories/staging/artifacts/$ID/promote" \
  -H "Authorization: Bearer $ARKVORY_KEY" -H "Content-Type: application/json" \
  -d '{"target":"prod","mode":"copy","stages":["release"],"comment":"CAB-142"}'
```

```typescript
await staging.promotions.promote(id, { target: 'prod', mode: 'copy', stages: ['release'] });
```

La respuesta es `201` para una copia nueva y `200` cuando el destino ya la tenía. La operación es `promoteArtifact`.

### Copiar o mover {#copy-move}

|                   | Copia (predeterminada)  | Traslado                                                                                                        |
| ----------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| Origen            | Permanece               | Se elimina en el mismo paso en que se publica la copia                                                          |
| Etapas del origen | Permanecen en el origen | Pasan a la copia, además de las etapas que indique                                                              |
| En la consola     |                         | Marque [[ui:promoteMove]]. La consola pide confirmación                                                         |
| Se bloquea cuando |                         | El origen todavía lo usa una referencia externa, una ruta de archivo o un enlace de adjunto. No se publica nada |

Lo que recibe la copia y lo que no:

- Recibe las etiquetas, los metadatos y las colecciones del origen, su identidad UPack y las etapas que indique. Es un artefacto nuevo con un ID nuevo. Su SHA-256 es el mismo.
- No recibe adjuntos ni punteros de ruta. Vuelva a vincularlos en el destino.
- No se sube ningún byte. En el mismo servidor, el archivo almacenado se comparte hasta que desaparece el último artefacto que lo usa.
- Cuenta contra la cuota del destino como una subida nueva.
- Repetir una promoción devuelve la misma copia. Si el destino ya tiene un paquete con el mismo grupo, nombre, versión y suma de comprobación, se devuelve ese artefacto. Con bytes distintos, el servidor responde `409 version_exists`.
- El destino debe ser distinto del origen. Un espejo no puede ser un destino, porque es de solo lectura. Consulte [Repositorios](./repositories#read-only).

Una promoción interrumpida deja una reserva de corta duración. Ejecute la misma promoción otra vez con la misma cuenta para continuar.

## Historial de promociones {#history}

La página del artefacto en la consola muestra [[ui:promotionHistory]], de la más antigua a la más reciente: quién añadió o quitó una etapa, quién copió o movió la compilación a otro repositorio y de dónde vino una copia recibida. [[ui:promotionMore]] carga las siguientes entradas.

```bash
arkvoryctl promotions history 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 --repository prod
arkvoryctl promotions journal --repository prod --after 120 --json
```

El diario de un repositorio es para CI. Consúltelo periódicamente con la última `sequence` que vio como `--after`, y obtiene los eventos nuevos en orden. Un evento tiene una `sequence`, la `action` (`stage.added`, `stage.removed`, `promoted` o `received`), la `stage`, el `mode`, el repositorio y el artefacto par, el `actor`, el `comment` y el momento. Las páginas contienen hasta 100 eventos. Las operaciones son `listArtifactPromotions` y `listRepositoryPromotions`.

## Elegir una compilación para el despliegue {#resolve}

Un agente de despliegue pide «la compilación más reciente del paquete `app` que esté en el rango `^1.4` y tenga la etapa `release`». Arkvory responde con exactamente una versión, o con `404` si no hay ninguna.

```bash
arkvoryctl packages resolve app --group acme/game --range ^1.4 --stage release --repository prod --json
arkvoryctl packages download app ./app.upack --group acme/game --range ^1.4 --stage release --repository prod
```

`resolve` imprime la elección sin descargarla:

```json
{
  "group": "acme/game",
  "name": "app",
  "version": "1.4.7",
  "artifactId": "3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11",
  "sha256": "…",
  "size": "73400320",
  "publishedAt": "2026-10-01T09:30:00.000Z",
  "stagedAt": "2026-10-02T12:00:00.000Z",
  "stages": ["qa", "release"]
}
```

Con HTTP, `resolvePackage` devuelve esto, y `downloadPackageContent` envía los bytes de la misma elección en una sola llamada:

```bash
curl -fL -G -H "Authorization: Bearer $DEPLOY_KEY" -o app.upack \
  --data-urlencode "name=app" --data-urlencode "group=acme/game" \
  --data-urlencode "range=^1.4" --data-urlencode "stage=release" \
  "$ARKVORY/api/v1/repositories/prod/packages/content"
```

```typescript
const found = await prod.packages.resolve({ name: 'app', range: '^1.4', stage: 'release' });
```

Los filtros son los mismos en todas las herramientas: el `name` del paquete, el `group` (vacío si el paquete no tiene ninguno), una versión exacta o un rango, la `stage`, si se incluyen prelanzamientos y el orden. Los rangos se explican en [Paquetes UPack](./packages#versions).

De forma predeterminada gana la versión SemVer más reciente. Con `--order promoted` (`order=promoted` en HTTP) gana la versión que se marcó con etapa más recientemente, aunque su número sea menor. Esto necesita una etapa.

El nombre se resuelve en cada solicitud, así que dos llamadas pueden devolver compilaciones distintas si alguien promueve entre medias. Para una descarga que deba reanudarse, tome el `artifactId` de `resolve` y descárguelo.

## Revertir {#rollback}

Con el orden `promoted`, revertir es un paso normal. Quite la etapa de la versión defectuosa, y la versión marcada antes que ella pasa a ser la elección. Para que una versión anterior vuelva a ser la actual, quítele la etapa y añádala otra vez: añadir una etapa que ya está no renueva su momento.

```bash
arkvoryctl stages remove <faulty artifact id> release --repository prod
arkvoryctl packages download app ./app.upack --stage release --order promoted --repository prod
```

## Permisos {#permissions}

| Acción                                            | Claves: acciones de repositorio                                       | Personas: acceso de grupo                     |
| ------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------- |
| Leer las etapas y el historial de una compilación | `artifact.read`                                                       | Lectura                                       |
| Listar compilaciones con etapa y el diario        | `artifact.list`                                                       | Lectura                                       |
| Añadir o quitar una etapa                         | `artifact.promote` con `artifact.read`                                | Escritura                                     |
| Promover con copia                                | Origen: `artifact.read` y `content.read`. Destino: `artifact.promote` | Lectura en el origen, escritura en el destino |
| Promover con traslado                             | Lo mismo, y `artifact.promote` en el origen                           | Escritura en ambos                            |
| Resolver una versión                              | `package.read`                                                        | Lectura                                       |
| Descargar por nombre la versión elegida           | `content.read`                                                        | Lectura                                       |

Una clave para un agente de despliegue que solo descarga necesita `content.read` en el repositorio que lee. Para `arkvoryctl packages download` también necesita `package.read` y `artifact.read`. Consulte [Permisos](./accounts#permissions).

Los servidores también pueden intercambiar compilaciones por su cuenta: un repositorio puede importar, desde un repositorio de otro servidor, las versiones que llevan ciertas etapas. Consulte [Espejos](../operate/mirrors).

## Páginas relacionadas {#related-pages}

- [Paquetes UPack](./packages) y [Repositorios](./repositories)
- [Cuentas y acceso](./accounts)
- [Línea de comandos (arkvoryctl)](../protocols/cli#packages-and-promotion)
- Referencia de la API: [Etapas y promoción](../api/reference/promotion)
