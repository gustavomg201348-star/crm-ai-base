import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import * as ts from "typescript";
import { authorizationErrorMessage, authorizationEvidenceView, isAuthorizationMutationResponse, parseAuthorizationContext } from "./opencredit-consumer-authorization-ui";
const context = () => ({ ok: true as const, authorization: { exists: true, active: true, revision: 0, evidenceInboundEventId: "evidence", evidenceMessageId: "message" }, evidenceCandidates: [{ inboundEventId: "evidence", messageId: "message" }] });
test("valid closed context preserved", () => { assert.deepEqual(parseAuthorizationContext(context()), context()); });
for (const v of [null, [], 1, true, "sensitive", {}, { ...context(), body: "sensitive" }, { ...context(), ok: false }, { ...context(), authorization: { ...context().authorization, providerScope: "sensitive" } },
  { ...context(), evidenceCandidates: [{ inboundEventId: "x", messageId: "x", body: "sensitive" }] }, { ...context(), evidenceCandidates: Array(51).fill(context().evidenceCandidates[0]) },
  ...[null, false, 4, "", "x\n", "é"].map(inboundEventId => ({ ...context(), evidenceCandidates: [{ inboundEventId, messageId: "message" }] })),
  ...[-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "1"].map(revision => ({ ...context(), authorization: { ...context().authorization, revision } })),
  { ...context(), evidenceCandidates: [...context().evidenceCandidates, ...context().evidenceCandidates] }, { ...context(), authorization: { exists: false, active: true, revision: null, evidenceInboundEventId: null, evidenceMessageId: null } }]) {
  test("reject malformed/extra fields " + JSON.stringify(v).slice(0, 90), () => { assert.equal(parseAuthorizationContext(v), null); });
}
test("no-op/null mutation contract valid and closed", () => {
  for (const r of [{ ok: true, changed: true, authorizationId: "id", active: true, revision: 0 }, { ok: true, changed: false, authorizationId: null, active: false, revision: null }]) {
    assert(isAuthorizationMutationResponse(r)); assert(!isAuthorizationMutationResponse({ ...r, body: "sensitive" }));
  }
  for (const r of [null, {}, { ok: true, changed: true, authorizationId: null, active: true, revision: 1 }, { ok: true, changed: true, authorizationId: "x", active: true, revision: -1 }]) assert(!isAuthorizationMutationResponse(r));
});
test("join only server candidates by messageId, never invent text/event", () => {
  const m = { id: "message", direction: "inbound", body: "não autorizo", type: "text", createdAt: "2026-10-19T12:00:00Z" };
  assert.deepEqual(authorizationEvidenceView(context(), [m, { ...m, id: "unselected" }]), [{ inboundEventId: "evidence", messageId: "message", body: m.body, createdAt: m.createdAt, current: true }]);
  assert.deepEqual(authorizationEvidenceView(context(), []), []);
  assert.equal(authorizationEvidenceView({ ...context(), authorization: { ...context().authorization, active: false } }, [m])[0].current, false);
});
for (const code of ["AUTHORIZATION_CONFLICT", "CONTACT_ARCHIVED", "COMMERCIAL_ACCESS_MISSING", "COMMERCIAL_ACCESS_DISABLED", "IDENTITY_NOT_FOUND", "EVIDENCE_UNSUPPORTED", "CONCURRENT_CONFLICT"]) {
  test("closed human error " + code, () => { const text = authorizationErrorMessage({ error: "OPENCREDIT_CONSUMER_AUTHORIZATION_" + code }); assert(!text.includes(code)); assert.notEqual(text, authorizationErrorMessage(null)); });
}
test("unknown/raw error and accessors do not leak", () => {
  for (const value of [{ error: "sensitive body password" }, { error: "toString" }, { error: "__proto__" }, { error: "RATE_LIMITED", body: "sensitive" }, Object.defineProperty({}, "error", { get() { assert.fail("accessor invoked"); } })]) assert.equal(authorizationErrorMessage(value), authorizationErrorMessage(null));
});
test("client-safe helper imports/exports and zero domain/network/env", () => {
  const source = readFileSync("src/lib/opencredit-consumer-authorization-ui.ts", "utf8");
  assert.doesNotMatch(source, /\bimport\b|server-only|Prisma|process\.env|fetch\(|provider-scope-resolver|console\.|opencredit-api-client/);
});
test("UI guard: exactly three local endpoints, human-only actions, no automatic mutation", () => {
  const source = readFileSync("src/app/components/integrations/OpenCreditConsumerAuthorizationPanel.tsx", "utf8");
  assert.match(source, /^"use client"/); assert.doesNotMatch(source, /opencredit-api-client|CommercialOperation|prepareOpenCredit|reserveOpenCredit|OpenAI|chatbot|providerScope|providerMessageId|cpf|dangerouslySetInnerHTML|setInterval|setTimeout/);
  const ast = ts.createSourceFile("panel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.deepEqual(ast.statements.filter(ts.isImportDeclaration).map(n => (n.moduleSpecifier as ts.StringLiteral).text), ["react", "@/lib/opencredit-consumer-authorization-ui", "./OpenCreditCreateClientPanel", "./OpenCreditClientValidationPanel"]);
  const calls: ts.CallExpression[] = []; const visit = (n: ts.Node) => { if (ts.isCallExpression(n)) calls.push(n); ts.forEachChild(n, visit); }; visit(ast);
  for (const c of calls.filter(c => c.expression.getText(ast) === "useEffect")) assert.doesNotMatch(c.getText(ast), /mutate|grant|revoke/);
  const mutations = calls.filter(c => c.expression.getText(ast) === "mutate"); assert.equal(mutations.length, 2);
  for (const call of mutations) { assert(["\"grant\"", "\"revoke\""].includes(call.arguments[0].getText(ast))); let n: ts.Node | undefined = call; while (n && !ts.isJsxAttribute(n)) n = n.parent; assert(n && ts.isJsxAttribute(n)); assert.equal(n.name.getText(ast), "onClick"); }
  assert.match(source, /fetch\(base \+ "\/context"/); assert.match(source, /fetch\(base \+ \(action === "grant" \? "\/grant" : "\/revoke"\)/);
  assert.match(source, /key=\{JSON\.stringify\(\[props.companyId, props.contactId, props.conversationId\]\)\}/);
  assert.match(source, /sequence.current\+\+; controller.current\?\.abort\(\)/);
  assert.equal((source.match(/abort.signal.aborted \|\| sequence.current !== epoch/g) ?? []).length, 4);
  assert.match(source, /inboundEventId: candidate!\.inboundEventId/); assert.doesNotMatch(source, /inboundEventId:.*messageId/);
  assert.match(source, /window.confirm/); assert.match(source, /!candidate \|\| !confirmed \|\| context.authorization.active/);
  assert.match(source, /if \(!props.enabled\) return null/); assert.match(source, /response.status === 401 \|\| response.status === 403/);
  assert.match(source, /isAuthorizationMutationResponse\(raw\)\) \{ await load\(\)/);
  for (const tag of Array.from(source.matchAll(/<button\b([^>]+)>/g))) assert.match(tag[1], /type="button"/);
  assert.match(source, /role="status"/); assert.match(source, /role="alert"/);
});
test("page only mounts shared detail panel; general conversation mapper/types remain private", () => {
  const page = readFileSync("src/app/page.tsx", "utf8"); assert.match(page, /canAttemptOpenCreditAuthorization=\{session.user.role === "ADMIN"\}/);
  assert.equal((page.match(/<OpenCreditConsumerAuthorizationPanel/g) ?? []).length, 1);
  assert.match(page, /renderDetailsPanelContent\(\{ allowCollapse: false \}\)/); assert.match(page, /renderDetailsPanelContent\(\{ allowCollapse: true \}\)/);
  assert.doesNotMatch(page, /inboundEventId/);
  const mapper = readFileSync("src/lib/conversations.ts", "utf8"); assert.doesNotMatch(mapper, /inboundEventId/);
});
