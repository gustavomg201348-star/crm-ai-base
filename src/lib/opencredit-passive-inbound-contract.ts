import "server-only";
import { verifyOpenCreditSignature } from "./opencredit-webhook-contract";
import { parseOpenCreditStrictJson } from "./opencredit-strict-json";
import { parseOpenCreditProviderScope } from "./opencredit-commercial-identity-policy";

export type PassiveBinding = Readonly<{ id: string; companyId: string; providerScope: string; webhookSecret: string; passiveInboundEnabled: boolean }>;
export type PassiveMetadata = Readonly<{ eventId: string; eventType: "lead.assigned"; externalLeadId: string; contractVersion: 2 | null }>;
declare const brand: unique symbol;
export type PassiveReceipt = Readonly<{ [brand]: never }>;
const issued = new WeakMap<object, { binding: PassiveBinding; metadata: PassiveMetadata }>();
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
/** Issued only after authenticating original HTTP bytes; no PII/payload retained. */
export function authenticatePassiveInbound(raw: Uint8Array, signature: string | null, secret: string, binding: PassiveBinding): PassiveReceipt {
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
  const receipt = Object.freeze({}) as PassiveReceipt;
  issued.set(receipt, { binding: Object.freeze({ ...binding }), metadata: Object.freeze({ eventId: v.eventId, eventType: "lead.assigned", externalLeadId: lead.id, contractVersion: Object.hasOwn(v, "contractVersion") ? 2 : null }) });
  return receipt;
}
export function readPassiveReceipt(receipt: PassiveReceipt) {
  const entry = receipt && typeof receipt === "object" ? issued.get(receipt) : undefined;
  if (!entry) throw new PassiveInboundError("INVALID_SIGNATURE", 403);
  return { binding: { ...entry.binding }, metadata: { ...entry.metadata } };
}
