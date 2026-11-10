import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { spawn } from "node:child_process";
import { constants } from "node:os";
import { before, test } from "node:test";
import ts from "typescript";
import { createOpenCreditMaterializationWorker, startOpenCreditMaterializationWorkerFromRuntime } from "../src/lib/opencredit-materialization-worker";

type Event = { event: string; phase: string; attempted: boolean; workerResultReason: string | null };
type Boot = (options: { loadWorker(): Promise<{ startOpenCreditMaterializationWorkerFromRuntime(): Promise<unknown> }>; log(event: Event): unknown }) => Promise<{ workerResultReason: string }>;
type Railway = (options: { spawnChild(exe: string, args: string[], options: { shell: boolean }): EventEmitter;
  signals: EventEmitter; signalChild?(child: EventEmitter, signal: string): void; log(value: string): void }) => Promise<number>;
let boot: Boot, railway: Railway;
before(async () => {
  boot = (await import(pathToFileURL(resolve("scripts/opencredit-server-bootstrap.mjs")).href)).bootstrapOpenCreditServer;
  railway = (await import(pathToFileURL(resolve("scripts/railway-start.mjs")).href)).runRailwayStart;
});

for (const reason of ["started", "disabled", "invalid_mode", "already_running", "configuration_changed", "private-unknown-reason", "throw", "load_failure"])
  test("server preload proceeds to Next safely: " + reason, async () => {
    const order: string[] = [], logs: Event[] = [];
    const result = await boot({ log(event) { logs.push(event); order.push(event.phase); }, loadWorker: async () => {
      if (reason === "load_failure") throw Error("private-cpf-phone-token-SQL-error");
      return { async startOpenCreditMaterializationWorkerFromRuntime() {
        order.push("worker"); if (reason === "throw") throw Error("private-cpf-phone-token-SQL-error"); return { reason };
      } };
    } });
    const expected = ["private-unknown-reason", "throw", "load_failure"].includes(reason) ? "startup_error" : reason;
    assert.equal(result.workerResultReason, expected);
    assert.deepEqual(order, reason === "load_failure" ? ["worker_start", "next_start"] : ["worker_start", "worker", "next_start"]);
    assert.deepEqual(logs, [
      { event: "opencredit_server_bootstrap", phase: "worker_start", attempted: true, workerResultReason: null },
      { event: "opencredit_server_bootstrap", phase: "next_start", attempted: true, workerResultReason: expected },
    ]);
    assert(!JSON.stringify(logs).includes("private"));
  });

for (const failure of ["throw", "reject", "pending"]) test("preload logger isolated: " + failure, async () => {
  let calls = 0;
  const result = await boot({ loadWorker: async () => ({ async startOpenCreditMaterializationWorkerFromRuntime() { calls++; return { reason: "disabled" }; } }),
    log() { if (failure === "throw") throw Error("private"); return failure === "reject" ? Promise.reject(Error("private")) : new Promise(() => {}); } });
  assert.equal(calls, 1); assert.equal(result.workerResultReason, "disabled");
  await new Promise(resolve => setImmediate(resolve));
});

test("entrypoint and real instrumentation share the existing worker singleton", async () => {
  const runtime = globalThis as typeof globalThis & { __openCreditMaterializationWorkerV1?: ReturnType<typeof createOpenCreditMaterializationWorker> };
  const prior = runtime.__openCreditMaterializationWorkerV1; delete runtime.__openCreditMaterializationWorkerV1;
  const env = { OPENCREDIT_MATERIALIZATION_WORKER_ENABLED: "true", OPENCREDIT_MATERIALIZATION_WORKER_MODE: "NORMAL" };
  let factories = 0, claims = 0;
  const worker = createOpenCreditMaterializationWorker({ queue: { async recover() { return []; }, async expire() { return []; }, async claim() { claims++; return []; } },
    materializer: { async process() { throw Error("PROVIDER_FORBIDDEN"); } } }, { env });
  const start = () => startOpenCreditMaterializationWorkerFromRuntime(env, { async createWorker() { factories++; return worker; }, log() {} });
  try {
    assert.equal((await boot({ loadWorker: async () => ({ startOpenCreditMaterializationWorkerFromRuntime: start }), log() {} })).workerResultReason, "started");
    const source = ts.transpileModule(readFileSync("src/instrumentation.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const exports = {} as { register(): Promise<void> };
    const results: string[] = [];
    runInNewContext(source, { exports, process: { env: { NEXT_RUNTIME: "nodejs" } }, console: { info() {} }, require(name: string) {
      assert.equal(name, "./lib/opencredit-materialization-worker");
      return { async startOpenCreditMaterializationWorkerFromRuntime() { const result = await start(); results.push(result.reason); } };
    } });
    await exports.register(); assert.deepEqual(results, ["already_running"]); assert.equal(factories, 1);
    await worker.runOnce(); assert.equal(claims, 1); assert.equal(worker.isRunning(), true);
  } finally { worker.stop(); if (prior) runtime.__openCreditMaterializationWorkerV1 = prior; else delete runtime.__openCreditMaterializationWorkerV1; }
});

for (const mode of ["disabled", "invalid_mode"]) test("actual runtime gate prevents processing but permits Next: " + mode, async () => {
  const result = await boot({ log() {}, loadWorker: async () => ({ startOpenCreditMaterializationWorkerFromRuntime: () =>
    startOpenCreditMaterializationWorkerFromRuntime({ OPENCREDIT_MATERIALIZATION_WORKER_ENABLED: mode === "disabled" ? "false" : "true",
      OPENCREDIT_MATERIALIZATION_WORKER_MODE: mode === "disabled" ? "NORMAL" : "PRIVATE_INVALID" }, {
      async createWorker() { throw Error("DATABASE_OR_PROVIDER_FORBIDDEN"); }, log() {},
    }) }) });
  assert.equal(result.workerResultReason, mode);
});

test("real Node preloader permits the server main module with worker OFF, including a missing artifact", async () => {
  const child = spawn(process.execPath, ["--import", "./scripts/opencredit-server-preload.mjs", "-e", "console.log('SERVER_MAIN_REACHED')"], {
    env: { ...process.env, NODE_ENV: "production", OPENCREDIT_MATERIALIZATION_WORKER_ENABLED: "false" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = ""; child.stdout.on("data", data => { output += String(data); }); child.stderr.resume();
  const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  assert.equal(code, 0); assert.match(output, /SERVER_MAIN_REACHED/); assert.match(output, /opencredit_server_bootstrap/);
  assert(!output.includes("opencredit_materialization_worker_cycle"));
});

function wrapper() {
  const signals = new EventEmitter(), children: EventEmitter[] = [], args: string[][] = [], forwarded: string[] = [];
  let done = false;
  const result = railway({ signals, spawnChild(_exe, argv, options) {
    assert.equal(options.shell, false); args.push(argv); const child = new EventEmitter(); children.push(child); return child;
  }, signalChild(child, signal) { assert.equal(child, children.at(-1)); forwarded.push(signal); }, log() {} }).then(code => { done = true; return code; });
  return { signals, children, args, forwarded, result, done: () => done };
}
test("migrations gate the persistent serving child, and Next exit code is preserved without restart", async () => {
  const f = wrapper(); assert.equal(f.children.length, 1); assert.equal(f.done(), false);
  f.children[0].emit("exit", 0, null); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.args[1], ["--import", "./scripts/opencredit-server-preload.mjs", "node_modules/next/dist/bin/next", "start"]);
  assert.equal(f.done(), false); f.children[1].emit("exit", 23, null);
  assert.equal(await f.result, 23); assert.equal(f.children.length, 2); assert.equal(f.signals.listenerCount("SIGTERM"), 0);
});
test("migration failure never starts Next or worker", async () => {
  const f = wrapper(); f.children[0].emit("exit", 5, null); assert.equal(await f.result, 5); assert.equal(f.children.length, 1);
});
for (const signal of ["SIGTERM", "SIGINT"]) test("serving child receives " + signal + "; parent waits, then propagates status", async () => {
  const f = wrapper(); f.children[0].emit("exit", 0, null); await new Promise(resolve => setImmediate(resolve));
  f.signals.emit(signal); assert.deepEqual(f.forwarded, [signal]); assert.equal(f.done(), false);
  f.children[1].emit("exit", null, signal); assert.equal(await f.result, signal === "SIGTERM" ? 143 : 130);
  assert.equal(f.children.length, 2);
});
test("termination during migrations does not start a serving child", async () => {
  const f = wrapper(); f.signals.emit("SIGTERM"); f.children[0].emit("exit", 0, null);
  assert.equal(await f.result, 143); assert.equal(f.children.length, 1);
});
test("Next spawn failure is nonzero and never restarted", async () => {
  const f = wrapper(); f.children[0].emit("exit", 0, null); await new Promise(resolve => setImmediate(resolve));
  f.children[1].emit("error", Error("private")); assert.equal(await f.result, 1); assert.equal(f.children.length, 2);
});
test("Next crash signal is propagated as a nonzero conventional exit status", async () => {
  const f = wrapper(); f.children[0].emit("exit", 0, null); await new Promise(resolve => setImmediate(resolve));
  f.children[1].emit("exit", null, "SIGABRT"); assert.equal(await f.result, 128 + constants.signals.SIGABRT); assert.equal(f.children.length, 2);
});

test("Linux container signal forwarding terminates the real serving process group without an orphan", {
  skip: process.platform === "win32", timeout: 10000,
}, async t => {
  const signals = new EventEmitter(); let calls = 0, terminated = false;
  let closed = Promise.resolve();
  let serving: ReturnType<typeof spawn> | undefined;
  t.after(() => { if (serving && serving.exitCode === null) serving.kill("SIGKILL"); });
  const result = railway({ signals, log() {}, spawnChild(_exe, _args, options) {
    if (calls++ === 0) { const migration = new EventEmitter(); queueMicrotask(() => migration.emit("exit", 0, null)); return migration; }
    serving = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{console.log('TERMINATED');process.exit(0)});console.log('READY');setInterval(()=>{},1000)"], {
      ...options, detached: true, stdio: ["ignore", "pipe", "pipe"],
    });
    serving.stderr?.resume();
    closed = new Promise<void>(resolve => serving!.once("close", () => resolve()));
    serving.stdout?.on("data", data => {
      if (String(data).includes("TERMINATED")) terminated = true;
      if (String(data).includes("READY")) signals.emit("SIGTERM");
    });
    return serving;
  } });
  assert.equal(await result, 0); await closed; assert.equal(terminated, true); assert.equal(serving?.exitCode, 0);
});

test("worker remains alive in the same persistent serving process across cycles", async () => {
  const code = `
    import { bootstrapOpenCreditServer } from './scripts/opencredit-server-bootstrap.mjs';
    import { createOpenCreditMaterializationWorker, startOpenCreditMaterializationWorkerFromRuntime } from './src/lib/opencredit-materialization-worker.ts';
    const env={OPENCREDIT_MATERIALIZATION_WORKER_ENABLED:'true',OPENCREDIT_MATERIALIZATION_WORKER_MODE:'NORMAL'};
    let cycles=0,finish; const owner=process.pid;const done=new Promise(resolve=>{finish=resolve});
    const worker=createOpenCreditMaterializationWorker({queue:{async recover(){return []},async expire(){return []},async claim(){cycles++;if(process.pid!==owner)throw Error('WRONG_PROCESS');if(cycles>=2)finish();return []}},materializer:{async process(){throw Error('PROVIDER_FORBIDDEN')}}},{env});
    await bootstrapOpenCreditServer({loadWorker:async()=>({startOpenCreditMaterializationWorkerFromRuntime:()=>startOpenCreditMaterializationWorkerFromRuntime(env,{async createWorker(){return worker},log(){}})}),log(){}});
    console.log('SERVING');
    const watchdog=setTimeout(()=>{worker.stop();process.exit(1)},8000);
    await done;worker.stop();clearTimeout(watchdog);console.log('PERSISTENT_PASS');process.exit(0);
  `;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", data => { output += String(data); });
  child.stderr.resume();
  const codeResult = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  assert.equal(codeResult, 0); assert.equal(output.trim(), "SERVING\nPERSISTENT_PASS");
});
