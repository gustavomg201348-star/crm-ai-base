import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createOpenCreditMaterializationWorker, isOpenCreditMaterializationWorkerEnabled,
  openCreditMaterializationWorkerConfig, materializationWorkerMode,
  startOpenCreditMaterializationWorkerFromRuntime } from "./opencredit-materialization-worker";

const on = () => ({ OPENCREDIT_MATERIALIZATION_WORKER_ENABLED: "true", OPENCREDIT_MATERIALIZATION_WORKER_MODE: "NORMAL" });
for (const config of [
  {}, { OPENCREDIT_MATERIALIZATION_WORKER_MODE: "normal" },
  { OPENCREDIT_MATERIALIZATION_WORKER_MODE: "ROLLOUT" },
  { OPENCREDIT_MATERIALIZATION_WORKER_MODE: "ROLLOUT", OPENCREDIT_MATERIALIZATION_WORKER_ROLLOUT_ID: "" },
  { OPENCREDIT_MATERIALIZATION_WORKER_MODE: "ROLLOUT", OPENCREDIT_MATERIALIZATION_WORKER_ROLLOUT_ID: "bad id" },
]) test("invalid mode/ID never falls back: " + JSON.stringify(config), async () => {
  assert.equal(materializationWorkerMode(config).kind, "INVALID");
  const f = fixture({ OPENCREDIT_MATERIALIZATION_WORKER_ENABLED: "true", ...config });
  const worker = f.worker(); assert.equal(worker.start(), false); await worker.runOnce();
  assert.deepEqual(f.order, []);
});

for (const residual of [undefined, "rollout", "", "private-residual-secret budget id\n"]) test("NORMAL ignores residual rollout ID: " + String(residual === undefined ? "absent" : residual.length), async () => {
  const f = fixture({ ...on(), OPENCREDIT_MATERIALIZATION_WORKER_ROLLOUT_ID: residual });
  assert.deepEqual(materializationWorkerMode(f.env), { kind: "NORMAL" });
  const worker = f.worker();
  assert.equal(worker.start(), true); worker.stop();
  await worker.runOnce();
  f.env.OPENCREDIT_MATERIALIZATION_WORKER_ROLLOUT_ID = "changed-residual";
  await worker.runOnce();
  assert.deepEqual(f.order, ["recover:1", "expire:1", "claim:1", "process:job-0", "recover:1", "expire:1", "claim:1", "process:job-0"]);
  assert(!JSON.stringify(f.logs).includes("residual"));
});
test("ROLLOUT processes through its injected guarded queue only, without recover/expire", async () => {
  const f = fixture({ ...on(), OPENCREDIT_MATERIALIZATION_WORKER_MODE: "ROLLOUT", OPENCREDIT_MATERIALIZATION_WORKER_ROLLOUT_ID: "rollout" });
  const worker = f.worker(); await worker.runOnce();
  assert.deepEqual(f.order, ["claim:1", "process:job-0"]);
  f.env.OPENCREDIT_MATERIALIZATION_WORKER_ROLLOUT_ID = "another";
  await worker.runOnce(); assert.equal(f.order.length, 2);
});
function fixture(env: { OPENCREDIT_MATERIALIZATION_WORKER_ENABLED?: string; OPENCREDIT_MATERIALIZATION_WORKER_MODE?: string; OPENCREDIT_MATERIALIZATION_WORKER_ROLLOUT_ID?: string } = on(), batchSize?: number) {
  const order: string[] = [];
  const logs: unknown[] = [];
  const deps = {
    queue: {
      async recover(limit?: number) { order.push(`recover:${limit}`); return []; },
      async expire(limit?: number) { order.push(`expire:${limit}`); return []; },
      async claim(limit = 1) {
        order.push(`claim:${limit}`);
        return Array.from({ length: limit }, (_, i) => ({ id: `job-${i}`, leaseToken: `private-${i}` }));
      },
    },
    materializer: { async process(lease: { id: string }) {
      order.push(`process:${lease.id}`); return { state: "COMPLETED" as const };
    } },
    log: (event: unknown): void | Promise<void> => { logs.push(event); },
  };
  return { deps, order, logs, env, worker: () => createOpenCreditMaterializationWorker(deps, { env, batchSize }) };
}

for (const flag of [undefined, "false", "TRUE", "1", "true"]) test(`worker flag ${flag} gates ALL mutations`, async () => {
  const env = { ...on(), OPENCREDIT_MATERIALIZATION_WORKER_ENABLED: flag };
  assert.equal(isOpenCreditMaterializationWorkerEnabled(env), flag === "true");
  const f = fixture(env);
  await f.worker().runOnce();
  assert.equal(f.order.length, flag === "true" ? 4 : 0);
  if (flag !== "true") assert.equal(f.worker().start(), false);
});

for (const value of [undefined, "", "garbage", "0", "-1", "11", "1000", "1.5", "1e1", " 2", "2 ", "01", "Infinity", "9007199254740993"])
  test(`invalid/absent batch ${value} safely defaults to one`, () => {
    assert.equal(openCreditMaterializationWorkerConfig({ OPENCREDIT_MATERIALIZATION_WORKER_BATCH_LIMIT: value }).batchLimit, 1);
  });
for (const value of ["1", "2", "10"]) test(`batch ${value} respected per cycle`, async () => {
  const env = { ...on(), OPENCREDIT_MATERIALIZATION_WORKER_BATCH_LIMIT: value };
  const f = fixture(env);
  const worker = f.worker();
  for (let i = 0; i < 2; i++) {
    const result = await worker.runOnce();
    assert.equal("claimed" in result && result.claimed, Number(value));
  }
  assert.equal(f.order.filter(x => x.startsWith("process:")).length, 2 * Number(value));
});
for (const value of [undefined, "0", "-1", "999", "bad", "1.5", "2147483648"])
  test(`interval ${value} cannot create aggressive/overflow timer`, () => {
    assert.equal(openCreditMaterializationWorkerConfig({ OPENCREDIT_MATERIALIZATION_WORKER_INTERVAL_MS: value }).intervalMs, 1000);
  });
test("interval at and above minimum is preserved", () => {
  for (const value of ["1000", "3000"]) assert.equal(openCreditMaterializationWorkerConfig({
    OPENCREDIT_MATERIALIZATION_WORKER_INTERVAL_MS: value,
  }).intervalMs, Number(value));
});
test("numeric options cannot bypass hard bounds", async () => {
  for (const batchSize of [0, -1, 11, Infinity, 1.5]) {
    const f = fixture(on(), batchSize);
    await f.worker().runOnce();
    assert(f.order.includes("claim:1"));
  }
});

for (const stopAt of ["before-cycle", "recover", "expire", "claim", "process"] as const) test(`kill switch at ${stopAt} stops subsequent mutations`, async () => {
  const f = fixture(on(), 2);
  const off = () => { f.env.OPENCREDIT_MATERIALIZATION_WORKER_ENABLED = "false"; };
  if (stopAt === "before-cycle") off();
  if (stopAt === "recover") f.deps.queue.recover = async () => { off(); f.order.push("recover"); return []; };
  if (stopAt === "expire") f.deps.queue.expire = async () => { off(); f.order.push("expire"); return []; };
  if (stopAt === "claim") {
    const claim = f.deps.queue.claim;
    f.deps.queue.claim = async limit => { const leases = await claim(limit); off(); return leases; };
  }
  if (stopAt === "process") {
    const process = f.deps.materializer.process;
    f.deps.materializer.process = async lease => { const result = await process(lease); off(); return result; };
  }
  await f.worker().runOnce();
  const lengths = { "before-cycle": 0, recover: 1, expire: 2, claim: 3, process: 4 };
  assert.equal(f.order.length, lengths[stopAt]);
});

test("outcomes count persisted states, logs contain only closed technical fields", async () => {
  const f = fixture(on(), 4);
  const states = ["COMPLETED", "NEEDS_REVIEW", "RETRY", "EXPIRED"] as const;
  let index = 0;
  const worker = createOpenCreditMaterializationWorker({ ...f.deps,
    materializer: { async process() { return { state: states[index++] }; } },
  }, { env: f.env, batchSize: 4 });
  const result = await worker.runOnce();
  assert("completed" in result);
  assert.deepEqual([result.completed, result.needsReview, result.retry, result.expired, result.processed], [1, 1, 1, 1, 4]);
  const allowed = ["event", "phase", "batchLimit", "workerEnabled", "skipped", "durationMs", "recovered", "expired", "claimed", "processed", "completed", "needsReview", "retry", "failed"].sort();
  for (const log of f.logs) {
    assert.deepEqual(Object.keys(log as object).sort(), allowed);
    assert(!JSON.stringify(log).includes("private-"));
    assert(!JSON.stringify(log).includes("job-"));
  }
});

test("unexpected job exception rejects cycle, never refills or logs success", async () => {
  const f = fixture(on(), 2);
  const error = new Error("PRIVATE_PAYLOAD_secret_cpf_phone_SQL_stack");
  let processed = 0;
  f.deps.materializer.process = async () => { processed++; throw error; };
  await assert.rejects(f.worker().runOnce(), e => e === error);
  assert.equal(processed, 1);
  assert.equal(f.order.filter(x => x.startsWith("claim:")).length, 1);
  assert.deepEqual(f.logs.map(log => (log as { phase: string }).phase), ["started", "failed"]);
  assert(!JSON.stringify(f.logs).includes(error.message));
});
test("lost lease does not cause fallback or more claims", async () => {
  const f = fixture();
  const worker = createOpenCreditMaterializationWorker({ ...f.deps, materializer: { async process() { return null; } } }, { env: f.env });
  const result = await worker.runOnce();
  assert("failed" in result && result.failed === 1 && result.processed === 0);
  assert.equal(f.order.filter(x => x.startsWith("claim:")).length, 1);
});
test("oversized claim fails closed before processing instead of truncating or refilling", async () => {
  const f = fixture();
  f.deps.queue.claim = async () => [{ id: "a", leaseToken: "private" }, { id: "b", leaseToken: "private" }];
  await assert.rejects(f.worker().runOnce(), /MATERIALIZATION_WORKER_BATCH_EXCEEDED/);
  assert(!f.order.some(value => value.startsWith("process:")));
});
test("only outcome state is observed, never identity or payload fields", async () => {
  const f = fixture();
  const privateValue = "synthetic-private-cpf-phone-name-email-id-envelope-secret";
  const worker = createOpenCreditMaterializationWorker({ ...f.deps, materializer: {
    async process() { return { state: "COMPLETED", payload: privateValue, cpf: privateValue,
      phone: privateValue, name: privateValue, email: privateValue, id: privateValue,
      leaseToken: privateValue, protectedEnvelope: privateValue }; },
  } }, { env: f.env });
  await worker.runOnce();
  assert(!JSON.stringify(f.logs).includes(privateValue));
  for (const value of f.logs) {
    const log = value as { durationMs: number };
    assert(Number.isInteger(log.durationMs) && log.durationMs >= 0);
  }
});
for (const asynchronous of [false, true]) test(`logger failure is isolated, async=${asynchronous}`, async () => {
  const f = fixture();
  f.deps.log = () => { if (asynchronous) return Promise.reject(new Error("private")); throw new Error("private"); };
  const result = await f.worker().runOnce();
  assert("completed" in result && result.completed === 1);
  await new Promise(resolve => setImmediate(resolve));
});
test("overlapping cycles rejected and start idempotent", async () => {
  const f = fixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.deps.queue.recover = async () => { f.order.push("recover"); await gate; return []; };
  const worker = f.worker();
  const first = worker.runOnce();
  assert.deepEqual(await worker.runOnce(), { skipped: true });
  release(); await first;
  assert.equal(worker.start(), true); assert.equal(worker.start(), false);
  worker.stop(); assert.equal(worker.isRunning(), false);
});
test("scheduler does not retry unexpected failure before conservative interval", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  let cycles = 0;
  f.deps.queue.recover = async () => { cycles++; throw new Error("private"); };
  const worker = createOpenCreditMaterializationWorker(f.deps, { env: f.env, intervalMs: 1 });
  worker.start();
  t.mock.timers.tick(0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cycles, 1);
  t.mock.timers.tick(999);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cycles, 1);
  t.mock.timers.tick(1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cycles, 2);
  worker.stop();
});
test("worker has no provider/transport or alternate claim path", () => {
  const source = readFileSync("src/lib/opencredit-materialization-worker.ts", "utf8");
  for (const forbidden of ["fetch(", "createClient(", "claimPilotJob(", "sendMessage(", "opencredit-api-client"]) assert(!source.includes(forbidden));
  assert.equal((source.match(/deps\.queue\.claim\(/g) ?? []).length, 1);
});

type RuntimeDeps = NonNullable<Parameters<typeof startOpenCreditMaterializationWorkerFromRuntime>[1]>;
type RuntimeEnv = NonNullable<Parameters<typeof startOpenCreditMaterializationWorkerFromRuntime>[0]>;
async function runtimeFixture(env: RuntimeEnv, run: (f: Omit<ReturnType<typeof fixture>, "deps"> & {
  startupLogs: Array<Parameters<RuntimeDeps["log"]>[0]>;
  modes: Array<Parameters<RuntimeDeps["createWorker"]>[0]>;
  deps: RuntimeDeps;
}) => Promise<void>) {
  const runtime = globalThis as typeof globalThis & { __openCreditMaterializationWorkerV1?: ReturnType<typeof createOpenCreditMaterializationWorker> };
  const prior = runtime.__openCreditMaterializationWorkerV1;
  delete runtime.__openCreditMaterializationWorkerV1;
  const f = fixture(env), startupLogs: Array<Parameters<RuntimeDeps["log"]>[0]> = [];
  const modes: Array<Parameters<RuntimeDeps["createWorker"]>[0]> = [];
  const workers: Array<ReturnType<typeof createOpenCreditMaterializationWorker>> = [];
  const deps: RuntimeDeps = {
    async createWorker(mode, currentEnv) {
      modes.push(mode);
      const worker = createOpenCreditMaterializationWorker(f.deps, { env: currentEnv });
      workers.push(worker); return worker;
    },
    log(event) { startupLogs.push(event); },
  };
  try { await run({ ...f, startupLogs, modes, deps }); }
  finally {
    workers.forEach(worker => worker.stop());
    if (prior) runtime.__openCreditMaterializationWorkerV1 = prior;
    else delete runtime.__openCreditMaterializationWorkerV1;
  }
}

for (const scenario of [
  { mode: "NORMAL", id: undefined, flag: "true", reason: "started", kind: "NORMAL" },
  { mode: "NORMAL", id: "private-residual-id", flag: "true", reason: "started", kind: "NORMAL" },
  { mode: "ROLLOUT", id: "synthetic-budget", flag: "true", reason: "started", kind: "ROLLOUT" },
  { mode: "ROLLOUT", id: undefined, flag: "true", reason: "invalid_mode", kind: "INVALID" },
  { mode: "ROLLOUT", id: "bad id", flag: "true", reason: "invalid_mode", kind: "INVALID" },
  { mode: "NORMAL", id: undefined, flag: "false", reason: "disabled", kind: "NORMAL" },
  { mode: "unknown-private-mode", id: undefined, flag: "true", reason: "invalid_mode", kind: "INVALID" },
  { mode: undefined, id: undefined, flag: "false", reason: "disabled", kind: "INVALID" },
] as const) test(`runtime startup ${scenario.mode}/${scenario.flag}/${scenario.reason}/${scenario.id !== undefined}`, async () => {
  const env = { OPENCREDIT_MATERIALIZATION_WORKER_ENABLED: scenario.flag, OPENCREDIT_MATERIALIZATION_WORKER_MODE: scenario.mode,
    OPENCREDIT_MATERIALIZATION_WORKER_ROLLOUT_ID: scenario.id, OPENCREDIT_MATERIALIZATION_WORKER_BATCH_LIMIT: "2",
    OPENCREDIT_MATERIALIZATION_WORKER_INTERVAL_MS: "300000" };
  await runtimeFixture(env, async f => {
    const started = scenario.reason === "started";
    assert.deepEqual(await startOpenCreditMaterializationWorkerFromRuntime(env, f.deps), { started, reason: scenario.reason });
    assert.deepEqual(f.startupLogs, [{ event: "opencredit_materialization_worker_startup", started,
      reason: scenario.reason, mode: scenario.kind, workerEnabled: scenario.flag === "true", batchLimit: 2, intervalMs: 300000 }]);
    assert.equal(f.modes.length, started ? 1 : 0);
    if (started) assert.deepEqual(f.modes[0], scenario.mode === "NORMAL" ? { kind: "NORMAL" } : { kind: "ROLLOUT", rolloutId: scenario.id });
    assert.deepEqual(f.order, []); // Disabled/invalid startup never even constructs database dependencies.
    const logs = JSON.stringify(f.startupLogs);
    for (const privateValue of ["private-residual-id", "synthetic-budget", "bad id", "unknown-private-mode"]) assert(!logs.includes(privateValue));
  });
});

test("runtime NORMAL startup emits cycles; duplicate and concurrent boot keep one singleton", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await runtimeFixture(on(), async f => {
    const results = await Promise.all([
      startOpenCreditMaterializationWorkerFromRuntime(f.env, f.deps), startOpenCreditMaterializationWorkerFromRuntime(f.env, f.deps),
    ]);
    assert.deepEqual(results.map(result => result.reason), ["started", "already_running"]);
    assert.equal((await startOpenCreditMaterializationWorkerFromRuntime(f.env, f.deps)).reason, "already_running");
    assert.equal(f.modes.length, 2); // Both loaders yielded; only one worker may start.
    t.mock.timers.tick(0); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.order, ["recover:1", "expire:1", "claim:1", "process:job-0"]);
    assert.deepEqual(f.logs.map(log => (log as { event: string; phase: string }).event), ["opencredit_materialization_worker_cycle", "opencredit_materialization_worker_cycle"]);
    assert.deepEqual(f.logs.map(log => (log as { phase: string }).phase), ["started", "completed"]);
  });
});

test("runtime ROLLOUT retains budget mode and skips recover/expire", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await runtimeFixture({ ...on(), OPENCREDIT_MATERIALIZATION_WORKER_MODE: "ROLLOUT", OPENCREDIT_MATERIALIZATION_WORKER_ROLLOUT_ID: "synthetic-budget" }, async f => {
    assert.equal((await startOpenCreditMaterializationWorkerFromRuntime(f.env, f.deps)).started, true);
    t.mock.timers.tick(0); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.order, ["claim:1", "process:job-0"]);
    assert.deepEqual(f.modes, [{ kind: "ROLLOUT", rolloutId: "synthetic-budget" }]);
  });
});

for (const change of ["disabled", "invalid_mode", "configuration_changed"] as const) test("startup revalidates after loading: " + change, async () => {
  await runtimeFixture(on(), async f => {
    const create = f.deps.createWorker;
    f.deps.createWorker = async (mode, env) => {
      const worker = await create(mode, env);
      if (change === "disabled") env.OPENCREDIT_MATERIALIZATION_WORKER_ENABLED = "false";
      else env.OPENCREDIT_MATERIALIZATION_WORKER_MODE = change === "invalid_mode" ? "private-invalid" : "ROLLOUT";
      if (change === "configuration_changed") env.OPENCREDIT_MATERIALIZATION_WORKER_ROLLOUT_ID = "synthetic-budget";
      return worker;
    };
    assert.deepEqual(await startOpenCreditMaterializationWorkerFromRuntime(f.env, f.deps), { started: false, reason: change });
    assert.deepEqual(f.order, []); assert.equal(f.startupLogs.length, 1);
    assert.equal(f.startupLogs[0].reason, change);
  });
});

for (const failure of ["throw", "reject", "pending"] as const) test("startup logger cannot block or fail boot: " + failure, async () => {
  await runtimeFixture(on(), async f => {
    f.deps.log = () => {
      if (failure === "throw") throw new Error("private-log-error");
      return failure === "reject" ? Promise.reject(new Error("private-log-error")) : new Promise<void>(() => {});
    };
    assert.deepEqual(await startOpenCreditMaterializationWorkerFromRuntime(f.env, f.deps), { started: true, reason: "started" });
    await new Promise(resolve => setImmediate(resolve));
  });
});
