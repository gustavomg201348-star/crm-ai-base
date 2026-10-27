import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import { isPlatformAdmin } from "./permissions";
import { canonicalizeOpenCreditOwnershipCpf, parseOpenCreditProviderScope } from "./opencredit-commercial-identity-policy";
import { resolveConfiguredOpenCreditProviderContext } from "./opencredit-provider-scope-resolver";
import { openCreditApiClient, readOpenCreditApiErrorCode } from "./opencredit-api-client";
import { readOpenCreditStrictJsonResponse, OpenCreditHttpJsonBoundaryError } from "./opencredit-http-json-boundary";
import { safeDiagnosticId } from "./opencredit-create-client-diagnostic";
import { parseProviderClientValidation, clientValidationCategory, validationObject, type ClientValidationResponse, type ValidationDiagnostic } from "./opencredit-client-validation";

type Db = Pick<PrismaClient, "$transaction">;
type Input = { actor: SessionUser; companyId: string; contactId: string };
type Options = { client?: Pick<typeof openCreditApiClient, "getOnce">; resolve?: typeof resolveConfiguredOpenCreditProviderContext };
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(v);
const codes = ["NOT_AUTHORIZED", "TARGET_NOT_READY", "STORAGE_UNAVAILABLE"] as const;
export class ClientValidationGateError extends Error {
  constructor(readonly code: typeof codes[number]) { super("OPENCREDIT_CLIENT_VALIDATION_" + code); this.name = "ClientValidationGateError"; }
}
export function readClientValidationGateError(error: unknown): typeof codes[number] | null {
  try {
    if (!(error instanceof Error)) return null;
    const c = Object.getOwnPropertyDescriptor(error, "code"), m = Object.getOwnPropertyDescriptor(error, "message");
    const code = c && "value" in c && codes.find(v => v === c.value);
    return code && m && "value" in m && m.value === "OPENCREDIT_CLIENT_VALIDATION_" + code ? code : null;
  } catch { return null; }
}
const deny = (): never => { throw new ClientValidationGateError("TARGET_NOT_READY"); };
async function readTarget(db: Db, i: Input, providerScope: string) {
  try {
    if (typeof window !== "undefined" || !id(i.companyId) || !id(i.contactId) || !id(i.actor?.id) || !isPlatformAdmin(i.actor)) throw new ClientValidationGateError("NOT_AUTHORIZED");
    return await db.$transaction(async tx => {
      const a = await tx.user.findUnique({ where: { id: i.actor.id }, select: { id: true, companyId: true, role: true, email: true, name: true } });
      if (!a || a.id !== i.actor.id || a.companyId !== i.actor.companyId || a.role !== "ADMIN"
        || a.email.toLowerCase() !== i.actor.email.toLowerCase() || !isPlatformAdmin({ ...a, role: "ADMIN" })) throw new ClientValidationGateError("NOT_AUTHORIZED");
      if (!await tx.company.findUnique({ where: { id: i.companyId }, select: { id: true } })) return deny();
      const c = await tx.contact.findUnique({ where: { companyId_id: { companyId: i.companyId, id: i.contactId } },
        select: { id: true, companyId: true, cpf: true, archivedAt: true } });
      if (!c || c.id !== i.contactId || c.companyId !== i.companyId || c.archivedAt !== null) return deny();
      let cpf: string;
      try { cpf = canonicalizeOpenCreditOwnershipCpf(c.cpf); } catch { return deny(); }
      const formatted = cpf.slice(0, 3) + "." + cpf.slice(3, 6) + "." + cpf.slice(6, 9) + "-" + cpf.slice(9);
      const matches = await tx.contact.findMany({ where: { companyId: i.companyId, cpf: { in: [cpf, formatted] } }, take: 2, select: { id: true } });
      if (matches.length !== 1 || matches[0].id !== c.id) return deny(); // Includes archived Contacts.
      const access = await tx.openCreditCommercialAccess.findUnique({ where: { companyId_providerScope: { companyId: i.companyId, providerScope } }, select: { enabled: true } });
      if (access?.enabled !== true) return deny();
      const identity = await tx.openCreditRemoteIdentity.findUnique({ where: { companyId_providerScope_contactId: { companyId: i.companyId, providerScope, contactId: i.contactId } },
        select: { id: true, companyId: true, providerScope: true, contactId: true, normalizedCpf: true, enabled: true } });
      if (!identity || !id(identity.id) || identity.companyId !== i.companyId || identity.providerScope !== providerScope || identity.contactId !== i.contactId
        || identity.normalizedCpf !== cpf || identity.enabled !== true) return deny();
      const owner = await tx.openCreditRemoteIdentity.findUnique({ where: { providerScope_normalizedCpf: { providerScope, normalizedCpf: cpf } }, select: { id: true } });
      if (owner?.id !== identity.id) return deny();
      const auth = await tx.openCreditConsumerAuthorization.findUnique({ where: { companyId_providerScope_contactId_purpose: {
        companyId: i.companyId, providerScope, contactId: i.contactId, purpose: "CLIENT_PROFILE_UPSERT",
      } }, select: { id: true, companyId: true, providerScope: true, contactId: true, purpose: true, remoteIdentityId: true, active: true, revision: true, evidenceInboundEventId: true } });
      if (!auth || !id(auth.id) || !id(auth.evidenceInboundEventId) || auth.companyId !== i.companyId || auth.providerScope !== providerScope || auth.contactId !== i.contactId
        || auth.purpose !== "CLIENT_PROFILE_UPSERT" || auth.remoteIdentityId !== identity.id || auth.active !== true || !Number.isSafeInteger(auth.revision) || auth.revision < 0) return deny();
      const grant = await tx.openCreditConsumerAuthorizationEvent.findUnique({ where: { authorizationId_revision: { authorizationId: auth.id, revision: auth.revision } },
        select: { authorizationId: true, companyId: true, providerScope: true, revision: true, action: true, nextActive: true, evidenceInboundEventId: true } });
      if (!grant || grant.authorizationId !== auth.id || grant.companyId !== i.companyId || grant.providerScope !== providerScope || grant.revision !== auth.revision
        || grant.action !== "GRANTED" || grant.nextActive !== true || grant.evidenceInboundEventId !== auth.evidenceInboundEventId) return deny();
      const evidence = await tx.conversationInboundEvent.findUnique({ where: { id: auth.evidenceInboundEventId },
        select: { id: true, companyId: true, contactId: true, provenanceKind: true, provenanceVersion: true } });
      if (!evidence || evidence.id !== auth.evidenceInboundEventId || evidence.companyId !== i.companyId || evidence.contactId !== i.contactId
        || evidence.provenanceKind !== "META_WEBHOOK_HMAC_SHA256_VERIFIED" || evidence.provenanceVersion !== 1) return deny();
      return { cpf, identityId: identity.id, authorizationId: auth.id, revision: auth.revision };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 5000 });
  } catch (error) { throw new ClientValidationGateError(readClientValidationGateError(error) ?? "STORAGE_UNAVAILABLE"); }
}
export async function readOpenCreditClientValidation(db: Db, input: Input, options: Options = {}): Promise<ClientValidationResponse> {
  const diagnostic: ValidationDiagnostic = { httpStatus: null, requestId: null, correlationId: null, responseReadable: false, responseParsed: false,
    found: null, valid: null, pendingPresent: null, category: "CONFIGURATION" };
  const failure = (): ClientValidationResponse => ({ ok: false, error: "OPENCREDIT_CLIENT_VALIDATION_FAILED", diagnostic });
  let config: ReturnType<typeof resolveConfiguredOpenCreditProviderContext>;
  try {
    config = (options.resolve ?? resolveConfiguredOpenCreditProviderContext)();
    if (typeof config.tenantId !== "string" || config.tenantId.length > 128 || !/^[A-Za-z0-9_-]+(?![\s\S])/.test(config.tenantId)) return failure();
    parseOpenCreditProviderScope(config.providerScope);
  } catch { return failure(); }
  const target = await readTarget(db, input, config.providerScope);
  try {
    const path = `/api/tenants/${config.tenantId}/integration/clients/validate?${new URLSearchParams({ cpf: target.cpf, stage: "simulate", product: "clt" })}`;
    const result = await (options.client ?? openCreditApiClient).getOnce(path);
    const response = result.response;
    if (!(response instanceof Response) || response.status < 100 || response.status > 599) throw Error();
    diagnostic.httpStatus = response.status;
    const safe = (value: unknown) => {
      const id = safeDiagnosticId(result.sanitizeDiagnosticIdentifier(value));
      return id && !id.includes(target.cpf) ? id : null;
    };
    diagnostic.requestId = safe(response.headers.get("x-request-id"));
    diagnostic.correlationId = safe(response.headers.get("x-correlation-id"));
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      diagnostic.category = [401, 403].includes(response.status) ? "AUTHENTICATION" : response.status === 429 || response.status >= 500 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_FAILED";
      return failure();
    }
    diagnostic.category = "INVALID_RESPONSE";
    const payload = await readOpenCreditStrictJsonResponse(response);
    diagnostic.responseReadable = true; diagnostic.responseParsed = true;
    diagnostic.pendingPresent = Object.hasOwn(validationObject(validationObject(payload).data), "pending");
    const validation = parseProviderClientValidation(payload);
    diagnostic.requestId ??= safe(validationObject(payload).requestId);
    // Do not return a previous CPF's snapshot if access/identity/auth changed during the GET.
    const currentConfig = (options.resolve ?? resolveConfiguredOpenCreditProviderContext)();
    if (currentConfig.tenantId !== config.tenantId || currentConfig.providerScope !== config.providerScope) return deny();
    const current = await readTarget(db, input, config.providerScope);
    if (current.cpf !== target.cpf || current.identityId !== target.identityId || current.authorizationId !== target.authorizationId || current.revision !== target.revision) return deny();
    diagnostic.found = validation.found ?? null; diagnostic.valid = validation.valid ?? null;
    diagnostic.pendingPresent = Object.hasOwn(validation, "pending");
    diagnostic.category = clientValidationCategory(validation);
    return { ok: true, validation, diagnostic };
  } catch (error) {
    const gate = readClientValidationGateError(error); if (gate) throw new ClientValidationGateError(gate);
    const api = readOpenCreditApiErrorCode(error);
    diagnostic.category = api === "TIMEOUT" || error instanceof OpenCreditHttpJsonBoundaryError && error.code === "TIMEOUT" ? "TIMEOUT"
      : api === "NETWORK" ? "NETWORK" : api === "CONFIGURATION" ? "CONFIGURATION" : api === "AUTH_FAILED" ? "AUTHENTICATION" : "INVALID_RESPONSE";
    if (error instanceof OpenCreditHttpJsonBoundaryError && error.code === "INVALID_JSON") diagnostic.responseReadable = true;
    return failure();
  }
}
