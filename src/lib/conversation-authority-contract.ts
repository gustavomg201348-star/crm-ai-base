import { createHash } from "node:crypto";
import { canonicalChatbotValue } from "./chatbot-canonical";

export type AuthorityScope = { companyId: string; channelId: string; conversationId: string };
export type AuthorityState = "HUMAN_QUEUE" | "HUMAN" | "AI" | "CHATBOT" | "CLOSED";
export type OutboundOrigin = "HUMAN" | "AI" | "CHATBOT" | "CAMPAIGN";
export const MAX_AUTHORITY_GENERATION = BigInt("9223372036854775807");

export class AuthorityError extends Error {
  constructor(public readonly code: string) { super(code); }
}
export function requireAuthority(condition: unknown, code: string): asserts condition {
  if (!condition) throw new AuthorityError(code);
}
export function requireReference(value: unknown): asserts value is string {
  requireAuthority(typeof value === "string" && value.length <= 256 && value.trim() === value && value.length > 0, "INVALID_REFERENCE");
}
export function authorityScope(value: AuthorityScope): AuthorityScope {
  requireAuthority(value && typeof value === "object", "INVALID_SCOPE");
  const { companyId, channelId, conversationId } = value;
  requireReference(companyId); requireReference(channelId); requireReference(conversationId);
  return Object.freeze({ companyId, channelId, conversationId });
}
export function requireGeneration(value: unknown): asserts value is bigint {
  requireAuthority(typeof value === "bigint" && value >= BigInt("0") && value <= MAX_AUTHORITY_GENERATION, "INVALID_GENERATION");
}
export function nextGeneration(value: bigint) {
  requireGeneration(value);
  requireAuthority(value < MAX_AUTHORITY_GENERATION, "GENERATION_OVERFLOW");
  return value + BigInt("1");
}
export function authorityFingerprint(value: unknown) {
  try { return createHash("sha256").update(canonicalChatbotValue(value)).digest("hex"); }
  catch { throw new AuthorityError("INVALID_PAYLOAD"); }
}
export function requireAuthorityState(value: unknown): asserts value is AuthorityState {
  requireAuthority(["HUMAN_QUEUE", "HUMAN", "AI", "CHATBOT", "CLOSED"].includes(value as string), "INVALID_STATE");
  requireAuthority(value !== "CHATBOT", "CHATBOT_ACTIVATION_BLOCKED");
}
