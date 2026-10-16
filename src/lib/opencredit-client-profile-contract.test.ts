import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module from "node:module";
import { readFileSync } from "node:fs";
import * as ts from "typescript";
import type { OpenCreditClientProfilePayload, OpenCreditClientProfileResult } from "./opencredit-client-profile-contract";

let build: typeof import("./opencredit-client-profile-contract").buildOpenCreditClientProfilePayload;
let parse: typeof import("./opencredit-client-profile-contract").parseOpenCreditClientProfileResult;
let ContractError: typeof import("./opencredit-client-profile-contract").OpenCreditClientProfileContractError;
before(async () => {
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try {
    const contract = await import("./opencredit-client-profile-contract");
    build = contract.buildOpenCreditClientProfilePayload; parse = contract.parseOpenCreditClientProfileResult;
    ContractError = contract.OpenCreditClientProfileContractError;
  } finally { loader._load = original; }
});

// Intentionally fictitious identity: repeated-zero CPF is not mathematically valid.
const cpf = "00000000000";
const fixture: OpenCreditClientProfilePayload = {
  cpf, nome: " Pessoa Fictícia Áç漢字 ", data_nascimento: "29/02/2000", celular: "+55 (00) 00000-0000",
  nome_mae: " Pessoa Fictícia Dois ", email: "fixture@example.invalid", rg: "RG-ficticio",
  orgao_emissor: " SSP ", uf_emissor: "uf-futura", data_expedicao: "2005-03-15",
  genero: "F", estado_civil: "1", endereco_cep: "00000-000", endereco_rua: " Rua Fictícia ",
  endereco_numero: "0007A", endereco_complemento: " complemento ", endereco_bairro: " bairro ",
  endereco_cidade: " cidade ", endereco_uf: "uf-futura"
};
const fields = Object.keys(fixture) as (keyof OpenCreditClientProfilePayload)[];
function invalidInput(value: unknown) {
  assert.throws(() => build(value), error => {
    assert.ok(error instanceof ContractError); assert.equal(error.code, "INVALID_INPUT");
    assert.equal(error.message, "OPENCREDIT_CLIENT_PROFILE_INVALID_INPUT");
    assert.equal("cause" in error, false); return true;
  });
}
function invalidResponse(value: unknown) {
  assert.throws(() => parse(value), error => {
    assert.ok(error instanceof ContractError); assert.equal(error.code, "INVALID_RESPONSE");
    assert.equal(error.message, "OPENCREDIT_CLIENT_PROFILE_INVALID_RESPONSE");
    assert.equal("cause" in error, false); return true;
  });
}
test("only CPF is required, all optionals stay absent, output is fresh", () => {
  const input = Object.freeze({ cpf }); const output = build(input);
  assert.deepEqual(output, { cpf }); assert.notEqual(output, input);
  assert.deepEqual(Object.keys(output), ["cpf"]);
  for (const key of fields.filter(k => k !== "cpf")) assert.equal(Object.hasOwn(output, key), false);
});
test("all 19 properties survive exactly without mutation or normalization", () => {
  assert.equal(fields.length, 19);
  const input = Object.freeze({ ...fixture }); const output = build(input);
  assert.deepEqual(output, fixture); assert.notEqual(output, input); assert.deepEqual(input, fixture);
  output.nome = "different fixture"; assert.equal(input.nome, fixture.nome);
  assert.deepEqual(build(input), fixture);
});
for (const value of [cpf, "000.000.000-00", "not-a-CPF", " 000.000.000-00 "]) test(`CPF safety-only policy case ${value.length}`, () => {
  assert.deepEqual(build({ cpf: value }), { cpf: value });
});
for (const { index, value } of [null, undefined, [], "text", 42, true, false, Symbol("fixture"), BigInt(1), new Date(0), new String("fixture")].map((value, index) => ({ index, value }))) test(`invalid root ${index}`, () => invalidInput(value));
test("missing CPF is invalid", () => invalidInput({ nome: "Fictitious" }));
const badValues = [undefined, null, true, false, 0, 1, [], {}, "", " ", "\u00a0", "bad\u0000text", "bad\ntext", "bad\rtext", "bad\ttext", "bad\u007ftext", "bad\u0085text"];
for (const field of fields) {
  badValues.forEach((value, index) => test(`field ${field}: invalid type/empty/control ${index}`, () => invalidInput({ cpf, [field]: value })));
  test(`field ${field}: oversize rejected`, () => invalidInput({ cpf, [field]: "a".repeat(field === "cpf" ? 33 : 1025) }));
}
test("local CPF cap 32 preserves boundary; no mathematical validation", () => {
  const value = "x".repeat(32); assert.equal(build({ cpf: value }).cpf, value);
});
for (const field of fields.filter(k => !["cpf", "data_nascimento", "genero", "estado_civil"].includes(k))) test(`generous local boundary 1024 for ${field}`, () => {
  const value = "Á".repeat(1024); assert.equal(build({ cpf, [field]: value })[field], value);
});
for (const field of fields) test(`optional presence uses own data property: ${field}`, () => {
  const input = { cpf }; let called = false;
  Object.defineProperty(input, field, { enumerable: true, get() { called = true; throw Error("private-fixture-value"); } });
  invalidInput(input); assert.equal(called, false);
});
test("only plain or null-prototype objects, no inherited CPF/unknown data", () => {
  invalidInput(Object.create({ cpf }));
  invalidInput(Object.assign(Object.create({ partnerId: "private-fixture" }), { cpf }));
  assert.deepEqual(build(Object.assign(Object.create(null), { cpf })), { cpf });
});
test("nonenumerable and symbol request keys cannot bypass the whitelist", () => {
  const extra = { cpf }; Object.defineProperty(extra, "tenantId", { value: "private-fixture" }); invalidInput(extra);
  const hidden = {}; Object.defineProperty(hidden, "cpf", { value: cpf }); invalidInput(hidden);
  invalidInput({ cpf, [Symbol("extra")]: "private-fixture" });
});
for (const key of ["partnerId", "tenantId", "companyId", "authorization", "Authorization", "url", "path", "method", "headers", "requestId", "creditProfile", "barriers", "__proto__", "constructor", "unknown"]) test(`extra request key ${key} fails closed`, () => {
  const input = Object.assign(Object.create(null), { cpf });
  Object.defineProperty(input, key, { enumerable: true, value: "private-fixture" }); invalidInput(input);
});
test("JSON-owned __proto__ cannot mutate output or global prototypes", () => {
  invalidInput(JSON.parse('{"cpf":"00000000000","__proto__":{"polluted":true}}'));
  assert.equal(Object.getPrototypeOf(build({ cpf })), Object.prototype);
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
});
test("serialized JSON is not accepted; duplicate-key detection belongs before object conversion", () => {
  invalidInput('{"cpf":"00000000000","cpf":"000.000.000-00"}');
});
for (const genero of ["M", "F"] as const) test(`formal genero ${genero}`, () => assert.equal(build({ cpf, genero }).genero, genero));
for (const genero of ["m", "f", "Masculino", "Feminino", " M", "F ", "X"]) test(`invalid formal genero ${genero}`, () => invalidInput({ cpf, genero }));
for (const estado_civil of ["1", "2", "3", "4"]) test(`local marital allowlist ${estado_civil}`, () => assert.equal(build({ cpf, estado_civil }).estado_civil, estado_civil));
for (const estado_civil of ["0", "5", "Casado", "01", " 1", "1 ", 1]) test(`invalid local marital choice ${String(estado_civil)}`, () => invalidInput({ cpf, estado_civil }));
for (const value of ["15/03/1985", "99/99/0000", "31/02/2026"]) test(`birth date structural only ${value}`, () => assert.equal(build({ cpf, data_nascimento: value }).data_nascimento, value));
for (const value of ["1985-03-15", "1/03/1985", "15/3/1985", "15/03/85", " 15/03/1985", "15/03/1985 ", "15/03/1985T00:00:00Z"]) test(`invalid birth structure ${value}`, () => invalidInput({ cpf, data_nascimento: value }));
for (const value of ["15/03/2005", "2005-03-15", "provider-format-not-declared"]) test(`issue date has no invented format ${value}`, () => assert.equal(build({ cpf, data_expedicao: value }).data_expedicao, value));
test("phone/email/postcode/UF/house number never acquire inferred formats", () => {
  const input = { cpf, celular: " +55 (00) 00000-0000 ", email: "not-an-email", endereco_cep: "00000-000", uf_emissor: "xx", endereco_uf: "UF-FUTURA", endereco_numero: "0000A" };
  assert.deepEqual(build(input), input);
  invalidInput({ cpf, endereco_numero: 10 });
});
for (const success of [false, true]) for (const created of [false, true]) test(`response booleans ${success}/${created}, no invented contradiction`, () => {
  const data = Object.freeze({ success, created }); const input = Object.freeze({ data });
  const result = parse(input); assert.deepEqual(result, data); assert.notEqual(result, data); assert.notEqual(result, input);
});
for (const { index, value } of [null, undefined, [], "text", 1, false, {}, { data: null }, { data: [] }, { data: "text" }, { data: {} }, { success: true, created: true }].map((value, index) => ({ index, value }))) test(`invalid response envelope ${index}`, () => invalidResponse(value));
for (const field of ["success", "created"]) for (const { index, value } of [undefined, null, "true", "false", 0, 1, [], {}].map((value, index) => ({ index, value }))) test(`invalid response boolean ${field}/${index}`, () => {
  invalidResponse({ data: { success: true, created: true, [field]: value } });
});
for (const field of ["success", "created"] as const) test(`missing response own ${field}`, () => {
  const data: Partial<OpenCreditClientProfileResult> = { success: true, created: false }; delete data[field]; invalidResponse({ data });
});
test("response extras are discarded, getters/PII/raw objects never read or returned", () => {
  const extras = { requestId: "private-fixture", cpf, client: fixture, creditProfile: fixture, barriers: [fixture], metadata: fixture,
    message: "private-fixture", error: fixture, headers: fixture, url: "https://fixture.invalid", accessToken: "private-fixture", refreshToken: "private-fixture" };
  const data = Object.freeze({ ...extras, success: false, created: true });
  const input = { ...extras, data, get unknown() { throw Error("must not be read"); } };
  const result = parse(input); assert.deepEqual(result, { success: false, created: true });
  assert.deepEqual(Object.keys(result), ["success", "created"]);
  assert.notEqual(result, data); assert.doesNotMatch(JSON.stringify(result), /private-fixture|requestId|client|creditProfile|barriers|https/);
});
test("inherited flags and response getters fail without executing accessors", () => {
  invalidResponse({ data: Object.create({ success: true, created: true }) });
  for (const key of ["data", "success", "created"]) {
    let called = false; const data = { success: true, created: false }; const root = { data };
    Object.defineProperty(key === "data" ? root : data, key, { enumerable: true, get() { called = true; throw Error("private-fixture"); } });
    invalidResponse(root); assert.equal(called, false);
  }
});
test("throwing proxy errors are replaced, with no original exception/PII retained", () => {
  invalidInput(new Proxy({}, { ownKeys() { throw Error("private-fixture"); } }));
  invalidResponse(new Proxy({}, { getOwnPropertyDescriptor() { throw Error("private-fixture"); } }));
});
test("server-only public marker, no other runtime imports or network/env/database/persistence APIs", () => {
  const source = readFileSync(new URL("./opencredit-client-profile-contract.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("contract.ts", source, ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) imports.push((node.moduleSpecifier as ts.StringLiteral).text);
    assert.equal(ts.isImportEqualsDeclaration(node), false);
    if (ts.isExportDeclaration(node)) assert.equal(node.moduleSpecifier, undefined);
    if (ts.isCallExpression(node)) {
      assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword);
      assert.notEqual(node.expression.getText(ast), "require");
    }
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.deepEqual(imports, ["server-only"]);
  assert.doesNotMatch(source, /opencredit-api-client|OpenCreditConnectionError|\b(?:fetch|XMLHttpRequest|process|prisma|console|localStorage|sessionStorage|setTimeout|setInterval|Buffer)\b|node:|https?:\/\//);
});
// Strict type regressions, never executed.
if (false) {
  // @ts-expect-error CPF is required on a sanitized payload.
  const missing: OpenCreditClientProfilePayload = {};
  // @ts-expect-error The provider enum is not an arbitrary string.
  const invalidGender: OpenCreditClientProfilePayload = { cpf, genero: "m" };
  // @ts-expect-error Number is not a valid house-number string.
  const invalidNumber: OpenCreditClientProfilePayload = { cpf, endereco_numero: 10 };
  // @ts-expect-error No tenant credential/control fields belong in the DTO.
  const extra: OpenCreditClientProfilePayload = { cpf, tenantId: "fixture" };
  // @ts-expect-error Sanitized result has boolean flags only.
  const invalidResult: OpenCreditClientProfileResult = { success: "true", created: false };
  void [missing, invalidGender, invalidNumber, extra, invalidResult];
}
