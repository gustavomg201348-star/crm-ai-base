# Runbook — Unique partial indexes para Channel Meta

## 1. Objetivo

Adicionar, em PostgreSQL/Railway, índices únicos parciais globais para impedir
duplicidade de identificadores Meta em `Channel`:

- `phoneNumberId` único para `provider = 'meta'` quando não for `NULL`;
- `externalId` único para `provider = 'meta'` quando não for `NULL`.

Esta operação protege o webhook e os fluxos Meta contra seleção ambígua de canal
quando múltiplas empresas ou canais existem no CRM.

Este runbook é apenas operacional. Ele não altera aplicação, schema Prisma,
migrations, frontend, backfill ou dados de negócio.

## 2. Pré-requisitos

Antes de qualquer execução:

1. Confirmar explicitamente o projeto Railway correto.
2. Confirmar o environment Railway correto.
3. Confirmar o service/banco PostgreSQL correto.
4. Confirmar que `DATABASE_URL` aponta para PostgreSQL/Railway de produção ou
   staging pretendido, nunca para SQLite local.
5. Exibir a `DATABASE_URL` apenas de forma mascarada.
6. Criar snapshot/backup antes da operação.
7. Definir janela operacional.
8. Garantir que a Sprint 5.1B, guardrail de aplicação para duplicidade Meta, já
   esteja publicada no ambiente alvo.
9. Capturar e salvar todo o output dos comandos executados.

Não continuar se houver qualquer dúvida sobre o ambiente.

## 3. Auditoria prévia obrigatória

Executar a auditoria em modo somente leitura antes de criar índices.

### 3.1 Duplicidade por provider + phoneNumberId

```sql
SELECT
  "provider",
  "phoneNumberId",
  COUNT(*) AS total,
  ARRAY_AGG("id" ORDER BY "createdAt") AS channel_ids,
  ARRAY_AGG("companyId" ORDER BY "createdAt") AS company_ids,
  ARRAY_AGG("status" ORDER BY "createdAt") AS statuses
FROM "Channel"
WHERE "provider" = 'meta'
  AND "phoneNumberId" IS NOT NULL
GROUP BY "provider", "phoneNumberId"
HAVING COUNT(*) > 1
ORDER BY total DESC, "phoneNumberId";
```

### 3.2 Duplicidade por provider + externalId

```sql
SELECT
  "provider",
  "externalId",
  COUNT(*) AS total,
  ARRAY_AGG("id" ORDER BY "createdAt") AS channel_ids,
  ARRAY_AGG("companyId" ORDER BY "createdAt") AS company_ids,
  ARRAY_AGG("status" ORDER BY "createdAt") AS statuses
FROM "Channel"
WHERE "provider" = 'meta'
  AND "externalId" IS NOT NULL
GROUP BY "provider", "externalId"
HAVING COUNT(*) > 1
ORDER BY total DESC, "externalId";
```

### 3.3 phoneNumberId cruzando com externalId em canais diferentes

```sql
SELECT
  source."id" AS source_channel_id,
  source."companyId" AS source_company_id,
  source."phoneNumberId" AS source_phone_number_id,
  target."id" AS target_channel_id,
  target."companyId" AS target_company_id,
  target."externalId" AS target_external_id,
  source."status" AS source_status,
  target."status" AS target_status
FROM "Channel" source
JOIN "Channel" target
  ON source."phoneNumberId" = target."externalId"
WHERE source."provider" = 'meta'
  AND target."provider" = 'meta'
  AND source."phoneNumberId" IS NOT NULL
  AND target."externalId" IS NOT NULL
  AND source."id" <> target."id"
ORDER BY source."phoneNumberId", source."id", target."id";
```

### 3.4 Duplicidade entre canais ACTIVE/CONNECTED por phoneNumberId

```sql
SELECT
  "provider",
  "phoneNumberId",
  COUNT(*) AS total,
  ARRAY_AGG("id" ORDER BY "createdAt") AS channel_ids,
  ARRAY_AGG("companyId" ORDER BY "createdAt") AS company_ids,
  ARRAY_AGG("status" ORDER BY "createdAt") AS statuses
FROM "Channel"
WHERE "provider" = 'meta'
  AND "phoneNumberId" IS NOT NULL
  AND "status" IN ('ACTIVE', 'CONNECTED')
GROUP BY "provider", "phoneNumberId"
HAVING COUNT(*) > 1
ORDER BY total DESC, "phoneNumberId";
```

### 3.5 Duplicidade entre canais ACTIVE/CONNECTED por externalId

```sql
SELECT
  "provider",
  "externalId",
  COUNT(*) AS total,
  ARRAY_AGG("id" ORDER BY "createdAt") AS channel_ids,
  ARRAY_AGG("companyId" ORDER BY "createdAt") AS company_ids,
  ARRAY_AGG("status" ORDER BY "createdAt") AS statuses
FROM "Channel"
WHERE "provider" = 'meta'
  AND "externalId" IS NOT NULL
  AND "status" IN ('ACTIVE', 'CONNECTED')
GROUP BY "provider", "externalId"
HAVING COUNT(*) > 1
ORDER BY total DESC, "externalId";
```

Se qualquer consulta retornar linhas, parar. Não criar índices até que a
duplicidade seja analisada e resolvida em uma sprint própria.

## 4. SQL dos índices

Executar somente após:

- snapshot/backup confirmado;
- auditoria prévia sem duplicidades;
- ambiente confirmado;
- autorização explícita para a operação.

Importante: `CREATE INDEX CONCURRENTLY` não deve ser executado dentro de
transaction.

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Channel_meta_phoneNumberId_unique"
ON "Channel" ("phoneNumberId")
WHERE "provider" = 'meta'
  AND "phoneNumberId" IS NOT NULL;
```

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Channel_meta_externalId_unique"
ON "Channel" ("externalId")
WHERE "provider" = 'meta'
  AND "externalId" IS NOT NULL;
```

## 5. Verificação pós-índice

Confirmar que os índices existem e estão válidos:

```sql
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'Channel'
  AND indexname IN (
    'Channel_meta_phoneNumberId_unique',
    'Channel_meta_externalId_unique'
  )
ORDER BY indexname;
```

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
  'Channel_meta_phoneNumberId_unique',
  'Channel_meta_externalId_unique'
)
ORDER BY c.relname;
```

Também repetir a auditoria prévia após a criação dos índices para confirmar que
não há duplicidades residuais.

## 6. Rollback

Rollback remove apenas os índices. Não altera dados.

Executar somente com autorização explícita:

```sql
DROP INDEX CONCURRENTLY IF EXISTS "Channel_meta_phoneNumberId_unique";
```

```sql
DROP INDEX CONCURRENTLY IF EXISTS "Channel_meta_externalId_unique";
```

Regras de rollback:

- não executar dentro de transaction;
- capturar output completo;
- não alterar `Channel.phoneNumberId`;
- não alterar `Channel.externalId`;
- não alterar `Channel.provider`;
- não alterar `Channel.companyId`;
- se houver índice inválido, remover e investigar antes de nova tentativa.

## 7. Regras operacionais

- Não executar se a auditoria prévia encontrar duplicidade.
- Não executar dentro de transaction.
- Não executar sem snapshot/backup.
- Não executar em ambiente não confirmado.
- Não executar junto com deploy de aplicação.
- Capturar output completo da auditoria, criação dos índices e verificação.
- Se um índice ficar inválido, remover com `DROP INDEX CONCURRENTLY` e investigar.
- Não mexer em dados nesta sprint.
- Não criar migration Prisma nesta operação.
- Não usar `prisma db push`.
- Não usar `prisma migrate deploy`.

## 8. Riscos conhecidos

- Dados duplicados em produção podem fazer `CREATE UNIQUE INDEX` falhar.
- `CREATE INDEX CONCURRENTLY` reduz lock, mas ainda consome recursos e pode
  impactar performance durante a execução.
- Ambiente errado pode aplicar constraint no banco incorreto.
- O projeto não possui baseline formal de Prisma Migrate; por isso este runbook
  usa SQL operacional revisado.
- SQLite local e Postgres produção podem ter dados e comportamento operacional
  diferentes.
- Se existir duplicidade histórica por `phoneNumberId` ou `externalId`, será
  necessária sprint própria de limpeza/auditoria antes da constraint.

## 9. Checklist final de execução

Antes:

- [ ] Confirmar Railway project.
- [ ] Confirmar Railway environment.
- [ ] Confirmar Railway service/banco.
- [ ] Confirmar `DATABASE_URL` Postgres mascarada.
- [ ] Confirmar que não é SQLite local.
- [ ] Confirmar snapshot/backup.
- [ ] Confirmar janela operacional.
- [ ] Confirmar autorização explícita.
- [ ] Rodar auditoria prévia.
- [ ] Confirmar zero duplicidades.

Durante:

- [ ] Executar `CREATE UNIQUE INDEX CONCURRENTLY` para `phoneNumberId`.
- [ ] Executar `CREATE UNIQUE INDEX CONCURRENTLY` para `externalId`.
- [ ] Capturar output completo.
- [ ] Não executar dentro de transaction.

Depois:

- [ ] Verificar índices em `pg_indexes`.
- [ ] Verificar `indisvalid` e `indisready`.
- [ ] Repetir auditoria de duplicidades.
- [ ] Registrar resultado final.
- [ ] Não alterar dados.
- [ ] Não alterar aplicação.
- [ ] Não executar deploy automaticamente.
