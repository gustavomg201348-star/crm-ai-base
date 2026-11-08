import type { PrismaClient } from "@prisma/client";
import { validBootstrapChannel } from "./opencredit-whatsapp-policy";
import { authorityStorage, type AuthorityDatabase } from "./conversation-authority-storage";
import { conversationAuthorityTransactionCore } from "./conversation-authority.service";
import { createOutboundOperationService } from "./outbound-operation.service";
import { requireAuthority } from "./conversation-authority-contract";
type ReplyPolicy = (input: { companyMode?: string | null; conversationMode?: string | null; aiPaused?: boolean; agentId?: string | null }) => boolean;
export async function openCreditWhatsappCanAutoReply(db: Pick<PrismaClient, "conversation" | "company" | "conversationAuthority">, companyId: string, conversationId: string,
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

/** One native operation per verified inbound, captured BEFORE generating the reply. */
export async function prepareOpenCreditWhatsappAiReply(database: AuthorityDatabase, companyId: string, conversationId: string, policy: ReplyPolicy) {
  const storage = authorityStorage(database), core = conversationAuthorityTransactionCore(database);
  const operations = createOutboundOperationService(database);
  try {
    const plan = await storage.transaction(async tx => {
      const conversation = await storage.lockConversation(tx, companyId, conversationId);
      if (!await openCreditWhatsappCanAutoReply(tx, companyId, conversationId, policy)) return null;
      const scope = { companyId, conversationId, channelId: conversation.channelId! };
      const authority = await storage.lock(tx, scope);
      requireAuthority(conversation.agentId === null && authority.ownerUserId === null, "AUTHORITY_PROJECTION_DRIFT");
      const event = await tx.conversationInboundEvent.findFirst({ where: { ...scope, contactId: conversation.contactId,
        provenanceKind: "META_WEBHOOK_HMAC_SHA256_VERIFIED", provenanceVersion: 1 }, orderBy: { sequence: "desc" } });
      if (!event) return null;
      let generation = authority.generation;
      if (authority.state === "HUMAN_QUEUE") {
        const handoff = await tx.openCreditWhatsappHandoff.findFirstOrThrow({ where: { companyId, channelId: scope.channelId, metaConversationId: conversationId, state: "SENT" } });
        const config = await tx.openCreditWhatsappConfig.findFirstOrThrow({ where: { companyId, integrationId: handoff.integrationId, providerScope: handoff.providerScope } });
        const event = await core.transition({ ...scope, actorUserId: config.configuredByUserId,
          logicalKey: "oc-ai-authority:" + conversation.id + ":" + String(conversation.inboundEventSequence),
          reason: "OPENCREDIT_INBOUND_AI", expectedGeneration: generation, state: "AI", ownerUserId: null })(tx);
        generation = event.toGeneration;
      }
      requireAuthority(authority.state === "HUMAN_QUEUE" || authority.state === "AI", "AUTHORITY_DENIED");
      const channel = await tx.channel.findUniqueOrThrow({ where: { id: scope.channelId } });
      return { scope, generation, eventId: event.id, phoneNumberId: channel.phoneNumberId, wabaId: channel.wabaId };
    });
    if (!plan) return null;
    const operation = await operations.prepare({ ...plan.scope, expectedGeneration: plan.generation,
      logicalKey: "oc-ai-reply:" + plan.eventId, origin: "AI", payload: { kind: "OPENCREDIT_INBOUND_AI", inboundEventId: plan.eventId } });
    if (!["PREPARED", "RESERVED"].includes(operation.status)) return null;
    const destination: string = JSON.parse(operation.payload).destination;
    let token: string | undefined, dispatchAttempted = false;
    const finish = async (status: "SENT" | "UNKNOWN", providerMessageId?: string) => {
      if (status === "UNKNOWN" && await operations.cancelBeforeDispatch({ ...plan.scope, operationId: operation.id, token }).catch(() => false)) return;
      if (!token || !dispatchAttempted) return;
      await operations.finish({ ...plan.scope, operationId: operation.id, token, status,
        ...(status === "SENT" ? { providerMessageId } : {}) }).catch(() => {});
    };
    return {
      destination,
      cancel: () => finish("UNKNOWN"),
      async authorize(channel: { id: string; phoneNumberId: string | null; wabaId: string | null }) {
        try {
          requireAuthority(channel.id === plan.scope.channelId && channel.phoneNumberId === plan.phoneNumberId && channel.wabaId === plan.wabaId,
            "INVALID_CONVERSATION_SCOPE");
          const reserved = await operations.reserve({ ...plan.scope, operationId: operation.id, expectedGeneration: plan.generation });
          if (!reserved?.reservationToken) return false;
          token = reserved.reservationToken;
          dispatchAttempted = true;
          await operations.authorizeDispatch({ ...plan.scope, operationId: operation.id, expectedGeneration: plan.generation, token,
            validate: async tx => {
              requireAuthority(await openCreditWhatsappCanAutoReply(tx, companyId, conversationId, policy), "AUTHORITY_DENIED");
              const current = await tx.channel.findUniqueOrThrow({ where: { id: plan.scope.channelId } });
              requireAuthority(current.companyId === companyId && current.phoneNumberId === channel.phoneNumberId && current.wabaId === channel.wabaId,
                "INVALID_CONVERSATION_SCOPE");
              const latest = await tx.conversationInboundEvent.findFirst({ where: plan.scope, orderBy: { sequence: "desc" }, select: { id: true } });
              requireAuthority(latest?.id === plan.eventId, "INBOUND_CHANGED");
            } });
          return true;
        } catch { await finish("UNKNOWN"); return false; }
      },
      finish,
    };
  } catch { return null; }
}
