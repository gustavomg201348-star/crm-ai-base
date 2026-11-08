import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { test } from "node:test";
import type { Channel } from "@prisma/client";
import { NextRequest } from "next/server";
import { bootstrapPhone, compatibleBootstrapTemplate, bootstrapTemplateFingerprint, validBootstrapChannel } from "./opencredit-whatsapp-policy";
import { parseWhatsappBootstrapConfig } from "./opencredit-whatsapp-config.service";
import type { SessionUser } from "./auth";

const loader = Module as typeof Module & { _load(name: string, ...args: unknown[]): unknown };
const original = loader._load, require = createRequire(import.meta.url);
let management: typeof import("./opencredit-whatsapp-management-handler");
loader._load = (name, ...args) => name === "server-only" ? {} : original.call(loader, name, ...args);
try { management = require("./opencredit-whatsapp-management-handler"); } finally { loader._load = original; }
const channel = { companyId: "synthetic-company", provider: "meta", type: "whatsapp", status: "ACTIVE", phoneNumberId: "1234567890", wabaId: "synthetic" } as Channel;
const template = { name: "synthetic", language: "pt_BR", status: "APPROVED", components: [{ type: "BODY", text: "Synthetic greeting" }] };
const config = { defaultWhatsappChannelId: "synthetic-channel", initialTemplateName: "synthetic", initialTemplateLanguage: "pt_BR", autoStartEnabled: false, expectedRevision: 0 };
test("channel binding is explicit, same tenant and Meta only", () => {
  assert.equal(validBootstrapChannel(channel, channel.companyId), true);
  for (const change of [{ companyId: "foreign" }, { provider: "internal" }, { type: "OPEN_CREDIT" }, { status: "INACTIVE" }, { phoneNumberId: "bad" }, { wabaId: null }]) {
    assert.equal(validBootstrapChannel({ ...channel, ...change }, channel.companyId), false);
  }
  assert.equal(validBootstrapChannel(null, channel.companyId), false);
});
test("phone uses existing normalization, rejects archived or divergent identity; never CPF fallback", () => {
  assert.equal(bootstrapPhone({ phone: "(11) 98765-4321", normalizedPhone: "5511987654321", archivedAt: null }), "5511987654321");
  for (const c of [{ phone: "12345678909", normalizedPhone: null, archivedAt: new Date() },
    { phone: "5511987654321", normalizedPhone: "5511976543210", archivedAt: null }, { phone: "", normalizedPhone: null, archivedAt: null }]) assert.equal(bootstrapPhone(c), null);
});
test("V1 only accepts approved static templates and fingerprint binds WABA/content/language", () => {
  assert.equal(compatibleBootstrapTemplate(template), true);
  for (const t of [{ ...template, status: "REJECTED" }, { ...template, components: [{ type: "BODY", text: "Hello {{1}}" }] },
    { ...template, components: [{ type: "HEADER", format: "IMAGE" }, ...template.components] },
    { ...template, components: [{ type: "UNKNOWN" }, ...template.components] }]) assert.equal(compatibleBootstrapTemplate(t), false);
  const fp = bootstrapTemplateFingerprint(template, "synthetic-waba"); assert.match(fp, /^[a-f0-9]{64}$/);
  assert.equal(fp, bootstrapTemplateFingerprint(template, "synthetic-waba"));
  assert.notEqual(fp, bootstrapTemplateFingerprint(template, "foreign-waba"));
  assert.notEqual(fp, bootstrapTemplateFingerprint({ ...template, language: "en_US" }, "synthetic-waba"));
});
test("closed configuration payload defaults disabled and rejects implicit/partial/tampered input", () => {
  assert.deepEqual(parseWhatsappBootstrapConfig(config), config);
  for (const bad of [null, {}, { ...config, extra: true }, { ...config, autoStartEnabled: "true" },
    { ...config, expectedRevision: -1 }, { ...config, initialTemplateLanguage: null },
    { ...config, autoStartEnabled: true, defaultWhatsappChannelId: null }]) assert.equal(parseWhatsappBootstrapConfig(bad), null);
});
function fixture() {
  let actor: SessionUser | null = { id: "synthetic-admin", companyId: "synthetic-company", name: "Synthetic", email: "synthetic@invalid.test", role: "ADMIN" };
  const calls: unknown[] = [];
  let limited: Response | null = null;
  const configService = { read: async (...input: unknown[]) => { calls.push(input); return { config: { autoStartEnabled: false } }; },
    save: async (...input: unknown[]) => { calls.push(input); return { config: { autoStartEnabled: false } }; } };
  const api = management.createOpenCreditWhatsappManagement({ getSession: async () => actor,
    config: configService as unknown as Parameters<typeof management.createOpenCreditWhatsappManagement>[0]["config"],
    bootstrap: { bootstrap: async target => { calls.push(target); return { status: "ALREADY_STARTED" }; } }, enforceLimits: async () => limited });
  const request = (method: string, body = JSON.stringify(config), headers: Record<string, string> = {}, search = "") =>
    new NextRequest("https://synthetic.invalid/api/integrations/opencredit/synthetic-integration/whatsapp" + search,
      { method, ...(method === "GET" ? {} : { body }), headers: { origin: "https://synthetic.invalid", "content-type": "application/json", ...headers } });
  const context = { params: Promise.resolve({ id: "synthetic-integration" }) };
  return { api, calls, request, context, actor: (a: SessionUser | null) => { actor = a; }, limited: (r: Response) => { limited = r; } };
}
test("read does not bootstrap or save; selected channel scoped through authenticated company", async () => {
  const f = fixture(); const r = await f.api.GET(f.request("GET", "", {}, "?channelId=synthetic-channel"), f.context);
  assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(f.calls, [["synthetic-company", "synthetic-integration", "synthetic-channel"]]);
});
test("session required, company ADMIN required, Authorization override rejected", async () => {
  const f = fixture(); f.actor(null); assert.equal((await f.api.PATCH(f.request("PATCH"), f.context)).status, 401);
  f.actor({ id: "agent", companyId: "synthetic", name: "Synthetic", email: "x@invalid.test", role: "AGENT" });
  assert.equal((await f.api.PATCH(f.request("PATCH"), f.context)).status, 403);
  assert.equal(f.calls.length, 0);
  const g = fixture(); assert.equal((await g.api.PATCH(g.request("PATCH", undefined, { authorization: "Bearer synthetic" }), g.context)).status, 400);
});
test("mutation requires exact same origin and strict bounded JSON; never accepts channel override at bootstrap", async () => {
  const f = fixture();
  for (const headers of [{ origin: "https://foreign.invalid" }, { "sec-fetch-site": "cross-site" }] as Record<string, string>[]) assert.equal((await f.api.PATCH(f.request("PATCH", undefined, headers), f.context)).status, 403);
  for (const body of ["{" + '"jobId":"a","jobId":"b"}', JSON.stringify({ jobId: "a", channelId: "foreign" }), " ".repeat(2049), "[]", "null"])
    assert.equal((await f.api.POST(f.request("POST", body), f.context)).status, 400);
  assert.equal((await f.api.PATCH(f.request("PATCH", undefined, { "content-type": "text/plain" }), f.context)).status, 400);
  assert.equal(f.calls.length, 0);
});
test("bootstrap target comes from authenticated company/path; rate limit preserves Retry-After", async () => {
  const f = fixture(); assert.equal((await f.api.POST(f.request("POST", '{"jobId":"synthetic-job"}'), f.context)).status, 200);
  assert.deepEqual(f.calls, [{ companyId: "synthetic-company", integrationId: "synthetic-integration", jobId: "synthetic-job" }]);
  f.limited(new Response(null, { status: 429, headers: { "retry-after": "31" } }));
  const r = await f.api.PATCH(f.request("PATCH"), f.context); assert.equal(r.status, 429); assert.equal(r.headers.get("retry-after"), "31"); assert.equal(f.calls.length, 1);
});
test("additive schema, no default activation/backfill; UI explicitly saves and never sends", () => {
  const sql = readFileSync("prisma/migrations/20261108210000_opencredit_whatsapp_handoff/migration.sql", "utf8");
  assert.match(sql, /"autoStartEnabled" BOOLEAN NOT NULL DEFAULT false/);
  assert.doesNotMatch(sql, /^\s*(?:DROP|DELETE|UPDATE|INSERT|TRUNCATE)\b/m);
  const ui = readFileSync("src/app/components/integrations/OpenCreditWhatsappSettings.tsx", "utf8");
  assert.match(ui, /WhatsApp padrão para novos leads/); assert.match(ui, /Template inicial/);
  assert.doesNotMatch(ui, /method:\s*["']POST|\/bootstrap|sendMeta/);
  const bootstrap = readFileSync("src/lib/opencredit-whatsapp-bootstrap.service.ts", "utf8");
  assert.doesNotMatch(bootstrap, /sendMetaTextMessage|\bfetch\(|createClient|console\.|safeLog/);
  assert.match(bootstrap, /authorizeDispatch/); assert.match(bootstrap, /status: "UNKNOWN"/);
});
