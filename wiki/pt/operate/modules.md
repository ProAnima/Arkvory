---
title: Módulos
description: Instale pacotes de módulos assinados em um host, verifique-os, remova-os e guarde as chaves dos autores de plugins em quem você confia.
---

# Módulos

Um pacote de módulo adiciona uma função ao Arkvory. O Arkvory instala apenas pacotes cuja assinatura ele consegue verificar. Os comandos desta página rodam no host da instalação, como root no Linux ou como administrador no Windows. O console e a API HTTP não instalam módulos nem confiam em chaves, então uma conta de administrador do console roubada não consegue executar código no servidor.

Esta versão armazena e verifica pacotes de módulos. Os serviços ainda não executam código de módulos: uma versão posterior carrega os módulos instalados.

## Instalar um pacote {#install}

1. Copie o arquivo do pacote `arkvory-module-<id>-<version>.tgz` para o host.
2. Verifique-o e leia os termos:

   ```bash
   sudo arkvory module install /root/arkvory-module-sample-1.0.0.tgz --root /opt/proanima-arkvory
   ```

   O comando mostra o módulo, seus papéis, os dados que ele guarda, a chave de assinatura e o SHA-256 do pacote e, depois, os termos do módulo. Nada muda ainda.

3. Instale-o:

   ```bash
   sudo arkvory module install /root/arkvory-module-sample-1.0.0.tgz --root /opt/proanima-arkvory --yes
   ```

O Arkvory recusa um pacote quando:

| Motivo                                                                                                         | Código na mensagem                                             |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A assinatura não é de uma chave de módulos da ProAnimaStudio, ou o manifesto mudou                             | `unknown_key`, `wrong_key_class`, `signature_invalid`          |
| Um arquivo falta, mudou ou não consta no manifesto                                                             | `file_missing`, `file_mismatch`, `file_unlisted`               |
| O arquivo compactado contém links, dispositivos, caminhos fora do pacote ou nomes que diferem só em maiúsculas | `link_entry`, `special_entry`, `unsafe_path`, `case_collision` |
| O arquivo compactado contém um complemento nativo (`.node`)                                                    | `native_addon`                                                 |
| O módulo precisa de outra versão do Arkvory                                                                    | `module_incompatible`                                          |
| A ProAnimaStudio revogou esta versão                                                                           | `module_revoked`, com a versão substituta                      |

Limites: 1 GiB por pacote, 256 MiB por arquivo, 4096 arquivos. Um pacote maior é recusado antes de seus dados serem lidos.

Uma versão já instalada com os mesmos bytes fica como está. A mesma versão com outros bytes é recusada.

## Atualizar, fixar e voltar a uma versão anterior {#versions}

Instale o arquivo da nova versão com `--yes`. O pacote anterior fica no host até a próxima mudança de módulos.

| Tarefa                          | Comando                                                         |
| ------------------------------- | --------------------------------------------------------------- |
| Manter a versão instalada       | `sudo arkvory module pin sample 1.0.0 --root …`                 |
| Permitir outras versões de novo | `sudo arkvory module pin sample --unpin --root …`               |
| Instalar uma versão mais antiga | `sudo arkvory module install <file> --downgrade --yes --root …` |

Um módulo fixado recusa qualquer outra versão até você liberá-lo. Uma versão mais antiga que a instalada, ou que uma removida cujo pacote ainda está no host, precisa de `--downgrade`.

## Verificar os módulos instalados {#list}

```bash
sudo arkvory module list --root /opt/proanima-arkvory
```

O comando verifica de novo cada pacote instalado, como os serviços farão antes de carregá-lo: a assinatura, cada arquivo e o arquivo compactado. Cada módulo mostra um estado:

| Estado               | Significado                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `ok`                 | O pacote está íntegro                                                                                                |
| `refused: <code>`    | Um arquivo foi alterado, adicionado ou trocado por um link (`file_mismatch`, `file_unlisted`, `link_entry` e outros) |
| `revoked (<reason>)` | A ProAnimaStudio revogou esta versão. `read path only` significa que seus dados continuam legíveis                   |

Um pacote recusado nunca é usado. Para repará-lo, instale o arquivo do pacote de novo.

## Remover um módulo {#remove}

```bash
sudo arkvory module remove sample --root /opt/proanima-arkvory
```

O módulo sai da instalação, e seu pacote fica no host até a próxima mudança de módulos. Um módulo que guarda os bytes dos arquivos publicados (dados `layout`) não pode ser removido: o Arkvory recusa com `module_owns_data`, para que seus dados nunca fiquem ilegíveis.

## Lista de revogação {#revocations}

A ProAnimaStudio publica uma lista assinada de versões de módulos revogadas. Cada lista tem um número, e o Arkvory nunca aceita uma lista com número menor que o da lista que já tem. Um pacote de módulo pode trazer uma lista mais nova: o Arkvory a guarda quando você instala o pacote. Em um host sem acesso ao hub, guarde você mesmo um arquivo de lista:

```bash
sudo arkvory module revocations /root/module-revocations.json --root /opt/proanima-arkvory
```

## Confiar em um autor de plugins {#trust}

Plugins da sua equipe ou de outro autor são assinados com a chave do autor. Adicione a chave à lista de confiança do host antes de instalar esses plugins. A lista de confiança pertence ao host: os serviços podem lê-la, mas não alterá-la.

1. Obtenha do autor o arquivo de chave pública (`.pub`, formato minisign) e sua impressão digital por outro canal.
2. Mostre a chave e compare a impressão digital:

   ```bash
   sudo arkvory module trust add /root/acme.pub --label "Acme platform team" --plugins "op-acme-*" --root /opt/proanima-arkvory
   ```

3. Adicione-a com `--yes`.

| Opção                | Significado                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `--label`            | Quem detém a chave; obrigatória                                                                                      |
| `--plugins`          | Ids de plugins que a chave pode assinar, separados por vírgulas: um id exato ou um prefixo com `*`. Padrão `op-*`    |
| `--expires`          | Hora UTC como `2027-01-31T00:00:00Z`. Depois dela, a chave não aceita novas instalações                              |
| `--allow-in-process` | Permite que os plugins da chave rodem dentro do processo do Arkvory. Esse código recebe todos os direitos do serviço |

Ids de plugins sempre começam com `op-`. Uma chave de plugins nunca assina módulos da ProAnimaStudio, e as chaves da ProAnimaStudio nunca assinam plugins `op-`. Uma chave que o host já conhece com outro id ou como chave de outro tipo é recusada (`duplicate_key`). As assinaturas devem ser prehash, o padrão das versões atuais do minisign; assinaturas legadas são recusadas com `signature_algorithm`.

`sudo arkvory module trust list --root …` mostra as chaves confiáveis. `sudo arkvory module trust remove <key id> --root …` remove uma.

Esta versão mantém a lista de confiança; os plugins são instalados por uma versão posterior.

## Depois de uma interrupção {#recover}

Cada mudança do conjunto de módulos é registrada no diário de atualizações. Se um comando parar no meio, o próximo comando de implantação recusa com `Interrupted deployment`. Execute `sudo arkvory recover --root …`: ele restaura o conjunto de módulos anterior. Até lá, todo comando de módulos que muda algo é recusado, inclusive `module trust` e `module revocations`.
