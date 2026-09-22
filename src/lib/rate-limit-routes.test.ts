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
