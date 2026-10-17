import { randomUUID } from "node:crypto";
import { Prisma, type ConversationAuthority, type OutboundOperation } from "@prisma/client";
import { canonicalChatbotValue } from "./chatbot-canonical";
import { normalizeContactPhone } from "./contacts";
import {
  authorityFingerprint, authorityScope, requireAuthority, requireGeneration, requireReference,
  type AuthorityScope, type OutboundOrigin
} from "./conversation-authority-contract";
import { authorityStorage, type AuthorityDatabase, type AuthorityTx } from "./conversation-authority-storage";

type OperationInput = AuthorityScope & { operationId: string };
type Result = { status: "SENT" | "FAILED" | "UNKNOWN"; providerMessageId?: string };

export function createOutboundOperationService(database: AuthorityDatabase) {
  const storage = authorityStorage(database);
  function selection(input: OperationInput) {
    const scope = authorityScope(input); requireReference(input.operationId);
    return { ...scope, id: input.operationId };
  }
  async function operation(tx: AuthorityTx, input: OperationInput) {
    const row = await tx.outboundOperation.findFirst({ where: selection(input) });
    requireAuthority(row, "OPERATION_NOT_FOUND");
    return row;
  }
  async function eligible(tx: AuthorityTx, authority: ConversationAuthority, origin: string, actorUserId: string | null) {
    requireAuthority(origin !== "CHATBOT", "CHATBOT_ACTIVATION_BLOCKED");
    const conversation = await tx.conversation.findFirst({ where: {
      id: authority.conversationId, contactId: authority.contactId, channelId: authority.channelId,
      contact: { companyId: authority.companyId, archivedAt: null },
      channelRef: { companyId: authority.companyId, provider: "meta", type: "whatsapp", status: { in: ["ACTIVE", "CONNECTED"] } }
    }, include: { contact: true } });
    requireAuthority(conversation, "INVALID_CONVERSATION_SCOPE");
    requireAuthority(authority.state !== "CLOSED", "AUTHORITY_CLOSED");
    if (origin === "HUMAN") {
      requireReference(actorUserId);
      const actor = await storage.actor(tx, authority.companyId, actorUserId);
      requireAuthority(authority.state === "HUMAN" && authority.ownerUserId === actor.id, "AUTHORITY_DENIED");
      requireAuthority(["ADMIN", "SUPERVISOR"].includes(actor.role) || !conversation.agentId || conversation.agentId === actor.id, "FORBIDDEN");
    } else if (origin === "AI") {
      requireAuthority(authority.state === "AI" && actorUserId === null, "AUTHORITY_DENIED");
    } else if (origin === "CAMPAIGN") {
      requireReference(actorUserId);
      await storage.actor(tx, authority.companyId, actorUserId, true);
    } else requireAuthority(false, "INVALID_ORIGIN");
    return conversation;
  }
  function result(input: Result) {
    requireAuthority(["SENT", "FAILED", "UNKNOWN"].includes(input.status), "INVALID_RESULT");
    if (input.status === "SENT") requireReference(input.providerMessageId);
    else requireAuthority(input.providerMessageId === undefined, "INVALID_RESULT");
    return { status: input.status, providerMessageId: input.providerMessageId ?? null };
  }
  function retained(row: OutboundOperation, status: string) {
    return status === "UNKNOWN" ? { activeSlot: row.activeSlot, reservationToken: row.reservationToken }
      : { activeSlot: null, reservationToken: null };
  }
  return {
    async prepare(input: AuthorityScope & { expectedGeneration: bigint; logicalKey: string; origin: OutboundOrigin; actorUserId?: string | null; payload: unknown }) {
      input = { ...input };
      const scope = authorityScope(input); requireGeneration(input.expectedGeneration); requireReference(input.logicalKey);
      requireAuthority(["HUMAN", "AI", "CAMPAIGN", "CHATBOT"].includes(input.origin), "INVALID_ORIGIN");
      requireAuthority(input.origin !== "CHATBOT", "CHATBOT_ACTIVATION_BLOCKED");
      const actorUserId = input.actorUserId ?? null;
      if (actorUserId !== null) requireReference(actorUserId);
      const content = canonicalChatbotValue(input.payload);
      requireAuthority(content.length <= 65536 && input.payload !== null && typeof input.payload === "object" && !Array.isArray(input.payload), "INVALID_PAYLOAD");
      const snapshot: unknown = JSON.parse(content);
      const intent = { ...scope, generation: input.expectedGeneration.toString(), origin: input.origin, actorUserId };
      return storage.transaction(async tx => {
        const authority = await storage.lock(tx, scope);
        if (actorUserId) await storage.actor(tx, scope.companyId, actorUserId);
        const existing = await tx.outboundOperation.findUnique({ where: { companyId_channelId_logicalKey: {
          companyId: scope.companyId, channelId: scope.channelId, logicalKey: input.logicalKey
        } } });
        if (existing) {
          const fingerprint = authorityFingerprint({ ...intent, payload: canonicalChatbotValue({ destination: JSON.parse(existing.payload).destination, content: snapshot }) });
          requireAuthority(existing.fingerprint === fingerprint && existing.conversationId === scope.conversationId, "IDEMPOTENCY_CONFLICT");
          return existing;
        }
        requireAuthority(authority.generation === input.expectedGeneration, "GENERATION_CONFLICT");
        const conversation = await eligible(tx, authority, input.origin, actorUserId);
        const destination = normalizeContactPhone(conversation.contact.phone);
        requireReference(destination);
        const payload = canonicalChatbotValue({ destination, content: snapshot });
        return tx.outboundOperation.create({ data: {
          ...scope, authorityId: authority.id, logicalKey: input.logicalKey, origin: input.origin, actorUserId,
          authorityGeneration: authority.generation, fingerprint: authorityFingerprint({ ...intent, payload }), payload
        } });
      });
    },
    async reserve(input: OperationInput & { expectedGeneration: bigint; leaseMs?: number }) {
      input = { ...input };
      selection(input); requireGeneration(input.expectedGeneration);
      const leaseMs = input.leaseMs ?? 30000;
      requireAuthority(Number.isInteger(leaseMs) && leaseMs >= 100 && leaseMs <= 60000, "INVALID_LEASE");
      return storage.transaction(async tx => {
        const authority = await storage.lock(tx, input); const row = await operation(tx, input);
        requireAuthority(authority.generation === input.expectedGeneration && row.authorityGeneration === authority.generation, "GENERATION_CONFLICT");
        const conversation = await eligible(tx, authority, row.origin, row.actorUserId);
        requireAuthority(JSON.parse(row.payload).destination === normalizeContactPhone(conversation.contact.phone), "DESTINATION_CHANGED");
        const now = await storage.now(tx);
        if (row.status === "RESERVED" && row.leaseUntil && row.leaseUntil > now) return null;
        requireAuthority(row.status === "PREPARED" || (row.status === "RESERVED" && row.leaseUntil && row.leaseUntil <= now), "INVALID_OPERATION_STATE");
        if (await tx.outboundOperation.findFirst({ where: { activeSlot: authority.id, id: { not: row.id } } })) return null;
        const token = randomUUID();
        const changed = await tx.outboundOperation.updateMany({ where: { ...selection(input), status: row.status, reservationToken: row.reservationToken },
          data: { status: "RESERVED", activeSlot: authority.id, reservationToken: token, leaseUntil: new Date(now.getTime() + leaseMs) } });
        requireAuthority(changed.count === 1, "RESERVATION_CONFLICT");
        return tx.outboundOperation.findUniqueOrThrow({ where: { id: row.id } });
      });
    },
    async authorizeDispatch(input: OperationInput & { token: string; expectedGeneration: bigint }) {
      input = { ...input };
      selection(input); requireReference(input.token); requireGeneration(input.expectedGeneration);
      return storage.transaction(async tx => {
        const authority = await storage.lock(tx, input); const row = await operation(tx, input);
        const now = await storage.now(tx);
        requireAuthority(row.status === "RESERVED" && row.reservationToken === input.token && row.leaseUntil && row.leaseUntil > now, "RESERVATION_CONFLICT");
        requireAuthority(authority.generation === input.expectedGeneration && row.authorityGeneration === authority.generation, "GENERATION_CONFLICT");
        const conversation = await eligible(tx, authority, row.origin, row.actorUserId);
        requireAuthority(JSON.parse(row.payload).destination === normalizeContactPhone(conversation.contact.phone), "DESTINATION_CHANGED");
        // Authorization is deliberately not replayable: a second caller must never receive a second send permit.
        const dispatchAt = await storage.now(tx);
        const changed = database.provider === "postgresql"
          ? await tx.$executeRaw(Prisma.sql`UPDATE "OutboundOperation"
              SET status = 'DISPATCHING', "leaseUntil" = NULL, "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC'),
                  "dispatchDeadline" = (clock_timestamp() AT TIME ZONE 'UTC') + interval '60 seconds'
              WHERE id = ${row.id} AND "companyId" = ${authority.companyId} AND "channelId" = ${authority.channelId}
                AND "conversationId" = ${authority.conversationId} AND "authorityId" = ${authority.id}
                AND status = 'RESERVED' AND "reservationToken" = ${input.token} AND "leaseUntil" > (clock_timestamp() AT TIME ZONE 'UTC')`)
          : (await tx.outboundOperation.updateMany({ where: { ...selection(input), status: "RESERVED", reservationToken: input.token, leaseUntil: { gt: dispatchAt } },
              data: { status: "DISPATCHING", leaseUntil: null, dispatchDeadline: new Date(dispatchAt.getTime() + 60000) } })).count;
        requireAuthority(changed === 1, "RESERVATION_CONFLICT");
        return tx.outboundOperation.findUniqueOrThrow({ where: { id: row.id } });
      });
    },
    async finish(input: OperationInput & Result & { token: string }) {
      input = { ...input };
      selection(input); requireReference(input.token); const outcome = result(input);
      const fingerprint = authorityFingerprint({ ...outcome, token: input.token });
      return storage.transaction(async tx => {
        await storage.lock(tx, input); const row = await operation(tx, input);
        if (row.resultFingerprint) {
          requireAuthority(row.resultFingerprint === fingerprint, "RESULT_CONFLICT");
          return row;
        }
        requireAuthority(row.status === "DISPATCHING" && row.reservationToken === input.token, "INVALID_OPERATION_STATE");
        return tx.outboundOperation.update({ where: { id: row.id }, data: {
          ...outcome, ...retained(row, outcome.status), resultFingerprint: fingerprint, dispatchDeadline: null
        } });
      });
    },
    async recover(input: OperationInput) {
      input = { ...input };
      selection(input);
      return storage.transaction(async tx => {
        const authority = await storage.lock(tx, input); const row = await operation(tx, input);
        const now = await storage.now(tx);
        if (row.status === "DISPATCHING" && row.dispatchDeadline && row.dispatchDeadline <= now) {
          return tx.outboundOperation.update({ where: { id: row.id }, data: { status: "UNKNOWN", dispatchDeadline: null } });
        }
        if (row.status === "RESERVED" && row.leaseUntil && row.leaseUntil <= now) {
          return tx.outboundOperation.update({ where: { id: row.id }, data: {
            status: row.authorityGeneration === authority.generation ? "PREPARED" : "CANCELED",
            activeSlot: null, reservationToken: null, leaseUntil: null
          } });
        }
        return row;
      });
    },
    async reconcileUnknown(input: OperationInput & { actorUserId: string; logicalKey: string; evidenceReference: string;
      executorTerminated: boolean; resolution: "SENT" | "FAILED"; providerMessageId?: string }) {
      input = { ...input };
      const scope = authorityScope(input); selection(input);
      requireReference(input.actorUserId); requireReference(input.logicalKey); requireReference(input.evidenceReference);
      requireAuthority(input.executorTerminated === true, "EXECUTOR_QUIESCENCE_REQUIRED");
      const outcome = result({ status: input.resolution, providerMessageId: input.providerMessageId });
      requireAuthority(input.resolution === "SENT" || input.resolution === "FAILED", "INVALID_RESULT");
      const fingerprint = authorityFingerprint({ ...scope, operationId: input.operationId, actor: input.actorUserId,
        evidence: input.evidenceReference, ...outcome });
      return storage.transaction(async tx => {
        const authority = await storage.lock(tx, scope);
        await storage.actor(tx, scope.companyId, input.actorUserId, true);
        const key = { companyId: scope.companyId, channelId: scope.channelId, logicalKey: input.logicalKey };
        const existing = await tx.authorityEvent.findUnique({ where: { companyId_channelId_logicalKey: key } });
        if (existing) {
          requireAuthority(existing.fingerprint === fingerprint, "IDEMPOTENCY_CONFLICT");
          return existing;
        }
        const row = await operation(tx, input);
        requireAuthority(row.status === "UNKNOWN" && row.activeSlot === authority.id, "INVALID_OPERATION_STATE");
        await tx.outboundOperation.update({ where: { id: row.id }, data: {
          ...outcome, activeSlot: null, reservationToken: null,
          resultFingerprint: authorityFingerprint({ reconciliation: fingerprint })
        } });
        return tx.authorityEvent.create({ data: {
          ...key, conversationId: scope.conversationId, authorityId: authority.id, actorUserId: input.actorUserId,
          fingerprint, kind: "RECONCILE_UNKNOWN", fromState: authority.state, toState: authority.state,
          fromGeneration: authority.generation, toGeneration: authority.generation, operationId: row.id,
          fromOwnerUserId: authority.ownerUserId, toOwnerUserId: authority.ownerUserId,
          reason: input.evidenceReference
        } });
      });
    }
  };
}
