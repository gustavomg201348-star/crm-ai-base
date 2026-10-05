export const AI_REPLY_PROMPT_VERSION = "ai-reply-v1";

export const AI_REPLY_LIMITS = {
  suggestedReply: 1_200,
  summary: 600,
  nextAction: 400,
  reason: 600,
  tags: 4,
  tag: 80
} as const;

export type AiReplyTemperature = "HOT" | "WARM" | "COLD";

export type ValidatedAiReply = {
  summary: string;
  temperature: AiReplyTemperature;
  nextAction: string;
  suggestedReply: string;
  confidence: number;
  tags: string[];
  shouldTransferToHuman: boolean;
  reason?: string;
};

export class InvalidAiReplyResponseError extends Error {
  constructor() {
    super("A resposta do provedor de IA nao possui o formato esperado.");
    this.name = "InvalidAiReplyResponseError";
  }
}

export class InvalidAiReplyRequestError extends Error {
  constructor() {
    super("Requisicao invalida.");
    this.name = "InvalidAiReplyRequestError";
  }
}

export function parseAiReplyRequestBody(rawBody: string) {
  if (!rawBody.trim()) return {} as { replyToMessageId?: string | null };

  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw new InvalidAiReplyRequestError();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidAiReplyRequestError();
  }

  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((field) => field !== "replyToMessageId")) {
    throw new InvalidAiReplyRequestError();
  }
  if (
    body.replyToMessageId !== undefined &&
    body.replyToMessageId !== null &&
    typeof body.replyToMessageId !== "string"
  ) {
    throw new InvalidAiReplyRequestError();
  }
  return {
    ...(typeof body.replyToMessageId === "string"
      ? { replyToMessageId: body.replyToMessageId }
      : {})
  };
}

function requiredString(value: unknown, maxLength: number) {
  if (typeof value !== "string") throw new InvalidAiReplyResponseError();
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new InvalidAiReplyResponseError();
  }
  return normalized;
}

function optionalString(value: unknown, maxLength: number) {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredString(value, maxLength);
}

function temperature(value: unknown): AiReplyTemperature {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (normalized === "HOT" || normalized === "WARM" || normalized === "COLD") {
    return normalized;
  }
  throw new InvalidAiReplyResponseError();
}

function confidence(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidAiReplyResponseError();
  }
  if (value < 0 || value > 100) throw new InvalidAiReplyResponseError();
  return Math.round(value);
}

function tags(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > AI_REPLY_LIMITS.tags) {
    throw new InvalidAiReplyResponseError();
  }
  return value.map((tag) => requiredString(tag, AI_REPLY_LIMITS.tag));
}

export function parseAiReplyResponse(value: unknown): ValidatedAiReply {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidAiReplyResponseError();
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.shouldTransferToHuman !== "boolean") {
    throw new InvalidAiReplyResponseError();
  }
  const reason = optionalString(candidate.reason, AI_REPLY_LIMITS.reason);

  return {
    summary: requiredString(candidate.summary, AI_REPLY_LIMITS.summary),
    temperature: temperature(candidate.temperature),
    nextAction: requiredString(candidate.nextAction, AI_REPLY_LIMITS.nextAction),
    suggestedReply: requiredString(
      candidate.suggestedReply,
      AI_REPLY_LIMITS.suggestedReply
    ),
    confidence: confidence(candidate.confidence),
    tags: tags(candidate.tags),
    shouldTransferToHuman: candidate.shouldTransferToHuman,
    ...(reason ? { reason } : {})
  };
}
