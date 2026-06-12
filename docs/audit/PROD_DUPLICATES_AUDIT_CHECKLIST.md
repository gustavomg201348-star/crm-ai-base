# Checklist Seguro: Auditoria De Duplicidades No Postgres Producao/Railway

## Objetivo

Preparar a auditoria real de producao sem risco operacional.

Esta auditoria deve executar apenas diagnosticos de duplicidade no banco Postgres de producao/Railway, sem alterar dados, schema, deploy ou configuracoes.

## Regras

- Nao executar queries antes da janela autorizada.
- Nao executar `UPDATE`, `DELETE`, `INSERT`, `ALTER`, `CREATE` ou `DROP`.
- Nao criar migrations.
- Nao alterar schema Prisma.
- Nao alterar Railway/deploy.
- Nao alterar scripts de deploy.
- Nao expor `DATABASE_URL`, tokens, senhas ou segredos em docs, commits ou chats.

## 1. Backup/snapshot antes da auditoria

Antes de qualquer conexao:

1. Acessar o projeto no Railway.
2. Abrir o servico do banco Postgres.
3. Criar um backup/snapshot manual, se disponivel no plano.
4. Confirmar que existe backup automatico recente.
5. Registrar:
   - data/hora do backup;
   - nome/id do projeto;
   - ambiente;
   - banco usado;
   - responsavel pela auditoria.

Recomendacao: restaurar o backup em staging e rodar a auditoria primeiro na copia.

## 2. Acesso seguro ao Postgres

Use somente credenciais oficiais do Railway.

Boas praticas:

- Nao colar `DATABASE_URL` em chats, commits ou docs publicos.
- Preferir terminal local seguro ou console SQL do Railway.
- Usar usuario com permissao somente leitura, se existir.
- Nao usar ferramentas que auto-salvam historico com senha visivel.
- Nao executar scripts com comandos mistos; apenas SELECTs.

Exemplo seguro com `psql`:

```bash
psql "$DATABASE_URL"
```

Opcionalmente, ativar saida mais legivel:

```sql
\x auto
```

## 3. Queries SELECT de diagnostico

### 3.1 Contatos duplicados por `(companyId, phone)`

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

### 3.2 Contatos duplicados por `(companyId, cpf)`, ignorando CPF nulo

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

### 3.3 Usuarios com email duplicado

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

### 3.4 CampaignRecipient duplicado por `(campaignId, contactId)`

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

### 3.5 Message com `providerMessageId` duplicado, ignorando nulos

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

### 3.6 CampaignRecipient com `providerMessageId` duplicado, ignorando nulos

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

### 3.7 Tags duplicadas por `(companyId, name)`

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

### 3.8 Canais duplicados por `(companyId, phoneNumberId)`, ignorando nulos

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

## 4. Como salvar os resultados

Criar um arquivo local com data, por exemplo:

```text
docs/audit/PROD_DUPLICATES_AUDIT_YYYY-MM-DD.md
```

Para cada query, registrar:

```text
Consulta:
Contact duplicado por (companyId, phone)

Resultado:
0 linhas
```

Se houver linhas, salvar:

- nome da consulta;
- quantidade de linhas retornadas;
- chaves duplicadas;
- IDs envolvidos;
- horario da execucao;
- ambiente auditado.

Nunca salvar:

- `DATABASE_URL`;
- senha;
- token;
- segredo;
- valores sensiveis desnecessarios.

## 5. Como interpretar os resultados

### 0 duplicidades

- A consulta nao encontrou conflito para aquela regra.
- Pode avancar para planejamento de baseline se todas as 8 consultas retornarem zero.

### Duplicidades encontradas

- Parar antes de criar migration ou constraint.
- Nao aplicar unique ou constraint relacionada.
- Fazer analise de negocio: mesclar, arquivar, corrigir ou remover duplicados.
- Reexecutar a auditoria apos limpeza.

### Erro de permissao/conexao

- Nao concluir que esta seguro.
- Verificar se a URL aponta para o banco correto.
- Confirmar usuario, SSL, rede e permissoes.
- Rodar novamente apenas quando a conexao estiver validada.

## 6. Quando e seguro avancar para baseline Prisma Migrate

Avancar apenas se:

- backup/snapshot foi confirmado;
- ambiente auditado e realmente producao ou copia fiel;
- as 8 queries retornaram 0 linhas;
- nao houve erro de conexao/permissao;
- schema Prisma atual foi validado;
- deploy atual esta estavel;
- existe janela de manutencao ou plano de rollback.

Classificacao: **seguro para preparar baseline**.

## 7. Quando e obrigatorio parar e limpar dados antes

Parar e limpar dados antes se:

- qualquer query retornar duplicidades;
- houver duvida se o banco auditado e producao;
- backup nao estiver confirmado;
- usuario nao tiver permissao para auditar todas as tabelas;
- houver drift conhecido entre producao e schema Prisma;
- deploy estiver instavel;
- houver dados sensiveis expostos em logs ou resultado compartilhado.

Classificacao:

- Uma ou mais duplicidades: **precisa limpeza antes**.
- Erro de conexao/permissao ou ambiente incerto: **risco alto**.

