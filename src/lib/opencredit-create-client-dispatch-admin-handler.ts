import "server-only";
import { parseOpenCreditCreateClientPhonePolicy } from "./opencredit-create-client-phone-policy";
import { NextResponse, type NextRequest } from "next/server";
import type { SessionUser } from "./auth";
import type { RateLimitRule } from "./rate-limit";
import { sameOrigin } from "./opencredit-admin-request";
import { parseOpenCreditStrictJson } from "./opencredit-strict-json";
import { resolveConfiguredOpenCreditProviderScope } from "./opencredit-provider-scope-resolver";
import { prepareOpenCreditClientProfileOperation, readOpenCreditCommercialOperationServiceErrorCode,
  type OpenCreditCommercialOperationServiceCode } from "./opencredit-commercial-operation.service";
import { dispatchOpenCreditCreateClient, readOpenCreditCreateClientDispatchErrorCode } from "./opencredit-create-client-dispatcher";

type Dependencies = {
  getSession(request: NextRequest): Promise<SessionUser | null>;
  requirePlatformAdmin(session: SessionUser): Response | null;
  enforceLimits(rules: readonly RateLimitRule[]): Promise<Response | null>;
  db: Parameters<typeof prepareOpenCreditClientProfileOperation>[0];
  resolveScope?: typeof resolveConfiguredOpenCreditProviderScope;
  prepare?: typeof prepareOpenCreditClientProfileOperation;
  dispatch?: typeof dispatchOpenCreditCreateClient;
};
const STATUS: Readonly<Record<OpenCreditCommercialOperationServiceCode, number>> = {
  NOT_AUTHORIZED: 403, INVALID_COMPANY: 400, INVALID_CONTACT: 400, INVALID_OPERATION: 400,
  INVALID_PROVIDER_SCOPE: 400, INVALID_INTENT_KEY: 400, INVALID_REVISION: 400,
  COMPANY_NOT_FOUND: 409, CONTACT_NOT_FOUND: 409, CONTACT_ARCHIVED: 409, CONTACT_CPF_MISSING: 409,
  CONTACT_CPF_INVALID: 409, CONTACT_AMBIGUOUS: 409, COMMERCIAL_ACCESS_MISSING: 409,
  COMMERCIAL_ACCESS_DISABLED: 409, IDENTITY_NOT_FOUND: 409, IDENTITY_DISABLED: 409,
  IDENTITY_SNAPSHOT_MISMATCH: 409, IDENTITY_CONFLICT: 409, PROFILE_INVALID: 409, INTENT_CONFLICT: 409,
  OPERATION_NOT_FOUND: 409, OPERATION_KIND_MISMATCH: 409, CONSUMER_AUTHORIZATION_MISSING: 409,
  CONSUMER_AUTHORIZATION_INACTIVE: 409, CONSUMER_AUTHORIZATION_MISMATCH: 409,
  CONSUMER_AUTHORIZATION_EVENT_INVALID: 409, OPERATION_STATE_INVALID: 409, OPERATION_STATE_CONFLICT: 409,
  OPERATION_REVISION_CONFLICT: 409, CONCURRENT_CONFLICT: 409, STORAGE_ERROR: 503, INVALID_OBSERVATION: 503,
};
const validId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(v);
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
function data(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error("INVALID_RESULT");
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw Error("INVALID_RESULT");
    result[key] = descriptor.value;
  }
  return result;
}
/** One total deadline, actual byte limit, fatal UTF-8, and the existing strict parser. */
async function readCommand(request: NextRequest) {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false, expired = false;
  const started = performance.now();
  const cancel = () => { void reader?.cancel().catch(() => {}); };
  try {
    reader = request.body?.getReader();
    if (!reader) return null;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { expired = true; cancel(); reject(Error("INVALID_REQUEST")); }, 1000);
    });
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) {
      if (expired || performance.now() - started >= 1000) return null;
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (expired || performance.now() - started >= 1000) return null;
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2048) return null;
      if (value.byteLength) chunks.push(value);
    }
    finished = true;
    const parsed = parseOpenCreditStrictJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)));
    const hasPolicy = !!parsed && typeof parsed === "object" && Object.hasOwn(parsed, "phonePolicy");
    const keys = ["companyId", "contactId", "commandId", ...(hasPolicy ? ["phonePolicy"] : [])];
    const result = data(parsed, keys);
    const phonePolicy = hasPolicy ? parseOpenCreditCreateClientPhonePolicy(result.phonePolicy) : "include";
    if (Reflect.ownKeys(parsed as object).length !== keys.length || !validId(result.companyId) || !validId(result.contactId)
      || typeof result.commandId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/.test(result.commandId)) return null;
    return { companyId: result.companyId, contactId: result.contactId, commandId: result.commandId, phonePolicy };
  } catch { return null; }
  finally {
    if (timer !== undefined) clearTimeout(timer);
    if (!finished) cancel();
    try { reader?.releaseLock(); } catch { /* Cancelled reads may still settle. */ }
  }
}
function snapshot(value: unknown) {
  const result = data(value, ["operationId", "state", "revision"]);
  if (!validId(result.operationId) || typeof result.state !== "string"
    || typeof result.revision !== "number" || !Number.isSafeInteger(result.revision)
    || result.revision < 0 || result.revision > 2147483647) throw Error("INVALID_RESULT");
  return { operationId: result.operationId, state: result.state, revision: result.revision };
}

export function createOpenCreditCreateClientDispatchAdminHandler(deps: Dependencies) {
  return async (request: NextRequest): Promise<Response> => {
    try {
      const session = await deps.getSession(request);
      if (!session) return reply({ error: "UNAUTHENTICATED" }, 401);
      if (deps.requirePlatformAdmin(session)) return reply({ error: "FORBIDDEN" }, 403);
      if (!sameOrigin(request)) return reply({ error: "INVALID_ORIGIN" }, 403);
      if (request.nextUrl.search || request.url.includes("?") || request.headers.has("authorization")
        || !/^application\/json(?:;\s*charset=utf-8)?(?![\s\S])/i.test(request.headers.get("content-type") ?? "")) return reply({ error: "INVALID_REQUEST" }, 400);
      const command = await readCommand(request);
      if (!command) return reply({ error: "INVALID_REQUEST" }, 400);
      let limited: Response | null;
      try {
        limited = await deps.enforceLimits([
          { category: "opencredit-create-client-dispatch-actor", identifiers: [session.companyId, session.id], limit: 10, windowMs: 60_000 },
          { category: "opencredit-create-client-dispatch-target", identifiers: [command.companyId, command.contactId], limit: 3, windowMs: 60_000 },
          { category: "opencredit-create-client-dispatch-command", identifiers: [command.companyId, command.commandId], limit: 3, windowMs: 60_000 },
        ]);
      } catch { return reply({ error: "RATE_LIMIT_UNAVAILABLE" }, 503); }
      if (limited) {
        const response = reply({ error: limited.status === 429 ? "RATE_LIMITED" : "RATE_LIMIT_UNAVAILABLE" }, limited.status === 429 ? 429 : 503);
        const retry = limited.headers.get("retry-after");
        if (retry && /^(?:0|[1-9][0-9]*)(?![\s\S])/.test(retry) && Number.isSafeInteger(Number(retry))) response.headers.set("Retry-After", retry);
        return response;
      }
      let providerScope: ReturnType<typeof resolveConfiguredOpenCreditProviderScope>;
      try { providerScope = (deps.resolveScope ?? resolveConfiguredOpenCreditProviderScope)(); }
      catch { return reply({ error: "OPENCREDIT_PROVIDER_SCOPE_CONFIGURATION" }, 503); }
      const prepared = snapshot(await (deps.prepare ?? prepareOpenCreditClientProfileOperation)(deps.db, {
        actor: session, companyId: command.companyId, contactId: command.contactId, providerScope, intentKey: command.commandId,
      }, command.phonePolicy));
      if (["IN_FLIGHT", "SUCCEEDED", "UNKNOWN"].includes(prepared.state)) return reply({ ok: true, ...prepared, dispatched: false });
      if (prepared.state !== "PREPARED") return reply({ error: "OPENCREDIT_COMMERCIAL_OPERATION_OPERATION_STATE_INVALID" }, 409);
      const result = snapshot(await (deps.dispatch ?? dispatchOpenCreditCreateClient)(deps.db, {
        actor: session, companyId: command.companyId, operationId: prepared.operationId, expectedRevision: prepared.revision,
      }, { phonePolicy: command.phonePolicy }));
      if (result.operationId !== prepared.operationId || !["SUCCEEDED", "UNKNOWN"].includes(result.state)) throw Error("INVALID_RESULT");
      return reply({ ok: true, ...result, dispatched: true });
    } catch (error) {
      const domain = readOpenCreditCommercialOperationServiceErrorCode(error);
      if (domain) return reply({ error: "OPENCREDIT_COMMERCIAL_OPERATION_" + domain }, STATUS[domain]);
      const dispatch = readOpenCreditCreateClientDispatchErrorCode(error);
      if (dispatch) return reply({ error: "OPENCREDIT_CREATE_CLIENT_DISPATCH_" + dispatch }, dispatch === "INVALID_INPUT" ? 400 : 503);
      return reply({ error: "OPENCREDIT_CREATE_CLIENT_DISPATCH_UNAVAILABLE" }, 503);
    }
  };
}
