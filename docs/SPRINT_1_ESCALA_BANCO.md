# SPRINT 1 - Fundacao do Banco e Escalabilidade

## Objetivo

Preparar a base do CRM para crescer com mais seguranca em volume de contatos, conversas, mensagens, campanhas e tarefas, com foco em reduzir lentidao em consultas frequentes e diagnosticar riscos antes de aplicar constraints definitivas.

Esta sprint nao cria o modulo de Recem-Aposentados, nao adiciona Redis, BullMQ, workers ou novas regras de negocio.

## Arquivos alterados

- `prisma/schema.prisma`
- `prisma/schema.postgres.prisma`
- `scripts/audit-duplicates.mjs`
- `scripts/fix-contact-indexes-readiness.mjs`
- `docs/SPRINT_1_ESCALA_BANCO.md`

## Indices e constraints adicionados

### Contact

Adicionado nos schemas local e Postgres:

- `@@unique([companyId, phone])`
- `@@unique([companyId, cpf])`
- `@@index([companyId, updatedAt])`
- `@@index([companyId, createdAt])`

Observacao: os indices compostos `companyId + phone` e `companyId + cpf` ficam cobertos pelos uniques compostos. Isso evita criar indices duplicados com a mesma finalidade.

### Conversation

Adicionado:

- `@@index([contactId])`
- `@@index([agentId])`
- `@@index([agentId, status, updatedAt])`
- `@@index([lastMessageAt])`
- `@@index([status])`

Esses indices ajudam a tela de atendimento, filtros por responsavel/status e ordenacao por ultima atividade.

### Message

Adicionado:

- `@@index([conversationId, createdAt])`
- `@@index([status])`
- `@@index([direction])`

Mantido:

- `@@index([providerMessageId])`

`providerMessageId` nao foi transformado em unique nesta sprint. Antes disso, e recomendado auditar mensagens antigas e eventos duplicados da Meta, pois webhooks podem ser reenviados e alguns registros podem estar sem provider id.

### CampaignRecipient

Adicionado:

- `@@index([campaignId, status])`
- `@@index([contactId, status])`

Ja existia:

- `@@unique([campaignId, contactId])`
- `@@index([contactId])`
- `@@index([conversationId])`
- `@@index([providerMessageId])`
- `@@index([status])`

### Task

Adicionado:

- `@@index([companyId, status, dueAt])`
- `@@index([assigneeId, status, dueAt])`

Esses indices ajudam agenda, tarefas pendentes por empresa e tarefas por atendente.

### Tag

Adicionado:

- `@@unique([companyId, name])`

Antes de aplicar, o diagnostico local confirmou que nao havia tags duplicadas por empresa.

### PipelineStage

Adicionado:

- `@@index([companyId, position])`

Esse indice ajuda a carregar etapas do funil ordenadas por empresa.

## Diagnostico de duplicidades

Criado `scripts/audit-duplicates.mjs`.

O script lista, sem alterar dados:

- contatos duplicados por telefone dentro da mesma empresa
- contatos duplicados por CPF dentro da mesma empresa
- CPFs vazios duplicados dentro da mesma empresa
- quantidade de telefones vazios
- quantidade de CPFs vazios

Comando:

```bash
node scripts/audit-duplicates.mjs
```

Criado `scripts/fix-contact-indexes-readiness.mjs`.

O script roda o diagnostico e informa se a base esta pronta para:

- `Contact companyId + phone`
- `Contact companyId + cpf`
- `Tag companyId + name`

Ele nao exclui, mescla ou corrige dados automaticamente.

Comando:

```bash
node scripts/fix-contact-indexes-readiness.mjs
```

## Resultado do diagnostico local

No banco local, os scripts retornaram:

- nenhum contato duplicado por telefone
- nenhum contato duplicado por CPF
- nenhum CPF vazio duplicado
- nenhum telefone vazio
- nenhuma tag duplicada por empresa

Por isso os uniques compostos foram aplicados nos schemas.

## CPF opcional e unique composto

O campo `Contact.cpf` e opcional.

No Postgres, um unique composto permite multiplas linhas com `cpf = NULL`, inclusive dentro da mesma empresa. Isso e adequado para contatos sem CPF. O ponto de atencao e evitar salvar CPF vazio como string vazia (`""`), porque string vazia e valor real e pode conflitar com `@@unique([companyId, cpf])`.

Recomendacao: manter a importacao e cadastros normalizando CPF vazio para `null`.

## Importacao existente

A importacao atual continua preservada: contatos existentes devem ser atualizados por CPF ou telefone, sem duplicar historico.

Com os uniques aplicados, qualquer fluxo futuro que tente criar dois contatos com mesmo telefone ou CPF na mesma empresa sera bloqueado pelo banco. Isso protege escala, mas tambem exige tratamento de erro amigavel no frontend/backend em fluxos novos.

## Riscos encontrados

- `providerMessageId` ainda nao e unique. Antes de mudar, auditar mensagens duplicadas por provider id.
- CPF vazio como `""` pode quebrar unique; preferir `null`.
- Com muitos milhoes de mensagens, indices ajudam, mas ainda sera necessario particionamento/arquivamento ou estrategia de historico frio no futuro.
- Campanhas em alto volume ainda precisam de fila dedicada e controle de concorrencia fora desta sprint.
- O schema SQLite local manteve o mapeamento do unique antigo de `User.email` para evitar que o Prisma tente renomear/dropar um indice interno do SQLite.

## Validacoes executadas

Comandos executados no ambiente local:

```bash
node scripts/audit-duplicates.mjs
node scripts/fix-contact-indexes-readiness.mjs
npx.cmd prisma validate
npx.cmd prisma validate --schema prisma/schema.postgres.prisma
npm.cmd run prisma:push
npm.cmd run prisma:push -- --skip-generate
npm.cmd run build
```

Resultado:

- schemas local e Postgres validos
- banco SQLite local sincronizado com o schema
- build de producao concluido com sucesso

Observacao: o primeiro `prisma:push` sincronizou o banco, mas o `generate` automatico encontrou um arquivo do engine Prisma bloqueado pelo Windows (`EPERM`). Em seguida, foi executado `npm.cmd run prisma:push -- --skip-generate`, que confirmou o banco em sincronia. O build passou normalmente.

Historicamente, esta etapa citava um script legado de `db push` para producao. Esse caminho nao deve mais ser usado. O fluxo operacional atual para producao deve aplicar schema por migrations com `npm run prisma:migrate:prod`, executado de forma bloqueante pelo startup Railway antes de iniciar o app.

## Proximos passos recomendados

1. Criar diagnostico para `Message.providerMessageId` duplicado e avaliar unique parcial no Postgres.
2. Normalizar CPF vazio para `null` nos fluxos de cadastro/importacao.
3. Planejar paginacao cursor-based para mensagens e contatos.
4. Preparar camada de jobs/filas para disparos e importacoes grandes.
5. Definir estrategia para arquivar mensagens antigas quando o volume passar de milhoes.
