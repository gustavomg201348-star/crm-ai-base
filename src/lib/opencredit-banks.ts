import "server-only";

export type OpenCreditBank = { bankId: string; bankName: string };

/** Validate the complete payload before projecting an exact, ordered whitelist. */
export function parseOpenCreditBanks(payload: unknown): OpenCreditBank[] | undefined {
  const data = (payload as { data?: { items?: unknown } } | null)?.data;
  if (!data || !Array.isArray(data.items) || data.items.length > 1000
    || !data.items.every(item => item && typeof item === "object" && !Array.isArray(item)
      && typeof item.bankId === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(item.bankId)
      && typeof item.bankName === "string" && item.bankName.trim() && item.bankName.length <= 200)) {
    return undefined;
  }
  // Never spread provider objects or forward data/items wholesale.
  return data.items.map(item => ({ bankId: item.bankId as string, bankName: item.bankName as string }));
}
