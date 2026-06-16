import { spawn } from "node:child_process";
import { NextResponse, type NextRequest } from "next/server";
import { getSessionOrUnauthorized, requireCompanyAdmin } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_OUTPUT_LENGTH = 12000;

function sanitizeOutput(value: string) {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[DATABASE_URL_MASKED]")
    .replace(/prisma:\/\/[^\s"']+/gi, "[DATABASE_URL_MASKED]")
    .slice(-MAX_OUTPUT_LENGTH);
}

function runCommand(command: string, args: string[]) {
  return new Promise<{ code: number; output: string }>((resolve) => {
    let output = "";

    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: true
    });

    const append = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > MAX_OUTPUT_LENGTH * 2) {
        output = output.slice(-MAX_OUTPUT_LENGTH);
      }
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => {
      output += `\n${error instanceof Error ? error.message : String(error)}`;
      resolve({ code: 1, output: sanitizeOutput(output) });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, output: sanitizeOutput(output) });
    });
  });
}

export async function GET(request: NextRequest) {
  const { session, response } = getSessionOrUnauthorized(request);
  if (response) return response;

  const blocked = requireCompanyAdmin(session);
  if (blocked) return blocked;

  const confirm = request.nextUrl.searchParams.get("confirm");
  if (confirm !== "apply-schema") {
    return NextResponse.json(
      {
        ok: false,
        error: "Confirme a execucao usando ?confirm=apply-schema.",
        action: "npm run prisma:push:prod"
      },
      { status: 400 }
    );
  }

  const startedAt = new Date();
  const result = await runCommand("npm", ["run", "prisma:push:prod"]);

  return NextResponse.json({
    ok: result.code === 0,
    code: result.code,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    command: "npm run prisma:push:prod",
    output: result.output
  });
}
