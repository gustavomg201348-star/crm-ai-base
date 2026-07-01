# Roadmap Multi-Canal Meta/WhatsApp

Este documento consolida a visao de evolucao do CRM para suportar multiplas
APIs Meta/WhatsApp com seguranca operacional. Ele descreve objetivos, diretrizes
e fases de evolucao. Nao define ainda a arquitetura final de roteamento,
balanceamento ou distribuicao de carga.

## Estado atual

Situacao atual do CRM:

- 1 canal Meta operacional.
- 1 numero WhatsApp conectado.
- Envio individual funcional.
- Campanhas em evolucao.
- Base multiempresa em operacao.
- Canais Meta ja modelados no sistema.
- Campanhas ja vinculam envio a canal selecionado.
- Isolamento forte por canal ainda sera evoluido.

Objetivo de longo prazo:

- Suportar pelo menos 10 APIs Meta conectadas com seguranca.
- Suportar multiplas WABAs.
- Suportar multiplos numeros WhatsApp.
- Garantir isolamento por empresa e por canal.
- Evitar fallback automatico de canal.
- Permitir roteamento inteligente.
- Permitir balanceamento futuro.
- Monitorar saude e reputacao por canal.

## Objetivos do Projeto

O CRM foi concebido para:

- Operar como SaaS multiempresa.
- Suportar multiplos canais Meta.
- Suportar multiplos numeros WhatsApp.
- Suportar multiplas WABAs.
- Permitir crescimento seguro do volume de campanhas.
- Preservar isolamento por `companyId`.
- Manter rastreabilidade, governanca e rollback claro por funcionalidade.

## Arquitetura funcional de alto nivel

Visao conceitual da organizacao por empresa:

```text
Empresa
|-- Usuarios
|-- Contatos
|-- Conversas
|-- Canais Meta
|-- Campanhas
|-- Dashboard
`-- Multicred
```

Cada empresa deve operar como fronteira logica de dados, permissoes,
configuracoes, campanhas e canais. A evolucao multi-API Meta deve preservar essa
fronteira e evitar qualquer fallback global que misture empresas, canais,
numeros, tokens ou WABAs.

## Visao de Escalabilidade

Evolucao pretendida para a arquitetura Meta/WhatsApp:

```text
1 API Meta
  |
  v
multiplas APIs
  |
  v
multiplos numeros
  |
  v
multiplas WABAs
  |
  v
multiplas empresas
  |
  v
roteamento inteligente
  |
  v
balanceamento
  |
  v
monitoramento por canal
```

A meta arquitetural e suportar pelo menos 10 APIs Meta conectadas
simultaneamente. Essa meta deve ser tratada como evolucao progressiva, com
selecao explicita de canal, isolamento por empresa, controle de volume,
rastreabilidade de envio e monitoramento por canal.

## Diretrizes de governanca

- Nao selecionar automaticamente um canal Meta quando existir mais de um canal
  elegivel sem respeitar a estrategia de roteamento da empresa.
- Nao utilizar valores hardcoded para `companyId`, `phoneNumberId`, `wabaId`,
  `provider` ou `accessToken`.
- Toda mudanca envolvendo Conversas, Campanhas, Canais Meta ou Disparos deve
  informar impacto esperado, riscos e plano de rollback.
- Toda evolucao deve preservar isolamento por `companyId`.
- Credenciais Meta devem ser tratadas como dados sensiveis.
- Volume de campanha deve crescer com controle, opt-in, reputacao e
  monitoramento.

## Roadmap para Multi-Canal Meta

### Fase 1 - Fundacao/Governanca

- Documentar regras de agentes, validacao e commits.
- Registrar cuidados obrigatorios com multiempresa, canais Meta e LGPD.
- Manter mudancas pequenas, auditaveis e reversiveis.

### Fase 2 - Guardrails sem migration

- Validar duplicidade de canais Meta antes de cadastro/edicao.
- Reforcar exigencia de credenciais completas e assinatura segura de webhook.
- Reduzir fallbacks que possam escolher canal incorreto.
- Evitar qualquer selecao implicita de canal quando houver mais de um canal
  elegivel.

### Fase 3 - UX operacional

- Deixar canal de origem/envio explicito nas telas de Atendimento, Canais e
  Disparos.
- Exibir alertas de configuracao incompleta, webhook parado e qualidade do
  numero.
- Indicar claramente quando uma conversa ou campanha esta vinculada a um canal
  Meta especifico.

### Fase 4 - Schema e isolamento forte

- Avaliar `channelId` relacional em conversas e mensagens.
- Adicionar constraints/indices para evitar duplicidade de canais.
- Melhorar rastreabilidade de status, logs e eventos por canal.
- Garantir que inbound, outbound, campanhas e status de entrega consigam
  identificar o canal correto de ponta a ponta.

### Fase 5 - Escalabilidade e monitoramento

- Processar campanhas em fila.
- Aplicar rate limit por canal/WABA/empresa.
- Monitorar falhas, qualidade, bloqueios, token e webhook.
- Implementar estrategia de aquecimento e reputacao para disparos.
- Avaliar roteamento, balanceamento e priorizacao apenas depois que isolamento,
  seguranca e observabilidade estiverem consolidados.
