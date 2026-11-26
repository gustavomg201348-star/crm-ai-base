import type { ChatbotEvent, ChatbotSession, Message, OutboundOperation } from "@prisma/client";
import { authorityFingerprint, AuthorityError, type AuthorityScope } from "./conversation-authority-contract";
import { authorityStorage, type AuthorityDatabase, type AuthorityTx } from "./conversation-authority-storage";
import { conversationAuthorityTransactionCore } from "./conversation-authority.service";
import { createOutboundOperationService } from "./outbound-operation.service";
import { createMetaReplyCorrelation } from "./meta-reply-correlation.service";
import { readStoredCltCampaignTrigger } from "./chatbot-clt-campaign-binding-storage";
import { planChatbotExecution, type EnginePlan, type EngineState, type EngineVersion } from "./chatbot-execution-engine";
import { projectChatbotMetaReply } from "./chatbot-meta-reply-projection";
import { ChatbotError } from "./chatbot-definition";
import { canonicalChatbotValue } from "./chatbot-canonical";
import { buildChatbotMetaButtonPayload } from "./chatbot-meta-interactive-payload";
import { readReplySnapshot } from "./meta-reply-snapshot";
import { ReplyEvidencePersistenceError } from "./meta-reply-ingestion";
import { buildMetaTextMessagePayload, sendMetaChatbotMessage } from "./meta-whatsapp";
import { resolveChannelAccessToken } from "./channel-secrets";

const VERIFIED = "META_WEBHOOK_HMAC_SHA256_VERIFIED";
const WINDOW_MS = 24 * 60 * 60 * 1000;
const startKind = "CLT_START";
const triggerOptions = ["CONFERIR", "VERIFICAR"];
const runtimeSession = { status: "ACTIVE", runtimeActorId: { not: null } } as const;
const scopeOf = ({ companyId, channelId, conversationId }: AuthorityScope) => ({ companyId, channelId, conversationId });
const second = (date: Date) => Math.floor(date.getTime() / 1000);

type Command = { sessionId: string; eventId: string; promptId: string | null; handoff: boolean; step: EnginePlan["commands"][number]["payload"] };
type Transport = typeof sendMetaChatbotMessage;
type Handoff = (scope: AuthorityScope) => Promise<unknown>;

function envelope(operation: OutboundOperation): { destination: string; content: Command } {
  return JSON.parse(operation.payload);
}

export function createCltSessionRuntime(database: AuthorityDatabase, transport: Transport = sendMetaChatbotMessage, onHandoff?: Handoff) {
  const { db } = database;
  const storage = authorityStorage(database);
  const authority = conversationAuthorityTransactionCore(database);
  const outbound = createOutboundOperationService(database);
  const correlation = createMetaReplyCorrelation(db, { provider: database.provider });

  async function lockBinding(tx: AuthorityTx, scope: AuthorityScope, campaignId: string) {
    if (database.provider === "postgresql") {
      await tx.$queryRaw`SELECT "campaignId" FROM "CltChatbotCampaignBinding" WHERE "companyId" = ${scope.companyId}
        AND "channelId" = ${scope.channelId} AND "campaignId" = ${campaignId} FOR SHARE`;
    }
    return tx.cltChatbotCampaignBinding.findUnique({ where: { companyId_channelId_campaignId: {
      companyId: scope.companyId, channelId: scope.channelId, campaignId
    } } });
  }

  async function ingestVerified(tx: AuthorityTx, message: Message): Promise<boolean> {
    if (!message.metaReplySnapshot) return false;
    const snapshot = readReplySnapshot(message.metaReplySnapshot);
    const scope = scopeOf(snapshot);
    const inbound = await tx.conversationInboundEvent.findFirst({ where: { ...scope, messageId: message.id,
      contactId: snapshot.contactId, provenanceKind: VERIFIED, provenanceVersion: 1 } });
    if (!inbound || message.metaReplyConflictSnapshot) return false;
    let session = await tx.chatbotSession.findFirst({ where: { ...scope, ...runtimeSession } });
    let kind = snapshot.metadata.interactionType === "TEXT" ? "INBOUND_TEXT" : "INBOUND_OPTION";
    if (!session) {
      if (snapshot.metadata.interactionType !== "TEMPLATE_BUTTON" || !snapshot.metadata.optionId ||
          !triggerOptions.includes(snapshot.metadata.optionId) || !snapshot.contextProviderMessageId ||
          !snapshot.metadata.sourceTimestamp) return false;

      const enrolled = await tx.campaignRecipient.findFirst({ where: { contactId: snapshot.contactId,
        campaign: { companyId: scope.companyId, channelId: scope.channelId, cltChatbotBinding: { enabled: true } } },
        select: { id: true, status: true, campaign: { select: { status: true } } } });
      if (!enrolled) return false;
      const receipt = await correlation.processInTransaction(tx, { ...scope, messageId: message.id });
      if (!receipt || (["SOURCE_NOT_FOUND", "NO_CAMPAIGN"].includes(receipt.reason) &&
          enrolled.status === "PENDING" && enrolled.campaign.status === "SENDING" &&
          Math.abs(Date.now() - Date.parse(snapshot.metadata.sourceTimestamp)) < 60_000)) {
        throw new ReplyEvidencePersistenceError();
      }
      const match = await readStoredCltCampaignTrigger(tx, { ...scope, correlationId: receipt.id });
      if (!match || !receipt.campaignId || !receipt.campaignRecipientId) return false;

      const binding = await lockBinding(tx, scope, receipt.campaignId);
      const now = await storage.now(tx);
      const sourceTime = new Date(snapshot.metadata.sourceTimestamp);
      if (!binding?.enabled || !binding.enabledAt || !binding.activatedByUserId || binding.flowVersionId !== match.version.id ||
          sourceTime.getTime() > now.getTime() + 30_000 || now.getTime() - sourceTime.getTime() >= WINDOW_MS ||
          second(sourceTime) < second(binding.enabledAt)) return true;

      const recipient = await tx.campaignRecipient.findFirst({ where: { id: receipt.campaignRecipientId, campaignId: binding.campaignId,
        contactId: snapshot.contactId, conversationId: scope.conversationId, providerMessageId: snapshot.contextProviderMessageId,
        status: { in: ["SENT", "DELIVERED", "READ"] }, sentAt: { gte: binding.enabledAt } } });
      if (!recipient?.sentAt || second(sourceTime) < second(recipient.sentAt)) return true;
      const conversation = await storage.lockConversation(tx, scope.companyId, scope.conversationId);
      if (conversation.agentId || conversation.contactId !== snapshot.contactId ||
          !["OPEN", "PENDING", "BOT"].includes(conversation.status) ||
          await tx.openCreditWhatsappHandoff.findFirst({ where: { companyId: scope.companyId,
            channelId: scope.channelId, metaConversationId: scope.conversationId,
            state: { in: ["PREPARED", "DISPATCHING", "SENT", "UNKNOWN"] } }, select: { id: true } }) ||
          await tx.openCreditCltPrequalification.findFirst({ where: { ...scope, state: { in: ["PENDING", "PROCESSING"] } },
            select: { id: true } })) return false;
      const actor = await tx.user.findFirst({ where: { id: binding.activatedByUserId, companyId: scope.companyId, role: "ADMIN" } });
      if (!actor || await tx.chatbotSession.findFirst({ where: { companyId: scope.companyId, channelId: scope.channelId,
        contactId: snapshot.contactId, OR: [
        { activeConversationId: { not: null } },
        { campaignId: binding.campaignId, campaignRecipientId: recipient.id, runtimeActorId: { not: null } }
      ] }, select: { id: true } })) return true;

      const current = await tx.conversationAuthority.findFirst({ where: scope });
      if (current && (current.state !== "HUMAN_QUEUE" || current.ownerUserId ||
          await tx.outboundOperation.findFirst({ where: { authorityId: current.id, activeSlot: current.id }, select: { id: true } }))) return false;
      const intent = { ...scope, actorUserId: actor.id, reason: "CLT_VERIFIED_CAMPAIGN_CLICK", logicalKey: "clt:start:" + inbound.id };
      if (!current) await authority.initialize({ ...intent, logicalKey: intent.logicalKey + ":queue", state: "HUMAN_QUEUE" })(tx);
      session = await tx.chatbotSession.create({ data: { ...scope, contactId: snapshot.contactId,
        flowId: binding.flowId, flowVersionId: binding.flowVersionId, campaignId: binding.campaignId, campaignRecipientId: recipient.id,
        activeConversationId: scope.conversationId, currentStepId: "proposal", runtimeActorId: actor.id,
        expiresAt: new Date(sourceTime.getTime() + WINDOW_MS) } });
      await authority.admitVerifiedChatbot({ ...intent, expectedGeneration: current?.generation ?? BigInt(0) })(tx);
      await tx.conversation.update({ where: { id: scope.conversationId }, data: { status: "BOT" } });
      kind = startKind;
    } else if (!["TEXT", "INTERACTIVE_BUTTON"].includes(snapshot.metadata.interactionType) || !snapshot.metadata.sourceTimestamp) {
      return true;
    }

    const payload = { messageId: message.id };
    const receivedAt = await storage.now(tx);
    await tx.chatbotEvent.create({ data: { companyId: scope.companyId, channelId: scope.channelId, sessionId: session.id,
      idempotencyKey: "clt:inbound:" + inbound.id, fingerprint: authorityFingerprint(payload), kind, payload: canonicalChatbotValue(payload),
      createdAt: receivedAt, availableAt: receivedAt, inboundSequence: inbound.sequence, occurredAt: new Date(snapshot.metadata.sourceTimestamp!) } });
    return true;
  }

  async function release(tx: AuthorityTx, session: ChatbotSession, reason: string) {
    const scope = scopeOf(session);
    const current = await storage.lock(tx, scope);
    if (current.state !== "CHATBOT" || !session.runtimeActorId) return false;
    await authority.transition({ ...scope, actorUserId: session.runtimeActorId, expectedGeneration: current.generation,
      state: "HUMAN_QUEUE", logicalKey: "clt:release:" + session.id, reason })(tx);
    await tx.conversation.updateMany({ where: { id: scope.conversationId, agentId: null, status: { in: ["BOT", "PENDING", "OPEN"] } },
      data: { status: "PENDING", aiPaused: true } });
    return true;
  }

  async function notifyHandoff(scope: AuthorityScope) {
    // The durable handoff is the queue transition. Distribution can be retried by the CRM.
    await onHandoff?.(scope);
  }

  async function processEvent(candidate: ChatbotEvent & { session: ChatbotSession }) {
    const { session: selected } = candidate;
    const scope = scopeOf(selected);
    const released = await storage.transaction(async tx => {
      await storage.lockConversation(tx, scope.companyId, scope.conversationId);
      const session = await tx.chatbotSession.findFirst({ where: { ...scope, id: selected.id, ...runtimeSession },
        include: { version: true } });
      if (!session?.campaignId) return false;
      const current = await storage.lock(tx, scope);
      if (current.state !== "CHATBOT") return false;
      const binding = await lockBinding(tx, scope, session.campaignId);
      const now = await storage.now(tx);
      if (!binding?.enabled || session.expiresAt <= now) return release(tx, session, "CLT_UNAVAILABLE");

      const event = await tx.chatbotEvent.findFirst({ where: { sessionId: session.id, status: "PENDING", inboundSequence: { not: null } },
        orderBy: { inboundSequence: "asc" } });
      if (!event || event.id !== candidate.id || event.availableAt > now) return false;
      const done = (errorCode?: string) => tx.chatbotEvent.update({ where: { id: event.id },
        data: { status: "PROCESSED", processedAt: now, sessionRevision: session.revision, errorCode } });
      const { messageId } = JSON.parse(event.payload) as { messageId: string };
      const inbound = await tx.conversationInboundEvent.findFirst({ where: { ...scope, messageId, sequence: event.inboundSequence!,
        contactId: session.contactId, provenanceKind: VERIFIED, provenanceVersion: 1 }, include: { message: true } });
      if (!inbound?.message.metaReplySnapshot || inbound.message.metaReplyConflictSnapshot) {
        await done("UNVERIFIED_INBOUND");
        return event.kind === startKind ? release(tx, session, "CLT_UNAVAILABLE") : false;
      }
      const version: EngineVersion = { ...session.version, definition: JSON.parse(session.version.definition) };
      const engineScope = { ...scope, contactId: session.contactId, sessionId: session.id,
        flowId: session.flowId, flowVersionId: session.flowVersionId };
      const state: EngineState | null = session.runtimeState ? JSON.parse(session.runtimeState) : null;
      let plan: EnginePlan;
      if (event.kind === startKind && !state) {
        plan = planChatbotExecution({ scope: engineScope, version, state: null, expectedRevision: 0,
          event: { id: event.id, occurredAt: event.occurredAt.toISOString(), kind: "START" } });
      } else {
        if (!state?.expectedPrompt || !session.lastPromptKey) { await done("NO_ACTIVE_PROMPT"); return false; }
        const prompt = await tx.outboundOperation.findUnique({ where: { companyId_channelId_logicalKey: {
          companyId: scope.companyId, channelId: scope.channelId, logicalKey: session.lastPromptKey
        } } });
        if (prompt && ["PREPARED", "RESERVED", "DISPATCHING"].includes(prompt.status)) return false;
        const sent = prompt?.providerMessageId && await tx.message.findFirst({ where: { conversationId: scope.conversationId,
          providerMessageId: prompt.providerMessageId, direction: "outbound", senderType: "automation" } });
        if (!prompt || prompt.origin !== "CHATBOT" || !sent || !prompt.providerMessageId || prompt.status !== "SENT" ||
            second(event.occurredAt) < second(sent.createdAt) || event.createdAt < sent.createdAt ||
            event.occurredAt.getTime() > now.getTime() + 30_000) {
          await done("STALE_OR_UNDELIVERED_PROMPT"); return false;
        }
        try {
          plan = projectChatbotMetaReply({ state, version, delivery: { scope: engineScope,
            promptId: state.expectedPrompt.id, providerMessageId: prompt.providerMessageId },
            snapshot: inbound.message.metaReplySnapshot, body: inbound.message.body, messageType: inbound.message.type, allowUnquotedText: true });
        } catch (error) {
          if (!(error instanceof ChatbotError)) throw error;
          await done(error.code);
          return false;
        }
      }

      let lastPromptKey = session.lastPromptKey;
      for (const command of plan.commands) {
        const payload: Command = { sessionId: session.id, eventId: event.id, promptId: command.prompt?.id ?? null,
          handoff: plan.outcome === "HANDOFF", step: command.payload };
        await outbound.prepareChatbotInTransaction(tx, { ...scope, expectedGeneration: current.generation,
          logicalKey: command.idempotencyKey, payload });
        if (command.prompt) lastPromptKey = command.idempotencyKey;
      }
      await tx.chatbotSession.update({ where: { id: session.id }, data: {
        runtimeState: canonicalChatbotValue(plan.state), revision: plan.state.revision,
        currentStepId: plan.state.stepId, lastPromptKey,
        expiresAt: new Date(Math.max(session.expiresAt.getTime(), event.occurredAt.getTime() + WINDOW_MS))
      } });
      await done();
      return plan.outcome === "HANDOFF" && !plan.commands.length ? release(tx, session, "CLT_HANDOFF") : false;
    });
    if (released) await notifyHandoff(scope);
  }

  async function dispatch(operation: OutboundOperation) {
    const scope = scopeOf(operation);
    const input = { ...scope, operationId: operation.id, expectedGeneration: operation.authorityGeneration };
    if (operation.status === "DISPATCHING") {
      const recovered = await outbound.recover(input);
      if (recovered.status === "UNKNOWN") await closeUnavailable(scope, envelope(operation).content.sessionId);
      return;
    }
    const { destination, content } = envelope(operation);
    const payload = content.step.type === "BUTTONS" ? buildChatbotMetaButtonPayload(destination, content.step)
      : content.step.type === "INPUT" || content.step.type === "TEXT" ? buildMetaTextMessagePayload({ to: destination, body: content.step.text })
      : null;
    const channel = await db.channel.findFirst({ where: { id: scope.channelId, companyId: scope.companyId, provider: "meta", type: "whatsapp" } });
    const accessToken = channel?.phoneNumberId && resolveChannelAccessToken(channel.accessToken, { channelId: channel.id });
    if (!payload || !channel?.phoneNumberId || !accessToken) {
      await closeUnavailable(scope, content.sessionId);
      return;
    }

    let authorized: OutboundOperation;
    let token: string | null = null;
    try {
      const reserved = await outbound.reserve(input);
      if (!reserved?.reservationToken) return;
      const permit = token = reserved.reservationToken;
      authorized = await outbound.authorizeDispatch({ ...input, token: permit, validate: async tx => {
        const session = await tx.chatbotSession.findFirst({ where: { ...scope, id: content.sessionId, ...runtimeSession } });
        const binding = session?.campaignId && await lockBinding(tx, scope, session.campaignId);
        const latest = await tx.channel.findFirst({ where: { id: scope.channelId, companyId: scope.companyId,
          provider: "meta", type: "whatsapp", phoneNumberId: channel.phoneNumberId, wabaId: channel.wabaId, accessToken: channel.accessToken } });
        const event = await tx.chatbotEvent.findFirst({ where: { id: content.eventId, sessionId: content.sessionId, status: "PROCESSED" } });
        const cause = event && await tx.message.findFirst({ where: { id: JSON.parse(event.payload).messageId,
          conversationId: scope.conversationId, metaReplyConflictSnapshot: null } });
        if (!session || !binding || !binding.enabled || !latest || !cause || session.expiresAt <= await storage.now(tx)) {
          throw new ChatbotError("CLT_DISPATCH_UNAVAILABLE");
        }
      } });
    } catch (error) {
      if (error instanceof ChatbotError || error instanceof AuthorityError && ["DESTINATION_CHANGED", "INVALID_CONVERSATION_SCOPE"].includes(error.code)) {
        await outbound.cancelBeforeDispatch({ ...input, token: token ?? undefined });
        await closeUnavailable(scope, content.sessionId);
        return;
      }
      if (error instanceof AuthorityError && ["GENERATION_CONFLICT", "INVALID_OPERATION_STATE", "RESERVATION_CONFLICT", "AUTHORITY_DENIED"].includes(error.code)) return;
      throw error;
    }

    const outcome = await transport({ phoneNumberId: channel.phoneNumberId, accessToken, payload });
    const finalMessage = content.handoff || outcome.status !== "SENT";
    const result = await outbound.finish({ ...input, ...outcome, token: token! }, async (tx, sent) => {
      if (sent.providerMessageId && content.step.type !== "LIST") {
        await tx.message.create({ data: { conversationId: scope.conversationId, direction: "outbound", senderType: "automation",
          type: content.step.type === "BUTTONS" ? "interactive" : "text", status: "sent", body: content.step.text,
          providerMessageId: sent.providerMessageId, createdAt: authorized.updatedAt } });
        await tx.conversation.updateMany({ where: { id: scope.conversationId, OR: [
          { lastMessageAt: null }, { lastMessageAt: { lte: authorized.updatedAt } }
        ] }, data: { lastMessageAt: authorized.updatedAt, lastMessagePreview: content.step.text } });
      }
      if (finalMessage) {
        const session = await tx.chatbotSession.findFirst({ where: { id: content.sessionId, ...scope, ...runtimeSession } });
        if (session) await release(tx, session, "CLT_HANDOFF");
      }
    });
    if (finalMessage && result.status !== "CANCELED") await notifyHandoff(scope);
  }

  async function closeUnavailable(scope: AuthorityScope, sessionId: string) {
    const released = await storage.transaction(async tx => {
      await storage.lockConversation(tx, scope.companyId, scope.conversationId);
      const session = await tx.chatbotSession.findFirst({ where: { ...scope, id: sessionId, ...runtimeSession } });
      return !!session && release(tx, session, "CLT_UNAVAILABLE");
    });
    if (released) await notifyHandoff(scope);
  }

  async function drain(reportError: (error: unknown) => void = () => {}) {
    const now = new Date();
    const sessions = await db.chatbotSession.findMany({ where: { ...runtimeSession, OR: [{ expiresAt: { lte: now } },
      { campaign: { cltChatbotBinding: { enabled: false } } }] },
      orderBy: { expiresAt: "asc" }, take: 25 });
    for (const session of sessions) await closeUnavailable(scopeOf(session), session.id).catch(reportError);
    const work = await db.outboundOperation.findMany({ where: { origin: "CHATBOT", OR: [
      { status: "PREPARED" }, { status: "RESERVED", leaseUntil: { lte: now } },
      { status: "DISPATCHING", dispatchDeadline: { lte: now } }
    ] }, orderBy: { createdAt: "asc" }, take: 25 });
    for (const operation of work) await dispatch(operation).catch(reportError);
    const expiredPermits = await db.outboundOperation.findMany({ where: { status: "DISPATCHING", dispatchDeadline: { lte: now },
      OR: [{ origin: "CAMPAIGN", logicalKey: { startsWith: "clt:campaign:" } },
        { origin: "HUMAN", logicalKey: { startsWith: "clt:human:" } }] }, take: 25 });
    for (const operation of expiredPermits) await outbound.recover({ ...scopeOf(operation), operationId: operation.id }).catch(reportError);
    const events = await db.chatbotEvent.findMany({ where: { status: "PENDING", inboundSequence: { not: null },
      availableAt: { lte: now }, session: runtimeSession }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { session: true }, take: 25 });
    for (const event of events) await processEvent(event).catch(reportError);
  }

  return { ingestVerified, drain, closeUnavailable };
}
