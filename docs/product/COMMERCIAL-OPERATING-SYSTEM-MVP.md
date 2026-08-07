# Sistema Operacional Comercial — MVP da Sala de Controle 1.0

## 1. Problema real

A operação hoje tem geração de leads por dois grandes caminhos:

- disparos;
- tráfego pago.

O problema identificado não é apenas gerar leads. O problema é não possuir clareza operacional suficiente para responder rapidamente:

- onde estamos perdendo dinheiro;
- qual campanha gera contratos;
- qual atendente está esquecendo clientes;
- quanto tempo clientes ficam sem resposta;
- em qual etapa as negociações morrem;
- quantos clientes agendados não foram atendidos;
- quantas oportunidades foram perdidas por falta de acompanhamento;
- como está o desempenho diário comparado à meta.

Missão do MVP:

> “Parar de administrar a operação no escuro.”

A Sala de Controle 1.0 deve transformar dados já existentes no CRM em uma leitura operacional simples, confiável e acionável para o gestor.

## 2. Regra do MVP

O MVP não deve tentar construir a versão perfeita.

Entram apenas informações que:

- já existem no CRM;
- podem ser calculadas com pequena evolução;
- ajudam o gestor a tomar uma decisão imediata.

Ficam fora do MVP:

- IA avançada;
- predição sofisticada;
- novo motor complexo de scoring;
- classificação profunda de intenção;
- análise externa de mercado;
- telas bonitas sem decisão operacional clara.

O produto deve primeiro responder com segurança: “o que está acontecendo hoje e quem precisa agir agora?”.

## 3. Entidade principal

O CRM continuará possuindo Contatos, mas o Sistema Operacional Comercial será orientado por **Negociações**.

Contato é a pessoa.

Negociação é o momento comercial ativo ou histórico em torno de uma intenção.

Uma negociação nasce quando existe intenção comercial.

### Disparo

O cliente clica em botão como:

- Conferir;
- Verificar;
- Saber mais;
- Simular.

### Tráfego pago

O cliente entra pelo anúncio e envia a mensagem inicial.

### Estágios iniciais definidos

```text
Novo
→ Interesse
→ Simulação
→ Negociação
→ Formalização
→ Fechado
```

### Resultados finais

Ganha:

- contrato realizado.

Perdida:

- fechou com concorrente;
- não elegível;
- não era o titular;
- sem interesse definitivo.

Nesta etapa, isso é apenas uma definição de produto. Não há schema, migration ou implementação.

## 4. Conceitos operacionais do MVP

### Cliente esquecido

Cliente esquecido não deve ser definido apenas por tempo absoluto.

É uma ação ou compromisso que deveria ter acontecido e não aconteceu.

Exemplos:

- atendente disse que iria simular e passaram aproximadamente 20 minutos sem retorno;
- cliente fez uma pergunta e ficou aproximadamente 5 minutos sem resposta;
- agendamento venceu e não foi atendido nem reagendado;
- ligação prometida não aconteceu;
- próxima ação venceu sem tratamento.

No MVP, “cliente esquecido” deve começar por sinais objetivos e auditáveis: tarefa vencida, retorno pendente, conversa sem resposta, mensagem inbound recente sem tratamento, ou oportunidade priorizada sem avanço.

### Negociação em risco

Negociação em risco é uma negociação onde o cliente demonstrou interesse relevante e existe risco de perder o timing por ausência ou inadequação da próxima ação.

Exemplos:

- recebeu condição e apresentou uma objeção importante;
- pediu ligação e ninguém ligou;
- solicitou nova simulação e não recebeu;
- estava próximo de fechar e ficou sem acompanhamento.

No MVP, não criar score complexo. Começar com regras simples: proposta ativa sem movimento, retorno vencido, cliente HOT com produto conhecido sem ação, ou item com prioridade alta na Opportunity Queue.

## 5. Sala de Controle 1.0

O MVP deve ser uma página longa, com rolagem vertical, concentrando dashboard e sala de controle no mesmo lugar.

Não criar um dashboard tradicional baseado apenas em gráficos.

A tela precisa responder, nesta ordem:

### Como está meu dia?

Mostrar:

- atendimentos do dia;
- novas negociações;
- clientes interessados;
- propostas/simulações do dia;
- contratos do dia;
- conversão do dia;
- progresso da meta.

### Quem precisa de atenção agora?

Mostrar:

- agendamentos de hoje;
- agendamentos vencidos;
- clientes esquecidos;
- próximas ações vencidas;
- negociações paradas que exigem ação;
- oportunidades prioritárias.

### Como está o amanhã?

Mostrar:

- clientes já agendados para amanhã;
- quantidade de retornos previstos;
- negociações importantes programadas.

### Como estão minhas campanhas?

Mostrar, quando os dados atuais permitirem:

- quantidade enviada;
- respostas;
- interessados;
- contratos atribuídos;
- conversão.

### Como está minha equipe?

Mostrar:

- atendimentos por atendente;
- negociações abertas;
- agendamentos;
- agendamentos vencidos;
- clientes esquecidos;
- contratos;
- conversão quando houver base confiável.

### Estou atingindo a meta?

Mostrar:

- meta diária;
- realizado;
- percentual atingido;
- projeção simples, se os dados atuais permitirem sem criar predição complexa.

## 6. Primeiro resumo executivo

No MVP, não exigir IA generativa para tudo.

Se for possível com regras simples, criar no futuro frases estruturadas como:

- “Hoje existem 18 clientes aguardando retorno.”
- “7 agendamentos estão vencidos.”
- “3 atendentes possuem clientes esquecidos.”
- “Você está em 72% da meta do dia.”

A IA Gestora avançada fica para fase posterior.

O resumo executivo 1.0 deve ser determinístico, explicável e derivado dos blocos visíveis da própria página.

## 7. Métricas iniciais obrigatórias

Métricas essenciais para o MVP:

- atendimentos no dia;
- novas negociações no dia;
- interessados no dia;
- clientes reagendados;
- reagendamentos vencidos/não atendidos;
- disparos realizados;
- respostas aos disparos;
- contratos;
- conversão;
- clientes agendados para amanhã;
- clientes esquecidos;
- próximas ações vencidas;
- negociações em risco;
- propostas/simulações lançadas.

## 8. Fonte dos dados

Classificação:

- A — já calculável hoje;
- B — precisa pequena instrumentação;
- C — depende da futura IA.

| Indicador | Já existe? | Fonte | Confiabilidade | Falta algo? | Classe |
|---|---:|---|---|---|---|
| Atendimentos do dia | Sim | `Conversation`, `Message`, `Contact` | Média | Definir se “atendimento” é conversa criada, conversa aberta ou mensagem humana no dia | A |
| Novas negociações do dia | Parcial | `Contact`, `Conversation`, `CampaignRecipient`, `Opportunity Summary` | Média | Falta entidade formal de Negociação | B |
| Clientes interessados no dia | Parcial | `Contact.temperature`, respostas inbound, botões/campanhas, `Opportunity Summary` | Média | Falta evento explícito de interesse | B |
| Propostas do dia | Sim | `Proposal.createdAt`, `Proposal.status`, `Proposal.product` | Alta | Definir quais statuses contam como simulação/proposta | A |
| Simulações lançadas | Parcial | CLT simulation logs usados pelo Opportunity Summary | Média | Consolidar por produto e expor como métrica operacional | B |
| Contratos do dia | Sim, se status for confiável | `Proposal.status = PAID` ou equivalente | Média/Alta | Confirmar status oficial de contrato realizado por produto | A |
| Conversão do dia | Parcial | `Proposal`, `Campaign`, `CampaignRecipient`, `Contact` | Média | Definir denominador: leads, interessados, propostas ou atendimentos | B |
| Progresso da meta | Não consolidado | Propostas/contratos + futura meta | Baixa | Falta meta diária/mensal formal | B |
| Agendamentos de hoje | Sim | `Task.dueAt`, `Task.status`, `Task.assigneeId` | Alta | Definir tipos/títulos de tarefa quando houver mais categorias | A |
| Agendamentos vencidos | Sim | `Task.dueAt < now`, `status = PENDING` | Alta | Nenhuma para MVP | A |
| Clientes reagendados | Parcial | `Task.updatedAt`, tarefas anteriores, atividades | Baixa/Média | Falta evento claro de reagendamento | B |
| Reagendamentos vencidos/não atendidos | Parcial | `Task` | Média | Diferenciar tarefa comum de retorno combinado | B |
| Clientes esquecidos | Parcial | `Task`, `Conversation`, `Message`, `Opportunity Queue` | Média | Falta regra formal de compromisso não cumprido | B |
| Próximas ações vencidas | Sim, se modeladas como tarefa | `Task.status`, `Task.dueAt` | Alta | Padronizar uso da tarefa como próxima ação | A/B |
| Negociações em risco | Parcial | `Opportunity Queue`, `Opportunity Summary`, `Proposal`, `Task` | Média | Definir regra simples inicial | B |
| Oportunidades prioritárias | Sim | `GET /api/opportunities/queue` | Alta | Apenas decidir recorte visual | A |
| Disparos realizados | Sim | `Campaign`, `CampaignRecipient` | Alta | Nenhuma para quantidade enviada/status | A |
| Respostas aos disparos | Parcial | `CampaignRecipient`, `Conversation`, mensagens inbound | Média | Falta vínculo explícito resposta ↔ campanha em alguns casos | B |
| Contratos atribuídos à campanha | Parcial | `CampaignRecipient.contactId`, `Proposal.contactId` | Média | Atribuição temporal e causal precisa ser definida | B |
| Conversão por campanha | Parcial | `Campaign`, `CampaignRecipient`, `Proposal` | Média | Definir regra de atribuição | B |
| Atendimentos por atendente | Sim | `Conversation.agentId`, `Message.userId`, `Task.assigneeId` | Média/Alta | Definir métrica oficial | A |
| Negociações abertas por atendente | Parcial | `Opportunity Queue`, `Proposal.assignedUserId`, `Conversation.agentId` | Média | Falta entidade Negociação | B |
| Agendamentos por atendente | Sim | `Task.assigneeId` | Alta | Nenhuma para MVP | A |
| Agendamentos vencidos por atendente | Sim | `Task.assigneeId`, `dueAt`, `status` | Alta | Nenhuma para MVP | A |
| Clientes esquecidos por atendente | Parcial | `Task`, `Conversation.agentId`, `Opportunity Queue` | Média | Definir regra de esquecimento | B |
| Contratos por atendente | Sim, se proposta atribuída | `Proposal.assignedUserId`, `status` | Média/Alta | Confirmar preenchimento consistente do responsável | A |
| Conversão por atendente | Parcial | `Proposal`, `Conversation`, `Contact` | Média | Definir denominador | B |
| Origem de lead | Sim | `Contact.origin`, campanhas, canal | Média | Tráfego pago pode exigir padronização de origem | A/B |
| Tags comerciais | Sim | `Contact.tags` | Média | Governança de tags | A |
| Etapa/funil | Sim | `PipelineStage`, `Contact.stageId`, Kanban | Alta | Relacionar etapas ao conceito de Negociação | A/B |
| Diagnóstico de objeções | Não confiável sem IA | Mensagens | Baixa | Exige leitura semântica | C |
| Motivo real de perda | Parcial | `Proposal.status`, histórico, notas | Baixa/Média | Falta resultado estruturado de perda | B/C |
| Mudança de comportamento do mercado | Não | Agregados históricos + IA | Baixa | Exige séries, contexto e IA | C |

## 9. Prioridade de implementação

### Bloco A — Visibilidade imediata

Implementar apenas com dados já existentes:

- atendimentos;
- campanhas;
- propostas;
- contratos;
- tarefas/agendamentos;
- oportunidades prioritárias;
- funil/etapas existentes;
- meta, somente se já houver base confiável.

Objetivo do Bloco A: entregar a primeira Sala de Controle útil sem inventar novo domínio.

### Bloco B — Controle operacional

Adicionar a menor instrumentação necessária para:

- cliente esquecido;
- próxima ação vencida;
- negociação em risco simples;
- agendamentos não cumpridos;
- resultado operacional de ações;
- vínculo mais claro entre campanha, resposta, negociação e contrato.

Objetivo do Bloco B: parar de depender apenas de inferência e começar a registrar compromissos e resultados.

### Bloco C — Inteligência

Depois do MVP em uso:

- IA lendo conversas;
- classificação automática;
- objeções;
- dor;
- próxima ação;
- diagnóstico de perdas;
- tendências;
- recomendações.

Objetivo do Bloco C: transformar histórico operacional em inteligência gestora.

## 10. O que não entra agora

Backlog explícito:

- temperatura;
- energia da negociação;
- estado mental;
- score sofisticado;
- probabilidade de fechamento por IA;
- predição complexa;
- aprendizado automático;
- IA atendendo clientes;
- análise de mercado externa;
- gráficos avançados apenas por estética;
- dashboard separado apenas para BI;
- reconstrução completa do funil;
- schema de Negociação antes da validação do MVP.

## 11. Auditoria técnica curta

### Componentes e serviços atuais encontrados

Dashboard atual:

- `src/app/api/dashboard/route.ts`
- renderização dentro de `src/app/page.tsx`

Motor Comercial:

- `src/app/components/opportunities/MotorCommercialPage.tsx`
- `src/app/components/opportunities/MissionCard.tsx`
- `src/app/components/opportunities/OpportunityGroup.tsx`
- `src/app/components/opportunities/OpportunityItem.tsx`
- `src/app/components/opportunities/opportunity-presentation.ts`

Opportunity Summary:

- `src/lib/opportunity-summary-types.ts`
- `src/lib/opportunity-summary-rules.ts`
- `src/lib/opportunity-summary-service.ts`
- `src/app/api/conversations/[id]/opportunity-summary/route.ts`

Opportunity Queue:

- `src/lib/opportunity-queue-types.ts`
- `src/lib/opportunity-queue-rules.ts`
- `src/lib/opportunity-queue-query.ts`
- `src/lib/opportunity-queue-service.ts`
- `src/app/api/opportunities/queue/route.ts`

Próxima Melhor Ação:

- `src/app/components/opportunities/NextBestActionPage.tsx`
- integração de navegação em `src/app/page.tsx`

Tarefas:

- `src/lib/tasks.ts`
- `src/app/api/tasks/route.ts`
- `src/app/api/tasks/[id]/route.ts`
- modelo `Task`

Propostas:

- `src/lib/proposals.ts`
- `src/app/api/proposals/route.ts`
- `src/app/api/proposals/[id]/route.ts`
- modelos `Proposal` e `ProposalHistory`

Campanhas:

- `src/lib/campaigns.ts`
- `src/app/api/campaigns/route.ts`
- rotas de start/pause/resume/cancel/recipients
- modelos `Campaign` e `CampaignRecipient`

Funil:

- `PipelineStage`
- `Contact.stageId`
- `src/app/api/kanban/route.ts`

### 1. O que já conseguimos reutilizar?

- Opportunity Queue como fonte das oportunidades prioritárias.
- Opportunity Summary como explicação por conversa.
- Task como base de agenda e retornos.
- Proposal como base de propostas, contratos e status de negociação.
- Campaign/CampaignRecipient como base de disparos e destinatários.
- Conversation/Message como base de atendimento, tempo sem resposta e atividade do dia.
- PipelineStage/Contact.stageId como funil operacional inicial.
- Usuários e responsáveis existentes para visão por equipe.

### 2. Menor conjunto de arquivos para a Sala de Controle MVP

Provável primeira implementação:

- `src/app/api/commercial-control/route.ts` ou evolução controlada de `src/app/api/dashboard/route.ts`;
- `src/lib/commercial-control-service.ts`;
- `src/lib/commercial-control-types.ts`;
- `src/app/components/commercial-control/CommercialControlPage.tsx`;
- `src/app/components/commercial-control/*` para blocos pequenos;
- `src/app/page.tsx` apenas para navegação/renderização;
- testes de regras/serviço em `src/lib/commercial-control-service.test.ts`, se o padrão de testes continuar sendo arquivos TypeScript de auditoria/execução manual.

Decisão a tomar: criar rota nova ou evoluir dashboard atual. Produto recomenda rota nova para não misturar o Dashboard existente com a Sala de Controle.

### 3. Existe necessidade de nova rota/API?

Sim, provavelmente.

Motivo: a Sala de Controle precisa consolidar vários domínios em um contrato próprio, diferente do dashboard atual e diferente da Opportunity Queue. A API deve entregar um DTO de leitura operacional, não entidades cruas.

Nome sugerido futuro:

- `GET /api/commercial-control`

Alternativas:

- `GET /api/operations/control-room`
- `GET /api/commercial/overview`

### 4. Métricas com fonte confiável hoje

- tarefas/agendamentos pendentes;
- tarefas/agendamentos vencidos;
- tarefas de amanhã;
- propostas por status;
- contratos se o status `PAID` for a definição oficial;
- campanhas enviadas/status/counters;
- contatos por etapa;
- oportunidades prioritárias via Opportunity Queue;
- conversas abertas/pendentes;
- atendimentos/conversas por responsável, após definição da métrica oficial.

### 5. Métricas que ainda não podem ser exibidas sem instrumentação

- cliente esquecido com alta precisão;
- negociação em risco com contexto real;
- motivo de perda;
- resposta atribuída a campanha com causalidade confiável;
- conversão por campanha sem regra temporal;
- conversão por atendente sem denominador definido;
- meta diária/mensal sem fonte configurável;
- clientes reagendados, se o reagendamento não gera evento claro;
- etapa onde negociações morrem, enquanto Negociação não existir como entidade própria.

### 6. Primeiro bloco recomendado

O primeiro bloco deve ser o **Bloco A — Visibilidade imediata**.

Implementação recomendada:

1. Criar uma API de Sala de Controle que agregue dados existentes.
2. Criar uma página simples e longa com blocos operacionais.
3. Reaproveitar Opportunity Queue para “Quem precisa de atenção agora”.
4. Reaproveitar Task para agenda de hoje, vencidos e amanhã.
5. Reaproveitar Proposal para propostas e contratos do dia.
6. Reaproveitar Campaign para disparos e status de campanhas.

Não começar por IA. Não começar por schema de Negociação. Não começar por gráficos.

## 12. Resultado objetivo do MVP

Ao final da Sala de Controle 1.0, o gestor deve conseguir abrir uma tela e responder:

- meu dia está bom ou ruim?
- quem está parado?
- quem precisa agir agora?
- qual equipe está acumulando risco?
- quais campanhas estão gerando movimento?
- quantas propostas/contratos saíram hoje?
- o que precisa ser feito antes de acabar o expediente?

## 13. Saída para próxima etapa

### Métricas classe A

- agendamentos de hoje;
- agendamentos vencidos;
- agendamentos de amanhã;
- propostas do dia;
- contratos por status oficial;
- campanhas enviadas/status;
- oportunidades prioritárias;
- conversas abertas/pendentes;
- contatos por etapa;
- contratos por responsável quando `assignedUserId` estiver preenchido.

### Métricas classe B

- novas negociações;
- clientes interessados;
- clientes esquecidos;
- negociações em risco;
- respostas atribuídas a campanha;
- conversão por campanha;
- conversão por atendente;
- progresso da meta;
- clientes reagendados;
- etapa onde negociações morrem.

### Métricas classe C

- objeções;
- dor do cliente;
- motivo real de perda por leitura de conversa;
- tendência de mercado;
- probabilidade de fechamento por IA;
- recomendação estratégica avançada;
- diagnóstico executivo generativo.

### Componentes reutilizáveis

- `MotorCommercialPage`
- `OpportunityItem`
- `OpportunityGroup`
- `MissionCard`
- `NextBestActionPage`
- `opportunity-presentation`

Esses componentes podem inspirar a linguagem visual e a explicabilidade, mas a Sala de Controle deve ter componentes próprios para não transformar a fila operacional em dashboard.

### Maior lacuna atual

A maior lacuna é a ausência de uma entidade ou contrato operacional explícito de **Negociação**.

Mesmo assim, o MVP não deve começar criando schema. Deve primeiro validar a utilidade da Sala de Controle com dados existentes e pequenas instrumentações.

### Primeira implementação recomendada

Criar a Sala de Controle 1.0 com dados classe A:

- agenda hoje/vencida/amanhã;
- propostas e contratos do dia;
- campanhas recentes;
- oportunidades prioritárias;
- visão simples por equipe.

### Arquivos prováveis da primeira implementação

- `src/app/api/commercial-control/route.ts`
- `src/lib/commercial-control-types.ts`
- `src/lib/commercial-control-service.ts`
- `src/app/components/commercial-control/CommercialControlPage.tsx`
- `src/app/components/commercial-control/ControlRoomSection.tsx`
- `src/app/components/commercial-control/ControlRoomMetric.tsx`
- `src/app/components/commercial-control/ControlRoomAttentionList.tsx`
- `src/app/page.tsx`

Nenhum desses arquivos deve ser criado sem autorização explícita da próxima sprint.
