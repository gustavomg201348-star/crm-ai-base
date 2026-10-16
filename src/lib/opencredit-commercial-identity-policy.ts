import "server-only";

declare const scopeBrand: unique symbol;
/** Trusted logical remote identity namespace, not proof of authorization or credential identity. */
export type OpenCreditProviderScope = string & { readonly [scopeBrand]: "OpenCreditProviderScope" };

export class OpenCreditCommercialIdentityPolicyError extends Error {
  constructor(readonly code: "INVALID_PROVIDER_SCOPE" | "INVALID_OWNERSHIP_CPF") {
    super(`OPENCREDIT_COMMERCIAL_IDENTITY_${code}`);
    this.name = "OpenCreditCommercialIdentityPolicyError";
  }
}

/** Local syntax only. A future trusted caller must resolve and assign the namespace. */
export function parseOpenCreditProviderScope(value: unknown): OpenCreditProviderScope {
  if (typeof value !== "string" || value.length > 64
    || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?![\s\S])/.test(value) || /\d{11}/.test(value)) {
    throw new OpenCreditCommercialIdentityPolicyError("INVALID_PROVIDER_SCOPE");
  }
  return value as OpenCreditProviderScope;
}

/** CANONICAL CPF IS AN IDENTITY KEY, NOT VALIDATION OF OWNERSHIP OR VALIDITY. */
export function canonicalizeOpenCreditOwnershipCpf(value: unknown): string {
  if (typeof value !== "string" || !/^(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})(?![\s\S])/.test(value)) {
    throw new OpenCreditCommercialIdentityPolicyError("INVALID_OWNERSHIP_CPF");
  }
  // Only the already-validated conventional punctuation can be removed.
  return value.replace(/[.-]/g, "");
}

export type OpenCreditCommercialAccessSnapshot = Readonly<{
  companyId: string;
  providerScope: OpenCreditProviderScope;
  enabled: boolean;
}>;
export type OpenCreditRemoteIdentitySnapshot = Readonly<{
  companyId: string;
  contactId: string;
  providerScope: OpenCreditProviderScope;
  normalizedCpf: string;
  enabled: boolean;
}>;
export type OpenCreditIdentityUseInput = Readonly<{
  companyId: string;
  contactId: string;
  contactCpf: string | null | undefined;
  contactArchived: boolean;
  matchingContactCount: number;
  providerScope: OpenCreditProviderScope;
  commercialAccess: OpenCreditCommercialAccessSnapshot | null;
  existingIdentity: OpenCreditRemoteIdentitySnapshot | null;
}>;
export type OpenCreditIdentityDenialReason =
  | "INVALID_FACTS"
  | "PROVIDER_SCOPE_INVALID"
  | "COMMERCIAL_ACCESS_MISSING"
  | "COMMERCIAL_ACCESS_DISABLED"
  | "COMMERCIAL_SCOPE_MISMATCH"
  | "COMMERCIAL_COMPANY_MISMATCH"
  | "CONTACT_ARCHIVED"
  | "CONTACT_CPF_MISSING"
  | "CONTACT_CPF_INVALID"
  | "CONTACT_AMBIGUOUS"
  | "IDENTITY_SCOPE_MISMATCH"
  | "IDENTITY_COMPANY_MISMATCH"
  | "IDENTITY_CONTACT_MISMATCH"
  | "IDENTITY_CPF_MISMATCH"
  | "IDENTITY_DISABLED";
export type OpenCreditIdentityDecision =
  | { allowed: true; action: "CLAIM" | "REUSE"; normalizedCpf: string; providerScope: OpenCreditProviderScope }
  | { allowed: false; reason: OpenCreditIdentityDenialReason };

const deny = (reason: OpenCreditIdentityDenialReason): OpenCreditIdentityDecision => ({ allowed: false, reason });
const validId = (value: unknown): value is string => typeof value === "string"
  && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(value);

/**
 * Decision over trusted caller-resolved facts only, not an execution authorization.
 * CLAIM is a candidate: future atomic uniqueness enforcement must succeed first.
 * This function neither resolves session permissions nor operation authorization.
 */
export function evaluateOpenCreditIdentityUse(input: OpenCreditIdentityUseInput): OpenCreditIdentityDecision {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) return deny("INVALID_FACTS");
    let providerScope: OpenCreditProviderScope;
    try { providerScope = parseOpenCreditProviderScope(input.providerScope); }
    catch { return deny("PROVIDER_SCOPE_INVALID"); }
    if (!validId(input.companyId) || !validId(input.contactId)) return deny("INVALID_FACTS");
    const access = input.commercialAccess;
    if (access === null || access === undefined) return deny("COMMERCIAL_ACCESS_MISSING");
    if (typeof access !== "object" || Array.isArray(access)) return deny("INVALID_FACTS");
    if (typeof access.enabled !== "boolean") return deny("INVALID_FACTS");
    if (!access.enabled) return deny("COMMERCIAL_ACCESS_DISABLED");
    if (access.providerScope !== providerScope) return deny("COMMERCIAL_SCOPE_MISMATCH");
    if (access.companyId !== input.companyId) return deny("COMMERCIAL_COMPANY_MISMATCH");
    if (typeof input.contactArchived !== "boolean") return deny("INVALID_FACTS");
    if (input.contactArchived) return deny("CONTACT_ARCHIVED");
    if (input.contactCpf === null || input.contactCpf === undefined || input.contactCpf === "") return deny("CONTACT_CPF_MISSING");
    let normalizedCpf: string;
    try { normalizedCpf = canonicalizeOpenCreditOwnershipCpf(input.contactCpf); }
    catch { return deny("CONTACT_CPF_INVALID"); }
    const count = input.matchingContactCount;
    if (!Number.isSafeInteger(count) || count < 0 || count > 1_000_000) return deny("INVALID_FACTS");
    if (count !== 1) return deny("CONTACT_AMBIGUOUS");
    const identity = input.existingIdentity;
    // Only explicit absence is safe to propose a claim; omitted/unresolved is not absence.
    if (identity === null) return { allowed: true, action: "CLAIM", normalizedCpf, providerScope };
    if (!identity || typeof identity !== "object" || Array.isArray(identity)) return deny("INVALID_FACTS");
    if (identity.providerScope !== providerScope) return deny("IDENTITY_SCOPE_MISMATCH");
    if (identity.companyId !== input.companyId) return deny("IDENTITY_COMPANY_MISMATCH");
    if (identity.contactId !== input.contactId) return deny("IDENTITY_CONTACT_MISMATCH");
    if (identity.normalizedCpf !== normalizedCpf) return deny("IDENTITY_CPF_MISMATCH");
    if (typeof identity.enabled !== "boolean") return deny("INVALID_FACTS");
    if (!identity.enabled) return deny("IDENTITY_DISABLED");
    return { allowed: true, action: "REUSE", normalizedCpf, providerScope };
  } catch {
    // Never retain caller exceptions, identifiers or submitted data.
    return deny("INVALID_FACTS");
  }
}
