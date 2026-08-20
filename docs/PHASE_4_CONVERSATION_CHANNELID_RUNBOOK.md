# Fase 4 - Runbook Railway/Postgres para Conversation.channelId

Este runbook prepara a aplicacao da estrutura `Conversation.channelId` no
Railway/Postgres usando SQL aditivo revisado.

Ele nao deve ser executado automaticamente. Cada etapa operacional exige
confirmacao humana, snapshot recente e autorizacao explicita.

## 1. Objetivo

Aplicar em producao a estrutura nullable de `Conversation.channelId`, preservando
`Conversation.channel` durante a transicao.

O processo cobre:

- verificacao previa da estrutura existente;
- aplicacao de SQL aditivo;
- verificacao pos-estrutura;
- dry-run do backfill;
- snapshot antes do apply;
- apply futuro somente com autorizacao explicita;
- auditoria pos-apply;
- rollback.

Este runbook nao faz backfill automaticamente e nao remove campos legados.

## 2. Pre-requisitos

Antes de qualquer comando:

- Confirmar no Railway o projeto correto.
- Confirmar o environment correto.
- Confirmar o servico correto.
- Confirmar que a `DATABASE_URL` aponta para Postgres.
- Conferir a `DATABASE_URL` somente de forma mascarada.
- Confirmar que nao esta usando SQLite local.
- Confirmar acesso seguro ao banco.
- Criar snapshot/backup no Railway antes da alteracao estrutural.
- Registrar horario, responsavel e objetivo da operacao.

Checklist minimo:

```text
[ ] Projeto Railway confirmado.
[ ] Environment Railway confirmado.
[ ] Servico/banco confirmado.
[ ] DATABASE_URL inicia com postgresql:// ou postgres://.
[ ] DATABASE_URL nao foi exposta em chat, commit, log publico ou documentacao.
[ ] Snapshot antes da estrutura criado.
[ ] Janela operacional definida.
[ ] Plano de rollback revisado.
```

## 3. SQL de verificacao previa

Executar somente apos confirmar o ambiente correto.

### 3.1 Verificar coluna

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'Conversation'
  AND column_name = 'channelId';
```

Resultado esperado antes da estrutura, se ainda nao aplicada:

```text
0 linhas
```

Resultado esperado se ja aplicada:

```text
channelId | text | YES
```

### 3.2 Verificar foreign key

```sql
SELECT conname
FROM pg_constraint
WHERE conrelid = '"Conversation"'::regclass
  AND conname = 'Conversation_channelId_fkey';
```

### 3.3 Verificar indices

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'Conversation'
  AND indexname IN (
    'Conversation_channelId_idx',
    'Conversation_contactId_channelId_status_idx'
  )
ORDER BY indexname;
```

## 4. SQL estrutural aditivo

Executar somente apos snapshot e autorizacao operacional.

Este SQL:

- adiciona `channelId` nullable;
- cria FK opcional para `Channel(id)`;
- cria indices;
- preserva `Conversation.channel`;
- nao altera dados;
- nao executa backfill;
- nao cria unique constraint.

```sql
ALTER TABLE "Conversation"
ADD COLUMN IF NOT EXISTS "channelId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = '"Conversation"'::regclass
      AND conname = 'Conversation_channelId_fkey'
  ) THEN
    ALTER TABLE "Conversation"
    ADD CONSTRAINT "Conversation_channelId_fkey"
    FOREIGN KEY ("channelId")
    REFERENCES "Channel"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Conversation_channelId_idx"
ON "Conversation"("channelId");

CREATE INDEX IF NOT EXISTS "Conversation_contactId_channelId_status_idx"
ON "Conversation"("contactId", "channelId", "status");
```

## 5. SQL de verificacao pos-estrutura

### 5.1 Confirmar coluna nullable

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'Conversation'
  AND column_name = 'channelId';
```

Esperado:

```text
channelId | text | YES
```

### 5.2 Confirmar FK

```sql
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = '"Conversation"'::regclass
  AND conname = 'Conversation_channelId_fkey';
```

Esperado:

```text
Conversation_channelId_fkey
FOREIGN KEY ("channelId") REFERENCES "Channel"(id) ON UPDATE CASCADE ON DELETE SET NULL
```

### 5.3 Confirmar indices

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'Conversation'
  AND indexname IN (
    'Conversation_channelId_idx',
    'Conversation_contactId_channelId_status_idx'
  )
ORDER BY indexname;
```

Esperado:

```text
Conversation_channelId_idx
Conversation_contactId_channelId_status_idx
```

## 6. Dry-run de backfill

Depois da estrutura aplicada e validada, executar somente dry-run.

Comando sugerido:

```powershell
railway run node scripts/backfill-conversation-channel-id.mjs
```

Confirmar no output:

```text
Modo: DRY-RUN
Nenhuma alteracao sera executada sem a flag --apply.
```

Relatorio que deve ser revisado:

- total de conversas;
- total elegivel;
- total nao elegivel;
- total `channel = "whatsapp"`;
- total channel invalido;
- total Channel inexistente;
- total Channel de outra company;
- agrupamento por `channelId/provider/status/companyId`;
- IDs elegiveis;
- `previousChannelId`;
- `newChannelId`.

Sinais de alerta:

- `companyMismatch` maior que zero;
- muitos `missingChannel`;
- datasource inesperado;
- elegiveis com canal desconhecido;
- relatorio diferente do esperado para o ambiente.

## 7. Snapshot antes do apply

Antes de qualquer backfill com `--apply`, criar novo snapshot no Railway.

Este snapshot deve ser feito depois da estrutura e antes do backfill, porque:

- o snapshot anterior protege a alteracao estrutural;
- este snapshot protege a alteracao de dados.

Checklist:

```text
[ ] Dry-run revisado.
[ ] IDs elegiveis aprovados.
[ ] Snapshot pos-estrutura/pre-apply criado.
[ ] Autorizacao explicita para --apply recebida.
```

## 8. Apply futuro

Executar somente com autorizacao explicita.

Comando:

```powershell
railway run node scripts/backfill-conversation-channel-id.mjs --apply
```

Regras:

- Nao rodar `--apply` sem snapshot recente.
- Nao rodar `--apply` sem revisar o dry-run.
- Nao rodar `--apply` se o datasource estiver incorreto.
- Nao rodar `--apply` se houver `companyMismatch` nao explicado.
- Capturar e guardar o output completo.

O output do apply deve registrar:

- IDs afetados;
- `previousChannelId`;
- `newChannelId`;
- se cada item foi atualizado.

## 9. Auditoria pos-apply

Rodar novamente dry-run:

```powershell
railway run node scripts/backfill-conversation-channel-id.mjs
```

Esperado:

- `eligible = 0`, se todos os elegiveis foram aplicados;
- `alreadyHasChannelId` aumenta;
- `genericWhatsapp` permanece sem `channelId`;
- `Conversation.channel` permanece inalterado.

Consultas de conferencia:

```sql
SELECT
  COUNT(*) AS total,
  COUNT("channelId") AS channel_id_preenchido,
  COUNT(*) - COUNT("channelId") AS channel_id_null
FROM "Conversation";
```

```sql
SELECT channel, COUNT(*)
FROM "Conversation"
GROUP BY channel
ORDER BY channel;
```

```sql
SELECT COUNT(*) AS genericas_preservadas
FROM "Conversation"
WHERE channel = 'whatsapp'
  AND "channelId" IS NULL;
```

```sql
SELECT id, channel, "channelId"
FROM "Conversation"
WHERE channel = 'whatsapp'
  AND "channelId" IS NOT NULL;
```

Esperado para a ultima consulta:

```text
0 linhas
```

## 10. Rollback

Rollback preferencial:

- restaurar snapshot Railway criado antes do apply.

Alternativa por IDs afetados:

- usar o relatorio do apply;
- restaurar `channelId` apenas para os IDs afetados;
- nunca alterar `Conversation.channel`.

Modelo conceitual de rollback por IDs:

```sql
UPDATE "Conversation"
SET "channelId" = NULL
WHERE id IN (
  -- IDs afetados pelo apply
);
```

Se algum item tinha `previousChannelId` diferente de `NULL`, restaurar o valor
original em vez de limpar.

Nunca executar rollback manual sem plano revisado.

## 11. Riscos conhecidos

- Ambiente errado: Railway CLI pode apontar para projeto/environment incorreto.
- Schema/client divergente: app e banco podem estar em versoes diferentes.
- Dados de producao podem diferir do SQLite local.
- `phoneNumberId`/`externalId` duplicado entre empresas ainda e risco conhecido
  fora deste runbook.
- `providerMessageId` concorrente ainda e risco conhecido fora deste runbook.
- Sandbox e permitido quando o ID esta explicitamente gravado em
  `Conversation.channel`.
- Ausencia de baseline Prisma Migrate torna migrations formais mais arriscadas
  neste momento.
- O fluxo legado de Railway que podia usar `prisma db push` foi tratado em fase
  propria de governanca de migrations; producao deve seguir `prisma migrate deploy`.

## 12. Checklist final de execucao

### Antes da estrutura

```text
[ ] Projeto Railway confirmado.
[ ] Environment Railway confirmado.
[ ] Servico Postgres confirmado.
[ ] DATABASE_URL mascarada e conferida.
[ ] Snapshot antes da estrutura criado.
[ ] SQL de verificacao previa executado.
[ ] Estado atual documentado.
```

### Estrutura

```text
[ ] SQL aditivo revisado.
[ ] SQL estrutural executado.
[ ] Coluna channelId confirmada.
[ ] FK confirmada.
[ ] Indices confirmados.
[ ] Conversation.channel preservado.
```

### Dry-run

```text
[ ] Dry-run executado sem --apply.
[ ] Datasource conferido no output.
[ ] Relatorio revisado.
[ ] IDs elegiveis aprovados.
[ ] Genéricas channel = "whatsapp" preservadas.
[ ] Nenhum companyMismatch critico.
```

### Apply

```text
[ ] Snapshot pos-estrutura/pre-apply criado.
[ ] Autorizacao explicita para --apply recebida.
[ ] Apply executado.
[ ] Output completo salvo.
[ ] IDs afetados registrados.
```

### Pos-apply

```text
[ ] Dry-run pos-apply executado.
[ ] eligible = 0 ou divergencia explicada.
[ ] Totais conferidos.
[ ] Genericas preservadas com channelId null.
[ ] Conversation.channel confirmado como inalterado.
[ ] Plano de rollback arquivado junto com o relatorio.
```
