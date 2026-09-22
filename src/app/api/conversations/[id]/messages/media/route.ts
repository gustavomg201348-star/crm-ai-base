import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { resolveConversationAccess } from "@/lib/conversation-access-control";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { saveFailedOutboundMessage } from "@/lib/message-delivery";
import { safeLogError } from "@/lib/safe-logger";
import { enforceRateLimits, rateLimitPolicies } from "@/lib/rate-limit";
import { maxMediaSize, sendConversationMedia } from "@/lib/whatsapp-media.service";

type RouteContext = {
  params: { id: string };
};

export async function POST(request: NextRequest, context: RouteContext) {
  let authorizedConversation: { id: string; companyId: string } | null = null;

  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const access = await resolveConversationAccess({
      db: prisma,
      session,
      conversationId: context.params.id
    });

    if (access.status === "not_found") {
      return NextResponse.json({ error: "Conversa nao encontrada." }, { status: 404 });
    }

    if (access.status === "forbidden") {
      return NextResponse.json({ error: "Conversa atribuida a outro atendente." }, { status: 403 });
    }

    const limited = await enforceRateLimits([
      {
        category: "media-upload",
        identifiers: [session.companyId, session.id],
        ...rateLimitPolicies.mediaUpload
      }
    ]);
    if (limited) return limited;

    authorizedConversation = { id: access.conversation.id, companyId: session.companyId };

    const formData = await request.formData();
    const file = formData.get("file");
    const caption = formData.get("caption");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Arquivo obrigatorio." }, { status: 400 });
    }

    if (file.size > maxMediaSize) {
      return NextResponse.json(
        { error: "Arquivo acima do limite de 16 MB." },
        { status: 400 }
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const conversation = await sendConversationMedia({
      conversationId: authorizedConversation.id,
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

    if (authorizedConversation) {
      await saveFailedOutboundMessage({
        companyId: authorizedConversation.companyId,
        conversationId: authorizedConversation.id,
        body: "Falha ao enviar midia.",
        type: "document",
        errorMessage: message
      }).catch(() => null);
    }

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
