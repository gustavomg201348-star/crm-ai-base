import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function assertBefore(text: string, first: string, second: string) {
  const firstIndex = text.indexOf(first);
  const secondIndex = text.indexOf(second);
  assert.notEqual(firstIndex, -1, `${first} ausente`);
  assert.notEqual(secondIndex, -1, `${second} ausente`);
  assert.ok(firstIndex < secondIndex, `${first} deve ocorrer antes de ${second}`);
}

test("login limita IP e identidade antes do lookup e preserva erro de credenciais", () => {
  const text = source("src/app/api/auth/login/route.ts");
  assert.match(text, /category: "login-ip"/);
  assert.match(text, /category: "login-identity"/);
  assertBefore(text, "await enforceRateLimits", "prisma.user.findUnique");
  assert.match(text, /Credenciais invalidas\./);
});

test("IA e bloqueada antes da chamada OpenAI", () => {
  const text = source("src/app/api/conversations/[id]/ai/route.ts");
  assertBefore(text, "await enforceRateLimits", "await generateAiSuggestion");
});

test("envios humanos sao bloqueados antes dos providers", () => {
  const routes = [
    ["src/app/api/conversations/[id]/messages/route.ts", "await sendMetaTextMessage"],
    ["src/app/api/conversations/[id]/messages/media/route.ts", "await sendConversationMedia"],
    ["src/app/api/conversations/[id]/messages/template/route.ts", "await sendConversationTemplate"],
    ["src/app/api/channels/[id]/messages/route.ts", "await sendMetaTextMessage"]
  ] as const;

  for (const [path, providerCall] of routes) {
    assertBefore(source(path), "await enforceRateLimits", providerCall);
  }
});

test("uploads e campanhas sao bloqueados antes do trabalho caro", () => {
  assertBefore(
    source("src/app/api/templates/[id]/header-media/route.ts"),
    "await enforceRateLimits",
    "await request.formData"
  );
  for (const action of ["start", "resume"]) {
    assertBefore(
      source(`src/app/api/campaigns/[id]/${action}/route.ts`),
      "await enforceRateLimits",
      "await processCampaign"
    );
  }
});

test("webhook Meta assinado permanece fora do limiter de usuario", () => {
  const text = source("src/app/api/webhooks/whatsapp/route.ts");
  assert.doesNotMatch(text, /enforceRateLimits|rate-limit/);
  assert.match(text, /resolveVerifiedMetaWebhookChannel/);
  assert.match(text, /x-hub-signature-256/);
});

test("contador PostgreSQL usa upsert atomico sem read-then-write", () => {
  const text = source("src/lib/rate-limit.ts");
  assert.match(text, /ON CONFLICT \("key"\) DO UPDATE SET/);
  assert.match(text, /"RateLimitBucket"\."count" \+ 1/);
  assert.doesNotMatch(text, /\.rateLimitBucket\.find/);
});

test("cleanup PostgreSQL e limitado e revalida expiracao no DELETE", () => {
  const text = source("src/lib/rate-limit.ts");
  assert.match(text, /ORDER BY "expiresAt" ASC/);
  assert.match(text, /LIMIT \$\{limit\}/);
  assert.match(text, /FOR UPDATE SKIP LOCKED/);
  assert.match(text, /DELETE FROM "RateLimitBucket" AS bucket/);
  assert.match(text, /bucket\."expiresAt" <= \$\{before\}/);
});

test("migration e schemas Prisma permanecem alinhados", () => {
  const migration = source(
    "prisma/migrations/20260922120000_add_rate_limit_buckets/migration.sql"
  );
  assert.match(migration, /CREATE TABLE "RateLimitBucket"/);
  assert.match(migration, /"key" TEXT NOT NULL/);
  assert.match(migration, /"windowStart" TIMESTAMP\(3\) NOT NULL/);
  assert.match(migration, /"count" INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /"expiresAt" TIMESTAMP\(3\) NOT NULL/);
  assert.match(migration, /"updatedAt" TIMESTAMP\(3\) NOT NULL/);
  assert.match(migration, /PRIMARY KEY \("key"\)/);
  assert.match(migration, /CREATE INDEX "RateLimitBucket_expiresAt_idx"/);

  for (const schemaPath of ["prisma/schema.prisma", "prisma/schema.postgres.prisma"]) {
    const schema = source(schemaPath);
    assert.match(schema, /model RateLimitBucket \{/);
    assert.match(schema, /key\s+String\s+@id/);
    assert.match(schema, /count\s+Int\s+@default\(0\)/);
    assert.match(schema, /updatedAt\s+DateTime\s+@updatedAt/);
    assert.match(schema, /@@index\(\[expiresAt\]\)/);
  }
});

test("rotas autenticadas constroem quota somente com company e user da sessao", () => {
  const paths = [
    "src/app/api/conversations/[id]/ai/route.ts",
    "src/app/api/conversations/[id]/messages/route.ts",
    "src/app/api/conversations/[id]/messages/media/route.ts",
    "src/app/api/conversations/[id]/messages/template/route.ts",
    "src/app/api/channels/[id]/messages/route.ts",
    "src/app/api/templates/[id]/header-media/route.ts",
    "src/app/api/campaigns/[id]/start/route.ts",
    "src/app/api/campaigns/[id]/resume/route.ts"
  ];

  for (const path of paths) {
    assert.match(source(path), /identifiers: \[session\.companyId, session\.id\]/, path);
  }
});
