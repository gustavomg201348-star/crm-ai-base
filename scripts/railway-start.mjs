import { spawn } from "node:child_process";

function run(command, args, options = {}) {
  return spawn(command, args, {
    shell: true,
    stdio: "inherit",
    env: process.env,
    ...options
  });
}

function runAndWait(command, args) {
  return new Promise((resolve) => {
    const child = run(command, args);
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

let app;

async function main() {
  console.log("Running database migrations.");

  const migrationCode = await runAndWait("node", [
    "prisma/retry-command.mjs",
    "npm",
    "run",
    "prisma:migrate:prod"
  ]);

  if (migrationCode !== 0) {
    console.error(`Database migrations exited with code ${migrationCode}. Application will not start.`);
    process.exit(migrationCode);
  }

  console.log("Database migrations completed. Starting application.");

  app = run("npm", ["run", "start"]);
  app.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error("Startup failed.", error);
  process.exit(1);
});

function shutdown(signal) {
  if (app) {
    app.kill(signal);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
