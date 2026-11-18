import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canAccessConversation } from "@/lib/permissions";
import { readCltPrequalificationResult } from "@/lib/opencredit-clt-prequalification-store";
import { parsePrequalificationView, type PrequalificationView } from "@/lib/opencredit-clt-prequalification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const conversationId = (await context.params).id;
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, contact: { companyId: session.companyId } },
    select: { id: true, agentId: true }
  });
  if (!conversation) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!canAccessConversation({ session, agentId: conversation.agentId })) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const job = await prisma.openCreditCltPrequalification.findFirst({
    where: { companyId: session.companyId, conversationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, state: true, protectedResult: true, errorCode: true }
  });
  if (!job) return NextResponse.json({ prequalification: null }, { headers: { "Cache-Control": "no-store" } });

  let result: PrequalificationView["result"] = null;
  if (job.state === "COMPLETED" && job.protectedResult) {
    try { result = readCltPrequalificationResult(job.id, job.protectedResult); }
    catch {
      return NextResponse.json({ prequalification: parsePrequalificationView({ state: "FAILED", result: null, errorCode: "INVALID_RESPONSE" }) },
        { headers: { "Cache-Control": "no-store" } });
    }
  }
  const state = ["PENDING", "PROCESSING", "COMPLETED", "FAILED"].includes(job.state)
    ? job.state as PrequalificationView["state"] : "FAILED";
  const errorCode = state === "FAILED" && ["PROVIDER_UNAVAILABLE", "INVALID_RESPONSE", "CONFIGURATION"].includes(job.errorCode ?? "")
    ? job.errorCode as PrequalificationView["errorCode"] : null;
  return NextResponse.json({
    prequalification: parsePrequalificationView({ state, result, errorCode })
  }, { headers: { "Cache-Control": "no-store" } });
}
