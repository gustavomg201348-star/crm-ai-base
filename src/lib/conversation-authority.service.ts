import {
  authorityFingerprint, authorityScope, nextGeneration, requireAuthority, requireAuthorityState,
  requireGeneration, requireReference, type AuthorityScope, type AuthorityState
} from "./conversation-authority-contract";
import { authorityStorage, type AuthorityDatabase, type AuthorityTx } from "./conversation-authority-storage";

export type AuthorityCommand = AuthorityScope & { actorUserId: string; logicalKey: string; reason: string };
type Command = AuthorityCommand;
type Transition = Command & { expectedGeneration: bigint; state: AuthorityState; ownerUserId?: string | null };

function command(input: Command) {
  const scope = authorityScope(input);
  requireReference(input.actorUserId); requireReference(input.logicalKey); requireReference(input.reason);
  requireAuthority(/^[A-Z][A-Z0-9_]*$/.test(input.reason), "INVALID_REASON");
  return { ...scope, actorUserId: input.actorUserId, logicalKey: input.logicalKey, reason: input.reason };
}

// Internal transaction-scoped core. It never starts or commits a transaction.
// Public wrappers below and the passive human adapter share these exact rules.
export function conversationAuthorityTransactionCore(database: AuthorityDatabase) {
  const storage = authorityStorage(database);
  async function replay(tx: AuthorityTx, input: Command, fingerprint: string) {
    const event = await tx.authorityEvent.findUnique({ where: { companyId_channelId_logicalKey: {
      companyId: input.companyId, channelId: input.channelId, logicalKey: input.logicalKey
    } } });
    if (event) requireAuthority(event.fingerprint === fingerprint && event.conversationId === input.conversationId, "IDEMPOTENCY_CONFLICT");
    return event;
  }
  function initialize(input: Command & { state: AuthorityState; ownerUserId?: string | null }, administrative = true) {
      input = { ...input };
      const cmd = command(input); requireAuthorityState(input.state);
      requireAuthority(input.state !== "AI", "EXPLICIT_AI_TRANSITION_REQUIRED");
      const ownerUserId = input.ownerUserId ?? null;
      requireAuthority((input.state === "HUMAN") === (ownerUserId !== null), "INVALID_OWNER");
      if (ownerUserId !== null) requireReference(ownerUserId);
      const fingerprint = authorityFingerprint({ ...cmd, kind: "INITIALIZE", state: input.state, ownerUserId });
      return async (tx: AuthorityTx) => {
        await storage.actor(tx, cmd.companyId, cmd.actorUserId, administrative);
        const existing = await replay(tx, cmd, fingerprint); if (existing) return existing;
        const conversation = await tx.conversation.findFirst({ where: {
          id: cmd.conversationId, channelId: cmd.channelId, contact: { companyId: cmd.companyId, archivedAt: null },
          channelRef: { companyId: cmd.companyId, provider: "meta", type: "whatsapp" }
        } });
        requireAuthority(conversation, "INVALID_CONVERSATION_SCOPE");
        if (ownerUserId) await storage.actor(tx, cmd.companyId, ownerUserId);
        requireAuthority(!await tx.conversationAuthority.findUnique({ where: { conversationId: cmd.conversationId } }), "AUTHORITY_ALREADY_INITIALIZED");
        const row = await tx.conversationAuthority.create({ data: {
          ...authorityScope(cmd), contactId: conversation.contactId, state: input.state, ownerUserId
        } });
        return tx.authorityEvent.create({ data: { ...cmd, authorityId: row.id, fingerprint, kind: "INITIALIZE",
          toState: row.state, fromGeneration: BigInt("0"), toGeneration: BigInt("0"), toOwnerUserId: ownerUserId } });
      };
    }
  return {
    initialize: (input: Command & { state: AuthorityState; ownerUserId?: string | null }) => initialize(input),
    // Narrow internal exception: an agent can adopt only an open queue or their
    // own legacy assignment, as part of CLAIM_SELF. No caller-selected state.
    adoptSelfClaim(input: Command) {
      const cmd = command(input);
      return async (tx: AuthorityTx) => {
        await storage.actor(tx, cmd.companyId, cmd.actorUserId);
        const conversation = await storage.lockConversation(tx, cmd.companyId, cmd.conversationId);
        requireAuthority(conversation.channelId === cmd.channelId, "INVALID_CONVERSATION_SCOPE");
        requireAuthority(["OPEN", "PENDING", "BOT", "SOLD"].includes(conversation.status), "INVALID_TRANSITION");
        requireAuthority(!conversation.agentId || conversation.agentId === cmd.actorUserId, "OWNERSHIP_CONFLICT");
        return initialize({ ...cmd, state: conversation.agentId ? "HUMAN" : "HUMAN_QUEUE",
          ownerUserId: conversation.agentId }, false)(tx);
      };
    },
    async get(input: AuthorityScope) {
      const scope = authorityScope(input);
      return database.db.conversationAuthority.findFirst({ where: scope });
    },
    transition(input: Transition, humanIntentFingerprint?: string) {
      input = { ...input };
      const cmd = command(input); requireGeneration(input.expectedGeneration); requireAuthorityState(input.state);
      const ownerUserId = input.ownerUserId ?? null;
      requireAuthority((input.state === "HUMAN") === (ownerUserId !== null), "INVALID_OWNER");
      if (ownerUserId !== null) requireReference(ownerUserId);
      if (humanIntentFingerprint !== undefined) requireAuthority(/^[0-9a-f]{64}$/.test(humanIntentFingerprint), "INVALID_PAYLOAD");
      const fingerprint = humanIntentFingerprint ?? authorityFingerprint({ ...cmd, kind: "TRANSITION", expectedGeneration: input.expectedGeneration.toString(), state: input.state, ownerUserId });
      return async (tx: AuthorityTx) => {
        const row = await storage.lock(tx, cmd);
        const actor = await storage.actor(tx, cmd.companyId, cmd.actorUserId);
        const existing = await replay(tx, cmd, fingerprint); if (existing) return existing;
        requireAuthority(row.generation === input.expectedGeneration, "GENERATION_CONFLICT");
        const administrative = ["ADMIN", "SUPERVISOR"].includes(actor.role);
        if (!administrative) {
          const conversation = await tx.conversation.findFirst({ where: { id: cmd.conversationId, contact: { companyId: cmd.companyId },
            OR: [{ agentId: null }, { agentId: actor.id }] } });
          requireAuthority(conversation && input.state === "HUMAN" && ownerUserId === actor.id &&
            (row.state !== "HUMAN" || row.ownerUserId === actor.id), "FORBIDDEN");
        }
        if (ownerUserId) await storage.actor(tx, cmd.companyId, ownerUserId);
        const allowed: Record<string, string[]> = {
          HUMAN_QUEUE: ["HUMAN_QUEUE", "HUMAN", "AI", "CLOSED"], HUMAN: ["HUMAN", "HUMAN_QUEUE", "AI", "CLOSED"],
          AI: ["AI", "HUMAN", "HUMAN_QUEUE", "CLOSED"], CHATBOT: ["HUMAN", "HUMAN_QUEUE", "CLOSED"], CLOSED: ["CLOSED", "HUMAN_QUEUE", "HUMAN"]
        };
        requireAuthority(allowed[row.state]?.includes(input.state), "INVALID_TRANSITION");
        const changed = row.state !== input.state || row.ownerUserId !== ownerUserId;
        const generation = changed ? nextGeneration(row.generation) : row.generation;
        if (changed) {
          const updated = await tx.conversationAuthority.updateMany({ where: { ...authorityScope(cmd), id: row.id, generation: row.generation },
            data: { state: input.state, ownerUserId, generation } });
          requireAuthority(updated.count === 1, "GENERATION_CONFLICT");
          await tx.outboundOperation.updateMany({ where: { authorityId: row.id, status: { in: ["PREPARED", "RESERVED"] } },
            data: { status: "CANCELED", activeSlot: null, reservationToken: null, leaseUntil: null } });
        }
        return tx.authorityEvent.create({ data: { ...cmd, authorityId: row.id, fingerprint, kind: "TRANSITION",
          fromState: row.state, toState: input.state, fromGeneration: row.generation, toGeneration: generation,
          fromOwnerUserId: row.ownerUserId, toOwnerUserId: ownerUserId } });
      };
    }
  };
}

export function createConversationAuthorityService(database: AuthorityDatabase) {
  const core = conversationAuthorityTransactionCore(database);
  const storage = authorityStorage(database);
  return {
    async initialize(input: Command & { state: AuthorityState; ownerUserId?: string | null }) {
      return storage.transaction(core.initialize(input));
    },
    get: core.get,
    async transition(input: Transition) {
      return storage.transaction(core.transition(input));
    }
  };
}
