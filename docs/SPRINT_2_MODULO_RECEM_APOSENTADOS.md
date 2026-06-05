# SPRINT 2 - Modulo Recem-Aposentados

## Objetivo

Criar a fundacao do modulo Recem-Aposentados dentro do CRM, usando a arquitetura atual de contatos, usuarios, multiempresa, importacao e permissao, sem alterar atendimento, campanhas, conversas, Redis, BullMQ ou workers.

## Modelos criados

### RetirementLead

Representa o lead de recem-aposentado vinculado a um contato existente.

Campos principais:

- `companyId`
- `contactId`
- `grantDate`
- `estimatedUnlockDate`
- `daysToUnlock`
- `benefitType`
- `benefitNumber`
- `state`
- `city`
- `desiredAmount`
- `interestLevel`
- `hasCorrespondent`
- `score`
- `journeyStatus`
- `nextContactDate`
- `lastContactDate`
- `notes`
- `createdAt`
- `updatedAt`

Relacionamentos:

- `Company`
- `Contact`
- `RetirementLeadEvent[]`

Indices:

- `companyId`
- `contactId`
- `estimatedUnlockDate`
- `daysToUnlock`
- `score`
- `journeyStatus`
- `nextContactDate`

Constraint:

- `@@unique([companyId, contactId])`

### RetirementLeadEvent

Registra a timeline da jornada.

Campos:

- `retirementLeadId`
- `eventType`
- `description`
- `createdByUserId`
- `createdAt`

Relacionamentos:

- `RetirementLead`
- `User`

## APIs criadas

- `GET /api/retirement-leads`
- `GET /api/retirement-leads/:id`
- `POST /api/retirement-leads`
- `PATCH /api/retirement-leads/:id`
- `GET /api/retirement-leads/:id/events`
- `POST /api/retirement-leads/:id/events`

Todas as consultas filtram por `companyId` da sessao.

## Pagina criada

Menu:

- `Recem-Aposentados`

Tela principal:

- dashboard do modulo
- filtros combinados
- tabela paginada
- painel de detalhe
- timeline do lead
- mudanca manual de interesse
- mudanca manual de status da jornada
- notas manuais na timeline

## Dashboard do modulo

Cards:

- Total importados
- Ate 90 dias
- Ate 60 dias
- Ate 30 dias
- Ate 15 dias
- Prontos para conversao
- Leads quentes
- Leads frios

## Filtros implementados

- busca por nome, CPF, telefone ou beneficio
- estado
- cidade
- dias para desbloqueio
- score minimo
- interesse
- status da jornada
- possui correspondente
- proxima acao

## Importacao

A importacao atual de contatos foi preservada.

Novas colunas opcionais aceitas:

- `Data Concessao`
- `Beneficio`
- `Cidade`
- `Estado`

Quando `Data Concessao` vier preenchida e valida, a importacao cria ou atualiza automaticamente o `RetirementLead` do contato e registra evento `IMPORTED`.

Regra inicial:

- `estimatedUnlockDate = grantDate + 90 dias`
- `daysToUnlock` calculado a partir da data estimada

## Score

Criada funcao:

- `recalculateRetirementLeadScore()`

Nesta sprint ela prepara a estrutura e respeita score manual quando informado. A automacao real de score fica para sprint futura.

## Status da jornada

Status suportados:

- `IMPORTED`
- `FIRST_CONTACT`
- `RESPONDED`
- `INTERESTED`
- `NURTURING`
- `PRE_UNLOCK`
- `READY_TO_CONVERT`
- `CONVERTED`
- `LOST`

Ao alterar status manualmente, um evento e registrado automaticamente na timeline.

## Seguranca

- Isolamento por `companyId`
- Endpoints de escrita exigem perfil admin/supervisor pelo helper `requireAdmin`
- Listagem e detalhe respeitam empresa da sessao
- Eventos sao vinculados ao usuario logado

## Arquivos criados ou alterados

- `prisma/schema.prisma`
- `prisma/schema.postgres.prisma`
- `prisma/setup-sqlite.mjs`
- `src/lib/retirement-leads.ts`
- `src/lib/contact-import.service.ts`
- `src/lib/mock-data.ts`
- `src/app/page.tsx`
- `src/app/api/retirement-leads/route.ts`
- `src/app/api/retirement-leads/[id]/route.ts`
- `src/app/api/retirement-leads/[id]/events/route.ts`

## Proximos passos

1. Criar configuracao por empresa para regra de desbloqueio, substituindo o padrao fixo de 90 dias.
2. Criar importacao especifica de bases de recem-aposentados com mais colunas.
3. Criar automacoes da jornada de 90 dias.
4. Integrar IA para sugestoes por etapa.
5. Criar filas/workers apenas quando o volume real exigir processamento assincorno.
