import { prisma } from "@/lib/db";
import { ingestOpenCreditLead } from "@/lib/opencredit-lead.service";
import { resolveOpenCreditWebhookSecret } from "@/lib/opencredit-secrets";
import { createOpenCreditWebhookHandler } from "@/lib/opencredit-webhook-handler";

export const runtime = "nodejs";
export const POST = createOpenCreditWebhookHandler({
  resolveIntegration: (publicWebhookId) => prisma.openCreditIntegration.findUnique({
    where: { publicWebhookId },
    select: { id: true, companyId: true, enabled: true, webhookSecret: true }
  }),
  resolveSecret: resolveOpenCreditWebhookSecret,
  ingest: (binding, payload, deadline) => ingestOpenCreditLead(prisma, binding, payload, deadline)
});
