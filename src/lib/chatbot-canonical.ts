import { ChatbotError } from "./chatbot-definition";

// Shared foundation encoding: object keys sorted, array order preserved.
export function canonicalChatbotValue(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(item: unknown): string {
    if (item === null || typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number" && Number.isFinite(item)) return JSON.stringify(item);
    if (!item || typeof item !== "object" || (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype) || ancestors.has(item)) {
      throw new ChatbotError("INVALID_PAYLOAD");
    }
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        for (let index = 0; index < item.length; index++) {
          if (!Object.hasOwn(item, index)) throw new ChatbotError("INVALID_PAYLOAD");
        }
        return `[${item.map(encode).join(",")}]`;
      }
      return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${encode((item as Record<string, unknown>)[key])}`).join(",")}}`;
    } finally { ancestors.delete(item); }
  }
  return encode(value);
}
