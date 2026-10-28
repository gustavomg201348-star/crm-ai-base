import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { SessionUser } from "./auth";
import type { RateLimitRule } from "./rate-limit";
import { sameOrigin } from "./opencredit-admin-request";
import { parseOpenCreditStrictJson } from "./opencredit-strict-json";
import { correctionFields } from "./opencredit-client-correction";
import { dispatchClientCorrection, readClientCorrectionContext } from "./opencredit-client-correction.service";

type Dependencies = {
  getSession(request: NextRequest): Promise<SessionUser | null>;
  requirePlatformAdmin(actor: SessionUser): Response | null;
  enforceLimits(rules: readonly RateLimitRule[]): Promise<Response | null>;
  db: Parameters<typeof dispatchClientCorrection>[0];
  dispatch?: typeof dispatchClientCorrection;
  read?: typeof readClientCorrectionContext;
};
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(v);
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function command(request: NextRequest, dispatch: boolean) {
  const reader = request.body?.getReader(); if (!reader) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  const started = performance.now();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  try {
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { cancel(); reject(Error()); }, 1000); });
    const read = async () => {
      const chunks: Uint8Array[] = []; let bytes = 0;
      for (;;) {
        if (performance.now() - started >= 1000) throw Error();
        const { value, done } = await reader.read();
        if (performance.now() - started >= 1000) throw Error();
        if (done) break; bytes += value.byteLength; if (bytes > 4096) throw Error(); if (value.byteLength) chunks.push(value);
      }
      finished = true;
      const v = parseOpenCreditStrictJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)));
      const keys = ["companyId", "contactId", ...(dispatch ? ["dataNascimento", "nomeMae", "email"] : [])];
      if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).length !== keys.length || Object.keys(v).some(k => !keys.includes(k)) || !id(v.companyId) || !id(v.contactId)) return null;
      return { companyId: v.companyId, contactId: v.contactId, ...(dispatch ? correctionFields(v as never) : {}) };
    };
    return await Promise.race([read(), deadline]);
  } catch { return null; }
  finally { if (timer !== undefined) clearTimeout(timer); if (!finished) cancel(); try { reader.releaseLock(); } catch { /* Pending cancellation. */ } }
}
export function createClientCorrectionHandler(action: "context" | "dispatch", deps: Dependencies) {
  return async (request: NextRequest): Promise<Response> => {
    try {
      const actor = await deps.getSession(request); if (!actor) return reply({ error: "UNAUTHENTICATED" }, 401);
      if (deps.requirePlatformAdmin(actor)) return reply({ error: "FORBIDDEN" }, 403);
      if (!sameOrigin(request)) return reply({ error: "INVALID_ORIGIN" }, 403);
      if (request.url.includes("?") || request.headers.has("authorization") || !/^application\/json(?:;\s*charset=utf-8)?(?![\s\S])/i.test(request.headers.get("content-type") ?? "")) return reply({ error: "INVALID_REQUEST" }, 400);
      const input = await command(request, action === "dispatch"); if (!input) return reply({ error: "INVALID_REQUEST" }, 400);
      const limited = await deps.enforceLimits([
        { category: "opencredit-client-correction-actor", identifiers: [actor.companyId, actor.id, action], limit: action === "dispatch" ? 4 : 30, windowMs: 60000 },
        { category: "opencredit-client-correction-target", identifiers: [input.companyId, input.contactId, action], limit: action === "dispatch" ? 3 : 20, windowMs: 60000 },
      ]);
      if (limited) return reply({ error: limited.status === 429 ? "RATE_LIMITED" : "UNAVAILABLE" }, limited.status === 429 ? 429 : 503);
      if (action === "context") {
        const result = await (deps.read ?? readClientCorrectionContext)(deps.db, { actor, companyId: input.companyId, contactId: input.contactId });
        return reply({ ok: true, phonePreview: result.phonePreview, operation: result.operation });
      }
      const fields = correctionFields(input as never);
      const r = await (deps.dispatch ?? dispatchClientCorrection)(deps.db, { actor, companyId: input.companyId, contactId: input.contactId, ...fields });
      // Closed response: never forward a domain row, payload, or provider body.
      if (!id(r.operationId) || !["PREPARED", "IN_FLIGHT", "SUCCEEDED", "FAILED", "UNKNOWN"].includes(r.state) || !Number.isSafeInteger(r.revision)) throw Error();
      return reply({ ok: true, operationId: r.operationId, state: r.state, revision: r.revision });
    } catch (error) {
      const descriptor = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "code") : undefined;
      const code = descriptor && "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value : "";
      const allowed = ["NOT_AUTHORIZED", "TARGET_NOT_READY", "UNRESOLVED_CORRECTION", "CONFIGURATION", "INVALID_FIELDS", "STORAGE_UNAVAILABLE", "PRE_DISPATCH_FAILED", "SETTLEMENT_FAILED"];
      return reply({ error: allowed.includes(code) ? "OPENCREDIT_CLIENT_CORRECTION_" + code : "OPENCREDIT_CLIENT_CORRECTION_UNAVAILABLE" }, code === "NOT_AUTHORIZED" ? 403 : ["TARGET_NOT_READY", "UNRESOLVED_CORRECTION"].includes(code) ? 409 : code === "INVALID_FIELDS" ? 400 : 503);
    }
  };
}
