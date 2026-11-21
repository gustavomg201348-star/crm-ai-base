import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { createActivity } from "@/lib/activities";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { safeLogError } from "@/lib/safe-logger";
import { mapTask, taskInclude } from "@/lib/tasks";
import { parseTaskPage, taskPage, TaskPaginationError } from "@/lib/tasks-pagination";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);

    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }

    const query = parseTaskPage(request.nextUrl.searchParams, session);
    const tasks = await prisma.task.findMany({
      where: query.where,
      include: taskInclude,
      orderBy: [{ status: "asc" }, { dueAt: "asc" }, { id: "asc" }],
      take: query.limit + 1
    });

    const page = taskPage(tasks, query);
    return NextResponse.json({ ...page, tasks: page.tasks.map(mapTask) }, {
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch (error) {
    if (error instanceof TaskPaginationError) {
      return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
    }
    safeLogError("http-api", error, {
      route: "/api/tasks",
      method: "GET",
      publicErrorCode: "INTERNAL_ERROR",
      status: 500
    });

    return publicErrorResponse({ code: "INTERNAL_ERROR", status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);

    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | {
          contactId?: string;
          assigneeId?: string;
          title?: string;
          note?: string;
          dueAt?: string;
        }
      | null;
    const title = body?.title?.trim();
    const dueAt = body?.dueAt ? new Date(body.dueAt) : null;

    if (!body?.contactId || !title || !dueAt || Number.isNaN(dueAt.getTime())) {
      return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
    }

    const contact = await prisma.contact.findFirst({
      where: { id: body.contactId, companyId: session.companyId },
      select: { id: true, name: true }
    });

    if (!contact) {
      return publicErrorResponse({ code: "CONTACT_NOT_FOUND", status: 404 });
    }

    const assignee = body.assigneeId
      ? await prisma.user.findFirst({
          where: { id: body.assigneeId, companyId: session.companyId },
          select: { id: true }
        })
      : null;

    const task = await prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          companyId: session.companyId,
          contactId: contact.id,
          assigneeId: assignee?.id ?? session.id,
          title,
          note: body.note?.trim() || null,
          dueAt,
          status: "PENDING"
        },
        include: taskInclude
      });

      await createActivity(tx, {
        contactId: contact.id,
        userId: session.id,
        type: "TASK_CREATED",
        title: "Tarefa criada",
        detail: `${created.title} para ${created.dueAt.toLocaleString("pt-BR")}.`
      });

      return created;
    });

    return NextResponse.json({ task: mapTask(task) }, { status: 201 });
  } catch (error) {
    safeLogError("http-api", error, {
      route: "/api/tasks",
      method: "POST",
      companyId: (await getSessionFromRequest(request))?.companyId,
      currentUserId: (await getSessionFromRequest(request))?.id,
      publicErrorCode: "TASK_CREATE_FAILED",
      status: 500
    });

    return publicErrorResponse({ code: "TASK_CREATE_FAILED", status: 500 });
  }
}
