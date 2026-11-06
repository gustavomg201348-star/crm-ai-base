import assert from "node:assert/strict";
import test from "node:test";
import {
  createOpenCreditMaterializationWorker,
  isOpenCreditMaterializationWorkerEnabled,
} from "./opencredit-materialization-worker";

test("worker flag is explicit and defaults off", () => {
  assert.equal(isOpenCreditMaterializationWorkerEnabled({}), false);
  assert.equal(isOpenCreditMaterializationWorkerEnabled({ OPENCREDIT_MATERIALIZATION_WORKER_ENABLED: "false" }), false);
  assert.equal(isOpenCreditMaterializationWorkerEnabled({ OPENCREDIT_MATERIALIZATION_WORKER_ENABLED: "TRUE" }), false);
  assert.equal(isOpenCreditMaterializationWorkerEnabled({ OPENCREDIT_MATERIALIZATION_WORKER_ENABLED: "1" }), false);
  assert.equal(isOpenCreditMaterializationWorkerEnabled({ OPENCREDIT_MATERIALIZATION_WORKER_ENABLED: "true" }), true);
});

test("cycle recovers, expires, claims and processes sequentially without stopping after one lease failure", async () => {
  const order: string[] = [];
  const logs: unknown[] = [];
  const worker = createOpenCreditMaterializationWorker({
    queue: {
      async recover(limit) { order.push(`recover:${limit}`); return [{ id: "recovered" }]; },
      async expire(limit) { order.push(`expire:${limit}`); return [{ id: "expired" }]; },
      async claim(limit) {
        order.push(`claim:${limit}`);
        return [
          { id: "a", leaseToken: "token-a" },
          { id: "b", leaseToken: "token-b" },
        ];
      },
    },
    materializer: {
      async process(lease) {
        order.push(`process:${lease.id}`);
        if (lease.id === "a") throw new Error("synthetic");
      },
    },
    log: event => logs.push(event),
  }, { batchSize: 4 });

  assert.deepEqual(await worker.runOnce(), {
    skipped: false,
    recovered: 1,
    expired: 1,
    claimed: 2,
    processed: 1,
    failed: 1,
  });
  assert.deepEqual(order, ["recover:4", "expire:4", "claim:4", "process:a", "process:b"]);
  assert.deepEqual(logs, [{
    event: "opencredit_materialization_worker_cycle",
    skipped: false,
    recovered: 1,
    expired: 1,
    claimed: 2,
    processed: 1,
    failed: 1,
  }]);
});

test("overlapping cycles are rejected and start is idempotent", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let recoverCalls = 0;
  const worker = createOpenCreditMaterializationWorker({
    queue: {
      async recover() { recoverCalls++; await gate; return []; },
      async expire() { return []; },
      async claim() { return []; },
    },
    materializer: { async process() {} },
  });

  const first = worker.runOnce();
  assert.deepEqual(await worker.runOnce(), { skipped: true });
  release();
  await first;
  assert.equal(recoverCalls, 1);

  assert.equal(worker.start(), true);
  assert.equal(worker.start(), false);
  assert.equal(worker.isRunning(), true);
  worker.stop();
  assert.equal(worker.isRunning(), false);
});

test("worker options reject non-positive values", () => {
  const deps = {
    queue: {
      async recover() { return []; },
      async expire() { return []; },
      async claim() { return []; },
    },
    materializer: { async process() {} },
  };
  assert.throws(() => createOpenCreditMaterializationWorker(deps, { intervalMs: 0 }), /INVALID_MATERIALIZATION_WORKER_INTERVAL/);
  assert.throws(() => createOpenCreditMaterializationWorker(deps, { batchSize: 0 }), /INVALID_MATERIALIZATION_WORKER_BATCH_SIZE/);
});
