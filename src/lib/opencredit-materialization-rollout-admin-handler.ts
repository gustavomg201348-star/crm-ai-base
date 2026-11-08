import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { SessionUser } from "./auth";
import type { RateLimitRule } from "./rate-limit";
import { sameOrigin } from "./opencredit-admin-request";
import { parseOpenCreditStrictJson } from "./opencredit-strict-json";
import { resolveConfiguredOpenCreditProviderScope } from "./opencredit-provider-scope-resolver";
import { executeRolloutAdminCommand, parseRolloutCommand, RolloutAdminError } from "./opencredit-materialization-rollout-admin.service";

type Dependencies = {
  getSession(request: NextRequest): Promise<SessionUser | null>;
  requirePlatformAdmin(actor: SessionUser): Response | null;
  enforceLimits(rules: readonly RateLimitRule[]): Promise<Response | null>;
  db: Parameters<typeof executeRolloutAdminCommand>[0];
  execute?: typeof executeRolloutAdminCommand;
  resolveScope?: typeof resolveConfiguredOpenCreditProviderScope;
};
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function readCommand(request: NextRequest) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { cancel(); reject(new Error("INVALID_BODY")); }, 1000);
    });
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > 1024) { cancel(); return null; }
      chunks.push(value);
    }
    return parseRolloutCommand(parseOpenCreditStrictJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks))));
  } catch { return null; }
  finally { if (timer) clearTimeout(timer); try { reader.releaseLock(); } catch {} }
}
export function createOpenCreditMaterializationRolloutAdminHandler(deps: Dependencies) {
  return async (request: NextRequest) => {
    try {
      const actor = await deps.getSession(request);
      if (!actor) return reply({ error: "UNAUTHENTICATED" }, 401);
      if (deps.requirePlatformAdmin(actor)) return reply({ error: "FORBIDDEN" }, 403);
      if (!sameOrigin(request)) return reply({ error: "INVALID_ORIGIN" }, 403);
      if (request.nextUrl.search || request.url.includes("?") || request.headers.has("authorization")
        || !/^application\/json(?:;\s*charset=utf-8)?(?![\s\S])/i.test(request.headers.get("content-type") ?? "")) return reply({ error: "INVALID_REQUEST" }, 400);
      const command = await readCommand(request);
      if (!command) return reply({ error: "INVALID_REQUEST" }, 400);
      const limited = await deps.enforceLimits([
        { category: "opencredit-rollout-admin-actor", identifiers: [actor.companyId, actor.id], limit: 10, windowMs: 60000 },
        { category: "opencredit-rollout-admin-binding", identifiers: [command.companyId, command.integrationId], limit: 6, windowMs: 60000 },
      ]);
      if (limited) {
        const response = reply({ error: limited.status === 429 ? "RATE_LIMITED" : "UNAVAILABLE" }, limited.status === 429 ? 429 : 503);
        const retry = limited.headers.get("retry-after");
        if (limited.status === 429 && retry && /^\d+$/.test(retry)) response.headers.set("Retry-After", retry);
        return response;
      }
      const providerScope = (deps.resolveScope ?? resolveConfiguredOpenCreditProviderScope)();
      return reply(await (deps.execute ?? executeRolloutAdminCommand)(deps.db, { actor, providerScope, command }));
    } catch (error) {
      const code = error instanceof RolloutAdminError ? error.code : "UNAVAILABLE";
      return reply({ error: "OPENCREDIT_ROLLOUT_" + code }, code === "NOT_AUTHORIZED" ? 403 : code === "INVALID_REQUEST" ? 400 : code === "CONFLICT" ? 409 : 503);
    }
  };
}
