import { bootstrapOpenCreditServer } from "./opencredit-server-bootstrap.mjs";
import nextEnv from "@next/env";
import { isMainThread } from "node:worker_threads";
import { resolve } from "node:path";

// Node --import awaits this before running the unchanged Next CLI in THIS process.
// Next owns HTTP lifetime, signals and exit status; no worker-only child is spawned.
// --import can be inherited by forks/worker threads. Only the serving CLI owns a worker.
const serving = isMainThread && process.argv[1]
  && resolve(process.argv[1]) === resolve("node_modules/next/dist/bin/next") && process.argv[2] === "start"
  && !process.argv.slice(3).some(arg => ["--help", "-h", "--version", "-v"].includes(arg));
if (serving) {
  if (!process.env.NODE_ENV) process.env.NODE_ENV = "production";
  nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  await bootstrapOpenCreditServer();
}
