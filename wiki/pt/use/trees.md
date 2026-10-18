---
title: Árvores de diretórios
description: Publique um diretório como um único arquivo compactado, baixe-o em uma pasta, compare uma pasta com ele e repare somente os arquivos que diferem.
---

# Árvores de diretórios

Um agente de implantação ou um job de CI muitas vezes precisa de um diretório inteiro: um build de jogo, um conjunto de ferramentas, uma árvore de configuração. `arkvoryctl tree` publica um diretório como um único artefato ZIP, baixa-o em uma pasta, compara uma pasta com ele e repara somente os arquivos que diferem. O artefato é um arquivo ZIP comum: o console, a API e qualquer ferramenta de ZIP o leem, e os backups o guardam como qualquer outro artefato.

Esses comandos fazem parte do núcleo gratuito. Eles precisam das mesmas permissões que os uploads e downloads: veja [Uploads e downloads](./transfers).

## Publicar um diretório {#push}

```bash
arkvoryctl tree push ./Build/Game --name game-1.4.zip --label release
```

| Opção                  | Significado                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `--name NAME.zip`      | Nome do artefato. Padrão: o nome da pasta com `.zip`. O nome deve terminar com `.zip`.  |
| `--label TAG`          | Um rótulo para o artefato                                                               |
| `--file METADATA.json` | Rótulos e metadados, como em `upload`                                                   |
| `--compress`           | Compacta as entradas (deflate). Sem essa opção, os arquivos são armazenados como estão. |

O resultado mostra o `id` do artefato, seu `size`, seu `sha256` e o número de arquivos em `entries`.

- **A mesma pasta gera o mesmo arquivo compactado.** Os arquivos ficam na ordem dos caminhos, cada entrada tem a data 1980-01-01 e só uma propriedade do sistema de arquivos é mantida: um arquivo que o proprietário pode executar recebe o modo 755, qualquer outro recebe 644. Publicar de novo uma pasta inalterada gera os mesmos bytes e o mesmo SHA-256.
- **Interrupções.** O arquivo compactado é montado ao lado da pasta (`.<folder>.arkvory-tree.zip`) e enviado em partes com um checkpoint. Depois de Ctrl+C ou de uma falha de rede, execute o mesmo comando novamente: ele monta o mesmo arquivo compactado e continua o upload. Os dois arquivos são removidos depois do sucesso.
- **O que é recusado.** Links simbólicos, junções (junctions), dispositivos e pipes dentro da pasta (`tree_entry_unsupported`), nomes que o Windows não aceita (`unsafe_name`) e dois nomes que diferem só em maiúsculas e minúsculas (`case_collision`). Pastas vazias não são mantidas.
- **Armazenado ou compactado.** Sem `--compress`, os bytes de cada arquivo formam um intervalo contínuo do arquivo compactado. Assim o servidor pode entregar um arquivo por um intervalo de bytes, e os reparos transferem exatamente os bytes dos arquivos que diferem. Com `--compress`, o arquivo compactado fica menor e um arquivo reparado é descompactado na sua máquina.

## Baixar um diretório {#pull}

```bash
arkvoryctl tree pull 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game
```

- **Uma pasta vazia ou inexistente** recebe o arquivo compactado inteiro. Ele é baixado ao lado da pasta com checkpoints, então um download interrompido continua de onde parou. Depois que o SHA-256 é verificado, os arquivos são extraídos em uma nova pasta ao lado do destino, que então toma o lugar do destino.
- **Uma pasta com arquivos** passa a ser a árvore. Quando o servidor tem o [índice](#table-of-contents), só os arquivos que diferem são baixados, cada um pelo seu intervalo de bytes, e os arquivos que a árvore não tem são removidos. Sem índice, o arquivo compactado inteiro é baixado, e a pasta extraída substitui a antiga.

A pasta pai deve existir. Um arquivo dentro do destino é substituído em um único passo: ele é gravado em um arquivo temporário ao lado, verificado e renomeado. Um programa que lê o arquivo vê a versão antiga ou a nova.

## Verificar um diretório {#verify}

```bash
arkvoryctl tree verify 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game
```

O resultado lista os arquivos ausentes (`missing`), os divergentes (`mismatched`: outro tamanho ou outro SHA-256) e os arquivos extras que a árvore não tem (`extra`), com as quantidades em `counts`. Cada lista mostra no máximo 1000 caminhos. `ok` é `true` quando nada está ausente nem divergente; arquivos extras não o alteram. O código de saída é 0 quando `ok` é true e 5 caso contrário.

## Reparar um diretório {#repair}

```bash
arkvoryctl tree repair 3b0c0b8e-6a4e-4f5f-9d3b-5a6c1c9b0f11 ./Game
```

O reparo grava de novo todos os arquivos ausentes e divergentes e mantém os extras. Com índice, ele baixa só as entradas desses arquivos; `fetchedBytes` no resultado informa quantos bytes do arquivo compactado foram lidos. Sem índice, ele baixa primeiro o arquivo compactado inteiro.

## O índice {#table-of-contents}

Depois que um arquivo compactado é publicado, o worker do servidor o lê uma vez e registra cada arquivo: caminho, tamanho, SHA-256 e onde ficam seus bytes no arquivo compactado. Isso acontece para artefatos cujo nome termina com `.zip` ou `.upack`. Até que isso termine, ou quando o arquivo compactado não pode ser indexado, os comandos trabalham com o arquivo compactado inteiro.

Um servidor que tem o índice oferece `zip-tree` em `tree` de `GET /api/v1/capabilities` (veja `arkvoryctl doctor`); com um servidor mais antigo, os comandos usam o arquivo compactado inteiro. O índice em si é a operação [getArtifactTree](../api/reference/artifacts#getArtifactTree): `status` é `ready`, `pending` ou `unavailable` com um `reason`.

| `reason`             | Significado                                                                           |
| -------------------- | ------------------------------------------------------------------------------------- |
| `not_archive`        | O nome do artefato não termina com `.zip` nem `.upack`                                |
| `invalid_archive`    | O arquivo não é um arquivo ZIP legível                                                |
| `unsafe_entry`       | Um caminho sai do arquivo compactado, ou uma entrada é um link ou um arquivo especial |
| `encrypted_entry`    | Uma entrada está criptografada                                                        |
| `duplicate_entry`    | Duas entradas têm o mesmo caminho, também ignorando maiúsculas e minúsculas           |
| `unsupported_method` | Uma entrada usa um método de compactação diferente de stored ou deflate               |
| `crc_mismatch`       | Os bytes de uma entrada não correspondem à sua soma de verificação no arquivo         |
| `too_many_entries`   | Mais de 100.000 entradas                                                              |
| `too_large`          | Mais de 100 GiB descompactado                                                         |

## Como os arquivos são verificados {#checks}

- **Cada arquivo é verificado antes de tomar o seu lugar.** Com índice, o tamanho e o SHA-256 devem corresponder aos valores que o servidor calculou a partir do arquivo compactado publicado. Sem índice, primeiro é verificado o SHA-256 do arquivo compactado inteiro e depois o tamanho e o CRC-32 de cada arquivo. Uma divergência interrompe o comando com `checksum_mismatch` (código de saída 5), e o arquivo na pasta fica como estava.
- **Nada é gravado fora da pasta.** Os caminhos lidos do arquivo compactado e recebidos do servidor são tratados como dados não confiáveis. Um caminho que sai da pasta é recusado com `path_outside_root`. Um link dentro da pasta no caminho até um arquivo nunca é seguido. Nomes que o Windows não aceita (`CON`, `aux.txt`, `a:b`, um ponto ou espaço no final) são recusados com `unsafe_name` em todos os sistemas, para que uma árvore signifique o mesmo no Windows e no Linux.
- **Modos.** Um arquivo extraído do arquivo compactado recebe o modo 755 se o arquivo compactado o marca como executável e, caso contrário, 644 (Linux e macOS). Um arquivo reparado por intervalo mantém o modo do arquivo que ele substitui.

## Transferências mais rápidas {#extensions}

O upload do arquivo compactado inteiro em `tree push` e o download em `tree pull` passam pela mesma transferência que `upload` e `download`. Um [módulo de cliente](../protocols/cli#client-modules) com uma extensão de transferência pode realizá-los quando o servidor oferece a mesma extensão; o arquivo compactado continua sendo um ZIP comum, e o SHA-256 dele e cada arquivo são verificados como descrito acima. Sem módulo, ou quando o servidor não a oferece, o `arkvoryctl` usa a sua própria transferência.

## Páginas relacionadas {#related-pages}

- [Uploads e downloads](./transfers)
- [Linha de comando](../protocols/cli)
- [Referência de artefatos](../api/reference/artifacts)
