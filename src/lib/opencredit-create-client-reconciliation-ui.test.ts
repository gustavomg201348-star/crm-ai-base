import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import * as ts from "typescript";
import { parseOpenCreditCreateClientReconciliationContext as parse, reconciliationErrorMessage } from "./opencredit-create-client-reconciliation-ui";
const review = (unknown = false) => ({ operationId: "operation", state: unknown ? "UNKNOWN" : "IN_FLIGHT", revision: unknown ? 2 : 1,
  reason: unknown ? "REMOTE_RESULT_AMBIGUOUS" : "DISPATCH_COMMITTED_RESULT_UNCONFIRMED", preparedAt: "2026-10-20T00:00:00.000Z",
  dispatchCommittedAt: "2026-10-20T00:00:01.000Z", settledAt: unknown ? "2026-10-20T00:00:02.000Z" : null, dispatchAuthorizationBound: true });
const root = (unknown = false) => ({ ok: true, review: review(unknown) });
test("null, IN_FLIGHT and UNKNOWN closed response", () => { for (const value of [{ ok: true, review: null }, root(), root(true)]) assert.deepEqual(parse(value), value); });
for (const [field, bad] of Object.entries({
  operationId: ["", " x", "x\n", "é", "x".repeat(129), null, 1],
  state: ["PREPARED", "SUCCEEDED", "FAILED", "unknown", null, 1],
  revision: [0, 2, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null],
  reason: ["REMOTE_RESULT_AMBIGUOUS", "OTHER", null, 1],
  settledAt: ["2026-10-20T00:00:02.000Z", "", 1],
  dispatchAuthorizationBound: [false, null, 1, "true", {}, []],
})) for (const value of bad) test("closed review rejects " + field + JSON.stringify(value), () => assert.equal(parse({ ok: true, review: { ...review(), [field]: value } }), null));
for (const field of ["preparedAt", "dispatchCommittedAt", "settledAt"]) for (const value of [null, 1, {}, [], "", "not-date", "2026-02-30T00:00:00.000Z", "2026-10-20", "2026-10-20T00:00:00Z", "2026-10-20T00:00:00.000+00:00", "2026-10-20T00:00:00.000Z\n", "2026-13-20T00:00:00.000Z"])
test("strict canonical ISO " + field + JSON.stringify(value), () => assert.equal(parse({ ok: true, review: { ...review(true), [field]: value } }), null));
for (const change of [{ revision: 1 }, { reason: "DISPATCH_COMMITTED_RESULT_UNCONFIRMED" }, { settledAt: null }, { settledAt: "2026-10-20T00:00:00.000Z" }]) test("UNKNOWN correlation " + JSON.stringify(change), () => assert.equal(parse({ ok: true, review: { ...review(true), ...change } }), null));
test("monotonic/equal timeline and closed keys", () => {
  assert.equal(parse({ ok: true, review: { ...review(), preparedAt: "2026-10-20T00:00:02.000Z" } }), null);
  assert(parse({ ok: true, review: { ...review(), dispatchCommittedAt: review().preparedAt } }));
  for (const field of Object.keys(review())) { const value: Record<string, unknown> = { ...review() }; delete value[field]; assert.equal(parse({ ok: true, review: value }), null); }
  for (const extra of ["cpf", "profile", "dispatchAuthorizationEventId", "events", "providerScope", "commandId", "tenantId", "partnerId"]) assert.equal(parse({ ok: true, review: { ...review(), [extra]: "private" } }), null);
  for (const value of [null, [], {}, { review: null }, { ...root(), ok: false }, { ...root(), extra: true }, Object.assign(Object.create({ extra: true }), root())]) assert.equal(parse(value), null);
  assert.equal(parse({ ok: true, review: Object.assign(Object.create({ extra: true }), review()) }), null);
  assert.equal(parse({ ...root(), [Symbol("extra")]: true }), null);
});
for (const field of ["ok", "review", ...Object.keys(review())]) test("accessor never executes " + field, () => {
  let calls = 0; const value = root();
  Object.defineProperty(field === "ok" || field === "review" ? value : value.review, field, { get() { calls++; throw Error("private"); } });
  assert.equal(parse(value), null); assert.equal(calls, 0);
});
test("closed human errors and no provider details", () => {
  const generic = reconciliationErrorMessage(null);
  for (const value of [{ error: "private" }, { error: "__proto__" }, { error: "constructor" }, { error: "RATE_LIMITED", body: "private" }]) assert.equal(reconciliationErrorMessage(value), generic);
  assert.notEqual(reconciliationErrorMessage({ error: "RATE_LIMITED" }), generic);
  assert.match(reconciliationErrorMessage({ error: "OPENCREDIT_CREATE_CLIENT_RECONCILIATION_CORRUPT_LEDGER" }), /Não reenvie/);
  let calls = 0; assert.equal(reconciliationErrorMessage(Object.defineProperty({}, "error", { get() { calls++; throw Error("private"); } })), generic); assert.equal(calls, 0);
});
test("reconciliation is read-only in browser/server, exact runtime consumers, no automatic action", () => {
  const stem = "opencredit-create-client-reconciliation-", component = "src/app/components/integrations/OpenCreditCreateClientReconciliationPanel.tsx";
  const handler = "src/lib/" + stem + "context-admin-handler.ts", service = "src/lib/" + stem + "context.service.ts";
  const route = "src/app/api/admin/integrations/opencredit/create-client/reconciliation/context/route.ts";
  const source = readFileSync(component, "utf8"), helper = readFileSync("src/lib/" + stem + "ui.ts", "utf8");
  assert.match(source, /^"use client"/);
  assert.doesNotMatch(source + helper, /crypto|randomUUID|sessionStorage|setInterval|setTimeout|\/dispatch|core\.api|operationId\}|console\.|logger|dangerouslySetInnerHTML|Prisma|server-only|process\.env/);
  assert.doesNotMatch(helper, /\bfetch\b/);
  const helperTree = ts.createSourceFile("ui.ts", helper, ts.ScriptTarget.Latest, true);
  assert.deepEqual(helperTree.statements.filter(ts.isImportDeclaration).map(n => (n.moduleSpecifier as ts.StringLiteral).text), ["./opencredit-create-client-diagnostic"]);
  for (const file of [handler, service, component]) assert.doesNotMatch(readFileSync(file, "utf8"), /opencredit-api-client|opencredit-create-client-dispatcher|postJsonAfterCommit|dispatchOpenCreditCreateClient|prepareOpenCreditClientProfileOperation|reserveOpenCreditClientProfileOperationForDispatch|applyOpenCreditCreateClientObservation|markOpenCreditCommercialOperationUnknown/);
  const ast = ts.createSourceFile(component, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.deepEqual(ast.statements.filter(ts.isImportDeclaration).map(n => (n.moduleSpecifier as ts.StringLiteral).text), ["react", "@/lib/" + stem + "ui", "@/lib/opencredit-create-client-diagnostic"]);
  const calls: ts.CallExpression[] = [], buttons: ts.JsxOpeningElement[] = [];
  const visit = (n: ts.Node) => { if (ts.isCallExpression(n)) calls.push(n); if (ts.isJsxOpeningElement(n) && n.tagName.getText(ast) === "button") buttons.push(n); ts.forEachChild(n, visit); }; visit(ast);
  const fetches = calls.filter(c => c.expression.getText(ast) === "fetch"); assert.equal(fetches.length, 1); assert.equal(fetches[0].arguments[0].getText(ast), "endpoint");
  assert.equal(buttons.length, 1); assert.match(buttons[0].getText(ast), /onClick=\{\(\) => void load\(\)\}/);
  assert.match(source, /JSON.stringify\(\{ companyId, contactId \}\)/); assert.match(source, /credentials: "same-origin", cache: "no-store"/);
  assert.match(source, /key=\{JSON.stringify\(\[props.companyId, props.contactId\]\)\}/);
  assert.equal((source.match(/abort.signal.aborted \|\| sequence.current !== epoch/g) ?? []).length, 2);
  assert.match(source, /sequence.current\+\+; controller.current\?\.abort\(\)/);
  assert.match(source, /response.status === 401 \|\| response.status === 403/);
  assert.match(source, /não é possível confirmar se a OpenCredit recebeu/); assert.match(source, /Não reenvie/);
  assert.doesNotMatch(source, /Copiar ID|marcar como sucesso|marcar como falha|Tentar novamente/);
  const parent = readFileSync("src/app/components/integrations/OpenCreditCreateClientPanel.tsx", "utf8");
  assert.match(parent, /\(state === "IN_FLIGHT" \|\| state === "UNKNOWN" \|\| state === "SUCCEEDED" \|\| state === "PREPARED"\) && <OpenCreditCreateClientReconciliationPanel companyId=\{companyId\} contactId=\{contactId\}/);
  assert.doesNotMatch(parent, /Envio já iniciado/);
  const consumers: Record<string, string[]> = { [stem + "context.service"]: [], [stem + "context-admin-handler"]: [], OpenCreditCreateClientReconciliationPanel: [] };
  for (const root of ["src", "scripts"]) for (const file of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    const path = root + "/" + file.replace(/\\/g, "/"); if (!/\.[cm]?[jt]sx?$/.test(path) || /\.(test|integration)\./.test(path)) continue;
    const text = readFileSync(path, "utf8"), tree = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const scan = (n: ts.Node): void => {
      if (ts.isStringLiteralLike(n)) {
        if (n.text === "/api/admin/integrations/opencredit/create-client/reconciliation/context") assert.equal(path, component);
        for (const key of Object.keys(consumers)) if (new RegExp("(?:^|/)" + key.replace(/\./g, "\\.") + "(?:\\.[cm]?[jt]sx?)?$").test(n.text)) {
          const allowed = key === "OpenCreditCreateClientReconciliationPanel" ? "src/app/components/integrations/OpenCreditCreateClientPanel.tsx" : key.endsWith("admin-handler") ? route : handler;
          assert.equal(path, allowed); assert(ts.isImportDeclaration(n.parent)); consumers[key].push(path);
        }
      } ts.forEachChild(n, scan);
    }; scan(tree);
  }
  assert(Object.values(consumers).every(paths => paths.length === 1));
  assert.match(readFileSync(route, "utf8"), /export const runtime = "nodejs";[\s\S]*export const dynamic = "force-dynamic"/);
  assert.doesNotMatch(readFileSync(route, "utf8"), /provider-scope|Prisma|findMany/);
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  for (const gate of ["Validate OpenCredit createClient reconciliation review context", "Validate OpenCredit createClient reconciliation UI guards", "Validate OpenCredit createClient reconciliation context on disposable PostgreSQL"]) assert(ci.includes(gate));
});
