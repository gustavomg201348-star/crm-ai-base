import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Execute the real entrypoint with an isolated environment and a strict import stub.
// No worker, Prisma client, database, timer or provider is loaded by this harness.
const compiled = ts.transpileModule(readFileSync("src/instrumentation.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(runtime: string | undefined, log?: (value: string) => unknown) {
  const logs: string[] = [], imports: string[] = [], order: string[] = [];
  let starts = 0;
  const exports = {} as { register(): Promise<void> };
  const env = new Proxy({}, {
    get(_target, key) {
      assert.equal(key, "NEXT_RUNTIME", "instrumentation must not read sensitive environment variables");
      return runtime;
    },
    ownKeys() { throw new Error("ENV_ENUMERATION_FORBIDDEN"); },
  });
  runInNewContext(compiled, {
    exports, process: { env },
    console: { info(value: string) { logs.push(value); order.push("log"); return log?.(value); } },
    require(name: string) {
      imports.push(name); order.push("import");
      assert.equal(name, "./lib/opencredit-materialization-worker");
      return { async startOpenCreditMaterializationWorkerFromRuntime() {
        starts++; order.push("start"); return { started: false, reason: "disabled" };
      } };
    },
  });
  return { register: exports.register, logs, imports, order, starts: () => starts };
}

for (const runtime of ["nodejs", undefined, "node", "synthetic-private-unknown-runtime"])
  test("server instrumentation attempts startup: " + (runtime === undefined ? "absent" : runtime === "node" || runtime === "nodejs" ? runtime : "unknown"), async () => {
    const f = fixture(runtime);
    await f.register();
    assert.equal(f.starts(), 1);
    assert.deepEqual(f.imports, ["./lib/opencredit-materialization-worker"]);
    assert.deepEqual(f.order, ["log", "import", "start"]);
    assert.deepEqual(f.logs.map(value => JSON.parse(value)), [{ event: "opencredit_instrumentation_bootstrap",
      runtime: runtime === "nodejs" || runtime === "node" ? "nodejs" : "unknown", attempted: true, skippedReason: null }]);
    assert(!f.logs.join("").includes("synthetic-private-unknown-runtime"));
  });

test("Edge emits its skip diagnostic and never imports Node/Prisma or attempts startup", async () => {
  const f = fixture("edge");
  await f.register();
  assert.equal(f.starts(), 0); assert.deepEqual(f.imports, []);
  assert.deepEqual(f.order, ["log"]);
  assert.deepEqual(f.logs.map(value => JSON.parse(value)), [{ event: "opencredit_instrumentation_bootstrap",
    runtime: "edge", attempted: false, skippedReason: "edge_runtime" }]);
});

for (const runtime of [undefined, "nodejs", "edge"]) for (const failure of ["throw", "reject", "pending"] as const)
  test(`instrumentation logger ${failure} cannot change bootstrap (${runtime ?? "absent"})`, async () => {
    const f = fixture(runtime, () => {
      if (failure === "throw") throw new Error("synthetic-private-error");
      return failure === "reject" ? Promise.reject(new Error("synthetic-private-error")) : new Promise<void>(() => {});
    });
    await f.register();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.starts(), runtime === "edge" ? 0 : 1);
    assert.equal(f.imports.length, runtime === "edge" ? 0 : 1);
    assert(!f.logs.join("").includes("synthetic-private-error"));
  });

test("bootstrap event is closed, contains no environment values and does not duplicate worker telemetry", async () => {
  const privateRuntime = "secret-rollout-cpf-phone-token-private-value";
  const f = fixture(privateRuntime);
  await f.register();
  assert.equal(f.logs.length, 1);
  const event = JSON.parse(f.logs[0]);
  assert.deepEqual(Object.keys(event).sort(), ["attempted", "event", "runtime", "skippedReason"]);
  assert.equal(event.runtime, "unknown");
  for (const value of [privateRuntime, "worker_startup", "worker_cycle", "process.env", "rolloutId"]) assert(!f.logs[0].includes(value));
});
