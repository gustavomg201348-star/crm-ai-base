import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import * as ts from "typescript";

let parser: typeof import("./opencredit-strict-json");
before(async () => {
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try { parser = await import("./opencredit-strict-json"); } finally { loader._load = original; }
});
type Code = InstanceType<typeof parser.OpenCreditStrictJsonError>["code"];
function reject(raw: unknown, code?: Code) {
  assert.throws(() => parser.parseOpenCreditStrictJson(raw as string), e => {
    assert.ok(e instanceof parser.OpenCreditStrictJsonError);
    if (code) assert.equal(e.code, code);
    assert.equal(e.message, "OPENCREDIT_STRICT_JSON_" + e.code);
    assert.equal(e.stack, "OpenCreditStrictJsonError: " + e.message);
    assert.deepEqual(Object.keys(e).sort(), ["code", "name"]);
    for (const key of ["cause", "raw", "input", "position", "offset", "key", "body"]) assert.equal(key in e, false);
    return true;
  });
}
for (const raw of ["{}", "[]", "null", "true", "false", '"abc"', "0", "-0", "1", "-1", "1.25", "1e3", "1E-3",
  ' {"a":[true,false,null,{"b":"c"}],"n":2} ', '"Á漢字😀"', '"\\u00e9\\uD83D\\uDE00"',
  '{"\\u0061":1}', '{"a":1,"nested":{"a":2}}', '[{"a":1},{"a":2}]',
  '{"":0,"A":1,"a":2,"é":3,"e\\u0301":4}', '"\\\"\\\\\\/\\b\\f\\n\\r\\t"', '"line\u2028paragraph\u2029"',
  "\t\n\r 42 \t\n\r", "9007199254740991", "-9007199254740991", "0.123456789012345", "1e-300", "5e-324", "0e9999", "1.2300000000000000000"]) {
  test("valid JSON case " + raw.length + ":" + raw.slice(0, 18), () => {
    const expected: unknown = JSON.parse(raw); const actual = parser.parseOpenCreditStrictJson(raw);
    assert.equal(JSON.stringify(actual), JSON.stringify(expected));
    if (typeof expected === "number") assert.equal(Object.is(actual, expected), true);
  });
}
for (const raw of ['{"a":1,"a":2}', '{"data":{"success":true,"success":false}}', '{"a":1,"a":1}',
  '{"a":1,"\\u0061":2}', '{"\\u0061":1,"a":2}', '{"é":1,"\\u00e9":2}',
  '{"😀":1,"\\ud83d\\ude00":2}', '{"\\uD83D\\uDE00":1,"😀":2}', '{"a\\nb":1,"a\\u000ab":2}',
  '{"\\/":1,"/":2}', '{"":1,"":2}', '{"__proto__":1,"\\u005f_proto__":2}',
  '[{}, {"nested":{"constructor":1,"constructor":2}}]', '{"private-fixture":1,"private-fixture":2}']) {
  test("duplicate decoded key case " + raw.length + ":" + raw.slice(0, 15), () => reject(raw, "DUPLICATE_KEY"));
}
test("duplicate is rejected before reading a malformed second value", () => reject('{"a":1,"\\u0061":', "DUPLICATE_KEY"));
for (const raw of ['"unterminated', "{", "[", '{"a":', '{"a",1}', '{"a":1,}', "[1,]", "tru", "fals", "nul",
  "undefined", "NaN", "Infinity", "-Infinity", "//comment\n1", "/*comment*/1", "{'a':1}", "{a:1}",
  "0x10", "1n", "(1)", "1+1", "[,1]", "[1,,2]", '{"a" 1}', '{"a":1 "b":2}', '[1 2]',
  '"\\x20"', '"\\v"', '"\\u00GG"', '"\\u123"', '"\\', "", " \t\r\n", "\ufeff{}", "\u00a0null"]) {
  test("malformed case " + JSON.stringify(raw), () => reject(raw));
}
for (const raw of ["01", "-01", "1.", ".1", "+1", "1e", "1e+", "1e-", "-", "--1", "1.e2", "1e9999", "-1e9999",
  "9007199254740992", "9007199254740993", "-9007199254740992", "1e16", "1e-9999", "-1e-9999",
  "0.1234567890123456", "1.0000000000000001", "9007199254740991e0", "9007199254740991.1"]) {
  test("invalid or precision-unsafe number " + raw, () => reject(raw));
}
for (let code = 0; code < 32; code++) test("literal control rejected " + code, () => reject('"a' + String.fromCharCode(code) + 'b"', "INVALID_STRING"));
for (const raw of ['"\\ud800"', '"\\udfff"', '"\\ud800x"', '"\\ud800\\ud800"', '"\\udc00\\ud800"', '"\ud800"', '"\udfff"', '{"\\ud800":1}']) {
  test("isolated surrogate case " + JSON.stringify(raw), () => reject(raw, "INVALID_UNICODE"));
}
test("mixed literal/escaped surrogate pairs decode consistently", () => {
  assert.equal(parser.parseOpenCreditStrictJson('"\ud83d\\ude00"'), "😀");
  assert.equal(parser.parseOpenCreditStrictJson('"\\ud83d\ude00"'), "😀");
  reject('{"\ud83d\\ude00":1,"😀":2}', "DUPLICATE_KEY");
});
for (const raw of ["{}{}", "{} x", "true false", "null\u00a0", "0\ufeff", '"a"\u0000', "[]/*comment*/"]) test("trailing data " + JSON.stringify(raw), () => reject(raw, "TRAILING_DATA"));
test("all proper prefixes of one nested root fail without exposing input", () => {
  const raw = '{"fixture":[{"escaped":"\\u00e9","number":-1.25e+3},true,null]}';
  for (let n = 0; n < raw.length; n++) reject(raw.slice(0, n));
});
test("raw input limit accepts exactly one million code units and rejects one more", () => {
  assert.equal(parser.parseOpenCreditStrictJson(" ".repeat(999996) + "null"), null);
  reject(" ".repeat(999997) + "null", "TOO_LARGE");
});
test("container nesting boundary 64", () => {
  assert.ok(parser.parseOpenCreditStrictJson("[".repeat(64) + "0" + "]".repeat(64)));
  reject("[".repeat(65) + "0" + "]".repeat(65), "TOO_DEEP");
  reject('{"a":'.repeat(65) + "0" + "}".repeat(65), "TOO_DEEP");
});
test("decoded string/key code-unit boundary 262144 including surrogate pairs", () => {
  const value = "a".repeat(262144); assert.equal(parser.parseOpenCreditStrictJson('"' + value + '"'), value);
  reject('"' + value + 'a"', "STRING_TOO_LARGE");
  assert.equal((parser.parseOpenCreditStrictJson('"' + "😀".repeat(131072) + '"') as string).length, 262144);
  reject('"' + "😀".repeat(131072) + 'a"', "STRING_TOO_LARGE");
  assert.ok(Object.hasOwn(parser.parseOpenCreditStrictJson('{"' + value + '":0}') as object, value));
  reject('{"' + value + 'a":0}', "STRING_TOO_LARGE");
  assert.equal((parser.parseOpenCreditStrictJson('"' + "\\u0061".repeat(10000) + '"') as string).length, 10000);
});
test("object key count boundary 10000 is per object", () => {
  const members = Array.from({ length: 10000 }, (_, n) => '"k' + n + '":0').join(",");
  assert.equal(Object.keys(parser.parseOpenCreditStrictJson("{" + members + "}") as object).length, 10000);
  reject("{" + members + ',"extra":0}', "TOO_MANY_OBJECT_KEYS");
  assert.equal((parser.parseOpenCreditStrictJson("[{" + members + "},{" + members + "}]") as unknown[]).length, 2);
});
test("array item count boundary 100000", () => {
  const items = Array(100000).fill("0").join(",");
  assert.equal((parser.parseOpenCreditStrictJson("[" + items + "]") as unknown[]).length, 100000);
  reject("[" + items + ",0]", "TOO_MANY_ARRAY_ITEMS");
});
test("total value-node boundary 200000 across distinct arrays", () => {
  const array = (n: number) => "[" + Array(n).fill("0").join(",") + "]";
  assert.equal((parser.parseOpenCreditStrictJson("[" + array(100000) + "," + array(99997) + "]") as unknown[]).length, 2);
  reject("[" + array(100000) + "," + array(99998) + "]", "TOO_MANY_NODES");
});
test("own enumerable data fields on null-prototype objects; dangerous keys remain inert", () => {
  const result = parser.parseOpenCreditStrictJson('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":0,"toString":1,"hasOwnProperty":2}') as Record<string, unknown>;
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    if (!Array.isArray(value)) assert.equal(Object.getPrototypeOf(value), null);
    for (const key of Object.keys(value)) {
      const d: PropertyDescriptor = Object.getOwnPropertyDescriptor(value, key)!; assert.equal(d.enumerable, true); assert.ok("value" in d); assert.equal(d.get, undefined); visit(d.value);
    }
  }
  visit(result); assert.equal(Object.hasOwn(result, "__proto__"), true);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined); assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
});
test("hostile non-string roots never invoke coercion, accessors or Proxy traps", () => {
  let traps = 0;
  const hostile = new Proxy({}, { get() { traps++; throw Error("private-fixture"); }, getPrototypeOf() { traps++; throw Error("private-fixture"); }, ownKeys() { traps++; throw Error("private-fixture"); } });
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  for (const value of [new String("{}"), 0, true, {}, [], null, undefined, Symbol("fixture"), BigInt(1), hostile, proxy,
    { toString() { traps++; throw Error("private-fixture"); }, [Symbol.toPrimitive]() { traps++; throw Error("private-fixture"); } }]) reject(value, "INVALID_INPUT");
  assert.equal(traps, 0);
});
test("deterministic generated JSON preserves native values and does not retain state", () => {
  let seed = 19;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const strings = ["plain", "Á😀", "\\\"\n\t", "__proto__", "", "a:b,{}[]", "é", "e\u0301"];
  function generate(depth: number): unknown {
    const n = next(); if (!depth || n % 4 === 0) return [null, true, false, (n % 10000) / 100, strings[n % strings.length]][n % 5];
    if (n % 2) return Array.from({ length: next() % 5 }, () => generate(depth - 1));
    return Object.fromEntries(Array.from({ length: next() % 5 }, (_, k) => [strings[k] + k, generate(depth - 1)]));
  }
  for (let n = 0; n < 500; n++) {
    const raw = JSON.stringify(generate(5)); assert.equal(JSON.stringify(parser.parseOpenCreditStrictJson(raw)), raw);
  }
  reject('{"a":1,"a":2}'); assert.equal(JSON.stringify(parser.parseOpenCreditStrictJson('{"a":1}')), '{"a":1}');
});
test("public marker, exact exports, no side effects, dependencies or runtime caller", () => {
  const source = readFileSync(new URL("./opencredit-strict-json.ts", import.meta.url), "utf8");
  assert.match(source, /^import "server-only";/);
  const ast = ts.createSourceFile("parser.ts", source, ts.ScriptTarget.Latest, true); const imports: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) imports.push((node.moduleSpecifier as ts.StringLiteral).text);
    assert.equal(ts.isImportEqualsDeclaration(node), false);
    if (ts.isCallExpression(node)) { assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword); assert.notEqual(node.expression.getText(ast), "require"); }
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.deepEqual(imports, ["server-only"]);
  assert.doesNotMatch(source, /JSON\.parse|\b(?:Prisma|prisma|fetch|XMLHttpRequest|process|console|logger|Buffer|crypto|setTimeout|setInterval|NextRequest|NextResponse|async|await)\b|node:|https?:\/\/|opencredit-api-client/);
  assert.deepEqual(Object.keys(parser).sort(), ["OpenCreditStrictJsonError", "parseOpenCreditStrictJson"]);
  function scan(dir: URL) { for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
    if (e.isDirectory()) scan(path);
    else if (/\.(tsx?|m?js|cjs)$/.test(e.name) && !/\.(test|integration)\./.test(e.name) && e.name !== "opencredit-strict-json.ts") {
      let checked = readFileSync(path, "utf8");
      // Exact passive composition and approved human admin boundary only.
      const admin = ["./opencredit-consumer-authorization-admin-handler.ts", "./opencredit-consumer-authorization-context-admin-handler.ts", "./opencredit-create-client-dispatch-admin-handler.ts", "./opencredit-create-client-context-admin-handler.ts", "./opencredit-create-client-reconciliation-context-admin-handler.ts"]
        .some(file => path.href === new URL(file, import.meta.url).href);
      if (admin || path.href === new URL("./opencredit-http-json-boundary.ts", import.meta.url).href) {
        const boundary = ts.createSourceFile("boundary.ts", checked, ts.ScriptTarget.Latest, true);
        const allowed = boundary.statements.filter(ts.isImportDeclaration)
          .filter(node => (node.moduleSpecifier as ts.StringLiteral).text === "./opencredit-strict-json");
        assert.equal(allowed.length, 1);
        const bindings = allowed[0].importClause?.namedBindings;
        assert(bindings && ts.isNamedImports(bindings));
        assert.deepEqual(bindings.elements.map(binding => binding.name.text), admin ? ["parseOpenCreditStrictJson"] : ["parseOpenCreditStrictJson", "OpenCreditJsonValue"]);
        assert.equal(bindings.elements.some(binding => binding.propertyName), false);
        // Remove only the checked import, then apply the original prohibition
        // to everything else (including require/dynamic/extra imports).
        checked = checked.slice(0, allowed[0].pos) + checked.slice(allowed[0].end);
      }
      assert.doesNotMatch(checked, /(?:import|require)[\s\S]{0,250}["'][^"']*opencredit-strict-json["']/);
    }
  } }
  scan(new URL("../", import.meta.url)); scan(new URL("../../scripts/", import.meta.url));
  assert.match(readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8"), /npx --yes tsx@4\.20\.6 src\/lib\/opencredit-strict-json\.test\.ts/);
});
