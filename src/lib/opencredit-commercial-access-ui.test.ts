import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";

const path = "src/app/components/integrations/OpenCreditCommercialAccessPanel.tsx";
type Tree = { type: string | ((p: Record<string, unknown>) => Tree | null); props: Record<string, unknown>; key?: string };
type Call = { url: string; init: RequestInit; resolve(r: Response): void; reject(e: Error): void };
/** Tiny deterministic React hook/JSX harness: actual compiled panel, real async callbacks, no live HTTP. */
function harness(companyId = "company", enabled = true) {
  const slots: unknown[] = []; let cursor = 0, dirty = true, mounted = true, lateWrites = 0;
  let tree: Tree | null = null, effect: (() => void | (() => void)) | null = null, cleanup: (() => void) | void;
  let confirmation = true, confirmations = 0;
  const calls: Call[] = [];
  const react = {
    useState(initial: unknown) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (v: unknown) => { if (!mounted) lateWrites++; slots[i] = v; dirty = true; }]; },
    useRef(initial: unknown) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useCallback(fn: unknown, deps: unknown[]) { const i = cursor++, old = slots[i] as { fn: unknown; deps: unknown[] } | undefined;
      if (!old || deps.some((d, n) => d !== old.deps[n])) slots[i] = { fn, deps }; return (slots[i] as { fn: unknown }).fn; },
    useEffect(fn: () => void | (() => void)) { cursor++; if (!effect) effect = fn; },
  };
  const jsx = (type: Tree["type"], props: Tree["props"], key?: string): Tree => ({ type, props, key });
  const exports: { OpenCreditCommercialAccessPanel?: (p: { companyId: string; enabled: boolean }) => Tree | null } = {};
  const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(source, { exports, require: (s: string) => { if (s === "react") return react; if (s === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" }; throw Error("UNAPPROVED_IMPORT"); },
    AbortController, JSON, Object, window: { confirm: () => { confirmations++; return confirmation; } },
    fetch: (url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => calls.push({ url, init, resolve, reject })),
  });
  const outer = exports.OpenCreditCommercialAccessPanel!({ companyId, enabled });
  function render() { if (!outer) { tree = null; return; } cursor = 0; dirty = false; tree = (outer.type as (p: Tree["props"]) => Tree | null)(outer.props); }
  render(); if (effect) cleanup = (effect as () => void | (() => void))();
  function nodes(v: unknown = tree): Tree[] { if (Array.isArray(v)) return v.flatMap(n => nodes(n)); if (!v || typeof v !== "object" || !("props" in v)) return [];
    const n = v as Tree; return [n, ...nodes(n.props.children)]; }
  function text(v: unknown): string { if (Array.isArray(v)) return v.map(text).join(""); if (v && typeof v === "object" && "props" in v) return text((v as Tree).props.children); return typeof v === "string" ? v : ""; }
  return {
    calls, outer, get lateWrites() { return lateWrites; }, get confirmations() { return confirmations; },
    deny() { confirmation = false; }, unmount() { cleanup?.(); mounted = false; },
    async flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); if (dirty) render(); },
    button(label: string) { const b = nodes().find(n => n.type === "button" && text(n).includes(label)); assert(b, label); return b.props.onClick as () => void; },
    get text() { return text(tree); }, get hidden() { return tree === null; },
  };
}
function respond(h: ReturnType<typeof harness>, index: number, body: object, status = 200) { h.calls[index].resolve(new Response(JSON.stringify(body), { status })); }
for (const [exists, enabled, label] of [[false, false, "NÃO CONFIGURADO"], [true, false, "INATIVO"], [true, true, "ATIVO"]] as const) test("actual UI state " + label, async () => {
  const h = harness(); assert.equal(h.calls.length, 1); assert(h.calls[0].url.endsWith("/context"));
  respond(h, 0, { ok: true, exists, enabled }); await h.flush(); assert(h.text.includes(label)); assert.equal(h.confirmations, 0);
});
test("disabled panel never fetches", () => { const h = harness("company", false); assert.equal(h.calls.length, 0); assert.equal(h.outer, null); });
for (const status of [401, 403]) test("context hides for " + status, async () => { const h = harness(); respond(h, 0, { error: "private" }, status); await h.flush(); assert(h.hidden); });
for (const action of ["grant", "revoke"] as const) test("human " + action + " confirms, blocks double click, reloads authoritative context", async () => {
  const h = harness(), active = action === "revoke";
  respond(h, 0, { ok: true, exists: true, enabled: active }); await h.flush();
  const click = h.button(active ? "Revogar" : "Ativar"); click(); click();
  assert.equal(h.confirmations, 1); assert.equal(h.calls.length, 2); assert(h.calls[1].url.endsWith("/" + action));
  assert.equal(h.calls[1].init.body, '{"companyId":"company"}');
  respond(h, 1, { ok: true, changed: true, enabled: !active }); await h.flush();
  assert.equal(h.calls.length, 3); assert(h.calls[2].url.endsWith("/context")); assert(!h.text.includes("INATIVO")); assert(!h.text.includes("NÃO CONFIGURADO"));
  // Contradict the mutation response: final display MUST follow context, not mutation.
  respond(h, 2, { ok: true, exists: true, enabled: active }); await h.flush(); assert(h.text.includes(active ? "ATIVO" : "INATIVO"));
});
test("cancel confirmation prevents mutation", async () => { const h = harness(); respond(h, 0, { ok: true, exists: false, enabled: false }); await h.flush();
  h.deny(); h.button("Ativar")(); assert.equal(h.calls.length, 1); assert.equal(h.confirmations, 1);
});
for (const status of [401, 403]) test("mutation hides for " + status, async () => { const h = harness(); respond(h, 0, { ok: true, exists: false, enabled: false }); await h.flush();
  h.button("Ativar")(); respond(h, 1, {}, status); await h.flush(); assert(h.hidden); assert.equal(h.calls.length, 2);
});
test("ambiguous mutation is not retried; old state cannot authorize another click", async () => {
  const h = harness(); respond(h, 0, { ok: true, exists: false, enabled: false }); await h.flush(); const click = h.button("Ativar"); click();
  h.calls[1].reject(Error("private")); await h.flush(); assert(!h.text.includes("private")); assert(!h.text.includes("Ativar acesso")); click(); assert.equal(h.calls.length, 2);
});
test("target remount aborts old response before it can update state", async () => {
  const old = harness("old"), fresh = harness("fresh"); assert.notEqual(old.outer?.key, fresh.outer?.key);
  old.unmount(); assert(old.calls[0].init.signal?.aborted);
  respond(fresh, 0, { ok: true, exists: true, enabled: false }); await fresh.flush();
  respond(old, 0, { ok: true, exists: true, enabled: true }); await old.flush();
  assert.equal(old.lateWrites, 0); assert(fresh.text.includes("INATIVO")); assert.equal(fresh.calls[0].init.body, '{"companyId":"fresh"}');
});
test("sequence ignores late context JSON and late mutation after unmount", async () => {
  const h = harness(); let release!: (v: object) => void;
  h.calls[0].resolve({ ok: true, status: 200, json: () => new Promise(resolve => { release = resolve; }) } as Response); await h.flush();
  h.unmount(); release({ ok: true, exists: true, enabled: true }); await h.flush(); assert.equal(h.lateWrites, 0);
  const m = harness(); respond(m, 0, { ok: true, exists: false, enabled: false }); await m.flush(); m.button("Ativar")(); m.unmount();
  respond(m, 1, { ok: true }); await m.flush(); assert.equal(m.calls.length, 2); assert.equal(m.lateWrites, 0);
});
for (const body of [{ ok: true, exists: false, enabled: true }, { ok: true, exists: true, enabled: "true" }, { ok: true, exists: true, enabled: true, raw: "private" }]) test("invalid public context fails closed " + JSON.stringify(body), async () => {
  const h = harness(); respond(h, 0, body); await h.flush(); assert(!h.text.includes("private")); assert(!h.text.includes("Ativar acesso")); assert(!h.text.includes("Revogar acesso"));
});
test("static UI authority and only approved local endpoints", () => {
  const source = readFileSync(path, "utf8"), page = readFileSync("src/app/page.tsx", "utf8");
  assert.doesNotMatch(source, /Prisma|process\.env|providerScope|tenantId|partnerId|accessId|actor|token|password|remote-identity|consumer-authorization|create-client|opencredit-api-client|https?:\/\/|setInterval|setTimeout|console\.|dangerouslySetInnerHTML/);
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.deepEqual(ast.statements.filter(ts.isImportDeclaration).map(n => (n.moduleSpecifier as ts.StringLiteral).text), ["react"]);
  const calls: ts.CallExpression[] = []; function walk(n: ts.Node) { if (ts.isCallExpression(n)) calls.push(n); ts.forEachChild(n, walk); } walk(ast);
  for (const e of calls.filter(c => c.expression.getText(ast) === "useEffect")) assert.doesNotMatch(e.getText(ast), /mutate|grant|revoke/);
  assert.equal(calls.filter(c => c.expression.getText(ast) === "fetch").length, 2);
  assert.equal(calls.filter(c => c.expression.getText(ast) === "mutate").length, 1);
  const mutation = calls.find(c => c.expression.getText(ast) === "mutate")!; let p: ts.Node | undefined = mutation;
  while (p && !ts.isJsxAttribute(p)) p = p.parent; assert(p); assert.equal(p.name.getText(ast), "onClick");
  assert.match(source, /window.confirm/); assert.match(source, /key=\{props.companyId\}/); assert.match(source, /if \(response.ok\) \{ await load\(\)/);
  assert.match(page, /active === "empresas" && userIsPlatformAdmin\(session\)/);
  assert.equal((page.match(/<OpenCreditCommercialAccessPanel/g) ?? []).length, 1);
  assert.match(page, /<OpenCreditCommercialAccessPanel enabled=\{true\} companyId=\{company.id\}/);
  for (const dir of ["src", "scripts"]) for (const file of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    const p = dir + "/" + file.replace(/\\/g, "/");
    if (!/\.[cm]?[jt]sx?$/.test(p) || /\.(test|integration)\./.test(p) || p === path) continue;
    assert.doesNotMatch(readFileSync(p, "utf8"), /\/api\/admin\/integrations\/opencredit\/commercial-access(?:["'/]|$)/, p);
  }
});
