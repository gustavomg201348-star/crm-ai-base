import { spawn } from "node:child_process";

const [, , ...commandParts] = process.argv;

if (commandParts.length === 0) {
  console.error("Usage: node prisma/retry-command.mjs <command...>");
  process.exit(1);
}

const maxAttempts = Number(process.env.DB_COMMAND_RETRIES || 6);
const delayMs = Number(process.env.DB_COMMAND_RETRY_DELAY_MS || 10000);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand() {
  return new Promise((resolve) => {
    const child = spawn(commandParts.join(" "), {
      shell: true,
      stdio: "inherit",
      env: process.env
    });

    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", (error) => {
      console.error(error);
      resolve(1);
    });
  });
}

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const code = await runCommand();

  if (code === 0) {
    process.exit(0);
  }

  if (attempt === maxAttempts) {
    console.error(`Command failed after ${maxAttempts} attempts.`);
    process.exit(code);
  }

  console.warn(`Command failed. Retrying in ${delayMs / 1000}s (${attempt}/${maxAttempts})...`);
  await wait(delayMs);
}
