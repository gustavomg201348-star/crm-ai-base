import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { runInThisContext } from "node:vm";
import * as ts from "typescript";
import { correctionFields } from "./opencredit-client-correction";
type View = { type: unknown; props: Record<string, unknown>; key?: string };
type Effect = { deps: unknown[]; cleanup?: () => void };
function panel() {
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
  const source = readFileSync("src/app/components/integrations/OpenCreditClientCorrectionPanel.tsx", "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const testModule = { exports: {} as { OpenCreditClientCorrectionPanel(p: typeof props): View } };
  const jsx = (type: unknown, p: Record<string, unknown>, k?: string): View => ({ type, props: p, key: k });
  const execute = runInThisContext('(function(ports){const {exports,require,fetch,AbortController}=ports;\n' + code + '\n})') as (ports: Record<string, unknown>) => void;
  execute({ exports: testModule.exports, AbortController, require(s: string) {
    if (s === "react") return hooks; if (s === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: Symbol("fragment") };
    assert.equal(s, "@/lib/opencredit-client-correction"); return { correctionFields };
  }, fetch: async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return url.endsWith("/context") ? Response.json({ ok: true, phonePreview: "(**) *****-1234", operation: null })
      : Response.json({ ok: true, operationId: "synthetic-operation", state: "SUCCEEDED", revision: 2 });
  } });
  function unmount() { for (const c of cells) (c as Effect | undefined)?.cleanup?.(); cells = []; key = undefined; root = null; effects.length = 0; }
  function render() { const child = testModule.exports.OpenCreditClientCorrectionPanel(props); if (key !== child.key) { unmount(); key = child.key; } cursor = 0; root = (child.type as (p: typeof props) => View)(child.props as typeof props); effects.splice(0).forEach(fn => fn()); }
  function nodes() { const list: View[] = []; const visit = (v: unknown) => { if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v === "object" && "props" in v) { list.push(v as View); visit((v as View).props.children); } }; visit(root); return list; }
  render();
  return { requests, unmount, async flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); render(); },
    change(i: number, value: string | boolean) { const n = nodes().filter(n => n.type === "input")[i]; assert(n); (n.props.onChange as (e: unknown) => void)({ target: { value, checked: value } }); render(); },
    inputs: () => nodes().filter(n => n.type === "input"), button: () => nodes().find(n => n.type === "button")!,
    click() { (nodes().find(n => n.type === "button")!.props.onClick as () => void)(); render(); },
    changeTarget(next: Partial<typeof props>) { props = { ...props, ...next }; render(); },
  };
}
test("actual correction UI requires all fields and two confirmations; payload only five browser fields", async () => {
  const h = panel(); await h.flush(); assert.equal(h.requests.length, 1); assert(h.requests[0].url.endsWith("/context"));
  assert.equal(h.button().props.disabled, true); h.click(); assert.equal(h.requests.length, 1);
  h.change(0, "29/02/2000"); h.change(1, "Synthetic Mother"); h.change(2, "synthetic@example.invalid");
  h.change(3, true); assert.equal(h.button().props.disabled, true); h.change(4, true); assert.equal(h.button().props.disabled, false);
  h.change(1, "Other Synthetic Mother"); assert.equal(h.inputs()[3].props.checked, false); assert.equal(h.inputs()[4].props.checked, false);
  h.change(3, true); h.change(4, true); h.click(); h.click(); await h.flush();
  const dispatches = h.requests.filter(r => r.url.endsWith("/dispatch")); assert.equal(dispatches.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(dispatches[0].init.body as string)).sort(), ["companyId", "contactId", "dataNascimento", "nomeMae", "email"].sort());
  assert.equal(h.button().props.disabled, true); h.unmount();
});
test("target and authorization changes reset confirmations and hide stale eligibility", async () => {
  const h = panel(); await h.flush(); h.change(0, "29/02/2000"); h.change(1, "Synthetic Mother"); h.change(2, "synthetic@example.invalid"); h.change(3, true); h.change(4, true);
  h.changeTarget({ contactId: "other", authorizationActive: false }); await h.flush();
  assert.equal(h.inputs()[3].props.checked, false); assert.equal(h.inputs()[4].props.checked, false); assert.equal(h.button().props.disabled, true); h.click(); assert.equal(h.requests.filter(r => r.url.endsWith("/dispatch")).length, 0); h.unmount();
});
test("correction consumers are exact; no background dispatch, automatic validate, browser intention or PII persistence", () => {
  const ui = readFileSync("src/app/components/integrations/OpenCreditClientCorrectionPanel.tsx", "utf8");
  assert.doesNotMatch(ui, /window\.confirm|localStorage|sessionStorage|commandId|randomUUID|providerScope|tenantId|\bcpf\b|console\.|setTimeout|setInterval/);
  const ast = ts.createSourceFile("ui.tsx", ui, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(n: ts.Node) {
    if (ts.isCallExpression(n) && n.expression.getText(ast) === "dispatch") { let p: ts.Node | undefined = n; while (p && !ts.isJsxAttribute(p)) p = p.parent; assert(p && ts.isJsxAttribute(p)); assert.equal(p.name.getText(ast), "onClick"); }
    if (ts.isCallExpression(n) && n.expression.getText(ast) === "useEffect") assert.doesNotMatch(n.getText(ast), /dispatch/);
    ts.forEachChild(n, visit);
  } visit(ast);
  const consumers: string[] = [], patchCallers: string[] = [];
  for (const root of ["src", "scripts"]) for (const file of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    const path = root + "/" + file.replace(/\\/g, "/"); if (!/\.[cm]?[jt]sx?$/.test(path) || /\.(?:test|integration)\./.test(path)) continue;
    const source = readFileSync(path, "utf8");
    if (/from ["'](?:.*\/)opencredit-client-correction.service["']/.test(source)) consumers.push(path);
    if (/\.patchJsonAfterCommit\(/.test(source)) patchCallers.push(path);
  }
  assert.deepEqual(consumers, ["src/lib/opencredit-client-correction-admin-handler.ts"]);
  assert.deepEqual(patchCallers, ["src/lib/opencredit-client-correction.service.ts"]);
  const service = readFileSync("src/lib/opencredit-client-correction.service.ts", "utf8");
  assert.doesNotMatch(service, /client-validation|\/validate|simulate|\.request\(|console\.|data: \{[^}]*\b(?:cpf|phone|email|nomeMae|dataNascimento)\s*:/);
  const auth = readFileSync("src/app/components/integrations/OpenCreditCorrectionAuthorizationPanel.tsx", "utf8");
  assert.match(auth, /atualização cadastral/); assert.match(auth, /CLIENT_PROFILE_CORRECTION/); assert.doesNotMatch(auth, /CLIENT_PROFILE_UPSERT|OpenCreditCreateClientPanel/);
});
