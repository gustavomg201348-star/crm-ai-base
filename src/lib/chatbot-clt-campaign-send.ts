import { prisma } from "@/lib/db";
import { findOrCreateConversationForChannel } from "./conversation-lifecycle.service";
import { authorityStorage, type AuthorityTx } from "./conversation-authority-storage";
import { conversationAuthorityTransactionCore } from "./conversation-authority.service";
import { createOutboundOperationService } from "./outbound-operation.service";
import { normalizeContactPhone } from "./contacts";
import { CltPilotSendConflict } from "./chatbot-clt-outbound-policy";
import { AuthorityError, type AuthorityScope } from "./conversation-authority-contract";

const database = { db: prisma,
  provider: /^postgres(?:ql)?:/.test(process.env.DATABASE_URL ?? "") ? "postgresql" as const : "sqlite" as const };
const storage = authorityStorage(database);
const authority = conversationAuthorityTransactionCore(database);
const outbound = createOutboundOperationService(database);

export type CltCampaignPermit = AuthorityScope & { operationId: string; token: string; dispatchedAt: Date };

export async function beginCltCampaignSend(input: { companyId: string; channelId: string; campaignId: string;
  recipientId: string; contactId: string; destination: string }): Promise<CltCampaignPermit | null | undefined> {
  const { companyId, channelId, campaignId, recipientId, contactId, destination } = input;
  const enrolled = await prisma.campaignRecipient.findMany({ where: { contactId, campaign: {
    companyId, channelId, cltChatbotBinding: { enabled: true, enabledAt: { not: null } }
  } }, select: { id: true, campaignId: true }, take: 2 });
  if (!enrolled.length) {
    const previous = await prisma.chatbotSession.findMany({ where: { companyId, channelId, contactId,
      runtimeActorId: { not: null } }, select: { conversationId: true, status: true } });
    if (previous.some(session => session.status === "ACTIVE") || previous.length > 0 &&
        await prisma.outboundOperation.findFirst({ where: { companyId, channelId, origin: "CHATBOT",
          conversationId: { in: previous.map(session => session.conversationId) }, status: { in: ["UNKNOWN", "DISPATCHING"] } },
        select: { id: true } })) throw new CltPilotSendConflict();
    return null;
  }
  if (enrolled.length !== 1 || enrolled[0].id !== recipientId) throw new CltPilotSendConflict();

  const operation = await storage.transaction(async tx => {
    if (database.provider === "postgresql") {
      await tx.$queryRaw`SELECT id FROM "Contact" WHERE id = ${contactId} AND "companyId" = ${companyId} FOR UPDATE`;
    }
    const binding = await tx.cltChatbotCampaignBinding.findFirst({ where: { companyId, channelId, campaignId, enabled: true } });
    if (!binding?.activatedByUserId) throw new CltPilotSendConflict();
    const contact = await tx.contact.findFirst({ where: { companyId, id: contactId, archivedAt: null } });
    if (!contact || normalizeContactPhone(contact.phone) !== destination) throw new CltPilotSendConflict();
    const recipient = await tx.campaignRecipient.findFirst({ where: { id: recipientId, campaignId, contactId, status: "PENDING" } });
    if (!recipient) return null;
    const conversation = await findOrCreateConversationForChannel({ db: tx, companyId, channelId, contactId, agentId: null });
    const scope = { companyId, channelId, conversationId: conversation.id };
    await storage.lockConversation(tx, companyId, conversation.id);
    let current = await tx.conversationAuthority.findFirst({ where: scope });
    const actorUserId = binding.activatedByUserId;
    const logicalKey = "clt:campaign:" + recipientId;
    if (!current) {
      await authority.initialize({ ...scope, actorUserId, logicalKey: logicalKey + ":queue", reason: "CLT_CAMPAIGN_SEND",
        state: conversation.agentId ? "HUMAN" : "HUMAN_QUEUE", ownerUserId: conversation.agentId })(tx);
      current = await storage.lock(tx, scope);
    }
    const existing = await tx.outboundOperation.findUnique({ where: { companyId_channelId_logicalKey: { companyId, channelId, logicalKey } } });
    if (existing && !["PREPARED", "RESERVED"].includes(existing.status)) return null;
    return existing ?? outbound.prepareCampaignInTransaction(tx, { ...scope, logicalKey, actorUserId,
      expectedGeneration: current.generation, payload: { campaignId, recipientId } });
  });
  if (!operation) return undefined;
  const scope = { companyId, channelId, conversationId: operation.conversationId, operationId: operation.id,
    expectedGeneration: operation.authorityGeneration };
  const reserved = await outbound.reserve(scope).catch(error => {
    if (error instanceof AuthorityError && ["INVALID_OPERATION_STATE", "RESERVATION_CONFLICT", "GENERATION_CONFLICT"].includes(error.code)) return null;
    throw error;
  });
  if (!reserved?.reservationToken) return undefined;
  const token = reserved.reservationToken;
  try {
    const permitted = await outbound.authorizeDispatch({ ...scope, token, validate: async tx => {
      const binding = await tx.cltChatbotCampaignBinding.findFirst({ where: { companyId, channelId, campaignId, enabled: true,
        campaign: { status: "SENDING" } } });
      if (!binding) throw new CltPilotSendConflict();
    } });
    return { ...scope, token, dispatchedAt: permitted.updatedAt };
  } catch (error) {
    await outbound.cancelBeforeDispatch({ ...scope, token });
    throw error;
  }
}

export function finishCltCampaignSend(permit: CltCampaignPermit, providerMessageId?: string, persist?: (tx: AuthorityTx) => Promise<void>) {
  return outbound.finish({ ...permit, ...(providerMessageId ? { status: "SENT", providerMessageId } : { status: "UNKNOWN" }) }, persist);
}
