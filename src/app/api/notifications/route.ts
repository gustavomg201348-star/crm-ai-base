import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { mapNotification, notificationInclude } from "@/lib/notifications";
import { prisma } from "@/lib/db";

function visibleNotificationWhere(session: { id: string; companyId: string }) {
  return {
    companyId: session.companyId,
    OR: [{ userId: session.id }, { userId: null }]
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const limit = Math.min(
      Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 20), 1),
      50
    );
    const unreadOnly = request.nextUrl.searchParams.get("unreadOnly") === "true";

    const where = {
      ...visibleNotificationWhere(session),
      ...(unreadOnly ? { readAt: null } : {})
    };

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        include: notificationInclude,
        orderBy: { createdAt: "desc" },
        take: limit
      }),
      prisma.notification.count({
        where: {
          ...visibleNotificationWhere(session),
          readAt: null
        }
      })
    ]);

    return NextResponse.json({
      unreadCount,
      notifications: notifications.map(mapNotification)
    });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel carregar notificacoes." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | { id?: string; conversationId?: string; all?: boolean }
      | null;

    const baseWhere = visibleNotificationWhere(session);
    const now = new Date();

    if (body?.all) {
      await prisma.notification.updateMany({
        where: { ...baseWhere, readAt: null },
        data: { readAt: now }
      });
    } else if (body?.conversationId) {
      await prisma.notification.updateMany({
        where: {
          ...baseWhere,
          conversationId: body.conversationId,
          readAt: null
        },
        data: { readAt: now }
      });
    } else if (body?.id) {
      await prisma.notification.updateMany({
        where: { ...baseWhere, id: body.id, readAt: null },
        data: { readAt: now }
      });
    } else {
      return NextResponse.json(
        { error: "Informe a notificacao ou conversa." },
        { status: 400 }
      );
    }

    const unreadCount = await prisma.notification.count({
      where: { ...baseWhere, readAt: null }
    });

    return NextResponse.json({ ok: true, unreadCount });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel atualizar notificacoes." },
      { status: 500 }
    );
  }
}
