import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { requireCompanyAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { configureCltCampaign } from "@/lib/chatbot-clt-admin-config";
import { ChatbotError } from "@/lib/chatbot-definition";
import { safeLogError } from "@/lib/safe-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some(key => !["campaignId", "buttonTitle"].includes(key))) {
      return NextResponse.json({ error: "Configuracao invalida." }, { status: 400 });
    }
    const { campaignId, buttonTitle } = body as Record<string, unknown>;
    if (typeof campaignId !== "string" || typeof buttonTitle !== "string") {
      return NextResponse.json({ error: "Configuracao invalida." }, { status: 400 });
    }
    const binding = await configureCltCampaign(prisma, {
      companyId: session.companyId, actorUserId: session.id, campaignId, buttonTitle
    });
    return NextResponse.json({ binding, executable: false });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return NextResponse.json({ error: error.code }, {
        status: error.code === "FORBIDDEN" ? 403 : error.code === "BINDING_CONFLICT" ? 409 : 400
      });
    }
    safeLogError("http-api", error, { operation: "clt-chatbot-config" });
    return NextResponse.json({ error: "Nao foi possivel configurar a automacao." }, { status: 500 });
  }
}
