import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { enforceRateLimits, getRequestIpKey } from "@/lib/rate-limit";
import { resolveOpenCreditWebhookSecret } from "@/lib/opencredit-secrets";
import { createPassiveInboundHandler } from "@/lib/opencredit-passive-inbound-handler";
import { persistPassiveInbound } from "@/lib/opencredit-passive-inbound.service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest, context: { params: Promise<{ publicWebhookId: string }> }) {
  return createPassiveInboundHandler({
    lookup: publicWebhookId => prisma.openCreditIntegration.findUnique({ where: { publicWebhookId }, select: { id: true, companyId: true, providerScope: true, enabled: true, webhookSecret: true } }).then(row => row?.providerScope ? { ...row, providerScope: row.providerScope } : null),
    secret: resolveOpenCreditWebhookSecret,
    limit: binding => enforceRateLimits(binding ? [
      { category: "opencredit-passive-authenticated", identifiers: [binding.companyId, binding.providerScope, binding.id], limit: 120, windowMs: 60000 },
    ] : [
      { category: "opencredit-passive-global", identifiers: ["ingress"], limit: 600, windowMs: 60000 },
      { category: "opencredit-passive-ip", identifiers: [getRequestIpKey(request)], limit: 120, windowMs: 60000 },
    ]),
    persist: (receipt, deadline) => persistPassiveInbound(prisma, receipt, deadline),
  })(request, context);
}
