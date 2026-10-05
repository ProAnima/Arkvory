---
layout: home
title: Arkvory
titleTemplate: Documentação
hero:
  name: Arkvory
  text: Seu próprio repositório para builds, pacotes e arquivos grandes
  tagline: Um servidor para pipelines de CI, agentes de implantação e equipes de jogos. Uploads retomáveis de qualquer tamanho, acesso por repositório, backups, espelhos e um console em onze idiomas.
  image:
    src: /arkvory.svg
    alt: ''
  actions:
    - theme: brand
      text: Primeiros passos
      link: /pt/guide/
    - theme: alt
      text: Instalação
      link: /pt/install/
    - theme: alt
      text: API HTTP
      link: /pt/api/
features:
  - title: Arquivos de qualquer tamanho
    details: Uploads de dezenas de gigabytes são enviados em partes e continuam depois de uma perda de conexão. Os downloads são retomados por faixas de bytes. Cada arquivo é verificado por SHA-256.
    link: /pt/use/transfers
  - title: Pacotes e imagens
    details: Pacotes UPack com versões, imagens de contêiner para Docker e Podman, Git LFS para assets de jogos, pacotes npm e Unity e arquivos simples por caminho.
    link: /pt/protocols/
  - title: Acesso que você consegue explicar
    details: Contas, grupos, tokens pessoais e contas de serviço com chaves limitadas aos repositórios e às ações de que precisam. Logins e alterações de acesso são auditados.
    link: /pt/use/accounts
  - title: Estágios e promoção
    details: Marque um build como testado ou liberado, promova-o para outro repositório e deixe um agente de implantação pegar o build mais recente de um estágio.
    link: /pt/use/promotion
  - title: Backups e espelhos
    details: Backups agendados e verificados em um disco local ou em um compartilhamento de rede. Os espelhos mantêm um segundo site sincronizado e assumem quando o primeiro é perdido.
    link: /pt/operate/backups
  - title: Funciona sozinho
    details: Serviços do Windows, pacotes Linux ou Docker Compose. Os serviços reiniciam depois de uma falha ou de um travamento, e as atualizações chegam assinadas, após um backup recente.
    link: /pt/operate/self-healing
---
