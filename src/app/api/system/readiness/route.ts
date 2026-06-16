import { spawn } from "node:child_process";
import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { contactInclude } from "@/lib/contacts";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_MAINTENANCE_OUTPUT_LENGTH = 12000;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function runCheck(name: string, check: () => Promise<unknown>) {
  try {
    await check();
    return { name, ok: true };
  } catch (error) {
    return { name, ok: false, error: getErrorMessage(error) };
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
    child.on("error", (error) => {
      output += `\n${error instanceof Error ? error.message : String(error)}`;
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
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    if (
      request.nextUrl.searchParams.get("maintenance") === "db-push" ||
      request.nextUrl.searchParams.get("action") === "db-push"
    ) {
      if (session.role !== "ADMIN") {
        return NextResponse.json(
          { ok: false, error: "Apenas ADMIN pode executar manutencao." },
          { status: 403 }
        );
      }

      if (request.nextUrl.searchParams.get("confirm") !== "apply") {
        return NextResponse.json(
          {
            ok: false,
            error: "Confirme usando maintenance=db-push&confirm=apply.",
            command: "npm run prisma:push:prod"
          },
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
        command: "npm run prisma:push:prod",
        output: result.output
      });
    }

    const [sessionUser, currentCompany, users, contacts, channels, conversations, messages] =
      await Promise.all([
        prisma.user.findUnique({
          where: { id: session.id },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            companyId: true,
            company: { select: { id: true, name: true, segment: true } }
          }
        }),
        prisma.company.findUnique({
          where: { id: session.companyId },
          select: { id: true, name: true, segment: true }
        }),
      prisma.user.count({ where: { companyId: session.companyId } }),
      prisma.contact.count({ where: { companyId: session.companyId } }),
      prisma.channel.findMany({
        where: { companyId: session.companyId, type: "whatsapp" },
        select: {
          id: true,
          name: true,
          provider: true,
          phoneNumberId: true,
          wabaId: true,
          displayPhone: true,
          accessToken: true,
          verifyToken: true,
          appSecret: true,
          status: true
        },
        orderBy: { createdAt: "asc" }
      }),
      prisma.conversation.count({
        where: { contact: { companyId: session.companyId } }
      }),
      prisma.message.count({
        where: { conversation: { contact: { companyId: session.companyId } } }
      })
    ]);

    const companyInventory = await prisma.company.findMany({
      select: {
        id: true,
        name: true,
        segment: true,
        _count: {
          select: {
            users: true,
            contacts: true,
            channels: true,
            proposals: true,
            stages: true
          }
        }
      },
      orderBy: { createdAt: "asc" },
      take: 20
    });

    const checks = await Promise.all([
      runCheck("contact-count-current-company", () =>
        prisma.contact.count({ where: { companyId: session.companyId } })
      ),
      runCheck("kanban-stage-query", () =>
        prisma.pipelineStage.findMany({
          where: { companyId: session.companyId },
          include: {
            contacts: {
              where: { archivedAt: null },
              include: contactInclude,
              take: 1
            }
          },
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
          include: contactInclude,
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

    const origin = request.nextUrl.origin;
    const webhookUrl = `${origin}/api/webhooks/whatsapp`;
    const metaChannels = channels.filter((channel) => channel.provider === "meta");
    const readyMetaChannels = metaChannels.filter(
      (channel) =>
        channel.phoneNumberId &&
        channel.wabaId &&
        channel.accessToken &&
        (channel.verifyToken || process.env.META_VERIFY_TOKEN) &&
        ["ACTIVE", "CONNECTED"].includes(channel.status)
    );

    return NextResponse.json({
      ok: true,
      app: {
        service: "crm-ai-base",
        environment: process.env.NODE_ENV ?? "unknown",
        timestamp: new Date().toISOString()
      },
      session: {
        cookieCompanyId: session.companyId,
        cookieUserId: session.id,
        cookieRole: session.role,
        databaseUser: sessionUser
          ? {
              id: sessionUser.id,
              email: sessionUser.email,
              name: sessionUser.name,
              role: sessionUser.role,
              companyId: sessionUser.companyId,
              company: sessionUser.company
            }
          : null,
        currentCompany
      },
      database: {
        ok: true,
        users,
        contacts,
        conversations,
        messages
      },
      companies: companyInventory.map((company) => ({
        id: company.id,
        name: company.name,
        segment: company.segment,
        users: company._count.users,
        contacts: company._count.contacts,
        channels: company._count.channels,
        proposals: company._count.proposals,
        stages: company._count.stages
      })),
      checks,
      whatsapp: {
        webhookUrl,
        totalChannels: channels.length,
        metaChannels: metaChannels.length,
        readyMetaChannels: readyMetaChannels.length,
        channels: channels.map((channel) => ({
          id: channel.id,
          name: channel.name,
          provider: channel.provider,
          displayPhone: channel.displayPhone,
          status: channel.status,
          hasPhoneNumberId: Boolean(channel.phoneNumberId),
          hasWabaId: Boolean(channel.wabaId),
          hasAccessToken: Boolean(channel.accessToken),
          hasVerifyToken: Boolean(channel.verifyToken || process.env.META_VERIFY_TOKEN),
          hasAppSecret: Boolean(channel.appSecret || process.env.META_APP_SECRET)
        }))
      }
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Nao foi possivel gerar diagnostico." },
      { status: 500 }
    );
  }
}
