import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { getSessionFromRequest } from "@/lib/auth";
import { requireCompanyAdmin } from "@/lib/permissions";
import { cltAuthorityDatabase } from "@/lib/chatbot-clt-runtime";
import { createOutboundOperationService } from "@/lib/outbound-operation.service";
import { AuthorityError } from "@/lib/conversation-authority-contract";
import { safeLogError } from "@/lib/safe-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function unknownOperations(companyId: string, campaignId: string): Promise<Prisma.OutboundOperationWhereInput | null> {
  const { db } = cltAuthorityDatabase;
  const binding = await db.cltChatbotCampaignBinding.findFirst({ where: { companyId, campaignId }, select: { channelId: true } });
  if (!binding) return null;
  return { companyId, channelId: binding.channelId, status: "UNKNOWN", OR: [
    { origin: "CHATBOT", authority: { conversation: { chatbotSessions: { some: { companyId,
      channelId: binding.channelId, campaignId, runtimeActorId: { not: null } } } } } },
    { origin: "HUMAN", logicalKey: { startsWith: "clt:human:" }, authority: { conversation: { contact: {
      campaignRecipients: { some: { campaignId } }
    } } } },
    { origin: "CAMPAIGN", logicalKey: { startsWith: "clt:campaign:" }, authority: { conversation: { contact: {
      campaignRecipients: { some: { campaignId } }
    } } } }
  ] };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    const forbidden = requireCompanyAdmin(session);
    if (forbidden) return forbidden;
    const campaignId = request.nextUrl.searchParams.get("campaignId");
    const where = campaignId && await unknownOperations(session.companyId, campaignId);
    if (!where) return NextResponse.json({ error: "BINDING_NOT_FOUND" }, { status: 404 });
    const operations = await cltAuthorityDatabase.db.outboundOperation.findMany({
      where, select: { id: true, origin: true, conversationId: true, updatedAt: true },
      orderBy: { updatedAt: "asc" }, take: 100
    });
    return NextResponse.json({ operations }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    safeLogError("http-api", error, { operation: "clt-unknown-list" });
    return NextResponse.json({ error: "UNAVAILABLE" }, { status: 500 });
  }
}

const reference = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200 && v.trim() === v;

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    const forbidden = requireCompanyAdmin(session);
    if (forbidden) return forbidden;
    const body = await request.json().catch(() => null);
    if (!body || !reference(body.campaignId) || !reference(body.operationId) || body.executorTerminated !== true ||
        !reference(body.evidenceReference) || !reference(body.logicalKey) ||
        (body.resolution !== "FAILED" && body.resolution !== "SENT") ||
        (body.resolution === "SENT" ? !reference(body.providerMessageId) : body.providerMessageId !== undefined)) {
      return NextResponse.json({ error: "INVALID_RECONCILIATION" }, { status: 400 });
    }
    const where = await unknownOperations(session.companyId, body.campaignId);
    const op = where && await cltAuthorityDatabase.db.outboundOperation.findFirst({ where: { ...where, id: body.operationId, status: { in: ["UNKNOWN", "SENT", "FAILED"] } },
      select: { id: true, channelId: true, conversationId: true, logicalKey: true, origin: true, payload: true } });
    // CAMPAIGN and CHATBOT ledger entries also carry the exact originating campaign/session.
    if (!op || op.origin === "CAMPAIGN" && JSON.parse(op.payload).content.campaignId !== body.campaignId ||
        op.origin === "CHATBOT" && !await cltAuthorityDatabase.db.chatbotSession.findFirst({ where: {
          id: JSON.parse(op.payload).content.sessionId, companyId: session.companyId,
          channelId: op.channelId, conversationId: op.conversationId, campaignId: body.campaignId
        }, select: { id: true } })) {
      return NextResponse.json({ error: "OPERATION_NOT_FOUND" }, { status: 404 });
    }
    const result = await createOutboundOperationService(cltAuthorityDatabase).reconcileUnknown({
      companyId: session.companyId, channelId: op.channelId, conversationId: op.conversationId, operationId: op.id,
      actorUserId: session.id, executorTerminated: true, logicalKey: "clt:reconcile:" + body.logicalKey,
      evidenceReference: body.evidenceReference, resolution: body.resolution, providerMessageId: body.providerMessageId
    });
    return NextResponse.json({ operationId: op.id, authorityEventId: result.id, status: body.resolution });
  } catch (error) {
    if (error instanceof AuthorityError) return NextResponse.json({ error: error.code }, { status: 409 });
    safeLogError("http-api", error, { operation: "clt-unknown-reconcile" });
    return NextResponse.json({ error: "UNAVAILABLE" }, { status: 500 });
  }
}
