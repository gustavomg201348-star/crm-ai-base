import { spawn } from "node:child_process";

function run(command, args, options = {}) {
  return spawn(command, args, {
    shell: true,
    stdio: "inherit",
    env: process.env,
    ...options
  });
}

const dbSync = run("node", [
  "prisma/retry-command.mjs",
  "npm",
  "run",
  "prisma:push:prod"
]);

dbSync.on("exit", (code) => {
  if (code === 0) {
    console.log("Database schema sync completed.");
  } else {
    console.error(`Database schema sync exited with code ${code}. App will keep running.`);
  }
});

const app = run("npm", ["run", "start"]);

function shutdown(signal) {
  dbSync.kill(signal);
  app.kill(signal);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

app.on("exit", (code) => {
  process.exit(code ?? 0);
});
