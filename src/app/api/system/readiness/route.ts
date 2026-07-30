import { spawn } from "node:child_process";
import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireCompanyAdmin } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_MAINTENANCE_OUTPUT_LENGTH = 12000;

async function runCheck(name: string, check: () => Promise<unknown>) {
  try {
    await check();
    return { name, ok: true };
  } catch {
    return { name, ok: false, error: "CHECK_FAILED" };
  }
}

function sanitizeMaintenanceOutput(value: string) {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[DATABASE_URL_MASKED]")
    .replace(/prisma:\/\/[^\s"']+/gi, "[DATABASE_URL_MASKED]")
    .slice(-MAX_MAINTENANCE_OUTPUT_LENGTH);
}

function runMaintenanceCommand(command: string, args: string[]) {
  return new Promise<{ code: number; output: string }>((resolve) => {
    let output = "";

    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: true
    });

    const append = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > MAX_MAINTENANCE_OUTPUT_LENGTH * 2) {
        output = output.slice(-MAX_MAINTENANCE_OUTPUT_LENGTH);
      }
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", () => {
      output += "\nCOMMAND_FAILED";
      resolve({ code: 1, output: sanitizeMaintenanceOutput(output) });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, output: sanitizeMaintenanceOutput(output) });
    });
  });
}

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }

    const blocked = requireCompanyAdmin(session);
    if (blocked) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    if (
      request.nextUrl.searchParams.get("maintenance") === "db-push" ||
      request.nextUrl.searchParams.get("action") === "db-push"
    ) {
      if (request.nextUrl.searchParams.get("confirm") !== "apply") {
        return NextResponse.json(
          { ok: false, error: "MAINTENANCE_CONFIRMATION_REQUIRED" },
          { status: 400 }
        );
      }

      const startedAt = new Date();
      const result = await runMaintenanceCommand("npm", ["run", "prisma:push:prod"]);

      return NextResponse.json({
        ok: result.code === 0,
        code: result.code,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        output: result.output
      });
    }

    const [currentCompany, users, contacts, channels, conversations, messages, stages] =
      await Promise.all([
        prisma.company.findUnique({
          where: { id: session.companyId },
          select: { id: true }
        }),
        prisma.user.count({ where: { companyId: session.companyId } }),
        prisma.contact.count({ where: { companyId: session.companyId } }),
        prisma.channel.findMany({
          where: { companyId: session.companyId, type: "whatsapp" },
          select: {
            provider: true,
            phoneNumberId: true,
            wabaId: true,
            accessToken: true,
            verifyToken: true,
            appSecret: true,
            status: true
          }
        }),
        prisma.conversation.count({
          where: { contact: { companyId: session.companyId } }
        }),
        prisma.message.count({
          where: { conversation: { contact: { companyId: session.companyId } } }
        }),
        prisma.pipelineStage.count({ where: { companyId: session.companyId } })
      ]);

    const checks = await Promise.all([
      runCheck("contact-count-current-company", () =>
        prisma.contact.count({ where: { companyId: session.companyId } })
      ),
      runCheck("kanban-stage-query", () =>
        prisma.pipelineStage.findMany({
          where: { companyId: session.companyId },
          select: { id: true },
          take: 1
        })
      ),
      runCheck("kanban-unstaged-query", () =>
        prisma.contact.findMany({
          where: {
            companyId: session.companyId,
            archivedAt: null,
            stageId: null
          },
          select: { id: true },
          take: 1
        })
      ),
      runCheck("proposal-new-fields", () =>
        prisma.proposal.findFirst({
          select: {
            id: true,
            updatedAt: true,
            assignedUserId: true,
            multicredClientId: true
          }
        })
      ),
      runCheck("proposal-history", () => prisma.proposalHistory.count()),
      runCheck("multicred-client", () => prisma.multicredClient.count())
    ]);

    const metaChannels = channels.filter((channel) => channel.provider === "meta");
    const readyMetaChannels = metaChannels.filter(
      (channel) =>
        channel.phoneNumberId &&
        channel.wabaId &&
        channel.accessToken &&
        (channel.verifyToken || process.env.META_VERIFY_TOKEN) &&
        ["ACTIVE", "CONNECTED"].includes(channel.status)
    );
    const failedChecks = checks.filter((check) => !check.ok);
    const ok = Boolean(currentCompany) && failedChecks.length === 0;

    return NextResponse.json({
      ok,
      status: ok ? "OK" : "DEGRADED",
      timestamp: new Date().toISOString(),
      app: {
        service: "crm-ai-base",
        environment: process.env.NODE_ENV ?? "unknown"
      },
      checks: {
        database: { ok: true },
        company: { ok: Boolean(currentCompany) },
        users: { ok: users > 0, count: users },
        contacts: { ok: true, count: contacts },
        conversations: { ok: true, count: conversations },
        messages: { ok: true, count: messages },
        stages: { ok: stages > 0, count: stages },
        queries: {
          ok: failedChecks.length === 0,
          items: checks
        },
        whatsapp: {
          ok: readyMetaChannels.length > 0 || metaChannels.length === 0,
          count: channels.length,
          metaCount: metaChannels.length,
          readyMetaCount: readyMetaChannels.length
        }
      }
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "READINESS_CHECK_FAILED" },
      { status: 500 }
    );
  }
}
