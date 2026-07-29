import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { createActivity } from "@/lib/activities";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { safeLogError } from "@/lib/safe-logger";
import { mapTask, taskInclude } from "@/lib/tasks";
import { isAdmin } from "@/lib/permissions";

function isTaskStatus(value: unknown): value is "PENDING" | "DONE" {
  return value === "PENDING" || value === "DONE";
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }

    const { id } = await params;
    const current = await prisma.task.findFirst({
      where: { id, companyId: session.companyId }
    });

    if (!current) {
      return publicErrorResponse({ code: "TASK_NOT_FOUND", status: 404 });
    }

    const canManageAnyTask = isAdmin(session);
    if (!canManageAnyTask && current.assigneeId !== session.id) {
      return publicErrorResponse({ code: "USER_PERMISSION_DENIED", status: 403 });
    }

    const body = (await request.json().catch(() => null)) as
      | {
          status?: "PENDING" | "DONE";
          title?: string;
          note?: string | null;
          dueAt?: string;
          assigneeId?: string | null;
        }
      | null;
    const dueAt = body?.dueAt ? new Date(body.dueAt) : undefined;

    if (dueAt && Number.isNaN(dueAt.getTime())) {
      return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
    }

    if (body?.status !== undefined && !isTaskStatus(body.status)) {
      return publicErrorResponse({ code: "TASK_INVALID_STATE", status: 409 });
    }

    if (!canManageAnyTask && body?.assigneeId !== undefined) {
      return publicErrorResponse({ code: "TASK_ASSIGN_FAILED", status: 403 });
    }

    const assignee =
      body?.assigneeId !== undefined && body.assigneeId
        ? await prisma.user.findFirst({
            where: { id: body.assigneeId, companyId: session.companyId },
            select: { id: true }
          })
        : null;

    const task = await prisma.$transaction(async (tx) => {
      const updated = await tx.task.update({
        where: { id },
        data: {
          ...(body?.title !== undefined ? { title: body.title.trim() } : {}),
          ...(body?.note !== undefined ? { note: body.note?.trim() || null } : {}),
          ...(dueAt ? { dueAt } : {}),
          ...(body?.assigneeId !== undefined ? { assigneeId: assignee?.id ?? null } : {}),
          ...(body?.status !== undefined
            ? {
                status: body.status,
                completedAt: body.status === "DONE" ? new Date() : null
              }
            : {})
        },
        include: taskInclude
      });

      if (body?.status === "DONE" && current.status !== "DONE") {
        await createActivity(tx, {
          contactId: current.contactId,
          userId: session.id,
          type: "TASK_DONE",
          title: "Tarefa concluida",
          detail: current.title
        });
      }

      return updated;
    });

    return NextResponse.json({ task: mapTask(task) });
  } catch (error) {
    const session = getSessionFromRequest(request);
    const { id } = await params;

    safeLogError("http-api", error, {
      route: "/api/tasks/[id]",
      method: "PATCH",
      companyId: session?.companyId,
      currentUserId: session?.id,
      taskId: id,
      publicErrorCode: "TASK_UPDATE_FAILED",
      status: 500
    });

    return publicErrorResponse({ code: "TASK_UPDATE_FAILED", status: 500 });
  }
}
