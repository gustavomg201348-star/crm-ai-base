import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);

  if (!session) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }

  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  try {
    const command = process.platform === "win32" ? "npx.cmd" : "npx";
    const { stdout, stderr } = await execFileAsync(
      command,
      ["prisma", "db", "push", "--schema", "prisma/schema.postgres.prisma"],
      {
        cwd: process.cwd(),
        env: process.env,
        maxBuffer: 1024 * 1024 * 4,
        timeout: 120000
      }
    );

    return NextResponse.json({
      ok: true,
      stdout: stdout.slice(-4000),
      stderr: stderr.slice(-4000)
    });
  } catch (error) {
    const details =
      error instanceof Error
        ? {
            message: error.message,
            name: error.name
          }
        : { message: "Erro desconhecido." };

    return NextResponse.json(
      {
        ok: false,
        error: "Nao foi possivel sincronizar o schema.",
        details
      },
      { status: 500 }
    );
  }
}
