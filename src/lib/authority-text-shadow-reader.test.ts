import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as nodeUrl from "node:url";
import ts from "typescript";
import * as contract from "./authority-text-shadow-contract";
import { shadowConnection } from "./authority-text-shadow-reader";
import { createTextAuthorityObserver } from "./authority-text-shadow";

test("private connection is explicit, bounded and never falls back to DATABASE_URL", () => {
  for (const bad of [undefined, null, "", "invalid", "https://example.invalid", 7]) {
    assert.throws(() => shadowConnection(bad), /SHADOW_READ_UNAVAILABLE/);
  }
  const config = shadowConnection("postgresql://fake:fake@localhost:5432/disposable?connection_limit=99&pool_timeout=99");
  const parsed = new URL(config.url);
  assert.equal(parsed.searchParams.get("connection_limit"), "1");
  assert.equal(parsed.searchParams.get("pool_timeout"), "1");
  assert.equal(parsed.searchParams.get("connect_timeout"), "1");
  assert.equal(config.postgres, true);
});

test("lazy singleton reader sheds overload, sanitizes failures, closes and can restart without client growth", async () => {
  let clients = 0, closed = 0, transactions = 0;
  let settle: (value: null) => void = () => {};
  let fail: (error: Error) => void = () => {};
  const settings: unknown[] = [];
  class FakeClient {
    constructor(config: { log: unknown[]; errorFormat: string }) {
      clients++; assert.deepEqual(config.log, []); assert.equal(config.errorFormat, "minimal");
    }
    $transaction(fn: (tx: unknown) => unknown, options: unknown) {
      transactions++; settings.push(options);
      return fn({
        $executeRaw: async () => 0, $queryRaw: async () => [],
        conversationAuthority: { findFirst: () => new Promise<null>((resolve, reject) => { settle = resolve; fail = reject; }) }
      });
    }
    async $disconnect() { closed++; }
  }
  const loaded = { exports: {} as typeof import("./authority-text-shadow-reader") };
  const js = ts.transpileModule(readFileSync("src/lib/authority-text-shadow-reader.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  new Function("require", "module", "exports", js)((name: string) => {
    if (name === "@prisma/client") return { PrismaClient: FakeClient };
    if (name === "node:url") return nodeUrl;
    if (name === "./authority-text-shadow-contract") return contract;
    throw new Error("Unexpected dependency");
  }, loaded, loaded.exports);
  const scope = { companyId: "a", channelId: "b", conversationId: "c" };
  const reader = loaded.exports.createShadowAuthorityReader(() => "postgresql://fake:fake@localhost/disposable");
  createTextAuthorityObserver({ mode: () => "OFF", read: reader.read, emit: () => assert.fail() })({}, {
    ...scope, actorUserId: "actor", assignedUserId: null, source: "CHANNEL_TEXT", intentId: null
  });
  assert.equal(clients, 0);
  const first = reader.read(scope);
  for (let i = 0; i < 1000; i++) await assert.rejects(reader.read(scope), error =>
    error instanceof contract.ShadowReadFailure && error.reason === "CAPACITY");
  assert.equal(clients, 1); assert.equal(transactions, 1);
  fail(new Error("SYNTHETIC_SENSITIVE_ERROR"));
  await assert.rejects(first, error => error instanceof Error && error.message === "SHADOW_READ_UNAVAILABLE" && !("cause" in error));
  const second = reader.read(scope);
  await new Promise(resolve => setImmediate(resolve));
  const closing = reader.close();
  await assert.rejects(reader.read(scope));
  assert.equal(closed, 0);
  settle(null); await second; await closing;
  assert.equal(closed, 1);
  const third = reader.read(scope);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(clients, 2); settle(null); await third; await reader.close();
  assert.equal(closed, 2);
  assert.deepEqual(settings[0], { maxWait: 1000, timeout: 1000 });
  const missing = loaded.exports.createShadowAuthorityReader(() => undefined);
  await assert.rejects(missing.read(scope), error => error instanceof contract.ShadowReadFailure && error.reason === "CONFIG_UNAVAILABLE");
  assert.equal(clients, 2); await missing.close();
});
