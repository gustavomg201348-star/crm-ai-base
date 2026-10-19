import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Module from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import type { OpenCreditCreateClientObservation, OpenCreditCreateClientOutcome } from "./opencredit-create-client-outcome";

let policy: typeof import("./opencredit-create-client-outcome");
let profile: typeof import("./opencredit-client-profile-contract");
const originalFetch = globalThis.fetch;
let fetchCalls = 0;
before(async () => {
  globalThis.fetch = async () => { fetchCalls++; throw Error("HTTP_FORBIDDEN"); };
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try {
    policy = await import("./opencredit-create-client-outcome");
    profile = await import("./opencredit-client-profile-contract");
  } finally { loader._load = original; }
});
after(() => { globalThis.fetch = originalFetch; assert.equal(fetchCalls, 0); });

const parsed = (status = 201, success = true, created = true): OpenCreditCreateClientObservation =>
  ({ kind: "PARSED_RESPONSE", status, result: { success, created } });
function reject(input: unknown) {
  assert.throws(() => policy.classifyOpenCreditCreateClientOutcome(input), error => {
    assert(error instanceof policy.OpenCreditCreateClientOutcomeError);
    assert.equal(error.code, "INVALID_OBSERVATION");
    assert.equal(error.message, "OPENCREDIT_CREATE_CLIENT_INVALID_OBSERVATION");
    assert.equal(error.stack, "OpenCreditCreateClientOutcomeError: " + error.message);
    assert.deepEqual(Object.keys(error).sort(), ["code", "name"]);
    assert.equal("cause" in error, false);
    return true;
  });
}
const cases: Array<[boolean, boolean, OpenCreditCreateClientOutcome]> = [
  [true, true, { state: "SUCCEEDED", basis: "HTTP_201_SUCCESS_CREATED", created: true }],
  [true, false, { state: "SUCCEEDED", basis: "HTTP_201_SUCCESS_UPDATED", created: false }],
  [false, false, { state: "UNKNOWN", basis: "HTTP_201_UNCONFIRMED_RESULT" }],
  [false, true, { state: "UNKNOWN", basis: "HTTP_201_CONTRADICTORY_RESULT" }]
];
for (const [success, created, expected] of cases) {
  test(`201 ${success}/${created} exact closed outcome`, () => {
    assert.deepEqual(policy.classifyOpenCreditCreateClientOutcome(parsed(201, success, created)), expected);
  });
  test(`existing parser composition ${success}/${created}, no mutation`, () => {
    const result = profile.parseOpenCreditClientProfileResult({ data: { success, created } });
    const input = Object.freeze({ kind: "PARSED_RESPONSE", status: 201, result: Object.freeze(result) });
    assert.deepEqual(policy.classifyOpenCreditCreateClientOutcome(input), expected);
    assert.deepEqual(result, { success, created });
  });
}
for (const status of [100, 200, 202, 204, 301, 400, 401, 403, 409, 422, 429, 500, 502, 503, 504, 599]) {
  test(`non-201 ${status} is UNKNOWN for all four flags, never permission to retry`, () => {
    for (const [success, created] of cases) assert.deepEqual(policy.classifyOpenCreditCreateClientOutcome(parsed(status, success, created)),
      { state: "UNKNOWN", basis: "UNPUBLISHED_HTTP_STATUS" });
  });
}
test("exhaustive 100..599: only 201 with success=true can classify SUCCEEDED", () => {
  for (let status = 100; status <= 599; status++) for (const [success, created, expected] of cases) {
    assert.deepEqual(policy.classifyOpenCreditCreateClientOutcome(parsed(status, success, created)),
      status === 201 ? expected : { state: "UNKNOWN", basis: "UNPUBLISHED_HTTP_STATUS" });
  }
});
test("exhaustive closed observation space: no current path can emit FAILED", () => {
  const states = new Set<string>();
  for (let status = 100; status <= 599; status++) {
    for (const [success, created] of cases) states.add(policy.classifyOpenCreditCreateClientOutcome(parsed(status, success, created)).state);
    for (const reason of ["INVALID_CONTENT_TYPE", "TOO_LARGE", "INVALID_UTF8", "INVALID_JSON", "STREAM_ERROR", "INVALID_RESPONSE", "INVALID_CONTRACT"] as const) {
      states.add(policy.classifyOpenCreditCreateClientOutcome({ kind: "UNREADABLE_RESPONSE", status, reason }).state);
    }
  }
  for (const reason of ["TIMEOUT", "NETWORK"] as const) states.add(policy.classifyOpenCreditCreateClientOutcome({ kind: "NO_RESPONSE", reason }).state);
  assert.deepEqual(Array.from(states).sort(), ["SUCCEEDED", "UNKNOWN"]);
  assert.equal(states.has("FAILED"), false);
});
for (const reason of ["INVALID_CONTENT_TYPE", "TOO_LARGE", "INVALID_UTF8", "INVALID_JSON", "STREAM_ERROR", "INVALID_RESPONSE", "INVALID_CONTRACT"] as const) {
  test(`unreadable ${reason} is UNKNOWN at every HTTP status`, () => {
    for (let status = 100; status <= 599; status++) assert.deepEqual(policy.classifyOpenCreditCreateClientOutcome({ kind: "UNREADABLE_RESPONSE", status, reason }),
      { state: "UNKNOWN", basis: "UNREADABLE_RESPONSE" });
  });
}
for (const reason of ["TIMEOUT", "NETWORK"] as const) test(`no response ${reason} is UNKNOWN`, () => {
  assert.deepEqual(policy.classifyOpenCreditCreateClientOutcome({ kind: "NO_RESPONSE", reason }), { state: "UNKNOWN", basis: "NO_RESPONSE" });
});
for (const status of [99, 600, 201.1, NaN, Infinity, -Infinity, "201", null, undefined, {}, []]) {
  test(`invalid HTTP status ${String(status)} rejected in both response variants`, () => {
    reject({ ...parsed(), status }); reject({ kind: "UNREADABLE_RESPONSE", status, reason: "INVALID_JSON" });
  });
}
test("invalid roots, discriminants, missing fields and mixed variants reject", () => {
  for (const input of [null, undefined, false, 1, "", [], new Date(), new Response(), {},
    { kind: "parsed_response" }, { kind: "OTHER" }, { ...parsed(), kind: new String("PARSED_RESPONSE") },
    { kind: "PARSED_RESPONSE", result: { success: true, created: true } }, { kind: "PARSED_RESPONSE", status: 201 },
    { kind: "NO_RESPONSE" }, { kind: "NO_RESPONSE", status: 201, reason: "TIMEOUT" },
    { kind: "UNREADABLE_RESPONSE", status: 201 }, { kind: "NO_RESPONSE", reason: "INVALID_JSON" },
    { kind: "UNREADABLE_RESPONSE", status: 201, reason: "TIMEOUT" }]) reject(input);
});
for (const reason of ["arbitrary", "", null, undefined, 1, [], {}, new String("NETWORK")]) test(`reason is closed, fixture ${String(reason)}`, () => {
  reject({ kind: "NO_RESPONSE", reason }); reject({ kind: "UNREADABLE_RESPONSE", status: 201, reason });
});
test("strict booleans and exact nested result, including non-201", () => {
  for (const status of [201, 400]) {
    for (const result of [null, undefined, [], {}, { success: true }, { created: true }]) reject({ kind: "PARSED_RESPONSE", status, result });
    for (const key of ["success", "created"]) for (const value of [null, undefined, "true", "false", 0, 1, [], {}, new Boolean(true)]) {
      reject({ kind: "PARSED_RESPONSE", status, result: { success: true, created: true, [key]: value } });
    }
  }
});
test("extra properties never enter the closed observation or result", () => {
  for (const key of ["body", "raw", "url", "headers", "token", "cpf", "contact", "message", "error", "providerError", "then", "toJSON", "__proto__"]) {
    reject({ ...parsed(), [key]: "SYNTHETIC_PRIVATE" });
    reject({ kind: "NO_RESPONSE", reason: "TIMEOUT", [key]: "SYNTHETIC_PRIVATE" });
    reject({ kind: "UNREADABLE_RESPONSE", status: 201, reason: "INVALID_JSON", [key]: "SYNTHETIC_PRIVATE" });
    reject({ ...parsed(), result: { success: true, created: false, [key]: "SYNTHETIC_PRIVATE" } });
  }
});
test("getters and setters on every accepted field are rejected without invocation", () => {
  let calls = 0;
  for (const original of [parsed(), { kind: "UNREADABLE_RESPONSE", status: 201, reason: "INVALID_JSON" }, { kind: "NO_RESPONSE", reason: "TIMEOUT" }]) {
    for (const key of Object.keys(original)) for (const accessor of [{ get() { calls++; throw Error("PRIVATE"); } }, { set() { calls++; } }]) {
      const input = { ...original };
      Object.defineProperty(input, key, { enumerable: true, ...accessor }); reject(input);
    }
  }
  for (const key of ["success", "created"]) {
    const result = { success: true, created: false };
    Object.defineProperty(result, key, { enumerable: true, get() { calls++; throw Error("PRIVATE"); } });
    reject({ ...parsed(), result });
  }
  assert.equal(calls, 0);
});
test("inherited fields/custom prototypes reject, null-prototype own data is accepted", () => {
  reject(Object.create(parsed()));
  reject(Object.assign(Object.create({ extra: true }), parsed()));
  reject({ ...parsed(), result: Object.create({ success: true, created: true }) });
  reject({ ...parsed(), result: Object.assign(Object.create({ extra: true }), { success: true, created: true }) });
  const input = Object.assign(Object.create(null), parsed());
  input.result = Object.assign(Object.create(null), input.result);
  assert.deepEqual(policy.classifyOpenCreditCreateClientOutcome(input), cases[0][2]);
});
test("symbols and hidden properties reject at both depths", () => {
  for (const nested of [false, true]) for (const key of [Symbol("PRIVATE"), "hidden"]) {
    const input = parsed(), target = nested && input.kind === "PARSED_RESPONSE" ? input.result : input;
    Object.defineProperty(target, key, { value: true, enumerable: typeof key === "symbol" }); reject(input);
  }
  for (const key of ["kind", "status", "result"]) {
    const input = parsed(); Object.defineProperty(input, key, { enumerable: false }); reject(input);
  }
  for (const key of ["success", "created"]) {
    const result = { success: true, created: false }; Object.defineProperty(result, key, { enumerable: false });
    reject({ ...parsed(), result });
  }
});
test("hostile/revoked proxy errors are sanitized with no original data or cause", () => {
  const fail = () => { throw Error("SYNTHETIC_PRIVATE_BODY_TOKEN"); };
  for (const traps of [{ getOwnPropertyDescriptor: fail }, { getPrototypeOf: fail }, { ownKeys: fail }]) reject(new Proxy(parsed(), traps));
  reject({ ...parsed(), result: new Proxy({}, { getPrototypeOf: fail }) });
  const { proxy, revoke } = Proxy.revocable(parsed(), {}); revoke(); reject(proxy);
});
test("fresh closed output on every call, no input mutation or retained result", () => {
  for (const [success, created, expected] of cases) {
    const input = Object.freeze({ kind: "PARSED_RESPONSE", status: 201, result: Object.freeze({ success, created }) });
    const first = policy.classifyOpenCreditCreateClientOutcome(input), second = policy.classifyOpenCreditCreateClientOutcome(input);
    assert.deepEqual(first, expected); assert.notEqual(first, second);
    assert.notEqual(first, input); assert.deepEqual(input.result, { success, created });
    assert.equal(Object.hasOwn(first, "created"), expected.state === "SUCCEEDED");
    assert.deepEqual(Reflect.ownKeys(first).sort(), expected.state === "SUCCEEDED" ? ["basis", "created", "state"] : ["basis", "state"]);
  }
});
test("runtime browser protection fails closed", () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  try { reject(parsed()); } finally { Reflect.deleteProperty(globalThis, "window"); }
});
test("passivity AST guard: public marker, exact service/dispatcher consumers, CI gate", () => {
  const filename = path.resolve("src/lib/opencredit-create-client-outcome.ts"), source = readFileSync(filename, "utf8");
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) imports.push((node.moduleSpecifier as ts.StringLiteral).text);
    assert.equal(ts.isImportEqualsDeclaration(node), false);
    if (ts.isExportDeclaration(node)) assert.equal(node.moduleSpecifier, undefined);
    if (ts.isCallExpression(node)) {
      assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword);
      assert.notEqual(node.expression.getText(ast), "require");
    }
    assert.equal(ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false), false);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.deepEqual(imports, ["server-only"]);
  assert.doesNotMatch(source, /\b(fetch|Response|Prisma|process|console|Buffer|XMLHttpRequest|setTimeout|setInterval|localStorage|sessionStorage)\b|node:|\.request\(|opencredit-api-client|readOpenCreditStrictJsonResponse|markSucceeded|markFailed|markUnknown/);
  assert(source.includes('typeof window !== "undefined"'));
  let approvedImports = 0;
  const approvedConsumer = path.resolve("src/lib/opencredit-commercial-operation.service.ts");
  function scan(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { scan(file); continue; }
      if (!/\.[cm]?[jt]sx?$/.test(file) || /\.(test|integration)\./.test(file) || path.resolve(file) === filename) continue;
      const tree = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const consumer = (node: ts.Node): void => {
        if (ts.isStringLiteralLike(node) && /(?:^|\/)opencredit-create-client-outcome(?:\.[cm]?[jt]s)?$/.test(node.text)) {
          assert([approvedConsumer, path.resolve("src/lib/opencredit-create-client-dispatcher.ts")].includes(path.resolve(file)), "Unexpected outcome consumer: " + file);
          assert.equal(node.text, "./opencredit-create-client-outcome");
          const parent = node.parent;
          assert(ts.isImportDeclaration(parent));
          assert.equal(parent.moduleSpecifier, node);
          const clause = parent.importClause;
          assert(clause && !clause.name && !clause.isTypeOnly);
          assert(clause.namedBindings && ts.isNamedImports(clause.namedBindings));
          assert.deepEqual(clause.namedBindings.elements.map(e => {
            assert.equal(e.propertyName, undefined, "No aliases");
            return [e.name.text, e.isTypeOnly];
          }), [["classifyOpenCreditCreateClientOutcome", false], ["OpenCreditCreateClientObservation", true]]);
          approvedImports++;
        }
        ts.forEachChild(node, consumer);
      };
      consumer(tree);
    }
  }
  scan("src"); scan("scripts");
  assert.equal(approvedImports, 2);
  assert(readFileSync(".github/workflows/ci.yml", "utf8").includes("npx --yes tsx@4.20.6 --test src/lib/opencredit-create-client-outcome.test.ts"));
  assert.equal(fetchCalls, 0);
});

if (false) {
  // @ts-expect-error No arbitrary reason in the closed union.
  const arbitrary: OpenCreditCreateClientObservation = { kind: "NO_RESPONSE", reason: "PRIVATE" };
  // @ts-expect-error No transport or provider payload in an observation.
  const extra: OpenCreditCreateClientObservation = { kind: "NO_RESPONSE", reason: "NETWORK", body: "PRIVATE" };
  // @ts-expect-error created is exclusive to SUCCEEDED.
  const leaked: OpenCreditCreateClientOutcome = { state: "UNKNOWN", basis: "NO_RESPONSE", created: false };
  // @ts-expect-error This passive policy cannot produce FAILED, even at type level.
  const failed: OpenCreditCreateClientOutcome = { state: "FAILED", basis: "HTTP_201_UNCONFIRMED_RESULT" };
  // @ts-expect-error CREATED basis requires created=true.
  const impossibleCreated: OpenCreditCreateClientOutcome = { state: "SUCCEEDED", basis: "HTTP_201_SUCCESS_CREATED", created: false };
  // @ts-expect-error UPDATED basis requires created=false.
  const impossibleUpdated: OpenCreditCreateClientOutcome = { state: "SUCCEEDED", basis: "HTTP_201_SUCCESS_UPDATED", created: true };
  void [arbitrary, extra, leaked, failed, impossibleCreated, impossibleUpdated];
}
