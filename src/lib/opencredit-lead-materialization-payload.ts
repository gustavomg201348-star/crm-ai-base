import "server-only";
import { normalizeContactCpf } from "./contacts";
import { classifyPhoneNormalization } from "./phone-normalization.service";
import { decryptSecret, encryptSecret } from "./secret-encryption";
import { getSecretEncryptionOptionsFromEnv } from "./secret-encryption-env";

const purpose = "opencredit_lead_materialization_v1";
const version = 1;
const controlCharacter = new RegExp("\\p{Cc}", "u");
const letter = new RegExp("\\p{L}", "u");
export type MaterializationIdentity = Readonly<{
  cpf: string | null;
  phone: string | null;
  name: string | null;
  email: string | null;
}>;
type MaterializationBinding = Readonly<{
  companyId: string;
  providerScope: string;
  integrationId: string;
  eventId: string;
  externalLeadId: string;
}>;

function field(value: unknown, max: number) {
  if (typeof value !== "string" || value.length > max || controlCharacter.test(value)) return null;
  return value.trim() || null;
}

function normalizeCpf(value: string | null) {
  if (!value || !/^(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/.test(value)) return null;
  const cpf = normalizeContactCpf(value);
  if (/^(\d)\1{10}$/.test(cpf)) return null;
  const digits = Array.from(cpf, Number);
  for (const length of [9, 10]) {
    const sum = digits.slice(0, length).reduce((total, digit, index) => total + digit * (length + 1 - index), 0);
    if (digits[length] !== (sum * 10 % 11) % 10) return null;
  }
  return cpf;
}

export function readMaterializationIdentity(value: unknown): MaterializationIdentity {
  const client = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rawPhone = field(client.phone, 30);
  const digits = rawPhone?.replace(/\D/g, "") ?? "";
  const phone = rawPhone && /^\+?[\d ().-]+$/.test(rawPhone) &&
    (!rawPhone.startsWith("+") || digits.startsWith("55") && [12, 13].includes(digits.length))
    ? classifyPhoneNormalization(rawPhone).normalizedPhone : null;
  const name = field(client.name, 160);
  const email = field(client.email, 254);
  return {
    cpf: normalizeCpf(field(client.cpf, 20)),
    phone,
    name: name && letter.test(name) ? name : null,
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
  };
}

export function protectMaterializationIdentity(binding: MaterializationBinding, identity: MaterializationIdentity, options = getSecretEncryptionOptionsFromEnv()) {
  if (!options) throw new Error("OPENCREDIT_MATERIALIZATION_KEY_UNAVAILABLE");
  const { companyId, providerScope, integrationId, eventId, externalLeadId } = binding;
  const { cpf, phone, name, email } = identity;
  return encryptSecret(JSON.stringify({ version, purpose, companyId, providerScope, integrationId, eventId, externalLeadId, cpf, phone, name, email }), options);
}

export function openMaterializationIdentity(envelope: string, expected: MaterializationBinding, options = getSecretEncryptionOptionsFromEnv()): MaterializationIdentity {
  if (!options) throw new Error("OPENCREDIT_MATERIALIZATION_KEY_UNAVAILABLE");
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(decryptSecret(envelope, options));
  } catch {
    throw new Error("OPENCREDIT_MATERIALIZATION_ENVELOPE_INVALID");
  }
  if (!value || value.version !== version || value.purpose !== purpose ||
      value.companyId !== expected.companyId || value.providerScope !== expected.providerScope ||
      value.integrationId !== expected.integrationId || value.eventId !== expected.eventId ||
      value.externalLeadId !== expected.externalLeadId) {
    throw new Error("OPENCREDIT_MATERIALIZATION_ENVELOPE_INVALID");
  }
  const identity = readMaterializationIdentity(value);
  if (identity.cpf !== value.cpf || identity.phone !== value.phone || identity.name !== value.name || identity.email !== value.email) {
    throw new Error("OPENCREDIT_MATERIALIZATION_ENVELOPE_INVALID");
  }
  return identity;
}
