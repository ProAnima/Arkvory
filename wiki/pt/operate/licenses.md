---
title: Licenças
description: Ative a licença de um módulo pago online ou offline, verifique o estado dela e veja o que o Arkvory envia e guarda.
---

# Licenças

O núcleo gratuito do Arkvory não precisa de licença. Todas as funções desta documentação funcionam sem ela, e nenhum estado de licença desliga qualquer uma delas ou torna os dados ilegíveis. Uma licença habilita um módulo pago da ProAnimaStudio (veja [Módulos](modules)). Até você ativar uma licença, o Arkvory não envia nada sobre licenças a lugar nenhum.

Os comandos desta página rodam no host da instalação, como root no Linux ou como administrador no Windows. Instalações com Docker Compose não carregam módulos e por isso recusam esses comandos.

## Ativar online {#activate}

1. Salve a chave de licença do site da ProAnimaStudio num arquivo que só você pode ler, por exemplo `/root/arkvory.key`.
2. Ative:

   ```bash
   sudo arkvory license activate --key-file /root/arkvory.key --root /opt/proanima-arkvory
   ```

3. Apague o arquivo local da chave após a ativação. Mantenha acesso à chave na sua conta: a recuperação pode exigir a chave novamente.

O Arkvory envia o pedido ao hub da instalação (o endereço de `config/hub.json`, o mesmo das atualizações) por HTTPS com verificação do certificado. Ele aceita a resposta só se a chave de licenças da ProAnimaStudio a assinou, para esta instalação e para este pedido. Uma chave com erro de digitação é recusada antes de qualquer envio. Ativar de novo a mesma instalação com a mesma chave não ocupa uma vaga nova da licença.

### O que é enviado {#sent}

| Pedido    | Conteúdo                                                                                                                                 |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Ativação  | A chave de licença, o id da instalação, um valor aleatório, a versão do Arkvory, o id e a versão dos módulos pagos instalados, o horário |
| Renovação | O id da ativação e o segredo dela, um valor aleatório, o número de sequência, as versões                                                 |

O nome do titular da licença, nomes de pessoas, endereços, detalhes da máquina, volumes de dados, nomes de repositórios, conteúdos, metadata e estatísticas de uso nunca são enviados. Desligar as estatísticas não acrescenta nem tira nada aqui. Com o hub desligado (`--hub-off`), use a [ativação offline](#offline).

### O que é guardado {#kept}

- O token: o documento assinado do hub, no banco de dados e nos backups.
- O segredo da ativação: um arquivo em `config/licenses/`, que só a conta dos serviços pode ler. Ele nunca fica no banco de dados, nos logs nem num backup.
- A chave de licença: em lugar nenhum.

## Verificar o estado {#status}

```bash
sudo arkvory license status --root /opt/proanima-arkvory
```

Acrescente `--json` para scripts. Um administrador global vê o mesmo em `GET /api/v1/system/license` ([referência](../api/reference/system#getSystemLicense)). O Arkvory verifica de novo cada documento guardado toda vez; um documento que a ProAnimaStudio não assinou é `invalid` e não habilita nada.

| Estado          | Significado                                                                                     | Escritas pagas           |
| --------------- | ----------------------------------------------------------------------------------------------- | ------------------------ |
| `valid`         | A licença vale; `refreshFailing` quando o hub não responde há algum tempo                       | no modo do módulo        |
| `offline-grace` | Sem renovação há mais de um dia; o token vale até `offlineGraceUntil`                           | no modo do módulo        |
| `grace`         | O prazo da licença acabou; carência de renovação até `graceUntil`                               | no modo do módulo        |
| `mismatch`      | O token pertence a outra instalação (uma restauração em outro lugar); carência até `graceUntil` | no modo do módulo até lá |
| `expired`       | `trial_expired`, `licence_expired` ou `activation_stale` (o token acabou)                       | na forma do núcleo       |
| `revoked`       | Uma revogação assinada; o motivo é mostrado                                                     | na forma do núcleo       |
| `invalid`       | Um documento guardado não passa na verificação                                                  | na forma do núcleo       |

Em qualquer estado seus dados continuam legíveis, backups e restaurações funcionam, e publicar nunca falha por causa de uma licença: sem licença, um módulo pago grava os dados novos na forma do núcleo gratuito. A gravação no modo do módulo volta sozinha após uma renovação bem-sucedida.

## Renovação e janela offline {#refresh}

O worker renova cada ativação mais ou menos uma vez por dia e ao iniciar. Cada renovação traz um token novo e um segredo novo; o segredo anterior deixa de valer.

Quando o hub não pode ser alcançado, o worker tenta de novo após 15 minutos e depois espera cada vez mais, até 6 horas. A licença continua `valid`; após um dia sem renovação ela fica `offline-grace`; quando o token acaba (a janela offline: 30 dias por padrão, 7 num teste) ela fica `expired` com `activation_stale`. Uma recusa do hub, como `licence_expired` ou `activation_suspended`, não é repetida: resolva-a e então execute:

```bash
sudo arkvory license refresh --root /opt/proanima-arkvory
```

Atrasar o relógio não prolonga nada: o Arkvory julga pelo horário mais tardio que já viu. Um relógio do banco de dados mais de um dia atrás desse horário mostra `clockRollback`.

Se uma renovação pode ter chegado ao hub, mas a resposta foi perdida, o Arkvory permite apenas uma repetição na janela de 10 minutos, inclusive após reiniciar. Se o resultado continuar desconhecido, a repetição for consumida, a janela terminar ou o token recebido for inválido, `activation_recovery_required` interrompe as renovações. O token atual continua válido até expirar. Obtenha a chave e repita `license activate --key-file <file>`; `license refresh` não resolve esse estado.

### Cópias e restaurações {#copies}

Uma cópia da instalação, como uma máquina virtual clonada, tem o mesmo segredo. Quando as duas cópias renovam, o hub suspende a ativação (`activation_secret_reused`). Ative de novo com a chave a instalação que você vai manter.

Um backup restaurado em outra instalação mantém o token, que pertence à instalação antiga: o estado é `mismatch` com carência. Ative a nova instalação com a chave e depois desative a antiga.

Uma ativação não renovada durante a janela offline e mais 30 dias caduca, e a vaga dela é liberada. A renovação seguinte retoma a vaga enquanto houver uma livre; senão é recusada com `activation_lapsed`. Desative outra instalação e renove.

## Desativar {#deactivate}

```bash
sudo arkvory license deactivate lic_0123456789ABCDEFGHJKMNPQRS --root /opt/proanima-arkvory
```

Indique a licença ou uma ativação. O hub libera a vaga e o Arkvory apaga o segredo.

## Ativação offline {#offline}

Para hosts sem acesso ao hub:

1. Escreva um arquivo de pedido:

   ```bash
   sudo arkvory license request --key-file /root/arkvory.key --out /root/request.json --root /opt/proanima-arkvory
   ```

   O arquivo contém o SHA-256 da chave, nunca a chave. O Arkvory não usa nenhuma rede para isso.

2. Envie o arquivo na sua conta da ProAnimaStudio e baixe a resposta.
3. Instale a resposta:

   ```bash
   sudo arkvory license install /root/answer.json --root /opt/proanima-arkvory
   ```

A resposta deve pertencer a um pedido desta instalação. Uma ativação offline não é renovada: vale até o fim, no máximo 365 dias, e um pedido novo a prolonga. Uma revogação chega a esse host só com uma lista de revogação de licenças, que se instala do mesmo jeito.

## Erros {#errors}

| Código                                              | Significado                                                                                         |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `licence_key_invalid`                               | O hub não conhece a chave                                                                           |
| `activation_limit_reached`                          | Todas as vagas da licença estão ocupadas; desative outra instalação                                 |
| `answer_invalid`                                    | A resposta não foi assinada pela ProAnimaStudio ou é de outra instalação ou pedido; nada é guardado |
| `installation_mismatch`, `nonce_unknown`            | A resposta offline pertence a outra instalação ou a nenhum pedido pendente                          |
| `seq_replayed`                                      | Um documento mais antigo que o guardado; recusado                                                   |
| `revocation_rollback`                               | Uma lista de revogação mais antiga que a guardada                                                   |
| `unreachable`, `timeout`, `tls_failed`, `hub_error` | O hub não pôde ser alcançado; o worker tentará de novo                                              |
