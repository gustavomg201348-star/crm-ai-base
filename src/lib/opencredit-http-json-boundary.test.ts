import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Module from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";

let boundary: typeof import("./opencredit-http-json-boundary");
let profile: typeof import("./opencredit-client-profile-contract");
const originalFetch = globalThis.fetch;
let fetchCalls = 0;
before(async () => {
  globalThis.fetch = async () => { fetchCalls++; throw new Error("REAL_HTTP_FORBIDDEN"); };
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try {
    boundary = await import("./opencredit-http-json-boundary");
    profile = await import("./opencredit-client-profile-contract");
  } finally { loader._load = original; }
});
after(() => { globalThis.fetch = originalFetch; assert.equal(fetchCalls, 0); });

type Code = InstanceType<typeof boundary.OpenCreditHttpJsonBoundaryError>["code"];
const encode = (raw: string) => new TextEncoder().encode(raw);
const json = (raw: string, headers: HeadersInit = { "Content-Type": "application/json" }) => new Response(encode(raw), { headers });
function errorCode(expected: Code) {
  return (error: unknown) => {
    assert(error instanceof boundary.OpenCreditHttpJsonBoundaryError);
    assert.equal(error.code, expected);
    assert.equal(error.message, "OPENCREDIT_HTTP_JSON_" + expected);
    assert.equal(error.stack, "OpenCreditHttpJsonBoundaryError: " + error.message);
    assert.deepEqual(Object.keys(error).sort(), ["code", "name"]);
    for (const key of ["cause", "body", "headers", "url", "raw", "offset", "position", "payload", "token"]) assert.equal(key in error, false);
    return true;
  };
}
async function reject(response: Response, code: Code) {
  await assert.rejects(boundary.readOpenCreditStrictJsonResponse(response), errorCode(code));
  assert.equal(response.body?.locked ?? false, false);
}
function streaming(chunks: Uint8Array[], headers: HeadersInit = { "Content-Type": "application/json" }) {
  let pulls = 0, cancellations = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      if (chunks.length) controller.enqueue(chunks.shift()!);
      else controller.close();
    },
    cancel() { cancellations++; }
  }, { highWaterMark: 0 });
  return { response: new Response(body, { headers }), pulls: () => pulls, cancellations: () => cancellations };
}

for (const contentType of ["application/json", "application/json; charset=utf-8", "APPLICATION/JSON; CHARSET=UTF-8",
  " application/json \t;\tcharset = utf-8 \t", 'application/json; charset="UTF-8"']) {
  test("equivalent JSON Content-Type accepted: " + JSON.stringify(contentType), async () => {
    const response = json('{"valid":true}', { "Content-Type": contentType });
    assert.equal(JSON.stringify(await boundary.readOpenCreditStrictJsonResponse(response)), '{"valid":true}');
    assert.equal(response.body?.locked, false);
  });
}
for (const contentType of [undefined, "", "text/html", "text/json", "application/problem+json", "application/jsonp",
  "application/json; charset=latin1", "application/json; charset=utf8", "application/json; charset=utf-16",
  "application/json; charset=utf-8; charset=utf-8", "application/json; profile=anything", "application/json, application/json",
  "application /json", "application/json;", 'application/json; charset="utf-8;anything"']) {
  test("non-equivalent Content-Type rejected: " + JSON.stringify(contentType), async () => {
    const f = streaming([encode("{}")], contentType === undefined ? {} : { "Content-Type": contentType });
    await reject(f.response, "INVALID_CONTENT_TYPE");
    assert.equal(f.pulls(), 0); assert.equal(f.cancellations(), 1);
  });
}

test("invalid Response, absent body, consumed body and caller-owned locked body fail closed", async () => {
  for (const value of [null, undefined, {}, { body: "{}" }, Object.create(Response.prototype)]) {
    await assert.rejects(boundary.readOpenCreditStrictJsonResponse(value as Response), errorCode("INVALID_RESPONSE"));
  }
  await reject(new Response(null, { headers: { "Content-Type": "application/json" } }), "INVALID_RESPONSE");
  const consumed = json("{}"); await consumed.text(); const previouslyLocked = consumed.body?.locked;
  await assert.rejects(boundary.readOpenCreditStrictJsonResponse(consumed), errorCode("INVALID_RESPONSE"));
  assert.equal(consumed.body?.locked, previouslyLocked, "a pre-existing lock is not owned by the boundary");
  const locked = streaming([encode("{}")]); const owner = locked.response.body!.getReader();
  await assert.rejects(boundary.readOpenCreditStrictJsonResponse(locked.response), errorCode("INVALID_RESPONSE"));
  assert.equal(locked.response.body?.locked, true); assert.equal(locked.cancellations(), 0);
  await owner.cancel(); owner.releaseLock();
});

test("Content-Type anchors reject terminal newlines and non-OWS even on overridden response metadata", async () => {
  // Native Headers normalizes/rejects these before the boundary. An overridden
  // metadata getter must not exploit the JS dollar-anchor final-newline exception.
  for (const raw of ["application/json\n", "application/json\r", "application/json\u00a0"]) {
    const response = json("{}"), headers = response.headers;
    Object.defineProperty(response, "headers", { value: { get(name: string) {
      return name === "content-type" ? raw : headers.get(name);
    } } });
    await reject(response, "INVALID_CONTENT_TYPE");
  }
});

for (const length of ["65537", "9999999999999999999999999999999999999999999999999"]) {
  test("oversized Content-Length cancels before any pull: " + length.length, async () => {
    const f = streaming([encode("{}")], { "Content-Type": "application/json", "Content-Length": length });
    await reject(f.response, "TOO_LARGE"); assert.equal(f.pulls(), 0); assert.equal(f.cancellations(), 1);
  });
}
test("actual bytes enforce the limit with absent, lying or malformed Content-Length", async () => {
  for (const length of [undefined, "2", "not-a-length"]) {
    const headers = new Headers({ "Content-Type": "application/json" }); if (length !== undefined) headers.set("Content-Length", length);
    const f = streaming([encode(" ".repeat(65536)), encode("0"), encode("must-not-read")], headers);
    await reject(f.response, "TOO_LARGE"); assert.equal(f.pulls(), 2); assert.equal(f.cancellations(), 1);
  }
});
test("exactly 64 KiB is allowed; multibyte limits count bytes, not JS code units", async () => {
  assert.equal(await boundary.readOpenCreditStrictJsonResponse(json(" ".repeat(65532) + "null")), null);
  const raw = '"' + "é".repeat(32767) + '"'; assert.equal(encode(raw).byteLength, 65536);
  assert.equal(await boundary.readOpenCreditStrictJsonResponse(json(raw)), "é".repeat(32767));
  await reject(json('"' + "é".repeat(32768) + '"'), "TOO_LARGE");
});
test("UTF-8 split across arbitrary chunks decodes losslessly without mutating supplied bytes", async () => {
  const bytes = encode('"Á漢字😀"'), before = bytes.slice();
  const f = streaming(Array.from(bytes, byte => new Uint8Array([byte])));
  assert.equal(await boundary.readOpenCreditStrictJsonResponse(f.response), "Á漢字😀");
  assert.deepEqual(bytes, before); assert.equal(f.response.body?.locked, false);
});
for (const bytes of [[0xc3, 0x28], [0xff], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xe2, 0x82]]) {
  test("fatal UTF-8 rejects invalid or truncated encoding: " + bytes.join("-"), async () => {
    await reject(new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/json" } }), "INVALID_UTF8");
  });
}
test("ignoreBOM true preserves the UTF-8 signature for strict JSON rejection, including split BOM", async () => {
  assert.equal(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(new Uint8Array([239, 187, 191, 123, 125])), "\ufeff{}");
  const f = streaming([new Uint8Array([239]), new Uint8Array([187]), new Uint8Array([191]), encode("{}")]);
  await reject(f.response, "INVALID_JSON");
});

for (const raw of ["", '{"a":', "{} trailing", "// comment\n{}", "/* comment */{}", '{"a":1,}', "[1,]",
  '{"a":1,"a":2}', '{"a":1,"\\u0061":2}']) {
  test("strict parser rejects malformed/duplicate raw JSON: " + JSON.stringify(raw), async () => reject(json(raw), "INVALID_JSON"));
}
for (const raw of ["{}", "[]", '[1,true,null,"value"]', "null", "true", "false", "123", '"value"']) {
  test("any valid JSON root remains supported: " + raw, async () => {
    // Test oracle only; production boundary never calls JSON.parse.
    assert.equal(JSON.stringify(await boundary.readOpenCreditStrictJsonResponse(json(raw))), JSON.stringify(JSON.parse(raw)));
  });
}

test("total deadline covers a never-ending read and cancels even if source cancellation never settles", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let cancellations = 0;
  const response = new Response(new ReadableStream<Uint8Array>({ cancel() { cancellations++; return new Promise(() => {}); } }),
    { headers: { "Content-Type": "application/json" } });
  const rejected = assert.rejects(boundary.readOpenCreditStrictJsonResponse(response), errorCode("TIMEOUT"));
  t.mock.timers.tick(20_000); await rejected;
  assert.equal(cancellations, 1); assert.equal(response.body?.locked, false);
});
test("deadline is total, not reset by receiving chunks", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let controller!: ReadableStreamDefaultController<Uint8Array>, cancellations = 0;
  const response = new Response(new ReadableStream<Uint8Array>({ start(c) { controller = c; }, cancel() { cancellations++; } }),
    { headers: { "Content-Type": "application/json" } });
  const rejected = assert.rejects(boundary.readOpenCreditStrictJsonResponse(response), errorCode("TIMEOUT"));
  t.mock.timers.tick(19_999); controller.enqueue(encode(" "));
  await Promise.resolve(); await Promise.resolve();
  t.mock.timers.tick(1); await rejected;
  assert.equal(cancellations, 1); assert.equal(response.body?.locked, false);
});
test("malformed chunks and raw stream errors cannot leak supplier exceptions; reader lock is released", async () => {
  const sentinel = "SYNTHETIC_PRIVATE_PROVIDER_TOKEN_BODY";
  const response = new Response(new ReadableStream<Uint8Array>({ pull(c) { c.error(new Error(sentinel)); } }),
    { headers: { "Content-Type": "application/json" } });
  await reject(response, "STREAM_ERROR");
  const wrongChunk = new Response(new ReadableStream({ start(c) { c.enqueue(sentinel); } }), { headers: { "Content-Type": "application/json" } });
  await reject(wrongChunk, "STREAM_ERROR");
});
test("UTF-8 failure cancels an open stream; rejecting cancellation never replaces the sanitized error", async () => {
  let cancellations = 0;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new Uint8Array([0xff])); },
    cancel() { cancellations++; return Promise.reject(new Error("SYNTHETIC_PRIVATE_CANCEL")); }
  }), { headers: { "Content-Type": "application/json" } });
  await reject(response, "INVALID_UTF8"); assert.equal(cancellations, 1);
});
test("errors disclose no synthetic provider body/header/url/credential sentinel or original cause", async () => {
  const sentinel = "SYNTHETIC_PRIVATE_BODY_CPF_TOKEN";
  const response = json('{"' + sentinel + '":1,"' + sentinel + '":2}', { "Content-Type": "application/json", "X-Private": sentinel });
  try { await boundary.readOpenCreditStrictJsonResponse(response); assert.fail("expected rejection"); }
  catch (error) {
    assert(errorCode("INVALID_JSON")(error));
    assert(!JSON.stringify(error).includes(sentinel)); assert(!String(error).includes(sentinel));
  }
});

for (const success of [true, false]) for (const created of [true, false]) {
  test(`pure createClient composition preserves booleans ${success}/${created} without commercial classification`, async () => {
    const payload = await boundary.readOpenCreditStrictJsonResponse(json(JSON.stringify({ data: { success, created } })));
    const before = JSON.stringify(payload);
    assert.deepEqual(profile.parseOpenCreditClientProfileResult(payload), { success, created });
    assert.equal(JSON.stringify(payload), before);
  });
}
for (const raw of ['{}', '{"data":{}}', '{"data":{"success":"true","created":true}}', '{"data":{"success":true,"created":null}}']) {
  test("valid JSON does not relax the operation-specific result contract: " + raw, async () => {
    const payload = await boundary.readOpenCreditStrictJsonResponse(json(raw));
    assert.throws(() => profile.parseOpenCreditClientProfileResult(payload), error => error instanceof profile.OpenCreditClientProfileContractError);
  });
}
test("body boundary never interprets HTTP status and preserves Response metadata", async () => {
  for (const status of [200, 201, 400, 401, 409, 500]) {
    const headers = new Headers({ "Content-Type": "application/json", "X-Synthetic": "unchanged" });
    const response = new Response(encode("true"), { status, headers }), before = Array.from(response.headers.entries());
    assert.equal(await boundary.readOpenCreditStrictJsonResponse(response), true);
    assert.equal(response.status, status); assert.deepEqual(Array.from(response.headers.entries()), before);
    assert.equal(response.bodyUsed, true); assert.equal(response.body?.locked, false);
  }
});

test("passive slice AST guard: only strict parser dependency, no production consumer, and an explicit CI gate", () => {
  const filename = path.resolve("src/lib/opencredit-http-json-boundary.ts"), source = readFileSync(filename, "utf8");
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const imports = ast.statements.filter(ts.isImportDeclaration).map(node => (node.moduleSpecifier as ts.StringLiteral).text);
  assert.deepEqual(imports, ["server-only", "./opencredit-strict-json"]);
  assert(!/\b(fetch|Prisma|process\.env|console)\b|JSON\.parse|\.request\(/.test(source));
  assert(source.includes('typeof window !== "undefined"'));
  function scan(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { scan(file); continue; }
      if (!/\.[cm]?[jt]sx?$/.test(file) || /\.(test|integration)\./.test(file) || path.resolve(file) === filename) continue;
      const tree = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        // This slice deliberately has no production import/re-export/require consumer.
        if (ts.isStringLiteralLike(node) && /(?:^|\/)opencredit-http-json-boundary(?:\.[cm]?[jt]s)?$/.test(node.text)) assert.fail("Unexpected boundary consumer: " + file);
        ts.forEachChild(node, visit);
      };
      visit(tree);
    }
  }
  scan("src"); scan("scripts");
  assert(readFileSync(".github/workflows/ci.yml", "utf8").includes("npx --yes tsx@4.20.6 --test src/lib/opencredit-http-json-boundary.test.ts"));
  assert.equal(fetchCalls, 0);
});
