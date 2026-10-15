import "server-only";

export const configuredOpenCreditId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);

type Claim<T> = { present: boolean; value?: T };
type TokenSummary = { format: "opaque" } | {
  format: "jwt"; decodedOnly: true;
  role: Claim<string[]>; tenant: Claim<string>; partner: Claim<string>;
};

// Explicit aliases only. Conflicting aliases report presence without a value.
function claim<T>(payload: Record<string, unknown>, keys: string[], parse: (value: unknown) => T | undefined): Claim<T> {
  const values = keys.filter(key => Object.hasOwn(payload, key)).map(key => parse(payload[key]));
  if (!values.length) return { present: false };
  if (values.some(value => value === undefined) || values.some(value => JSON.stringify(value) !== JSON.stringify(values[0]))) {
    return { present: true };
  }
  return { present: true, value: values[0] };
}

function id(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) value = String(value);
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
}

function roles(value: unknown): string[] | undefined {
  const values = typeof value === "string" ? [value] : value;
  return Array.isArray(values) && values.length <= 10
    && values.every(v => typeof v === "string" && v.trim() && /^[A-Za-z0-9 _:-]{1,64}$/.test(v))
    ? values : undefined;
}

/** Decoded/unverified diagnostic data only; NEVER QEVORA authorization. */
export function summarizeOpenCreditAccessToken(token: string, tenant: string, partner: string, secrets: readonly string[]) {
  const secretValue = (value: string) => secrets.some(secret => secret && value.includes(secret));
  const safeId = (value: unknown) => {
    const parsed = id(value);
    return parsed !== undefined && !secretValue(parsed) ? parsed : undefined;
  };
  const safeRoles = (value: unknown) => {
    const parsed = roles(value);
    return parsed && !parsed.some(secretValue) ? parsed : undefined;
  };
  let summary: TokenSummary = { format: "opaque" };
  const parts = token.split(".");
  if (parts.length === 3 && parts.every(part => /^[A-Za-z0-9_-]+$/.test(part)) && parts[1].length <= 16_384) {
    try {
      const bytes = Buffer.from(parts[1], "base64url");
      // Reject permissive/noncanonical base64 and malformed UTF-8 rather than exposing replacement data.
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const payload: unknown = JSON.parse(text);
      if (bytes.toString("base64url") === parts[1] && payload && typeof payload === "object" && !Array.isArray(payload)) {
        summary = { format: "jwt", decodedOnly: true,
          role: claim(payload as Record<string, unknown>, ["role", "roles"], safeRoles),
          tenant: claim(payload as Record<string, unknown>, ["tenantId", "tenant_id"], safeId),
          partner: claim(payload as Record<string, unknown>, ["partnerId", "partner_id"], safeId)
        };
      }
    } catch { /* Malformed/unsupported tokens have no decoded claims. */ }
  }
  const tokenTenant = summary.format === "jwt" ? summary.tenant.value : undefined;
  const tokenPartner = summary.format === "jwt" ? summary.partner.value : undefined;
  return {
    token: summary,
    tenantMatchesConfigured: tokenTenant === undefined ? null : tokenTenant === tenant,
    partnerMatchesConfigured: tokenPartner === undefined ? null : tokenPartner === partner
  };
}

export function openCreditCorrelationIds(headers: Headers, secrets: readonly string[]) {
  const result: { requestId?: string; correlationId?: string; traceId?: string; traceparent?: string } = {};
  for (const [header, key] of [
    ["x-request-id", "requestId"], ["x-correlation-id", "correlationId"],
    ["x-trace-id", "traceId"], ["traceparent", "traceparent"]
  ] as const) {
    const value = headers.get(header);
    // Conservative printable ASCII subset; never arbitrary headers.
    if (value && /^[A-Za-z0-9_.: /=-]{1,256}$/.test(value)
      && !secrets.some(secret => secret && value.includes(secret))) result[key] = value;
  }
  return result;
}
