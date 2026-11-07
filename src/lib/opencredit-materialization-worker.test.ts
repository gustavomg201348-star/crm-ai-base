import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createOpenCreditMaterializationWorker, isOpenCreditMaterializationWorkerEnabled,
  openCreditMaterializationWorkerConfig } from "./opencredit-materialization-worker";

const on = () => ({ OPENCREDIT_MATERIALIZATION_WORKER_ENABLED: "true" });
function fixture(env: { OPENCREDIT_MATERIALIZATION_WORKER_ENABLED?: string } = on(), batchSize?: number) {
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
  const env = { OPENCREDIT_MATERIALIZATION_WORKER_ENABLED: flag };
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
