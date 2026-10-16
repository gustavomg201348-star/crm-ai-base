export type MetaReplyMetadata = {
  interactionType: "TEMPLATE_BUTTON" | "INTERACTIVE_BUTTON" | "INTERACTIVE_LIST" | "TEXT" | "OTHER";
  optionId: string | null;
  optionTitle: string | null;
  optionIdentity: "PROVIDER_ID" | "TITLE_ONLY" | "MISSING" | "NOT_APPLICABLE";
  sourceTimestamp: Date | null;
  timestampRaw: string | null;
  limitations: string[];
};

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function text(value: unknown, limit: number): string | null {
  return typeof value === "string" && value.trim() && value.length <= limit ? value : null;
}

export function readMetaReplyMetadata(raw: unknown): MetaReplyMetadata {
  const message = object(raw);
  const interactive = object(message.interactive);
  const interactionType = message.type === "button" ? "TEMPLATE_BUTTON"
    : message.type === "interactive" && interactive.type === "button_reply" ? "INTERACTIVE_BUTTON"
    : message.type === "interactive" && interactive.type === "list_reply" ? "INTERACTIVE_LIST"
    : message.type === "text" ? "TEXT" : "OTHER";
  const option = interactionType === "TEMPLATE_BUTTON" ? object(message.button)
    : interactionType === "INTERACTIVE_BUTTON" ? object(interactive.button_reply)
    : interactionType === "INTERACTIVE_LIST" ? object(interactive.list_reply) : {};
  const hasOption = ["TEMPLATE_BUTTON", "INTERACTIVE_BUTTON", "INTERACTIVE_LIST"].includes(interactionType);
  const optionId = text(interactionType === "TEMPLATE_BUTTON" ? option.payload : option.id, 2048);
  const optionTitle = text(interactionType === "TEMPLATE_BUTTON" ? option.text : option.title, 1024);
  const timestampRaw = text(message.timestamp, 32);
  const milliseconds = timestampRaw && /^\d{1,12}$/.test(timestampRaw) ? Number(timestampRaw) * 1000 : NaN;
  const sourceTimestamp = Number.isFinite(milliseconds) && milliseconds > 0 ? new Date(milliseconds) : null;
  const limitations: string[] = [];
  if (hasOption && !optionId) limitations.push("MISSING_OPTION_ID");
  if (hasOption && !optionTitle) limitations.push("MISSING_OPTION_TITLE");
  if (!sourceTimestamp) limitations.push(timestampRaw ? "INVALID_SOURCE_TIMESTAMP" : "MISSING_SOURCE_TIMESTAMP");
  if (interactionType === "OTHER") limitations.push("UNSUPPORTED_INTERACTION");
  return {
    interactionType, optionId, optionTitle,
    optionIdentity: !hasOption ? "NOT_APPLICABLE" : optionId ? "PROVIDER_ID" : optionTitle ? "TITLE_ONLY" : "MISSING",
    sourceTimestamp, timestampRaw, limitations
  };
}
