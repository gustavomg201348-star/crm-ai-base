import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/permissions";
import { publicErrorResponse } from "@/lib/http-error-response";
import { safeLogError } from "@/lib/safe-logger";
import {
  nextSemMargemReturnWindow,
  semMargemAutomaticTaskId
} from "@/lib/sem-margem-return";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const conversations = await prisma.conversation.findMany({
      where: {
        contact: { companyId: session.companyId },
        tags: {
          some: {
            companyId: session.companyId,
            tag: {
              companyId: session.companyId,
              isActive: true,
              name: { equals: "Sem margem" }
            }
          }
        }
      },
      select: {
        id: true,
        agentId: true,
        updatedAt: true,
        contactId: true,
        contact: { select: { ownerId: true } }
      },
      orderBy: { updatedAt: "desc" },
      take: 5000
    });

    const candidates = new Map<
      string,
      { contactId: string; assigneeId: string }
    >();

    for (const conversation of conversations) {
      if (candidates.has(conversation.contactId)) continue;
      candidates.set(conversation.contactId, {
        contactId: conversation.contactId,
        assigneeId:
          conversation.agentId ??
          conversation.contact.ownerId ??
          session.id
      });
    }

    const { dueAt, dayStart, nextDay } = nextSemMargemReturnWindow();
    const contactIds = Array.from(candidates.keys());

    if (contactIds.length === 0) {
      return NextResponse.json({
        candidates: 0,
        created: 0,
        alreadyScheduled: 0,
        dueAt: dueAt.toISOString()
      });
    }

    const existing = await prisma.task.findMany({
      where: {
        companyId: session.companyId,
        contactId: { in: contactIds },
        title: "Retorno: Sem margem",
        status: "PENDING",
        dueAt: { gte: dayStart, lt: nextDay }
      },
      select: { contactId: true }
    });
    const alreadyScheduled = new Set(existing.map((task) => task.contactId));

    const missing = Array.from(candidates.values()).filter(
      (candidate) => !alreadyScheduled.has(candidate.contactId)
    );

    if (missing.length > 0) {
      await prisma.$transaction(
        missing.map((candidate) =>
          prisma.task.upsert({
            where: {
              id: semMargemAutomaticTaskId(
                session.companyId,
                candidate.contactId,
                dueAt
              )
            },
            update: {},
            create: {
              id: semMargemAutomaticTaskId(
                session.companyId,
                candidate.contactId,
                dueAt
              ),
              companyId: session.companyId,
              contactId: candidate.contactId,
              assigneeId: candidate.assigneeId,
              title: "Retorno: Sem margem",
              note: "Agendado automaticamente pela tag Sem margem.",
              dueAt,
              status: "PENDING"
            }
          })
        )
      );
    }

    return NextResponse.json({
      candidates: candidates.size,
      created: missing.length,
      alreadyScheduled: alreadyScheduled.size,
      dueAt: dueAt.toISOString()
    });
  } catch (error) {
    safeLogError("http-api", error, {
      route: "/api/tasks/sem-margem/backfill",
      method: "POST",
      publicErrorCode: "INTERNAL_ERROR",
      status: 500
    });
    return publicErrorResponse({
      code: "INTERNAL_ERROR",
      status: 500,
      message: "Nao foi possivel agendar os clientes Sem margem existentes."
    });
  }
}
