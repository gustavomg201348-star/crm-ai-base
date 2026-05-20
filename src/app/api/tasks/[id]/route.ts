import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { createActivity } from "@/lib/activities";
import { prisma } from "@/lib/db";
import { mapTask, taskInclude } from "@/lib/tasks";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const { id } = await params;
    const current = await prisma.task.findFirst({
      where: { id, companyId: session.companyId }
    });

    if (!current) {
      return NextResponse.json({ error: "Tarefa nao encontrada." }, { status: 404 });
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
      return NextResponse.json({ error: "Prazo invalido." }, { status: 400 });
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
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel atualizar tarefa." },
      { status: 500 }
    );
  }
}
