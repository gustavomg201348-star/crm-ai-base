# CRM SaaS Multiempresa

CRM operacional para gestao comercial, atendimento, contatos, funil, campanhas,
propostas e integracoes Meta/WhatsApp. O produto opera como um SaaS
multiempresa, com isolamento por `companyId` e modulos voltados para rotina
comercial, gestao de leads e acompanhamento executivo.

## Modulos principais

- Dashboard executivo.
- Atendimento e conversas.
- Contatos, busca, filtros, tags, origem e responsavel.
- Kanban/funil comercial.
- Disparos e campanhas.
- Canais Meta/WhatsApp.
- Multicred com leads, propostas, metas, bancos/produtos e financeiro.
- Configuracoes operacionais por empresa.

## Stack

- Next.js
- React
- TypeScript
- Tailwind CSS
- Prisma
- SQLite em desenvolvimento local
- PostgreSQL em producao
- Railway/Docker para deploy
- Meta/WhatsApp Cloud API

## Desenvolvimento local

Copie `.env.example` para `.env` antes de ligar integracoes reais.

```powershell
npm.cmd install
npm.cmd run db:setup
npm.cmd run dev
```

A base local usa SQLite em `prisma/dev.db`. Ambientes de producao devem usar
PostgreSQL e variaveis seguras.

## Validacao

Para mudancas em codigo, execute:

```powershell
npm.cmd run verify
npx.cmd prisma validate --schema prisma/schema.prisma
npm.cmd run typecheck
npm.cmd run lint:ci
```

Para mudancas apenas em documentacao, nao e necessario rodar build por padrao.
Ainda assim, confira:

```powershell
git diff
git status --short
```

## Deploy

Arquivos de deploy:

- `Dockerfile`
- `railway.toml`
- `docker-compose.production.yml`
- `.env.production.example`
- `docs/DEPLOY.md`

Fluxo resumido para Railway:

1. Subir o projeto para um repositorio GitHub privado.
2. Criar um projeto no Railway.
3. Adicionar PostgreSQL.
4. Adicionar o app pelo repositorio GitHub.
5. Configurar `DATABASE_URL`, `AUTH_SECRET`, variaveis Meta/WhatsApp e demais
   segredos.
6. Validar `/api/health` apos o deploy.

Webhook publico esperado para Meta/WhatsApp:

```text
https://crm.seudominio.com/api/webhooks/whatsapp
```

## Seguranca

- O CRM e multiempresa; toda leitura/escrita de dados deve respeitar
  `companyId`.
- Canais Meta/WhatsApp devem ser tratados como area sensivel por envolverem
  `phoneNumberId`, `wabaId`, `accessToken`, `verifyToken` e `appSecret`.
- Tokens, telefones, CPFs, mensagens e dados financeiros devem ser tratados como
  dados sensiveis/LGPD.
- Nao rode migrations, `prisma db push`, seeds ou scripts de correcao de dados
  sem autorizacao explicita.

## Documentos

- `AGENTS.md` - regras operacionais para Codex/agentes.
- `CHANGELOG.md` - historico de mudancas no padrao Keep a Changelog.
- `docs/META-MULTI-CANAL-ROADMAP.md` - visao de evolucao para multiempresa e
  multi-API Meta/WhatsApp.
- `docs/DEPLOY.md` - detalhes de deploy.
