import assert from "node:assert/strict";
import { spawn } from "node:child_process";

// Local/CI only: no HTTP request, no migration, worker always OFF.
const child = spawn(process.execPath, ["--import", "./scripts/opencredit-server-preload.mjs",
  "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "31987"], {
  env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", OPENCREDIT_MATERIALIZATION_WORKER_ENABLED: "false" },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "", ready = false, timedOut = false;
const watchdog = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 30000);
child.stderr.resume();
child.stdout.on("data", data => {
  output += String(data);
  if (output.length > 65536) { child.kill("SIGKILL"); return; }
  if (!ready && output.includes("Ready in")) { ready = true; child.kill("SIGTERM"); }
});
try {
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal }));
  });
  assert(ready && !timedOut && (result.code === 0 || result.signal === "SIGTERM"));
  const events = output.split(/\r?\n/).filter(line => line.startsWith("{")).map(line => JSON.parse(line));
  const boot = events.filter(event => event.event === "opencredit_server_bootstrap");
  assert.deepEqual(boot.map(event => event.phase), ["worker_start", "next_start"]);
  assert.equal(boot[1].workerResultReason, "disabled");
  assert(events.some(event => event.event === "opencredit_materialization_worker_startup" && event.reason === "disabled"));
  assert(!events.some(event => event.event === "opencredit_materialization_worker_cycle"));
  console.log("COMPILED_SERVER_SMOKE_PASS");
} catch {
  console.error("COMPILED_SERVER_SMOKE_FAIL"); process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}
