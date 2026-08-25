# Atendimento e Conversas

Este documento descreve a arquitetura implementada hoje para Atendimento e Conversas no CRM QEVORA, com base na `origin/main` auditada em 2026-08-24. Ele consolida documentos históricos do snapshot seguro, mas o código atual prevalece sobre qualquer material antigo.

A documentação de produto e UX fica em `../product/`. Este arquivo foca em como a implementação funciona internamente.

## Objetivo do módulo

O módulo de Atendimento concentra a operação diária de conversas comerciais por WhatsApp/Meta. Ele permite listar filas, abrir uma conversa, ler histórico, enviar mensagens, enviar mídia, enviar templates aprovados, administrar tags, acompanhar contexto do contato e executar ações de ownership como assumir, transferir ou devolver atendimento.

A unidade operacional é a `Conversation`. Ela liga um `Contact` a um canal de atendimento, registra mensagens e guarda estado de fila, leitura, atividade recente e responsável atual.

## Principais entidades

### Contact

`Contact` representa o cliente dentro de uma empresa. O atendimento usa principalmente nome, telefone, CPF, e-mail, nota interna, temperatura, origem, etapa de pipeline, responsável comercial, tags, propostas, tarefas e histórico de atividades.

Toda conversa pertence a um contato. O isolamento multiempresa é feito pelo `Contact.companyId`, inclusive em consultas de conversa que usam `contact: { companyId: session.companyId }`.

### Conversation

`Conversation` representa o atendimento em si. Campos relevantes:

- `contactId`: contato atendido;
- `channelId` e `channel`: canal WhatsApp/Meta associado;
- `agentId`: operador responsável atual pela conversa;
- `status`: `OPEN`, `PENDING`, `BOT`, `SOLD` ou `RESOLVED`;
- `unreadCount`, `lastReadAt`, `lastInboundMessageAt`, `lastMessageAt`, `lastMessagePreview`;
- `summary`, `aiMode`, `aiPaused`, `aiLastSuggestion`;
- relação com `Message` e `ConversationTag`.

### Message

`Message` guarda o histórico de comunicação. O atendimento usa direção (`inbound`/`outbound`), tipo (`text`, mídia, `template`), corpo, status, dados de mídia, dados de template, `providerMessageId` e leitura.

### Channel

`Channel` representa o canal WhatsApp/Meta da empresa. O envio usa canais com `type = "whatsapp"`, `provider = "meta"` e status `ACTIVE` ou `CONNECTED`. O sistema valida `companyId`, `phoneNumberId` e token do canal antes de enviar.

### User / agent

`User` representa o operador. Em Conversas, o vínculo operacional principal é `Conversation.agentId`. Perfis administrativos (`ADMIN` e `SUPERVISOR`) têm visibilidade ampla; `AGENT` só acessa conversas sem responsável ou atribuídas a ele.

### Task e Proposal

`Task` e `Proposal` não são mensagens, mas compõem o contexto operacional do atendimento e da IA Observadora. O painel da conversa e o resumo de oportunidade usam essas relações para mostrar pendências, propostas, follow-ups e próximos passos.

### LeadAssignmentHistory

`LeadAssignmentHistory` registra mudanças de ownership como atribuição, transferência, devolução e claims da Próxima Melhor Ação. Nem todo uso de `agentId` significa que o histórico foi criado no mesmo ponto; alguns helpers tratam o histórico como auxiliar.

### NextBestActionEvent

`NextBestActionEvent` registra o lifecycle persistente da IA Observadora: `CLAIMED`, `SKIPPED`, `COMPLETED` e `RETURNED`. O Atendimento se integra a esses eventos por meio da conversa e do `agentId`, mas a documentação detalhada fica em `../observer/`.

## Fluxo de uma conversa

O fluxo principal é:

1. o usuário abre Atendimento;
2. o frontend carrega a lista via `GET /api/conversations`;
3. o operador filtra por status, busca, tags ou fila/responsável;
4. ao selecionar uma conversa, o frontend busca o detalhe via `GET /api/conversations/[id]`;
5. a conversa é marcada como lida via `POST /api/conversations/[id]/read` quando aplicável;
6. o operador envia texto, mídia ou template por endpoints específicos;
7. o backend chama a Meta quando o envio é outbound WhatsApp;
8. a mensagem é persistida localmente;
9. a conversa e o contato recebem os campos de última atividade atualizados;
10. notificações e refreshes mantêm a tela sincronizada.

## Lista de conversas

Endpoint principal:

- `GET /api/conversations`

Parâmetros atuais:

- `search`: busca por nome, telefone ou CPF do contato;
- `status`: filtra status da conversa; padrão `OPEN`; `ALL` remove filtro por status;
- `assignedTo`: aceita `me`, `unassigned`, um user id para admins/supervisores, ou comportamento padrão por permissão;
- `tagId` / `tagIds`: filtra conversas com tags ativas da empresa.

A consulta aplica:

- `Contact.companyId = session.companyId`;
- `Contact.archivedAt = null`;
- visibilidade por `conversationVisibilityWhere(session)`;
- filtro de tags limitado à mesma empresa;
- `conversationListSelect`, que é mais enxuto que o include completo de detalhe;
- ordenação por `lastMessageAt desc nulls last` e depois `createdAt desc`;
- `take: 100`.

O endpoint também calcula `statusCounts` com `groupBy` por status usando o mesmo filtro base, exceto pelo status ativo.

O DTO de lista é produzido por `mapConversationListItem()`. Ele inclui metadados do contato, agente, tags, status, canal, últimas atividades e indicadores, mas retorna `messages: []` e `lastMessage: null` para evitar carregar timeline completa na lista.

## Detalhe da conversa

Endpoint principal:

- `GET /api/conversations/[id]`

O backend busca a conversa por `id` e `contact.companyId`, com `conversationInclude`. Em seguida valida `canAccessConversation()`.

O detalhe carrega:

- contato completo para a tela;
- owner, origem, etapa e tags do contato;
- agente atual;
- tags da conversa;
- mensagens ordenadas por `createdAt asc`;
- metadados de mensagem, mídia, template, status, provider id e leitura.

O mapeamento é feito por `mapConversation()`, que também calcula um preview efetivo da última mensagem quando há divergência entre campos denormalizados e a última mensagem carregada.

## Criação de conversa

Endpoint:

- `POST /api/conversations`

O fluxo aceita `contactId` ou dados mínimos de contato, normaliza telefone e CPF, procura contato existente por identidade telefônica e CPF dentro da empresa, cria contato se necessário, valida canal WhatsApp/Meta elegível e chama `findOrCreateConversationForChannel()`.

A criação evita escolha automática insegura quando há mais de um canal Meta elegível sem `channelId` informado. Nesse caso retorna erro pedindo seleção explícita do canal.

Quando uma conversa nova é criada, o sistema pode chamar `maybeAutoAssignConversation()` para round-robin, dependendo das configurações de distribuição da empresa.

## Envio de mensagem

### Texto

Endpoint:

- `POST /api/conversations/[id]/messages`

Para outbound, o backend:

1. valida sessão;
2. busca a conversa pelo `companyId` da sessão;
3. valida `canAccessConversation()`;
4. resolve o canal com `getConversationIntegration()`;
5. envia texto pela Meta com `sendMetaTextMessage()`;
6. salva a mensagem com `saveOutboundMessage()`.

`saveOutboundMessage()` persiste `Message`, cria `ContactActivity` do tipo `MESSAGE_SENT`, atualiza conversa e `Contact.lastMessage`. Se a conversa não tinha `agentId` e existe `userId`, ela conecta o agente atual.

### Mídia

Endpoint:

- `POST /api/conversations/[id]/messages/media`

O endpoint recebe `multipart/form-data`, valida arquivo obrigatório, tamanho máximo e acesso à conversa. O serviço `sendConversationMedia()` prepara mídia, faz upload para a Meta, envia a mensagem de mídia e persiste o histórico local por `saveOutboundMessage()`.

Em falha, o endpoint tenta registrar uma mensagem local de falha via `saveFailedOutboundMessage()` e retorna erro público seguro.

### Templates

Endpoint:

- `POST /api/conversations/[id]/messages/template`

O endpoint exige `templateName` e `language`, aceita `variables`, valida conversa por empresa e permissão, e delega para `sendConversationTemplate()`.

O serviço de template:

- resolve o canal Meta da conversa;
- busca template local aprovado/ativo/pronto ou template aprovado na Meta;
- valida quantidade de variáveis;
- renderiza o corpo para histórico;
- preserva botões/quick replies no JSON local;
- resolve imagem de header quando o template exige;
- envia para Meta usando `sendMetaTemplateMessage()`;
- salva a mensagem local como `type = "template"`.

O fluxo unitário de templates no Atendimento é separado da administração de templates.

### Mensagens inbound simuladas/admin

O mesmo endpoint de texto aceita `direction` e, quando não é outbound, persiste mensagem recebida, incrementa `unreadCount`, atualiza `lastInboundMessageAt` e cria atividade `MESSAGE_RECEIVED`. O recebimento real de WhatsApp também passa por serviços de inbound fora deste documento.

## Tags, status e leitura

Endpoints:

- `POST /api/conversations/[id]/tags`
- `DELETE /api/conversations/[id]/tags/[tagId]`
- `PATCH /api/conversations/[id]`
- `POST /api/conversations/[id]/read`

Tags são validadas por `companyId` e `isActive`. O modo `replace` remove tags atuais da conversa antes de aplicar a lista válida. A remoção valida conversa e tag na mesma empresa.

Status pode ser atualizado por `PATCH /api/conversations/[id]`, respeitando `canAccessConversation()`.

Marcar como lida atualiza mensagens inbound sem `readAt`, zera `unreadCount` e define `lastReadAt` em uma transação.

## Ownership

`Conversation.agentId` é o ownership operacional atual da conversa.

Regras principais:

- `ADMIN` e `SUPERVISOR` são tratados como administradores em `isAdmin()` e podem enxergar/gerenciar filas mais amplas;
- `AGENT` acessa conversas sem responsável ou atribuídas a ele;
- `canAccessConversation()` bloqueia acesso de agent a conversa atribuída a outro operador;
- `conversationVisibilityWhere()` restringe listagem de agents a `agentId = session.id` ou `agentId = null`.

Endpoints:

- `PATCH /api/conversations/[id]/assign`: permite agent assumir para si; admin/supervisor pode atribuir a usuário elegível;
- `PATCH /api/conversations/[id]/transfer`: exige perfil administrativo e transfere com `force`;
- `PATCH /api/conversations/[id]/unassign`: exige perfil administrativo e remove responsável.

Atribuições passam por `assignConversationToUser()`, que valida empresa e, quando não está em modo forçado, não sobrescreve uma conversa já atribuída a outro atendente. O histórico de atribuição é registrado em `LeadAssignmentHistory` como apoio operacional.

## Integração com IA Observadora

A integração real com a IA Observadora aparece em três pontos:

- `GET /api/conversations/[id]/opportunity-summary`: monta o resumo de oportunidade para uma conversa acessível;
- `POST /api/opportunities/next`: separa `peek` de `claim` da Próxima Melhor Ação;
- `POST /api/opportunities/action`: registra lifecycle persistente de `SKIPPED`, `COMPLETED` e `RETURNED`.

A Opportunity Queue usa conversas, mensagens recentes, tarefas, propostas, campanhas, leads de aposentadoria e simulações CLT para ranquear oportunidades. O detalhe completo da arquitetura e lifecycle da Observadora está em `../observer/README.md` e documentos relacionados.

## Segurança e multi-tenancy

O padrão de isolamento é `session.companyId`.

Práticas observadas no código atual:

- conversas são buscadas por `contact: { companyId: session.companyId }`;
- canais de envio são buscados por `Channel.companyId`, `type = "whatsapp"` e `provider = "meta"`;
- tags de conversa exigem `Tag.companyId` e `ConversationTag.companyId`;
- contatos arquivados são excluídos da lista e criação/seleção normal;
- agents não recebem conversas atribuídas a outro operador;
- erros de envio usam respostas públicas e logging seguro em rotas sensíveis.

Não documentar nem registrar valores de tokens, URLs privadas, telefones, CPFs ou conteúdo real de mensagens nesta documentação.

## Performance

A implementação atual já separa lista e detalhe:

- lista usa `conversationListSelect` e não retorna timeline completa;
- detalhe usa `conversationInclude` com mensagens completas;
- listagem limita a 100 conversas;
- contadores de status são calculados por `groupBy`;
- ordenação usa campos denormalizados de última mensagem;
- schema possui índices para `Conversation.agentId`, `Conversation.status`, `Conversation.lastMessageAt`, `Conversation.contactId/channelId/status`, `Message.conversationId/createdAt`, `ConversationTag` e campos relevantes de `Contact`.

Riscos e plano de medição ficam em `conversation-performance.md`.

## Limitações conhecidas

Limitações confirmadas no código atual:

- a listagem ainda não expõe paginação por cursor; há limite fixo de 100 conversas;
- o detalhe carrega todas as mensagens da conversa;
- filtros de busca usam `contains` em nome, telefone e CPF do contato;
- parte das atualizações em tempo real depende de notificações/SSE e refresh no frontend, não de streaming da própria lista de conversas;
- histórico de atribuição em `lead-assignment.ts` é auxiliar e não bloqueia o atendimento em todos os caminhos.

Informações dos documentos históricos devem permanecer marcadas como históricas até nova medição.

## Relação com documentação de produto

Produto/UX oficiais relacionados:

- `../product/UX-6.1-CONVERSATIONS-AUDIT.md`
- `../product/UX-6.1-CONVERSATIONS-IMPLEMENTATION-ROADMAP.md`
- `../product/specs/UX-001-24H-WINDOW.md`
- `../product/specs/UX-002-CONVERSATION-HEADER.md`
- `../product/specs/UX-003-CONVERSATION-LIST.md`
- `../product/specs/UX-004-CONVERSATION-TIMELINE.md`
- `../product/specs/UX-005-MESSAGE-COMPOSER.md`
- `../product/specs/UX-006-RIGHT-SIDEBAR.md`
- `../product/specs/UX-006A-CROSS-REVIEW-CONVERSATIONS.md`
- `../product/specs/UX-006B-PRODUCT-ARCHITECTURE-REVIEW.md`
- `../product/operations/P-001-OPERATIONAL-PERSONAS.md`

Quando houver diferença entre docs de produto e implementação, trate a documentação de produto como requisito/roadmap e este documento como estado técnico atual.
