import "server-only";
import {
  authorityFingerprint, requireAuthority, requireGeneration, requireReference
} from "./conversation-authority-contract";
import { conversationAuthorityTransactionCore } from "./conversation-authority.service";
import { authorityStorage, type AuthorityDatabase, type AuthorityTx } from "./conversation-authority-storage";

type Expectation = { kind: "ABSENT" } | { kind: "EXISTING"; expectedGeneration: bigint };
type Common = { companyId: string; conversationId: string; actorUserId: string; logicalKey: string; expectation: Expectation };
export type HumanAuthorityCommand = Common & (
  { kind: "CLAIM_SELF" | "RETURN_TO_QUEUE" } |
  { kind: "ASSIGN" | "TRANSFER"; targetUserId: string }
);

export function parseHumanAuthorityCommand(value: HumanAuthorityCommand): HumanAuthorityCommand {
  requireAuthority(value && typeof value === "object" && !Array.isArray(value), "INVALID_COMMAND");
  const keys = Object.keys(value);
  const { kind, companyId, conversationId, actorUserId, logicalKey, targetUserId, expectation: rawExpectation } =
    value as HumanAuthorityCommand & { targetUserId?: string };
  requireAuthority(rawExpectation && typeof rawExpectation === "object" && !Array.isArray(rawExpectation), "INVALID_EXPECTATION");
  const expectationKeys = Object.keys(rawExpectation);
  const { kind: expectationKind, expectedGeneration } = rawExpectation as { kind: string; expectedGeneration?: bigint };
  const expectation = expectationKind === "ABSENT" ? { kind: "ABSENT" as const }
    : { kind: expectationKind, expectedGeneration };
  const targeted = kind === "ASSIGN" || kind === "TRANSFER";
  const input = { kind, companyId, conversationId, actorUserId, logicalKey, expectation,
    ...(targeted ? { targetUserId } : {}) };
  requireAuthority(["CLAIM_SELF", "ASSIGN", "TRANSFER", "RETURN_TO_QUEUE"].includes(input.kind), "INVALID_COMMAND");
  const allowed = ["kind", "companyId", "conversationId", "actorUserId", "logicalKey", "expectation", ...(targeted ? ["targetUserId"] : [])];
  requireAuthority(keys.every(key => allowed.includes(key)), "INVALID_COMMAND");
  requireAuthority(allowed.every(key => keys.includes(key)), "INVALID_COMMAND");
  for (const field of ["companyId", "conversationId", "actorUserId", "logicalKey"] as const) requireReference(input[field]);
  if (targeted) requireReference(input.targetUserId);
  if (expectation.kind === "ABSENT") {
    requireAuthority(expectationKeys.length === 1 && expectationKeys.includes("kind"), "INVALID_EXPECTATION");
  } else {
    requireAuthority(expectation.kind === "EXISTING" && expectationKeys.length === 2 &&
      expectationKeys.includes("kind") && expectationKeys.includes("expectedGeneration"), "INVALID_EXPECTATION");
    requireGeneration(expectation.expectedGeneration);
  }
  Object.freeze(expectation);
  return Object.freeze(input) as HumanAuthorityCommand;
}

export function legacyHumanAuthorityState(conversation: { status: string; agentId: string | null }) {
  requireAuthority(["OPEN", "PENDING", "BOT", "SOLD", "RESOLVED"].includes(conversation.status), "INVALID_LEGACY_STATUS");
  if (conversation.agentId !== null) requireAuthority(typeof conversation.agentId === "string" &&
    conversation.agentId.length > 0 && conversation.agentId.length <= 256 && conversation.agentId.trim() === conversation.agentId,
  "INVALID_LEGACY_OWNER");
  if (conversation.status === "RESOLVED") return { state: "CLOSED" as const, ownerUserId: null };
  return conversation.agentId !== null ? { state: "HUMAN" as const, ownerUserId: conversation.agentId }
    : { state: "HUMAN_QUEUE" as const, ownerUserId: null };
}

function fingerprint(input: HumanAuthorityCommand) {
  return authorityFingerprint({ kind: input.kind, companyId: input.companyId, conversationId: input.conversationId,
    actorUserId: input.actorUserId, logicalKey: input.logicalKey,
    targetUserId: "targetUserId" in input ? input.targetUserId : null,
    expectation: input.expectation.kind === "ABSENT" ? { kind: "ABSENT" }
      : { kind: "EXISTING", expectedGeneration: input.expectation.expectedGeneration.toString() } });
}

// Internal primitive, not a public initialize API: derives state from the locked
// legacy row. AGENT adoption is confined to self-claim; administrators can also
// materialize RESOLVED -> CLOSED. The execute facade never reopens CLOSED.
export async function adoptLegacyHumanAuthorityInTx(database: AuthorityDatabase, tx: AuthorityTx, raw: HumanAuthorityCommand) {
  const input = parseHumanAuthorityCommand(raw);
  const storage = authorityStorage(database);
  const conversation = await storage.lockConversation(tx, input.companyId, input.conversationId);
  const scope = { companyId: input.companyId, conversationId: input.conversationId, channelId: conversation.channelId! };
  const actor = await storage.actor(tx, input.companyId, input.actorUserId, input.kind !== "CLAIM_SELF");
  requireAuthority(input.expectation.kind === "ABSENT", "INVALID_EXPECTATION");
  requireAuthority(!await tx.conversationAuthority.findUnique({ where: { conversationId: input.conversationId } }), "GENERATION_CONFLICT");
  const legacyState = legacyHumanAuthorityState(conversation);
  // Validate even RESOLVED owners before clearing the compatibility projection.
  if (conversation.agentId !== null) {
    const owner = await tx.user.findFirst({ where: { id: conversation.agentId, companyId: input.companyId } });
    requireAuthority(owner && ["ADMIN", "SUPERVISOR", "AGENT"].includes(owner.role), "INVALID_LEGACY_OWNER");
  }
  const core = conversationAuthorityTransactionCore(database);
  const adoption = { ...scope, actorUserId: actor.id, logicalKey: `human-adopt:${fingerprint(input)}`, reason: "HUMAN_LAZY_ADOPTION" };
  if (actor.role === "AGENT") await core.adoptSelfClaim(adoption)(tx);
  else await core.initialize({ ...adoption, ...legacyState })(tx);
  const authority = await storage.lock(tx, scope);
  if (conversation.agentId !== authority.ownerUserId) {
    await tx.conversation.update({ where: { id: conversation.id }, data: { agentId: authority.ownerUserId } });
    await tx.leadAssignmentHistory.create({ data: { companyId: input.companyId, conversationId: input.conversationId,
      assignedByUserId: input.actorUserId, assignedToUserId: authority.ownerUserId, mode: "HUMAN_AUTHORITY_ADOPTION", action: "UNASSIGNED" } });
  }
  return authority;
}

export function createHumanConversationAuthorityService(database: AuthorityDatabase) {
  requireAuthority(typeof window === "undefined", "SERVER_ONLY");
  const storage = authorityStorage(database);
  const core = conversationAuthorityTransactionCore(database);
  return {
    async execute(raw: HumanAuthorityCommand) {
      const input = parseHumanAuthorityCommand(raw);
      const commandFingerprint = fingerprint(input);
      // Caller keys cannot collide with foundation/adoption keys. The bounded
      // namespace is deterministic; no timestamp or newly generated retry key.
      const eventKey = `human-command:${authorityFingerprint(input.logicalKey)}`;
      return storage.transaction(async tx => {
        const conversation = await storage.lockConversation(tx, input.companyId, input.conversationId);
        const scope = { companyId: input.companyId, channelId: conversation.channelId!, conversationId: input.conversationId };
        await storage.actor(tx, input.companyId, input.actorUserId, input.kind !== "CLAIM_SELF");
        if ("targetUserId" in input) await storage.actor(tx, input.companyId, input.targetUserId);
        let row = await tx.conversationAuthority.findUnique({ where: { conversationId: input.conversationId } });
        if (row) {
          requireAuthority(row.companyId === scope.companyId && row.channelId === scope.channelId && row.contactId === conversation.contactId,
            "INVALID_CONVERSATION_SCOPE");
          row = await storage.lock(tx, scope);
          requireAuthority(conversation.agentId === row.ownerUserId, "AUTHORITY_PROJECTION_DRIFT");
        }
        const replay = await tx.authorityEvent.findUnique({ where: { companyId_channelId_logicalKey: {
          companyId: scope.companyId, channelId: scope.channelId, logicalKey: eventKey
        } } });
        if (replay) {
          requireAuthority(replay.fingerprint === commandFingerprint && replay.conversationId === input.conversationId,
            "IDEMPOTENCY_CONFLICT");
          return { event: replay, replayed: true };
        }
        if (!row) {
          requireAuthority(input.expectation.kind === "ABSENT", "GENERATION_CONFLICT");
          row = await adoptLegacyHumanAuthorityInTx(database, tx, input);
        } else {
          requireAuthority(input.expectation.kind === "EXISTING" && row.generation === input.expectation.expectedGeneration,
            "GENERATION_CONFLICT");
        }
        requireAuthority(row.state === "HUMAN" || row.state === "HUMAN_QUEUE", "INVALID_TRANSITION");
        if (input.kind === "CLAIM_SELF") requireAuthority(row.state === "HUMAN_QUEUE" || row.ownerUserId === input.actorUserId, "OWNERSHIP_CONFLICT");
        if (input.kind === "TRANSFER") requireAuthority(row.state === "HUMAN", "INVALID_TRANSITION");
        requireAuthority(conversation.status !== "RESOLVED", "INVALID_TRANSITION");
        const ownerUserId = input.kind === "RETURN_TO_QUEUE" ? null : "targetUserId" in input ? input.targetUserId : input.actorUserId;
        const state = ownerUserId === null ? "HUMAN_QUEUE" : "HUMAN";
        // Preserve foundation event kinds/guards, but bind replay to the human
        // intent (including ABSENT), not to a generation discovered on retry.
        const event = await core.transition({ ...scope, actorUserId: input.actorUserId,
          logicalKey: eventKey, reason: `HUMAN_${input.kind}`, expectedGeneration: row.generation, state, ownerUserId }, commandFingerprint)(tx);
        const changed = conversation.agentId !== ownerUserId;
        if (changed) {
          await tx.conversation.update({ where: { id: conversation.id }, data: { agentId: ownerUserId } });
          await tx.leadAssignmentHistory.create({ data: { companyId: input.companyId, conversationId: input.conversationId,
            assignedToUserId: ownerUserId, assignedByUserId: input.actorUserId,
            mode: input.kind === "CLAIM_SELF" ? "CLAIM_FIRST" : input.kind === "RETURN_TO_QUEUE" ? "UNASSIGN" : "ADMIN_MANUAL",
            action: ownerUserId === null ? "UNASSIGNED" : "ASSIGNED" } });
        }
        return { event, replayed: false };
      });
    }
  };
}
