import "server-only";

export type OpenCreditBank = { bankId: string; bankName: string };
export const openCreditCapabilityKeys = [
  "simulacaoAtiva", "digitacaoAtiva", "suportaParcela", "suportaLiquido",
  "aceitaChavePixReal", "somentePix", "exigeContatoEmpregador"
] as const;
export type OpenCreditCapabilities = Partial<Record<typeof openCreditCapabilityKeys[number], boolean>>;
export type OpenCreditBankCapabilities = OpenCreditBank & { capabilities: OpenCreditCapabilities };

function bankItems(payload: unknown): (OpenCreditBank & Record<string, unknown>)[] | undefined {
  const data = (payload as { data?: { items?: unknown } } | null)?.data;
  if (!data || !Array.isArray(data.items) || data.items.length > 1000
    || !data.items.every(item => item && typeof item === "object" && !Array.isArray(item)
      && typeof item.bankId === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(item.bankId)
      && typeof item.bankName === "string" && item.bankName.trim() && item.bankName.length <= 200)) {
    return undefined;
  }
  return data.items;
}

/** Local QEVORA policy, not formal OpenAPI required/nullability rules. */
export function parseOpenCreditCapabilities(value: unknown): OpenCreditCapabilities | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const result: OpenCreditCapabilities = {};
  for (const key of openCreditCapabilityKeys) {
    if (Object.hasOwn(source, key)) {
      const flag = source[key];
      if (typeof flag !== "boolean") return undefined;
      result[key] = flag;
    }
  }
  return result;
}

/** Basic callers intentionally ignore capability fields, preserving their contract. */
export function parseOpenCreditBanks(payload: unknown): OpenCreditBank[] | undefined {
  return bankItems(payload)?.map(item => ({ bankId: item.bankId, bankName: item.bankName }));
}

export function parseOpenCreditBankCapabilities(payload: unknown): OpenCreditBankCapabilities[] | undefined {
  const items = bankItems(payload);
  if (!items) return undefined;
  const banks: OpenCreditBankCapabilities[] = [];
  for (const item of items) {
    const capabilities = parseOpenCreditCapabilities(item);
    if (!capabilities) return undefined;
    banks.push({ bankId: item.bankId, bankName: item.bankName, capabilities });
  }
  return banks;
}
