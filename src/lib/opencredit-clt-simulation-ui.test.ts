import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { runInThisContext } from "node:vm";
import * as ts from "typescript";
import { simulationParameters, reaisToCents, parseSimulationReply, simulationCapabilityKeys } from "./opencredit-clt-simulation";
type View = { type: unknown; props: Record<string, unknown>; key?: string };
type Effect = { deps: unknown[]; cleanup?: () => void };
function panel(pending = false) {
  let cells: unknown[] = [], cursor = 0, key: string | undefined, root: View | null = null;
  let props = { companyId: "synthetic-company", contactId: "synthetic-contact", authorizationActive: true };
  const effects: (() => void)[] = [], requests: { url: string; init: RequestInit }[] = [];
  const hooks = {
    useState(initial: unknown) { const i = cursor++; if (!(i in cells)) cells[i] = initial; return [cells[i], (v: unknown) => { cells[i] = typeof v === "function" ? v(cells[i]) : v; }]; },
    useRef(initial: unknown) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
    useCallback(fn: unknown, deps: unknown[]) { const i = cursor++, old = cells[i] as { fn: unknown; deps: unknown[] } | undefined; if (!old || old.deps.length !== deps.length || !old.deps.every((v, j) => Object.is(v, deps[j]))) cells[i] = { fn, deps }; return (cells[i] as { fn: unknown }).fn; },
    useEffect(fn: () => void | (() => void), deps: unknown[]) {
      const i = cursor++, old = cells[i] as Effect | undefined;
      if (old && old.deps.length === deps.length && old.deps.every((v, j) => Object.is(v, deps[j]))) return;
      const cell: Effect = { deps, cleanup: old?.cleanup }; cells[i] = cell;
      effects.push(() => { cell.cleanup?.(); const clean = fn(); cell.cleanup = typeof clean === "function" ? clean : undefined; });
    },
  };
  const source = readFileSync("src/app/components/integrations/OpenCreditCltSimulationPanel.tsx", "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const testModule = { exports: {} as { OpenCreditCltSimulationPanel(p: typeof props): View } };
  const jsx = (type: unknown, p: Record<string, unknown>, k?: string): View => ({ type, props: p, key: k });
  const execute = runInThisContext('(function(ports){const {exports,require,fetch,AbortController}=ports;\n' + code + '\n})') as (ports: Record<string, unknown>) => void;
  execute({ exports: testModule.exports, AbortController, require(s: string) {
    if (s === "react") return hooks; if (s === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: Symbol("fragment") };
    assert.equal(s, "@/lib/opencredit-clt-simulation"); return { simulationParameters, reaisToCents, parseSimulationReply, simulationCapabilityKeys };
  }, fetch: async (url: string, init: RequestInit) => {
    requests.push({ url, init });

    if (url.endsWith("/banks")) return Response.json({ ok: true, banks: [{ bankId: "synthetic-bank", bankName: "Synthetic", capabilities: { simulacaoAtiva: true, suportaParcela: true, suportaLiquido: true } }] });
    if (url.endsWith("/context")) return Response.json({ ok: true, operation: null });
    const isPending = pending && url.endsWith("/dispatch");
    return Response.json({ ok: true, operation: { operationId: "synthetic-operation", state: isPending ? "IN_FLIGHT" : "SUCCEEDED", displayState: isPending ? "PENDING" : "SUCCEEDED", revision: 2, diagnostic: {
      bankId: "synthetic-bank", requestedMode: "parcela", simulationId: "synthetic-simulation", httpStatus: 200, requestId: null, correlationId: null, responseReadable: true, responseParsed: true,
      dispatchCommittedAt: "2026-10-28T12:00:00.000Z", respondedAt: "2026-10-28T12:00:01.000Z", settlement: "CONFIRMED", stage: "RESPONSE", category: isPending ? "PENDING" : "NONE", providerStatus: isPending ? "pendente" : "aprovado"
    } }, result: null });

  } });
  function unmount() { for (const c of cells) (c as Effect | undefined)?.cleanup?.(); cells = []; key = undefined; root = null; effects.length = 0; }
  function render() { const child = testModule.exports.OpenCreditCltSimulationPanel(props); if (key !== child.key) { unmount(); key = child.key; } cursor = 0; root = (child.type as (p: typeof props) => View)(child.props as typeof props); effects.splice(0).forEach(fn => fn()); }
  function nodes() { const list: View[] = []; const visit = (v: unknown) => { if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v === "object" && "props" in v) { list.push(v as View); visit((v as View).props.children); } }; visit(root); return list; }
  render();

  const button = (text: string) => nodes().find(n => n.type === "button" && typeof n.props.children === "string" && n.props.children.includes(text))!;
  return { requests, unmount, async flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); render(); },
    button,
    select(i: number, value: string) { const n = nodes().filter(n => n.type === "select")[i]; (n.props.onChange as (e: unknown) => void)({ target: { value } }); render(); },
    amount(value: string) { const n = nodes().find(n => n.type === "input" && n.props.inputMode === "decimal")!; (n.props.onChange as (e: unknown) => void)({ target: { value } }); render(); },
    confirm(i: number, checked: boolean) { const n = nodes().filter(n => n.type === "input" && n.props.type === "checkbox")[i]; (n.props.onChange as (e: unknown) => void)({ target: { checked } }); render(); },
    checks: () => nodes().filter(n => n.type === "input" && n.props.type === "checkbox"),
    click(text: string) { const b = button(text); assert(b); if (!b.props.disabled) (b.props.onClick as () => void)(); render(); },
    target(next: Partial<typeof props>) { props = { ...props, ...next }; render(); },
  };
}
test("manual catalog, one explicit bank, exact cents preview and two mandatory confirmations", async () => {
  const h = panel(); await h.flush(); assert.equal(h.requests.length, 0);
  assert.equal(h.button("Executar").props.disabled, true);
  h.click("Carregar"); await h.flush(); assert.equal(h.requests.length, 1); assert(h.requests[0].url.endsWith("/banks"));
  h.select(0, "synthetic-bank"); h.select(1, "parcela"); h.amount("1050,00");
  h.click("Consultar intenção"); await h.flush(); h.confirm(0, true);
  assert.equal(h.button("Executar").props.disabled, true); h.confirm(1, true); assert.equal(h.button("Executar").props.disabled, false);
  h.amount("999,00"); assert(h.checks().every(c => c.props.checked === false)); h.amount("1050,00");
  h.confirm(0, true); h.confirm(1, true); h.click("Executar"); h.click("Executar"); await h.flush();
  const paid = h.requests.filter(r => r.url.endsWith("/dispatch")); assert.equal(paid.length, 1);
  assert.deepEqual(JSON.parse(paid[0].init.body as string), { companyId: "synthetic-company", contactId: "synthetic-contact", bankId: "synthetic-bank", mode: "parcela", amountBRL: "1050,00" });
  assert.equal(h.button("Executar").props.disabled, true); h.unmount();
});
test("pending is followed only by explicit poll, never another dispatch", async () => {
  const h = panel(true); await h.flush(); h.click("Carregar"); await h.flush(); h.select(0, "synthetic-bank");
  h.click("Consultar intenção"); await h.flush(); h.confirm(0, true); h.confirm(1, true); h.click("Executar"); await h.flush();
  assert.equal(h.requests.filter(r => r.url.endsWith("/dispatch")).length, 1); assert.equal(h.requests.filter(r => r.url.endsWith("/poll")).length, 0);
  h.click("Consultar resultado"); h.click("Consultar resultado"); await h.flush();
  assert.equal(h.requests.filter(r => r.url.endsWith("/poll")).length, 1); assert.equal(h.requests.filter(r => r.url.endsWith("/dispatch")).length, 1); h.unmount();
});
test("target/authorization changes reset controls without automatic catalog or dispatch", async () => {
  const h = panel(); await h.flush(); h.click("Carregar"); await h.flush(); h.select(0, "synthetic-bank"); h.confirm(0, true); h.confirm(1, true);
  h.target({ contactId: "other", authorizationActive: false }); await h.flush(); assert(h.checks().every(c => c.props.checked === false));
  assert.equal(h.button("Executar").props.disabled, true); assert.equal(h.requests.length, 1); h.unmount();
});
test("source limits paid consumer, auth evidence and UI; no background requests or provider-controlled links", () => {
  const ui = readFileSync("src/app/components/integrations/OpenCreditCltSimulationPanel.tsx", "utf8");
  assert.doesNotMatch(ui, /window.confirm|setInterval|setTimeout|localStorage|sessionStorage|randomUUID|commandId|tenantId|providerScope|authorizationUrl|dangerouslySetInnerHTML/);
  const tree = ts.createSourceFile("ui.tsx", ui, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(n: ts.Node) {
    if (ts.isCallExpression(n) && n.expression.getText(tree) === "useEffect") assert.doesNotMatch(n.getText(tree), /fetch|request|dispatch|poll/);
    if (ts.isCallExpression(n) && n.expression.getText(tree) === "request") { let p: ts.Node | undefined = n; while (p && !ts.isJsxAttribute(p)) p = p.parent; assert(p && ts.isJsxAttribute(p)); assert.equal(p.name.getText(tree), "onClick"); }
    ts.forEachChild(n, visit);
  } visit(tree);
  const paid: string[] = [], consumers: string[] = [];
  for (const root of ["src", "scripts"]) for (const file of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    const path = root + "/" + file.replace(/\\/g, "/"); if (!/\.[cm]?[jt]sx?$/.test(path) || /\.(?:test|integration)\./.test(path)) continue;
    const source = readFileSync(path, "utf8"); if (/\.simulateJsonAfterCommit\(/.test(source)) paid.push(path);
    if (/from ["'](?:.*\/)opencredit-clt-simulation.service["']/.test(source)) consumers.push(path);
  }
  assert.deepEqual(paid, ["src/lib/opencredit-clt-simulation.service.ts"]);
  assert.deepEqual(consumers, ["src/lib/opencredit-clt-simulation-admin-handler.ts"]);
  const auth = readFileSync("src/app/components/integrations/OpenCreditSimulationAuthorizationPanel.tsx", "utf8"); assert.match(auth, /CREDIT_SIMULATION/); assert.doesNotMatch(auth, /CLIENT_PROFILE_UPSERT|CLIENT_PROFILE_CORRECTION/);
});
