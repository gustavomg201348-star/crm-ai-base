import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import Module from "node:module";
import { before, test } from "node:test";
import * as ts from "typescript";

let resolver: typeof import("./opencredit-provider-scope-resolver");
let policy: typeof import("./opencredit-commercial-identity-policy");
before(async () => {
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try {
    resolver = await import("./opencredit-provider-scope-resolver");
    policy = await import("./opencredit-commercial-identity-policy");
  } finally { loader._load = original; }
});
const config = Object.freeze({ tenantId: "Synthetic-Tenant_1", partnerId: "Synthetic-Partner_2" });
test("configured context returns the exact validated tenant and same-snapshot scope only", () => {
  const context = resolver.resolveOpenCreditProviderContext(config);
  assert.deepEqual(context, { tenantId: config.tenantId, providerScope: resolver.resolveOpenCreditProviderScope(config) });
  assert.deepEqual(Object.keys(context).sort(), ["providerScope", "tenantId"]);
  let gets = 0;
  assert.throws(() => resolver.resolveOpenCreditProviderContext({ get tenantId() { gets++; return "x"; }, partnerId: "x" }));
  assert.equal(gets, 0);
  for (const value of ["", "x\n", " bad", "bad/path"]) assert.throws(() => resolver.resolveOpenCreditProviderContext({ tenantId: value, partnerId: "x" }));
});
type Config = Parameters<typeof resolver.resolveOpenCreditProviderScope>[0];
function rejected(value: unknown) {
  assert.throws(() => resolver.resolveOpenCreditProviderScope(value as Config), error => {
    assert.ok(error instanceof resolver.OpenCreditProviderScopeResolverError);
    assert.equal(error.code, "CONFIGURATION");
    assert.equal(error.message, "OPENCREDIT_PROVIDER_SCOPE_CONFIGURATION");
    assert.equal(error.stack, "OpenCreditProviderScopeResolverError: " + error.message);
    assert.deepEqual(Object.keys(error).sort(), ["code", "name"]);
    for (const key of ["cause", "config", "tenantId", "partnerId", "input"]) assert.equal(key in error, false);
    return true;
  });
}
function expected(tenantId: string, partnerId: string) {
  const hex = createHash("sha256").update("qevora/opencredit/provider-scope/v1\0" + JSON.stringify([tenantId, partnerId])).digest("hex");
  return "ocp-" + [hex.slice(0, 10), hex.slice(10, 20), hex.slice(20, 30), hex.slice(30, 40), hex.slice(40, 50), hex.slice(50, 55)].join("f");
}
test("exact versioned serialization, deterministic digest and fixed positions", () => {
  const scope = resolver.resolveOpenCreditProviderScope(config);
  assert.equal(scope, expected(config.tenantId, config.partnerId));
  assert.equal(scope, resolver.resolveOpenCreditProviderScope({ ...config }));
  assert.match(scope, /^ocp-[0-9a-f]{60}$/);
  assert.equal(scope.length, 64);
  for (const index of [14, 25, 36, 47, 58]) assert.equal(scope[index], "f");
  assert.equal(policy.parseOpenCreditProviderScope(scope), scope);
  assert.deepEqual(config, { tenantId: "Synthetic-Tenant_1", partnerId: "Synthetic-Partner_2" });
});
for (const changed of [
  { ...config, tenantId: "Other-Tenant" }, { ...config, partnerId: "Other-Partner" },
  { ...config, tenantId: "synthetic-Tenant_1" }, { ...config, partnerId: "synthetic-Partner_2" },
  { ...config, tenantId: "Synthetic_Tenant_1" }, { ...config, partnerId: "Synthetic_Partner_2" },
  { tenantId: config.partnerId, partnerId: config.tenantId },
]) test("exact ID separation: " + JSON.stringify(changed), () => {
  assert.notEqual(resolver.resolveOpenCreditProviderScope(changed), resolver.resolveOpenCreditProviderScope(config));
  assert.equal(resolver.resolveOpenCreditProviderScope(changed), expected(changed.tenantId, changed.partnerId));
});
test("closed serialization distinguishes pair boundaries", () => {
  assert.notEqual(resolver.resolveOpenCreditProviderScope({ tenantId: "a", partnerId: "bc" }),
    resolver.resolveOpenCreditProviderScope({ tenantId: "ab", partnerId: "c" }));
});
for (const id of ["a", "0", "A", "a".repeat(128), "Z" + "_-".repeat(63) + "0"]) {
  test("valid boundary ID length " + id.length + " first " + id[0], () => {
    const scope = resolver.resolveOpenCreditProviderScope({ tenantId: id, partnerId: id });
    assert.equal(scope, expected(id, id));
    assert.equal(policy.parseOpenCreditProviderScope(scope), scope);
  });
}
for (const value of [undefined, null, "", " ", "\t", "\n", "a\n", "a\r\n", " a", "a ", "a\u00a0", "é", "e\u0301",
  "a/b", "a:b", "a.b", "a@b", "_a", "-a", "a".repeat(129), 1, false, [], {}, new String("abc")]) {
  for (const key of ["tenantId", "partnerId"] as const) {
    test("invalid " + key + " " + String(value) + " type " + typeof value, () => rejected({ ...config, [key]: value }));
  }
}
for (const root of [undefined, null, "config", [], {}, { tenantId: "a" }, { partnerId: "b" }, Object.create(config)]) {
  test("invalid root " + String(root), () => rejected(root));
}
test("getters are not executed, proxy exceptions are sanitized", () => {
  let calls = 0;
  rejected({ get tenantId() { calls++; throw new Error("private-fixture"); }, partnerId: "a" });
  assert.equal(calls, 0);
  rejected(new Proxy(config, { getOwnPropertyDescriptor() { throw new Error("private-fixture"); } }));
});
test("unrelated credentials and hostile unrelated accessors are ignored", () => {
  const extended = { ...config, get password() { throw new Error("must-not-read"); }, email: "synthetic@example.invalid", accessToken: "fake" };
  assert.equal(resolver.resolveOpenCreditProviderScope(extended), resolver.resolveOpenCreditProviderScope(config));
});
test("env wrapper reads only server IDs; rotation does not change scope; missing fails closed", () => {
  const names = ["OPENCREDIT_TENANT_ID", "OPENCREDIT_PARTNER_ID", "OPENCREDIT_API_EMAIL", "OPENCREDIT_API_PASSWORD"];
  const old = names.map(name => process.env[name]);
  try {
    process.env.OPENCREDIT_TENANT_ID = config.tenantId;
    process.env.OPENCREDIT_PARTNER_ID = config.partnerId;
    process.env.OPENCREDIT_API_EMAIL = "first@example.invalid";
    process.env.OPENCREDIT_API_PASSWORD = "synthetic-first";
    const scope = resolver.resolveConfiguredOpenCreditProviderScope();
    assert.equal(scope, resolver.resolveOpenCreditProviderScope(config));
    process.env.OPENCREDIT_API_EMAIL = "second@example.invalid";
    process.env.OPENCREDIT_API_PASSWORD = "synthetic-second";
    assert.equal(resolver.resolveConfiguredOpenCreditProviderScope(), scope);
    delete process.env.OPENCREDIT_PARTNER_ID;
    assert.throws(() => resolver.resolveConfiguredOpenCreditProviderScope(), resolver.OpenCreditProviderScopeResolverError);
    process.env.OPENCREDIT_PARTNER_ID = "bad\n";
    assert.throws(() => resolver.resolveConfiguredOpenCreditProviderScope(), resolver.OpenCreditProviderScopeResolverError);
    delete process.env.OPENCREDIT_TENANT_ID;
    assert.throws(() => resolver.resolveConfiguredOpenCreditProviderScope(), resolver.OpenCreditProviderScopeResolverError);
  } finally {
    names.forEach((name, index) => { if (old[index] === undefined) delete process.env[name]; else process.env[name] = old[index]; });
  }
});
test("all sampled scopes satisfy unchanged parser, even when plain digest has eleven digits", () => {
  let plainRejected = false;
  for (let i = 0; i < 2000; i++) {
    const tenantId = "synthetic-" + i; const partnerId = "fixture";
    const digest = createHash("sha256").update("qevora/opencredit/provider-scope/v1\0" + JSON.stringify([tenantId, partnerId])).digest("hex");
    if (/\d{11}/.test(digest.slice(0, 60))) plainRejected = true;
    const scope = resolver.resolveOpenCreditProviderScope({ tenantId, partnerId });
    assert.equal(scope, expected(tenantId, partnerId));
    assert.match(scope, /^ocp-[0-9a-f]{60}$/);
    assert.equal(/\d{11}/.test(scope), false);
    assert.equal(policy.parseOpenCreditProviderScope(scope), scope);
  }
  assert.equal(plainRejected, true);
});
test("public exports are closed", () => {
  assert.deepEqual(Object.keys(resolver).sort(), ["OpenCreditProviderScopeResolverError", "resolveConfiguredOpenCreditProviderContext", "resolveConfiguredOpenCreditProviderScope", "resolveOpenCreditProviderContext", "resolveOpenCreditProviderScope"]);
});
test("source boundary: public server-only marker, no I/O, time, normalization, credentials or raw output", () => {
  const source = readFileSync("src/lib/opencredit-provider-scope-resolver.ts", "utf8");
  const ast = ts.createSourceFile("resolver.ts", source, ts.ScriptTarget.Latest, true);
  const imports = ast.statements.filter(ts.isImportDeclaration).map(node => (node.moduleSpecifier as ts.StringLiteral).text);
  assert.deepEqual(imports, ["server-only", "node:crypto", "./opencredit-access-summary", "./opencredit-commercial-identity-policy"]);
  assert.doesNotMatch(source, /\b(?:fetch|PrismaClient|console|Date|randomUUID|setTimeout|document|localStorage|sessionStorage)\b|Math\.random|\.trim\(|\.toLowerCase\(|\.toUpperCase\(|\.normalize\(/);
  assert.deepEqual(Array.from(source.matchAll(/process\.env\.([A-Z_]+)/g), match => match[1]).sort(), ["OPENCREDIT_PARTNER_ID", "OPENCREDIT_TENANT_ID"]);
  const declarations: ts.VariableDeclaration[] = [];
  function visit(node: ts.Node) { if (ts.isVariableDeclaration(node)) declarations.push(node); ts.forEachChild(node, visit); }
  visit(ast);
  const output = declarations.find(node => node.name.getText(ast) === "scope")?.initializer;
  assert.ok(output);
  const identifiers: string[] = [];
  function collect(node: ts.Node) { if (ts.isIdentifier(node)) identifiers.push(node.text); ts.forEachChild(node, collect); }
  collect(output);
  assert.deepEqual(Array.from(new Set(identifiers)).sort(), ["digest", "slice"]);
  assert.match(source, /providerScope: parseOpenCreditProviderScope\(scope\)/);
});
test("only approved human admin boundaries and dispatcher core import the resolver", () => {
  for (const file of readdirSync("src", { recursive: true, encoding: "utf8" })) {
    if (!/\.tsx?$/.test(file) || /\.(test|integration)\.ts$/.test(file) || file.endsWith("opencredit-provider-scope-resolver.ts")) continue;
    let source = readFileSync("src/" + file, "utf8");
    const dispatcher = file.replace(/\\/g, "/") === "lib/opencredit-create-client-dispatcher.ts";
    if (dispatcher || ["lib/opencredit-consumer-authorization-admin-handler.ts", "lib/opencredit-consumer-authorization-context-admin-handler.ts", "lib/opencredit-create-client-dispatch-admin-handler.ts", "lib/opencredit-create-client-context-admin-handler.ts", "lib/opencredit-create-client-reconciliation-context-admin-handler.ts"].includes(file.replace(/\\/g, "/"))) {
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      const imports = ast.statements.filter(ts.isImportDeclaration).filter(node => (node.moduleSpecifier as ts.StringLiteral).text === "./opencredit-provider-scope-resolver");
      assert.equal(imports.length, 1);
      assert.equal(imports[0].getText(ast), dispatcher ? 'import { resolveConfiguredOpenCreditProviderContext } from "./opencredit-provider-scope-resolver";' : 'import { resolveConfiguredOpenCreditProviderScope } from "./opencredit-provider-scope-resolver";');
      source = source.slice(0, imports[0].pos) + source.slice(imports[0].end);
    }
    assert.doesNotMatch(source, /opencredit-provider-scope-resolver/);
  }
});
