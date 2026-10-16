import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module from "node:module";
import { readFileSync } from "node:fs";
import * as ts from "typescript";
import type { OpenCreditIdentityUseInput, OpenCreditIdentityDecision, OpenCreditIdentityDenialReason, OpenCreditProviderScope, OpenCreditCommercialAccessSnapshot, OpenCreditRemoteIdentitySnapshot } from "./opencredit-commercial-identity-policy";

let scope: typeof import("./opencredit-commercial-identity-policy").parseOpenCreditProviderScope;
let cpfKey: typeof import("./opencredit-commercial-identity-policy").canonicalizeOpenCreditOwnershipCpf;
let evaluate: typeof import("./opencredit-commercial-identity-policy").evaluateOpenCreditIdentityUse;
let PolicyError: typeof import("./opencredit-commercial-identity-policy").OpenCreditCommercialIdentityPolicyError;
before(async () => {
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try {
    const policy = await import("./opencredit-commercial-identity-policy");
    scope = policy.parseOpenCreditProviderScope; cpfKey = policy.canonicalizeOpenCreditOwnershipCpf;
    evaluate = policy.evaluateOpenCreditIdentityUse; PolicyError = policy.OpenCreditCommercialIdentityPolicyError;
  } finally { loader._load = original; }
});
// Deliberately invalid, repeated-zero fictitious CPF. No customer identity is used.
const cpf = "00000000000";
const companyId = "company-fixture"; const contactId = "contact-fixture";
function facts(overrides: Partial<OpenCreditIdentityUseInput> = {}): OpenCreditIdentityUseInput {
  const providerScope = scope("shared-operation-v1");
  return { companyId, contactId, contactCpf: cpf, contactArchived: false, matchingContactCount: 1,
    providerScope, commercialAccess: { companyId, providerScope, enabled: true }, existingIdentity: null, ...overrides };
}
function identity(overrides: Partial<OpenCreditRemoteIdentitySnapshot> = {}): OpenCreditRemoteIdentitySnapshot {
  return { companyId, contactId, providerScope: scope("shared-operation-v1"), normalizedCpf: cpf, enabled: true, ...overrides };
}
function denial(input: OpenCreditIdentityUseInput, reason: OpenCreditIdentityDenialReason) {
  const result = evaluate(input); assert.deepEqual(result, { allowed: false, reason });
  assert.deepEqual(Object.keys(result), ["allowed", "reason"]);
  assert.doesNotMatch(JSON.stringify(result), /company-fixture|contact-fixture|00000000000|shared-operation-v1|private-fixture/);
}
function parsingError(fn: () => unknown, code: "INVALID_PROVIDER_SCOPE" | "INVALID_OWNERSHIP_CPF") {
  assert.throws(fn, error => {
    assert.ok(error instanceof PolicyError); assert.equal(error.code, code);
    assert.equal(error.message, `OPENCREDIT_COMMERCIAL_IDENTITY_${code}`);
    assert.deepEqual(Object.keys(error).sort(), ["code", "name"]); assert.equal("cause" in error, false);
    return true;
  });
}
for (const value of ["a", "shared-operation-v1", "scope-42", "a".repeat(64)]) test(`valid local scope length ${value.length}`, () => assert.equal(scope(value), value));
const invalidScopes = [null, undefined, 1, true, [], {}, "", " ", "a ", " a", "a\n", "a\t", "a\u0000", "á", "UPPER", "a_b", "a--b", "-a", "a-", "a.b", "https://fixture.invalid", "a/b", "a\\b", "fixture@example.invalid", "a:b", "Bearer fixture", "a".repeat(65), cpf, `scope-${cpf}`, "scope-000000000000"];
invalidScopes.forEach((value, index) => test(`invalid scope ${index} has fixed error`, () => parsingError(() => scope(value), "INVALID_PROVIDER_SCOPE")));
test("canonical CPF formats converge without checksum or changing the input", () => {
  const masked = "000.000.000-00"; assert.equal(cpfKey(cpf), cpf); assert.equal(cpfKey(masked), cpf); assert.equal(masked, "000.000.000-00");
});
const invalidCpfs = [null, undefined, 0, true, [], {}, "", "0000000000", "000000000000", "000.000000-00", "000000000-00", "000.000.00000", "000000.000-00", "000.00000000", "a00000000000", "00000000000a", " 00000000000", "00000000000 ", "00000000000\n", "00000000000\t", "+5500000000000", "CPF:00000000000", "000 000 000 00", "000.000.000-00suffix", "０００００００００００"];
invalidCpfs.forEach((value, index) => test(`invalid CPF ${index} is not repaired`, () => parsingError(() => cpfKey(value), "INVALID_OWNERSHIP_CPF")));
test("claim returns only the candidate key and trusted scope, not identifiers", () => {
  const result = evaluate(facts({ contactCpf: "000.000.000-00" }));
  assert.deepEqual(result, { allowed: true, action: "CLAIM", normalizedCpf: cpf, providerScope: scope("shared-operation-v1") });
});
test("exact enabled identity is reused", () => {
  assert.deepEqual(evaluate(facts({ existingIdentity: identity() })), { allowed: true, action: "REUSE", normalizedCpf: cpf, providerScope: scope("shared-operation-v1") });
});
test("commercial access missing", () => denial(facts({ commercialAccess: null }), "COMMERCIAL_ACCESS_MISSING"));
test("commercial access disabled", () => denial(facts({ commercialAccess: { ...facts().commercialAccess!, enabled: false } }), "COMMERCIAL_ACCESS_DISABLED"));
test("commercial scope mismatch", () => denial(facts({ commercialAccess: { ...facts().commercialAccess!, providerScope: scope("different-operation") } }), "COMMERCIAL_SCOPE_MISMATCH"));
test("commercial access from another Company can never authorize this Company", () => denial(facts({ commercialAccess: { ...facts().commercialAccess!, companyId: "other-company" } }), "COMMERCIAL_COMPANY_MISMATCH"));
test("contact archived", () => denial(facts({ contactArchived: true }), "CONTACT_ARCHIVED"));
for (const value of [null, undefined, ""]) test(`missing CPF ${String(value)}`, () => denial(facts({ contactCpf: value }), "CONTACT_CPF_MISSING"));
test("malformed contact CPF", () => denial(facts({ contactCpf: "garbage00000000000" }), "CONTACT_CPF_INVALID"));
for (const count of [0, 2, 3, 1_000_000]) test(`matching count ${count} cannot select a Contact`, () => denial(facts({ matchingContactCount: count }), "CONTACT_AMBIGUOUS"));
for (const count of [-1, 1.5, NaN, Infinity, -Infinity, 1_000_001, Number.MAX_SAFE_INTEGER]) test(`count ${count} outside the local bounded integer contract`, () => denial(facts({ matchingContactCount: count }), "INVALID_FACTS"));
const conflicts: [Partial<OpenCreditRemoteIdentitySnapshot>, OpenCreditIdentityDenialReason][] = [
  [{ providerScope: "different-operation" as OpenCreditProviderScope }, "IDENTITY_SCOPE_MISMATCH"],
  [{ companyId: "other-company" }, "IDENTITY_COMPANY_MISMATCH"],
  [{ contactId: "other-contact" }, "IDENTITY_CONTACT_MISMATCH"],
  [{ normalizedCpf: "11111111111" }, "IDENTITY_CPF_MISMATCH"],
  [{ normalizedCpf: "000.000.000-00" }, "IDENTITY_CPF_MISMATCH"],
  [{ enabled: false }, "IDENTITY_DISABLED"]
];
for (const [change, reason] of conflicts) test(`identity ${reason} denies without releasing ownership`, () => {
  const existing = Object.freeze(identity(change)); denial(facts({ existingIdentity: existing }), reason);
  assert.deepEqual(existing, identity(change));
});
test("CPF changes block; the old snapshot is not reassigned or freed", () => {
  const existing = Object.freeze(identity()); const input = Object.freeze(facts({ contactCpf: "111.111.111-11", existingIdentity: existing }));
  denial(input, "IDENTITY_CPF_MISMATCH"); assert.equal(existing.normalizedCpf, cpf); assert.equal(input.contactCpf, "111.111.111-11");
});
test("disabled binding never becomes a claim", () => {
  const result = evaluate(facts({ existingIdentity: identity({ enabled: false }) }));
  assert.deepEqual(result, { allowed: false, reason: "IDENTITY_DISABLED" }); assert.equal(Object.hasOwn(result, "action"), false);
});
test("only explicit null means absence; omitted/unresolved identity fails closed", () => {
  const input = facts() as unknown as Record<string, unknown>; delete input.existingIdentity;
  denial(input as unknown as OpenCreditIdentityUseInput, "INVALID_FACTS");
});
const malformed: ((input: OpenCreditIdentityUseInput) => unknown)[] = [
  input => ({ ...input, companyId: "" }), input => ({ ...input, contactId: "a\n" }),
  input => ({ ...input, contactArchived: "false" }), input => ({ ...input, contactArchived: undefined }),
  input => ({ ...input, matchingContactCount: "1" }),
  input => ({ ...input, commercialAccess: { ...input.commercialAccess, enabled: "true" } }),
  input => ({ ...input, commercialAccess: [] }),
  input => ({ ...input, existingIdentity: { ...identity(), enabled: "true" } }),
  input => ({ ...input, existingIdentity: undefined }), input => ({ ...input, existingIdentity: false }),
  input => ({ ...input, existingIdentity: [] })
];
malformed.forEach((change, index) => test(`malformed resolved facts ${index} never authorize`, () => denial(change(facts()) as OpenCreditIdentityUseInput, "INVALID_FACTS")));
test("invalid scope produces a denial, not an exception or an echoed value", () => {
  denial(facts({ providerScope: "https://private-fixture.invalid" as OpenCreditProviderScope }), "PROVIDER_SCOPE_INVALID");
});
test("deterministic precedence: scope then access then Contact then identity", () => {
  denial(facts({ providerScope: "invalid/scope" as OpenCreditProviderScope, commercialAccess: null }), "PROVIDER_SCOPE_INVALID");
  denial(facts({ commercialAccess: null, contactArchived: true, contactCpf: null }), "COMMERCIAL_ACCESS_MISSING");
  denial(facts({ commercialAccess: { ...facts().commercialAccess!, enabled: false, providerScope: scope("other-scope") } }), "COMMERCIAL_ACCESS_DISABLED");
  denial(facts({ contactArchived: true, contactCpf: null }), "CONTACT_ARCHIVED");
  denial(facts({ contactCpf: null, matchingContactCount: 2 }), "CONTACT_CPF_MISSING");
  denial(facts({ matchingContactCount: 2, existingIdentity: identity({ enabled: false }) }), "CONTACT_AMBIGUOUS");
  denial(facts({ existingIdentity: identity({ companyId: "other", contactId: "other", enabled: false }) }), "IDENTITY_COMPANY_MISMATCH");
});
test("fresh results, frozen input and snapshots remain unchanged", () => {
  const input = Object.freeze(facts({ commercialAccess: Object.freeze(facts().commercialAccess!), existingIdentity: Object.freeze(identity()) }));
  const snapshot = JSON.stringify(input); const first = evaluate(input); const second = evaluate(input);
  assert.deepEqual(first, second); assert.notEqual(first, second); assert.equal(JSON.stringify(input), snapshot);
});
test("caller getter failures are converted to a fixed denial without retaining cause", () => {
  const input = { ...facts(), get contactCpf(): never { throw Error("private-fixture"); } };
  denial(input, "INVALID_FACTS");
});
test("server-only module has no external runtime dependency or unrelated authority concepts", () => {
  const source = readFileSync(new URL("./opencredit-commercial-identity-policy.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("policy.ts", source, ts.ScriptTarget.Latest, true); const imports: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) imports.push((node.moduleSpecifier as ts.StringLiteral).text);
    assert.equal(ts.isImportEqualsDeclaration(node), false);
    if (ts.isExportDeclaration(node)) assert.equal(node.moduleSpecifier, undefined);
    if (ts.isCallExpression(node)) assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.deepEqual(imports, ["server-only"]);
  assert.doesNotMatch(source, /opencredit-api-client|contacts\.ts|\b(?:fetch|XMLHttpRequest|process|prisma|console|require|localStorage|setTimeout|setInterval)\b|node:|https?:\/\//);
  assert.doesNotMatch(source, /webhook|partnerId|tenantId|password|bearer|credentials|consent|\b(?:ADMIN|SUPERVISOR|AGENT|ACTIVE|PAUSED|DISABLED)\b/);
});
// Type-level restrictions are checked by tsc, not executed.
if (false) {
  // @ts-expect-error Scope strings need the dedicated parser.
  const rawScope: OpenCreditProviderScope = "unparsed";
  // @ts-expect-error No unrelated authority flag belongs in an access snapshot.
  const access: OpenCreditCommercialAccessSnapshot = { companyId, providerScope: rawScope, enabled: true, webhookStatus: "ACTIVE" };
  // @ts-expect-error Identity snapshots are not evidence of consent.
  const binding: OpenCreditRemoteIdentitySnapshot = { ...identity(), consent: true };
  // @ts-expect-error All facts, including explicit identity absence, must be supplied.
  const incomplete: OpenCreditIdentityUseInput = { companyId, contactId };
  const result = {} as OpenCreditIdentityDecision;
  if (!result.allowed) {
    // @ts-expect-error Denials never carry a CPF.
    void result.normalizedCpf;
  }
  void [access, binding, incomplete];
}
