import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { saveFailedOutboundMessage } from "@/lib/message-delivery";
import { canAccessConversation } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";
import { maxMediaSize, sendConversationMedia } from "@/lib/whatsapp-media.service";

type RouteContext = {
  params: { id: string };
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const caption = formData.get("caption");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Arquivo obrigatorio." }, { status: 400 });
    }

    const current = await prisma.conversation.findFirst({
      where: { id: context.params.id, contact: { companyId: session.companyId } },
      select: { agentId: true }
    });

    if (!current) {
      return NextResponse.json({ error: "Conversa nao encontrada." }, { status: 404 });
    }

    if (!canAccessConversation({ session, agentId: current.agentId })) {
      return NextResponse.json({ error: "Conversa atribuida a outro atendente." }, { status: 403 });
    }

    if (file.size > maxMediaSize) {
      return NextResponse.json(
        { error: "Arquivo acima do limite de 16 MB." },
        { status: 400 }
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const conversation = await sendConversationMedia({
      conversationId: context.params.id,
      companyId: session.companyId,
      userId: session.id,
      fileName: file.name || "arquivo",
      mimeType: file.type || "application/octet-stream",
      bytes,
      caption: typeof caption === "string" ? caption : undefined
    });

    return NextResponse.json({ conversation });
  } catch (error) {
    const message = "Falha ao enviar midia.";

    await saveFailedOutboundMessage({
      conversationId: context.params.id,
      body: "Falha ao enviar midia.",
      type: "document",
      errorMessage: message
    }).catch(() => null);

    safeLogError("http-api", error, {
      operation: "conversation-media-send",
      route: "/api/conversations/[id]/messages/media",
      publicErrorCode: "MESSAGE_SEND_FAILED",
      status: 500,
      conversationId: context.params.id
    });

    return publicErrorResponse({
      code: "MESSAGE_SEND_FAILED",
      status: 500,
      message: "Nao foi possivel enviar midia."
    });
  }
}
