import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { getApprovedTemplatesForConversation } from "@/lib/whatsapp-template.service";

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const conversationId = request.nextUrl.searchParams.get("conversationId");
    if (!conversationId) {
      return NextResponse.json({ error: "Informe a conversa." }, { status: 400 });
    }

    const templates = await getApprovedTemplatesForConversation({
      conversationId,
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
