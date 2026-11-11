import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { SessionUser } from "./auth";
import type { RateLimitRule } from "./rate-limit";
import { sameOrigin, readOpenCreditAdminJson } from "./opencredit-admin-request";
import { resolveConfiguredOpenCreditProviderScope } from "./opencredit-provider-scope-resolver";
import { OpenCreditMaterializationPreflightError } from "./opencredit-materialization-preflight.service";
import { MaterializationConfigurationError, parseMaterializationConfiguration,
  readMaterializationConfiguration, setMaterializationConfiguration } from "./opencredit-materialization-configuration.service";

type Dependencies = {
  getSession(request: NextRequest): Promise<SessionUser | null>;
  requirePlatformAdmin(actor: SessionUser): Response | null;
  enforceLimits(rules: readonly RateLimitRule[]): Promise<Response | null>;
  db: Parameters<typeof setMaterializationConfiguration>[0];
  resolveScope?: typeof resolveConfiguredOpenCreditProviderScope;
  read?: typeof readMaterializationConfiguration; write?: typeof setMaterializationConfiguration;
  pilot?: (input: { actor: SessionUser; companyId: string; integrationId: string; providerScope: string }) => Promise<object>;
};
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const status = { NOT_AUTHORIZED: 403, NOT_FOUND: 404, INVALID_REQUEST: 400, UNAVAILABLE: 503,
  CONFLICT: 409, GATES_INVALID: 409, ROLLOUT_RESERVED: 409 } as const;
export function createMaterializationConfigurationHandler(deps: Dependencies) {
  return async (request: NextRequest) => {
    try {
      const actor = await deps.getSession(request);
      if (!actor) return reply({ error: "UNAUTHENTICATED" }, 401);
      if (deps.requirePlatformAdmin(actor)) return reply({ error: "FORBIDDEN" }, 403);
      if (!sameOrigin(request)) return reply({ error: "INVALID_ORIGIN" }, 403);
      if (request.nextUrl.search || request.url.includes("?") || request.headers.has("authorization")
        || !/^application\/json(?:;\s*charset=utf-8)?(?![\s\S])/i.test(request.headers.get("content-type") ?? "")) return reply({ error: "INVALID_REQUEST" }, 400);
      let command;
      try {
        const body = await readOpenCreditAdminJson(request);
        if (deps.pilot) {
          if (!body || typeof body !== "object" || Array.isArray(body) || !("action" in body) || body.action !== "PILOT") {
            return reply({ error: "INVALID_REQUEST" }, 400);
          }
          command = parseMaterializationConfiguration({ ...body, action: "READ" });
        } else command = parseMaterializationConfiguration(body);
      } catch { return reply({ error: "INVALID_REQUEST" }, 400); }
      if (!command) return reply({ error: "INVALID_REQUEST" }, 400);
      const limited = await deps.enforceLimits([
        { category: deps.pilot ? "opencredit-single-admission-actor" : "opencredit-materialization-config-actor", identifiers: [actor.companyId, actor.id], limit: deps.pilot ? 3 : 20, windowMs: 60000 },
        { category: deps.pilot ? "opencredit-single-admission-binding" : "opencredit-materialization-config-binding", identifiers: [command.companyId, command.integrationId], limit: deps.pilot ? 3 : 10, windowMs: 60000 },
      ]);
      if (limited) {
        const r = reply({ error: limited.status === 429 ? "RATE_LIMITED" : "UNAVAILABLE" }, limited.status === 429 ? 429 : 503);
        const retry = limited.headers.get("retry-after"); if (limited.status === 429 && retry && /^\d+$/.test(retry)) r.headers.set("Retry-After", retry);
        return r;
      }
      const providerScope = (deps.resolveScope ?? resolveConfiguredOpenCreditProviderScope)();
      if (deps.pilot) return reply(await deps.pilot({ actor, companyId: command.companyId, integrationId: command.integrationId, providerScope }));
      return reply(await (command.action === "READ" ? deps.read ?? readMaterializationConfiguration : deps.write ?? setMaterializationConfiguration)(deps.db, { actor, providerScope, command }));
    } catch (error) {
      if (error instanceof MaterializationConfigurationError && Object.hasOwn(status, error.code)) return reply({ error: error.code }, status[error.code]);
      if (error instanceof OpenCreditMaterializationPreflightError && error.code === "NOT_AUTHORIZED") return reply({ error: "FORBIDDEN" }, 403);
      return reply({ error: "UNAVAILABLE" }, 503);
    }
  };
}
