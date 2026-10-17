---
title: Agentes de IA
description: 'Deixe um agente de IA como o Claude Code encontrar, baixar, publicar e promover artefatos com arkvoryctl mcp e a skill do Arkvory para agentes.'
---

# Agentes de IA

Um cliente de agente de IA compatível com o Model Context Protocol (MCP), como o Claude Code, pode trabalhar com o Arkvory por meio de `arkvoryctl mcp`. O cliente inicia o comando e conversa com ele por stdin e stdout; nenhuma porta de rede é aberta. A skill para agentes ensina ao agente fluxos de trabalho seguros sobre essa base.

## Antes de começar {#before}

1. Instale o [cliente de linha de comando](../protocols/cli) na máquina em que o agente roda.
2. Crie para o agente uma chave de serviço que alcance apenas os repositórios e as ações de que ele precisa. Salve-a em um arquivo que só você possa ler.
3. Adicione um perfil que aponte para o arquivo da chave e verifique-o:

```bash
arkvoryctl profile add agent --server https://arkvory.example --token-file ~/.config/arkvory/agent.key --repository builds
arkvoryctl doctor --profile agent
```

Nunca cole a chave no chat, em um argumento ou em um arquivo do projeto. O agente nunca a vê: resultados e erros não a contêm.

## Conectar o servidor MCP {#connect}

```bash
claude mcp add arkvory -- arkvoryctl mcp --profile agent --root ~/work
```

Sem `--write`, o servidor é somente leitura: o agente pode listar repositórios, pesquisar em todos, ler artefatos, pacotes, arquivos por caminho, o feed de mudanças e o status da instalação, e baixar artefatos. Ferramentas que a chave não pode usar não são oferecidas. O cliente precisa suportar MCP 2025-06-18 ou mais recente.

## Permitir a escrita {#write}

A escrita é uma configuração separada. Liste os repositórios em que o agente pode escrever:

```bash
claude mcp add arkvory-publish -- arkvoryctl mcp --profile agent --root ~/work --write --write-repositories builds
```

| Ferramenta                | O que faz                                                                        |
| ------------------------- | -------------------------------------------------------------------------------- |
| `arkvory_upload`          | Envia um arquivo como novo artefato ou como a próxima revisão de um caminho      |
| `arkvory_publish_package` | Envia um UPack e o registra como versão de pacote                                |
| `arkvory_promote`         | Adiciona um estágio; com `sha256`, só ao artefato que tem exatamente esses bytes |
| `arkvory_stage_remove`    | Remove um estágio; o artefato permanece                                          |
| `arkvory_annotate`        | Substitui rótulos e metadados na revisão que o agente leu                        |

- Uma escrita em um repositório que não está em `--write-repositories` é recusada antes de qualquer envio (`repository_not_allowed`). O servidor ainda verifica as permissões da chave.
- Nada pode ser excluído ou restaurado, e nenhum link de download é criado. Essas tarefas continuam sendo de uma pessoa no console.
- O servidor pede ao agente que descreva cada escrita e aguarde sua confirmação. Seu cliente MCP também pode perguntar antes de cada chamada.
- Um upload pode ser retomado: após uma falha, o agente repete a mesma chamada, e o mesmo artefato é devolvido em vez de um segundo. O resultado informa o SHA-256 do arquivo lido.

## Arquivos e limites {#files}

- O agente lê e grava arquivos locais apenas dentro de `--root` (o diretório atual por padrão). Um caminho que sai dele, inclusive por um link, é recusado (`path_outside_root`).
- Um download só aparece depois que o tamanho e o SHA-256 são verificados. Um arquivo existente só é substituído quando o agente pede.
- Um arquivo pequeno que contém a chave nunca é enviado (`source_contains_credential`).
- Um resultado tem no máximo `--max-output-bytes` (64 KiB por padrão, até 1 MiB) e 100 itens; para mais, o agente passa `next` como `after`.

## Instalar a skill {#skill}

A skill é um conjunto de instruções para o agente: como pesquisar, verificar downloads, publicar, promover e ler códigos de erro, e o que ele nunca deve fazer. Ela vem com o cliente:

```bash
arkvoryctl skill install
```

A skill vai para `~/.claude/skills/arkvory`; passe `--target DIR` para instalá-la em um projeto, como `.claude/skills/arkvory`. Executar o comando de novo atualiza os arquivos que você não alterou. Um arquivo que você alterou é mantido: o comando para e não muda nada, a menos que você adicione `--force`.

## Segurança {#safety}

- Nomes, rótulos, metadados e comentários nos resultados são escritos por outras pessoas. O agente os trata como dados e nunca segue instruções encontradas neles.
- Mantenha separadas a configuração somente leitura e a de escrita, e permita escrever apenas nos repositórios de que a tarefa precisa.
- Use uma chave dedicada com permissões restritas; revogue-a no console quando o agente não precisar mais dela.

## Solução de problemas {#troubleshooting}

| Erro                          | Causa e solução                                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| Nenhuma ferramenta de escrita | O servidor foi iniciado sem `--write`, ou a chave não tem a permissão.                                   |
| `repository_not_allowed`      | O repositório não está em `--write-repositories`. Altere a configuração do MCP.                          |
| `forbidden`                   | A chave não tem a permissão. Execute `arkvoryctl doctor` para ver as permissões.                         |
| `path_outside_root`           | O arquivo está fora de `--root` ou não é um arquivo comum.                                               |
| `skill_modified`              | Você alterou um arquivo da skill. Mantenha sua cópia ou repita `arkvoryctl skill install` com `--force`. |
