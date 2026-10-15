import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { OpenCreditApiError, openCreditApiClient } from "./opencredit-api-client";
import { emptyBody, sameOrigin } from "./opencredit-admin-request";
import type { SessionUser } from "./auth";
import type { RateLimitRule } from "./rate-limit";

type Failure = "FAILED" | "PROVIDER_UNAVAILABLE" | "TIMEOUT" | "NETWORK" | "CONFIGURATION" | "INVALID_RESPONSE";

export class OpenCreditAuthenticationError extends Error {
  constructor(readonly code: Failure, readonly status: 502 | 503, readonly providerStatus?: number) {
    super(`OPENCREDIT_AUTHENTICATION_${code}`);
  }
}

export function openCreditAuthenticationFailure(error: unknown): OpenCreditAuthenticationError {
  if (error instanceof OpenCreditApiError) {
    if (error.code === "AUTH_FAILED") {
      const status = error.status;
      const unavailable = status === 429 || (status !== undefined && status >= 500);
      return new OpenCreditAuthenticationError(unavailable ? "PROVIDER_UNAVAILABLE" : "FAILED", unavailable ? 503 : 502, status);
    }
    if (error.code === "CONFIGURATION" || error.code === "TIMEOUT" || error.code === "NETWORK") {
      return new OpenCreditAuthenticationError(error.code, 503);
    }
    return new OpenCreditAuthenticationError("INVALID_RESPONSE", 502);
  }
  // Unknown internal exceptions never expose raw details.
  return new OpenCreditAuthenticationError("PROVIDER_UNAVAILABLE", 503);
}

/** Password-only check: no tenant, partner, bank request or commercial operation. */
export function createOpenCreditAuthenticationService(options: {
  client?: Pick<typeof openCreditApiClient, "verifyCredentials">;
} = {}) {
  const client = options.client ?? openCreditApiClient;
  return async (): Promise<void> => {
    try { await client.verifyCredentials(); }
    catch (error) {
      throw openCreditAuthenticationFailure(error);
    }
  };
}

function reply(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function createOpenCreditAuthenticationHandler(deps: {
  getSession(request: NextRequest): Promise<SessionUser | null>;
  requirePlatformAdmin(session: SessionUser): Response | null;
  enforceLimits(rules: readonly RateLimitRule[]): Promise<Response | null>;
  testAuthentication(): Promise<void>;
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
        category: "opencredit-test-authentication", identifiers: [session.companyId, session.id],
        limit: 3, windowMs: 60_000
      }]);
      if (limited) {
        const response = reply({ error: limited.status === 429 ? "RATE_LIMITED" : "RATE_LIMIT_UNAVAILABLE" }, limited.status === 429 ? 429 : 503);
        const retry = limited.headers.get("retry-after");
        if (retry && /^\d+$/.test(retry)) response.headers.set("Retry-After", retry);
        return response;
      }
      await deps.testAuthentication();
      return reply({ ok: true });
    } catch (error) {
      if (error instanceof OpenCreditAuthenticationError) {
        const body: { error: string; providerStatus?: number } = { error: `OPENCREDIT_AUTHENTICATION_${error.code}` };
        const status = error.providerStatus;
        if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) body.providerStatus = status;
        return reply(body, error.status);
      }
      return reply({ error: "OPENCREDIT_AUTHENTICATION_PROVIDER_UNAVAILABLE" }, 503);
    }
  };
}
