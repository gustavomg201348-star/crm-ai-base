# Deploy rapido do CRM

Este projeto continua usando SQLite localmente, mas a producao deve usar Postgres.

## 1. Preparar variaveis

Copie o exemplo:

```bash
cp .env.production.example .env.production
```

Preencha pelo menos:

- `POSTGRES_PASSWORD`
- `AUTH_SECRET`
- `META_VERIFY_TOKEN`
- `META_APP_SECRET`, se quiser validar assinatura do webhook
- `OPENAI_API_KEY`, quando for ativar IA real

## 2. Deploy pelo GitHub + Railway

1. Suba este projeto para um repositorio GitHub privado.
2. No Railway, crie um novo projeto.
3. Adicione um banco **Postgres** ao projeto.
4. Adicione um novo servico a partir do repositorio GitHub.
5. Confirme que o Railway encontrou o arquivo `railway.toml`.
6. Configure as variaveis no servico do CRM:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
AUTH_SECRET=gere-um-segredo-longo
META_VERIFY_TOKEN=crm-meta-verify-2026
META_APP_SECRET=
META_GRAPH_VERSION=v25.0
OPENAI_API_KEY=
```

O `railway.toml` roda automaticamente antes do deploy:

```bash
npm run prisma:push:prod && npm run prisma:seed:prod
```

E inicia o app com:

```bash
npm run start
```

## 3. Subir em uma VPS com Docker

```bash
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
```

O app sobe em `http://SEU_SERVIDOR:3000`.

## 4. Colocar HTTPS e dominio

Para atendimento real, coloque um proxy HTTPS na frente do app, por exemplo:

- Cloudflare Tunnel
- Nginx Proxy Manager
- Caddy
- Traefik

URL final esperada:

```text
https://crm.seudominio.com
```

Webhook da Meta:

```text
https://crm.seudominio.com/api/webhooks/whatsapp
```

## 5. Configurar Meta

No app Meta Developers, troque a URL atual do ngrok pela URL final acima e use o mesmo `META_VERIFY_TOKEN`.

Depois confirme se a WABA esta inscrita no app correto:

```bash
GET /2031719571557966/subscribed_apps
```

## 6. Primeiro acesso

O seed cria:

- Email: `admin@crm.local`
- Senha: `admin123`

Troque essa senha assim que o CRM estiver no ar.

## 7. Depois do deploy

Crie o canal Meta no menu Canais ou migre o canal atual do banco local:

- Phone Number ID: `1018581788012647`
- WABA ID: `2031719571557966`
- Numero: `+55 33 8433-3103`

Nunca publique token da Meta em chat, README ou repositorio.

## 8. Checagens rapidas

Healthcheck publico usado pelo Railway:

```text
https://crm.seudominio.com/api/health
```

Diagnostico autenticado, depois de fazer login no CRM:

```text
https://crm.seudominio.com/api/system/readiness
```

Esse diagnostico confirma banco, contagens basicas e se os canais WhatsApp Meta tem os campos minimos sem expor tokens.
