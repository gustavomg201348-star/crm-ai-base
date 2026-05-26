import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/permissions";

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }
    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const status = request.nextUrl.searchParams.get("status")?.trim();
    const channelId = request.nextUrl.searchParams.get("channelId")?.trim();
    const type = request.nextUrl.searchParams.get("type")?.trim();
    const take = Math.min(
      100,
      Math.max(10, Number(request.nextUrl.searchParams.get("take") ?? 50))
    );

    const messages = await prisma.message.findMany({
      where: {
        direction: "outbound",
        ...(status && status !== "ALL" ? { status } : {}),
        ...(type && type !== "ALL" ? { type } : {}),
        conversation: {
          ...(channelId ? { channel: `whatsapp:${channelId}` } : {}),
          contact: { companyId: session.companyId }
        }
      },
      include: {
        conversation: {
          include: {
            contact: {
              select: { id: true, name: true, phone: true }
            }
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take
    });

    return NextResponse.json({
      logs: messages.map((message) => {
        const channelRaw = message.conversation.channel;
        const resolvedChannelId = channelRaw.startsWith("whatsapp:")
          ? channelRaw.replace("whatsapp:", "")
          : null;

        return {
          id: message.id,
          conversationId: message.conversationId,
          contact: message.conversation.contact,
          channelId: resolvedChannelId,
          type: message.type,
          status: message.status,
          body: message.body,
          fileName: message.fileName,
          mimeType: message.mimeType,
          templateName: message.templateName,
          providerMessageId: message.providerMessageId,
          createdAt: message.createdAt,
          readAt: message.readAt
        };
      })
    });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel carregar logs de mensagens." },
      { status: 500 }
    );
  }
}
