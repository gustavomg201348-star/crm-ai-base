# Validação em production

Esta página registra evidências conhecidas de smoke tests já realizados em
production. Ela não contém dados pessoais de clientes.

## Regras de execução

Os smoke tests de production foram feitos com estas restrições:

- mutações somente pela interface normal do CRM;
- Railway/Postgres apenas para leitura;
- nenhum SQL mutante;
- nenhuma alteração manual de `agentId`;
- nenhum `db push`;
- nenhuma migration;
- nenhum deploy;
- nenhum dado fictício criado manualmente em production.

## Smoke tests realizados

### 1. PEEK

Resultado: **PASS**

Verificado:

- abrir a Próxima Melhor Ação apenas visualiza oportunidade;
- não cria `NextBestActionEvent`;
- não altera `Conversation.agentId`;
- não cria `LeadAssignmentHistory`.

### 2. SKIPPED

Resultado: **PASS**

Verificado:

- `NextBestActionEvent.action = SKIPPED`;
- `reason` persistido;
- `assignmentHistoryId = null`;
- `outcome = null`;
- snapshot persistido;
- `idempotencyKey` persistido;
- `suppressedUntil` aproximadamente 4 horas após `createdAt`;
- `Conversation.agentId` não foi alterado;
- não houve assignment.

### 3. CLAIM normal

Estado inicial: conversa sem responsável.

Resultado: **PASS**

Verificado:

- claim executado pela UI;
- responsável deixou de ser “Sem responsável”;
- `Conversation.agentId` foi atribuído ao operador;
- `NextBestActionEvent.action = CLAIMED`;
- `assignmentHistoryId` preenchido;
- `LeadAssignmentHistory` criado;
- snapshot e `idempotencyKey` persistidos;
- UI exibiu “Abrir conversa”, “Concluir” e “Voltar para fila”.

### 4. RETURNED após claim normal

Resultado: **PASS**

Verificado:

- RETURNED executado pela UI;
- novo `NextBestActionEvent.action = RETURNED`;
- CLAIMED anterior permaneceu registrado;
- `Conversation.agentId` voltou para `null`;
- `suppressedUntil` aproximadamente 4 horas após RETURNED;
- `LeadAssignmentHistory` original do claim permaneceu como histórico.

### 5. ALREADY_OWNED + COMPLETED

Resultado: **PENDENTE / PRECONDITION_NOT_AVAILABLE**

Motivo:

- no momento do smoke test não havia oportunidade naturalmente já atribuída ao
  operador autenticado.

Essa ausência de pré-condição não é falha funcional. O cenário foi validado por
testes automatizados:

- conversa já pertencente ao próprio operador cria `CLAIMED` sem histórico;
- `COMPLETED` após ownership preexistente funciona e mantém `agentId`;
- `RETURNED` após ownership preexistente é bloqueado.

Não se deve fabricar ownership apenas para testar esse cenário em production.

## Resultado geral de production

Até esta auditoria:

- PEEK: PASS;
- SKIPPED: PASS;
- CLAIM normal: PASS;
- RETURNED: PASS;
- ALREADY_OWNED + COMPLETED: pendente de pré-condição natural.

## Observações

Os smoke tests confirmam o caminho crítico claim normal + devolução. O caminho
ALREADY_OWNED foi coberto por testes automatizados e deve receber smoke em
production somente quando houver uma oportunidade naturalmente atribuída ao
operador.
