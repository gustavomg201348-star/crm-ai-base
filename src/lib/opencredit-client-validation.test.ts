import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import Module from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { runInThisContext } from "node:vm";
import * as ts from "typescript";
import { NextRequest } from "next/server";
import { requirePlatformAdmin } from "./permissions";
import type { SessionUser } from "./auth";
import { parseProviderClientValidation, parseClientValidationResponse, validationPendingLabels, type ClientValidationResponse } from "./opencredit-client-validation";
let service: typeof import("./opencredit-client-validation.service"), handler: typeof import("./opencredit-client-validation-admin-handler"), api: typeof import("./opencredit-api-client");
const previousAllowlist = process.env.PLATFORM_ADMIN_EMAILS;
const actor: SessionUser = { id: "admin", companyId: "platform", name: "Synthetic", email: "synthetic@example.invalid", role: "ADMIN" };
before(async () => {
  process.env.PLATFORM_ADMIN_EMAILS = actor.email;
  const loader = Module as typeof Module & { _load(s: string, ...args: unknown[]): unknown }, original = loader._load;
  loader._load = (s, ...args) => s === "server-only" ? {} : original.call(loader, s, ...args);
  try { service = await import("./opencredit-client-validation.service"); handler = await import("./opencredit-client-validation-admin-handler"); api = await import("./opencredit-api-client"); }
  finally { loader._load = original; }
});
after(() => { if (previousAllowlist === undefined) delete process.env.PLATFORM_ADMIN_EMAILS; else process.env.PLATFORM_ADMIN_EMAILS = previousAllowlist; });
const provider = () => ({ data: { found: true, valid: false, pending: [{ field: "nome_mae", label: "PRIVATE", regex: "PRIVATE", resolveWith: { path: "https://private.invalid" }, scope: "client" }] }, requestId: "req_abcdefabcdef" });
const success = (): ClientValidationResponse => ({ ok: true, validation: { found: true, valid: false, pending: [{ field: "nome_mae", scope: "client" }] },
  diagnostic: { httpStatus: 200, requestId: null, correlationId: null, responseReadable: true, responseParsed: true, found: true, valid: false, pendingPresent: true, category: "PENDING" } });
test("conservative parser preserves false/absence and discards all arbitrary provider text and actions", () => {
  assert.deepEqual(parseProviderClientValidation(provider()), success().ok ? (success() as Extract<ClientValidationResponse, { ok: true }>).validation : null);
  for (const value of [{ found: false }, { valid: false }, { pending: [] }, { found: true, valid: true }]) assert.deepEqual(parseProviderClientValidation({ data: value }), value);
  assert.deepEqual(parseProviderClientValidation({ data: { found: true, valid: false, pending: [{ field: "unknown_private", label: "PRIVATE", value: "PRIVATE" }], raw: "PRIVATE" }, raw: "PRIVATE" }),
    { found: true, valid: false, pending: [{ field: "OTHER" }] });
});
for (const key of ["found", "valid"]) for (const value of [null, 0, 1, "true", [], {}]) test("parser rejects present non-boolean " + key + JSON.stringify(value), () => {
  assert.throws(() => parseProviderClientValidation({ data: { [key]: value } }));
});
for (const pending of [null, {}, "private", 1, [null], [{}], [{ field: 1 }], [{ field: "a".repeat(65) }], [{ field: "https://private.invalid" }], [{ field: "cpf", scope: null }], [{ field: "cpf", scope: "OTHER" }], Array(51).fill({ field: "cpf" })]) test("parser rejects unsafe pending " + JSON.stringify(pending).slice(0, 70), () => {
  assert.throws(() => parseProviderClientValidation({ data: { pending } }));
});
for (const raw of [null, [], {}, { data: {} }, { data: [] }, { data: { found: false, valid: true } }, { data: { valid: true, pending: [{ field: "cpf" }] } }]) test("parser fails closed on malformed or contradictory response " + JSON.stringify(raw), () => assert.throws(() => parseProviderClientValidation(raw)));
test("parser never invokes accessors", () => {
  let reads = 0; const data = Object.defineProperty({}, "found", { enumerable: true, get() { reads++; throw Error(); } });
  assert.throws(() => parseProviderClientValidation({ data })); assert.equal(reads, 0);
});
test("closed browser DTO rejects extra fields, raw labels, unknown diagnostics and inconsistent flags", () => {
  assert(parseClientValidationResponse(success()));
  for (const value of [{ ...success(), private: true }, { ...success(), diagnostic: { ...success().diagnostic, raw: "PRIVATE" } },
    { ...success(), diagnostic: { ...success().diagnostic, requestId: "12345678909" } }, { ...success(), diagnostic: { ...success().diagnostic, category: "PRIVATE" } },
    { ...success(), diagnostic: { ...success().diagnostic, valid: true } }, { ...success(), diagnostic: { ...success().diagnostic, category: "VALID" } },
    { ...success(), validation: { found: true, valid: false, pending: [{ field: "nome_mae", label: "PRIVATE" }] } }]) assert.equal(parseClientValidationResponse(value), null);
});

type ServiceDb = Parameters<typeof service.readOpenCreditClientValidation>[0];
function fixture() {
  const state: Record<string, unknown> = {
    user: { ...actor }, company: { id: "company" }, contact: { id: "contact", companyId: "company", cpf: "12345678909", archivedAt: null }, matches: [{ id: "contact" }],
    access: { enabled: true }, identity: { id: "identity", companyId: "company", contactId: "contact", providerScope: "synthetic-scope", normalizedCpf: "12345678909", enabled: true }, owner: { id: "identity" },
    auth: { id: "auth", companyId: "company", contactId: "contact", providerScope: "synthetic-scope", purpose: "CLIENT_PROFILE_UPSERT", remoteIdentityId: "identity", active: true, revision: 0, evidenceInboundEventId: "evidence" },
    grant: { authorizationId: "auth", companyId: "company", providerScope: "synthetic-scope", revision: 0, action: "GRANTED", nextActive: true, evidenceInboundEventId: "evidence" },
    evidence: { id: "evidence", companyId: "company", contactId: "contact", provenanceKind: "META_WEBHOOK_HMAC_SHA256_VERIFIED", provenanceVersion: 1 },
  };
  const reads: { name: string; args: unknown }[] = [], gets: string[] = []; let transactions = 0;
  const delegate = (name: string) => new Proxy({}, { get(_t, method) {
    assert(["findUnique", "findMany"].includes(String(method)), "writes prohibited");
    return async (args: { where: Record<string, unknown> }) => { reads.push({ name, args });
      return name === "contact" && method === "findMany" ? state.matches : name === "identity" && "providerScope_normalizedCpf" in args.where ? state.owner : state[name]; };
  } });
  const tx = { user: delegate("user"), company: delegate("company"), contact: delegate("contact"), openCreditCommercialAccess: delegate("access"), openCreditRemoteIdentity: delegate("identity"),
    openCreditConsumerAuthorization: delegate("auth"), openCreditConsumerAuthorizationEvent: delegate("grant"), conversationInboundEvent: delegate("evidence") };
  const guarded = new Proxy(tx, { get(t, k) { assert(Object.hasOwn(t, k), "no CommercialOperation or unexpected delegate"); return Reflect.get(t, k); } });
  const db = { $transaction: async (run: (tx: unknown) => Promise<unknown>) => { transactions++; return run(guarded); } } as unknown as ServiceDb;
  let response = () => Response.json(provider()), onGet = () => {};
  const options: Parameters<typeof service.readOpenCreditClientValidation>[2] = {
    resolve: () => ({ tenantId: "synthetic-tenant", providerScope: "synthetic-scope" as ReturnType<typeof import("./opencredit-provider-scope-resolver").resolveConfiguredOpenCreditProviderScope> }),
    client: { async getOnce(path: string) { gets.push(path); onGet(); return { response: response(), sanitizeDiagnosticIdentifier: value => typeof value === "string" ? value : null }; } },
  };
  return { state, reads, gets, options, transactions: () => transactions, response(fn: () => Response) { response = fn; }, onGet(fn: () => void) { onGet = fn; },
    run: () => service.readOpenCreditClientValidation(db, { actor, companyId: "company", contactId: "contact" }, options) };
}
test("service binds tenant/scope/CPF on server and performs exactly one GET outside read transactions", async () => {
  const f = fixture(); const r = await f.run(); assert(r.ok); assert(parseClientValidationResponse(r));
  assert.deepEqual(f.gets, ["/api/tenants/synthetic-tenant/integration/clients/validate?cpf=12345678909&stage=simulate&product=clt"]);
  assert.equal(f.transactions(), 2); assert.equal(r.diagnostic.category, "PENDING"); assert.equal(r.diagnostic.requestId, "req_abcdefabcdef");
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE|12345678909|synthetic-scope|synthetic-tenant|https:/);
  for (const read of f.reads.filter(r => ["contact", "identity", "access", "auth"].includes(r.name))) {
    const text = JSON.stringify(read.args); assert(text.includes("company") || read.name === "identity" && text.includes("providerScope_normalizedCpf"));
  }
});
for (const [name, patch] of [
  ["user", { role: "AGENT" }], ["user", { companyId: "other" }], ["user", { email: "other@example.invalid" }], ["company", null],
  ["contact", { companyId: "other" }], ["contact", { id: "other" }], ["contact", { archivedAt: new Date() }], ["contact", { cpf: null }], ["contact", { cpf: "bad" }],
  ["matches", []], ["matches", [{ id: "contact" }, { id: "archived" }]], ["access", null], ["access", { enabled: false }],
  ["identity", null], ["identity", { enabled: false }], ["identity", { companyId: "other" }], ["identity", { providerScope: "other" }], ["identity", { normalizedCpf: "00000000000" }],
  ["owner", { id: "other" }], ["auth", null], ["auth", { active: false }], ["auth", { purpose: "OTHER" }], ["auth", { companyId: "other" }], ["auth", { remoteIdentityId: "other" }],
  ["grant", null], ["grant", { revision: 2 }], ["grant", { action: "REVOKED" }], ["grant", { evidenceInboundEventId: "other" }], ["evidence", { provenanceVersion: 2 }], ["evidence", { contactId: "other" }],
] as const) test("read gates fail before GET: " + name + JSON.stringify(patch), async () => {
  const f = fixture(); f.state[name] = patch === null || Array.isArray(patch) ? patch : { ...(f.state[name] as object), ...patch };
  await assert.rejects(f.run(), e => !!service.readClientValidationGateError(e)); assert.equal(f.gets.length, 0);
});
test("scope configuration failure never reaches DB or provider", async () => {
  const f = fixture(); f.options!.resolve = () => { throw Error("PRIVATE"); }; const r = await f.run(); assert(!r.ok); assert.equal(r.diagnostic.category, "CONFIGURATION"); assert.equal(f.transactions(), 0); assert.equal(f.gets.length, 0);
});
for (const tenantId of [undefined, null, 3, "", "bad/path", "bad\n", "x".repeat(129)]) test("invalid trusted tenant fails before any read " + JSON.stringify(tenantId), async () => {
  const f = fixture(); f.options!.resolve = () => ({ tenantId, providerScope: "synthetic-scope" }) as ReturnType<typeof import("./opencredit-provider-scope-resolver").resolveConfiguredOpenCreditProviderContext>;
  const r = await f.run(); assert(!r.ok); assert.equal(r.diagnostic.category, "CONFIGURATION"); assert.equal(f.transactions(), 0); assert.equal(f.gets.length, 0);
});
test("revocation while GET is in flight discards returned validation without another GET", async () => {
  const f = fixture(); f.onGet(() => { f.state.auth = { ...(f.state.auth as object), active: false }; }); await assert.rejects(f.run()); assert.equal(f.gets.length, 1);
});
test("configuration scope change during GET fails closed without another provider read", async () => {
  const f = fixture(); f.onGet(() => { f.options!.resolve = () => ({ tenantId: "other", providerScope: "other" as ReturnType<typeof import("./opencredit-provider-scope-resolver").resolveConfiguredOpenCreditProviderScope> }); });
  await assert.rejects(f.run()); assert.equal(f.gets.length, 1);
});
for (const [status, category] of [[400, "PROVIDER_FAILED"], [401, "AUTHENTICATION"], [403, "AUTHENTICATION"], [429, "PROVIDER_UNAVAILABLE"], [500, "PROVIDER_UNAVAILABLE"]] as const) test("non-200 read never retries or exposes body " + status, async () => {
  const f = fixture(); f.response(() => new Response("PRIVATE", { status })); const r = await f.run(); assert(!r.ok); assert.equal(r.diagnostic.httpStatus, status);
  assert.equal(r.diagnostic.category, category); assert.equal(r.diagnostic.responseParsed, false); assert.equal(f.gets.length, 1); assert(!JSON.stringify(r).includes("PRIVATE"));
});
for (const code of ["TIMEOUT", "NETWORK", "AUTH_FAILED", "CONFIGURATION"] as const) test("transport failure is closed without retry " + code, async () => {
  const f = fixture(); f.options!.client = { async getOnce(path) { f.gets.push(path); throw new api.OpenCreditApiError(code); } }; const r = await f.run(); assert(!r.ok); assert.equal(f.gets.length, 1); assert.equal(r.diagnostic.httpStatus, null); assert.equal(r.diagnostic.pendingPresent, null);
});
for (const raw of ['{"data":', '{"data":{"valid":true,"valid":false}}', '{"data":{"valid":null}}', "x".repeat(65537)]) test("bounded strict body fails closed " + raw.slice(0, 40), async () => {
  const f = fixture(); f.response(() => new Response(raw, { headers: { "Content-Type": "application/json" } })); const r = await f.run(); assert(!r.ok); assert.equal(r.diagnostic.category, "INVALID_RESPONSE"); assert.equal(f.gets.length, 1);
});
for (const data of [{ found: false, valid: false }, { found: true, valid: true, pending: [] }, { valid: true }]) test("safe categories never convert missing fields into false " + JSON.stringify(data), async () => {
  const f = fixture(); f.response(() => Response.json({ data })); const r = await f.run(); assert(r.ok); assert.equal(r.diagnostic.category, data.found === false ? "NOT_FOUND" : "pending" in data ? "VALID" : "INCOMPLETE");
});

const body = { companyId: "company", contactId: "contact" };
function request(raw = JSON.stringify(body), headers: Record<string, string> = {}, query = "") {
  return new NextRequest("https://crm.example.invalid/api/admin/integrations/opencredit/client-validation/context" + query, {
    method: "POST", headers: { origin: "https://crm.example.invalid", "content-type": "application/json", ...headers }, body: raw,
  });
}
function admin(options: { actor?: SessionUser | null; limited?: number; failure?: boolean; result?: ClientValidationResponse } = {}) {
  let calls = 0, limits = 0;
  const run = handler.createOpenCreditClientValidationHandler({ getSession: async () => options.actor === undefined ? actor : options.actor,
    requirePlatformAdmin, db: {} as ServiceDb, enforceLimits: async rules => { limits++; assert.equal(rules.length, 2); assert(rules.every(r => !JSON.stringify(r).includes("12345678909"))); return options.limited ? new Response(null, { status: options.limited }) : null; },
    read: async (_db, input) => { calls++; assert.deepEqual(input, { actor, ...body }); if (options.failure) throw Error("PRIVATE"); return options.result ?? success(); },
  });
  return { run, calls: () => calls, limits: () => limits };
}
for (const [a, status] of [[null, 401], [{ ...actor, role: "AGENT" }, 403], [{ ...actor, email: "other@example.invalid" }, 403]] as const) test("admin session guard " + status, async () => {
  const f = admin({ actor: a as SessionUser | null }), r = await f.run(request()); assert.equal(r.status, status); assert.equal(f.calls(), 0); assert.equal(f.limits(), 0); assert.equal(r.headers.get("cache-control"), "no-store");
});
for (const h of [{ origin: "https://other.invalid" }, { "sec-fetch-site": "cross-site" }, { authorization: "Bearer PRIVATE" }, { "content-type": "text/plain" }] as Record<string, string>[]) test("admin request protections " + JSON.stringify(h), async () => {
  const f = admin(); const r = await f.run(request(undefined, h)); assert.equal(r.status, h.origin || h["sec-fetch-site"] ? 403 : 400); assert.equal(f.calls(), 0);
});
for (const value of ["{}", "null", '"private"', '{"companyId":"company","contactId":"contact","contactId":"other"}', "x".repeat(2049),
  ...["cpf", "tenantId", "providerScope", "url", "path", "method", "headers", "regex", "resolveWith", "stage", "product", "bankId"].map(k => JSON.stringify({ ...body, [k]: "PRIVATE" }))]) test("browser cannot supply provider inputs " + value.slice(0, 100), async () => {
  const f = admin(); const r = await f.run(request(value)); assert.equal(r.status, 400); assert.equal(f.calls(), 0); assert.equal(f.limits(), 0);
});
test("admin rejects query, enforces rate limit, returns no-store and sanitizes unexpected exceptions", async () => {
  const f = admin(); assert.equal((await f.run(request(undefined, {}, "?cpf=private"))).status, 400);
  const limited = admin({ limited: 429 }); assert.equal((await limited.run(request())).status, 429); assert.equal(limited.calls(), 0);
  const failed = await admin({ failure: true }).run(request()); assert.equal(failed.status, 503); assert(!JSON.stringify(await failed.json()).includes("PRIVATE"));
  const r = await f.run(request()); assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "no-store"); assert.deepEqual(await r.json(), success());
});
test("admin body deadline rejects a stalled stream before any domain read", async () => {
  const f = admin(); let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('{"companyId":')); }, cancel() { cancelled = true; } });
  const req = new NextRequest("https://crm.example.invalid/api/admin/integrations/opencredit/client-validation/context", {
    method: "POST", headers: { origin: "https://crm.example.invalid", "content-type": "application/json" }, body: stream, ...{ duplex: "half" },
  });
  assert.equal((await f.run(req)).status, 400); assert.equal(f.calls(), 0); assert.equal(cancelled, true);
});
for (const [category, status] of [["AUTHENTICATION", 502], ["PROVIDER_FAILED", 502], ["INVALID_RESPONSE", 502], ["NETWORK", 503], ["TIMEOUT", 503], ["CONFIGURATION", 503], ["PROVIDER_UNAVAILABLE", 503]] as const) test("admin maps sanitized provider failure " + category, async () => {
  const result: ClientValidationResponse = { ok: false, error: "OPENCREDIT_CLIENT_VALIDATION_FAILED", diagnostic: { ...success().diagnostic, category, found: null, valid: null, pendingPresent: false } };
  const r = await admin({ result }).run(request()); assert.equal(r.status, status); assert.equal(r.headers.get("cache-control"), "no-store");
});

type View = { type: unknown; props: Record<string, unknown>; key?: string };
function panel(pending = false, raw: unknown = success()) {
  let cells: unknown[] = [], cursor = 0, key: string | undefined, root: View | null = null;
  let props = { enabled: true, authorizationActive: true, companyId: "company", contactId: "contact" };
  const effects: (() => void)[] = [], requests: RequestInit[] = []; let complete: (() => void) | undefined;
  type Effect = { deps: unknown[]; cleanup?: () => void };
  const hooks = {
    useState(initial: unknown) { const i = cursor++; if (!(i in cells)) cells[i] = initial; return [cells[i], (v: unknown) => { cells[i] = v; }]; },
    useRef(initial: unknown) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
    useCallback(fn: unknown, deps: unknown[]) {
      const i = cursor++, old = cells[i] as { fn: unknown; deps: unknown[] } | undefined;
      if (!old || old.deps.length !== deps.length || !old.deps.every((v, j) => Object.is(v, deps[j]))) cells[i] = { fn, deps };
      return (cells[i] as { fn: unknown }).fn;
    },
    useEffect(fn: () => void | (() => void), deps: unknown[]) {
      const i = cursor++, old = cells[i] as Effect | undefined;
      if (old && old.deps.length === deps.length && old.deps.every((v, j) => Object.is(v, deps[j]))) return;
      const cell: Effect = { deps, cleanup: old?.cleanup }; cells[i] = cell;
      effects.push(() => { cell.cleanup?.(); const cleanup = fn(); cell.cleanup = typeof cleanup === "function" ? cleanup : undefined; });
    },
  };
  const source = readFileSync("src/app/components/integrations/OpenCreditClientValidationPanel.tsx", "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const testModule = { exports: {} as { OpenCreditClientValidationPanel: (p: typeof props) => View | null } };
  const jsx = (type: unknown, p: Record<string, unknown>, k?: string): View => ({ type, props: p, key: k });
  const execute = runInThisContext('(function(ports){const {exports,require,fetch,AbortController}=ports;\n' + code + '\n})') as (ports: Record<string, unknown>) => void;
  execute({ exports: testModule.exports, AbortController, require(specifier: string) {
    if (specifier === "react") return hooks;
    if (specifier === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: Symbol("fragment") };
    assert.equal(specifier, "@/lib/opencredit-client-validation"); return { parseClientValidationResponse, validationPendingLabels };
  }, fetch: async (url: string, init: RequestInit) => {
    assert.equal(url, "/api/admin/integrations/opencredit/client-validation/context"); requests.push(init);
    if (pending) await new Promise<void>(resolve => { complete = resolve; });
    return Response.json(raw);
  } });
  function unmount() { for (const c of cells) (c as Effect | undefined)?.cleanup?.(); cells = []; key = undefined; root = null; effects.length = 0; }
  function render() {
    const child = testModule.exports.OpenCreditClientValidationPanel(props); if (!child) { unmount(); return; }
    if (key !== child.key) { unmount(); key = child.key; }
    cursor = 0; root = (child.type as (p: typeof props) => View)(child.props as typeof props); effects.splice(0).forEach(fn => fn());
  }
  const text = (v: unknown): string => Array.isArray(v) ? v.map(text).join("") : v && typeof v === "object" && "props" in v ? text((v as View).props.children) : typeof v === "string" ? v : "";
  const nodes = (): View[] => { const list: View[] = []; const visit = (v: unknown) => { if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v === "object" && "props" in v) { list.push(v as View); visit((v as View).props.children); } }; visit(root); return list; };
  render();
  return { requests, unmount, text: () => text(root), buttons: () => nodes().filter(n => n.type === "button"),
    async flush() { for (let i = 0; i < 16; i++) await Promise.resolve(); render(); },
    click() { const b = nodes().find(n => n.type === "button"); assert(b); (b.props.onClick as () => void)(); render(); },
    change(next: Partial<typeof props>) { props = { ...props, ...next }; render(); }, complete() { assert(complete); complete(); },
  };
}
test("actual validation UI is manual-only, sanitizes pending and has no simulation action", async () => {
  const h = panel(); await h.flush(); assert.equal(h.requests.length, 0); assert(h.text().includes("NÃO executa simulação"));
  assert.equal(h.buttons().length, 1); assert.equal(h.buttons()[0].props.disabled, false);
  h.click(); await h.flush(); assert.equal(h.requests.length, 1); assert.deepEqual(JSON.parse(h.requests[0].body as string), body);
  assert(h.text().includes("valid: false")); assert(h.text().includes("Nome da mãe")); assert.doesNotMatch(h.text(), /PRIVATE|12345678909|resolveWith|token/); h.unmount();
});
test("actual validation UI reports missing flags without inventing false", async () => {
  const raw: ClientValidationResponse = { ok: true, validation: { pending: [] }, diagnostic: { ...success().diagnostic, found: null, valid: null, category: "INCOMPLETE" } };
  const h = panel(false, raw); await h.flush(); h.click(); await h.flush(); assert(h.text().includes("valid: não informado")); h.unmount();
});
test("actual validation UI rejects provider text in a forged admin DTO", async () => {
  const h = panel(false, { ...success(), validation: { found: true, valid: false, pending: [{ field: "nome_mae", label: "PRIVATE" }] } });
  await h.flush(); h.click(); await h.flush(); assert(h.text().includes("Não foi possível")); assert(!h.text().includes("PRIVATE")); h.unmount();
});
test("actual validation UI duplicates, authority changes and target epochs remain fail-closed", async () => {
  const h = panel(true); await h.flush(); h.change({ authorizationActive: false }); await h.flush(); h.click(); assert.equal(h.requests.length, 0);
  h.change({ authorizationActive: true }); await h.flush(); h.click(); h.click(); assert.equal(h.requests.length, 1);
  h.change({ contactId: "other" }); await h.flush(); h.complete(); await h.flush(); assert(!h.text().includes("valid: false")); assert.equal(h.requests.length, 1); h.unmount();
});
test("source safety: exact compositions, read-only delegates, no paid path, browser cannot control provider", () => {
  const source = readFileSync("src/lib/opencredit-client-validation.service.ts", "utf8");
  assert.match(source, /^import "server-only"/); assert.equal((source.match(/\.getOnce\(/g) ?? []).length, 1);
  assert.doesNotMatch(source, /\.request\(|\.postJsonAfterCommit\(|fetch\(|\.create\(|\.update\(|\.delete\(|\.upsert\(|console\.|openCreditCommercialOperation|\.body\s*=/);
  assert.match(source, /stage: "simulate", product: "clt"/); assert.match(source, /integration\/clients\/validate/);
  const file = "src/app/components/integrations/OpenCreditClientValidationPanel.tsx", ui = readFileSync(file, "utf8");
  assert.doesNotMatch(ui, /providerScope|tenantId|\bcpf\b|sessionStorage|randomUUID|console\.|window\.confirm|setInterval|setTimeout|dangerouslySetInnerHTML/);
  assert.match(ui, /JSON.stringify\(\{ companyId, contactId \}\)/);
  const tree = ts.createSourceFile(file, ui, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(n: ts.Node) {
    if (ts.isCallExpression(n) && n.expression.getText(tree) === "useEffect") assert.doesNotMatch(n.getText(tree), /fetch|read\(/);
    if (ts.isCallExpression(n) && n.expression.getText(tree) === "read") { let p: ts.Node | undefined = n; while (p && !ts.isJsxAttribute(p)) p = p.parent; assert(p && ts.isJsxAttribute(p)); assert.equal(p.name.getText(tree), "onClick"); }
    ts.forEachChild(n, visit);
  } visit(tree);
  const consumers: string[] = [];
  for (const root of ["src", "scripts"]) for (const entry of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    const path = root + "/" + entry.replace(/\\/g, "/"); if (!/\.[cm]?[jt]sx?$/.test(path) || /\.(test|integration)\./.test(path)) continue;
    const text = readFileSync(path, "utf8");
    if (/from ["'](?:@\/lib\/|\.\/|.*\/)opencredit-client-validation.service["']/.test(text)) consumers.push(path);
  }
  assert.deepEqual(consumers.sort(), ["src/lib/opencredit-client-validation-admin-handler.ts"]);
  const route = readFileSync("src/app/api/admin/integrations/opencredit/client-validation/context/route.ts", "utf8");
  assert.match(route, /getSessionFromRequest/); assert.match(route, /requirePlatformAdmin/); assert.match(route, /enforceRateLimits/); assert.match(route, /export const POST/);
});
