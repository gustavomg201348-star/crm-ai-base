import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { constants } from "node:os";

const signalCode = signal => Number.isInteger(constants.signals[signal]) ? 128 + constants.signals[signal] : 1;
const forward = (child, signal) => {
  // Linux container: include subprocesses without signalling the wrapper itself.
  if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
  else child.kill(signal);
};

export async function runRailwayStart({ spawnChild = spawn, signals = process, signalChild = forward,
  log = value => console.log(value), executable = process.execPath, env = process.env } = {}) {
  let active, stopping;
  const emit = value => { try { log(value); } catch {} };
  const shutdown = signal => {
    stopping = signal;
    if (active) { try { signalChild(active, signal); } catch {} }
  };
  const term = () => shutdown("SIGTERM"), interrupt = () => shutdown("SIGINT");
  signals.on("SIGTERM", term); signals.on("SIGINT", interrupt);
  const run = args => new Promise(resolve => {
    let child;
    try { child = spawnChild(executable, args, { shell: false, stdio: "inherit", env, detached: process.platform !== "win32" }); }
    catch { resolve(1); return; }
    active = child;
    const done = code => { if (active === child) active = undefined; resolve(code); };
    child.once("error", () => done(1));
    child.once("exit", (code, signal) => done(code ?? signalCode(signal)));
  });
  try {
    emit("Running database migrations.");
    const code = await run(["prisma/retry-command.mjs", "npm", "run", "prisma:migrate:prod"]);
    if (code !== 0) { emit(`Database migrations exited with code ${code}. Application will not start.`); return code; }
    if (stopping) return signalCode(stopping);
    emit("Database migrations completed. Starting application.");
    // Persistent Next process owns the worker, not this migration wrapper.
    return await run(["--import", "./scripts/opencredit-server-preload.mjs", "node_modules/next/dist/bin/next", "start"]);
  } finally {
    signals.off("SIGTERM", term); signals.off("SIGINT", interrupt);
    if (active) { try { signalChild(active, "SIGTERM"); } catch {} }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = await runRailwayStart(); }
  catch { console.error("Server startup failed."); process.exitCode = 1; }
}
