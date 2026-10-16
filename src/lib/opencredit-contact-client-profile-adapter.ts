import "server-only";
import { buildOpenCreditClientProfilePayload, type OpenCreditClientProfilePayload } from "./opencredit-client-profile-contract";
import { canonicalizeOpenCreditOwnershipCpf, parseOpenCreditProviderScope, type OpenCreditProviderScope } from "./opencredit-commercial-identity-policy";

export type OpenCreditContactClientProfileInput = Readonly<{
  contact: Readonly<{
    id: string; companyId: string; name: string; phone: string;
    email: string | null; cpf: string | null; archivedAt: Date | null;
  }>;
  identity: Readonly<{
    companyId: string; contactId: string; providerScope: OpenCreditProviderScope;
    normalizedCpf: string; enabled: boolean;
  }>;
}>;
const CODES = ["INVALID_INPUT", "INVALID_CONTACT", "INVALID_IDENTITY", "INVALID_PROVIDER_SCOPE",
  "CONTACT_ARCHIVED", "CONTACT_CPF_MISSING", "CONTACT_CPF_INVALID", "IDENTITY_DISABLED",
  "IDENTITY_COMPANY_MISMATCH", "IDENTITY_CONTACT_MISMATCH", "IDENTITY_SNAPSHOT_MISMATCH", "PROFILE_INVALID"] as const;
export type OpenCreditContactClientProfileAdapterCode = typeof CODES[number];
export class OpenCreditContactClientProfileAdapterError extends Error {
  constructor(readonly code: OpenCreditContactClientProfileAdapterCode) {
    super("OPENCREDIT_CONTACT_CLIENT_PROFILE_" + code);
    this.name = "OpenCreditContactClientProfileAdapterError";
  }
}
const fail = (code: OpenCreditContactClientProfileAdapterCode): never => { throw new OpenCreditContactClientProfileAdapterError(code); };
const validId = (value: unknown): value is string => typeof value === "string"
  && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(value);

/** Closed plain snapshots only. Copy descriptors' data values, never invoke accessors. */
function snapshot(value: unknown, keys: readonly string[], code: OpenCreditContactClientProfileAdapterCode): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail(code);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== "string" || !keys.includes(key))) return fail(code);
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return fail(code);
    result[key] = descriptor.value;
  }
  return result;
}

/**
 * Pure technical mapping over trusted, caller-resolved snapshots.
 * "mappable" != "authorized to dispatch": no consent or operation permission.
 * A future caller still needs final freshness and authorization/evidence checks.
 */
export function buildOpenCreditClientProfileFromContact(input: unknown): OpenCreditClientProfilePayload {
  try {
    const root = snapshot(input, ["contact", "identity"], "INVALID_INPUT");
    const contact = snapshot(root.contact, ["id", "companyId", "name", "phone", "email", "cpf", "archivedAt"], "INVALID_CONTACT");
    const identity = snapshot(root.identity, ["companyId", "contactId", "providerScope", "normalizedCpf", "enabled"], "INVALID_IDENTITY");
    if (!validId(contact.id) || !validId(contact.companyId)) return fail("INVALID_CONTACT");
    if (!validId(identity.companyId) || !validId(identity.contactId) || typeof identity.enabled !== "boolean") return fail("INVALID_IDENTITY");
    if (identity.companyId !== contact.companyId) return fail("IDENTITY_COMPANY_MISMATCH");
    if (identity.contactId !== contact.id) return fail("IDENTITY_CONTACT_MISMATCH");
    try { parseOpenCreditProviderScope(identity.providerScope); } catch { return fail("INVALID_PROVIDER_SCOPE"); }
    if (!identity.enabled) return fail("IDENTITY_DISABLED");
    if (contact.archivedAt !== null) {
      let validDate = false;
      try { validDate = Number.isFinite(Date.prototype.getTime.call(contact.archivedAt)); } catch { /* Invalid snapshot, not a date coercion. */ }
      return fail(validDate ? "CONTACT_ARCHIVED" : "INVALID_CONTACT");
    }
    if (contact.cpf === null || contact.cpf === "") return fail("CONTACT_CPF_MISSING");
    let cpf: string;
    try { cpf = canonicalizeOpenCreditOwnershipCpf(contact.cpf); } catch { return fail("CONTACT_CPF_INVALID"); }
    if (typeof identity.normalizedCpf !== "string" || !/^\d{11}(?![\s\S])/.test(identity.normalizedCpf)) return fail("INVALID_IDENTITY");
    if (cpf !== identity.normalizedCpf) return fail("IDENTITY_SNAPSHOT_MISMATCH");
    try {
      return buildOpenCreditClientProfilePayload({ cpf: identity.normalizedCpf, nome: contact.name, celular: contact.phone,
        ...(contact.email === null ? {} : { email: contact.email }) });
    } catch { return fail("PROFILE_INVALID"); }
  } catch (error) {
    let code: OpenCreditContactClientProfileAdapterCode = "INVALID_INPUT";
    try {
      if (error instanceof OpenCreditContactClientProfileAdapterError) {
        const descriptor = Object.getOwnPropertyDescriptor(error, "code");
        if (descriptor && "value" in descriptor && CODES.includes(descriptor.value)) code = descriptor.value;
      }
    } catch { /* Even a hostile thrown value must not escape this boundary. */ }
    // Always a fresh fixed error, never the original exception, message or cause.
    return fail(code);
  }
}
