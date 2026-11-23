import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/permissions";
import { publicErrorResponse } from "@/lib/http-error-response";
import { safeLogError } from "@/lib/safe-logger";
import {
  semMargemAutomaticTaskId,
  todaySemMargemReturnWindow
} from "@/lib/sem-margem-return";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const { dueAt, dayStart, nextDay } = todaySemMargemReturnWindow();

    const historicalAssignments = await prisma.conversationTag.findMany({
      where: {
        companyId: session.companyId,
        createdAt: { lt: dayStart },
        tag: {
          companyId: session.companyId,
          isActive: true,
          name: { equals: "Sem margem" }
        }
      },
      select: {
        createdAt: true,
        conversation: {
          select: {
            id: true,
            agentId: true,
            contactId: true,
            contact: { select: { ownerId: true } }
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 5000
    });

    const candidates = new Map<
      string,
      { contactId: string; assigneeId: string }
    >();

    for (const assignment of historicalAssignments) {
      const conversation = assignment.conversation;
      if (candidates.has(conversation.contactId)) continue;
      candidates.set(conversation.contactId, {
        contactId: conversation.contactId,
        assigneeId:
          conversation.agentId ??
          conversation.contact.ownerId ??
          session.id
      });
    }

    const contactIds = Array.from(candidates.keys());

    if (contactIds.length === 0) {
      return NextResponse.json({
        candidates: 0,
        created: 0,
        movedToToday: 0,
        alreadyScheduled: 0,
        dueAt: dueAt.toISOString()
      });
    }

    const existingTasks = await prisma.task.findMany({
      where: {
        companyId: session.companyId,
        contactId: { in: contactIds },
        title: "Retorno: Sem margem",
        status: "PENDING"
      },
      select: {
        id: true,
        contactId: true,
        dueAt: true,
        assigneeId: true
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }]
    });

    const tasksByContact = new Map<string, typeof existingTasks>();
    for (const task of existingTasks) {
      const current = tasksByContact.get(task.contactId) ?? [];
      current.push(task);
      tasksByContact.set(task.contactId, current);
    }

    let created = 0;
    let movedToToday = 0;
    let alreadyScheduled = 0;

    await prisma.$transaction(async (tx) => {
      for (const candidate of Array.from(candidates.values())) {
        const pending = tasksByContact.get(candidate.contactId) ?? [];
        const todayTask = pending.find(
          (task) => task.dueAt >= dayStart && task.dueAt < nextDay
        );

        if (todayTask) {
          alreadyScheduled += 1;
          continue;
        }

        if (pending.length > 0) {
          const canonical = pending[0];
          await tx.task.update({
            where: { id: canonical.id },
            data: {
              dueAt,
              assigneeId: canonical.assigneeId ?? candidate.assigneeId
            }
          });

          const duplicateAutomaticIds = pending
            .slice(1)
            .filter((task) => task.id.startsWith("sem-margem-"))
            .map((task) => task.id);

          if (duplicateAutomaticIds.length > 0) {
            await tx.task.deleteMany({
              where: {
                id: { in: duplicateAutomaticIds },
                companyId: session.companyId,
                contactId: candidate.contactId
              }
            });
          }

          movedToToday += 1;
          continue;
        }

        const id = semMargemAutomaticTaskId(
          session.companyId,
          candidate.contactId,
          dueAt
        );
        await tx.task.upsert({
          where: { id },
          update: {},
          create: {
            id,
            companyId: session.companyId,
            contactId: candidate.contactId,
            assigneeId: candidate.assigneeId,
            title: "Retorno: Sem margem",
            note: "Cliente Sem margem anterior a hoje, reposicionado para o retorno de hoje.",
            dueAt,
            status: "PENDING"
          }
        });
        created += 1;
      }
    });

    return NextResponse.json({
      candidates: candidates.size,
      created,
      movedToToday,
      alreadyScheduled,
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
