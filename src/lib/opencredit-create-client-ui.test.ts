import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { runInThisContext } from "node:vm";
import * as ts from "typescript";
import { parseOpenCreditCreateClientPhonePolicy } from "./opencredit-create-client-phone-policy";
import { createClientErrorMessage, isOpenCreditCommandId, parseCreateClientContext, parseCreateClientDispatchResponse, resolveCreateClientCommandId,
  type CreateClientOperation } from "./opencredit-create-client-ui";
const uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", other = "bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb";
const op = (state: CreateClientOperation["state"] = "PREPARED"): CreateClientOperation => ({ operationId: "operation", commandId: uuid, state, revision: 0 });
const context = () => ({ ok: true, operation: op() });
const dispatch = () => ({ ok: true, operationId: "operation", state: "SUCCEEDED", revision: 2, dispatched: true });
test("null context valid", () => assert.deepEqual(parseCreateClientContext({ ok: true, operation: null }), { ok: true, operation: null }));
for (const state of ["PREPARED", "IN_FLIGHT", "UNKNOWN", "SUCCEEDED", "FAILED"] as const) test("context accepts only exact state " + state, () => {
  const value = { ok: true, operation: op(state) }; assert.deepEqual(parseCreateClientContext(value), value);
});
for (const value of [null, [], {}, 1, "private", { ...context(), extra: true }, { ...context(), ok: false }, { ...context(), operation: { ...op(), created: true } },
  ...["OTHER", "prepared", null, 1].map(state => ({ ...context(), operation: { ...op(), state } })),
  ...[-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "0", null].map(revision => ({ ...context(), operation: { ...op(), revision } })),
  ...["", "x\n", "é", "x".repeat(129), null, 3].map(operationId => ({ ...context(), operation: { ...op(), operationId } })),
  Object.assign(Object.create({ extra: true }), context())]) test("reject malformed context " + JSON.stringify(value), () => assert.equal(parseCreateClientContext(value), null));
for (const value of [uuid.toUpperCase(), uuid + "\n", " " + uuid, uuid.replace("4aaa", "1aaa"), uuid.replace("4aaa", "3aaa"), uuid.replace("4aaa", "5aaa"), uuid.replace("8aaa", "7aaa"), null, 3, [], {}]) test("strict command UUID " + JSON.stringify(value), () => {
  assert.equal(isOpenCreditCommandId(value), false); assert.equal(parseCreateClientContext({ ...context(), operation: { ...op(), commandId: value } }), null);
});
test("all four UUID variant nibbles accepted", () => { for (const nibble of ["8", "9", "a", "b"]) assert(isOpenCreditCommandId(uuid.replace("8aaa", nibble + "aaa"))); });
for (const key of ["ok", "operation"]) test("root accessor rejection " + key, () => {
  let reads = 0; const value = context(); Object.defineProperty(value, key, { get() { reads++; throw Error("private"); } }); assert.equal(parseCreateClientContext(value), null); assert.equal(reads, 0);
});
for (const key of ["operationId", "commandId", "state", "revision"]) test("nested own property required without getters " + key, () => {
  let reads = 0; const operation = { ...op() }; Object.defineProperty(operation, key, { get() { reads++; throw Error("private"); } });
  assert.equal(parseCreateClientContext({ ok: true, operation }), null); assert.equal(reads, 0);
  const missing = { ...op() }; Reflect.deleteProperty(missing, key); assert.equal(parseCreateClientContext({ ok: true, operation: missing }), null);
});
for (const state of ["IN_FLIGHT", "SUCCEEDED", "UNKNOWN"]) for (const dispatched of [true, false]) test("dispatch response valid " + state + dispatched, () => {
  const value = { ...dispatch(), state, dispatched }; assert.deepEqual(parseCreateClientDispatchResponse(value), value);
});
for (const value of [null, {}, { ...dispatch(), created: true }, { ...dispatch(), state: "PREPARED" }, { ...dispatch(), state: "FAILED" },
  { ...dispatch(), revision: -1 }, { ...dispatch(), revision: "2" }, { ...dispatch(), operationId: "x\n" }, { ...dispatch(), dispatched: 1 },
  Object.assign(Object.create({ hidden: true }), dispatch())]) test("dispatch response rejects malformed " + JSON.stringify(value), () => assert.equal(parseCreateClientDispatchResponse(value), null));
for (const key of Object.keys(dispatch())) test("dispatch response accessor rejected " + key, () => {
  let reads = 0; const value = dispatch(); Object.defineProperty(value, key, { get() { reads++; throw Error("private"); } }); assert.equal(parseCreateClientDispatchResponse(value), null); assert.equal(reads, 0);
});
test("PREPARED always overrides pending/generated with exact server command", () => {
  assert.equal(resolveCreateClientCommandId({ operation: op(), pendingCommandId: other, generatedCommandId: other }), uuid);
});
for (const state of ["IN_FLIGHT", "UNKNOWN", "SUCCEEDED", "FAILED"] as const) test("persisted " + state + " never offers a command", () => {
  assert.equal(resolveCreateClientCommandId({ operation: op(state), pendingCommandId: other, generatedCommandId: other }), null);
});
test("pending is reused, generation only when no operation/pending", () => {
  assert.equal(resolveCreateClientCommandId({ operation: null, pendingCommandId: uuid, generatedCommandId: other }), uuid);
  assert.equal(resolveCreateClientCommandId({ operation: null, pendingCommandId: null, generatedCommandId: other }), other);
  assert.equal(resolveCreateClientCommandId({ operation: null, pendingCommandId: "bad", generatedCommandId: other }), other);
  assert.equal(resolveCreateClientCommandId({ operation: null, pendingCommandId: null }), null);
  assert.equal(resolveCreateClientCommandId({ operation: { ...op(), commandId: "bad" }, pendingCommandId: other, generatedCommandId: other }), null);
});
for (const code of ["LOCAL_COMMAND_PREPARATION_FAILED", "RATE_LIMITED", "OPENCREDIT_CREATE_CLIENT_DISPATCH_AUTHENTICATION", "OPENCREDIT_CREATE_CLIENT_DISPATCH_PRE_DISPATCH_UNAVAILABLE", "OPENCREDIT_CREATE_CLIENT_DISPATCH_SETTLEMENT_FAILED",
  "OPENCREDIT_COMMERCIAL_OPERATION_CONSUMER_AUTHORIZATION_MISSING", "OPENCREDIT_COMMERCIAL_OPERATION_CONSUMER_AUTHORIZATION_INACTIVE", "OPENCREDIT_COMMERCIAL_OPERATION_OPERATION_STATE_CONFLICT", "OPENCREDIT_COMMERCIAL_OPERATION_OPERATION_REVISION_CONFLICT", "OPENCREDIT_COMMERCIAL_OPERATION_CONCURRENT_CONFLICT"]) test("humanized closed error " + code, () => {
  const message = createClientErrorMessage({ error: code }); assert.notEqual(message, createClientErrorMessage(null)); assert(!message.includes(code)); assert.doesNotMatch(message, /tente novamente/i);
});
test("unknown errors/accessors and extra private fields never leak", () => {
  let reads = 0;
  for (const value of [{ error: "private token" }, { error: "constructor" }, { error: "toString" }, { error: "__proto__" }, { error: "RATE_LIMITED", raw: "private" }, Object.defineProperty({}, "error", { get() { reads++; throw Error("private"); } })]) assert.equal(createClientErrorMessage(value), createClientErrorMessage(null));
  assert.equal(reads, 0);
});

test("client module is browser-safe and side-effect free", () => {
  const source = readFileSync("src/lib/opencredit-create-client-ui.ts", "utf8");
  assert.doesNotMatch(source, /\bimport\b|server-only|Prisma|process\.env|provider-scope-resolver|commercial-operation\.service|opencredit-api-client|\bfetch\b|randomUUID|sessionStorage|setTimeout|setInterval/);
});
test("component AST: only explicit onClick dispatch, no automation, storage before transport, target epochs", () => {
  const file = "src/app/components/integrations/OpenCreditCreateClientPanel.tsx", source = readFileSync(file, "utf8");
  assert.match(source, /^"use client"/); assert.doesNotMatch(source, /providerScope|\bcpf\b|profileJson|authorizationId|tenantId|partnerId|setInterval|setTimeout|while\s*\(|do\s*\{|\.removeItem\(|console\.|logger|dangerouslySetInnerHTML/);
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), calls: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => { if (ts.isCallExpression(n)) calls.push(n); ts.forEachChild(n, visit); }; visit(ast);
  assert.deepEqual(ast.statements.filter(ts.isImportDeclaration).map(n => (n.moduleSpecifier as ts.StringLiteral).text), ["react", "./OpenCreditCreateClientReconciliationPanel", "@/lib/opencredit-create-client-phone-policy", "@/lib/opencredit-create-client-ui"]);
  const owner = (n: ts.Node) => { let p: ts.Node | undefined = n; while (p && !ts.isFunctionDeclaration(p)) p = p.parent; return p && ts.isFunctionDeclaration(p) ? p.name?.text : null; };
  const generators = calls.filter(c => c.expression.getText(ast) === "crypto.randomUUID"); assert.equal(generators.length, 1); assert.equal(owner(generators[0]), "send");
  let branch: ts.Node | undefined = generators[0]; while (branch && !ts.isIfStatement(branch)) branch = branch.parent;
  assert(branch); // The generator is additionally nested under no recovered pending command.
  const send = source.slice(source.indexOf("async function send()"), source.indexOf("  if (hidden) return null;"));
  assert.match(send, /if \(context.operation !== null\)[\s\S]*context.operation.commandId[\s\S]*} else \{[\s\S]*crypto.randomUUID\(\)/);
  assert.doesNotMatch(source, /window\.confirm|\bconfirm\(/);
  assert(send.indexOf("sessionStorage.setItem(storageKey, commandId)") < send.indexOf("fetch(dispatchEndpoint"));
  const storageCalls = calls.filter(c => /^sessionStorage\.(?:getItem|setItem)$/.test(c.expression.getText(ast)));
  assert.equal(storageCalls.length, 3);
  for (const call of storageCalls) {
    let scope: ts.Node | undefined = call; while (scope && !ts.isTryStatement(scope)) scope = scope.parent;
    assert(scope, "storage failures must be caught fail-closed");
    assert.equal(call.arguments[0].getText(ast), "storageKey");
    if (call.arguments.length === 2) assert(["commandId", "parsed.operation.commandId"].includes(call.arguments[1].getText(ast)));
  }
  assert(send.indexOf("working.current = true") < send.indexOf("fetch(dispatchEndpoint"));
  assert.match(send, /working.current \|\| busy/); assert.match(send, /!authorizationActive \|\| !confirmed \|\| !riskConfirmed/);
  assert.match(send, /JSON.stringify\(\{ companyId, contactId, commandId, phonePolicy \}\)/);
  for (const c of calls.filter(c => c.expression.getText(ast) === "useEffect")) assert.doesNotMatch(c.getText(ast), /send\(|dispatchEndpoint|randomUUID|setItem/);
  for (const c of calls.filter(c => c.expression.getText(ast) === "fetch" && c.arguments[0].getText(ast) === "dispatchEndpoint")) assert.equal(owner(c), "send");
  const sends = calls.filter(c => c.expression.getText(ast) === "send"); assert.equal(sends.length, 1);
  let click: ts.Node | undefined = sends[0]; while (click && !ts.isJsxAttribute(click)) click = click.parent; assert(click && ts.isJsxAttribute(click)); assert.equal(click.name.getText(ast), "onClick");
  const conditions: string[] = []; const jsxVisit = (n: ts.Node) => { if (ts.isJsxAttribute(n) && n.name.getText(ast) === "onChange") conditions.push(n.getText(ast)); ts.forEachChild(n, jsxVisit); }; jsxVisit(ast);
  assert(conditions.every(s => !/send|fetch|randomUUID/.test(s)));
  assert.match(source, /context.operation === null \|\| state === "PREPARED"/); assert.match(source, /\{canCommand &&/);
  assert.match(source, /key=\{JSON.stringify\(\[props.companyId, props.contactId\]\)\}/);
  assert.equal((source.match(/abort.signal.aborted \|\| sequence.current !== epoch/g) ?? []).length, 7);
  assert.match(source, /sequence.current\+\+; controller.current\?\.abort\(\)/);
  assert.match(source, /await load\(message\)/); assert.match(source, /response.status === 401 \|\| response.status === 403/);
  assert.match(source, /if \(parsed.operation\?\.state === "PREPARED"\) sessionStorage.setItem\(storageKey, parsed.operation.commandId\)/);
  for (const tag of Array.from(source.matchAll(/<button\b([^>]+)>/g))) assert.match(tag[1], /type="button"/);
  assert.doesNotMatch(source, /Tentar novamente|Atualizar novamente|Sincronizar novamente|Novo cadastro|Reenviar/);
});
test("explicit phone selector defaults INCLUDE, previews OMIT, and invalidates confirmation", () => {
  const source = readFileSync("src/app/components/integrations/OpenCreditCreateClientPanel.tsx", "utf8");
  assert.match(source, /useState<OpenCreditCreateClientPhonePolicy>\("include"\)/);
  assert.match(source, /<option value="include">/); assert.match(source, /<option value="omit">/);
  assert.match(source, /setPhonePolicy\(parseOpenCreditCreateClientPhonePolicy\(e.target.value\)\); setConfirmed\(false\); setRiskConfirmed\(false\)/);
  assert.match(source, /Phone policy:/); assert.match(source, /telefone no cadastro permanece preservado/);
  assert.match(source, /JSON.stringify\(\{ companyId, contactId, commandId, phonePolicy \}\)/);
});

// Execute the actual TSX handlers with a small hook renderer and fake browser ports.
// No DOM package, real HTTP, provider, database or production session is used.
type PanelProps = { enabled: boolean; companyId: string; contactId: string; authorizationActive: boolean };
type View = { type: unknown; props: Record<string, unknown>; key?: string };
function panelHarness(options: {
  fail?: "get" | "set" | "uuid" | "serialize"; operation?: CreateClientOperation | null;
  pending?: string; networkFailure?: boolean; pendingDispatch?: boolean; onStore?: () => void;
} = {}) {
  let cells: unknown[] = [], cursor = 0, key: string | undefined, root: View | null = null;
  const stageChanges: string[][] = [], portStages: { port: string; stages: string[] }[] = [];
  const timeline: string[] = [];
  const currentStages = () => [...(cells.find(Array.isArray) as string[] | undefined ?? [])];
  const recordPort = (port: string) => { portStages.push({ port, stages: currentStages() }); timeline.push("port:" + port); };
  const effects: (() => void)[] = [];
  type Effect = { deps: unknown[]; cleanup?: () => void };
  const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial: unknown) {
      const i = cursor++; if (!(i in cells)) cells[i] = initial;
      return [cells[i], (value: unknown) => {
        cells[i] = typeof value === "function" ? (value as (previous: unknown) => unknown)(cells[i]) : value;
        if (Array.isArray(cells[i])) { const stages = currentStages(); stageChanges.push(stages); timeline.push("stage:" + stages[stages.length - 1]); }
      }];
    },
    useRef(initial: unknown) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
    useCallback(fn: unknown, deps: unknown[]) {
      const i = cursor++, previous = cells[i] as { fn: unknown; deps: unknown[] } | undefined;
      if (!previous || !same(previous.deps, deps)) cells[i] = { fn, deps };
      return (cells[i] as { fn: unknown }).fn;
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const i = cursor++, previous = cells[i] as Effect | undefined;
      if (previous && same(previous.deps, deps)) return;
      const cell: Effect = { deps, cleanup: previous?.cleanup }; cells[i] = cell;
      effects.push(() => { cell.cleanup?.(); const cleanup = effect(); cell.cleanup = typeof cleanup === "function" ? cleanup : undefined; });
    },
  };
  let props: PanelProps = { enabled: true, companyId: "synthetic-company", contactId: "synthetic-contact", authorizationActive: true };
  let operation = options.operation ?? null, generations = 0, finishDispatch: ((response: Response) => void) | undefined;
  const stored = new Map<string, string>(), dispatches: RequestInit[] = [], contextRequests: RequestInit[] = [];
  if (options.pending) stored.set("opencredit:create-client-command:synthetic-company:synthetic-contact", options.pending);
  const browserFetch = async (url: string, init: RequestInit) => {
    if (url === "/api/admin/integrations/opencredit/create-client/context") {
      contextRequests.push(init); return Response.json({ ok: true, operation });
    }
    assert.equal(url, "/api/admin/integrations/opencredit/create-client/dispatch"); recordPort("dispatch"); dispatches.push(init);
    if (options.networkFailure) throw Error("PRIVATE_NETWORK_DETAIL");
    if (options.pendingDispatch) return new Promise<Response>(resolve => { finishDispatch = resolve; });
    operation = { ...op("SUCCEEDED"), revision: 2 }; return Response.json(dispatch());
  };
  const testModule = { exports: {} as { OpenCreditCreateClientPanel: (p: PanelProps) => View | null } };
  const jsx = (type: unknown, viewProps: Record<string, unknown>, viewKey?: string): View => ({ type, props: viewProps, key: viewKey });
  const source = readFileSync("src/app/components/integrations/OpenCreditCreateClientPanel.tsx", "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  // Same realm preserves the real helper's strict Object.prototype checks.
  const execute = runInThisContext('(function(ports) { "use strict"; const { exports, require, AbortController, fetch, sessionStorage, crypto, JSON } = ports;\n' + compiled + '\n})') as (ports: Record<string, unknown>) => void;
  execute({
    exports: testModule.exports,
    require(specifier: string) {
      if (specifier === "react") return hooks;
      if (specifier === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: Symbol("fragment") };
      if (specifier === "./OpenCreditCreateClientReconciliationPanel") return { OpenCreditCreateClientReconciliationPanel: () => null };
      if (specifier === "@/lib/opencredit-create-client-phone-policy") return { parseOpenCreditCreateClientPhonePolicy };
      assert.equal(specifier, "@/lib/opencredit-create-client-ui");
      return { createClientErrorMessage, isOpenCreditCommandId, parseCreateClientContext, parseCreateClientDispatchResponse, resolveCreateClientCommandId };
    },
    AbortController, fetch: browserFetch,
    crypto: { randomUUID() { recordPort("uuid"); generations++; if (options.fail === "uuid") throw Error("PRIVATE_CRYPTO_DETAIL"); return uuid; } },
    sessionStorage: {
      getItem(k: string) { recordPort("get"); if (options.fail === "get") throw Error("PRIVATE_STORAGE_DETAIL"); return stored.get(k) ?? null; },
      setItem(k: string, value: string) { recordPort("set"); if (options.fail === "set") throw Error("PRIVATE_STORAGE_DETAIL"); stored.set(k, value); options.onStore?.(); },
    },
    JSON: { parse: JSON.parse, stringify(value: unknown) {
      if (value && typeof value === "object" && "commandId" in value) recordPort("serialize");
      if (options.fail === "serialize" && value && typeof value === "object" && "commandId" in value) throw Error("PRIVATE_SERIALIZATION_DETAIL");
      return JSON.stringify(value);
    } },
  });
  function unmount() { for (const cell of cells) (cell as Effect | undefined)?.cleanup?.(); cells = []; key = undefined; root = null; effects.length = 0; }
  function render() {
    const child = testModule.exports.OpenCreditCreateClientPanel(props);
    if (!child) { unmount(); return; }
    if (key !== child.key) { unmount(); key = child.key; }
    cursor = 0; root = (child.type as (p: PanelProps) => View)(child.props as PanelProps);
    for (const effect of effects.splice(0)) effect();
  }
  function nodes(): View[] {
    const result: View[] = [];
    const visit = (v: unknown) => { if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v === "object" && "props" in v) { const n = v as View; result.push(n); visit(n.props.children); } };
    visit(root); return result;
  }
  const text = (v: unknown): string => Array.isArray(v) ? v.map(text).join("") : v && typeof v === "object" && "props" in v ? text((v as View).props.children) : typeof v === "string" || typeof v === "number" ? String(v) : "";
  const boxes = () => nodes().filter(n => n.type === "input" && n.props.type === "checkbox");
  const button = () => nodes().find(n => n.type === "button" && /^(Cadastrar|Continuar cadastro) na OpenCredit$/.test(text(n.props.children)));
  render();
  return {
    dispatches, contextRequests, stored, stageChanges, portStages, timeline, generations: () => generations, unmount,
    stage: () => nodes().filter(n => n.type === "p").map(n => text(n.props.children)).find(t => t.startsWith("Etapa local: "))?.slice("Etapa local: ".length),
    trace: () => nodes().filter(n => n.type === "p").map(n => text(n.props.children)).find(t => t.startsWith("Histórico local: "))?.slice("Histórico local: ".length).split(" → "),
    async flush() { for (let i = 0; i < 16; i++) await Promise.resolve(); render(); },
    button, confirmations: () => boxes().map(n => n.props.checked),
    confirm(index: number, checked = true) { (boxes()[index].props.onChange as (e: unknown) => void)({ target: { checked } }); render(); },
    policy(value: "include" | "omit") { const select = nodes().find(n => n.type === "select")!; (select.props.onChange as (e: unknown) => void)({ target: { value } }); render(); },
    click() { const b = button(); assert(b); (b.props.onClick as () => void)(); render(); },
    reload() { const b = nodes().find(n => n.type === "button" && text(n.props.children) === "Atualizar painel")!; (b.props.onClick as () => void)(); render(); },
    setProps(next: Partial<PanelProps>) { props = { ...props, ...next }; render(); },
    setOperation(next: CreateClientOperation | null) { operation = next; },
    completeDispatch() { assert(finishDispatch); finishDispatch(Response.json(dispatch())); },
    alerts: () => nodes().filter(n => n.props.role === "alert").map(n => text(n.props.children)),
  };
}

for (const first of [false, true]) for (const second of [false, true]) test(`actual panel: two visible confirmations required ${first}/${second}`, async () => {
  const h = panelHarness(); await h.flush(); assert.deepEqual(h.confirmations(), [false, false]);
  assert.equal(h.stage(), "IDLE");
  h.confirm(0, first); h.confirm(1, second); assert.equal(h.button()!.props.disabled, !(first && second));
  if (!first || !second) { h.click(); await h.flush(); assert.equal(h.dispatches.length, 0); assert.deepEqual(h.trace(), ["IDLE"]); }
  h.unmount();
});
test("actual panel: policy, reload, authority and target changes reset BOTH confirmations", async () => {
  const h = panelHarness(); await h.flush();
  for (const policy of ["omit", "include"] as const) { h.confirm(0); h.confirm(1); h.policy(policy); assert.deepEqual(h.confirmations(), [false, false]); }
  h.confirm(0); h.confirm(1); h.reload(); await h.flush(); assert.deepEqual(h.confirmations(), [false, false]);
  h.confirm(0); h.confirm(1); h.setProps({ authorizationActive: false }); h.setProps({ authorizationActive: true });
  assert.deepEqual(h.confirmations(), [false, false]);
  h.confirm(0); h.confirm(1); h.setProps({ contactId: "synthetic-other" }); await h.flush(); assert.deepEqual(h.confirmations(), [false, false]);
  h.confirm(0); h.confirm(1); h.setProps({ companyId: "synthetic-other-company" }); await h.flush(); assert.deepEqual(h.confirmations(), [false, false]);
  assert.equal(h.dispatches.length, 0); h.unmount();
});
test("actual panel: operational-state reload clears confirmations and blocks terminal dispatch", async () => {
  const h = panelHarness(); await h.flush(); h.confirm(0); h.confirm(1);
  h.setOperation(op()); h.reload(); await h.flush(); assert.deepEqual(h.confirmations(), [false, false]);
  h.confirm(0); h.confirm(1); h.setOperation(op("UNKNOWN")); h.reload(); await h.flush();
  assert.equal(h.button(), undefined); assert.equal(h.dispatches.length, 0); assert.equal(h.generations(), 0); h.unmount();
});
for (const fail of ["get", "set", "uuid", "serialize"] as const) test("actual panel: local " + fail + " failure is visible, sanitized, zero dispatch and no reload", async () => {
  const h = panelHarness({ fail }); await h.flush(); h.confirm(0); h.confirm(1); h.click(); await h.flush();
  assert.equal(h.dispatches.length, 0); assert.equal(h.contextRequests.length, 1);
  assert.deepEqual(h.alerts(), [createClientErrorMessage({ error: "LOCAL_COMMAND_PREPARATION_FAILED" })]);
  assert.doesNotMatch(h.alerts().join(""), /PRIVATE|stack|token|synthetic/);
  assert.equal(h.stage(), "PREPARATION_FAILED");
  assert.deepEqual(h.trace(), ["CLICK_RECEIVED", "PREPARING_COMMAND", "PREPARATION_FAILED"]);
  assert(h.portStages.every(p => p.stages[p.stages.length - 1] === "PREPARING_COMMAND"));
  await h.flush(); assert.equal(h.stage(), "PREPARATION_FAILED"); // No immediate diagnostic erasure.
  assert.deepEqual(h.confirmations(), [false, false]); assert.equal(h.button()!.props.disabled, true); h.unmount();
});
for (const state of ["IN_FLIGHT", "UNKNOWN", "SUCCEEDED", "FAILED"] as const) test("actual panel: persisted " + state + " offers no dispatch button or generation", async () => {
  const h = panelHarness({ operation: op(state) }); await h.flush(); assert.equal(h.button(), undefined);
  assert.equal(h.generations(), 0); assert.equal(h.dispatches.length, 0); h.unmount();
});
test("actual panel: authorization and loading remain fail-closed", async () => {
  const h = panelHarness(); assert.equal(h.button(), undefined); await h.flush(); h.confirm(0); h.confirm(1);
  h.setProps({ authorizationActive: false }); assert.equal(h.button()!.props.disabled, true); h.click(); await h.flush();
  assert.equal(h.dispatches.length, 0); assert.equal(h.stage(), "IDLE"); h.unmount();
});
test("actual panel: OMIT dispatches exactly once, duplicate click is blocked and pending command stays stable", async () => {
  const h = panelHarness({ pending: other, pendingDispatch: true }); await h.flush(); h.policy("omit"); h.confirm(0); h.confirm(1);
  h.click(); assert.equal(h.button()!.props.disabled, true);
  const stages = h.stageChanges.length; h.click(); await h.flush(); assert.equal(h.stageChanges.length, stages);
  assert.equal(h.stage(), "DISPATCH_STARTING");
  assert.equal(h.dispatches.length, 1); assert.equal(h.generations(), 0);
  assert.deepEqual(JSON.parse(h.dispatches[0].body as string), { companyId: "synthetic-company", contactId: "synthetic-contact", commandId: other, phonePolicy: "omit" });
  assert.equal(h.dispatches[0].credentials, "same-origin"); assert.equal(h.dispatches[0].cache, "no-store");
  h.completeDispatch(); await h.flush(); assert.equal(h.dispatches.length, 1); assert.equal(h.stored.values().next().value, other); h.unmount();
});
test("actual panel: default INCLUDE generates once; PREPARED uses server command without UUID generation", async () => {
  for (const operation of [null, op()]) {
    const h = panelHarness({ operation, fail: operation ? "uuid" : undefined }); await h.flush(); h.confirm(0); h.confirm(1); h.click(); await h.flush();
    assert.equal(h.dispatches.length, 1); assert.equal(h.generations(), operation ? 0 : 1);
    const body = JSON.parse(h.dispatches[0].body as string); assert.equal(body.commandId, uuid); assert.equal(body.phonePolicy, "include"); h.unmount();
  }
});
test("actual panel: network ambiguity never retries or replaces the saved command", async () => {
  const h = panelHarness({ networkFailure: true }); await h.flush(); h.confirm(0); h.confirm(1); h.click(); await h.flush(); await h.flush();
  assert.equal(h.dispatches.length, 1); assert.equal(h.generations(), 1); assert.equal(h.stored.values().next().value, uuid);
  assert.deepEqual(h.confirmations(), [false, false]); assert.equal(h.alerts().length, 1); assert.doesNotMatch(h.alerts()[0], /PRIVATE/); h.unmount();
});
for (const throwAfterAbort of [false, true]) test("actual panel: aborted local preparation is silent and never fetches " + throwAfterAbort, async () => {
  let abort = () => {};
  const h = panelHarness({ onStore: () => { abort(); if (throwAfterAbort) throw Error("PRIVATE_ABORT_DETAIL"); } }); abort = () => h.unmount();
  await h.flush(); h.confirm(0); h.confirm(1); h.click(); assert.equal(h.dispatches.length, 0); assert.deepEqual(h.alerts(), []); h.unmount();
});
test("actual panel: target epoch abort after dispatch suppresses stale errors and never retries", async () => {
  const h = panelHarness({ pendingDispatch: true }); await h.flush(); h.confirm(0); h.confirm(1); h.click();
  h.setProps({ contactId: "synthetic-other" }); await h.flush(); h.completeDispatch(); await h.flush();
  assert.equal(h.dispatches.length, 1); assert.equal(h.generations(), 1); assert.deepEqual(h.alerts(), []); assert.deepEqual(h.confirmations(), [false, false]); assert.deepEqual(h.trace(), ["IDLE"]); h.unmount();
});

test("actual panel: exact local port ordering and visible trace after one batched render", async () => {
  const h = panelHarness({ pendingDispatch: true }); assert.equal(h.stage(), "IDLE"); await h.flush();
  h.confirm(0); h.confirm(1); h.timeline.length = 0; h.click();
  assert.deepEqual(h.timeline, ["stage:CLICK_RECEIVED", "stage:PREPARING_COMMAND", "port:get", "port:uuid", "port:serialize", "port:set",
    "stage:COMMAND_READY", "stage:DISPATCH_STARTING", "port:dispatch"]);
  assert.deepEqual(h.trace(), ["CLICK_RECEIVED", "PREPARING_COMMAND", "COMMAND_READY", "DISPATCH_STARTING"]);
  for (const port of h.portStages) assert.equal(port.stages[port.stages.length - 1], port.port === "dispatch" ? "DISPATCH_STARTING" : "PREPARING_COMMAND");
  assert.equal(h.dispatches.length, 1); h.completeDispatch(); await h.flush();
  assert.equal(h.stage(), "DISPATCH_STARTING"); // Automatic context reconciliation preserves the trace.
  assert.equal(h.contextRequests.length, 2); h.unmount();
});

test("actual panel: stage trace survives ambiguity, resets only on explicit refresh, policy, authority or target", async () => {
  const h = panelHarness({ networkFailure: true }); await h.flush(); h.confirm(0); h.confirm(1); h.click(); await h.flush();
  assert.equal(h.stage(), "DISPATCH_STARTING"); assert.equal(h.dispatches.length, 1);
  h.reload(); await h.flush(); assert.deepEqual(h.trace(), ["IDLE"]);
  h.confirm(0); h.confirm(1); h.click(); await h.flush(); h.policy("omit"); assert.deepEqual(h.trace(), ["IDLE"]);
  h.confirm(0); h.confirm(1); h.click(); await h.flush(); h.setProps({ authorizationActive: false }); await h.flush(); assert.deepEqual(h.trace(), ["IDLE"]);
  h.setProps({ authorizationActive: true }); await h.flush(); h.confirm(0); h.confirm(1); h.click(); await h.flush();
  h.setProps({ companyId: "synthetic-other-company" }); await h.flush(); assert.deepEqual(h.trace(), ["IDLE"]); h.unmount();
});

test("local stage vocabulary is closed, browser-only, non-sensitive and never claims server receipt", () => {
  const source = readFileSync("src/app/components/integrations/OpenCreditCreateClientPanel.tsx", "utf8");
  const ast = ts.createSourceFile("panel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const stageType = ast.statements.find(n => ts.isTypeAliasDeclaration(n) && n.name.text === "LocalStage");
  assert(stageType && ts.isTypeAliasDeclaration(stageType) && ts.isUnionTypeNode(stageType.type));
  assert.deepEqual(stageType.type.types.map(t => {
    assert(ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)); return t.literal.text;
  }), ["IDLE", "CLICK_RECEIVED", "PREPARING_COMMAND", "COMMAND_READY", "DISPATCH_STARTING", "PREPARATION_FAILED"]);
  const send = source.slice(source.indexOf("async function send()"), source.indexOf("  if (hidden) return null;"));
  const guard = /if \(([\s\S]*?)\) return;/.exec(send);
  assert.equal(guard?.[1].replace(/\s+/g, " "), 'working.current || busy || hidden || !enabled || !authorizationActive || !confirmed || !riskConfirmed || !context || context.operation !== null && context.operation.state !== "PREPARED"');
  assert(send.indexOf('setLocalStages(["CLICK_RECEIVED"])') > send.indexOf('context.operation.state !== "PREPARED") return;'));
  assert.match(source, /não o recebimento pelo servidor/); assert.match(source, /Etapas locais não autorizam repetição/);
  assert.match(source, /Histórico local: \{localStages.join\(" → "\)\}/);
  assert.doesNotMatch(source, /console\.|window\.confirm|flushSync|setTimeout|setInterval/);
  assert.equal((source.match(/fetch\(dispatchEndpoint/g) ?? []).length, 1);
});
test("runtime consumers and endpoint are exact, including extension and indirect import forms", () => {
  const component = "src/app/components/integrations/OpenCreditCreateClientPanel.tsx", handler = "src/lib/opencredit-create-client-context-admin-handler.ts", service = "src/lib/opencredit-create-client-context.service.ts";
  const route = "src/app/api/admin/integrations/opencredit/create-client/context/route.ts";
  const consumers: Record<string, string[]> = { "opencredit-create-client-context.service": [], "opencredit-create-client-context-admin-handler": [], "OpenCreditCreateClientPanel": [] };
  for (const root of ["src", "scripts"]) for (const file of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    const path = root + "/" + file.replace(/\\/g, "/"); if (!/\.[cm]?[jt]sx?$/.test(path) || /\.(test|integration)\./.test(path)) continue;
    const text = readFileSync(path, "utf8"), ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node): void => {
      if (ts.isStringLiteralLike(n)) {
        if (n.text === "/api/admin/integrations/opencredit/create-client/dispatch") assert.equal(path, component);
        for (const key of Object.keys(consumers)) if (new RegExp("(?:^|/)" + key.replace(/\./g, "\\.") + "(?:\\.[cm]?[jt]sx?)?$").test(n.text)) {
          const allowed = key === "OpenCreditCreateClientPanel" ? "src/app/components/integrations/OpenCreditConsumerAuthorizationPanel.tsx" : key.endsWith("admin-handler") ? route : handler;
          assert.equal(path, allowed); assert(ts.isImportDeclaration(n.parent)); consumers[key].push(path);
        }
        if (text.startsWith('"use client"') && /(?:dispatcher|context\.service|provider-scope-resolver|commercial-operation\.service)(?:\.[cm]?[jt]s)?$/.test(n.text)) assert.fail("Server import in client " + path);
      }
      ts.forEachChild(n, visit);
    }; visit(ast);
  }
  assert.deepEqual(consumers, { "opencredit-create-client-context.service": [handler], "opencredit-create-client-context-admin-handler": [route], "OpenCreditCreateClientPanel": ["src/app/components/integrations/OpenCreditConsumerAuthorizationPanel.tsx"] });
  assert.match(readFileSync(route, "utf8"), /export const runtime = "nodejs";[\s\S]*export const dynamic = "force-dynamic"/);
  assert.doesNotMatch(readFileSync(route, "utf8"), /getOpenCreditCreateClientContext|provider-scope-resolver|dispatchOpenCredit/);
  assert.doesNotMatch(readFileSync(service, "utf8"), /\.create\(|\.update\(|\.delete\(|\.upsert\(/);
  const ci = readFileSync(".github/workflows/ci.yml", "utf8"); for (const gate of ["Validate OpenCredit createClient read context", "Validate OpenCredit createClient human UI guards", "Validate OpenCredit createClient context on disposable PostgreSQL"]) assert(ci.includes(gate));
});
