import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { SessionUser } from "./auth";
import type { RateLimitRule } from "./rate-limit";
import { sameOrigin } from "./opencredit-admin-request";
import { parseOpenCreditStrictJson } from "./opencredit-strict-json";
import { resolveConfiguredOpenCreditProviderScope } from "./opencredit-provider-scope-resolver";
import { getOpenCreditCreateClientReconciliationContext, readOpenCreditCreateClientReconciliationContextErrorCode } from "./opencredit-create-client-reconciliation-context.service";
import { parseOpenCreditCreateClientReconciliationContext } from "./opencredit-create-client-reconciliation-ui";
type Dependencies = {
  getSession(request: NextRequest): Promise<SessionUser | null>;
  requirePlatformAdmin(session: SessionUser): Response | null;
  enforceLimits(rules: readonly RateLimitRule[]): Promise<Response | null>;
  db: Parameters<typeof getOpenCreditCreateClientReconciliationContext>[0];
  resolveScope?: typeof resolveConfiguredOpenCreditProviderScope;
  read?: typeof getOpenCreditCreateClientReconciliationContext;
};
const STATUS = { NOT_AUTHORIZED: 403, INVALID_COMPANY: 400, INVALID_CONTACT: 400, INVALID_PROVIDER_SCOPE: 400,
  COMPANY_NOT_FOUND: 404, CONTACT_NOT_FOUND: 404, CORRUPT_LEDGER: 503, STORAGE_ERROR: 503 } as const;
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(v);
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function command(request: NextRequest) {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false, expired = false;
  const start = performance.now(), cancel = () => { void reader?.cancel().catch(() => {}); };
  try {
    reader = request.body?.getReader(); if (!reader) return null;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; cancel(); reject(Error("INVALID_REQUEST")); }, 1000); });
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) {
      if (expired || performance.now() - start >= 1000) return null;
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (expired || performance.now() - start >= 1000) return null;
      if (done) break;
      bytes += value.byteLength; if (bytes > 2048) return null;
      if (value.byteLength) chunks.push(value);
    }
    finished = true;
    const parsed = parseOpenCreditStrictJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || ![Object.prototype, null].includes(Object.getPrototypeOf(parsed))) return null;
    const own = Reflect.ownKeys(parsed); if (own.length !== 2 || own.some(k => k !== "companyId" && k !== "contactId")) return null;
    const company = Object.getOwnPropertyDescriptor(parsed, "companyId"), contact = Object.getOwnPropertyDescriptor(parsed, "contactId");
    if (!company || !("value" in company) || !contact || !("value" in contact) || !id(company.value) || !id(contact.value)) return null;
    return { companyId: company.value, contactId: contact.value };
  } catch { return null; }
  finally { if (timer !== undefined) clearTimeout(timer); if (!finished) cancel(); try { reader?.releaseLock(); } catch { /* Pending cancellation. */ } }
}
export function createOpenCreditCreateClientReconciliationContextHandler(deps: Dependencies) {
  return async (request: NextRequest): Promise<Response> => {
    try {
      const session = await deps.getSession(request); if (!session) return reply({ error: "UNAUTHENTICATED" }, 401);
      if (deps.requirePlatformAdmin(session)) return reply({ error: "FORBIDDEN" }, 403);
      if (!sameOrigin(request)) return reply({ error: "INVALID_ORIGIN" }, 403);
      if (request.nextUrl.search || request.url.includes("?") || request.headers.has("authorization")
        || !/^application\/json(?:;\s*charset=utf-8)?(?![\s\S])/i.test(request.headers.get("content-type") ?? "")) return reply({ error: "INVALID_REQUEST" }, 400);
      const input = await command(request); if (!input) return reply({ error: "INVALID_REQUEST" }, 400);
      let limited: Response | null;
      try { limited = await deps.enforceLimits([
        { category: "opencredit-create-client-reconciliation-context-actor", identifiers: [session.companyId, session.id], limit: 60, windowMs: 60000 },
        { category: "opencredit-create-client-reconciliation-context-target", identifiers: [input.companyId, input.contactId], limit: 30, windowMs: 60000 },
      ]); } catch { return reply({ error: "RATE_LIMIT_UNAVAILABLE" }, 503); }
      if (limited) {
        const response = reply({ error: limited.status === 429 ? "RATE_LIMITED" : "RATE_LIMIT_UNAVAILABLE" }, limited.status === 429 ? 429 : 503);
        const retry = limited.headers.get("retry-after");
        if (retry && /^(?:0|[1-9][0-9]*)(?![\s\S])/.test(retry) && Number.isSafeInteger(Number(retry))) response.headers.set("Retry-After", retry);
        return response;
      }
      let providerScope: ReturnType<typeof resolveConfiguredOpenCreditProviderScope>;
      try { providerScope = (deps.resolveScope ?? resolveConfiguredOpenCreditProviderScope)(); }
      catch { return reply({ error: "OPENCREDIT_PROVIDER_SCOPE_CONFIGURATION" }, 503); }
      const result = parseOpenCreditCreateClientReconciliationContext(await (deps.read ?? getOpenCreditCreateClientReconciliationContext)(deps.db, { actor: session, ...input, providerScope }));
      if (!result) throw Error("INVALID_RESULT");
      return reply(result);
    } catch (error) {
      const code = readOpenCreditCreateClientReconciliationContextErrorCode(error);
      return code ? reply({ error: "OPENCREDIT_CREATE_CLIENT_RECONCILIATION_" + code }, STATUS[code]) : reply({ error: "OPENCREDIT_CREATE_CLIENT_RECONCILIATION_UNAVAILABLE" }, 503);
    }
  };
}
