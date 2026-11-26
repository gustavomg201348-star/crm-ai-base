import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { requireCompanyAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { cltAuthorityDatabase } from "@/lib/chatbot-clt-runtime";
import { setCltCompanyEnabled } from "@/lib/chatbot-clt-company-control";
import { safeLogError } from "@/lib/safe-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;
    const company = await prisma.company.findUniqueOrThrow({ where: { id: session.companyId }, select: { cltChatbotEnabled: true } });
    return NextResponse.json({ enabled: company.cltChatbotEnabled }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    safeLogError("http-api", error, { operation: "clt-company-chatbot-read" });
    return NextResponse.json({ error: "Status indisponivel." }, { status: 500 });
  }
}
export async function PATCH(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).join(",") !== "enabled" || typeof body.enabled !== "boolean")
      return NextResponse.json({ error: "Configuracao invalida." }, { status: 400 });
    const result = await setCltCompanyEnabled(cltAuthorityDatabase, { companyId: session.companyId, actorUserId: session.id, enabled: body.enabled });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    safeLogError("http-api", error, { operation: "clt-company-chatbot-toggle" });
    return NextResponse.json({ error: "Nao foi possivel confirmar a alteracao." }, { status: 500 });
  }
}
