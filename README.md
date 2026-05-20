# CRM AI Base

Base inicial para um CRM operacional com IA, atendimento, contatos, pipeline e um modulo de credito.

## Stack

- Next.js + TypeScript
- Tailwind CSS
- Prisma + PostgreSQL
- Preparado para WhatsApp/Meta e IA

## Rodando localmente

```bash
npm install
npm run db:setup
npm run dev
```

Copie `.env.example` para `.env` antes de ligar integracoes reais. A base local usa SQLite em `prisma/dev.db`.

## Producao rapida

Para colocar no Railway via GitHub ou em servidor com Postgres e URL fixa, use os arquivos:

- `Dockerfile`
- `railway.toml`
- `docker-compose.production.yml`
- `.env.production.example`
- `docs/DEPLOY.md`

Fluxo resumido para Railway:

1. Suba este projeto para um repositorio GitHub privado.
2. Crie um projeto no Railway.
3. Adicione Postgres.
4. Adicione o app pelo repositorio GitHub.
5. Configure `DATABASE_URL`, `AUTH_SECRET`, `META_VERIFY_TOKEN` e demais variaveis.

Fluxo resumido para VPS:

```bash
cp .env.production.example .env.production
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
```

Depois configure a URL HTTPS final na Meta:

```text
https://crm.seudominio.com/api/webhooks/whatsapp
```

Usuario inicial do seed:

- Email: `admin@crm.local`
- Senha: `admin123`

## Primeiro escopo

- Dashboard com indicadores e analise IA simulada
- Atendimento com filas e sugestao de resposta
- Contatos com tags, origem e responsavel
- Kanban com etapas configuraveis
- Multicred com leads, propostas, metas e financeiro
- Configuracoes operacionais para empresa, tags, etapas e APIs
