import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createOpenCreditApiClient } from "./opencredit-api-client";
import { configuredOpenCreditId } from "./opencredit-access-summary";
import { OpenCreditAuthenticationError, openCreditAuthenticationFailure } from "./opencredit-authentication.service";
import { emptyBody, sameOrigin } from "./opencredit-admin-request";
import type { SessionUser } from "./auth";
import type { RateLimitRule } from "./rate-limit";

type Result = Awaited<ReturnType<ReturnType<typeof createOpenCreditApiClient>["diagnoseAccess"]>>;
type Config = Partial<Record<"OPENCREDIT_TENANT_ID" | "OPENCREDIT_PARTNER_ID", string>>;

export function createOpenCreditAccessDiagnosticService(options: {
  env?: () => Config;
  clientFactory?: () => Pick<ReturnType<typeof createOpenCreditApiClient>, "diagnoseAccess" | "dispose">;
} = {}) {
  return async (): Promise<Result> => {
    const config = (options.env ?? (() => process.env))();
    const tenant = config.OPENCREDIT_TENANT_ID;
    const partner = config.OPENCREDIT_PARTNER_ID;
    if (!configuredOpenCreditId(tenant) || !configuredOpenCreditId(partner)) {
      throw new OpenCreditAuthenticationError("CONFIGURATION", 503);
    }
    // A private per-execution client, never the normal singleton/token cache.
    const client = (options.clientFactory ?? createOpenCreditApiClient)();
    try { return await client.diagnoseAccess(tenant, partner); }
    catch (error) { throw openCreditAuthenticationFailure(error); }
    finally { client.dispose(); }
  };
}

function reply(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function createOpenCreditAccessDiagnosticHandler(deps: {
  getSession(request: NextRequest): Promise<SessionUser | null>;
  requirePlatformAdmin(session: SessionUser): Response | null;
  enforceLimits(rules: readonly RateLimitRule[]): Promise<Response | null>;
  diagnoseAccess(): Promise<Result>;
}) {
  return async (request: NextRequest): Promise<Response> => {
    try {
      const session = await deps.getSession(request);
      if (!session) return reply({ error: "UNAUTHENTICATED" }, 401);
      if (deps.requirePlatformAdmin(session)) return reply({ error: "FORBIDDEN" }, 403);
      if (!sameOrigin(request)) return reply({ error: "INVALID_ORIGIN" }, 403);
      if (request.nextUrl.search || request.headers.has("authorization") || !(await emptyBody(request))) {
        return reply({ error: "INVALID_REQUEST" }, 400);
      }
      const limited = await deps.enforceLimits([{
        category: "opencredit-diagnose-access", identifiers: [session.companyId, session.id],
        limit: 2, windowMs: 60_000
      }]);
      if (limited) {
        const response = reply({ error: limited.status === 429 ? "RATE_LIMITED" : "RATE_LIMIT_UNAVAILABLE" }, limited.status === 429 ? 429 : 503);
        const retry = limited.headers.get("retry-after");
        if (retry && /^\d+$/.test(retry)) response.headers.set("Retry-After", retry);
        return response;
      }
      return reply(await deps.diagnoseAccess());
    } catch (error) {
      if (error instanceof OpenCreditAuthenticationError) {
        const body: { error: string; providerStatus?: number } = { error: `OPENCREDIT_AUTHENTICATION_${error.code}` };
        const status = error.providerStatus;
        if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) body.providerStatus = status;
        return reply(body, error.status);
      }
      return reply({ error: "OPENCREDIT_ACCESS_DIAGNOSTIC_UNAVAILABLE" }, 503);
    }
  };
}
