import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import { isPlatformAdmin } from "./permissions";
import { parseOpenCreditProviderScope, type OpenCreditProviderScope } from "./opencredit-commercial-identity-policy";

type Code = "NOT_AUTHORIZED" | "COMPANY_NOT_FOUND" | "CONTACT_NOT_FOUND" | "CONVERSATION_NOT_FOUND" | "STORAGE_ERROR";
export class OpenCreditConsumerAuthorizationContextError extends Error {
  constructor(readonly code: Code) { super("OPENCREDIT_CONSUMER_AUTHORIZATION_CONTEXT_" + code); this.name = "OpenCreditConsumerAuthorizationContextError"; }
}
type Input = Readonly<{ actor: SessionUser; companyId: string; contactId: string; conversationId: string; providerScope: OpenCreditProviderScope }>;
type Db = Pick<PrismaClient, "$transaction">;
const validId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(v);
const fail = (code: Code): never => { throw new OpenCreditConsumerAuthorizationContextError(code); };
function closed(v: unknown, keys: string[], code: Code): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v) || ![null, Object.prototype].includes(Object.getPrototypeOf(v))) return fail(code);
  if (Reflect.ownKeys(v).length !== keys.length || Reflect.ownKeys(v).some(k => typeof k !== "string" || !keys.includes(k))) return fail(code);
  const r: Record<string, unknown> = {};
  for (const k of keys) { const d = Object.getOwnPropertyDescriptor(v, k); if (!d || !("value" in d) || !d.enumerable) return fail(code); r[k] = d.value; }
  return r;
}
const currentSelect = {
  id: true, companyId: true, contactId: true, conversationId: true, messageId: true,
  conversation: { select: { id: true, contactId: true, contact: { select: { companyId: true } } } },
  message: { select: { id: true, conversationId: true } },
} as const;
const candidateSelect = {
  ...currentSelect, channelId: true, provenanceKind: true, provenanceVersion: true,
  message: { select: { id: true, conversationId: true, direction: true, type: true, body: true, providerMessageId: true } },
  conversation: { select: { id: true, contactId: true, channelId: true, contact: { select: { companyId: true } } } },
  channel: { select: { id: true, companyId: true } },
} as const;
type Evidence = Prisma.ConversationInboundEventGetPayload<{ select: typeof currentSelect }>;
function bound(e: Evidence, i: Input) {
  return validId(e.id) && validId(e.messageId) && validId(e.conversationId) && e.companyId === i.companyId && e.contactId === i.contactId
    && e.conversation?.id === e.conversationId && e.conversation.contactId === i.contactId && e.conversation.contact?.companyId === i.companyId
    && e.message?.id === e.messageId && e.message.conversationId === e.conversationId;
}
export async function getOpenCreditConsumerAuthorizationContext(db: Db, value: Input) {
  try {
    const r = closed(value, ["actor", "companyId", "contactId", "conversationId", "providerScope"], "STORAGE_ERROR");
    if (![r.companyId, r.contactId, r.conversationId].every(validId)) return fail("STORAGE_ERROR");
    parseOpenCreditProviderScope(r.providerScope);
    const a = closed(r.actor, ["id", "companyId", "role", "email", "name"], "NOT_AUTHORIZED");
    if (!validId(a.id) || !validId(a.companyId) || a.role !== "ADMIN" || typeof a.email !== "string" || !a.email.trim()
      || typeof a.name !== "string" || !isPlatformAdmin(a as SessionUser)) return fail("NOT_AUTHORIZED");
    const input: Input = { actor: a as SessionUser, companyId: r.companyId as string, contactId: r.contactId as string,
      conversationId: r.conversationId as string, providerScope: r.providerScope as OpenCreditProviderScope };
    return await db.$transaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: input.actor.id }, select: { id: true, companyId: true, role: true, email: true, name: true } });
      if (!actor || actor.id !== input.actor.id || actor.companyId !== input.actor.companyId || actor.role !== "ADMIN"
        || actor.email.trim().toLowerCase() !== input.actor.email.trim().toLowerCase() || !isPlatformAdmin({ ...actor, role: "ADMIN" })) return fail("NOT_AUTHORIZED");
      if (!await tx.company.findUnique({ where: { id: input.companyId }, select: { id: true } })) return fail("COMPANY_NOT_FOUND");
      const contact = await tx.contact.findUnique({ where: { companyId_id: { companyId: input.companyId, id: input.contactId } }, select: { id: true, companyId: true } });
      if (!contact || contact.id !== input.contactId || contact.companyId !== input.companyId) return fail("CONTACT_NOT_FOUND");
      const conversation = await tx.conversation.findUnique({ where: { id: input.conversationId }, select: { id: true, contactId: true, contact: { select: { companyId: true } } } });
      if (!conversation || conversation.id !== input.conversationId || conversation.contactId !== input.contactId
        || conversation.contact.companyId !== input.companyId) return fail("CONVERSATION_NOT_FOUND");
      const auth = await tx.openCreditConsumerAuthorization.findUnique({ where: { companyId_providerScope_contactId_purpose: {
        companyId: input.companyId, providerScope: input.providerScope, contactId: input.contactId, purpose: "CLIENT_PROFILE_UPSERT",
      } }, select: { id: true, companyId: true, contactId: true, providerScope: true, purpose: true, active: true, revision: true, evidenceInboundEventId: true } });
      let authorization: { exists: boolean; active: boolean; revision: number | null; evidenceInboundEventId: string | null; evidenceMessageId: string | null }
        = { exists: false, active: false, revision: null, evidenceInboundEventId: null, evidenceMessageId: null };
      if (auth) {
        if (!validId(auth.id) || auth.companyId !== input.companyId || auth.contactId !== input.contactId || auth.providerScope !== input.providerScope
          || auth.purpose !== "CLIENT_PROFILE_UPSERT" || typeof auth.active !== "boolean" || !Number.isSafeInteger(auth.revision) || auth.revision < 0 || !validId(auth.evidenceInboundEventId)) return fail("STORAGE_ERROR");
        // Resolve current evidence separately, even if it is older than the UI window.
        const evidence = await tx.conversationInboundEvent.findUnique({ where: { id: auth.evidenceInboundEventId }, select: currentSelect });
        if (!evidence || evidence.id !== auth.evidenceInboundEventId || !bound(evidence, input)) return fail("STORAGE_ERROR");
        authorization = { exists: true, active: auth.active, revision: auth.revision, evidenceInboundEventId: auth.evidenceInboundEventId,
          evidenceMessageId: evidence.conversationId === input.conversationId ? evidence.messageId : null };
      }
      const recent = await tx.conversationInboundEvent.findMany({ where: { companyId: input.companyId, contactId: input.contactId, conversationId: input.conversationId },
        orderBy: { sequence: "desc" }, take: 100, select: candidateSelect });
      const evidenceCandidates: { inboundEventId: string; messageId: string }[] = [];
      const seen = new Set<string>();
      for (const e of recent.slice(0, 100)) {
        if (!bound(e, input) || e.conversationId !== input.conversationId || e.provenanceKind !== "META_WEBHOOK_HMAC_SHA256_VERIFIED" || e.provenanceVersion !== 1
          || !validId(e.channelId) || e.channel?.id !== e.channelId || e.channel.companyId !== input.companyId || e.conversation.channelId !== e.channelId
          || e.message.direction !== "inbound" || e.message.type !== "text" || typeof e.message.body !== "string" || !e.message.body.trim()
          || typeof e.message.providerMessageId !== "string" || !e.message.providerMessageId.trim() || seen.has(e.messageId)) continue;
        seen.add(e.messageId); evidenceCandidates.push({ inboundEventId: e.id, messageId: e.messageId });
        if (evidenceCandidates.length === 50) break;
      }
      return { ok: true as const, authorization, evidenceCandidates };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 5000 });
  } catch (error) {
    // Closed descriptors avoid subclass identity coupling and accessor/raw-error leakage.
    let semantic: Code = "STORAGE_ERROR";
    try { if (error instanceof Error) {
      const n = Object.getOwnPropertyDescriptor(error, "name"), c = Object.getOwnPropertyDescriptor(error, "code"), m = Object.getOwnPropertyDescriptor(error, "message");
      if (n && "value" in n && n.value === "OpenCreditConsumerAuthorizationContextError" && c && "value" in c && m && "value" in m
        && ["NOT_AUTHORIZED", "COMPANY_NOT_FOUND", "CONTACT_NOT_FOUND", "CONVERSATION_NOT_FOUND", "STORAGE_ERROR"].includes(c.value)
        && m.value === "OPENCREDIT_CONSUMER_AUTHORIZATION_CONTEXT_" + c.value) semantic = c.value as Code;
    } } catch { /* Malformed storage errors must also be sanitized. */ }
    return fail(semantic);
  }
}
