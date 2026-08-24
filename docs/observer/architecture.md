# Arquitetura da IA Observadora

## Visão geral

A IA Observadora é composta por quatro camadas:

1. **Resumo comercial**: transforma dados de conversa/contato em sinais.
2. **Fila de oportunidades**: filtra, ordena, deduplica e pagina candidatos.
3. **Próxima Melhor Ação**: apresenta uma oportunidade por vez e executa claim
   explícito somente após ação do operador.
4. **Lifecycle persistente**: registra o resultado operacional em
   `NextBestActionEvent`.

## A. De onde vêm os candidatos da Opportunity Queue

`listOpportunityQueue()` busca conversas da empresa (`Contact.companyId`) com
sinais comerciais recentes ou relevantes. O candidato primário é uma
`Conversation`, enriquecida pelo respectivo `Contact`.

Filtros iniciais relevantes:

- `Contact.companyId = session.companyId`
- `Contact.archivedAt = null`
- suppression ativa em `NextBestActionEvent` remove conversas elegíveis
- para `AGENT`, apenas conversas próprias ou sem responsável:
  `agentId = requesterId OR agentId = null`
- para `ADMIN` e `SUPERVISOR`, a fila é mais ampla dentro da empresa
- filtros opcionais por responsável, prioridade, produto, limite e cursor

## B. Fontes usadas no cálculo

A fila usa:

- conversas;
- últimas mensagens da conversa;
- tarefas pendentes;
- propostas;
- destinatários de campanhas;
- leads de recém-aposentados;
- simulações CLT recentes;
- tags e etapa do contato;
- owner do contato;
- agente atual da conversa;
- responsável de proposta ativa.

## C. Regras de filtro, classificação e priorização

### Filtragem inicial

`buildCandidateWhere()` limita a busca a conversas com pelo menos um sinal:

- mensagem não lida;
- inbound recente;
- outbound recente indicando espera de cliente;
- contato quente;
- tarefa pendente;
- proposta ativa;
- lead de recém-aposentado ativo;
- simulação CLT recente com sucesso;
- campanha recente.

### Summary

`buildOpportunitySummary()` calcula:

- produto provável;
- estado comercial;
- última interação relevante;
- retorno pendente;
- proposta ativa;
- campanha recente;
- evidências;
- ação recomendada;
- prioridade;
- explicações para UI.

Produtos prováveis atuais:

- `UNKNOWN`
- `FGTS`
- `CLT`
- `INSS`
- `MULTICRED`
- `PORTABILITY`
- `INSURANCE`
- `OTHER`

Evidências atuais:

- `CUSTOMER_REPLIED_RECENTLY`
- `RETURN_OVERDUE`
- `RETURN_SCHEDULED`
- `ACTIVE_PROPOSAL`
- `HOT_CONTACT`
- `UNREAD_MESSAGES`
- `RECENT_CAMPAIGN`
- `HIGH_RETIREMENT_SCORE`
- `RECENT_CLT_SIMULATION`

Ações recomendadas atuais:

- `RESPOND_CUSTOMER`
- `FOLLOW_UP`
- `REVIEW_PROPOSAL`
- `SIMULATE_CLT`
- `SEND_TEMPLATE`
- `WAIT`
- `NO_ACTION`

### Priorização

`sortOpportunityQueueItems()` ordena por:

1. ranking de prioridade (`URGENT`, `HIGH`, `NORMAL`, `LOW`);
2. evidência dominante;
3. timestamp relevante;
4. `updatedAt`;
5. `conversationId` como desempate estável.

Retornos vencidos usam ordenação especial para priorizar os mais antigos.

### Deduplicação

`deduplicateOpportunityQueueByContact()` deduplica por `contact.id`, preservando
a conversa mais prioritária após ordenação.

Limitação: se uma mesma pessoa existir em múltiplos `Contact` distintos por
duplicidade histórica de identidade, ela ainda pode aparecer como mais de uma
oportunidade. A correção de identidade telefônica reduziu novos casos, mas a
deduplicação da fila não resolve merge histórico de contatos.

### Paginação

O cursor é opaco, codificado em base64url, e inclui:

- versão;
- filtros aplicados;
- metadados de ordenação do último item.

Cursor com filtros diferentes é rejeitado.

## D. Diferença entre os módulos

### Opportunity Summary

Resumo de uma conversa individual. Usado no painel de atendimento e na fila para
explicar sinais e ação recomendada.

Endpoint:

- `GET /api/conversations/[id]/opportunity-summary`

### Opportunity Queue

Lista de várias oportunidades comerciais já filtradas, ordenadas e deduplicadas.
Usada no Motor Comercial e como base da NBA.

Endpoint:

- `GET /api/opportunities/queue`

### Próxima Melhor Ação

Experiência de uma oportunidade por vez. O carregamento inicial faz `PEEK` e não
assume a conversa. O claim ocorre somente quando o operador clica em
“Trabalhar esta oportunidade”.

Endpoint:

- `POST /api/opportunities/next`

### Lifecycle da NBA

Registro persistente de ações operacionais posteriores:

- `SKIPPED`
- `COMPLETED`
- `RETURNED`

Endpoint:

- `POST /api/opportunities/action`

## Endpoints

### `GET /api/opportunities/queue`

Autenticação: sessão obrigatória.

Input: querystring com `ownerId`, `priority`, `productType`, `limit`, `cursor`.

Writes: nenhum.

Responsabilidade: retornar a fila carregada para Motor Comercial.

### `POST /api/opportunities/next`

Autenticação: sessão obrigatória.

Input:

- `action`: `peek` ou `claim`;
- `conversationId`: obrigatório para claim;
- `idempotencyKey`: obrigatório para claim;
- `excludeConversationIds`: lista local de exclusões da rodada.

Writes:

- `peek`: nenhum write esperado;
- `claim`: pode atualizar `Conversation.agentId`, criar
  `LeadAssignmentHistory` e criar `NextBestActionEvent`.

### `POST /api/opportunities/action`

Autenticação: sessão obrigatória.

Input:

- `action`: `SKIPPED`, `COMPLETED` ou `RETURNED`;
- `conversationId`;
- `idempotencyKey`;
- `reason` para `SKIPPED`/`RETURNED`;
- `outcome` para `COMPLETED`.

Writes:

- cria `NextBestActionEvent`;
- `RETURNED` também pode liberar `Conversation.agentId` e criar
  `LeadAssignmentHistory` de devolução.

### `GET /api/conversations/[id]/opportunity-summary`

Autenticação: sessão obrigatória.

Valida:

- conversa pertence à empresa;
- contato não está arquivado;
- `canAccessConversation()`.

Writes: nenhum.

## Segurança multi-tenant

As consultas auditadas usam `companyId` direta ou indiretamente por
`Contact.companyId`, `Campaign.companyId`, `Task.companyId`, `Proposal.companyId`,
`RetirementLead.companyId`, `CltSimulationLog.companyId` e `NextBestActionEvent.companyId`.

Pontos importantes:

- claim usa `contact: { companyId }` no `updateMany`;
- lifecycle valida conversa por `contact: { companyId }`;
- suppression consulta `NextBestActionEvent.companyId`;
- filtros por owner validam `User.companyId`;
- summary por conversa filtra `Contact.companyId`.

Nenhum risco multi-tenant crítico foi identificado nesta auditoria.
