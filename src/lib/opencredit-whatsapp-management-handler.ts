import { NextResponse, type NextRequest } from "next/server";
import type { SessionUser } from "./auth";
import { sameOrigin } from "./opencredit-admin-request";
import { parseOpenCreditStrictJson } from "./opencredit-strict-json";
import { requireCompanyAdmin } from "./permissions";
import { BootstrapBlocked } from "./opencredit-whatsapp-policy";
import { parseWhatsappBootstrapConfig, type createOpenCreditWhatsappConfigService } from "./opencredit-whatsapp-config.service";
import type { createOpenCreditWhatsappBootstrap } from "./opencredit-whatsapp-bootstrap.service";
import type { RateLimitRule } from "./rate-limit";
type Context = { params: Promise<{ id: string }> };
const response = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
export async function readOpenCreditWhatsappBody(request: NextRequest) {
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) return null;
  const reader = request.body?.getReader(); if (!reader) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(Error("BODY_TIMEOUT")); }, 1000); });
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) { const part = await Promise.race([reader.read(), timeout]); if (part.done) break;
      bytes += part.value.length; if (bytes > 2048) { void reader.cancel().catch(() => {}); return null; } chunks.push(part.value); }
    return parseOpenCreditStrictJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)));
  } catch { return null; }
  finally { if (timer) clearTimeout(timer); try { reader.releaseLock(); } catch {} }
}
export function createOpenCreditWhatsappManagement(deps: {
  getSession(request: NextRequest): Promise<SessionUser | null>;
  config: ReturnType<typeof createOpenCreditWhatsappConfigService>;
  bootstrap: ReturnType<typeof createOpenCreditWhatsappBootstrap>;
  enforceLimits(rules: readonly RateLimitRule[]): Promise<Response | null>;
}) {
  const run = (action: "read" | "save" | "bootstrap") => async (request: NextRequest, context: Context) => {
    try {
      const actor = await deps.getSession(request);
      if (!actor) return response({ error: "UNAUTHENTICATED" }, 401);
      if (requireCompanyAdmin(actor)) return response({ error: "FORBIDDEN" }, 403);
      const integrationId = (await context.params).id;
      if (!id(integrationId) || request.headers.has("authorization")) return response({ error: "INVALID_REQUEST" }, 400);
      if (action === "read") {
        if (Array.from(request.nextUrl.searchParams.keys()).some(k => k !== "channelId")
          || request.nextUrl.searchParams.getAll("channelId").length > 1) return response({ error: "INVALID_REQUEST" }, 400);
        const channelId = request.nextUrl.searchParams.get("channelId");
        if (channelId !== null && !id(channelId)) return response({ error: "INVALID_REQUEST" }, 400);
        return response(await deps.config.read(actor.companyId, integrationId, channelId ?? undefined));
      }
      if (!sameOrigin(request)) return response({ error: "INVALID_ORIGIN" }, 403);
      if (request.nextUrl.search) return response({ error: "INVALID_REQUEST" }, 400);
      const body = await readOpenCreditWhatsappBody(request);
      const config = action === "save" ? parseWhatsappBootstrapConfig(body) : null;
      const jobId = action === "bootstrap" && body && typeof body === "object" && !Array.isArray(body)
        && Object.keys(body).join() === "jobId" && id(body.jobId) ? body.jobId : null;
      if (!(config || jobId)) return response({ error: "INVALID_REQUEST" }, 400);
      const limited = await deps.enforceLimits([{ category: "opencredit-whatsapp-admin", identifiers: [actor.companyId, actor.id, integrationId], limit: 10, windowMs: 60000 }]);
      if (limited) { const r = response({ error: limited.status === 429 ? "RATE_LIMITED" : "UNAVAILABLE" }, limited.status === 429 ? 429 : 503);
        const retry = limited.headers.get("retry-after"); if (retry && limited.status === 429 && /^\d+$/.test(retry)) r.headers.set("Retry-After", retry); return r; }
      return response(config ? await deps.config.save(actor, integrationId, config)
        : await deps.bootstrap.bootstrap({ companyId: actor.companyId, integrationId, jobId: jobId! }));
    } catch (error) {
      return error instanceof BootstrapBlocked ? response({ error: error.code }, 409) : response({ error: "UNAVAILABLE" }, 503);
    }
  };
  return { GET: run("read"), PATCH: run("save"), POST: run("bootstrap") };
}
