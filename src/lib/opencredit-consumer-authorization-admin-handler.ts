import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { SessionUser } from "./auth";
import type { RateLimitRule } from "./rate-limit";
import { sameOrigin } from "./opencredit-admin-request";
import { parseOpenCreditStrictJson } from "./opencredit-strict-json";
import { resolveConfiguredOpenCreditProviderScope } from "./opencredit-provider-scope-resolver";
import {
  grantOpenCreditConsumerAuthorizationFromInboundEvidence,
  revokeOpenCreditConsumerAuthorization,
  type OpenCreditConsumerAuthorizationCode,
} from "./opencredit-consumer-authorization.service";

type Dependencies = {
  getSession(request: NextRequest): Promise<SessionUser | null>;
  requirePlatformAdmin(session: SessionUser): Response | null;
  enforceLimits(rules: readonly RateLimitRule[]): Promise<Response | null>;
  db: Parameters<typeof revokeOpenCreditConsumerAuthorization>[0];
  resolveScope?: typeof resolveConfiguredOpenCreditProviderScope;
  grant?: typeof grantOpenCreditConsumerAuthorizationFromInboundEvidence;
  revoke?: typeof revokeOpenCreditConsumerAuthorization;
};
const STATUS: Readonly<Record<OpenCreditConsumerAuthorizationCode, number>> = {
  NOT_AUTHORIZED: 403,
  INVALID_COMPANY: 400, INVALID_CONTACT: 400, INVALID_PROVIDER_SCOPE: 400, INVALID_EVIDENCE: 400,
  COMPANY_NOT_FOUND: 409, CONTACT_NOT_FOUND: 409, CONTACT_ARCHIVED: 409, CONTACT_CPF_MISSING: 409,
  CONTACT_CPF_INVALID: 409, CONTACT_AMBIGUOUS: 409, COMMERCIAL_ACCESS_MISSING: 409,
  COMMERCIAL_ACCESS_DISABLED: 409, IDENTITY_NOT_FOUND: 409, IDENTITY_DISABLED: 409,
  IDENTITY_SNAPSHOT_MISMATCH: 409, IDENTITY_CONFLICT: 409, EVIDENCE_NOT_FOUND: 409,
  EVIDENCE_SCOPE_MISMATCH: 409, EVIDENCE_NOT_VERIFIED: 409, EVIDENCE_UNSUPPORTED: 409,
  AUTHORIZATION_CONFLICT: 409, CONCURRENT_CONFLICT: 409, STORAGE_ERROR: 503,
};
/** Module-independent closed error contract; never invoke exception accessors. */
function readConsumerAuthorizationServiceCode(error: unknown): OpenCreditConsumerAuthorizationCode | null {
  try {
    if (!(error instanceof Error)) return null;
    const name = Object.getOwnPropertyDescriptor(error, "name");
    const code = Object.getOwnPropertyDescriptor(error, "code");
    const message = Object.getOwnPropertyDescriptor(error, "message");
    if (!name || !("value" in name) || !code || !("value" in code) || !message || !("value" in message)) return null;
    if (name.value !== "OpenCreditConsumerAuthorizationServiceError" || typeof code.value !== "string"
      || !Object.prototype.hasOwnProperty.call(STATUS, code.value)
      || message.value !== "OPENCREDIT_CONSUMER_AUTHORIZATION_" + code.value) return null;
    return code.value as OpenCreditConsumerAuthorizationCode;
  } catch { return null; }
}
const validId = (value: unknown): value is string => typeof value === "string"
  && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(value);
const reply = (body: object, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});

/** One deadline covers every read, including empty chunks; cancellation is never awaited. */
async function readCommand(request: NextRequest, action: "grant" | "revoke") {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  let expired = false;
  const started = performance.now();
  const cancel = () => { void reader?.cancel().catch(() => {}); };
  try {
    reader = request.body?.getReader();
    if (!reader) return null;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { expired = true; cancel(); reject(new Error("INVALID_REQUEST")); }, 1000);
    });
    const chunks: Uint8Array[] = [];
    let bytes = 0;
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
    const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
    const parsed = parseOpenCreditStrictJson(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const keys = action === "grant" ? ["companyId", "contactId", "inboundEventId"] : ["companyId", "contactId"];
    const own = Object.keys(parsed);
    if (own.length !== keys.length || own.some(key => !keys.includes(key))) return null;
    if (!validId(parsed.companyId) || !validId(parsed.contactId)
      || action === "grant" && !validId(parsed.inboundEventId)) return null;
    return { companyId: parsed.companyId, contactId: parsed.contactId,
      inboundEventId: action === "grant" ? parsed.inboundEventId as string : undefined };
  } catch { return null; }
  finally {
    if (timer !== undefined) clearTimeout(timer);
    if (!finished) cancel();
    try { reader?.releaseLock(); } catch { /* A cancelled read may still settle. */ }
  }
}

export function createOpenCreditConsumerAuthorizationAdminHandler(action: "grant" | "revoke", deps: Dependencies) {
  return async (request: NextRequest): Promise<Response> => {
    try {
      const session = await deps.getSession(request);
      if (!session) return reply({ error: "UNAUTHENTICATED" }, 401);
      if (deps.requirePlatformAdmin(session)) return reply({ error: "FORBIDDEN" }, 403);
      if (!sameOrigin(request)) return reply({ error: "INVALID_ORIGIN" }, 403);
      if (request.nextUrl.search || request.headers.has("authorization")
        || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) {
        return reply({ error: "INVALID_REQUEST" }, 400);
      }
      const command = await readCommand(request, action);
      if (!command) return reply({ error: "INVALID_REQUEST" }, 400);
      let limited: Response | null;
      try {
        limited = await deps.enforceLimits([
          { category: "opencredit-consumer-authorization-actor", identifiers: [session.companyId, session.id, action], limit: 20, windowMs: 60_000 },
          { category: "opencredit-consumer-authorization-target", identifiers: [command.companyId, command.contactId, action], limit: 10, windowMs: 60_000 },
        ]);
      } catch { return reply({ error: "RATE_LIMIT_UNAVAILABLE" }, 503); }
      if (limited) {
        const response = reply({ error: limited.status === 429 ? "RATE_LIMITED" : "RATE_LIMIT_UNAVAILABLE" }, limited.status === 429 ? 429 : 503);
        const retry = limited.headers.get("retry-after");
        if (retry && /^(?:0|[1-9][0-9]*)(?![\s\S])/.test(retry) && Number.isSafeInteger(Number(retry))) {
          response.headers.set("Retry-After", retry);
        }
        return response;
      }
      let providerScope: ReturnType<typeof resolveConfiguredOpenCreditProviderScope>;
      try { providerScope = (deps.resolveScope ?? resolveConfiguredOpenCreditProviderScope)(); }
      catch { return reply({ error: "OPENCREDIT_PROVIDER_SCOPE_CONFIGURATION" }, 503); }
      const input = { actor: session, companyId: command.companyId, contactId: command.contactId, providerScope };
      const result = action === "grant"
        ? await (deps.grant ?? grantOpenCreditConsumerAuthorizationFromInboundEvidence)(deps.db, { ...input, inboundEventId: command.inboundEventId! })
        : await (deps.revoke ?? revokeOpenCreditConsumerAuthorization)(deps.db, input);
      // Whitelist data properties only; never serialize an arbitrary domain row or getter.
      const values: Record<string, unknown> = {};
      for (const key of ["changed", "authorizationId", "active", "revision"]) {
        const descriptor = Object.getOwnPropertyDescriptor(result, key);
        if (!descriptor || !("value" in descriptor)) throw new Error("INVALID_RESULT");
        values[key] = descriptor.value;
      }
      if (typeof values.changed !== "boolean" || typeof values.active !== "boolean"
        || values.authorizationId !== null && !validId(values.authorizationId)
        || values.revision !== null && !(typeof values.revision === "number" && Number.isSafeInteger(values.revision) && values.revision >= 0)) {
        throw new Error("INVALID_RESULT");
      }
      return reply({ ok: true, changed: values.changed, authorizationId: values.authorizationId, active: values.active, revision: values.revision });
    } catch (error) {
      const code = readConsumerAuthorizationServiceCode(error);
      if (code !== null) return reply({ error: "OPENCREDIT_CONSUMER_AUTHORIZATION_" + code }, STATUS[code]);
      return reply({ error: "OPENCREDIT_CONSUMER_AUTHORIZATION_UNAVAILABLE" }, 503);
    }
  };
}
