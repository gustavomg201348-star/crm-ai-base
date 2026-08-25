# Performance de Conversas

Este documento registra o estado atual da arquitetura de performance do módulo de Conversas na `origin/main` auditada em 2026-08-24. Ele consolida auditorias históricas do snapshot seguro, sem transformar benchmarks locais antigos em verdade de produção.

## Estado atual

A tela de Atendimento usa uma separação explícita entre lista e detalhe:

- a lista vem de `GET /api/conversations`;
- o detalhe vem de `GET /api/conversations/[id]`;
- a lista usa `conversationListSelect`;
- o detalhe usa `conversationInclude`;
- mensagens completas ficam no detalhe, não no DTO de lista.

Essa separação reduz o payload inicial em relação à arquitetura histórica que carregava `messages` completas para cada item da lista.

## Estratégias atuais

### Select enxuto na lista

`conversationListSelect` retorna metadados de conversa, contato, agente e tags suficientes para a lista. O mapper `mapConversationListItem()` devolve `messages: []` e `lastMessage: null`.

A lista usa campos denormalizados como:

- `lastMessageAt`;
- `lastMessagePreview`;
- `lastInboundMessageAt`;
- `lastReadAt`;
- `unreadCount`.

### Limite fixo de listagem

`GET /api/conversations` usa `take: 100` e, depois do mapeamento, mantém o corte em 100 itens. Hoje não há paginação por cursor nesse endpoint.

### Contadores por agregação

O endpoint calcula `statusCounts` com `prisma.conversation.groupBy({ by: ["status"] })`, usando o mesmo filtro base da lista. Isso evita contar status no frontend a partir de conjuntos incompletos.

### Ordenação por atividade

A consulta ordena por `lastMessageAt desc nulls last` e `createdAt desc`. O frontend também possui lógica de ordenação/merge para preservar percepção de atualização quando recebe dados novos.

### Filtros no banco

A lista aplica no banco:

- status;
- ownership/responsável;
- busca por contato;
- tags ativas;
- company isolation;
- contato não arquivado.

### Índices relevantes

Índices confirmados no schema atual:

- `Conversation.contactId`;
- `Conversation.channelId`;
- `Conversation.contactId, channelId, status`;
- `Conversation.agentId`;
- `Conversation.agentId, status, updatedAt`;
- `Conversation.lastMessageAt`;
- `Conversation.status`;
- `Message.conversationId, createdAt`;
- `Message.status`;
- `Message.direction`;
- `Message.providerMessageId`;
- `ConversationTag.conversationId, tagId` como unique;
- `ConversationTag.companyId`, `conversationId`, `tagId`;
- `Contact.companyId`, `phone`, `normalizedPhone`, `cpf`, `updatedAt` e `createdAt`.

### Detalhe sob demanda

`GET /api/conversations/[id]` carrega `conversationInclude`, incluindo mensagens ordenadas por `createdAt asc`. Isso é adequado para abrir uma conversa específica, mas não deve voltar para a listagem em massa.

### Atualizações e notificações

O frontend usa refreshes de conversa/lista e `EventSource` em `/api/notifications/stream` quando disponível. Notificações são carregadas por `/api/notifications` e marcadas como lidas por `PATCH /api/notifications`.

### Envio com persistência local

Envios outbound atualizam campos denormalizados da conversa e `Contact.lastMessage`, permitindo que a lista use esses campos sem depender da timeline completa.

## Histórico de medições

Os documentos históricos usados como referência foram:

- `ATTENDANCE-SCALABILITY-AUDIT.md`;
- `CONVERSATION-LIST-OPTIMIZATION-PLAN.md`;
- `CONVERSATION-METRICS-AUDIT.md`;
- `CONVERSATION-PERFORMANCE-MEASUREMENTS.md`.

Essas medições são históricas/locais. Elas não representam necessariamente a production atual e não devem ser usadas como SLA ou baseline operacional sem nova coleta.

Principais achados históricos já tratados ou parcialmente tratados:

- separação entre DTO de lista e detalhe: tratada parcialmente pela existência de `conversationListSelect`;
- evitar carregar mensagens completas na lista: tratado pelo mapper de lista;
- reduzir payload da listagem: parcialmente tratado;
- preservar detalhe completo sob demanda: mantido.

Principais achados históricos que ainda precisam ser reavaliados:

- custo real de `contains` em busca por nome, telefone e CPF;
- comportamento da lista com mais de 100 conversas relevantes;
- custo do `groupBy` com filtros por tags e ownership em bases grandes;
- custo do detalhe para conversas com timeline muito longa;
- impacto de refreshes/SSE no frontend com muitos operadores simultâneos.

## Riscos atuais

### ALTO

- Detalhe da conversa carrega todas as mensagens. Conversas com histórico muito longo podem gerar payload e renderização pesados.
- Listagem não possui cursor/paginação incremental; o limite fixo de 100 pode ocultar oportunidades fora da janela atual.

### MÉDIO

- Busca com `contains` em campos de contato pode ficar custosa em bases grandes, especialmente sem estratégia de busca normalizada específica.
- Filtros por tags usam relação `ConversationTag`; em alto volume, combinações de tags, status e ownership precisam de benchmark real.
- Atualizações de lista e notificações dependem de refresh/merge no cliente; em operação intensa, isso pode gerar chamadas repetidas.

### BAIXO

- A lista já usa DTO enxuto e campos denormalizados.
- Existem índices relevantes para os filtros principais.
- `statusCounts` é calculado por agregação no banco, não apenas no frontend.

## O que precisa ser medido novamente

Antes de novas otimizações, medir em ambiente controlado parecido com production:

1. tempo de `GET /api/conversations` por combinação de filtros;
2. tempo de `GET /api/conversations/[id]` para conversas com 10, 100, 1.000 e 10.000 mensagens;
3. tamanho de payload da lista e do detalhe;
4. tempo de renderização da lista no navegador;
5. custo do `groupBy` de status;
6. custo de busca textual por nome/telefone/CPF;
7. impacto de múltiplos operadores com SSE/refresh;
8. contagem de queries Prisma por ação crítica;
9. efeitos de índices atuais em PostgreSQL real com `EXPLAIN ANALYZE` somente em ambiente seguro.

Não executar benchmark diretamente em production sem plano aprovado e modo read-only.

## Próximas melhorias candidatas

Não são implementação atual; são candidatos técnicos para fases futuras:

- cursor pagination em `GET /api/conversations`;
- endpoint separado para mensagens paginadas de uma conversa;
- busca normalizada dedicada para telefone/CPF;
- limite ou paginação da timeline;
- telemetria de tamanho de payload e tempo de resposta;
- testes de carga com massa anonimizada;
- política explícita de refresh para reduzir chamadas redundantes.

## Relação com documentos históricos

Os benchmarks históricos ficam preservados no snapshot. Se forem republicados, devem ir para `docs/archive/` ou para um apêndice claramente marcado como histórico/local.
