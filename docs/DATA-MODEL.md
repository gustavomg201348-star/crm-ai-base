# Data Model

## Objetivo

Documentar o modelo de dados principal do CRM para orientar evolucao, migrations, seguranca, LGPD e testes.

## Banco

- Desenvolvimento local: SQLite via `prisma/schema.prisma`.
- Producao prevista: PostgreSQL via `prisma/schema.postgres.prisma`.
- ORM: Prisma.

## Entidades principais

### Company

Representa uma empresa/tenant. E o eixo de isolamento da maior parte do sistema.

Regras:
- Todo dado operacional deve pertencer a uma `Company` sempre que fizer sentido.
- APIs multiempresa devem validar `companyId` pela sessao.

### User

Representa usuarios do CRM.

Campos sensiveis:
- `email`
- `passwordHash`
- `role`
- `companyId`

Regras:
- Senha deve permanecer somente como hash.
- Roles atuais: `ADMIN`, `SUPERVISOR`, `AGENT`.
- Acoes globais devem exigir administrador de plataforma.

### Contact

Representa leads/clientes.

Dados pessoais:
- nome
- telefone
- CPF
- cidade/UF
- tags
- origem
- historico de atividades

Riscos:
- CPF e telefone ainda nao estao criptografados em repouso.
- Deve existir opt-out/bloqueio LGPD antes de disparos em escala.

### Conversation e Message

Armazenam atendimento, mensagens recebidas/enviadas, status, canal e historico de conversa.

Riscos:
- Crescimento rapido em volume.
- Necessidade de retencao, arquivamento e limpeza de mensagens antigas.

### Channel

Representa canais de atendimento, principalmente WhatsApp/Meta.

Dados sensiveis:
- access token
- phone number id
- WABA id
- app secret/configuracoes relacionadas

Risco critico:
- Tokens devem ser criptografados em repouso ou movidos para cofre de segredos.

### Campaign e CampaignRecipient

Controlam campanhas/disparos WhatsApp e destinatarios.

Regras:
- Disparos devem respeitar opt-out.
- Deve haver logs suficientes para auditoria.
- Deve haver limite/rate control por canal.

### RetirementLead e RetirementLeadEvent

Modulo de recem-aposentados, com jornada, score, datas estimadas e eventos.

Dados pessoais:
- contato vinculado
- beneficio/jornada
- datas e sinais comerciais

### CltIntegration e CltSimulationLog

Controlam integracoes CLT/bancos e simulacoes.

Dados sensiveis:
- credenciais bancarias
- senha/token de integracao
- logs de simulacao

Risco critico:
- Credenciais precisam de criptografia em repouso.

## Indices e constraints observados

O schema possui varios indices por `companyId`, `status`, `createdAt`, `updatedAt`, `contactId`, `conversationId`, `providerMessageId` e constraints compostas como:

- contato unico por telefone dentro do tenant.
- contato unico por CPF dentro do tenant.
- tags unicas por empresa.
- recipient unico por campanha/contato.

## Lacunas

- Nao ha migrations versionadas em `prisma/migrations`.
- Nao ha politica documentada de retencao por entidade.
- Nao ha tabela formal de opt-out/bloqueio LGPD.
- Nao ha tabela dedicada de auditoria de acessos/alteracoes sensiveis.
- Dados pessoais e tokens sensiveis ainda precisam de criptografia em repouso.

## Proximos passos

1. Criar migrations iniciais para Postgres.
2. Documentar retencao por entidade.
3. Criar modelo de opt-out/bloqueio.
4. Criar modelo de auditoria.
5. Criptografar tokens e credenciais.

