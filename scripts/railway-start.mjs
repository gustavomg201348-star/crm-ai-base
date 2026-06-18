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

const app = run("npm", ["run", "start"]);

async function runDatabaseMaintenance() {
  const dbSyncCode = await runAndWait("node", [
    "prisma/retry-command.mjs",
    "npm",
    "run",
    "prisma:push:prod"
  ]);

  if (dbSyncCode !== 0) {
    console.error(`Database schema sync exited with code ${dbSyncCode}. App remains running.`);
    return;
  }

  console.log("Database schema sync completed.");

  if (process.env.SEED_ADMIN_PASSWORD) {
    const seedCode = await runAndWait("node", [
      "prisma/retry-command.mjs",
      "npm",
      "run",
      "prisma:seed:prod"
    ]);

    if (seedCode === 0) {
      console.log("Seed completed.");
    } else {
      console.error(`Seed exited with code ${seedCode}. App remains running.`);
    }
  }
}

runDatabaseMaintenance().catch((error) => {
  console.error("Database maintenance failed.", error);
});

function shutdown(signal) {
  app.kill(signal);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

app.on("exit", (code) => {
  process.exit(code ?? 0);
});
