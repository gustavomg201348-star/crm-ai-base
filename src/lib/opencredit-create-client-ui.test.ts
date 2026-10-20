import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import * as ts from "typescript";
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
for (const code of ["RATE_LIMITED", "OPENCREDIT_CREATE_CLIENT_DISPATCH_AUTHENTICATION", "OPENCREDIT_CREATE_CLIENT_DISPATCH_PRE_DISPATCH_UNAVAILABLE", "OPENCREDIT_CREATE_CLIENT_DISPATCH_SETTLEMENT_FAILED",
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
  assert.deepEqual(ast.statements.filter(ts.isImportDeclaration).map(n => (n.moduleSpecifier as ts.StringLiteral).text), ["react", "@/lib/opencredit-create-client-ui"]);
  const owner = (n: ts.Node) => { let p: ts.Node | undefined = n; while (p && !ts.isFunctionDeclaration(p)) p = p.parent; return p && ts.isFunctionDeclaration(p) ? p.name?.text : null; };
  const generators = calls.filter(c => c.expression.getText(ast) === "crypto.randomUUID"); assert.equal(generators.length, 1); assert.equal(owner(generators[0]), "send");
  let branch: ts.Node | undefined = generators[0]; while (branch && !ts.isIfStatement(branch)) branch = branch.parent;
  assert(branch); // The generator is additionally nested under no recovered pending command.
  const send = source.slice(source.indexOf("async function send()"), source.indexOf("  if (hidden) return null;"));
  assert.match(send, /if \(context.operation !== null\)[\s\S]*context.operation.commandId[\s\S]*} else \{[\s\S]*crypto.randomUUID\(\)/);
  assert(send.indexOf("window.confirm(") < send.indexOf("crypto.randomUUID("));
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
  assert.match(send, /working.current \|\| busy/); assert.match(send, /!authorizationActive \|\| !confirmed/);
  assert.match(send, /JSON.stringify\(\{ companyId, contactId, commandId \}\)/);
  for (const c of calls.filter(c => c.expression.getText(ast) === "useEffect")) assert.doesNotMatch(c.getText(ast), /send\(|dispatchEndpoint|randomUUID|setItem/);
  for (const c of calls.filter(c => c.expression.getText(ast) === "fetch" && c.arguments[0].getText(ast) === "dispatchEndpoint")) assert.equal(owner(c), "send");
  const sends = calls.filter(c => c.expression.getText(ast) === "send"); assert.equal(sends.length, 1);
  let click: ts.Node | undefined = sends[0]; while (click && !ts.isJsxAttribute(click)) click = click.parent; assert(click && ts.isJsxAttribute(click)); assert.equal(click.name.getText(ast), "onClick");
  const conditions: string[] = []; const jsxVisit = (n: ts.Node) => { if (ts.isJsxAttribute(n) && n.name.getText(ast) === "onChange") conditions.push(n.getText(ast)); ts.forEachChild(n, jsxVisit); }; jsxVisit(ast);
  assert(conditions.every(s => !/send|fetch|randomUUID/.test(s)));
  assert.match(source, /context.operation === null \|\| state === "PREPARED"/); assert.match(source, /\{canCommand &&/);
  assert.match(source, /key=\{JSON.stringify\(\[props.companyId, props.contactId\]\)\}/);
  assert.equal((source.match(/abort.signal.aborted \|\| sequence.current !== epoch/g) ?? []).length, 5);
  assert.match(source, /sequence.current\+\+; controller.current\?\.abort\(\)/);
  assert.match(source, /await load\(message\)/); assert.match(source, /response.status === 401 \|\| response.status === 403/);
  assert.match(source, /if \(parsed.operation\?\.state === "PREPARED"\) sessionStorage.setItem\(storageKey, parsed.operation.commandId\)/);
  for (const tag of Array.from(source.matchAll(/<button\b([^>]+)>/g))) assert.match(tag[1], /type="button"/);
  assert.doesNotMatch(source, /Tentar novamente|Atualizar novamente|Sincronizar novamente|Novo cadastro|Reenviar/);
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
