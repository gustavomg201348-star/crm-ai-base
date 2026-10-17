export const SHADOW_STATES = ["HUMAN_QUEUE", "HUMAN", "AI", "CHATBOT", "CLOSED"] as const;
export type ShadowState = typeof SHADOW_STATES[number];
export type ShadowSource = "CHANNEL_TEXT" | "CONVERSATION_TEXT";
export type ShadowContext = Readonly<{
  companyId: string;
  channelId: string;
  conversationId: string | null;
  actorUserId: string;
  source: ShadowSource;
  intentId: string | null;
  assignedUserId: string | null;
  expectedGeneration?: bigint;
}>;
export type ShadowAuthority = Readonly<{
  companyId: string;
  channelId: string;
  conversationId: string;
  ownerUserId: string | null;
  state: string;
  generation: bigint;
}>;
export type ShadowResult = "COMPATIBLE" | "AUTHORITY_ABSENT" | "OWNER_MISMATCH" |
  "SCOPE_MISMATCH" | "GENERATION_MISMATCH" | "STATE_INELIGIBLE" | "EVALUATION_ERROR";
export type ShadowReason = "HUMAN_OWNER_MATCH" | "NOT_INITIALIZED" | "CONVERSATION_UNAVAILABLE" |
  "OWNER_DIFFERS" | "ASSIGNMENT_DIFFERS" | "SCOPE_DIFFERS" | "GENERATION_DIFFERS" |
  "NOT_HUMAN" | "INVALID_CONTEXT" | "INVALID_AUTHORITY" | "READ_FAILED" | "TIME_BUDGET" | "CAPACITY" | "CONFIG_UNAVAILABLE";
export class ShadowReadFailure extends Error {
  constructor(public readonly reason: "READ_FAILED" | "CAPACITY" | "CONFIG_UNAVAILABLE") {
    super("SHADOW_READ_UNAVAILABLE");
  }
}
export type ShadowDecision = Readonly<{ result: ShadowResult; reason: ShadowReason; state: ShadowState | null }>;
export type ShadowMetric = ShadowDecision & {
  event: "authority_text_shadow";
  source: ShadowSource;
  durationMs: number;
};

export function shadowMode(value: unknown): "OFF" | "SHADOW" {
  return value === "SHADOW" ? "SHADOW" : "OFF";
}

export function validReference(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value;
}

export function validContext(value: ShadowContext): boolean {
  return Boolean(value && validReference(value.companyId) && validReference(value.channelId) &&
    validReference(value.actorUserId) && (value.conversationId === null || validReference(value.conversationId)) &&
    ["CHANNEL_TEXT", "CONVERSATION_TEXT"].includes(value.source) &&
    (value.intentId === null || validReference(value.intentId)) &&
    (value.assignedUserId === null || validReference(value.assignedUserId)));
}
