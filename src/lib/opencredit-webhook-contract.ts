import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeContactCpf } from "@/lib/contacts";
import { classifyPhoneNormalization } from "@/lib/phone-normalization.service";

export const OPENCREDIT_MAX_BODY_BYTES = 64 * 1024;
export class OpenCreditInputError extends Error {
  constructor(readonly code: string, readonly status = 422) {
    super(code);
    this.name = "OpenCreditInputError";
  }
}

// Request-local monotonic budget. Waiting can time out, but this does NOT
// cancel Prisma queries or transactions already in flight.
export class OpenCreditDeadline {
  private readonly expiresAt: number;
  constructor(ms = 8000, private readonly now: () => number = () => performance.now()) {
    this.expiresAt = now() + ms;
  }
  remainingMs() { return Math.max(0, Math.floor(this.expiresAt - this.now())); }
  assertRemaining() {
    if (this.remainingMs() <= 0) throw new OpenCreditInputError("REQUEST_DEADLINE_EXCEEDED", 503);
  }
  async wait<T>(operation: () => Promise<T>): Promise<T> {
    this.assertRemaining();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new OpenCreditInputError("REQUEST_DEADLINE_EXCEEDED", 503)), this.remainingMs());
        })
      ]);
      this.assertRemaining();
      return result;
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
}

function parseAssignedAt(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/i.exec(value);
  if (!match) throw new OpenCreditInputError("INVALID_PAYLOAD");
  const [, y, m, d, h, minute, second, , offsetH = "0", offsetM = "0"] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
      Number(h) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      Number(offsetH) > 23 || Number(offsetM) > 59) {
    throw new OpenCreditInputError("INVALID_PAYLOAD");
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new OpenCreditInputError("INVALID_PAYLOAD");
  return date;
}

export function verifyOpenCreditSignature(raw: Uint8Array, header: string | null, secret: string) {
  if (!secret.trim() || !header || !/^sha256=[a-fA-F0-9]{64}$/.test(header)) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  const received = Buffer.from(header.slice(7), "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OpenCreditInputError("INVALID_PAYLOAD");
  }
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, required = false): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new OpenCreditInputError("INVALID_PAYLOAD");
    return null;
  }
  if (typeof value !== "string" || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new OpenCreditInputError("INVALID_PAYLOAD");
  }
  const result = value.trim();
  if (required && !result) throw new OpenCreditInputError("INVALID_PAYLOAD");
  return result || null;
}

export type OpenCreditAssignedLead = {
  eventId: string;
  externalLeadId: string;
  contractVersion: number;
  assignedAt: Date;
  client: { cpf: string | null; phone: string | null; name: string | null; email: string | null };
};

export function parseOpenCreditAssignedLead(value: unknown): OpenCreditAssignedLead {
  const payload = object(value);
  if (payload.event !== "lead.assigned") throw new OpenCreditInputError("UNSUPPORTED_EVENT");
  if (payload.contractVersion !== 2) throw new OpenCreditInputError("UNSUPPORTED_CONTRACT_VERSION");
  const lead = object(payload.lead);
  const client = payload.client === undefined ? {} : object(payload.client);
  const assignedAtText = text(payload.assignedAt, 40, true)!;
  const assignedAt = parseAssignedAt(assignedAtText);
  const rawCpf = text(client.cpf, 20);
  if (rawCpf && !/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(rawCpf)) {
    throw new OpenCreditInputError("INVALID_CLIENT_IDENTITY");
  }
  const cpf = rawCpf ? normalizeContactCpf(rawCpf) : null;
  if (cpf && !/^\d{11}$/.test(cpf)) throw new OpenCreditInputError("INVALID_CLIENT_IDENTITY");
  const rawPhone = text(client.phone, 30);
  if (rawPhone && !/^\+?[\d\s().-]+$/.test(rawPhone)) {
    throw new OpenCreditInputError("INVALID_CLIENT_IDENTITY");
  }
  // An explicit foreign DDI must never be reinterpreted as a local BR number.
  // Preserve the external lead and allow CPF-only matching instead.
  const foreignPhone = rawPhone?.startsWith("+") && !rawPhone.replace(/\D/g, "").startsWith("55");
  if (rawPhone?.startsWith("+") && !foreignPhone &&
      ![12, 13].includes(rawPhone.replace(/\D/g, "").length)) {
    throw new OpenCreditInputError("INVALID_CLIENT_IDENTITY");
  }
  const phone = rawPhone && !foreignPhone ? classifyPhoneNormalization(rawPhone).normalizedPhone : null;
  if (rawPhone && !foreignPhone && !phone) throw new OpenCreditInputError("INVALID_CLIENT_IDENTITY");
  const email = text(client.email, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new OpenCreditInputError("INVALID_PAYLOAD");
  }
  return {
    eventId: text(payload.eventId, 256, true)!,
    externalLeadId: text(lead.id, 128, true)!,
    contractVersion: 2, assignedAt,
    client: { cpf, phone, name: text(client.name, 160), email }
  };
}
