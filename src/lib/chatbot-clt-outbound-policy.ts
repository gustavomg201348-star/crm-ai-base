import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AuthorityError, type AuthorityScope } from "./conversation-authority-contract";
import { authorityStorage } from "./conversation-authority-storage";
import { conversationAuthorityTransactionCore } from "./conversation-authority.service";
import { createOutboundOperationService } from "./outbound-operation.service";
import { readMetaMessageId } from "./meta-whatsapp";

export class CltPilotSendConflict extends Error {
  constructor() { super("Atendimento CLT em automação ou aguardando reconciliação. Assuma a conversa antes de enviar."); }
}

type Reader = Pick<Prisma.TransactionClient, "campaignRecipient" | "conversation" | "conversationAuthority" | "outboundOperation">;

export function readCltEnrollment(db: Reader, { companyId, channelId, contactId }: Omit<AuthorityScope, "conversationId"> & { contactId: string }) {
  return db.campaignRecipient.findFirst({ where: { contactId, campaign: {
    companyId, channelId, cltChatbotBinding: { enabled: true, enabledAt: { not: null } }
  } }, select: { id: true, campaignId: true } });
}

async function readCltSendState(db: Reader, { companyId, channelId, conversationId }: AuthorityScope) {
  const conversation = await db.conversation.findFirst({ where: { id: conversationId, channelId, contact: { companyId } },
    select: { contactId: true, agentId: true, aiPaused: true,
      chatbotSessions: { where: { companyId, channelId, runtimeActorId: { not: null } }, take: 1, select: { id: true } },
      openCreditWhatsappMetas: { where: { companyId, channelId, state: "SENT" }, take: 1, select: { id: true } } } });
  if (!conversation) return null;
  const enrolled = Boolean(await readCltEnrollment(db, { companyId, channelId, contactId: conversation.contactId }));
  if (!enrolled && !conversation.chatbotSessions.length) return null;
  const authority = await db.conversationAuthority.findFirst({ where: { companyId, channelId, conversationId }, select: { state: true } });
  const chatbotOwns = authority?.state === "CHATBOT";
  const outstanding = !chatbotOwns && !!conversation.chatbotSessions.length && !!await db.outboundOperation.findFirst({
    where: { companyId, channelId, conversationId, origin: "CHATBOT", status: { in: ["DISPATCHING", "UNKNOWN"] } },
    select: { id: true }
  });
  return { conversation, authority, chatbotOwns, outstanding, enrolled };
}

export async function cltBlocksAiSend(db: Reader, scope: AuthorityScope) {
  const state = await readCltSendState(db, scope);
  if (!state) return false;
  if (state.chatbotOwns || state.outstanding || state.conversation.aiPaused && state.conversation.chatbotSessions.length > 0) return true;
  return state.enrolled && state.authority?.state !== "AI" && !state.conversation.openCreditWhatsappMetas.length;
}

export async function requireCltHumanSend(db: Reader, scope: AuthorityScope, userId: string) {
  const state = await readCltSendState(db, scope);
  const protectedConversation = state && (state.enrolled || state.conversation.chatbotSessions.length > 0);
  if (protectedConversation && (state.chatbotOwns || state.outstanding || state.conversation.agentId !== userId)) {
    throw new CltPilotSendConflict();
  }
  return Boolean(protectedConversation);
}

export async function withCltHumanSend<T>(db: PrismaClient, scope: AuthorityScope, userId: string, send: () => Promise<T>): Promise<T> {
  if (!await requireCltHumanSend(db, scope, userId)) return send();
  const database = { db, provider: /^postgres(?:ql)?:/.test(process.env.DATABASE_URL ?? "") ? "postgresql" as const : "sqlite" as const };
  const storage = authorityStorage(database);
  const authority = conversationAuthorityTransactionCore(database);
  const outbound = createOutboundOperationService(database);
  const logicalKey = "clt:human:" + randomUUID();
  let permit: { operationId: string; token: string } | undefined;
  try {
    const current = await storage.transaction(async tx => {
      const conversation = await storage.lockConversation(tx, scope.companyId, scope.conversationId);
      if (conversation.channelId !== scope.channelId || conversation.agentId !== userId) throw new CltPilotSendConflict();
      await requireCltHumanSend(tx, scope, userId);
      if (!await tx.conversationAuthority.findFirst({ where: scope })) {
        await authority.adoptSelfClaim({ ...scope, actorUserId: userId, logicalKey: logicalKey + ":claim", reason: "CLT_HUMAN_SEND" })(tx);
      }
      return storage.lock(tx, scope);
    });
    const operation = await outbound.prepare({ ...scope, actorUserId: userId, origin: "HUMAN", logicalKey,
      expectedGeneration: current.generation, payload: { kind: "clt_human_send" } });
    const request = { ...scope, operationId: operation.id, expectedGeneration: current.generation };
    const reserved = await outbound.reserve(request);
    if (!reserved?.reservationToken) {
      await outbound.cancelBeforeDispatch(request);
      throw new CltPilotSendConflict();
    }
    try {
      await outbound.authorizeDispatch({ ...request, token: reserved.reservationToken, validate: async tx => {
        await requireCltHumanSend(tx, scope, userId);
      } });
    } catch (error) {
      await outbound.cancelBeforeDispatch({ ...request, token: reserved.reservationToken });
      throw error;
    }
    permit = { operationId: operation.id, token: reserved.reservationToken };
  } catch (error) {
    if (error instanceof AuthorityError) throw new CltPilotSendConflict();
    throw error;
  }
  let response: T;
  try { response = await send(); }
  catch (error) {
    await outbound.finish({ ...scope, ...permit, status: "UNKNOWN" });
    throw error;
  }
  const providerMessageId = readMetaMessageId(response);
  await outbound.finish({ ...scope, ...permit, ...(providerMessageId ? { status: "SENT", providerMessageId } : { status: "UNKNOWN" }) });
  if (!providerMessageId) throw new CltPilotSendConflict();
  return response;
}
