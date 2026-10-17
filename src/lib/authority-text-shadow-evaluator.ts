import { SHADOW_STATES, validContext, validReference, type ShadowAuthority,
  type ShadowContext, type ShadowDecision, type ShadowState } from "./authority-text-shadow-contract";

const validGeneration = (value: unknown): value is bigint => typeof value === "bigint" &&
  value >= BigInt(0) && value <= BigInt("9223372036854775807");

// Compatibility is a snapshot comparison, never a dispatch permit or a lease check.
export function evaluateTextAuthority(context: ShadowContext, authority: ShadowAuthority | null): ShadowDecision {
  const failure = (): ShadowDecision => ({ result: "EVALUATION_ERROR", reason: "INVALID_AUTHORITY", state: null });
  if (!validContext(context)) return { result: "EVALUATION_ERROR", reason: "INVALID_CONTEXT", state: null };
  if (!context.conversationId) return { result: "AUTHORITY_ABSENT", reason: "CONVERSATION_UNAVAILABLE", state: null };
  if (!authority) return { result: "AUTHORITY_ABSENT", reason: "NOT_INITIALIZED", state: null };
  if (authority.companyId !== context.companyId || authority.channelId !== context.channelId ||
      authority.conversationId !== context.conversationId) {
    return { result: "SCOPE_MISMATCH", reason: "SCOPE_DIFFERS", state: null };
  }
  if (!SHADOW_STATES.includes(authority.state as ShadowState) || !validGeneration(authority.generation) ||
      (authority.ownerUserId !== null && !validReference(authority.ownerUserId)) ||
      ((authority.state === "HUMAN") !== (authority.ownerUserId !== null))) return failure();
  const state = authority.state as ShadowState;
  if (context.expectedGeneration !== undefined && !validGeneration(context.expectedGeneration)) return failure();
  if (context.expectedGeneration !== undefined && context.expectedGeneration !== authority.generation) {
    return { result: "GENERATION_MISMATCH", reason: "GENERATION_DIFFERS", state };
  }
  if (state !== "HUMAN") return { result: "STATE_INELIGIBLE", reason: "NOT_HUMAN", state };
  if (authority.ownerUserId !== context.actorUserId) return { result: "OWNER_MISMATCH", reason: "OWNER_DIFFERS", state };
  if (context.assignedUserId && context.assignedUserId !== authority.ownerUserId) {
    return { result: "OWNER_MISMATCH", reason: "ASSIGNMENT_DIFFERS", state };
  }
  return { result: "COMPATIBLE", reason: "HUMAN_OWNER_MATCH", state };
}
