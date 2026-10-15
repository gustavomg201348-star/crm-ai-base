import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { OpenCreditApiError, openCreditApiClient } from "./opencredit-api-client";
import { emptyBody, sameOrigin } from "./opencredit-admin-request";
import { parseOpenCreditBanks, type OpenCreditBank } from "./opencredit-banks";
import type { SessionUser } from "./auth";
import type { RateLimitRule } from "./rate-limit";

const MAX_BYTES = 64 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
type Config = Partial<Record<"OPENCREDIT_TENANT_ID" | "OPENCREDIT_API_EMAIL" | "OPENCREDIT_API_PASSWORD", string>>;
type Result = { ok: true; bankCount: number };
type Failure = "CONFIGURATION" | "AUTHENTICATION" | "INVALID_RESPONSE" | "PROVIDER_UNAVAILABLE" | "PROVIDER_FAILED" | "TIMEOUT" | "NETWORK";

export class OpenCreditConnectionError extends Error {
  constructor(readonly code: Failure, readonly status: 502 | 503, readonly providerStatus?: number) {
    super(`OPENCREDIT_CONNECTION_${code}`);
  }
}

function providerFailure(status: number) {
  if (status === 401 || status === 403) return new OpenCreditConnectionError("AUTHENTICATION", 502, status);
  if (status === 429 || status >= 500) return new OpenCreditConnectionError("PROVIDER_UNAVAILABLE", 503, status);
  return new OpenCreditConnectionError("PROVIDER_FAILED", 502, status);
}

/** Fixed banks probe, never a generic provider proxy or commercial operation. */
export function createOpenCreditBanksReader(options: {
  client?: Pick<typeof openCreditApiClient, "request">;
  env?: () => Config;
  timeoutMs?: number;
} = {}) {
  const client = options.client ?? openCreditApiClient;
  const env = options.env ?? (() => process.env);
  const timeoutMs = options.timeoutMs ?? 20_000;

  return async (): Promise<OpenCreditBank[]> => {
    const config = env();
    const tenant = config.OPENCREDIT_TENANT_ID;
    if (!tenant || !ID.test(tenant)
      || !config.OPENCREDIT_API_EMAIL?.trim() || !config.OPENCREDIT_API_PASSWORD?.trim()) {
      throw new OpenCreditConnectionError("CONFIGURATION", 503);
    }
    const path = `/api/tenants/${encodeURIComponent(tenant)}/banks?${new URLSearchParams({ product: "clt" })}`;
    const abort = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancelBody = () => { void reader?.cancel().catch(() => {}); };
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        cancelBody();
        reject(new OpenCreditConnectionError("TIMEOUT", 503));
      }, timeoutMs);
    });

    const operation = async (): Promise<OpenCreditBank[]> => {
      // Existing client alone owns login/refresh and the single GET retry.
      const response = await client.request(path, { method: "GET", signal: abort.signal });
      if (abort.signal.aborted || !response.ok) {
        void response.body?.cancel().catch(() => {});
        if (abort.signal.aborted) throw new OpenCreditConnectionError("TIMEOUT", 503);
        throw providerFailure(response.status);
      }
      const length = response.headers.get("content-length");
      if (length && /^\d+$/.test(length) && Number(length) > MAX_BYTES) {
        void response.body?.cancel().catch(() => {});
        throw new OpenCreditConnectionError("INVALID_RESPONSE", 502);
      }
      reader = response.body?.getReader();
      if (!reader) throw new OpenCreditConnectionError("INVALID_RESPONSE", 502);
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (abort.signal.aborted) throw new OpenCreditConnectionError("TIMEOUT", 503);
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) {
          cancelBody();
          throw new OpenCreditConnectionError("INVALID_RESPONSE", 502);
        }
        chunks.push(value);
      }
      let payload: unknown;
      try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { throw new OpenCreditConnectionError("INVALID_RESPONSE", 502); }
      const banks = parseOpenCreditBanks(payload);
      if (!banks) throw new OpenCreditConnectionError("INVALID_RESPONSE", 502);
      return banks;
    };

    try { return await Promise.race([operation(), deadline]); }
    catch (error) {
      if (error instanceof OpenCreditConnectionError) throw error;
      if (error instanceof OpenCreditApiError) {
        if (error.code === "CONFIGURATION") throw new OpenCreditConnectionError("CONFIGURATION", 503);
        if (error.code === "AUTH_FAILED") {
          if (error.status === undefined) throw new OpenCreditConnectionError("AUTHENTICATION", 502);
          throw providerFailure(error.status);
        }
        if (error.code === "TIMEOUT" || error.code === "NETWORK") throw new OpenCreditConnectionError(error.code, 503);
        throw new OpenCreditConnectionError("INVALID_RESPONSE", 502);
      }
      throw new OpenCreditConnectionError(abort.signal.aborted ? "TIMEOUT" : "NETWORK", 503);
    } finally {
      if (timer) clearTimeout(timer);
      // Deadline may finish before an in-flight auth request. A late response
      // is cancelled above; no additional request/retry is initiated here.
      if (abort.signal.aborted) cancelBody();
      try { reader?.releaseLock(); } catch { /* A cancelled read may still settle. */ }
    }
  };
}

export function createOpenCreditConnectionService(options: Parameters<typeof createOpenCreditBanksReader>[0] = {}) {
  const readBanks = createOpenCreditBanksReader(options);
  return async (): Promise<Result> => ({ ok: true, bankCount: (await readBanks()).length });
}

function reply(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function createOpenCreditConnectionHandler(deps: {
  getSession(request: NextRequest): Promise<SessionUser | null>;
  requirePlatformAdmin(session: SessionUser): Response | null;
  enforceLimits(rules: readonly RateLimitRule[]): Promise<Response | null>;
  testConnection(): Promise<Result>;
}) {
  return async (request: NextRequest): Promise<Response> => {
    try {
      const session = await deps.getSession(request);
      if (!session) return reply({ error: "UNAUTHENTICATED" }, 401);
      const blocked = deps.requirePlatformAdmin(session);
      if (blocked) return reply({ error: "FORBIDDEN" }, 403);
      if (!sameOrigin(request)) {
        return reply({ error: "INVALID_ORIGIN" }, 403);
      }
      // No payload, query options or incoming bearer are accepted.
      if (request.nextUrl.search || request.headers.has("authorization") || !(await emptyBody(request))) {
        return reply({ error: "INVALID_REQUEST" }, 400);
      }
      const limited = await deps.enforceLimits([{
        category: "opencredit-test-connection", identifiers: [session.companyId, session.id],
        limit: 3, windowMs: 60_000
      }]);
      if (limited) {
        const response = reply({ error: limited.status === 429 ? "RATE_LIMITED" : "RATE_LIMIT_UNAVAILABLE" }, limited.status === 429 ? 429 : 503);
        const retry = limited.headers.get("retry-after");
        if (retry && /^\d+$/.test(retry)) response.headers.set("Retry-After", retry);
        return response;
      }
      const result = await deps.testConnection();
      return reply({ ok: true, bankCount: result.bankCount });
    } catch (error) {
      if (error instanceof OpenCreditConnectionError) {
        const body: { error: string; providerStatus?: number } = { error: `OPENCREDIT_CONNECTION_${error.code}` };
        const status = error.providerStatus;
        if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) {
          body.providerStatus = status;
        }
        return reply(body, error.status);
      }
      // No raw exception/provider/request data is logged or returned.
      return reply({ error: "CONNECTION_TEST_UNAVAILABLE" }, 503);
    }
  };
}
