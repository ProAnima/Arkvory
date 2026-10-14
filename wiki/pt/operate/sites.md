---
title: Sites
description: Veja todas as instalações do seu cluster em um só lugar, pareie sites com um código de uso único e acompanhe o estado deles.
---

# Sites

Um **site** é uma instalação do Arkvory: a principal, um espelho em outro local, uma instalação que importa versões de outra. Em [[ui:fleet]], uma instalação, o **controlador**, mostra cada site que gerencia: se responde, sua versão, suas cópias de HA e gateways de leitura, seus espelhos e quanto estão atrasados, e sua fila de downloads. Só administradores globais veem a página.

## Como funciona {#how-it-works}

- O controlador mantém uma lista de sites. Ele lê cada site a cada 30 segundos por HTTPS e guarda a última resposta, então um site que para de responder ainda mostra seu último estado conhecido.
- Ao parear, o site dá ao controlador uma chave própria, uma **chave de frota**. Ela só alcança o que um controlador precisa: hoje, o estado do site. Não lê nem altera repositórios, arquivos, contas ou chaves.
- O controlador guarda as chaves de frota seladas com uma chave do seu diretório de dados (`fleet.key`). O banco de dados e seus backups sozinhos não as revelam. Depois de uma restauração, pareie os sites de novo.
- Cada site mostra quais controladores o gerenciam e pode revogá-los a qualquer momento.

## Parear um site {#pair}

1. No site: abra [[ui:fleet]] e, em [[ui:fleetThisSite]], escolha [[ui:fleetMakeCode]]. O site mostra um código válido por dez minutos e, com HTTPS embutido, a impressão digital do seu certificado.
2. No controlador: abra [[ui:fleet]], digite o endereço do site em [[ui:fleetAdd]] e escolha [[ui:fleetCheck]]. O controlador conecta e mostra a impressão digital do certificado que recebeu.
3. Compare as duas impressões digitais. Elas precisam ser iguais. Se forem diferentes, o endereço está errado ou algo está entre as instalações: não pareie.
4. Digite o código e escolha [[ui:fleetPair]]. O site aparece na lista com seu estado.

Um código vale uma vez. Um código usado ou expirado é recusado: crie um novo.

O endereço é o endereço HTTPS da API do site, por exemplo `https://branch.example:8443`. HTTP simples só é aceito no mesmo computador (`127.0.0.1`). Se o TLS termina em um proxy na frente do site, o site não consegue mostrar o certificado do proxy: compare com a impressão digital SHA-256 que o navegador mostra para o endereço do site.

A partir daí o controlador confia exatamente nesse certificado. Quando o site recebe um certificado novo, ele mostra [[ui:fleetStateCertificate]]: remova o site e pareie de novo.

## Estados {#states}

| Estado                       | Significado                                              | O que fazer                                                           |
| ---------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| [[ui:fleetStateOk]]          | O site respondeu à última leitura                        | Nada                                                                  |
| [[ui:fleetStatePending]]     | O site ainda não foi lido                                | Aguarde a próxima leitura ou escolha [[ui:fleetReadSite]]             |
| [[ui:fleetStateUnreachable]] | Sem resposta: site parado ou rede fora                   | Verifique o site e a rede. O último estado conhecido continua visível |
| [[ui:fleetStateCertificate]] | O site apresenta outro certificado que o confirmado      | Se o certificado foi renovado, remova o site e pareie de novo         |
| [[ui:fleetStateRevoked]]     | O administrador do site revogou este controlador         | Pareie de novo com um novo código                                     |
| [[ui:fleetStateInvalid]]     | O site respondeu de um jeito que esta versão não entende | Atualize as duas instalações para a mesma versão                      |
| [[ui:fleetStateRefused]]     | O site recusou a solicitação                             | Pareie de novo com um novo código                                     |

## O que a lista mostra {#list}

- **[[ui:fleetVersion]]**: a versão do site e seu papel, gravação ou gateway de leitura.
- **[[ui:fleetCopies]]**: em um cluster HA, as cópias completas e quantas uma gravação exige; os gateways de leitura que mantêm sua vaga.
- **[[ui:fleetMirrors]]**: os espelhos e importações do site; quantas alterações o mais atrasado está atrás da sua origem, ou quantos estão parados.
- **[[ui:fleetQueue]]**: downloads em andamento e downloads que esperam na fila.
- **[[ui:fleetSeen]]**: quando o site respondeu pela última vez.

[[ui:fleetReadAll]] lê todos os sites agora em vez de esperar a próxima rodada. [[ui:fleetRemoveSite]] esquece um site aqui; revogue também o controlador no site, porque até lá a chave continua válida lá.

## Quem gerencia este site {#managed-by}

Em [[ui:fleetThisSite]], cada site lista os controladores que o gerenciam: nome, quem os pareou, quando e a última solicitação. [[ui:fleetRevoke]] recusa a chave do controlador na hora.

## Configurações {#settings}

| Variável                 | Padrão                            | Significado                                                                                         |
| ------------------------ | --------------------------------- | --------------------------------------------------------------------------------------------------- |
| `ARKVORY_SITE_NAME`      | o nome do host                    | Como esta instalação se chama em outros sites                                                       |
| `ARKVORY_FLEET_KEY_FILE` | `fleet.key` no diretório de dados | A chave que sela as chaves dos sites gerenciados; criada no primeiro início do processo de gravação |

## Limites {#limits}

- A página mostra o estado dos sites. Espelhos, atualizações, a fila de downloads e a HA são configurados em cada site, no seu console ou com `arkvory configure`; alterá-los a partir do controlador vem a seguir.
- Um controlador gerencia até 256 sites e lê no máximo oito ao mesmo tempo.
- O controlador guarda uma chave de cada site que gerencia: proteja os administradores globais e o diretório de dados dele com o mesmo cuidado que os próprios sites.
