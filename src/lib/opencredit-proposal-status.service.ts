import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { OpenCreditApiError, openCreditApiClient } from "./opencredit-api-client";
import { OpenCreditConnectionError } from "./opencredit-connection.service";
import { sameOrigin } from "./opencredit-admin-request";
import type { SessionUser } from "./auth";
import type { RateLimitRule } from "./rate-limit";

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/;
const CODE = /^[A-Z][A-Z0-9_]{0,63}(?![\s\S])/;
const MAX_BYTES = 32 * 1024;
type Config = Partial<Record<"OPENCREDIT_TENANT_ID" | "OPENCREDIT_API_EMAIL" | "OPENCREDIT_API_PASSWORD", string>>;
type Category = { code: string; terminal?: boolean };
type Status = { status: string; category: string; terminal?: boolean; hasSignUrl?: boolean };
export type OpenCreditStatusCatalog = { bankId: string; categories: Category[]; statuses: Status[] };
const invalid = () => new OpenCreditConnectionError("INVALID_RESPONSE", 502);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function booleanField(source: Record<string, unknown>, key: "terminal" | "hasSignUrl") {
  if (!Object.hasOwn(source, key)) return {};
  if (typeof source[key] !== "boolean") throw invalid();
  return { [key]: source[key] };
}
function code(value: unknown): string {
  if (typeof value !== "string" || !CODE.test(value)) throw invalid();
  return value;
}
/** Local conservative policy, NOT a formal provider response schema. */
export function parseOpenCreditStatusCatalog(payload: unknown, bankId: string): OpenCreditStatusCatalog {
  if (!ID.test(bankId)) throw invalid();
  const data = object(object(payload).data);
  if (!Array.isArray(data.categories) || data.categories.length > 32 || !Array.isArray(data.items) || data.items.length > 1) throw invalid();
  const categories: Category[] = data.categories.map(value => {
    const item = object(value);
    return { code: code(item.code), ...booleanField(item, "terminal") };
  });
  if (new Set(categories.map(c => c.code)).size !== categories.length) throw invalid();
  const statuses: Status[] = [];
  for (const value of data.items) {
    const item = object(value);
    if (item.bankId !== bankId || !Array.isArray(item.statuses) || item.statuses.length > 100) throw invalid();
    for (const value of item.statuses) {
      const status = object(value);
      if (typeof status.status !== "string" || !status.status.trim() || status.status.length > 160
        || /[\u0000-\u001f\u007f]|https?:\/\/|www\./i.test(status.status)) throw invalid();
      const category = code(status.category);
      const declared = categories.find(c => c.code === category);
      if (!declared) throw invalid();
      const flags = booleanField(status, "terminal");
      if (Object.hasOwn(flags, "terminal") && declared.terminal !== undefined && flags.terminal !== declared.terminal) throw invalid();
      statuses.push({ status: status.status, category, ...flags, ...booleanField(status, "hasSignUrl") });
    }
  }
  if (new Set(statuses.map(s => s.status)).size !== statuses.length) throw invalid();
  return { bankId, categories, statuses };
}
function providerFailure(status: number) {
  return new OpenCreditConnectionError(status === 401 || status === 403 ? "AUTHENTICATION"
    : status === 429 || status >= 500 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_FAILED",
  status === 429 || status >= 500 ? 503 : 502, status);
}
export function createOpenCreditStatusCatalogService(options: {
  client?: Pick<typeof openCreditApiClient, "request">; env?: () => Config; timeoutMs?: number;
} = {}) {
  const client = options.client ?? openCreditApiClient;
  return async (bankId: string): Promise<OpenCreditStatusCatalog> => {
    const config = (options.env ?? (() => process.env))();
    if (!ID.test(bankId) || !config.OPENCREDIT_TENANT_ID || !ID.test(config.OPENCREDIT_TENANT_ID)
      || !config.OPENCREDIT_API_EMAIL?.trim() || !config.OPENCREDIT_API_PASSWORD?.trim()) throw new OpenCreditConnectionError("CONFIGURATION", 503);
    const path = `/api/tenants/${encodeURIComponent(config.OPENCREDIT_TENANT_ID)}/integration/proposal-status?${new URLSearchParams({ bankId })}`;
    const abort = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => { void reader?.cancel().catch(() => {}); };
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { abort.abort(); cancel(); reject(new OpenCreditConnectionError("TIMEOUT", 503)); }, options.timeoutMs ?? 20_000);
    });
    const operation = async () => {
      const response = await client.request(path, { method: "GET", signal: abort.signal });
      if (abort.signal.aborted || !response.ok) {
        void response.body?.cancel().catch(() => {});
        if (abort.signal.aborted) throw new OpenCreditConnectionError("TIMEOUT", 503);
        throw providerFailure(response.status);
      }
      const length = response.headers.get("content-length");
      if (length && /^\d+$/.test(length) && Number(length) > MAX_BYTES) {
        void response.body?.cancel().catch(() => {}); throw invalid();
      }
      reader = response.body?.getReader();
      if (!reader) throw invalid();
      const chunks: Uint8Array[] = []; let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (abort.signal.aborted) throw new OpenCreditConnectionError("TIMEOUT", 503);
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) { cancel(); throw invalid(); }
        chunks.push(value);
      }
      let payload: unknown;
      try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); } catch { throw invalid(); }
      return parseOpenCreditStatusCatalog(payload, bankId);
    };
    try { return await Promise.race([operation(), deadline]); }
    catch (error) {
      if (error instanceof OpenCreditConnectionError) throw error;
      if (error instanceof OpenCreditApiError) {
        if (error.code === "AUTH_FAILED") throw error.status === undefined ? new OpenCreditConnectionError("AUTHENTICATION", 502) : providerFailure(error.status);
        if (["CONFIGURATION", "TIMEOUT", "NETWORK"].includes(error.code)) throw new OpenCreditConnectionError(error.code as "CONFIGURATION" | "TIMEOUT" | "NETWORK", 503);
        throw invalid();
      }
      throw new OpenCreditConnectionError(abort.signal.aborted ? "TIMEOUT" : "NETWORK", 503);
    } finally {
      if (timer) clearTimeout(timer);
      if (abort.signal.aborted) cancel();
      try { reader?.releaseLock(); } catch { /* Pending cancelled read settles independently. */ }
    }
  };
}

async function readBankId(request: NextRequest): Promise<string | undefined> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "") || !request.body) return;
  const reader = request.body.getReader(); let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const deadline = new Promise<undefined>(resolve => { timer = setTimeout(() => { cancel(); resolve(undefined); }, 1000); });
  const read = async () => {
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 256) { cancel(); return; }
      chunks.push(value);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    const body = object(JSON.parse(text));
    // Accept one JSON string property only, rejecting duplicate keys as well.
    if (!/^\s*\{\s*"bankId"\s*:\s*"[A-Za-z0-9][A-Za-z0-9_-]{0,127}"\s*\}\s*$/.test(text)
      || Object.keys(body).length !== 1 || typeof body.bankId !== "string" || !ID.test(body.bankId)) return;
    return body.bankId;
  };
  try { return await Promise.race([read(), deadline]); } catch { return; }
  finally { if (timer) clearTimeout(timer); try { reader.releaseLock(); } catch { /* Pending read. */ } }
}
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export function createOpenCreditStatusCatalogHandler(deps: {
  getSession(request: NextRequest): Promise<SessionUser | null>;
  requirePlatformAdmin(session: SessionUser): Response | null;
  enforceLimits(rules: readonly RateLimitRule[]): Promise<Response | null>;
  catalog(bankId: string): Promise<OpenCreditStatusCatalog>;
}) {
  return async (request: NextRequest): Promise<Response> => {
    try {
      const session = await deps.getSession(request);
      if (!session) return reply({ error: "UNAUTHENTICATED" }, 401);
      if (deps.requirePlatformAdmin(session)) return reply({ error: "FORBIDDEN" }, 403);
      if (!sameOrigin(request)) return reply({ error: "INVALID_ORIGIN" }, 403);
      if (request.nextUrl.search || request.headers.has("authorization")) return reply({ error: "INVALID_REQUEST" }, 400);
      const limited = await deps.enforceLimits([{ category: "opencredit-proposal-status-catalog", identifiers: [session.companyId, session.id], limit: 3, windowMs: 60_000 }]);
      if (limited) {
        const response = reply({ error: limited.status === 429 ? "RATE_LIMITED" : "RATE_LIMIT_UNAVAILABLE" }, limited.status === 429 ? 429 : 503);
        const retry = limited.headers.get("retry-after");
        if (retry && /^\d+$/.test(retry)) response.headers.set("Retry-After", retry);
        return response;
      }
      const bankId = await readBankId(request);
      if (!bankId) return reply({ error: "INVALID_REQUEST" }, 400);
      const result = await deps.catalog(bankId);
      return reply({ ok: true, bankId: result.bankId, categories: result.categories, statuses: result.statuses });
    } catch (error) {
      if (error instanceof OpenCreditConnectionError) {
        const body: { error: string; providerStatus?: number } = { error: `OPENCREDIT_PROPOSAL_STATUS_CATALOG_${error.code}` };
        if (typeof error.providerStatus === "number" && Number.isInteger(error.providerStatus) && error.providerStatus >= 100 && error.providerStatus <= 599) body.providerStatus = error.providerStatus;
        return reply(body, error.status);
      }
      return reply({ error: "OPENCREDIT_PROPOSAL_STATUS_CATALOG_UNAVAILABLE" }, 503);
    }
  };
}
