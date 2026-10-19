import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import { isPlatformAdmin } from "./permissions";
import { canonicalizeOpenCreditOwnershipCpf, parseOpenCreditProviderScope, type OpenCreditProviderScope } from "./opencredit-commercial-identity-policy";

const CODES = ["NOT_AUTHORIZED", "INVALID_COMPANY", "INVALID_CONTACT", "INVALID_PROVIDER_SCOPE", "INVALID_EVIDENCE",
  "COMPANY_NOT_FOUND", "CONTACT_NOT_FOUND", "CONTACT_ARCHIVED", "CONTACT_CPF_MISSING", "CONTACT_CPF_INVALID",
  "CONTACT_AMBIGUOUS", "COMMERCIAL_ACCESS_MISSING", "COMMERCIAL_ACCESS_DISABLED", "IDENTITY_NOT_FOUND", "IDENTITY_DISABLED",
  "IDENTITY_SNAPSHOT_MISMATCH", "IDENTITY_CONFLICT", "EVIDENCE_NOT_FOUND", "EVIDENCE_SCOPE_MISMATCH", "EVIDENCE_NOT_VERIFIED",
  "EVIDENCE_UNSUPPORTED", "AUTHORIZATION_CONFLICT", "CONCURRENT_CONFLICT", "STORAGE_ERROR"] as const;
export type OpenCreditConsumerAuthorizationCode = typeof CODES[number];
export class OpenCreditConsumerAuthorizationServiceError extends Error {
  constructor(readonly code: OpenCreditConsumerAuthorizationCode) {
    super("OPENCREDIT_CONSUMER_AUTHORIZATION_" + code);
    this.name = "OpenCreditConsumerAuthorizationServiceError";
  }
}
type Db = Pick<PrismaClient, "$transaction">;
export type OpenCreditConsumerAuthorizationInput = Readonly<{
  actor: SessionUser; companyId: string; contactId: string; providerScope: OpenCreditProviderScope;
}>;
export type OpenCreditConsumerAuthorizationGrantInput = OpenCreditConsumerAuthorizationInput & Readonly<{ inboundEventId: string }>;
export type OpenCreditConsumerAuthorizationResult = Readonly<{
  changed: boolean; authorizationId: string | null; active: boolean; revision: number | null;
}>;
const PURPOSE = "CLIENT_PROFILE_UPSERT";
const fail = (code: OpenCreditConsumerAuthorizationCode): never => { throw new OpenCreditConsumerAuthorizationServiceError(code); };
const validId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(v);
const email = (v: string) => v.trim().toLowerCase();
function closed(value: unknown, keys: readonly string[], code: OpenCreditConsumerAuthorizationCode): Record<string, unknown> {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return fail(code);
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return fail(code);
    const own = Reflect.ownKeys(value);
    if (own.length !== keys.length || own.some(k => typeof k !== "string" || !keys.includes(k))) return fail(code);
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d || !d.enumerable || !("value" in d)) return fail(code);
      result[key] = d.value;
    }
    return result;
  } catch { return fail(code); }
}
function input(value: unknown, grant: boolean): OpenCreditConsumerAuthorizationGrantInput {
  const raw = closed(value, ["actor", "companyId", "contactId", "providerScope", ...(grant ? ["inboundEventId"] : [])], "INVALID_EVIDENCE");
  if (!validId(raw.companyId)) return fail("INVALID_COMPANY");
  if (!validId(raw.contactId)) return fail("INVALID_CONTACT");
  if (grant && !validId(raw.inboundEventId)) return fail("INVALID_EVIDENCE");
  let providerScope: OpenCreditProviderScope;
  try { providerScope = parseOpenCreditProviderScope(raw.providerScope); } catch { return fail("INVALID_PROVIDER_SCOPE"); }
  const a = closed(raw.actor, ["id", "companyId", "role", "email", "name"], "NOT_AUTHORIZED");
  if (!validId(a.id) || !validId(a.companyId) || a.role !== "ADMIN" || typeof a.email !== "string"
    || !email(a.email) || a.email.length > 254 || typeof a.name !== "string") return fail("NOT_AUTHORIZED");
  const actor: SessionUser = { id: a.id, companyId: a.companyId, role: a.role, email: a.email, name: a.name };
  if (!isPlatformAdmin(actor)) return fail("NOT_AUTHORIZED");
  return { actor, companyId: raw.companyId, contactId: raw.contactId, providerScope, inboundEventId: grant ? raw.inboundEventId as string : "" };
}
async function authorize(tx: Prisma.TransactionClient, i: OpenCreditConsumerAuthorizationInput) {
  const a = await tx.user.findUnique({ where: { id: i.actor.id }, select: { id: true, companyId: true, role: true, email: true, name: true } });
  if (!a || a.id !== i.actor.id || a.companyId !== i.actor.companyId || a.role !== i.actor.role
    || email(a.email) !== email(i.actor.email) || !isPlatformAdmin({ ...a, role: i.actor.role })) return fail("NOT_AUTHORIZED");
  if (!await tx.company.findUnique({ where: { id: i.companyId }, select: { id: true } })) return fail("COMPANY_NOT_FOUND");
  return a.id;
}
function expectedUnique(e: Prisma.PrismaClientKnownRequestError) {
  if (e.meta?.modelName !== undefined && e.meta.modelName !== "OpenCreditConsumerAuthorization") return false;
  const target = e.meta?.target;
  return target === "OCConsumerAuth_company_scope_contact_purpose_key" || Array.isArray(target) && target.length === 4
    && ["companyId", "providerScope", "contactId", "purpose"].every(k => target.includes(k));
}
async function transaction(db: Db, i: OpenCreditConsumerAuthorizationInput,
  run: (tx: Prisma.TransactionClient, actorId: string, creating: () => void) => Promise<OpenCreditConsumerAuthorizationResult>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let createInProgress = false;
    try {
      return await db.$transaction(async tx => run(tx, await authorize(tx, i), () => { createInProgress = true; }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 5000 });
    } catch (error) {
      let semantic: OpenCreditConsumerAuthorizationCode | undefined; let retryable = false;
      try {
        if (error instanceof OpenCreditConsumerAuthorizationServiceError) {
          const d = Object.getOwnPropertyDescriptor(error, "code");
          if (d && "value" in d && CODES.includes(d.value)) semantic = d.value;
        } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
          retryable = error.code === "P2034" || createInProgress && error.code === "P2002" && expectedUnique(error);
        }
      } catch { /* Never expose raw storage exceptions. */ }
      if (semantic) return fail(semantic);
      if (retryable && attempt < 2) continue;
      return fail(retryable ? "CONCURRENT_CONFLICT" : "STORAGE_ERROR");
    }
  }
  return fail("CONCURRENT_CONFLICT");
}
async function freshIdentity(tx: Prisma.TransactionClient, i: OpenCreditConsumerAuthorizationInput) {
  const c = await tx.contact.findUnique({ where: { companyId_id: { companyId: i.companyId, id: i.contactId } },
    select: { id: true, companyId: true, cpf: true, archivedAt: true } });
  if (!c) return fail("CONTACT_NOT_FOUND");
  if (c.companyId !== i.companyId || c.id !== i.contactId) return fail("CONTACT_NOT_FOUND");
  if (c.archivedAt !== null) return fail("CONTACT_ARCHIVED");
  if (c.cpf === null || c.cpf === "") return fail("CONTACT_CPF_MISSING");
  let cpf: string;
  try { cpf = canonicalizeOpenCreditOwnershipCpf(c.cpf); } catch { return fail("CONTACT_CPF_INVALID"); }
  const formatted = cpf.slice(0, 3) + "." + cpf.slice(3, 6) + "." + cpf.slice(6, 9) + "-" + cpf.slice(9);
  const matches = await tx.contact.findMany({ where: { companyId: i.companyId, cpf: { in: [cpf, formatted] } }, take: 2, select: { id: true } });
  if (matches.length !== 1 || matches[0].id !== i.contactId) return fail("CONTACT_AMBIGUOUS");
  const access = await tx.openCreditCommercialAccess.findUnique({ where: { companyId_providerScope: { companyId: i.companyId, providerScope: i.providerScope } }, select: { enabled: true } });
  if (!access) return fail("COMMERCIAL_ACCESS_MISSING");
  if (!access.enabled) return fail("COMMERCIAL_ACCESS_DISABLED");
  const identity = await tx.openCreditRemoteIdentity.findUnique({
    where: { companyId_providerScope_contactId: { companyId: i.companyId, providerScope: i.providerScope, contactId: i.contactId } },
    select: { id: true, companyId: true, contactId: true, providerScope: true, normalizedCpf: true, enabled: true } });
  if (!identity) return fail("IDENTITY_NOT_FOUND");
  if (identity.companyId !== i.companyId || identity.contactId !== i.contactId || identity.providerScope !== i.providerScope) return fail("IDENTITY_CONFLICT");
  if (!identity.enabled) return fail("IDENTITY_DISABLED");
  if (identity.normalizedCpf !== cpf) return fail("IDENTITY_SNAPSHOT_MISMATCH");
  const owner = await tx.openCreditRemoteIdentity.findUnique({ where: { providerScope_normalizedCpf: { providerScope: i.providerScope, normalizedCpf: cpf } }, select: { id: true } });
  if (owner?.id !== identity.id) return fail("IDENTITY_CONFLICT");
  return identity.id;
}
async function evidence(tx: Prisma.TransactionClient, i: OpenCreditConsumerAuthorizationGrantInput) {
  const e = await tx.conversationInboundEvent.findUnique({ where: { id: i.inboundEventId }, select: {
    id: true, companyId: true, contactId: true, channelId: true, conversationId: true, messageId: true,
    provenanceKind: true, provenanceVersion: true,
    message: { select: { id: true, conversationId: true, direction: true, type: true, body: true, providerMessageId: true } },
    conversation: { select: { id: true, contactId: true, channelId: true, contact: { select: { companyId: true } } } },
    channel: { select: { id: true, companyId: true } }
  } });
  if (!e) return fail("EVIDENCE_NOT_FOUND");
  if (e.companyId !== i.companyId || e.contactId !== i.contactId) return fail("EVIDENCE_SCOPE_MISMATCH");
  if (e.provenanceKind !== "META_WEBHOOK_HMAC_SHA256_VERIFIED" || e.provenanceVersion !== 1 || !e.channelId) return fail("EVIDENCE_NOT_VERIFIED");
  const m = e.message; const c = e.conversation;
  if (!m || !c || !e.channel || m.id !== e.messageId || m.conversationId !== e.conversationId || c.id !== e.conversationId
    || c.contactId !== i.contactId || c.channelId !== e.channelId || c.contact.companyId !== i.companyId
    || e.channel.id !== e.channelId || e.channel.companyId !== i.companyId) return fail("EVIDENCE_SCOPE_MISMATCH");
  if (m.direction !== "inbound" || m.type !== "text" || typeof m.body !== "string" || !m.body.trim()
    || typeof m.providerMessageId !== "string" || !m.providerMessageId.trim()) return fail("EVIDENCE_UNSUPPORTED");
  // Only nonblank text is checked. Meaning is exclusively the human attestation.
}
const select = { id: true, companyId: true, contactId: true, providerScope: true, remoteIdentityId: true, purpose: true, active: true, revision: true, evidenceInboundEventId: true } as const;
type Authorization = Prisma.OpenCreditConsumerAuthorizationGetPayload<{ select: typeof select }>;
function key(i: OpenCreditConsumerAuthorizationInput) {
  return { companyId_providerScope_contactId_purpose: { companyId: i.companyId, providerScope: i.providerScope, contactId: i.contactId, purpose: PURPOSE } };
}
function facts(a: Authorization, i: OpenCreditConsumerAuthorizationInput) {
  if (a.companyId !== i.companyId || a.contactId !== i.contactId || a.providerScope !== i.providerScope || a.purpose !== PURPOSE
    || typeof a.active !== "boolean" || !Number.isSafeInteger(a.revision) || a.revision < 0 || a.revision > 2147483647) return fail("STORAGE_ERROR");
}
async function transition(tx: Prisma.TransactionClient, i: OpenCreditConsumerAuthorizationInput, a: Authorization,
  actorId: string, active: boolean, evidenceId: string): Promise<OpenCreditConsumerAuthorizationResult> {
  if (a.revision >= 2147483647) return fail("CONCURRENT_CONFLICT");
  const revision = a.revision + 1;
  const result = await tx.openCreditConsumerAuthorization.updateMany({ where: {
    id: a.id, companyId: i.companyId, providerScope: i.providerScope, active: a.active, revision: a.revision
  }, data: { active, revision, evidenceInboundEventId: evidenceId, changedByUserId: actorId } });
  if (result.count !== 1) return fail(result.count === 0 ? "CONCURRENT_CONFLICT" : "STORAGE_ERROR");
  await tx.openCreditConsumerAuthorizationEvent.create({ data: { authorizationId: a.id, companyId: i.companyId,
    providerScope: i.providerScope, actorUserId: actorId, action: active ? "GRANTED" : "REVOKED",
    previousActive: a.active, nextActive: active, revision, evidenceInboundEventId: evidenceId }, select: { id: true } });
  return { changed: true, authorizationId: a.id, active, revision };
}
/** A human administrator attests review; inbound ingestion never calls this service. */
export async function grantOpenCreditConsumerAuthorizationFromInboundEvidence(db: Db, supplied: OpenCreditConsumerAuthorizationGrantInput): Promise<OpenCreditConsumerAuthorizationResult> {
  const i = input(supplied, true);
  return transaction(db, i, async (tx, actorId, creating) => {
    const identityId = await freshIdentity(tx, i);
    await evidence(tx, i);
    const a = await tx.openCreditConsumerAuthorization.findUnique({ where: key(i), select });
    if (a) {
      facts(a, i);
      if (a.remoteIdentityId !== identityId) return fail("IDENTITY_CONFLICT");
      if (a.active) {
        if (a.evidenceInboundEventId !== i.inboundEventId) return fail("AUTHORIZATION_CONFLICT");
        return { changed: false, authorizationId: a.id, active: true, revision: a.revision };
      }
      return transition(tx, i, a, actorId, true, i.inboundEventId);
    }
    creating();
    const created = await tx.openCreditConsumerAuthorization.create({ data: { companyId: i.companyId, contactId: i.contactId,
      providerScope: i.providerScope, remoteIdentityId: identityId, purpose: PURPOSE, active: true, revision: 0,
      evidenceInboundEventId: i.inboundEventId, changedByUserId: actorId }, select: { id: true } });
    await tx.openCreditConsumerAuthorizationEvent.create({ data: { authorizationId: created.id, companyId: i.companyId,
      providerScope: i.providerScope, actorUserId: actorId, action: "GRANTED", previousActive: null, nextActive: true,
      revision: 0, evidenceInboundEventId: i.inboundEventId }, select: { id: true } });
    return { changed: true, authorizationId: created.id, active: true, revision: 0 };
  });
}
/** Revocation deliberately does not reread Contact, identity, access or evidence. */
export async function revokeOpenCreditConsumerAuthorization(db: Db, supplied: OpenCreditConsumerAuthorizationInput): Promise<OpenCreditConsumerAuthorizationResult> {
  const i = input(supplied, false);
  return transaction(db, i, async (tx, actorId) => {
    const a = await tx.openCreditConsumerAuthorization.findUnique({ where: key(i), select });
    if (!a) return { changed: false, authorizationId: null, active: false, revision: null };
    facts(a, i);
    if (!a.active) return { changed: false, authorizationId: a.id, active: false, revision: a.revision };
    return transition(tx, i, a, actorId, false, a.evidenceInboundEventId);
  });
}
