import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import {
  getApprovedTemplatesForChannel,
  getApprovedTemplatesForConversation
} from "@/lib/whatsapp-template.service";

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const conversationId = request.nextUrl.searchParams.get("conversationId");
    const channelId = request.nextUrl.searchParams.get("channelId");
    if (!conversationId && !channelId) {
      return NextResponse.json(
        { error: "Informe a conversa ou canal." },
        { status: 400 }
      );
    }

    const templates = channelId
      ? await getApprovedTemplatesForChannel({
          channelId,
          companyId: session.companyId
        })
      : await getApprovedTemplatesForConversation({
          conversationId: conversationId!,
          companyId: session.companyId
        });

    return NextResponse.json({ templates });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel buscar templates."
      },
      { status: 500 }
    );
  }
}
