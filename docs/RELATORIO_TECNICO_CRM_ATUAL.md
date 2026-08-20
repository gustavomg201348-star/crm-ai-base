# Relatorio tecnico do CRM atual

Data da analise: 2026-06-04

Este documento descreve o estado atual do CRM `crm-ai-base` com base no codigo presente no repositorio. O objetivo e orientar planejamento de nova arquitetura, novos modulos, refatoracoes e estrategia de escala sem criar retrabalho.

## 1. Stack do projeto

### Frontend

- Next.js 14.2 com App Router.
- React 18.
- TypeScript.
- Tailwind CSS.
- Componentizacao atual concentrada principalmente em `src/app/page.tsx`.
- Icones via `lucide-react`.
- UI em uma unica SPA logada, com estado local React e chamadas `fetch` para rotas internas `/api`.

### Backend

- Backend implementado dentro do proprio Next.js, usando Route Handlers em `src/app/api/**/route.ts`.
- Runtime Node.js para rotas que precisam de arquivo, Prisma, crypto, upload e integracao externa.
- Nao ha API separada em Express/Nest/Fastify.

### Banco de dados

- Desenvolvimento local: SQLite via `prisma/schema.prisma`.
- Producao: PostgreSQL via `prisma/schema.postgres.prisma`.
- Banco em producao hospedado no Railway Postgres.

### ORM

- Prisma 5.22.
- Cliente Prisma centralizado em `src/lib/db.ts`.
- Scripts:
  - `npm run prisma:push`
  - `npm run prisma:seed`
  - `npm run prisma:migrate:prod`

### Autenticacao

- Autenticacao propria, sem NextAuth.
- Login via `/api/auth/login`.
- Senhas com PBKDF2 SHA-512, salt aleatorio e `timingSafeEqual`.
- Sessao em cookie `crm_session`.
- Token de sessao assinado com HMAC SHA-256 usando `AUTH_SECRET`.
- Expiracao atual: 7 dias.
- Cookie `httpOnly`, `sameSite=lax`, `secure` em producao.
- Perfis atuais: `ADMIN`, `SUPERVISOR`, `AGENT`.

### Hospedagem atual

- Railway.
- Arquivos relacionados:
  - `railway.toml`
  - `Dockerfile`
  - `docker-compose.production.yml`
  - `docs/DEPLOY.md`
- Fluxo de deploy por GitHub.
- Startup Railway executa `prisma migrate deploy` de producao de forma bloqueante via `scripts/railway-start.mjs`.
- Seed nao roda automaticamente em producao.

### Servicos externos integrados

- Meta WhatsApp Cloud API.
- OpenAI Responses API.
- Railway.
- Webhook Meta WhatsApp.
- Modulo CLT/New Corban parcialmente simulado/preparado.

### Filas/jobs

- Nao existe fila persistente dedicada.
- Nao ha BullMQ, RabbitMQ, SQS, Kafka ou worker separado.
- Disparos sao processados no proprio request do endpoint quando a campanha e criada/iniciada.
- Existe controle simples de intervalo por `CAMPAIGN_DISPATCH_INTERVAL_SECONDS`.
- Risco: request longo, timeout, duplicidade operacional e baixa resiliencia em volume alto.

### Redis

- Nao existe Redis configurado.
- Notificacoes em tempo real usam memoria local do processo e Server-Sent Events.
- Configuracoes de disponibilidade/distribuicao possuem fallback em memoria caso Prisma falhe.

### IA utilizada

- OpenAI Responses API.
- Modelo padrao: `gpt-4o-mini`, configuravel por `OPENAI_MODEL`.
- Chave: `OPENAI_API_KEY`.
- Modos de IA:
  - `OFF`
  - `COPILOT`
  - `AUTO`
  - `HYBRID`

### WhatsApp utilizado

- WhatsApp Cloud API oficial da Meta.
- Envio de:
  - texto
  - imagem
  - audio
  - documento
  - video
  - template aprovado
- Webhook:
  - verificacao GET pelo token `META_VERIFY_TOKEN`
  - recebimento POST
  - assinatura opcional por `META_APP_SECRET`

## 2. Estrutura de pastas

```text
/
├─ src/
│  ├─ app/
│  │  ├─ api/
│  │  ├─ globals.css
│  │  ├─ layout.tsx
│  │  └─ page.tsx
│  └─ lib/
├─ prisma/
├─ scripts/
├─ docs/
├─ Dockerfile
├─ docker-compose.production.yml
├─ railway.toml
├─ package.json
├─ tailwind.config.ts
├─ next.config.mjs
└─ tsconfig.json
```

### `src/app`

Contem a aplicacao Next.js.

- `page.tsx`: tela principal do CRM. Hoje concentra muitas responsabilidades: login, layout, dashboard, atendimento, contatos, canais, disparos, tags, empresas, usuarios, IA, CLT e configuracoes.
- `layout.tsx`: layout raiz.
- `globals.css`: estilos globais Tailwind.
- `api/`: backend do CRM via Route Handlers.

### `src/app/api`

Rotas internas do backend. Principais grupos:

- `auth`: login, logout e sessao.
- `admin/companies`: multiempresa/tenants.
- `channels`: canais WhatsApp/Meta.
- `webhooks/whatsapp`: webhook oficial Meta.
- `conversations`: conversas, mensagens, IA, midia, templates, leitura, tags e atribuicao.
- `contacts`: contatos, importacao/exportacao/bulk e atividades.
- `campaigns`: disparos/campanhas.
- `imports/contacts`: importacao por planilha com preview/confirmacao.
- `notifications`: notificacoes e stream SSE.
- `settings`: tags, usuarios, IA, origens, etapas e distribuicao.
- `clt`: simulacao CLT e integracoes.
- `tasks`: tarefas.
- `dashboard`: indicadores.
- `health` e `system/readiness`: saude e prontidao.

### `src/lib`

Camada de dominio/servicos. Principais arquivos:

- `auth.ts`: hash de senha, sessao e cookies.
- `permissions.ts`: roles, guards e visibilidade de conversa.
- `db.ts`: Prisma Client.
- `meta-whatsapp.ts`: funcoes diretas da Graph API.
- `meta-whatsapp-diagnostics.ts`: validacao de token, WABA, numero e webhook.
- `inbound-message.ts`: processamento de mensagem recebida.
- `conversation-message.service.ts`: integracao da conversa com canal e persistencia outbound.
- `whatsapp-media.service.ts`: upload e envio de midias.
- `whatsapp-template.service.ts`: busca/envio de templates aprovados.
- `message-delivery.ts`: atualizacao de status de mensagens.
- `campaigns.ts`: processamento de disparos.
- `contact-import.service.ts`: preview e confirmacao de importacao CSV/XLSX.
- `lead-assignment.ts`: disponibilidade, filas e distribuicao.
- `ai-attendant.service.ts`: IA copiloto/auto/hibrida.
- `ai-analysis.ts`: analise fallback local.
- `notifications.ts`: criacao/mapa de notificacoes.
- `notification-stream.ts`: SSE em memoria.
- `contacts.ts`, `conversations.ts`, `tasks.ts`, `proposals.ts`, `activities.ts`: mapeadores e helpers.
- `clt-integration.ts`, `clt-settings.ts`, `clt-logs.ts`: modulo CLT.
- `company-tenant.service.ts`: empresas/tenants.
- `mock-data.ts`: navegacao e dados de apresentacao.

### `prisma`

- `schema.prisma`: schema SQLite local.
- `schema.postgres.prisma`: schema PostgreSQL de producao.
- `seed.mjs`: seed inicial.
- `setup-sqlite.mjs`: preparacao local.
- `retry-command.mjs`: retry para comandos de deploy Railway.

### `scripts`

- `railway-start.mjs`: start/ajustes para Railway.

### `docs`

- Documentacao de deploy.
- Ebooks/artefatos de disparos WhatsApp ainda nao rastreados no Git no momento da analise.
- Este relatorio tecnico.

## 3. Banco de dados

Os modelos abaixo existem tanto no schema SQLite quanto no schema PostgreSQL.

### Company

Representa uma empresa/tenant.

Campos:

- `id String @id @default(cuid())`
- `name String`
- `email String?`
- `phone String?`
- `segment String?`
- `aiMode String @default("COPILOT")`
- `aiInstructions String?`
- `createdAt DateTime @default(now())`

Relacionamentos:

- `users User[]`
- `contacts Contact[]`
- `channels Channel[]`
- `campaigns Campaign[]`
- `notifications Notification[]`
- `tags Tag[]`
- `conversationTags ConversationTag[]`
- `stages PipelineStage[]`
- `origins Origin[]`
- `proposals Proposal[]`
- `tasks Task[]`
- `cltIntegrations CltIntegration[]`
- `cltSimulationLogs CltSimulationLog[]`
- `userAvailabilities UserAvailability[]`
- `leadAssignmentSettings LeadAssignmentSetting[]`
- `leadAssignmentHistory LeadAssignmentHistory[]`

Indices:

- Nenhum indice explicito alem da chave primaria.

### Channel

Canal de atendimento, hoje focado em WhatsApp.

Campos:

- `id String @id @default(cuid())`
- `companyId String`
- `name String`
- `type String @default("whatsapp")`
- `provider String @default("sandbox")`
- `externalId String?`
- `phoneNumberId String?`
- `wabaId String?`
- `displayPhone String?`
- `accessToken String?`
- `verifyToken String?`
- `appSecret String?`
- `status String @default("ACTIVE")`
- `lastWebhookSubscribedAt DateTime?`
- `lastWebhookReceivedAt DateTime?`
- `createdAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt`

Relacionamentos:

- `company Company`
- `campaigns Campaign[]`

Indices:

- `@@index([companyId])`

Observacao critica:

- Tokens sao armazenados no banco como texto. Para revenda/escala, recomenda-se criptografia em repouso por campo ou cofre de segredos.

### User

Usuario da empresa.

Campos:

- `id String @id @default(cuid())`
- `companyId String`
- `name String`
- `email String @unique`
- `passwordHash String`
- `role String @default("AGENT")`
- `avatar String?`
- `createdAt DateTime @default(now())`

Relacionamentos:

- `company Company`
- `contacts Contact[]`
- `conversations Conversation[]`
- `activities ContactActivity[]`
- `campaigns Campaign[]`
- `notifications Notification[]`
- `tasks Task[]`
- `createdConversationTags ConversationTag[]`
- `cltSimulationLogs CltSimulationLog[]`
- `availability UserAvailability?`
- `assignedLeadHistory LeadAssignmentHistory[]`
- `createdLeadAssignments LeadAssignmentHistory[]`

Indices:

- `@@index([companyId])`
- `email` unico global.

Observacao critica:

- E-mail unico global impede duas empresas terem usuario com o mesmo e-mail. Isso pode ser desejado, mas precisa ser decisao consciente para SaaS.

### UserAvailability

Status operacional do atendente.

Campos:

- `userId String @id`
- `companyId String`
- `status String @default("OFFLINE")`
- `lastSeenAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt`

Relacionamentos:

- `company Company`
- `user User`

Indices:

- `@@index([companyId])`
- `@@index([status])`

### LeadAssignmentSetting

Configuracao de distribuicao de leads por empresa.

Campos:

- `id String @id @default(cuid())`
- `companyId String`
- `mode String @default("CLAIM_FIRST")`
- `onlineOnly Boolean @default(true)`
- `maxOpenPerAttendant Int?`
- `allowAttendantClaim Boolean @default(true)`
- `redistributeWhenOffline Boolean @default(false)`
- `createdAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt`

Relacionamentos:

- `company Company`

Indices:

- `@@unique([companyId])`

### LeadAssignmentHistory

Historico de atribuicao/transferencia/devolucao.

Campos:

- `id String @id @default(cuid())`
- `companyId String`
- `conversationId String`
- `assignedToUserId String?`
- `assignedByUserId String?`
- `mode String`
- `action String @default("ASSIGNED")`
- `createdAt DateTime @default(now())`

Relacionamentos:

- `company Company`
- `conversation Conversation`
- `assignedTo User?`
- `assignedBy User?`

Indices:

- `@@index([companyId])`
- `@@index([conversationId])`
- `@@index([assignedToUserId])`
- `@@index([assignedByUserId])`

### Contact

Contato/lead.

Campos:

- `id String @id @default(cuid())`
- `companyId String`
- `ownerId String?`
- `stageId String?`
- `originId String?`
- `name String`
- `phone String`
- `email String?`
- `cpf String?`
- `temperature String @default("WARM")`
- `lastMessage String?`
- `archivedAt DateTime?`
- `createdAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt`

Relacionamentos:

- `company Company`
- `owner User?`
- `stage PipelineStage?`
- `origin Origin?`
- `tags ContactTag[]`
- `conversations Conversation[]`
- `campaignRecipients CampaignRecipient[]`
- `proposals Proposal[]`
- `activities ContactActivity[]`
- `tasks Task[]`
- `notifications Notification[]`
- `cltSimulationLogs CltSimulationLog[]`

Indices:

- `@@index([companyId])`
- `@@index([ownerId])`
- `@@index([stageId])`
- `@@index([originId])`

Observacao critica:

- Nao ha indice/unique composto em `(companyId, phone)` ou `(companyId, cpf)`. Isso e importante para 500k+ leads.

### ContactActivity

Historico de atividades do contato.

Campos:

- `id String @id @default(cuid())`
- `contactId String`
- `userId String?`
- `type String`
- `title String`
- `detail String?`
- `createdAt DateTime @default(now())`

Relacionamentos:

- `contact Contact`
- `user User?`

Indices:

- `@@index([contactId])`
- `@@index([userId])`

### Task

Tarefas/follow-ups.

Campos:

- `id String @id @default(cuid())`
- `companyId String`
- `contactId String`
- `assigneeId String?`
- `title String`
- `note String?`
- `dueAt DateTime`
- `status String @default("PENDING")`
- `completedAt DateTime?`
- `createdAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt`

Relacionamentos:

- `company Company`
- `contact Contact`
- `assignee User?`

Indices:

- `@@index([companyId])`
- `@@index([contactId])`
- `@@index([assigneeId])`
- `@@index([dueAt])`

### Tag

Tag visual de organizacao.

Campos:

- `id String @id @default(cuid())`
- `companyId String`
- `name String`
- `color String`
- `textColor String? @default("#ffffff")`
- `category String?`
- `isActive Boolean @default(true)`
- `createdAt DateTime @default(now())`
- `updatedAt DateTime @default(now()) @updatedAt`

Relacionamentos:

- `company Company`
- `contacts ContactTag[]`
- `conversations ConversationTag[]`

Indices:

- `@@index([companyId])`

Observacao:

- Nao ha unique para nome por empresa. Pode permitir tags duplicadas.

### ContactTag

Tabela de ligacao N:N entre contato e tag.

Campos:

- `contactId String`
- `tagId String`

Relacionamentos:

- `contact Contact`
- `tag Tag`

Indices:

- `@@id([contactId, tagId])`

### Origin

Origem do lead.

Campos:

- `id String @id @default(cuid())`
- `companyId String`
- `name String`

Relacionamentos:

- `company Company`
- `contacts Contact[]`

Indices:

- `@@index([companyId])`

### PipelineStage

Etapa do funil.

Campos:

- `id String @id @default(cuid())`
- `companyId String`
- `name String`
- `color String`
- `position Int`

Relacionamentos:

- `company Company`
- `contacts Contact[]`

Indices:

- `@@index([companyId])`

### Conversation

Conversa de atendimento.

Campos:

- `id String @id @default(cuid())`
- `contactId String`
- `agentId String?`
- `status String @default("OPEN")`
- `channel String @default("whatsapp")`
- `summary String?`
- `aiMode String?`
- `aiPaused Boolean @default(false)`
- `aiLastSuggestion String?`
- `unreadCount Int @default(0)`
- `lastMessageAt DateTime?`
- `lastMessagePreview String?`
- `lastInboundMessageAt DateTime?`
- `lastReadAt DateTime?`
- `createdAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt`

Relacionamentos:

- `contact Contact`
- `agent User?`
- `messages Message[]`
- `notifications Notification[]`
- `tags ConversationTag[]`
- `assignmentHistory LeadAssignmentHistory[]`

Indices:

- Nenhum indice explicito.

Observacao critica:

- Faltam indices para escala em `contactId`, `agentId`, `status`, `updatedAt`, `lastMessageAt`. Em milhoes de mensagens/conversas isso vira gargalo.

### ConversationTag

Ligacao entre conversa e tag.

Campos:

- `id String @id @default(cuid())`
- `companyId String`
- `conversationId String`
- `tagId String`
- `createdByUserId String?`
- `createdAt DateTime @default(now())`

Relacionamentos:

- `company Company`
- `conversation Conversation`
- `tag Tag`
- `createdBy User?`

Indices:

- `@@unique([conversationId, tagId])`
- `@@index([companyId])`
- `@@index([conversationId])`
- `@@index([tagId])`
- `@@index([createdByUserId])`

### Message

Mensagem da conversa.

Campos:

- `id String @id @default(cuid())`
- `conversationId String`
- `direction String`
- `body String`
- `type String @default("text")`
- `mediaUrl String?`
- `mediaId String?`
- `fileName String?`
- `mimeType String?`
- `templateName String?`
- `templateLanguage String?`
- `templateVariables String?`
- `status String @default("sent")`
- `providerMessageId String?`
- `readAt DateTime?`
- `senderType String?`
- `createdAt DateTime @default(now())`

Relacionamentos:

- `conversation Conversation`

Indices:

- `@@index([providerMessageId])`

Observacao critica:

- Faltam indices em `conversationId`, `createdAt`, `direction`, `status`. Para milhoes de mensagens, leitura de historico e logs vai degradar.

### Notification

Notificacoes internas/desktop.

Campos:

- `id String @id @default(cuid())`
- `companyId String`
- `userId String?`
- `conversationId String`
- `contactId String?`
- `channelId String?`
- `title String`
- `message String`
- `type String @default("NEW_INBOUND_MESSAGE")`
- `channelLabel String?`
- `readAt DateTime?`
- `createdAt DateTime @default(now())`

Relacionamentos:

- `company Company`
- `user User?`
- `conversation Conversation`
- `contact Contact?`

Indices:

- `@@index([companyId, createdAt])`
- `@@index([companyId, readAt])`
- `@@index([userId])`
- `@@index([conversationId])`
- `@@index([contactId])`

### Campaign

Campanha/disparo.

Campos:

- `id String @id @default(cuid())`
- `companyId String`
- `channelId String`
- `createdById String?`
- `name String`
- `message String`
- `messageType String @default("TEXT")`
- `templateName String?`
- `templateLanguage String?`
- `templateVariables String?`
- `imagePath String?`
- `imageName String?`
- `imageMime String?`
- `imageSize Int?`
- `status String @default("PENDING")`
- `total Int @default(0)`
- `sent Int @default(0)`
- `delivered Int @default(0)`
- `failed Int @default(0)`
- `createdAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt`
- `startedAt DateTime?`
- `finishedAt DateTime?`

Relacionamentos:

- `company Company`
- `channel Channel`
- `createdBy User?`
- `recipients CampaignRecipient[]`

Indices:

- `@@index([companyId])`
- `@@index([channelId])`
- `@@index([createdById])`

### CampaignRecipient

Destinatario de campanha.

Campos:

- `id String @id @default(cuid())`
- `campaignId String`
- `contactId String`
- `conversationId String?`
- `phone String`
- `status String @default("PENDING")`
- `providerMessageId String?`
- `errorCode String?`
- `errorMessage String?`
- `sentAt DateTime?`
- `deliveredAt DateTime?`
- `failedAt DateTime?`
- `createdAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt`

Relacionamentos:

- `campaign Campaign`
- `contact Contact`

Indices:

- `@@unique([campaignId, contactId])`
- `@@index([contactId])`
- `@@index([conversationId])`
- `@@index([providerMessageId])`
- `@@index([status])`

### Proposal

Proposta financeira.

Campos:

- `id String @id @default(cuid())`
- `companyId String`
- `contactId String`
- `bank String`
- `agreement String`
- `product String`
- `amount Decimal`
- `commission Decimal`
- `status String @default("DRAFT")`
- `createdAt DateTime @default(now())`

Relacionamentos:

- `company Company`
- `contact Contact`

Indices:

- Nenhum indice explicito.

### CltIntegration

Configuracao de integracao CLT por banco.

Campos:

- `id String @id @default(cuid())`
- `companyId String`
- `bankId String`
- `bankName String`
- `provider String @default("manual")`
- `baseUrl String?`
- `authType String @default("none")`
- `apiKey String?`
- `username String?`
- `password String?`
- `newcorbanIdentifier String?`
- `digitadorCode String?`
- `certifiedAgentCpf String?`
- `actingUf String?`
- `smsStatus String?`
- `smsRequestedAt DateTime?`
- `status String @default("MANUAL")`
- `lastTestAt DateTime?`
- `lastTestStatus String?`
- `lastTestMessage String?`
- `createdAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt`

Relacionamentos:

- `company Company`

Indices:

- `@@unique([companyId, bankId])`
- `@@index([companyId])`
- `@@index([status])`

Observacao:

- Senha/token bancario tambem ficam em texto. Deve ser criptografado antes de uso comercial pesado.

### CltSimulationLog

Auditoria de simulacao CLT.

Campos:

- `id String @id @default(cuid())`
- `companyId String`
- `userId String?`
- `contactId String?`
- `bankId String?`
- `bankName String?`
- `action String`
- `cpf String?`
- `phone String?`
- `status String @default("SUCCESS")`
- `message String?`
- `inputJson String?`
- `outputJson String?`
- `createdAt DateTime @default(now())`

Relacionamentos:

- `company Company`
- `user User?`
- `contact Contact?`

Indices:

- `@@index([companyId, createdAt])`
- `@@index([userId])`
- `@@index([contactId])`
- `@@index([bankId])`
- `@@index([status])`

## 4. Modulos existentes

### Dashboard

Status: funcionando.

Funcionalidades:

- Indicadores operacionais.
- Conversas abertas.
- Leads ativos.
- Propostas.
- Conversao.
- Prioridades do dia.
- Funil de leads.
- Cards e filtros por periodo/origem/responsavel.

Limitacoes:

- Analytics ainda calculado de forma operacional simples.
- Nao ha data warehouse, agregacoes materializadas ou cache.

### Atendimento/conversas

Status: funcionando.

Funcionalidades:

- Lista de conversas.
- Chat com texto, imagem, audio, documento e templates.
- Composer com emoji, anexo, microfone e templates.
- Conversa com status `OPEN`, `PENDING`, `BOT`, `SOLD`, `RESOLVED`.
- Nao lidas por conversa.
- Marcacao de leitura.
- Assumir, devolver e transferir atendimento.
- Filtros por status, fila e tags.
- Painel Copiloto IA recolhivel.
- Sidebar principal recolhivel.

Limitacoes:

- Polling de conversa a cada 3 segundos no frontend.
- Tempo real completo ainda nao usa Socket.IO; usa SSE para notificacoes.
- Historico carrega mensagens junto da conversa sem paginacao robusta.

### WhatsApp/Meta

Status: funcionando para Cloud API.

Funcionalidades:

- Cadastro de canais Meta.
- Edicao de canal.
- Validacao de token, permissoes, WABA e numero.
- Assinatura automatica de webhook.
- Envio de texto, midia e template.
- Recebimento via webhook.
- Status de entrega via webhook.
- Logs/painel de status em Canais.

Limitacoes:

- Tokens armazenados em texto.
- Canal e vinculo da conversa usam `channel` string como `whatsapp:{channelId}` em vez de FK formal.
- Falta tabela propria de webhook diagnostics/eventos brutos.

### Campanhas/disparos

Status: funcionando, mas com fila simples.

Funcionalidades:

- Selecionar contatos.
- Importar planilha para base.
- Mensagem livre.
- Template aprovado Meta.
- Imagem com legenda.
- Variaveis `{{nome}}`, `{{cpf}}`, `{{telefone}}`.
- Status por destinatario.
- Pausar, retomar, cancelar e iniciar.

Limitacoes:

- Processamento ocorre no request/servidor Next, nao em worker.
- Sem fila persistente.
- Sem retry estruturado.
- Sem controle avancado de taxa por canal/WABA/limite Meta.

### Importacao de contatos

Status: funcionando.

Funcionalidades:

- CSV.
- XLSX.
- Preview.
- Confirmacao.
- Normalizacao CPF/telefone.
- Deteccao de duplicados na planilha.
- Atualizacao de contato existente por CPF ou telefone.
- Criacao de atividades.

Limitacoes:

- Nao ha tabela `ImportBatch`; historico fica em atividades e retorno da operacao.
- Para arquivos muito grandes, leitura em memoria pode pesar.

### IA/Copiloto

Status: funcionando em primeira versao.

Funcionalidades:

- Gerar resposta sugerida.
- Resumo.
- Temperatura.
- Proxima acao.
- Tags sugeridas.
- Modo automatico/hibrido.
- Fallback local se OpenAI nao responder.

Limitacoes:

- Prompt embutido no codigo.
- Sem versionamento de prompt.
- Sem auditoria dedicada de respostas IA.
- Sem RAG/base de conhecimento estruturada.
- Sem avaliacao automatizada de qualidade.

### Funil/Kanban

Status: parcialmente funcionando.

Funcionalidades:

- Etapas configuraveis via `PipelineStage`.
- Contatos vinculados a etapa.
- Kanban consulta dados.

Limitacoes:

- Automacoes de mudanca de etapa ainda limitadas.
- Lead muda de etapa principalmente por edicao/operacao manual.
- Sem historico formal de movimentacao de etapa.

### Contatos

Status: funcionando.

Funcionalidades:

- CRUD.
- Filtros.
- Tags.
- Origem.
- Responsavel.
- Temperatura.
- Historico de atividades.
- Import/export/bulk.

Limitacoes:

- Sem indice unico por CPF/telefone por tenant.
- Sem deduplicacao transacional forte para alta concorrencia.

### Tarefas

Status: funcionando basico.

Funcionalidades:

- Criar tarefa.
- Atribuir a usuario.
- Data de vencimento.
- Status pendente/concluida.
- Exibir em dashboard e endpoints.

Limitacoes:

- Sem notificacao especifica de vencimento.
- Sem recorrencia.
- Sem SLA.

### Tags

Status: funcionando.

Funcionalidades:

- CRUD de tags.
- Cores.
- Ativo/inativo.
- Categoria.
- Contagem de uso.
- Vinculo com contatos.
- Vinculo com conversas.
- Filtro por tags em atendimento.

Limitacoes:

- Sem unique por nome/tenant.
- Permissao atual de gestao usa admin/supervisor em algumas areas e admin em rotas de settings.

### Distribuicao de leads

Status: funcionando em versao inicial.

Funcionalidades:

- Status do atendente: `ONLINE`, `BUSY`, `OFFLINE`, `PAUSED`.
- Modos: `CLAIM_FIRST`, `ROUND_ROBIN`, `ADMIN_MANUAL`.
- Assumir atendimento.
- Transferir.
- Devolver para fila.
- Historico.
- Filtro de fila.

Limitacoes:

- Nao ha lock distribuido/Redis.
- Concorrencia resolvida via transacao Prisma simples.
- Nao ha evento em tempo real completo para todos os usuarios alem de notificacoes.

### Multiempresa/tenants

Status: funcionando em primeira versao.

Funcionalidades:

- `Company`.
- Admin master por `PLATFORM_ADMIN_EMAILS` ou `PLATFORM_COMPANY_ID`.
- Criacao de empresa com admin.
- Dados filtrados por `companyId` na maioria dos endpoints.

Limitacoes:

- Necessita auditoria continua para garantir que todo endpoint usa `companyId`.
- E-mail de usuario e globalmente unico.

### Usuarios/permissoes

Status: funcionando em primeira versao.

Funcionalidades:

- Criar/editar/excluir usuarios.
- Roles `ADMIN`, `SUPERVISOR`, `AGENT`.
- Menu lateral filtrado por perfil.
- Guards backend `requireAdmin`, `requireCompanyAdmin`, `requirePlatformAdmin`.
- Agente so acessa conversa sem responsavel ou atribuida a ele.

Limitacoes:

- Permissoes ainda sao role-based fixas, nao permission-based granular.
- `SUPERVISOR` e tratado como admin operacional em alguns pontos.

### Simulacao CLT

Status: iniciado/parcial.

Funcionalidades:

- Lista de bancos CLT mock/configurada.
- Integracoes por banco.
- Credenciais New Corban/Mercantil preparadas.
- Fluxo de SMS iniciado visualmente.
- Simulacao local mockada.
- Logs CLT.
- Criacao de proposta CLT.

Limitacoes:

- Sem API bancaria real.
- Sem automacao oficial New Corban/Mercantil.
- Sem garantia juridica/contratual para automacao por login web.

### Multicred

Status: visual/operacional basico.

Funcionalidades:

- Indicadores de carteira/formalizacao/comissao/ticket.
- Esteira de propostas.

Limitacoes:

- Ainda nao e modulo financeiro robusto.
- Deve ficar restrito a admin para evitar exposicao de faturamento.

## 5. Sistema de conversas

### Armazenamento

- Conversas ficam em `Conversation`.
- Mensagens ficam em `Message`.
- Um contato pode ter varias conversas.
- Cada conversa pertence indiretamente a uma empresa via `Conversation -> Contact -> Company`.
- O canal da conversa e uma string:
  - `whatsapp`
  - ou `whatsapp:{channelId}`

### Recebimento WhatsApp

Fluxo:

1. Meta envia POST em `/api/webhooks/whatsapp`.
2. O CRM le o body bruto.
3. Se existir `appSecret`, valida assinatura `x-hub-signature-256`.
4. `parseMetaWebhookMessages` extrai mensagens.
5. Localiza `Channel` por `phoneNumberId`.
6. Atualiza `lastWebhookReceivedAt`.
7. Chama `processInboundMessage`.
8. Normaliza telefone.
9. Evita duplicidade por `providerMessageId`.
10. Cria ou atualiza `Contact`.
11. Busca conversa aberta/nao resolvida.
12. Se nao existir conversa, cria como `PENDING`.
13. Pode chamar `maybeAutoAssignConversation`.
14. Cria `Message` inbound.
15. Incrementa `unreadCount`.
16. Atualiza `lastMessageAt`, `lastMessagePreview`, `lastInboundMessageAt`.
17. Cria `Notification`.
18. Publica via SSE.
19. Tenta resposta automatica IA se o modo permitir.

### Envio de texto

Fluxo:

1. Frontend chama `POST /api/conversations/:id/messages`.
2. Backend valida sessao e permissao na conversa.
3. Busca canal via `getConversationIntegration`.
4. Envia pela Meta com `sendMetaTextMessage`.
5. Salva mensagem com `saveOutboundMessage`.
6. Se a conversa estava `PENDING`, muda para `OPEN`.
7. Zera `unreadCount`.
8. Atualiza ultimo preview.

### Envio de audio/arquivo

Fluxo:

1. Frontend grava audio ou seleciona arquivo.
2. Chama `POST /api/conversations/:id/messages/media`.
3. Backend valida arquivo e tamanho maximo 16MB.
4. `whatsapp-media.service` normaliza MIME.
5. Para audio WebM, ha conversao via `media-conversion.ts` e ffmpeg quando necessario.
6. Upload para Meta em `/{phoneNumberId}/media`.
7. Envio para cliente com tipo `audio`, `image`, `document` ou `video`.
8. Salva no historico.

### Templates

Fluxo:

1. `GET /api/whatsapp/templates?conversationId=...`.
2. Resolve canal correto da conversa.
3. Busca templates aprovados da WABA.
4. Frontend apresenta template, idioma e variaveis.
5. `POST /api/conversations/:id/messages/template`.
6. Envia via Meta como `type: template`.
7. Salva mensagem no historico.

### Historico

- Mensagens sao incluidas no `conversationInclude`.
- O frontend exibe historico no chat.
- Nao ha paginacao formal por cursor.
- Para conversas longas, o modelo atual carrega mais dados do que deveria.

### Atendimento humano

- Atendente pode assumir se conversa sem responsavel.
- Admin/supervisor pode transferir/devolver.
- Agente so acessa conversa atribuida a ele ou sem responsavel.
- Ao responder, se estava `PENDING`, vira `OPEN`.

### IA no atendimento

- Copiloto gera sugestao e resumo.
- IA pode responder automaticamente em modo `AUTO` ou `HYBRID`.
- `HYBRID` responde apenas quando nao ha humano atribuido.
- Se `aiPaused` estiver ativo, nao responde.

## 6. Sistema de IA

### Modelos

- Padrao: `gpt-4o-mini`.
- Variavel: `OPENAI_MODEL`.
- Endpoint: `https://api.openai.com/v1/responses`.

### Onde a IA e chamada

- `src/lib/ai-attendant.service.ts`
- `POST /api/conversations/:id/ai`
- `PATCH /api/settings/ai`
- `PATCH /api/conversations/:id/ai-mode`
- `processInboundMessage` chama `maybeSendAutomaticAiReply`.

### Funcoes existentes

- `generateAiSuggestion`
- `maybeSendAutomaticAiReply`
- `updateConversationAiMode`
- `shouldAutoReply`
- `normalizeAiMode`

### Prompt atual

Prompt embutido no codigo com regras:

- Portugues do Brasil.
- Linguagem curta, educada e humana para WhatsApp.
- Nao prometer aprovacao, margem, liberacao, taxa ou prazo sem dados reais.
- Nao inventar simulacao, banco, valor liberado ou proposta.
- Fazer uma pergunta por vez quando faltar dado essencial.
- Sinalizar transferencia humana em caso complexo.
- CPF apenas quando necessario.
- Retorno esperado em JSON com:
  - `summary`
  - `temperature`
  - `nextAction`
  - `suggestedReply`
  - `confidence`
  - `tags`
  - `shouldTransferToHuman`

### Camada fallback

- `ai-analysis.ts` faz analise local simples.
- Usada quando nao existe chave OpenAI ou chamada falha.
- Automatico nao envia resposta generica sem `OPENAI_API_KEY`.

## 7. Sistema de disparos

### Como funciona hoje

- Interface em `Disparos`.
- Backend em `/api/campaigns`.
- Campanha cria `Campaign` e `CampaignRecipient`.
- Envio real usa Meta Cloud API.
- Se houver imagem, faz upload da imagem uma vez e reutiliza `mediaId` na campanha.
- Se for template, envia via `sendMetaTemplateMessage`.
- Se for texto livre, envia via `sendMetaTextMessage`.
- Variaveis sao renderizadas por contato.

### Status

Campanha:

- `PENDING`
- `DRAFT`
- `SENDING`
- `PAUSED`
- `CANCELED`
- `COMPLETED`
- `PARTIAL`
- `FAILED`

Destinatario:

- `PENDING`
- `SENT`
- `DELIVERED`
- `FAILED`
- `CANCELED`

### Controle de fila

- Nao existe fila externa.
- `processCampaign` percorre destinatarios pendentes em loop.
- A cada destinatario consulta se campanha foi pausada/cancelada.
- Delay configuravel por `CAMPAIGN_DISPATCH_INTERVAL_SECONDS`.

### Controle de respostas

- Respostas do cliente entram pelo webhook normal.
- Se telefone/contato ja existe, conversa e atualizada.
- Nao ha uma marcacao explicita `repliedAt` no `CampaignRecipient`; o schema sugerido inicialmente nao foi totalmente implementado.

### Controle de bloqueios

- Nao ha blacklist/opt-out formal.
- Nao ha tabela de bloqueio LGPD.
- Nao ha suppress list por telefone.

## 8. Sistema de importacao

### Formatos aceitos

- `.csv`
- `.xlsx`

### Colunas aceitas

Obrigatorias:

- CPF
- Nome
- Telefone

Aliases:

- CPF: `cpf`, `documento`, `doc`, `documento cpf`, `cpf cliente`
- Nome: `nome`, `cliente`, `nome cliente`, `nome completo`
- Telefone: `telefone`, `celular`, `whatsapp`, `fone`, `numero`, `número`

### Tratamento

- Remove pontuacao de CPF.
- CPF precisa ter 11 digitos.
- Remove pontuacao do telefone.
- Se telefone nao comeca com `55` e tem 10/11 digitos, adiciona `55`.
- Valida formato `55 + DDD + numero`.
- Detecta duplicidade de CPF e telefone na planilha.
- Verifica contato existente por CPF ou telefone dentro da empresa.

### Confirmacao

- Linhas validas criam ou atualizam `Contact`.
- Contato novo recebe:
  - `companyId`
  - `ownerId` do usuario importador
  - nome
  - CPF
  - telefone normalizado
  - temperatura `WARM`
- Contato existente e atualizado sem perder historico.
- Gera `ContactActivity`.

### Limitacoes

- Sem stream de leitura para arquivos grandes.
- Sem persistencia de lote de importacao.
- Sem download real de arquivo de erros persistido.

## 9. Sistema de tarefas

### Criacao

- Endpoint `POST /api/tasks`.
- Campos principais:
  - contato
  - responsavel
  - titulo
  - nota
  - vencimento

### Atribuicao

- `assigneeId` vincula tarefa a usuario.
- Tarefa sempre pertence a empresa via `companyId`.

### Exibicao

- Dashboard mostra tarefas.
- Endpoint `GET /api/tasks` lista tarefas.
- `PATCH /api/tasks/:id` atualiza status/dados.

### Limitacoes

- Sem SLA.
- Sem recorrencia.
- Sem notificacao por vencimento.

## 10. Sistema de funil

### Estrutura

- Etapas ficam em `PipelineStage`.
- Contato aponta para etapa via `stageId`.
- Origem fica em `Origin`.
- Propostas ficam separadas em `Proposal`.

### Mudanca de etapa

- Principalmente por atualizacao do contato.
- Kanban usa contatos agrupados por etapa.

### Automacoes existentes

- Entrada WhatsApp cria contato com primeira etapa encontrada por `position`.
- IA pode atualizar temperatura e `lastMessage`.
- Nao ha automacao robusta de mudanca de etapa por evento comercial.

### O que falta

- Historico de mudanca de etapa.
- Regras automatizadas.
- SLAs por etapa.
- Motivos de perda/ganho.

## 11. Sistema de tags

### Estrutura

- `Tag` por empresa.
- Cores e texto configuraveis.
- Categoria opcional.
- `isActive`.

### Tags em contatos

- Relacao N:N por `ContactTag`.
- Usada em contatos e organizacao comercial.

### Tags em conversas

- Relacao N:N por `ConversationTag`.
- Guarda `createdByUserId`.
- Unique por conversa/tag.
- UI permite aplicar/remover e filtrar.

### Limitacoes

- Duplicidade de nome nao bloqueada por banco.
- Ainda nao ha regras automaticas de tag.

## 12. Escalabilidade atual

### Estimativa realista no estado atual

Com PostgreSQL Railway e uso moderado:

- Contatos: dezenas de milhares a algumas centenas de milhares, dependendo do plano do banco e padrao de busca.
- Mensagens: centenas de milhares podem funcionar; milhoes exigirao indices, paginacao e particionamento/logica de arquivamento.
- Campanhas: funcionam para lotes pequenos/medios, mas nao e arquitetura ideal para disparos massivos.

### Gargalos atuais

1. `src/app/page.tsx` muito grande.
2. Backend e frontend no mesmo app sem separacao de workers.
3. Campanhas processadas dentro do request.
4. Sem Redis/fila.
5. SSE em memoria local.
6. Falta de indices importantes em `Conversation` e `Message`.
7. Sem paginacao robusta de mensagens.
8. Upload de campanha salva imagem em `public/uploads`, que nao e ideal para ambiente ephemeral/container.
9. Tokens e senhas externas em texto.
10. Sem observabilidade estruturada.

### Problemas para 500.000+ leads

- Busca em contatos precisa de indices por `companyId`, `phone`, `cpf`, `name`.
- Duplicidade por CPF/telefone deve ser garantida por unique composto.
- Importacao deve ser assíncrona e por lote.
- Tela de contatos precisa paginacao/cursor e filtros indexados.
- Campanhas devem ser processadas por worker.

### Problemas para milhoes de mensagens

- `Message` precisa de indice em `conversationId, createdAt`.
- Historico deve ser paginado.
- Logs devem ser separados de mensagens operacionais.
- Notificacoes antigas precisam de retencao/arquivamento.
- Webhook precisa idempotencia forte por `providerMessageId` com unique.
- Busca full-text deve ser planejada fora do fluxo principal ou com indices especificos.

## 13. APIs e integracoes

### Meta WhatsApp

Funcoes:

- Validar token: `/me`, `/debug_token`.
- Validar WABA: `/{wabaId}`.
- Validar numero: `/{phoneNumberId}`.
- Assinar webhook: `/{wabaId}/subscribed_apps`.
- Buscar templates: `/{wabaId}/message_templates`.
- Upload midia: `/{phoneNumberId}/media`.
- Enviar mensagem: `/{phoneNumberId}/messages`.
- Webhook: `/api/webhooks/whatsapp`.

### OpenAI

- Endpoint: `/v1/responses`.
- Modelo: `OPENAI_MODEL` ou `gpt-4o-mini`.
- Usos:
  - sugestao de resposta
  - resumo
  - temperatura
  - proxima acao
  - tags sugeridas
  - resposta automatica

### Railway

- Hospedagem app.
- PostgreSQL.
- Variaveis de ambiente.
- Deploy via GitHub.
- Predeploy com Prisma push/seed.

### Webhooks

- WhatsApp Meta:
  - GET verificacao
  - POST mensagens/status
- Nao ha webhooks externos para bancos no momento.

### APIs bancarias

- Ainda nao ha integracao bancaria real.
- Modulo CLT possui estrutura para bancos e credenciais.
- Simulacao atual e local/mockada.

### APIs internas

Principais grupos:

- `/api/auth/*`
- `/api/admin/companies`
- `/api/channels/*`
- `/api/webhooks/whatsapp`
- `/api/conversations/*`
- `/api/contacts/*`
- `/api/campaigns/*`
- `/api/imports/contacts/*`
- `/api/notifications/*`
- `/api/settings/*`
- `/api/users/*`
- `/api/tasks/*`
- `/api/clt/*`
- `/api/dashboard`
- `/api/health`
- `/api/system/readiness`

## 14. Seguranca

### Multiempresa

- A maioria das queries usa `session.companyId`.
- `Company` isola usuarios, canais, contatos, campanhas, tags, notificacoes, propostas e CLT.
- Conversas sao isoladas indiretamente por contato.

Risco:

- Como nao existe middleware global obrigando tenant em todas as queries, cada endpoint depende da disciplina do desenvolvedor.
- Para revenda, recomenda-se auditoria endpoint por endpoint e testes automatizados de isolamento.

### Permissoes

Roles:

- `ADMIN`: administrador da empresa.
- `SUPERVISOR`: admin operacional em varios fluxos.
- `AGENT`: atendimento restrito.

Guards:

- `requireAdmin`: permite `ADMIN` e `SUPERVISOR`.
- `requireCompanyAdmin`: permite somente `ADMIN`.
- `requirePlatformAdmin`: permite master por email/empresa.
- `canAccessConversation`: agente so conversa sem responsavel ou propria.
- `conversationVisibilityWhere`: filtra conversas por perfil.

### Controle de acesso

- Frontend oculta menu por role.
- Backend aplica guards em endpoints sensiveis.
- Sessao via cookie httpOnly.

### Protecao de dados

Pontos positivos:

- Senha com PBKDF2 + salt.
- Cookie assinado.
- Token Meta mascarado em respostas de canal.
- Validacao de tenant em muitos endpoints.

Pontos criticos:

- Tokens Meta, app secret e senhas CLT em texto no banco.
- Sem 2FA para admins.
- Sem audit log global de acoes administrativas.
- Sem politicas de retencao/LGPD.
- Sem criptografia de CPF/telefone.

## 15. Roadmap atual observado

Ja implementado ou iniciado:

- CRM atendimento WhatsApp.
- Canais Meta com diagnostico.
- IA copiloto/auto/hibrida.
- Notificacoes internas/desktop.
- Audio/imagem/documento/templates.
- Tags.
- Importacao XLSX/CSV.
- Disparos.
- Multiempresa.
- Usuarios/roles.
- Distribuicao de leads.
- CLT/simulacao inicial.
- Painel de status WhatsApp/API.
- Sidebar/drawer recolhiveis.

Planejado/pendente pelo estado do codigo:

- Worker/fila para disparos.
- Redis/SSE distribuido.
- Integracao bancaria real.
- Criptografia de segredos.
- Auditoria de permissoes.
- Paginação robusta de mensagens.
- Logs estruturados e observabilidade.
- Opt-out/lista de bloqueio para disparos.
- Historico formal de importacoes.
- Historico de etapas/funil.
- Automacoes de tags/funil/SLAs.

## 16. Sugestoes tecnicas

### O que esta bem feito

- A base funcional e ampla: atendimento, WhatsApp, campanhas, IA, tags, usuarios e multiempresa ja existem.
- Prisma deixa o dominio facil de evoluir.
- Os servicos em `src/lib` ja indicam separacao de dominio.
- Integracao Meta esta bem encaminhada com diagnostico de token/WABA/numero/webhook.
- Autenticacao propria e simples, com senha hashada e cookie httpOnly.
- Multiempresa ja esta no modelo mental do banco.
- O atendimento ja tem funcionalidades operacionais reais: unread, notificacao, transferencia, midia, templates.

### O que precisa ser refatorado

1. Quebrar `src/app/page.tsx` em modulos:
   - `modules/atendimento`
   - `modules/canais`
   - `modules/disparos`
   - `modules/contatos`
   - `modules/settings`
   - `components/layout`
   - `components/ui`

2. Criar camada de API client no frontend:
   - `src/services/api-client.ts`
   - hooks por modulo.

3. Separar dominio de infraestrutura:
   - `services/whatsapp`
   - `services/campaigns`
   - `services/ai`
   - `services/tenancy`

4. Criar workers:
   - disparos
   - importacoes
   - webhooks pesados
   - IA automatica

5. Criar fila persistente:
   - BullMQ + Redis
   - ou Railway/servico externo equivalente
   - ou SQS/Cloud Tasks em arquitetura futura

6. Migrar uploads para storage externo:
   - S3/R2/Supabase Storage
   - nunca depender de `public/uploads` em container.

7. Criar camada de criptografia:
   - tokens Meta
   - app secrets
   - senhas CLT
   - CPF se necessario.

### O que pode gerar problemas de escala

- Queries sem indices em conversas/mensagens.
- Mensagens carregadas sem cursor.
- Campanhas em request.
- SSE em memoria.
- Falta de unique composto para CPF/telefone.
- Logs misturados em tabelas operacionais.
- Ausencia de cache.
- Ausencia de rate limiter.
- Ausencia de auditoria.

### Preparacao para 500.000 leads e milhoes de mensagens

Prioridade alta:

1. Adicionar indices:
   - `Contact(companyId, phone)`
   - `Contact(companyId, cpf)`
   - `Contact(companyId, updatedAt)`
   - `Conversation(contactId)`
   - `Conversation(agentId, status, updatedAt)`
   - `Conversation(lastMessageAt)`
   - `Message(conversationId, createdAt)`
   - `Message(status)`
   - `Message(providerMessageId)` idealmente unique quando provider informa ID.

2. Criar unique composto:
   - contato por telefone/empresa.
   - contato por CPF/empresa, se regra comercial permitir.

3. Criar paginacao:
   - contatos por cursor.
   - conversas por cursor.
   - mensagens por cursor.

4. Separar jobs:
   - campanha nao pode depender de request HTTP.
   - importacao grande nao pode ficar em memoria.

5. Implementar Redis:
   - filas
   - pub/sub para notificacoes
   - rate limiting
   - locks de distribuicao.

6. Criar audit logs:
   - login
   - edicao de canal
   - alteracao de token
   - envio de campanha
   - exportacao/importacao
   - transferencia de atendimento.

7. Observabilidade:
   - logs estruturados JSON
   - tracing por webhook
   - metricas por tenant/canal
   - alertas para falha de webhook e campanha.

8. Estruturar LGPD/opt-out:
   - consentimento
   - bloqueio de disparo
   - exclusao/anonimizacao
   - historico de origem da base.

## Conclusao executiva

O CRM atual ja e uma base operacional forte para atendimento WhatsApp com IA, campanhas, tags, usuarios, multiempresa e canais Meta. Para uso controlado e primeiras revendas pequenas, a base esta funcional. Para virar SaaS robusto com muitos tenants, 500.000+ leads e milhoes de mensagens, os proximos passos tecnicos mais importantes sao:

1. Refatorar `src/app/page.tsx` em modulos.
2. Adicionar indices e constraints de banco.
3. Criar fila/worker para disparos e importacoes.
4. Criptografar segredos.
5. Implementar paginacao real de mensagens/conversas/contatos.
6. Criar auditoria e observabilidade.
7. Fortalecer isolamento multiempresa com testes automatizados.
