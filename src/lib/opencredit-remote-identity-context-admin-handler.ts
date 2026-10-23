import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { SessionUser } from "./auth";
import type { RateLimitRule } from "./rate-limit";
import { sameOrigin } from "./opencredit-admin-request";
import { parseOpenCreditStrictJson } from "./opencredit-strict-json";
import { resolveConfiguredOpenCreditProviderScope } from "./opencredit-provider-scope-resolver";
import { getOpenCreditRemoteIdentityContext } from "./opencredit-remote-identity-context.service";

type Dependencies = {
  getSession(request: NextRequest): Promise<SessionUser | null>;
  requirePlatformAdmin(session: SessionUser): Response | null;
  enforceLimits(rules: readonly RateLimitRule[]): Promise<Response | null>;
  db: Parameters<typeof getOpenCreditRemoteIdentityContext>[0];
  resolveScope?: typeof resolveConfiguredOpenCreditProviderScope;
  read?: typeof getOpenCreditRemoteIdentityContext;
};
const STATUS = { NOT_AUTHORIZED: 403, COMPANY_NOT_FOUND: 409, CONTACT_NOT_FOUND: 409, STORAGE_ERROR: 503 } as const;
type Code = keyof typeof STATUS;
/** Closed module-stable contract, without reading arbitrary messages/getters/causes. */
function serviceCode(error: unknown): Code | null {
  try {
    if (!(error instanceof Error)) return null;
    const name = Object.getOwnPropertyDescriptor(error, "name");
    const code = Object.getOwnPropertyDescriptor(error, "code");
    const message = Object.getOwnPropertyDescriptor(error, "message");
    if (!name || !("value" in name) || name.value !== "OpenCreditRemoteIdentityContextError"
      || !code || !("value" in code) || typeof code.value !== "string"
      || !Object.hasOwn(STATUS, code.value) || !message || !("value" in message)
      || message.value !== "OPENCREDIT_REMOTE_IDENTITY_CONTEXT_" + code.value) return null;
    return code.value as Code;
  } catch { return null; }
}
const validId = (value: unknown): value is string => typeof value === "string"
  && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(value);
const reply = (body: object, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});

/** 512 actual bytes, one total one-second deadline, fatal UTF-8 and strict JSON. */
async function readTarget(request: NextRequest): Promise<{ companyId: string; contactId: string } | null> {
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
      const chunk = await Promise.race([reader.read(), deadline]);
      if (expired || performance.now() - started >= 1000) return null;
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 512) return null;
      if (chunk.value.byteLength) chunks.push(chunk.value);
    }
    finished = true;
    const parsed = parseOpenCreditStrictJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || Object.keys(parsed).length !== 2 || !Object.hasOwn(parsed, "companyId") || !Object.hasOwn(parsed, "contactId")
      || !validId(parsed.companyId) || !validId(parsed.contactId)) return null;
    return { companyId: parsed.companyId, contactId: parsed.contactId };
  } catch { return null; }
  finally {
    if (timer !== undefined) clearTimeout(timer);
    if (!finished) cancel();
    try { reader?.releaseLock(); } catch { /* A cancelled read may still settle. */ }
  }
}

/** Read-only administrative context; only the shared rate limiter may write infrastructure. */
export function createOpenCreditRemoteIdentityContextHandler(deps: Dependencies) {
  return async (request: NextRequest): Promise<Response> => {
    try {
      const session = await deps.getSession(request);
      if (!session) return reply({ error: "UNAUTHENTICATED" }, 401);
      if (deps.requirePlatformAdmin(session)) return reply({ error: "FORBIDDEN" }, 403);
      if (!sameOrigin(request)) return reply({ error: "INVALID_ORIGIN" }, 403);
      if (request.nextUrl.search || request.url.includes("?") || request.headers.has("authorization")
        || !/^application\/json(?:;\s*charset=utf-8)?(?![\s\S])/i.test(request.headers.get("content-type") ?? "")) return reply({ error: "INVALID_REQUEST" }, 400);
      const target = await readTarget(request);
      if (target === null) return reply({ error: "INVALID_REQUEST" }, 400);
      let limited: Response | null;
      try {
        // Context reads have separate bounded budgets; do not consume mutation budgets.
        limited = await deps.enforceLimits([
          { category: "opencredit-remote-identity-context-actor", identifiers: [session.companyId, session.id], limit: 60, windowMs: 60_000 },
          { category: "opencredit-remote-identity-context-target", identifiers: [target.companyId, target.contactId], limit: 30, windowMs: 60_000 },
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
      const input = { actor: session, ...target, providerScope };
      const result = await (deps.read ?? getOpenCreditRemoteIdentityContext)(deps.db, input);
      const exists = Object.getOwnPropertyDescriptor(result, "exists");
      const enabled = Object.getOwnPropertyDescriptor(result, "enabled");
      if (!exists || !("value" in exists) || typeof exists.value !== "boolean"
        || !enabled || !("value" in enabled) || typeof enabled.value !== "boolean"
        || !exists.value && enabled.value) throw Error("INVALID_RESULT");
      return reply({ ok: true, exists: exists.value, enabled: enabled.value });
    } catch (error) {
      const code = serviceCode(error);
      return code === null ? reply({ error: "OPENCREDIT_REMOTE_IDENTITY_CONTEXT_UNAVAILABLE" }, 503)
        : reply({ error: "OPENCREDIT_REMOTE_IDENTITY_CONTEXT_" + code }, STATUS[code]);
    }
  };
}
