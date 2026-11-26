import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { requireCompanyAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { cltBindingFields, configureCltCampaign, setCltCampaignEnabled } from "@/lib/chatbot-clt-admin-config";
import { cltAuthorityDatabase } from "@/lib/chatbot-clt-runtime";
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
    return NextResponse.json({ binding, executable: binding.enabled });
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

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).sort().join(",") !== "campaignId,enabled" ||
        typeof body.campaignId !== "string" || typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "Configuracao invalida." }, { status: 400 });
    }
    const binding = await setCltCampaignEnabled(cltAuthorityDatabase, { companyId: session.companyId,
      actorUserId: session.id, campaignId: body.campaignId, enabled: body.enabled });
    return NextResponse.json({ binding, executable: binding.enabled });
  } catch (error) {
    if (error instanceof ChatbotError) return NextResponse.json({ error: error.code }, { status:
      error.code === "FORBIDDEN" ? 403 : error.code === "BINDING_NOT_FOUND" ? 404 : error.code === "PAUSE_PENDING" ? 409 : 400 });
    safeLogError("http-api", error, { operation: "clt-chatbot-toggle" });
    return NextResponse.json({ error: "Nao foi possivel atualizar a automacao." }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;
    const campaignId = request.nextUrl.searchParams.get("campaignId");
    if (!campaignId) return NextResponse.json({ error: "Configuracao invalida." }, { status: 400 });
    const binding = await prisma.cltChatbotCampaignBinding.findFirst({ where: { companyId: session.companyId, campaignId }, select: cltBindingFields });
    if (!binding) return NextResponse.json({ error: "BINDING_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ binding, executable: binding.enabled }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    safeLogError("http-api", error, { operation: "clt-chatbot-read" });
    return NextResponse.json({ error: "Nao foi possivel consultar a automacao." }, { status: 500 });
  }
}
