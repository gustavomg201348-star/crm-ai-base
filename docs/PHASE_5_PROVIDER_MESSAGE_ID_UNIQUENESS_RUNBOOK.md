# Runbook - Unique partial indexes para providerMessageId

## 1. Objetivo

Preparar a aplicacao futura de indices unicos parciais em PostgreSQL/Railway
para impedir duplicidade de `providerMessageId` em:

- `Message.providerMessageId`;
- `CampaignRecipient.providerMessageId`.

Esta operacao reduz risco de duplicidade causada por concorrencia em webhooks,
status de entrega e disparos de campanha. O runbook e operacional e nao altera
aplicacao, schema Prisma, migrations, scripts, frontend ou dados de negocio por
si so.

## 2. Pre-requisitos

Antes de qualquer execucao:

1. Confirmar explicitamente o projeto Railway correto.
2. Confirmar o environment Railway correto.
3. Confirmar o service/banco PostgreSQL correto.
4. Confirmar que `DATABASE_URL` ou `DATABASE_PUBLIC_URL` aponta para
   PostgreSQL/Railway do ambiente pretendido, nunca para SQLite local.
5. Exibir a URL de banco apenas de forma mascarada.
6. Confirmar que o deploy contendo o tratamento idempotente de inbound ja esta
   publicado no ambiente alvo.
7. Confirmar que nao existem duplicidades nas auditorias previas.
8. Criar snapshot/backup antes da operacao.
9. Definir janela operacional.
10. Capturar e salvar todo o output dos comandos executados.

Nao continuar se houver qualquer duvida sobre ambiente, snapshot ou dados.

## 3. Checklist Railway

Antes de rodar SQL:

- [ ] Projeto Railway confirmado.
- [ ] Environment confirmado.
- [ ] Service Postgres confirmado.
- [ ] Banco confirmado como PostgreSQL.
- [ ] URL mascarada registrada no relatorio operacional.
- [ ] Snapshot/backup recente confirmado no painel Railway.
- [ ] Janela operacional aprovada.
- [ ] Auditoria previa executada em modo somente leitura.
- [ ] Auditoria previa sem duplicidades bloqueantes.
- [ ] Autorizacao explicita recebida para criar os indices.

## 4. Snapshot obrigatorio

Criar ou confirmar snapshot/backup no Railway antes de qualquer `CREATE INDEX`.

Regras:

- snapshot antes da criacao dos indices e obrigatorio;
- se o snapshot nao estiver disponivel ou nao puder ser confirmado, parar;
- registrar data/hora aproximada do snapshot;
- registrar quem confirmou o snapshot;
- nao substituir snapshot por export manual improvisado sem aprovacao.

## 5. Auditoria previa

Executar somente consultas de leitura antes de criar os indices.

### 5.1 Duplicidades em Message.providerMessageId

```sql
SELECT
  "providerMessageId",
  COUNT(*) AS total,
  ARRAY_AGG("id" ORDER BY "createdAt") AS message_ids,
  ARRAY_AGG("conversationId" ORDER BY "createdAt") AS conversation_ids
FROM "Message"
WHERE "providerMessageId" IS NOT NULL
GROUP BY "providerMessageId"
HAVING COUNT(*) > 1
ORDER BY total DESC, "providerMessageId";
```

### 5.2 Duplicidades em CampaignRecipient.providerMessageId

```sql
SELECT
  "providerMessageId",
  COUNT(*) AS total,
  ARRAY_AGG("id" ORDER BY "createdAt") AS recipient_ids,
  ARRAY_AGG("campaignId" ORDER BY "createdAt") AS campaign_ids
FROM "CampaignRecipient"
WHERE "providerMessageId" IS NOT NULL
GROUP BY "providerMessageId"
HAVING COUNT(*) > 1
ORDER BY total DESC, "providerMessageId";
```

### 5.3 providerMessageId NULL em Message

```sql
SELECT
  COUNT(*) AS total_messages,
  COUNT(*) FILTER (WHERE "providerMessageId" IS NULL) AS provider_message_id_null,
  COUNT(*) FILTER (WHERE "providerMessageId" IS NOT NULL) AS provider_message_id_filled
FROM "Message";
```

### 5.4 providerMessageId NULL em CampaignRecipient

```sql
SELECT
  COUNT(*) AS total_recipients,
  COUNT(*) FILTER (WHERE "providerMessageId" IS NULL) AS provider_message_id_null,
  COUNT(*) FILTER (WHERE "providerMessageId" IS NOT NULL) AS provider_message_id_filled
FROM "CampaignRecipient";
```

### 5.5 Cruzamento Message x CampaignRecipient

```sql
SELECT
  m."providerMessageId",
  COUNT(DISTINCT m."id") AS total_messages,
  COUNT(DISTINCT cr."id") AS total_recipients,
  ARRAY_AGG(DISTINCT m."id") AS message_ids,
  ARRAY_AGG(DISTINCT cr."id") AS recipient_ids,
  ARRAY_AGG(DISTINCT cr."campaignId") AS campaign_ids
FROM "Message" m
JOIN "CampaignRecipient" cr
  ON cr."providerMessageId" = m."providerMessageId"
WHERE m."providerMessageId" IS NOT NULL
GROUP BY m."providerMessageId"
ORDER BY m."providerMessageId";
```

### 5.6 Agrupamento de Message por empresa

```sql
SELECT
  c."companyId",
  COUNT(*) AS total_messages,
  COUNT(*) FILTER (WHERE m."providerMessageId" IS NULL) AS provider_message_id_null,
  COUNT(*) FILTER (WHERE m."providerMessageId" IS NOT NULL) AS provider_message_id_filled,
  COUNT(DISTINCT m."providerMessageId") FILTER (WHERE m."providerMessageId" IS NOT NULL) AS distinct_provider_message_ids
FROM "Message" m
JOIN "Conversation" c
  ON c."id" = m."conversationId"
GROUP BY c."companyId"
ORDER BY total_messages DESC, c."companyId";
```

### 5.7 Agrupamento de CampaignRecipient por empresa

```sql
SELECT
  cp."companyId",
  COUNT(*) AS total_recipients,
  COUNT(*) FILTER (WHERE cr."providerMessageId" IS NULL) AS provider_message_id_null,
  COUNT(*) FILTER (WHERE cr."providerMessageId" IS NOT NULL) AS provider_message_id_filled,
  COUNT(DISTINCT cr."providerMessageId") FILTER (WHERE cr."providerMessageId" IS NOT NULL) AS distinct_provider_message_ids
FROM "CampaignRecipient" cr
JOIN "Campaign" cp
  ON cp."id" = cr."campaignId"
GROUP BY cp."companyId"
ORDER BY total_recipients DESC, cp."companyId";
```

Se qualquer consulta de duplicidade retornar linhas, parar. Nao criar indices
ate que a duplicidade seja analisada e resolvida em sprint propria.

## 6. SQL operacional

Executar somente apos:

- snapshot/backup confirmado;
- auditoria previa sem duplicidades;
- ambiente confirmado;
- autorizacao explicita para a operacao.

Importante: `CREATE INDEX CONCURRENTLY` nao deve ser executado dentro de
transaction.

### 6.1 Message

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Message_providerMessageId_unique"
ON "Message" ("providerMessageId")
WHERE "providerMessageId" IS NOT NULL;
```

### 6.2 CampaignRecipient

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "CampaignRecipient_providerMessageId_unique"
ON "CampaignRecipient" ("providerMessageId")
WHERE "providerMessageId" IS NOT NULL;
```

## 7. SQL de verificacao pos-indice

### 7.1 Confirmar existencia dos indices

```sql
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'Message_providerMessageId_unique',
    'CampaignRecipient_providerMessageId_unique'
  )
ORDER BY indexname;
```

### 7.2 Confirmar validade dos indices

```sql
SELECT
  c.relname AS index_name,
  i.indisunique AS is_unique,
  i.indisvalid AS is_valid,
  i.indisready AS is_ready,
  pg_get_indexdef(i.indexrelid) AS index_definition
FROM pg_index i
JOIN pg_class c
  ON c.oid = i.indexrelid
WHERE c.relname IN (
  'Message_providerMessageId_unique',
  'CampaignRecipient_providerMessageId_unique'
)
ORDER BY c.relname;
```

### 7.3 Repetir auditoria de duplicidades

Reexecutar:

- duplicidades em `Message.providerMessageId`;
- duplicidades em `CampaignRecipient.providerMessageId`;
- cruzamento `Message` x `CampaignRecipient`.

O resultado esperado para duplicidades internas e zero linhas.

## 8. Rollback

Rollback remove apenas os indices. Nao altera dados.

Executar somente com autorizacao explicita.

Importante: `DROP INDEX CONCURRENTLY` nao deve ser executado dentro de
transaction.

```sql
DROP INDEX CONCURRENTLY IF EXISTS "Message_providerMessageId_unique";
```

```sql
DROP INDEX CONCURRENTLY IF EXISTS "CampaignRecipient_providerMessageId_unique";
```

Depois do rollback, repetir a verificacao em `pg_indexes` e `pg_index` para
confirmar que os indices foram removidos.

## 9. Checklist pos-apply

Depois de criar os indices:

- [ ] Confirmar que ambos existem em `pg_indexes`.
- [ ] Confirmar `indisunique = true`.
- [ ] Confirmar `indisvalid = true`.
- [ ] Confirmar `indisready = true`.
- [ ] Confirmar que a auditoria de duplicidade retorna zero linhas.
- [ ] Confirmar que nao houve alteracao em dados.
- [ ] Confirmar que nao houve alteracao em schema Prisma ou migrations.
- [ ] Capturar output completo.
- [ ] Registrar data/hora da operacao.
- [ ] Registrar responsavel pela execucao.

## 10. Riscos conhecidos

- Ambiente errado: executar em banco diferente do pretendido.
- Snapshot ausente: dificuldade de rollback operacional em caso de incidente.
- Dados duplicados em producao: `CREATE UNIQUE INDEX` falhara se houver
  duplicidade existente.
- Concorrencia durante criacao: mensagens novas podem chegar durante a janela;
  por isso a aplicacao deve estar preparada para conflito de
  `providerMessageId`.
- Indice invalido: falha durante `CREATE INDEX CONCURRENTLY` pode deixar indice
  invalido que precisa ser removido e investigado.
- CampaignRecipient: campanhas antigas podem ter registros sem
  `providerMessageId`, o que e permitido pelo indice parcial.
- Message: mensagens locais, internas ou antigas podem ter
  `providerMessageId = NULL`, o que e permitido pelo indice parcial.
- Ausencia de baseline Prisma Migrate: a operacao e SQL operacional revisado,
  nao migration Prisma.
- Diferenca entre SQLite local e PostgreSQL producao: validar sempre no banco
  alvo antes de aplicar.

