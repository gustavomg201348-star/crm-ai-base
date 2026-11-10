import { bootstrapOpenCreditServer } from "./opencredit-server-bootstrap.mjs";
import nextEnv from "@next/env";

// Node --import awaits this before running the unchanged Next CLI in THIS process.
// Next owns HTTP lifetime, signals and exit status; no worker-only child is spawned.
if (!process.env.NODE_ENV) process.env.NODE_ENV = "production";
nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
await bootstrapOpenCreditServer();
