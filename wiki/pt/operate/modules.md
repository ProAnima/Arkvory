---
title: Módulos
description: Instale pacotes de módulos assinados em um host, ative-os, verifique-os, remova-os e guarde as chaves dos autores de plugins em quem você confia.
---

# Módulos

Um pacote de módulo adiciona uma função ao Arkvory. O Arkvory instala apenas pacotes cuja assinatura ele consegue verificar. Os comandos desta página rodam no host da instalação, como root no Linux ou como administrador no Windows. O console e a API HTTP não instalam módulos nem confiam em chaves, então uma conta de administrador do console roubada não consegue executar código no servidor.

Os serviços verificam de novo os módulos instalados e os carregam sempre que iniciam. Um módulo só é executado depois que você o ativa.

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
| Não há lista de revogação vigente (veja abaixo)                                                                | `stale_revocations`                                            |

Limites: 1 GiB por pacote, 256 MiB por arquivo, 4096 arquivos. Um pacote maior é recusado antes de seus dados serem lidos.

Uma versão já instalada com os mesmos bytes fica como está. A mesma versão com outros bytes é recusada.

## Ativar e carregar um módulo {#load}

Um módulo instalado fica desativado até você ativá-lo. Os serviços carregam módulos somente ao iniciar.

1. Adicione o módulo ao arquivo de módulos (`ARKVORY_MODULES_FILE`, veja [Variáveis de ambiente](../reference/environment#core)). As configurações do módulo ficam em `config`:

   ```json
   { "format": 1, "modules": { "sample": { "enabled": true } } }
   ```

2. Se o módulo guarda arquivos, aprove o tamanho do diretório de dados dele com `resources`, por exemplo `"resources": { "dataMiB": 512, "dataFiles": 10000 }` ao lado de `enabled`. Ele substitui o tamanho que o pacote pede. Veja [Diretório de dados de um módulo](#data).
3. Reinicie os serviços, como em [Aplicar uma alteração](../install/configuration#apply-change).
4. Verifique o módulo como administrador global: `GET /api/v1/system/modules` o mostra com `running: true` e `health.status` `ok` na API e em cada gateway de leitura.

Os módulos assinados executam na API, nos gateways de leitura, no worker e no agente de backup conforme os papéis declarados. Cada processo fornece apenas os serviços do seu papel declarados em `uses`. As rotas exigem `routes`. O Docker Compose ainda não carrega módulos.

Os armazenamentos de módulos são registrados como `<module>.<name>` e podem receber novos uploads. Quando deixam de aceitar gravações, os novos uploads usam `default`. O núcleo verifica todos os bytes antes de publicar objetos montados de partes. A limpeza aguarda leitores ativos, todas as proteções de backup e a barreira de captura. Os cálculos usam threads limitadas. As assinaturas confirmam eventos após processamento bem-sucedido e podem repetir a entrega após erros.

Antes de um serviço importar qualquer código de um módulo, ele verifica o pacote de novo:

1. Somente root (no Windows: SYSTEM e Administrators) ou o dono do diretório de instalação podem alterar o diretório de instalação, `modules/`, o conjunto de módulos, a lista de revogação e seu diretório. A instalação já deixa assim. Um arquivo que outra conta pode alterar e um link dentro de um pacote são recusados (`access_unsafe`, `access_link`).
2. A assinatura, cada arquivo e a versão do Arkvory, como `module install` os verifica.
3. A lista de revogação. Uma versão revogada nunca é carregada. Uma lista expirada ou a falta de lista não param um módulo.

Um módulo que falha numa verificação não é carregado; os outros módulos e o Arkvory continuam. `GET /api/v1/system/modules` o mostra com `running: false`:

| `health.status` | Significado                                                      | Códigos                                                                                                           |
| --------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `failed`        | O pacote foi recusado, ou seu código não carregou ou não iniciou | `file_mismatch`, `unknown_key`, `module_incompatible`, `access_unsafe`, `config_invalid`, `start_failed` e outros |
| `revoked`       | A ProAnimaStudio revogou esta versão                             | o motivo da lista de revogação                                                                                    |
| `unavailable`   | O diretório do pacote não existe no host                         | `module_unavailable`                                                                                              |

Um módulo com falha tira o Arkvory da prontidão (`/health/ready` responde 503 com `module_failed`) somente quando outro módulo ativado precisa dele. Um módulo que guarda os bytes dos arquivos publicados (dados `layout`) nunca faz isso: o Arkvory continua servindo os dados dele e grava os novos uploads no próprio armazenamento em vez do armazenamento do módulo. O log registra `module.refused` e `module.failed` com o código em `errorCode`.

Para reparar um pacote alterado ou ausente, instale-o de novo. Todos os serviços da instalação devem ver os mesmos módulos, ativados ou não: um gateway de leitura ou worker com outros módulos não fica pronto (`module_plan_mismatch`). Instale os mesmos pacotes no host de cada gateway de leitura.

### Diretório de dados de um módulo {#data}

Um módulo que guarda índices, caches ou estado próprios recebe um diretório no volume de dados: `module-data/<id>/` no diretório de armazenamento de `default`. A parte `data` dele é destinada a backups; a parte `cache`, não. O Arkvory desconta cada gravação do tamanho aprovado, em MiB e em arquivos, para as duas partes juntas. Uma gravação além dele é recusada (`module_quota_exceeded`), e o módulo continua rodando. Sem um tamanho aprovado, o módulo só pode ler. A [reserva do volume](./storage#disk) também vale. Em um gateway de leitura, o módulo lê os mesmos arquivos e não pode alterá-los.

Remover um módulo mantém o diretório dele. Exclua `module-data/<id>/` você mesmo quando não precisar mais dos dados. Os backups ainda não incluem os diretórios de módulos.

Antes de atualizar para extension API 0.7.0, pare todos os processos API e worker antigos que gravam dados de módulos. Os novos processos compartilham a contabilização da quota pelo coordenador PostgreSQL da instalação; arquivos temporários também contam. A gravação simultânea por processos antigos e novos não é suportada. Após uma falha, o Arkvory reconstrói a contabilização quando necessário e remove diretórios temporários do novo protocolo somente após obter o bloqueio do proprietário anterior no banco. Arquivos temporários antigos não são removidos automaticamente e continuam contando para a quota; revise-os separadamente com os processos de gravação parados. Processos backup têm acesso somente de leitura.

## Rotas de módulos {#routes}

Um módulo pode adicionar rotas HTTP sob o próprio prefixo `/api/ext/<id>/v<major>/`, por exemplo `/api/ext/sample/v1/`. O Arkvory verifica cada requisição antes que qualquer código do módulo seja executado:

| Verificação         | Como em `/api/v1`                                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credencial          | As mesmas chaves, sessões e tokens; uma rota fica aberta a qualquer chamador conectado ou apenas ao administrador global                                                                       |
| Permissão           | A permissão que a rota nomeia sobre o repositório do caminho, como `content.read` ou `upload.create`: uma chave de serviço precisa dela, uma conta precisa da permissão de leitura ou gravação |
| Corpo da requisição | O limite de tamanho da rota, os limites de upload, os prazos e a largura de banda do servidor                                                                                                  |
| Arquivos            | Enviados pelo próprio Arkvory: ETag, Range, `If-Range`, 304, a fila de downloads e a largura de banda de download                                                                              |

Os erros têm o formato de erro da API. Um módulo nunca vê a credencial nem outros cabeçalhos. Um gateway de leitura atende as rotas de leitura de um módulo e responde `read_only` às demais.

Cada módulo descreve as rotas em um documento OpenAPI, e o Arkvory compara os dois quando o módulo inicia. Um módulo cujas rotas violam as regras não inicia e não atende nada; o Arkvory continua funcionando. `GET /api/v1/system/modules` o mostra com `running: false` e `health.status` `failed`:

| Código                   | Significado                                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `routes_invalid`         | Uma rota viola as regras, por exemplo um caminho fora do prefixo do módulo ou uma alteração aberta a qualquer chamador conectado |
| `openapi_invalid`        | O documento OpenAPI está ausente ou é inválido                                                                                   |
| `openapi_route_mismatch` | Uma rota não tem operação no documento, ou uma operação não tem rota                                                             |
| `transfer_invalid`       | O módulo oferece um protocolo de transferência que não pode oferecer                                                             |

Os documentos das rotas:

| Endereço                                                                                    | Quem pode ler               | Conteúdo                                                                                           |
| ------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /api/ext/openapi.json`                                                                 | Qualquer chamador conectado | As rotas de todos os módulos que este serviço executa, com as operações que o chamador pode chamar |
| [`GET /api/v1/system/modules/{id}/openapi`](../api/reference/system#getSystemModuleOpenApi) | O administrador global      | As rotas de um módulo                                                                              |

`/api/v1/openapi.json` nunca lista rotas de módulos. Um módulo do tipo `transfer` pode oferecer outra forma de transferir arquivos: `GET /api/v1/capabilities` a lista em `transfer`. Um cliente só a usa com uma extensão correspondente; caso contrário, transfere os arquivos normalmente.

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

O comando verifica de novo cada pacote instalado, como os serviços fazem antes de carregá-lo: a assinatura, cada arquivo e o arquivo compactado. Cada módulo mostra um estado:

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

Cada lista é assinada com uma data de expiração: 90 dias por padrão, nunca mais de 180. `module install` e `module pin <id> <version>` precisam de uma lista vigente; com uma lista expirada ou sem lista, recusam com `stale_revocations`. Um pacote que traz uma lista vigente conta. Para continuar mesmo assim, adicione `--allow-stale-revocations`: o Arkvory mostra um aviso e registra a decisão em `modules/audit.jsonl`. Uma lista expirada nunca para os módulos instalados: eles continuam funcionando e seus dados continuam legíveis; só uma entrada de revogação para uma versão. Uma lista com número maior sempre substitui a armazenada, mesmo que tenha expirado.

Quando a ProAnimaStudio substitui sua chave de assinatura de módulos, uma versão traz as duas chaves e a lista seguinte é assinada com a chave nova; só uma versão posterior remove a chave antiga. A atualização para essa versão é recusada enquanto o host ainda armazenar uma lista assinada com a chave antiga: armazene antes uma lista vigente. `sudo arkvory module check-revocations --root …` mostra se esta versão confia na chave da lista armazenada.

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

## Duração da solicitação do módulo {#request-scope}

A rota usa as permissões do solicitante até o fim da resposta, inclusive em fluxo. O cancelamento ou a conclusão revoga as permissões e fecha os recursos de leitura. `upload-read` lê partes aceitas de envios incompletos e verifica o proprietário, `upload.read`, o intervalo e o cancelamento. Módulos podem retirar ofertas de transferência durante a execução. As próximas consultas de recursos as omitem; rotas e transferências ativas permanecem. O cliente pode manter ofertas antigas em cache, portanto a rota deve verificar cada operação.
