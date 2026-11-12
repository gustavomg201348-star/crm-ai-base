import "server-only";
import { verifyOpenCreditSignature } from "./opencredit-webhook-contract";
import { parseOpenCreditStrictJson } from "./opencredit-strict-json";
import { parseOpenCreditProviderScope } from "./opencredit-commercial-identity-policy";
import { readMaterializationIdentity, type MaterializationIdentity } from "./opencredit-lead-materialization-payload";

export type PassiveBinding = Readonly<{ id: string; companyId: string; providerScope: string; webhookSecret: string; passiveInboundEnabled: boolean }>;
export type PassiveMetadata = Readonly<{ eventId: string; eventType: "lead.assigned"; externalLeadId: string; contractVersion: 2 | null }>;
const phoneCandidates = ["cellphone", "contact", "mobile", "phone", "phones", "telephone", "whatsapp"] as const;
const clientKeys = [...phoneCandidates, "cellPhone", "contacts", "cpf", "email", "firstName", "fullName", "lastName",
  "mobilePhone", "name", "number", "phoneNumber", "value"].sort();
const topLevelKeys = [...clientKeys, "client", "contractVersion", "customer", "data", "event", "eventId", "lead"].sort();
type ShapeType = "string" | "number" | "boolean" | "object" | "array" | "null";
type Shape = { type: ShapeType; fields?: Record<string, Shape>; unknownKeys?: boolean; unknownSafeKeys?: string[] };
export type PassiveInboundShapeDiagnostic = {
  event: "opencredit_inbound_shape_diagnostic";
  eventType: "lead.assigned";
  contractVersion: 2 | null;
  topLevelKeys: string[];
  unknownTopLevelKeys: boolean;
  clientShape: Shape | null;
  phoneCandidates: Record<typeof phoneCandidates[number], boolean>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const safeDiagnosticKey = (key: string) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key);
function describeShape(value: unknown, depth: number): Shape {
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) return { type: "array" };
  if (isRecord(value)) {
    if (depth === 0) return { type: "object" };
    const keys = clientKeys.filter(key => Object.hasOwn(value, key));
    const unknownKeys = Object.keys(value).filter(key => !clientKeys.includes(key as typeof clientKeys[number]));
    return {
      type: "object",
      fields: Object.fromEntries(keys.map(key => [key, describeShape(value[key], depth - 1)])),
      unknownKeys: unknownKeys.length > 0,
      ...(unknownKeys.length ? { unknownSafeKeys: unknownKeys.filter(safeDiagnosticKey).sort().slice(0, 20) } : {})
    };
  }
  if (typeof value === "string") return { type: "string" };
  if (typeof value === "number") return { type: "number" };
  return { type: "boolean" }; // Strict JSON has no other scalar types.
}

function describeInboundShape(value: Record<string, unknown>, contractVersion: 2 | null): PassiveInboundShapeDiagnostic {
  const keys = topLevelKeys.filter(key => Object.hasOwn(value, key));
  const client = value.client;
  return {
    event: "opencredit_inbound_shape_diagnostic",
    eventType: "lead.assigned",
    contractVersion,
    topLevelKeys: keys,
    unknownTopLevelKeys: Object.keys(value).length > keys.length,
    clientShape: Object.hasOwn(value, "client") ? describeShape(client, 2) : null,
    phoneCandidates: Object.fromEntries(phoneCandidates.map(key => [
      key, isRecord(client) && Object.hasOwn(client, key)
    ])) as PassiveInboundShapeDiagnostic["phoneCandidates"]
  };
}

declare const brand: unique symbol;
export type PassiveReceipt = Readonly<{ [brand]: never }>;
const issued = new WeakMap<object, { binding: PassiveBinding; metadata: PassiveMetadata; identity: MaterializationIdentity }>();
export class PassiveInboundError extends Error {
  constructor(readonly code: "UNAVAILABLE" | "INVALID_SIGNATURE" | "INVALID_JSON" | "INVALID_EVENT" | "EVENT_CONFLICT", readonly status: number) {
    super("OPENCREDIT_INBOUND_" + code); this.name = "PassiveInboundError"; this.stack = this.name + ": " + this.message;
  }
}
export const opaqueInboundId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(v) && !/^\d+$/.test(v);
export function validatePassiveBinding(b: PassiveBinding): void {
  if (!b || !opaqueInboundId(b.id) || !opaqueInboundId(b.companyId) || b.passiveInboundEnabled !== true || typeof b.webhookSecret !== "string" || !b.webhookSecret) throw new PassiveInboundError("UNAVAILABLE", 403);
  try { parseOpenCreditProviderScope(b.providerScope); } catch { throw new PassiveInboundError("UNAVAILABLE", 403); }
}
/** Issued only after authenticating original HTTP bytes; the raw payload is never retained. */
export function authenticatePassiveInbound(raw: Uint8Array, signature: string | null, secret: string, binding: PassiveBinding,
  observeShape?: (event: PassiveInboundShapeDiagnostic) => void): PassiveReceipt {
  validatePassiveBinding(binding);
  if (!(raw instanceof Uint8Array) || raw.byteLength > 65536) throw new PassiveInboundError("INVALID_EVENT", 413);
  if (!signature || !/^sha256=[a-fA-F0-9]{64}(?![\s\S])/.test(signature) || !verifyOpenCreditSignature(raw, signature, secret)) throw new PassiveInboundError("INVALID_SIGNATURE", 403);
  let value: unknown;
  try { value = parseOpenCreditStrictJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw)); } catch { throw new PassiveInboundError("INVALID_JSON", 400); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PassiveInboundError("INVALID_EVENT", 422);
  const v = value as Record<string, unknown>, lead = v.lead as Record<string, unknown> | undefined;
  if (v.event !== "lead.assigned" || !lead || typeof lead !== "object" || Array.isArray(lead) || !opaqueInboundId(lead.id) || typeof v.eventId !== "string") throw new PassiveInboundError("INVALID_EVENT", 422);
  const parts = v.eventId.split(":");
  if (parts.length !== 2 || parts[0] !== lead.id || !parts.every(opaqueInboundId)) throw new PassiveInboundError("INVALID_EVENT", 422);
  if (Object.hasOwn(v, "contractVersion") && v.contractVersion !== 2) throw new PassiveInboundError("INVALID_EVENT", 422);
  const contractVersion = Object.hasOwn(v, "contractVersion") ? 2 : null;
  if (observeShape) {
    try { observeShape(describeInboundShape(v, contractVersion)); }
    catch { /* Diagnostic failure cannot affect ingestion. */ }
  }
  const receipt = Object.freeze({}) as PassiveReceipt;
  issued.set(receipt, {
    binding: Object.freeze({ ...binding }),
    metadata: Object.freeze({ eventId: v.eventId, eventType: "lead.assigned", externalLeadId: lead.id, contractVersion }),
    identity: Object.freeze(readMaterializationIdentity(v.client)),
  });
  return receipt;
}
function readIssuedReceipt(receipt: PassiveReceipt) {
  const entry = receipt && typeof receipt === "object" ? issued.get(receipt) : undefined;
  if (!entry) throw new PassiveInboundError("INVALID_SIGNATURE", 403);
  return entry;
}
export function readPassiveReceipt(receipt: PassiveReceipt) {
  const entry = readIssuedReceipt(receipt);
  return { binding: { ...entry.binding }, metadata: { ...entry.metadata } };
}
export function readPassiveMaterializationInput(receipt: PassiveReceipt) {
  return readIssuedReceipt(receipt).identity;
}
