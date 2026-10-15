import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createOpenCreditBanksReader, OpenCreditConnectionError } from "./opencredit-connection.service";
import { parseOpenCreditCapabilities, type OpenCreditBankCapabilities } from "./opencredit-banks";
import { emptyBody, sameOrigin } from "./opencredit-admin-request";
import type { SessionUser } from "./auth";
import type { RateLimitRule } from "./rate-limit";

export function createOpenCreditBankCapabilitiesService(options: Parameters<typeof createOpenCreditBanksReader>[0] = {}) {
  const readBanks = createOpenCreditBanksReader(options, true);
  return async (): Promise<OpenCreditBankCapabilities[]> => {
    const banks = await readBanks();
    if (new Set(banks.map(bank => bank.bankId)).size !== banks.length) {
      throw new OpenCreditConnectionError("INVALID_RESPONSE", 502);
    }
    return banks;
  };
}

function reply(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function createOpenCreditBankCapabilitiesHandler(deps: {
  getSession(request: NextRequest): Promise<SessionUser | null>;
  requirePlatformAdmin(session: SessionUser): Response | null;
  enforceLimits(rules: readonly RateLimitRule[]): Promise<Response | null>;
  bankCapabilities(): Promise<OpenCreditBankCapabilities[]>;
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
        category: "opencredit-bank-capabilities", identifiers: [session.companyId, session.id],
        limit: 3, windowMs: 60_000
      }]);
      if (limited) {
        const response = reply({ error: limited.status === 429 ? "RATE_LIMITED" : "RATE_LIMIT_UNAVAILABLE" }, limited.status === 429 ? 429 : 503);
        const retry = limited.headers.get("retry-after");
        if (retry && /^\d+$/.test(retry)) response.headers.set("Retry-After", retry);
        return response;
      }
      const banks = await deps.bankCapabilities();
      const safe = banks.map(bank => {
        const capabilities = parseOpenCreditCapabilities(bank.capabilities);
        if (!capabilities) throw new OpenCreditConnectionError("INVALID_RESPONSE", 502);
        return { bankId: bank.bankId, bankName: bank.bankName, capabilities };
      });
      return reply({ ok: true, count: safe.length, banks: safe });
    } catch (error) {
      if (error instanceof OpenCreditConnectionError) {
        const body: { error: string; providerStatus?: number } = { error: `OPENCREDIT_BANK_CAPABILITIES_${error.code}` };
        const status = error.providerStatus;
        if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) body.providerStatus = status;
        return reply(body, error.status);
      }
      return reply({ error: "OPENCREDIT_BANK_CAPABILITIES_UNAVAILABLE" }, 503);
    }
  };
}
