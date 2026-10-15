import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { ChatbotError, validateChatbotDefinition } from "./chatbot-definition";

type Scope = { companyId: string; channelId: string; sessionId: string };
type Tx = Prisma.TransactionClient;
type SuspensionReason = "HUMAN_INTERVENTION" | "HANDOFF_REQUESTED" | "MANUAL" | "ERROR";
type ClosureReason = "COMPLETED" | "HUMAN_HANDOFF" | "MANUAL" | "CANCELED";
const occupied = ["ACTIVE", "SUSPENDED"];

function ensure(condition: unknown, code: string): asserts condition {
  if (!condition) throw new ChatbotError(code);
}
function references<T>(input: T, fields: readonly string[], code = "INVALID_SCOPE"): T {
  ensure(input && typeof input === "object" && !Array.isArray(input), code);
  const snapshot = { ...input };
  for (const field of fields) {
    const value = (snapshot as Record<string, unknown>)[field];
    ensure(typeof value === "string" && value.trim().length > 0, code);
  }
  return snapshot;
}
function sessionScope<T>(input: T): T {
  return references(input, ["companyId", "channelId", "sessionId"]);
}
function revision(value: number) {
  ensure(Number.isSafeInteger(value) && value >= 0, "INVALID_INPUT");
}
function label(value: string, max: number) {
  ensure(typeof value === "string" && value.trim().length > 0 && value.length <= max, "INVALID_INPUT");
  return value.trim();
}
function timestamp(value: Date) {
  ensure(value instanceof Date && Number.isFinite(value.getTime()), "INVALID_TIME");
  return value;
}
function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  ensure(value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype, "INVALID_PAYLOAD");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

// No default database: callers must explicitly provide their authorized environment.
export function createChatbotFoundation(db: PrismaClient, clock: () => Date = () => new Date()) {
  async function transaction<T>(action: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.$transaction(action, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        const retryable = error instanceof Prisma.PrismaClientKnownRequestError &&
          ["P2002", "P2034", "P1008", "P2028"].includes(error.code);
        if (!retryable || attempt >= 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
      }
    }
  }

  async function scopedSession(tx: Tx, scope: Scope) {
    scope = sessionScope(scope);
    const session = await tx.chatbotSession.findFirst({ where: { id: scope.sessionId, companyId: scope.companyId, channelId: scope.channelId } });
    ensure(session, "SESSION_NOT_FOUND");
    return session;
  }

  async function cancelCommands(tx: Tx, scope: Scope) {
    scope = sessionScope(scope);
    await tx.chatbotOutbox.updateMany({
      where: { companyId: scope.companyId, channelId: scope.channelId, sessionId: scope.sessionId, status: { in: ["PENDING", "RETRY", "PROCESSING"] } },
      data: { status: "CANCELED", leaseUntil: null, leaseToken: null }
    });
  }

  async function expire(tx: Tx, scope: Scope, now: Date) {
    const session = await scopedSession(tx, scope);
    if (occupied.includes(session.status) && session.expiresAt <= now) {
      const changed = await tx.chatbotSession.updateMany({
        where: { id: session.id, revision: session.revision, status: { in: occupied } },
        data: { status: "EXPIRED", closureReason: "EXPIRED", activeConversationId: null, endedAt: now, revision: { increment: 1 } }
      });
      ensure(changed.count === 1, "REVISION_CONFLICT");
      await cancelCommands(tx, scope);
      return scopedSession(tx, scope);
    }
    return session;
  }

  return {
    async createDraft(input: { companyId: string; name: string; description?: string; definition: unknown }) {
      input = references(input, ["companyId"]);
      const definition = validateChatbotDefinition(input.definition);
      const name = label(input.name, 120);
      const description = input.description === undefined ? null : label(input.description, 1000);
      return transaction(async (tx) => {
        const flow = await tx.chatbotFlow.create({ data: { companyId: input.companyId, name, description } });
        const version = await tx.chatbotFlowVersion.create({ data: { companyId: input.companyId, flowId: flow.id, number: 1, definition: canonical(definition) } });
        return { flow, version };
      });
    },

    async createDraftVersion(input: { companyId: string; flowId: string; expectedRevision: number; definition: unknown }) {
      input = references(input, ["companyId", "flowId"]);
      revision(input.expectedRevision);
      const definition = validateChatbotDefinition(input.definition);
      return transaction(async (tx) => {
        const flow = await tx.chatbotFlow.findFirst({ where: { id: input.flowId, companyId: input.companyId } });
        ensure(flow, "FLOW_NOT_FOUND");
        const updated = await tx.chatbotFlow.updateMany({ where: { id: flow.id, companyId: input.companyId, revision: input.expectedRevision }, data: { versionCounter: { increment: 1 }, revision: { increment: 1 } } });
        ensure(updated.count === 1, "REVISION_CONFLICT");
        return tx.chatbotFlowVersion.create({ data: { companyId: input.companyId, flowId: flow.id, number: flow.versionCounter + 1, definition: canonical(definition) } });
      });
    },

    async publishVersion(input: { companyId: string; flowId: string; versionId: string; expectedRevision: number }) {
      input = references(input, ["companyId", "flowId", "versionId"]);
      revision(input.expectedRevision);
      return transaction(async (tx) => {
        const version = await tx.chatbotFlowVersion.findFirst({ where: { id: input.versionId, flowId: input.flowId, companyId: input.companyId } });
        ensure(version, "VERSION_NOT_FOUND");
        ensure(version.status === "DRAFT", "VERSION_IMMUTABLE");
        validateChatbotDefinition(JSON.parse(version.definition));
        const flow = await tx.chatbotFlow.updateMany({ where: { id: input.flowId, companyId: input.companyId, isActive: true, revision: input.expectedRevision }, data: { publishedVersionId: version.id, revision: { increment: 1 } } });
        ensure(flow.count === 1, "REVISION_CONFLICT");
        const updated = await tx.chatbotFlowVersion.updateMany({ where: { id: version.id, companyId: input.companyId, status: "DRAFT" }, data: { status: "PUBLISHED", publishedAt: clock() } });
        ensure(updated.count === 1, "VERSION_IMMUTABLE");
        return tx.chatbotFlowVersion.findUniqueOrThrow({ where: { id: version.id } });
      });
    },

    async getPublishedVersion(input: { companyId: string; flowId: string }) {
      input = references(input, ["companyId", "flowId"]);
      const flow = await db.chatbotFlow.findFirst({ where: { id: input.flowId, companyId: input.companyId, isActive: true } });
      if (!flow?.publishedVersionId) return null;
      return db.chatbotFlowVersion.findFirst({ where: { id: flow.publishedVersionId, companyId: input.companyId, flowId: flow.id, status: "PUBLISHED" } });
    },

    async createSession(input: { companyId: string; channelId: string; conversationId: string; contactId: string; flowId: string; flowVersionId: string; campaignId?: string; campaignRecipientId?: string; expiresAt: Date }) {
      input = references(input, ["companyId", "channelId", "conversationId", "contactId", "flowId", "flowVersionId"]);
      if (input.campaignId !== undefined || input.campaignRecipientId !== undefined) {
        references(input, ["campaignId", "campaignRecipientId"], "INVALID_CAMPAIGN_REFERENCE");
      }
      const now = clock();
      ensure(timestamp(input.expiresAt) > now, "SESSION_EXPIRED");
      ensure(Boolean(input.campaignId) === Boolean(input.campaignRecipientId), "INVALID_CAMPAIGN_REFERENCE");
      return transaction(async (tx) => {
        const [channel, conversation, version, human] = await Promise.all([
          tx.channel.findFirst({ where: { id: input.channelId, companyId: input.companyId, type: "whatsapp", provider: "meta", status: { in: ["ACTIVE", "CONNECTED"] } } }),
          tx.conversation.findFirst({ where: { id: input.conversationId, contactId: input.contactId, channelId: input.channelId, contact: { companyId: input.companyId, archivedAt: null }, status: { in: ["OPEN", "PENDING", "BOT"] } } }),
          tx.chatbotFlowVersion.findFirst({ where: { id: input.flowVersionId, flowId: input.flowId, companyId: input.companyId, status: "PUBLISHED", flow: { isActive: true } } }),
          tx.chatbotSession.findFirst({ where: { companyId: input.companyId, conversationId: input.conversationId, authority: "HUMAN" } })
        ]);
        ensure(channel && conversation && version, "INVALID_SESSION_REFERENCE");
        ensure(!human, "HUMAN_CONTROL_REQUIRED");
        if (input.campaignId) {
          const recipient = await tx.campaignRecipient.findFirst({ where: {
            id: input.campaignRecipientId, campaignId: input.campaignId, contactId: input.contactId, conversationId: input.conversationId,
            status: { in: ["SENT", "DELIVERED", "READ"] }, providerMessageId: { not: null },
            campaign: { companyId: input.companyId, channelId: input.channelId }
          } });
          ensure(recipient, "INVALID_CAMPAIGN_REFERENCE");
        }
        let active = await tx.chatbotSession.findUnique({ where: { activeConversationId: input.conversationId } });
        if (active) active = await expire(tx, { ...input, sessionId: active.id }, now);
        if (active && occupied.includes(active.status)) {
          ensure(active.status === "ACTIVE" && active.companyId === input.companyId && active.channelId === input.channelId && active.flowVersionId === input.flowVersionId && active.campaignId === (input.campaignId ?? null) && active.campaignRecipientId === (input.campaignRecipientId ?? null), "SESSION_CONFLICT");
          return active;
        }
        const definition = validateChatbotDefinition(JSON.parse(version.definition));
        ensure(input.expiresAt > clock(), "SESSION_EXPIRED");
        return tx.chatbotSession.create({ data: {
          companyId: input.companyId, channelId: input.channelId, conversationId: input.conversationId,
          contactId: input.contactId, flowId: input.flowId, flowVersionId: input.flowVersionId,
          campaignId: input.campaignId, campaignRecipientId: input.campaignRecipientId,
          expiresAt: input.expiresAt, activeConversationId: input.conversationId, currentStepId: definition.entryStepId
        } });
      });
    },

    async getSession(scope: Scope) {
      scope = sessionScope(scope);
      return transaction((tx) => expire(tx, scope, clock()));
    },

    async suspendSession(input: Scope & { expectedRevision: number; reason: SuspensionReason }) {
      input = sessionScope(input);
      revision(input.expectedRevision);
      ensure(["HUMAN_INTERVENTION", "HANDOFF_REQUESTED", "MANUAL", "ERROR"].includes(input.reason), "INVALID_INPUT");
      return transaction(async (tx) => {
        const session = await expire(tx, input, clock());
        ensure(session.revision === input.expectedRevision && occupied.includes(session.status), "REVISION_CONFLICT");
        const changed = await tx.chatbotSession.updateMany({ where: { id: session.id, revision: input.expectedRevision }, data: {
          status: "SUSPENDED", suspensionReason: input.reason, revision: { increment: 1 },
          authority: session.authority === "HUMAN" || ["HUMAN_INTERVENTION", "HANDOFF_REQUESTED"].includes(input.reason) ? "HUMAN" : "CHATBOT"
        } });
        ensure(changed.count === 1, "REVISION_CONFLICT");
        await cancelCommands(tx, input);
        return scopedSession(tx, input);
      });
    },

    async closeSession(input: Scope & { expectedRevision: number; reason: ClosureReason }) {
      input = sessionScope(input);
      revision(input.expectedRevision);
      ensure(["COMPLETED", "HUMAN_HANDOFF", "MANUAL", "CANCELED"].includes(input.reason), "INVALID_INPUT");
      return transaction(async (tx) => {
        const session = await scopedSession(tx, input);
        ensure(session.revision === input.expectedRevision && occupied.includes(session.status), "REVISION_CONFLICT");
        const changed = await tx.chatbotSession.updateMany({ where: { id: session.id, revision: input.expectedRevision }, data: {
          status: "CLOSED", closureReason: input.reason, activeConversationId: null, endedAt: clock(), revision: { increment: 1 },
          authority: input.reason === "HUMAN_HANDOFF" ? "HUMAN" : session.authority
        } });
        ensure(changed.count === 1, "REVISION_CONFLICT");
        await cancelCommands(tx, input);
        return scopedSession(tx, input);
      });
    },

    async recordEvent(input: Scope & { idempotencyKey: string; kind: "INBOUND_TEXT" | "INBOUND_OPTION"; payload: unknown; occurredAt: Date }) {
      input = sessionScope(input);
      const key = label(input.idempotencyKey, 200);
      ensure(["INBOUND_TEXT", "INBOUND_OPTION"].includes(input.kind), "INVALID_INPUT");
      const occurredAt = timestamp(input.occurredAt);
      const now = clock();
      ensure(occurredAt <= now, "INVALID_TIME");
      let payload: string;
      try { payload = canonical(input.payload); } catch { throw new ChatbotError("INVALID_PAYLOAD"); }
      ensure(Buffer.byteLength(payload) <= 8192, "INVALID_PAYLOAD");
      const fingerprint = createHash("sha256").update(canonical({ sessionId: input.sessionId, kind: input.kind, occurredAt: occurredAt.toISOString(), payload: input.payload })).digest("hex");
      return transaction(async (tx) => {
        const session = await scopedSession(tx, input);
        const existing = await tx.chatbotEvent.findUnique({ where: { companyId_channelId_idempotencyKey: { companyId: input.companyId, channelId: input.channelId, idempotencyKey: key } } });
        if (existing) {
          ensure(existing.sessionId === session.id && existing.fingerprint === fingerprint, "IDEMPOTENCY_CONFLICT");
          return existing;
        }
        ensure(session.status === "ACTIVE" && session.authority === "CHATBOT" && session.expiresAt > now, "SESSION_NOT_ACTIVE");
        ensure(occurredAt >= session.createdAt, "EVENT_TOO_OLD");
        return tx.chatbotEvent.create({ data: { companyId: input.companyId, channelId: input.channelId, sessionId: session.id, idempotencyKey: key, kind: input.kind, fingerprint, payload, occurredAt } });
      });
    },

    async claimEvent(input: Scope & { eventId: string; expectedRevision: number }) {
      input = sessionScope(input);
      references(input, ["eventId"]);
      revision(input.expectedRevision);
      return transaction(async (tx) => {
        const now = clock();
        const session = await expire(tx, input, now);
        ensure(session.status === "ACTIVE" && session.authority === "CHATBOT", "SESSION_NOT_ACTIVE");
        ensure(session.revision === input.expectedRevision, "REVISION_CONFLICT");
        const event = await tx.chatbotEvent.findFirst({ where: { id: input.eventId, companyId: input.companyId, channelId: input.channelId, sessionId: session.id } });
        ensure(event, "EVENT_NOT_FOUND");
        const eligible = event.availableAt <= now && (["PENDING", "ERROR"].includes(event.status) || (event.status === "PROCESSING" && event.leaseUntil && event.leaseUntil <= now));
        if (!eligible) return null;
        const busy = await tx.chatbotEvent.findFirst({ where: { sessionId: session.id, id: { not: event.id }, status: "PROCESSING", leaseUntil: { gt: now } } });
        if (busy) return null;
        if (event.attempts >= event.maxAttempts) {
          await tx.chatbotEvent.updateMany({ where: { id: event.id, attempts: event.attempts, status: event.status, leaseToken: event.leaseToken }, data: { status: "DEAD", leaseUntil: null, leaseToken: null } });
          return null;
        }
        const token = randomUUID();
        const changed = await tx.chatbotEvent.updateMany({ where: { id: event.id, attempts: event.attempts, status: event.status, leaseToken: event.leaseToken }, data: { status: "PROCESSING", sessionRevision: session.revision, attempts: { increment: 1 }, leaseToken: token, leaseUntil: new Date(now.getTime() + 30000) } });
        return changed.count === 1 ? { event: await tx.chatbotEvent.findUniqueOrThrow({ where: { id: event.id } }), sessionRevision: session.revision } : null;
      });
    },

    async finishEvent(input: Scope & { eventId: string; leaseToken: string; expectedRevision: number; result: "PROCESSED" | "RETRY" | "ERROR" }) {
      input = sessionScope(input);
      references(input, ["eventId", "leaseToken"]);
      revision(input.expectedRevision);
      ensure(["PROCESSED", "RETRY", "ERROR"].includes(input.result), "INVALID_INPUT");
      return transaction(async (tx) => {
        const now = clock();
        const session = await scopedSession(tx, input);
        ensure(session.status === "ACTIVE" && session.authority === "CHATBOT" && session.expiresAt > now, "SESSION_NOT_ACTIVE");
        ensure(session.revision === input.expectedRevision, "REVISION_CONFLICT");
        const event = await tx.chatbotEvent.findFirst({ where: { id: input.eventId, companyId: input.companyId, channelId: input.channelId, sessionId: session.id, status: "PROCESSING", leaseToken: input.leaseToken, leaseUntil: { gt: now } } });
        ensure(event, "LEASE_CONFLICT");
        ensure(event.sessionRevision === input.expectedRevision, "REVISION_CONFLICT");
        const status = input.result === "PROCESSED" ? "PROCESSED" : input.result === "ERROR" || event.attempts >= event.maxAttempts ? "DEAD" : "ERROR";
        const changed = await tx.chatbotEvent.updateMany({ where: { id: event.id, status: "PROCESSING", leaseToken: input.leaseToken }, data: {
          status, leaseToken: null, leaseUntil: null, processedAt: status === "PROCESSED" ? now : null,
          availableAt: new Date(now.getTime() + 1000 * 2 ** event.attempts), errorCode: status === "PROCESSED" ? null : "PROCESSING_FAILED"
        } });
        ensure(changed.count === 1, "LEASE_CONFLICT");
        return tx.chatbotEvent.findUniqueOrThrow({ where: { id: event.id } });
      });
    }
  };
}
