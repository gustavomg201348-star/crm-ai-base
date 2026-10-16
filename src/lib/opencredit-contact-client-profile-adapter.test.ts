import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import * as ts from "typescript";
import type { OpenCreditContactClientProfileInput, OpenCreditContactClientProfileAdapterCode } from "./opencredit-contact-client-profile-adapter";

let adapter: typeof import("./opencredit-contact-client-profile-adapter");
before(async () => {
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try { adapter = await import("./opencredit-contact-client-profile-adapter"); } finally { loader._load = original; }
});
// Fictitious snapshots only; repeated-digit CPF is mathematically invalid.
function fixture(): OpenCreditContactClientProfileInput {
  return { contact: { id: "synthetic-contact", companyId: "synthetic-company", name: " Pessoa Fictícia Áç漢字 ", phone: " (00) 00000-0000 ", email: " Fixture@Example.Invalid ", cpf: "00000000000", archivedAt: null },
    identity: { companyId: "synthetic-company", contactId: "synthetic-contact", providerScope: "synthetic-adapter" as OpenCreditContactClientProfileInput["identity"]["providerScope"], normalizedCpf: "00000000000", enabled: true } };
}
const build = (input: unknown) => adapter.buildOpenCreditClientProfileFromContact(input);
function denied(input: unknown, code: OpenCreditContactClientProfileAdapterCode) {
  assert.throws(() => build(input), error => {
    assert.ok(error instanceof adapter.OpenCreditContactClientProfileAdapterError);
    assert.equal(error.code, code); assert.equal(error.message, "OPENCREDIT_CONTACT_CLIENT_PROFILE_" + code);
    assert.equal(error.name, "OpenCreditContactClientProfileAdapterError"); assert.equal("cause" in error, false);
    assert.deepEqual(Object.keys(error).sort(), ["code", "name"]);
    assert.doesNotMatch(error.message + error.stack + JSON.stringify(error), /00000000000|synthetic-company|synthetic-contact|synthetic-adapter|Fictícia|Fixture@|private-fixture/);
    return true;
  });
}
test("exact four-field payload from valid enabled snapshots, preserving text/phone/email", () => {
  const f = fixture(); const out = build(f);
  assert.deepEqual(out, { cpf: f.identity.normalizedCpf, nome: f.contact.name, celular: f.contact.phone, email: f.contact.email });
  assert.deepEqual(Object.keys(out), ["cpf", "nome", "celular", "email"]);
  assert.equal(out.nome!.startsWith(" "), true); assert.equal(out.nome!.endsWith(" "), true);
  assert.equal(out.celular!.includes("+55"), false); assert.equal(out.email, " Fixture@Example.Invalid ");
});
test("null email is truly omitted, never empty string", () => {
  const f = fixture(); const out = build({ ...f, contact: { ...f.contact, email: null } });
  assert.deepEqual(out, { cpf: f.identity.normalizedCpf, nome: f.contact.name, celular: f.contact.phone }); assert.equal(Object.hasOwn(out, "email"), false);
});
for (const cpf of ["00000000000", "000.000.000-00"]) test("strict supported CPF shape " + cpf.length + " maps canonical snapshot", () => {
  const f = fixture(); assert.equal(build({ ...f, contact: { ...f.contact, cpf } }).cpf, f.identity.normalizedCpf);
});
test("snapshot mismatch fails without repair", () => { const f = fixture(); denied({ ...f, identity: { ...f.identity, normalizedCpf: "11111111111" } }, "IDENTITY_SNAPSHOT_MISMATCH"); });
test("archived Contact fails", () => { const f = fixture(); denied({ ...f, contact: { ...f.contact, archivedAt: new Date(0) } }, "CONTACT_ARCHIVED"); });
test("disabled identity fails; enabled is not dispatch permission", () => { const f = fixture(); denied({ ...f, identity: { ...f.identity, enabled: false } }, "IDENTITY_DISABLED"); });
test("Company mismatch fails", () => { const f = fixture(); denied({ ...f, identity: { ...f.identity, companyId: "synthetic-other" } }, "IDENTITY_COMPANY_MISMATCH"); });
test("Contact mismatch fails", () => { const f = fixture(); denied({ ...f, identity: { ...f.identity, contactId: "synthetic-other" } }, "IDENTITY_CONTACT_MISMATCH"); });
for (const value of [null, undefined, "", " ", "BAD", "bad_scope", "synthetic-00000000000", 1, true, {}, []]) test("invalid scope type/shape " + typeof value + ":" + String(value).length, () => {
  const f = fixture(); denied({ ...f, identity: { ...f.identity, providerScope: value } }, "INVALID_PROVIDER_SCOPE");
});
for (const cpf of [null, ""]) test("missing CPF case " + (cpf === null ? "null" : "empty"), () => { const f = fixture(); denied({ ...f, contact: { ...f.contact, cpf } }, "CONTACT_CPF_MISSING"); });
for (const cpf of [undefined, " 00000000000", "00000000000 ", "000 000 000 00", "000/000/000-00", "000.000.000-00\n", "x00000000000", 0, false, {}, []]) test("invalid CPF type/shape " + typeof cpf + ":" + String(cpf).length, () => { const f = fixture(); denied({ ...f, contact: { ...f.contact, cpf } }, "CONTACT_CPF_INVALID"); });
for (const value of [null, undefined, "000.000.000-00", " 00000000000", "00000000000\n", "0000000000", "000000000000", 0, true, {}, []]) test("snapshot requires exact eleven digits " + typeof value + ":" + String(value).length, () => { const f = fixture(); denied({ ...f, identity: { ...f.identity, normalizedCpf: value } }, "INVALID_IDENTITY"); });
for (const enabled of [null, undefined, "true", "false", 0, 1, [], {}]) test("enabled never coerced " + typeof enabled + ":" + String(enabled).length, () => { const f = fixture(); denied({ ...f, identity: { ...f.identity, enabled } }, "INVALID_IDENTITY"); });
for (const key of ["id", "companyId"] as const) for (const value of ["", " bad", "bad/route", "bad\n", "a".repeat(129), null, 1]) test("Contact strict ID " + key + ":" + typeof value + String(value).length, () => { const f = fixture(); denied({ ...f, contact: { ...f.contact, [key]: value } }, "INVALID_CONTACT"); });
for (const key of ["companyId", "contactId"] as const) test("identity ID invalid " + key, () => { const f = fixture(); denied({ ...f, identity: { ...f.identity, [key]: "bad/route" } }, "INVALID_IDENTITY"); });
for (const value of [undefined, false, 0, "", "2026-10-16", new Date(NaN), {}]) test("invalid archivedAt fails closed " + typeof value, () => { const f = fixture(); denied({ ...f, contact: { ...f.contact, archivedAt: value } }, "INVALID_CONTACT"); });
for (const key of ["name", "phone", "email"]) for (const value of [undefined, "", " ", "\t", "private-fixture\n", "a".repeat(1025), 1, false, [], {}]) test("existing builder alone rejects mapped " + key + ":" + typeof value + String(value).length, () => { const f = fixture(); denied({ ...f, contact: { ...f.contact, [key]: value } }, "PROFILE_INVALID"); });
test("local builder technical semantics unchanged: no invented email/phone format validator", () => {
  const f = fixture(); assert.deepEqual(build({ ...f, contact: { ...f.contact, email: "not-an-email", phone: "0007A" } }), { cpf: "00000000000", nome: f.contact.name, celular: "0007A", email: "not-an-email" });
});
test("frozen input is untouched; fresh output never shares mutable references", () => {
  const f = fixture(); Object.freeze(f.contact); Object.freeze(f.identity); Object.freeze(f);
  const first = build(f); const second = build(f); assert.deepEqual(first, second); assert.notEqual(first, second);
  assert.notEqual(first, f); assert.notEqual(first, f.contact); assert.notEqual(first, f.identity);
  first.nome = "Changed output"; assert.equal(second.nome, f.contact.name); assert.equal(build(f).nome, f.contact.name);
});
const missingFields = ["data_nascimento", "nome_mae", "rg", "orgao_emissor", "uf_emissor", "data_expedicao", "genero", "estado_civil", "endereco_cep", "endereco_rua", "endereco_numero", "endereco_complemento", "endereco_bairro", "endereco_cidade", "endereco_uf"];
test("none of the other fifteen provider fields is invented", () => { const out = build(fixture()); assert.equal(missingFields.length, 15); for (const k of missingFields) assert.equal(Object.hasOwn(out, k), false); });
for (const [index, value] of Array.from([null, undefined, [], false, 1, "json", new Date(0), new String("fixture")].entries())) test("invalid root " + index, () => denied(value, "INVALID_INPUT"));
for (const section of ["contact", "identity"] as const) for (const value of [null, undefined, [], false, 1, "text", new Date(0)]) test("invalid nested " + section + ":" + typeof value, () => denied({ ...fixture(), [section]: value }, section === "contact" ? "INVALID_CONTACT" : "INVALID_IDENTITY"));
for (const section of ["root", "contact", "identity"] as const) test("all accessors rejected without invoking getters: " + section, () => {
  const template = fixture(); const keys = section === "root" ? Object.keys(template) : Object.keys(template[section]);
  for (const key of keys) {
    const f = fixture(); let called = false; const target = section === "root" ? f : f[section];
    Object.defineProperty(target, key, { enumerable: true, get() { called = true; throw Error("private-fixture"); } });
    denied(f, section === "root" ? "INVALID_INPUT" : section === "contact" ? "INVALID_CONTACT" : "INVALID_IDENTITY"); assert.equal(called, false);
  }
});
for (const section of ["root", "contact", "identity"] as const) test("inherited, missing, hidden, symbol and unknown fields fail: " + section, () => {
  const code = section === "root" ? "INVALID_INPUT" : section === "contact" ? "INVALID_CONTACT" : "INVALID_IDENTITY";
  for (const mode of ["inherited", "missing", "hidden", "symbol", "extra", "hidden-extra"]) {
    const f = fixture(); const target = section === "root" ? f : f[section]; const key = Object.keys(target)[0];
    let changed: unknown;
    if (mode === "inherited") changed = Object.assign(Object.create({ inherited: "private-fixture" }), target);
    else {
      changed = { ...target };
      if (mode === "missing") Reflect.deleteProperty(changed as object, key);
      if (mode === "hidden") Object.defineProperty(changed, key, { value: Reflect.get(target, key), enumerable: false });
      if (mode === "symbol") Object.defineProperty(changed, Symbol("extra"), { value: "private-fixture", enumerable: true });
      if (mode === "extra" || mode === "hidden-extra") Object.defineProperty(changed, "unknown", { value: "private-fixture", enumerable: mode === "extra" });
    }
    denied(section === "root" ? changed : { ...f, [section]: changed }, code);
  }
});
test("null-prototype own data snapshots accepted", () => {
  const f = fixture(); assert.deepEqual(build(Object.assign(Object.create(null), { contact: Object.assign(Object.create(null), f.contact), identity: Object.assign(Object.create(null), f.identity) })), build(f));
});
for (const key of ["tenantId", "partnerId", "credentials", "token", "consent", "bankId", "simulation", "proposal", "remoteClientId", "__proto__", "constructor"]) test("closed root rejects forbidden field " + key, () => {
  const f = fixture(); Object.defineProperty(f, key, { value: "private-fixture", enumerable: true }); denied(f, "INVALID_INPUT");
});
test("raw JSON not accepted; duplicate-key detection is not claimed after parsing", () => denied('{"contact":{},"contact":{},"identity":{}}', "INVALID_INPUT"));
test("hostile exceptions never escape, including thrown proxies and injected AdapterError", () => {
  const hostile = new Proxy({}, { getPrototypeOf() { throw Error("private-fixture"); } });
  for (const error of [Error("private-fixture"), hostile, Object.assign(new adapter.OpenCreditContactClientProfileAdapterError("INVALID_INPUT"), { message: "private-fixture", cause: "private-fixture" })]) {
    const value = new Proxy({}, { getPrototypeOf() { throw error; } }); denied(value, "INVALID_INPUT");
  }
});
test("public server-only marker, exact exports, only pure imports and no runtime caller", () => {
  const source = readFileSync(new URL("./opencredit-contact-client-profile-adapter.ts", import.meta.url), "utf8");
  assert.match(source, /^import "server-only";/);
  const ast = ts.createSourceFile("adapter.ts", source, ts.ScriptTarget.Latest, true); const imports: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) imports.push((node.moduleSpecifier as ts.StringLiteral).text);
    assert.equal(ts.isImportEqualsDeclaration(node), false);
    if (ts.isExportDeclaration(node)) assert.equal(node.moduleSpecifier, undefined);
    if (ts.isCallExpression(node)) { assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword); assert.notEqual(node.expression.getText(ast), "require"); }
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.deepEqual(imports, ["server-only", "./opencredit-client-profile-contract", "./opencredit-commercial-identity-policy"]);
  assert.doesNotMatch(source, /\b(?:Prisma|prisma|fetch|process|console|logger|XMLHttpRequest|localStorage|sessionStorage|setTimeout|setInterval|async|await)\b|node:|opencredit-api-client|https?:\/\//);
  assert.deepEqual(Object.keys(adapter).sort(), ["OpenCreditContactClientProfileAdapterError", "buildOpenCreditClientProfileFromContact"].sort());
  function scan(dir: URL) { for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = new URL(e.name + (e.isDirectory() ? "/" : ""), dir); if (e.isDirectory()) scan(path);
    else if (/\.(tsx?|m?js|cjs)$/.test(e.name) && !/\.(test|integration)\./.test(e.name) && e.name !== "opencredit-contact-client-profile-adapter.ts") assert.doesNotMatch(readFileSync(path, "utf8"), /(?:import|require)[\s\S]{0,250}["'][^"']*opencredit-contact-client-profile-adapter["']/);
  } }
  scan(new URL("../", import.meta.url)); scan(new URL("../../scripts/", import.meta.url));
  const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8"); assert.match(ci, /tsx@4\.20\.6 src\/lib\/opencredit-contact-client-profile-adapter.test.ts/);
});
