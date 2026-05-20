import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { createActivity } from "@/lib/activities";
import { prisma } from "@/lib/db";
import { mapTask, taskInclude } from "@/lib/tasks";

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const contactId = request.nextUrl.searchParams.get("contactId") ?? "";
    const assigneeId = request.nextUrl.searchParams.get("assigneeId") ?? "";
    const status = request.nextUrl.searchParams.get("status") ?? "PENDING";

    const tasks = await prisma.task.findMany({
      where: {
        companyId: session.companyId,
        ...(contactId ? { contactId } : {}),
        ...(assigneeId ? { assigneeId } : {}),
        ...(status === "ALL" ? {} : { status })
      },
      include: taskInclude,
      orderBy: [{ status: "asc" }, { dueAt: "asc" }],
      take: 100
    });

    return NextResponse.json({ tasks: tasks.map(mapTask) });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel carregar tarefas." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
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
      return NextResponse.json(
        { error: "Contato, titulo e prazo sao obrigatorios." },
        { status: 400 }
      );
    }

    const contact = await prisma.contact.findFirst({
      where: { id: body.contactId, companyId: session.companyId },
      select: { id: true, name: true }
    });

    if (!contact) {
      return NextResponse.json({ error: "Contato nao encontrado." }, { status: 404 });
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
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel criar tarefa." },
      { status: 500 }
    );
  }
}
