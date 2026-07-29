import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { publicErrorResponse } from "@/lib/http-error-response";
import { safeLogError } from "@/lib/safe-logger";
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

    const templates = conversationId
      ? await getApprovedTemplatesForConversation({
          conversationId: conversationId!,
          companyId: session.companyId
        })
      : await getApprovedTemplatesForChannel({
          channelId: channelId!,
          companyId: session.companyId
        });

    return NextResponse.json({ templates });
  } catch (error) {
    safeLogError("http-api", error, {
      operation: "whatsapp-templates-list",
      route: "/api/whatsapp/templates",
      publicErrorCode: "TEMPLATE_FETCH_FAILED",
      status: 500
    });

    return publicErrorResponse({
      code: "TEMPLATE_FETCH_FAILED",
      status: 500
    });
  }
}
