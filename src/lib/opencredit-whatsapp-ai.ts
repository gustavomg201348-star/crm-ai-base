import type { PrismaClient } from "@prisma/client";
import { validBootstrapChannel } from "./opencredit-whatsapp-policy";
export async function openCreditWhatsappCanAutoReply(db: PrismaClient, companyId: string, conversationId: string,
  policy: (input: { companyMode?: string | null; conversationMode?: string | null; aiPaused?: boolean; agentId?: string | null }) => boolean) {
  const c = await db.conversation.findFirst({ where: { id: conversationId, contact: { companyId, archivedAt: null },
    openCreditWhatsappMetas: { some: { companyId, state: "SENT" } } }, include: { channelRef: true } });
  if (!c?.channelId || !c.lastInboundMessageAt || !validBootstrapChannel(c.channelRef, companyId)
    || !["OPEN", "PENDING", "BOT"].includes(c.status)) return false;
  const company = await db.company.findUnique({ where: { id: companyId }, select: { aiMode: true } });
  if (!company || !policy({ companyMode: company.aiMode, conversationMode: c.aiMode, aiPaused: c.aiPaused, agentId: c.agentId })) return false;
  const authority = await db.conversationAuthority.findFirst({ where: { companyId, channelId: c.channelId, conversationId } });
  return !!authority && ["AI", "HUMAN_QUEUE"].includes(authority.state) && authority.ownerUserId === null;
}
