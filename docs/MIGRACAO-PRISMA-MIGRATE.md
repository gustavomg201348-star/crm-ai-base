# Migracao Para Prisma Migrate

## Escopo

Este documento registra o plano tecnico para preparar a migracao de `prisma db push` para `prisma migrate deploy`.

Regras desta etapa:

- Nao alterar schema Prisma.
- Nao criar migrations.
- Nao alterar banco.
- Nao alterar Railway.
- Nao alterar scripts de deploy.
- Apenas documentar o plano.

## Resumo executivo

O projeto possui dois schemas Prisma:

- `prisma/schema.prisma`: desenvolvimento local com SQLite.
- `prisma/schema.postgres.prisma`: producao prevista com PostgreSQL.

Os schemas estao praticamente alinhados. As diferencas atuais sao:

| Item | `schema.prisma` | `schema.postgres.prisma` | Impacto |
|---|---|---|---|
| Datasource | `provider = "sqlite"` | `provider = "postgresql"` | Esperado: local SQLite e producao Postgres. |
| `User.email` | `@unique(map: "sqlite_autoindex_User_2")` | `@unique` | Diferenca de nome de constraint/index. Para Postgres, pode ser interessante nomear constraints criticas no futuro. |

O maior risco nao e o desenho atual do schema, mas sim a ausencia de historico versionado de migrations e a possibilidade de drift em producao causado pelo uso de `prisma db push`.

## 1. Tabelas criticas

| Tabela | Motivo |
|---|---|
| `Company` | Raiz de multiempresa/tenant. Quebra aqui afeta todo isolamento SaaS. |
| `User` | Autenticacao, roles e vinculo com empresa. `email` e unique global. |
| `Contact` | Alto volume, dados pessoais, CPF/telefone, importacao e base comercial. |
| `Conversation` | Nucleo do atendimento WhatsApp/IA. Alto volume e consultas frequentes. |
| `Message` | Tende a crescer muito rapido; impacta webhook, logs, status Meta e historico. |
| `Campaign` | Controle de disparos. |
| `CampaignRecipient` | Alto volume em campanhas; status, entrega, falha e provider id. |
| `Channel` | Tokens Meta, WABA, Phone Number ID e canais por tenant. |
| `Notification` | Pode crescer rapido; precisa retencao futura. |
| `CltIntegration` | Credenciais sensiveis de bancos/CLT. |
| `CltSimulationLog` | Logs operacionais com CPF/telefone/input/output. |
| `RetirementLead` | Modulo de recem-aposentados, com score, datas e jornada comercial. |

## 2. Riscos da migracao de `db push` para `migrate deploy`

- O banco de producao pode ter drift, porque `db push` aplica o estado final sem historico versionado.
- A primeira migration pode tentar recriar estruturas que ja existem.
- Constraints unique podem falhar se houver duplicados reais em producao.
- Indices em tabelas grandes podem causar lock, lentidao ou timeout.
- Diferencas SQLite/Postgres podem revelar tipos, defaults ou nomes de constraints diferentes.
- `@@unique([companyId, cpf])` em Postgres permite multiplos `cpf = null`, mas duplicados nao nulos quebram.
- `User.email @unique` global pode ser limitacao SaaS se duas empresas precisarem usar o mesmo e-mail.
- FKs podem falhar se dados orfaos tiverem sido criados por scripts antigos.
- `Decimal` em Postgres pode precisar revisao de precisao/escala se regras financeiras ficarem mais rigidas.
- A troca para migrations exige processo de baseline para nao reaplicar tudo em producao.

## 3. Indices recomendados

### Contact

Existentes:

- `@@unique([companyId, phone])`
- `@@unique([companyId, cpf])`
- `@@index([companyId])`
- `@@index([companyId, updatedAt])`
- `@@index([companyId, createdAt])`
- `@@index([ownerId])`
- `@@index([stageId])`
- `@@index([originId])`

Recomendados para avaliacao futura:

- `@@index([companyId, stageId, updatedAt])` para Kanban por etapa.
- `@@index([companyId, ownerId, updatedAt])` para carteira/responsavel.
- `@@index([companyId, archivedAt, updatedAt])` para listas ativo/arquivado.
- Indice funcional/trigram no Postgres para busca por nome, telefone ou CPF se a base crescer.

### Conversation

Existentes:

- `@@index([contactId])`
- `@@index([agentId])`
- `@@index([agentId, status, updatedAt])`
- `@@index([lastMessageAt])`
- `@@index([status])`

Recomendados para avaliacao futura:

- `@@index([status, lastMessageAt])` para filas gerais.
- `@@index([agentId, status, lastMessageAt])` para caixa de atendimento por atendente.
- Avaliar adicionar `companyId` direto em `Conversation` no futuro, pois hoje o filtro por tenant depende do join com `Contact`.

### Message

Existentes:

- `@@index([conversationId, createdAt])`
- `@@index([status])`
- `@@index([direction])`
- `@@index([providerMessageId])`

Recomendados para avaliacao futura:

- `@@index([status, createdAt])` para logs/falhas recentes.
- `@@index([direction, createdAt])` para metricas inbound/outbound.
- Avaliar `providerMessageId` unique ou partial unique se a regra de idempotencia Meta permitir.

### CampaignRecipient

Existentes:

- `@@unique([campaignId, contactId])`
- `@@index([contactId])`
- `@@index([campaignId, status])`
- `@@index([contactId, status])`
- `@@index([conversationId])`
- `@@index([providerMessageId])`
- `@@index([status])`

Recomendados para avaliacao futura:

- `@@index([campaignId, status, updatedAt])` para processamento/monitoramento de campanha.
- `@@index([status, updatedAt])` para filas globais.
- Avaliar unique em `providerMessageId` se cada mensagem Meta mapear para um unico recipient.

## 4. Constraints recomendadas

- Nomear constraints importantes com `map`, principalmente uniques e indices criticos, para estabilidade entre ambientes.
- Manter `Contact`: unique por `(companyId, phone)` e `(companyId, cpf)`.
- Avaliar se `User.email` deve continuar unique global ou virar `@@unique([companyId, email])`. Para SaaS real, por empresa costuma ser mais flexivel; global e mais simples, mas limita revenda.
- Avaliar `Channel`: unique por `(companyId, phoneNumberId)` quando `phoneNumberId` existir.
- Avaliar `CampaignRecipient.providerMessageId`: unique se for garantido pela Meta.
- Avaliar `Message.providerMessageId`: unique se idempotencia de webhook exigir impedir mensagem duplicada.
- Adicionar constraints de negocio via aplicacao ou enum futuramente para `status`, `role`, `direction`, `messageType`, `aiMode`.

## 5. Ordem segura de implantacao

1. Congelar deploys e fazer backup validado do Postgres.
2. Rodar auditoria de drift comparando schema Prisma com producao.
3. Criar baseline da estrutura atual sem aplicar alteracoes destrutivas.
4. Validar duplicados antes de uniques: contatos, usuarios, recipients, tags e canais.
5. Criar migration baseline marcada como aplicada, se o banco ja existir.
6. Separar migrations pequenas por tema: indices, constraints, colunas novas, alteracoes de dados.
7. Aplicar primeiro migrations de baixo risco.
8. Rodar smoke tests: login, contatos, conversas, webhook, campanhas e readiness.
9. So depois adicionar indices pesados ou constraints novas.
10. Migrar deploy Railway de `db push` para `migrate deploy` em etapa propria, depois do baseline validado.

## 6. Possiveis impactos em producao

- Lock em tabelas grandes durante criacao de indices.
- Deploy mais lento no primeiro `migrate deploy`.
- Falha de deploy se a migration encontrar duplicidades.
- Queries podem melhorar apos indices, mas inserts/updates podem ficar levemente mais caros.
- Constraints novas podem bloquear imports ou webhooks que hoje passam com dados inconsistentes.
- Se `providerMessageId` virar unique, webhooks duplicados passam a exigir fluxo idempotente robusto.

## 7. Plano de rollback

- Antes de qualquer migration: snapshot/backup completo do banco.
- Preferir migrations aditivas e reversiveis no inicio.
- Para indices: rollback e remover o indice, idealmente com `DROP INDEX CONCURRENTLY` quando criado manualmente em Postgres.
- Para constraints: remover a constraint e corrigir dados/aplicacao.
- Para deploy quebrado: voltar imagem/codigo anterior mantendo banco, se a migration foi aditiva.
- Para migration destrutiva futura: exigir plano especifico com backup, script reverso e janela de manutencao.
- Nao fazer rollback automatico de dados sem teste em staging.

## 8. Migrations sugeridas por risco

### Baixo risco

- Baseline inicial do schema atual.
- Nomear constraints/indices futuros, se feito sem recriar estruturas existentes em producao.
- Adicionar indices compostos em tabelas pequenas.
- Adicionar documentacao/processo de `migrate deploy` sem trocar deploy ainda.

### Medio risco

- Adicionar indices compostos em `Contact`, `Conversation`, `Message`, `CampaignRecipient`.
- Adicionar `@@index([companyId, stageId, updatedAt])` em `Contact`.
- Adicionar `@@index([status, createdAt])` em `Message`.
- Adicionar `@@index([campaignId, status, updatedAt])` em `CampaignRecipient`.
- Trocar Railway de `db push` para `migrate deploy` apos baseline validado.

### Alto risco

- Alterar `User.email` de unique global para unique por tenant.
- Tornar `providerMessageId` unique em `Message` ou `CampaignRecipient`.
- Adicionar `companyId` direto em `Conversation` e fazer backfill.
- Criptografar/migrar tokens Meta, senhas CLT, CPF e telefone.
- Criar constraints novas em tabelas com dados legados sem limpeza previa.
- Remover ou alterar campos usados por webhooks/campanhas.

## 9. Auditoria somente leitura antes de futuras migrations

As queries abaixo devem ser executadas em ambiente seguro, preferencialmente primeiro em uma copia de staging/restauracao do banco de producao.

Objetivo: identificar dados que fariam futuras constraints ou uniques falharem.

Interpretacao geral:

- Resultado vazio: nao foram encontradas duplicidades para aquela regra.
- Uma ou mais linhas: existe risco para migration que crie ou reforce unique correspondente.
- `total` maior que 1 indica quantos registros compartilham a mesma chave logica.
- Antes de corrigir, validar com o time de negocio qual registro deve permanecer e se os demais devem ser mesclados, arquivados ou removidos.

### 9.1 Contatos duplicados por `(companyId, phone)`

```sql
SELECT
  "companyId",
  "phone",
  COUNT(*) AS total,
  ARRAY_AGG("id" ORDER BY "updatedAt" DESC) AS contact_ids
FROM "Contact"
WHERE NULLIF(TRIM("phone"), '') IS NOT NULL
GROUP BY "companyId", "phone"
HAVING COUNT(*) > 1
ORDER BY total DESC, "companyId", "phone";
```

Como interpretar:

- Qualquer linha indica que a constraint `@@unique([companyId, phone])` falharia se ainda nao existisse ou se o banco estiver em drift.
- Verificar se os telefones estao normalizados. Duplicidade tambem pode existir com formatos diferentes, mesmo que esta query nao agrupe esses casos.

### 9.2 Contatos duplicados por `(companyId, cpf)`, ignorando CPF nulo

```sql
SELECT
  "companyId",
  "cpf",
  COUNT(*) AS total,
  ARRAY_AGG("id" ORDER BY "updatedAt" DESC) AS contact_ids
FROM "Contact"
WHERE NULLIF(TRIM("cpf"), '') IS NOT NULL
GROUP BY "companyId", "cpf"
HAVING COUNT(*) > 1
ORDER BY total DESC, "companyId", "cpf";
```

Como interpretar:

- Qualquer linha indica risco para unique por empresa/CPF.
- CPF nulo ou vazio e ignorado porque Postgres permite multiplos `NULL` em unique composto.

### 9.3 Usuarios com email duplicado

```sql
SELECT
  LOWER(TRIM("email")) AS normalized_email,
  COUNT(*) AS total,
  ARRAY_AGG("id" ORDER BY "createdAt" ASC) AS user_ids
FROM "User"
WHERE NULLIF(TRIM("email"), '') IS NOT NULL
GROUP BY LOWER(TRIM("email"))
HAVING COUNT(*) > 1
ORDER BY total DESC, normalized_email;
```

Como interpretar:

- O schema atual usa `email` unique global.
- Qualquer linha indica risco para `User.email @unique`.
- Se no futuro a regra mudar para e-mail unico por tenant, rodar tambem uma versao agrupada por `companyId`.

Versao por tenant, se aplicavel:

```sql
SELECT
  "companyId",
  LOWER(TRIM("email")) AS normalized_email,
  COUNT(*) AS total,
  ARRAY_AGG("id" ORDER BY "createdAt" ASC) AS user_ids
FROM "User"
WHERE NULLIF(TRIM("email"), '') IS NOT NULL
GROUP BY "companyId", LOWER(TRIM("email"))
HAVING COUNT(*) > 1
ORDER BY total DESC, "companyId", normalized_email;
```

### 9.4 CampaignRecipient duplicado por `(campaignId, contactId)`

```sql
SELECT
  "campaignId",
  "contactId",
  COUNT(*) AS total,
  ARRAY_AGG("id" ORDER BY "createdAt" ASC) AS recipient_ids
FROM "CampaignRecipient"
GROUP BY "campaignId", "contactId"
HAVING COUNT(*) > 1
ORDER BY total DESC, "campaignId", "contactId";
```

Como interpretar:

- Qualquer linha indica risco para `@@unique([campaignId, contactId])`.
- Antes de corrigir, verificar status de envio para nao perder historico de campanha.

### 9.5 Message com `providerMessageId` duplicado, ignorando nulos

```sql
SELECT
  "providerMessageId",
  COUNT(*) AS total,
  ARRAY_AGG("id" ORDER BY "createdAt" ASC) AS message_ids
FROM "Message"
WHERE NULLIF(TRIM("providerMessageId"), '') IS NOT NULL
GROUP BY "providerMessageId"
HAVING COUNT(*) > 1
ORDER BY total DESC, "providerMessageId";
```

Como interpretar:

- O schema atual tem indice, nao unique, em `providerMessageId`.
- Resultado com duplicados nao quebra o schema atual, mas bloquearia uma futura unique.
- Duplicados podem indicar webhook repetido, reprocessamento ou multiplas entidades para a mesma mensagem Meta.

### 9.6 CampaignRecipient com `providerMessageId` duplicado, ignorando nulos

```sql
SELECT
  "providerMessageId",
  COUNT(*) AS total,
  ARRAY_AGG("id" ORDER BY "createdAt" ASC) AS recipient_ids
FROM "CampaignRecipient"
WHERE NULLIF(TRIM("providerMessageId"), '') IS NOT NULL
GROUP BY "providerMessageId"
HAVING COUNT(*) > 1
ORDER BY total DESC, "providerMessageId";
```

Como interpretar:

- O schema atual tem indice, nao unique, em `providerMessageId`.
- Duplicados podem ser aceitaveis apenas se a regra de negocio permitir; caso contrario, precisam ser saneados antes de unique futura.

### 9.7 Tags duplicadas por `(companyId, name)`

```sql
SELECT
  "companyId",
  LOWER(TRIM("name")) AS normalized_name,
  COUNT(*) AS total,
  ARRAY_AGG("id" ORDER BY "createdAt" ASC) AS tag_ids
FROM "Tag"
WHERE NULLIF(TRIM("name"), '') IS NOT NULL
GROUP BY "companyId", LOWER(TRIM("name"))
HAVING COUNT(*) > 1
ORDER BY total DESC, "companyId", normalized_name;
```

Como interpretar:

- O schema atual usa `@@unique([companyId, name])`, mas a query normaliza caixa/espacos para encontrar duplicidades semanticas.
- Se houver resultados com diferenca apenas de maiusculas/minusculas, decidir se o produto deve tratar tag como case-sensitive ou case-insensitive.

### 9.8 Canais duplicados por `(companyId, phoneNumberId)`, ignorando nulos

```sql
SELECT
  "companyId",
  "phoneNumberId",
  COUNT(*) AS total,
  ARRAY_AGG("id" ORDER BY "updatedAt" DESC) AS channel_ids
FROM "Channel"
WHERE NULLIF(TRIM("phoneNumberId"), '') IS NOT NULL
GROUP BY "companyId", "phoneNumberId"
HAVING COUNT(*) > 1
ORDER BY total DESC, "companyId", "phoneNumberId";
```

Como interpretar:

- O schema atual ainda nao tem unique para `(companyId, phoneNumberId)`.
- Duplicados podem causar webhook, envio ou diagnostico Meta apontando para canal errado.
- Antes de criar constraint futura, decidir qual canal e o oficial e como migrar historico.

## 10. Recomendacao final

Antes de criar qualquer migration real:

1. Executar as queries acima em staging/restauracao do banco de producao.
2. Documentar resultados.
3. Corrigir duplicidades de forma planejada.
4. Criar baseline do schema atual.
5. So entao avaliar indices e constraints adicionais.

