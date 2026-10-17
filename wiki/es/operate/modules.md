---
title: Módulos
description: Instale paquetes de módulos firmados en un host, compruébelos, elimínelos y guarde las claves de los autores de plugins en los que confía.
---

# Módulos

Un paquete de módulo añade una función a Arkvory. Arkvory solo instala paquetes cuya firma puede verificar. Los comandos de esta página se ejecutan en el host de la instalación, como root en Linux o como administrador en Windows. La consola y la API HTTP no pueden instalar módulos ni confiar en claves, así que una cuenta de administrador de la consola robada no permite ejecutar código en el servidor.

Esta versión guarda y verifica paquetes de módulos. Los servicios todavía no ejecutan código de módulos: una versión posterior cargará los módulos instalados.

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

Límites: 1 GiB por paquete, 256 MiB por archivo, 4096 archivos. Un paquete mayor se rechaza antes de leer sus datos.

Una versión ya instalada con los mismos bytes se deja como está. La misma versión con otros bytes se rechaza.

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

El comando vuelve a verificar cada paquete instalado, como harán los servicios antes de cargarlo: la firma, cada archivo y el archivo comprimido. Cada módulo muestra un estado:

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
