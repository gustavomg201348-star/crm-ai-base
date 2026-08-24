# Lifecycle da Próxima Melhor Ação

## Conceitos

`Conversation.agentId` é ownership real da conversa no CRM. Ele afeta
Atendimento, acesso do operador, filas e distribuição. Não é usado como claim
temporário descartável.

`NextBestActionEvent` registra o lifecycle operacional da NBA.

`LeadAssignmentHistory` registra atribuição/desatribuição de conversa. Ele ajuda
a provar que um ownership foi criado pela NBA, mas não substitui o lifecycle da
NBA.

## PEEK

PEEK acontece quando a tela de Próxima Melhor Ação carrega ou recarrega a fila.

Fluxo:

1. frontend chama `POST /api/opportunities/next` com `action = "peek"`;
2. backend chama `getNextOpportunityCandidate()`;
3. serviço chama `listOpportunityQueue()`;
4. retorna a primeira candidata visível.

PEEK não:

- altera `Conversation.agentId`;
- cria `LeadAssignmentHistory`;
- cria `NextBestActionEvent`;
- faz qualquer persistência própria da NBA.

Operações Prisma esperadas no PEEK são leituras da fila, incluindo:

- `User.findFirst` quando há filtro por owner;
- `NextBestActionEvent.findMany` para suppression;
- `Conversation.findMany`;
- `Task.findMany`;
- `Proposal.findMany`;
- `CampaignRecipient.findMany`;
- `RetirementLead.findMany`;
- `CltSimulationLog.findMany`.

## CLAIM normal

Cenário:

- `Conversation.agentId = null`;
- operador clica “Trabalhar esta oportunidade”.

Validações e fluxo:

1. endpoint exige sessão;
2. exige `conversationId`;
3. exige `idempotencyKey`;
4. backend recarrega a Opportunity Queue para a empresa/usuário;
5. só permite claim se a `conversationId` enviada corresponder a uma candidata
   elegível naquele momento;
6. em transação, tenta `Conversation.updateMany` com:
   - `id = candidate.conversationId`;
   - `agentId = null`;
   - `contact.companyId = session.companyId`;
7. se `count = 1`, cria `LeadAssignmentHistory`;
8. cria `NextBestActionEvent` com `action = CLAIMED`;
9. retorna `ownershipCreatedByNba = true`.

Concorrência:

- dois operadores competindo pela mesma conversa disputam o `updateMany`;
- apenas um update consegue `count = 1`;
- o outro recebe `TAKEN`/próxima candidata sem sobrescrever ownership.

Evento `CLAIMED` normal:

- `assignmentHistoryId` preenchido;
- snapshot preenchido;
- `idempotencyKey` preenchido;
- sem `suppressedUntil`.

Semântica:

- `assignmentHistoryId` preenchido significa que a NBA criou o ownership.

## Ownership preexistente

Cenário:

- `Conversation.agentId = requesterId`;
- a Opportunity Queue apresenta a conversa ao próprio operador;
- operador clica “Trabalhar esta oportunidade”.

Correção do PR #52:

- `Conversation.agentId` permanece igual;
- não cria `LeadAssignmentHistory`;
- cria `NextBestActionEvent` com `action = CLAIMED`;
- `assignmentHistoryId = null`;
- retorna `ownershipCreatedByNba = false`;
- frontend mostra “Abrir conversa” e “Concluir”;
- frontend não mostra “Voltar para fila”.

Semântica:

- `assignmentHistoryId = null` em `CLAIMED` significa que a conversa já pertencia
  ao operador antes da NBA.

`COMPLETED` é permitido nesse cenário.

`RETURNED` é proibido nesse cenário, porque a NBA não pode remover ownership
legítimo preexistente.

Erro usado para esse bloqueio:

- `NBA_PREEXISTING_OWNERSHIP`
- HTTP 409

## SKIPPED

SKIPPED acontece antes do claim, quando o operador escolhe pular a oportunidade.

Regras:

- exige `reason`;
- não exige claim prévio;
- revalida que a conversa ainda está elegível na Opportunity Queue;
- cria `NextBestActionEvent` com `action = SKIPPED`;
- não altera `Conversation.agentId`;
- não cria `LeadAssignmentHistory`;
- `assignmentHistoryId = null`.

Suppression:

- duração: 4 horas;
- escopo: usuário + conversa dentro da empresa;
- efeito: a mesma conversa fica oculta para o mesmo usuário durante a janela.

## COMPLETED

COMPLETED registra o encerramento da ação operacional.

Regras:

- exige `outcome`;
- exige `CLAIMED` anterior da NBA;
- exige que `Conversation.agentId` ainda seja o operador;
- rejeita se já houver `COMPLETED` ou `RETURNED` depois do claim;
- cria `NextBestActionEvent` com `action = COMPLETED`;
- não remove `Conversation.agentId`.

Para ownership criado pela NBA:

- claim anterior tem `assignmentHistoryId` preenchido;
- valida que o último `LeadAssignmentHistory` ainda é o claim NBA original.

Para ownership preexistente:

- claim anterior tem `assignmentHistoryId = null`;
- valida que não houve `LeadAssignmentHistory` posterior ao claim;
- mantém `Conversation.agentId`.

Suppression:

- duração: 24 horas;
- escopo: global para a conversa dentro da empresa;
- efeito: a conversa não reaparece imediatamente para nenhum usuário da empresa
  enquanto a suppression estiver ativa.

## RETURNED

RETURNED devolve a oportunidade para a fila.

Permitido somente quando:

- existe claim NBA ativo;
- o claim possui `assignmentHistoryId` preenchido;
- o último `LeadAssignmentHistory` ainda é exatamente o claim NBA;
- `Conversation.agentId` ainda é o operador atual.

Fluxo:

1. exige `reason`;
2. valida active claim;
3. rejeita claim com `assignmentHistoryId = null`;
4. em transação:
   - revalida último `LeadAssignmentHistory`;
   - faz `Conversation.updateMany` para `agentId = null`;
   - cria `LeadAssignmentHistory` com `assignedToUserId = null`;
   - cria `NextBestActionEvent` com `action = RETURNED`.

RETURNED nunca deve remover ownership preexistente.

Suppression:

- duração: 4 horas;
- escopo: usuário + conversa dentro da empresa;
- efeito: a conversa fica oculta para o usuário que devolveu durante a janela.

## Stale ownership

Proteção de stale ownership cobre cenários como:

1. NBA atribui conversa ao operador A;
2. outro fluxo ou supervisor atribui a conversa ao operador B;
3. A tenta concluir ou devolver.

O backend compara:

- `Conversation.agentId`;
- último `LeadAssignmentHistory`;
- `assignmentHistoryId` do claim;
- `assignedToUserId`;
- `mode = NEXT_BEST_ACTION`;
- `action = CLAIMED`;
- presença de eventos finais depois do claim.

Erros principais:

- `STALE_OWNERSHIP`, HTTP 409;
- `NBA_CLAIM_REQUIRED`, HTTP 409;
- `NBA_ALREADY_RESOLVED`, HTTP 409;
- `NBA_PREEXISTING_OWNERSHIP`, HTTP 409.

Quando stale ownership é detectado, a ação é rejeitada e não deve ocorrer
remoção indevida de ownership.

## Idempotência

Todas as ações persistidas exigem `idempotencyKey`.

Constraint:

- `@@unique([companyId, idempotencyKey])`

Comportamento:

- mesma chave + mesma ação retorna resultado idempotente;
- mesma chave em outra ação/oportunidade retorna conflito;
- P2002 em create é tratado consultando novamente o evento por chave;
- duplo clique é mitigado pelo frontend (`claimLoading`/`actionLoading`) e pela
  constraint no banco.

Prefixos gerados no frontend:

- `nba-claim-<conversationId>-<uuid>`
- `nba-skip-<conversationId>-<uuid>`
- `nba-complete-<conversationId>-<uuid>`
- `nba-return-<conversationId>-<uuid>`

## NextBestActionEvent

Campos:

- `id`: identificador do evento.
- `companyId`: isolamento multiempresa.
- `conversationId`: conversa da oportunidade.
- `contactId`: contato relacionado.
- `userId`: usuário que executou a ação.
- `assignmentHistoryId`: vínculo opcional com atribuição criada pela NBA.
- `action`: `CLAIMED`, `SKIPPED`, `COMPLETED` ou `RETURNED`.
- `reason`: motivo textual para `SKIPPED`/`RETURNED`.
- `outcome`: resultado escolhido em `COMPLETED`.
- `opportunityReason`: snapshot do motivo da fila.
- `recommendedAction`: snapshot da ação recomendada.
- `probableProduct`: snapshot do produto provável.
- `priority`: snapshot da prioridade.
- `idempotencyKey`: chave única por empresa.
- `suppressedUntil`: fim da suppression, quando aplicável.
- `createdAt`: data de criação.

Uniques:

- `assignmentHistoryId` único;
- `(companyId, idempotencyKey)` único.

Índices:

- `(companyId, conversationId, createdAt)`;
- `(companyId, contactId, createdAt)`;
- `(companyId, userId, createdAt)`;
- `(companyId, action, createdAt)`;
- `(companyId, suppressedUntil)`.

FKs:

- `companyId -> Company.id`;
- `conversationId -> Conversation.id`;
- `contactId -> Contact.id`;
- `userId -> User.id`;
- `assignmentHistoryId -> LeadAssignmentHistory.id` com `ON DELETE SET NULL`.

## LeadAssignmentHistory

Papel real:

- registra histórico de atribuição/desatribuição;
- não é o lifecycle completo da NBA.

NBA cria `LeadAssignmentHistory` quando:

- claim normal atribui conversa sem responsável;
- returned libera conversa que tinha sido atribuída pela NBA.

NBA não cria `LeadAssignmentHistory` quando:

- claim é `ALREADY_OWNED`;
- SKIPPED;
- COMPLETED.

O vínculo com `NextBestActionEvent.assignmentHistoryId` prova que o ownership
foi criado pela NBA e permite RETURNED seguro.
