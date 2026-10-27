import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { SessionUser } from "./auth";
import type { RateLimitRule } from "./rate-limit";
import { sameOrigin } from "./opencredit-admin-request";
import { parseOpenCreditStrictJson } from "./opencredit-strict-json";
import { readOpenCreditClientValidation, readClientValidationGateError } from "./opencredit-client-validation.service";
import { parseClientValidationResponse } from "./opencredit-client-validation";

type Dependencies = {
  getSession(request: NextRequest): Promise<SessionUser | null>;
  requirePlatformAdmin(actor: SessionUser): Response | null;
  enforceLimits(rules: readonly RateLimitRule[]): Promise<Response | null>;
  db: Parameters<typeof readOpenCreditClientValidation>[0];
  read?: typeof readOpenCreditClientValidation;
};
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function command(request: NextRequest): Promise<{ companyId: string; contactId: string } | null> {
  const reader = request.body?.getReader(); if (!reader) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  try {
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { cancel(); reject(Error("INVALID_REQUEST")); }, 1000); });
    const read = async () => {
      let bytes = 0; const chunks: Uint8Array[] = [];
      for (;;) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 2048) throw Error("INVALID_REQUEST"); chunks.push(value); }
      const v = parseOpenCreditStrictJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)));
      if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).length !== 2 || Object.keys(v).some(k => k !== "companyId" && k !== "contactId")) return null;
      const id = (x: unknown): x is string => typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(x);
      return id(v.companyId) && id(v.contactId) ? { companyId: v.companyId, contactId: v.contactId } : null;
    };
    return await Promise.race([read(), deadline]);
  } catch { cancel(); return null; }
  finally { if (timer !== undefined) clearTimeout(timer); try { reader.releaseLock(); } catch { /* Pending cancellation. */ } }
}
export function createOpenCreditClientValidationHandler(deps: Dependencies) {
  return async (request: NextRequest): Promise<Response> => {
    try {
      const actor = await deps.getSession(request);
      if (!actor) return reply({ error: "UNAUTHENTICATED" }, 401);
      if (deps.requirePlatformAdmin(actor)) return reply({ error: "FORBIDDEN" }, 403);
      if (!sameOrigin(request)) return reply({ error: "INVALID_ORIGIN" }, 403);
      if (request.nextUrl.search || request.url.includes("?") || request.headers.has("authorization")
        || !/^application\/json(?:;\s*charset=utf-8)?(?![\s\S])/i.test(request.headers.get("content-type") ?? "")) return reply({ error: "INVALID_REQUEST" }, 400);
      const input = await command(request); if (!input) return reply({ error: "INVALID_REQUEST" }, 400);
      const limited = await deps.enforceLimits([
        { category: "opencredit-client-validation-actor", identifiers: [actor.companyId, actor.id], limit: 4, windowMs: 60000 },
        { category: "opencredit-client-validation-target", identifiers: [input.companyId, input.contactId], limit: 3, windowMs: 60000 },
      ]);
      if (limited) return reply({ error: limited.status === 429 ? "RATE_LIMITED" : "READ_UNAVAILABLE" }, limited.status === 429 ? 429 : 503);
      const result = parseClientValidationResponse(await (deps.read ?? readOpenCreditClientValidation)(deps.db, { actor, ...input }));
      if (!result) return reply({ error: "READ_UNAVAILABLE" }, 503);
      const status = result.ok ? 200 : ["TIMEOUT", "NETWORK", "CONFIGURATION", "PROVIDER_UNAVAILABLE"].includes(result.diagnostic.category) ? 503 : 502;
      return reply(result, status);
    } catch (error) {
      const gate = readClientValidationGateError(error);
      return gate ? reply({ error: "OPENCREDIT_CLIENT_VALIDATION_" + gate }, gate === "NOT_AUTHORIZED" ? 403 : gate === "TARGET_NOT_READY" ? 409 : 503)
        : reply({ error: "READ_UNAVAILABLE" }, 503);
    }
  };
}
