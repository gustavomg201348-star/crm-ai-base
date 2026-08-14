# Prisma baseline partial indexes

Este documento registra os objetos PostgreSQL manuais que fazem parte do estado
atual de produção e precisam ser preservados na baseline Prisma.

Eles não são representados diretamente no Prisma schema atual porque dependem de
predicados `WHERE` em índices únicos parciais. A baseline local inclui esses
objetos explicitamente em:

`prisma/migrations/00000000000000_baseline/migration.sql`

## Contact_companyId_normalizedPhone_unique

- Tabela: `Contact`
- SQL:

```sql
CREATE UNIQUE INDEX "Contact_companyId_normalizedPhone_unique"
ON "Contact" ("companyId", "normalizedPhone")
WHERE "normalizedPhone" IS NOT NULL;
```

- Regra protegida: dentro de uma empresa, um telefone normalizado preenchido não
  pode identificar mais de um contato.
- Por que não está no Prisma schema: Prisma não representa unique parcial com
  `WHERE "normalizedPhone" IS NOT NULL`.
- Como verificar:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'Contact'
  AND indexname = 'Contact_companyId_normalizedPhone_unique';
```

- Risco se desaparecer: duplicidade de identidade telefônica por empresa,
  fragmentação de atendimento e risco de conflito em importações.

## Conversation_open_contact_channel_unique

- Tabela: `Conversation`
- SQL:

```sql
CREATE UNIQUE INDEX "Conversation_open_contact_channel_unique"
ON "Conversation" ("contactId", "channelId")
WHERE "channelId" IS NOT NULL
  AND "status" IN ('OPEN', 'PENDING', 'BOT', 'SOLD');
```

- Regra protegida: um contato não deve ter mais de uma conversa ativa/operacional
  no mesmo canal.
- Por que não está no Prisma schema: Prisma não representa unique parcial por
  subconjunto de status.
- Como verificar:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'Conversation'
  AND indexname = 'Conversation_open_contact_channel_unique';
```

- Risco se desaparecer: duplicação de conversas abertas no mesmo canal e
  fragmentação do Atendimento.

## Message_providerMessageId_unique

- Tabela: `Message`
- SQL:

```sql
CREATE UNIQUE INDEX "Message_providerMessageId_unique"
ON "Message" ("providerMessageId")
WHERE "providerMessageId" IS NOT NULL;
```

- Regra protegida: idempotência de mensagens recebidas/enviadas pelo provedor
  quando o identificador externo existe.
- Por que não está no Prisma schema: Prisma não representa unique parcial para
  permitir múltiplos `NULL`.
- Como verificar:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'Message'
  AND indexname = 'Message_providerMessageId_unique';
```

- Risco se desaparecer: mensagens duplicadas em retry/webhook e perda de
  idempotência operacional.

## CampaignRecipient_providerMessageId_unique

- Tabela: `CampaignRecipient`
- SQL:

```sql
CREATE UNIQUE INDEX "CampaignRecipient_providerMessageId_unique"
ON "CampaignRecipient" ("providerMessageId")
WHERE "providerMessageId" IS NOT NULL;
```

- Regra protegida: idempotência de envio/status de destinatários de campanha
  quando o identificador externo existe.
- Por que não está no Prisma schema: Prisma não representa unique parcial para
  permitir múltiplos `NULL`.
- Como verificar:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'CampaignRecipient'
  AND indexname = 'CampaignRecipient_providerMessageId_unique';
```

- Risco se desaparecer: reprocessamento com duplicidade de envio/status em
  campanhas.

## Channel_meta_phoneNumberId_unique

- Tabela: `Channel`
- SQL:

```sql
CREATE UNIQUE INDEX "Channel_meta_phoneNumberId_unique"
ON "Channel" ("phoneNumberId")
WHERE "provider" = 'meta'
  AND "phoneNumberId" IS NOT NULL;
```

- Regra protegida: um `phoneNumberId` Meta não pode pertencer a mais de um canal.
- Por que não está no Prisma schema: Prisma não representa unique parcial por
  provider e valor não nulo.
- Como verificar:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'Channel'
  AND indexname = 'Channel_meta_phoneNumberId_unique';
```

- Risco se desaparecer: roteamento Meta ambíguo e possibilidade de misturar canais
  ou empresas.

## Channel_meta_externalId_unique

- Tabela: `Channel`
- SQL:

```sql
CREATE UNIQUE INDEX "Channel_meta_externalId_unique"
ON "Channel" ("externalId")
WHERE "provider" = 'meta'
  AND "externalId" IS NOT NULL;
```

- Regra protegida: um identificador externo Meta não pode pertencer a mais de um
  canal.
- Por que não está no Prisma schema: Prisma não representa unique parcial por
  provider e valor não nulo.
- Como verificar:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'Channel'
  AND indexname = 'Channel_meta_externalId_unique';
```

- Risco se desaparecer: resolução ambígua de canal Meta e risco de roteamento
  incorreto.

## Observação sobre índices comuns

A baseline também mantém índices comuns gerados pelo Prisma, como
`Contact_companyId_normalizedPhone_idx`, `Message_providerMessageId_idx` e
`CampaignRecipient_providerMessageId_idx`.

Eles não foram removidos nesta fase. O objetivo da Fase 7 é representar produção
atual, não otimizar ou redesenhar índices. Qualquer remoção ou consolidação deve
ser tratada em uma auditoria de performance separada.
