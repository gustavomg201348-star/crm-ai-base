// Public Next.js marker: reject accidental imports from Client Components.
import "server-only";
import { createHash } from "node:crypto";
import { configuredOpenCreditId, openCreditCorrelationIds, summarizeOpenCreditAccessToken } from "./opencredit-access-summary";

const ORIGIN = "https://core.api.opencredit.tech";
const IDLE_MS = 10 * 60 * 1000;
const REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
const AUTH_BYTES = 16 * 1024;

type Credentials = { email: string; password: string };
type Tokens = { access: string; refresh: string; expiresAt: number; refreshUntil: number };
type Options = {
  fetch?: typeof fetch;
  now?: () => number;
  credentials?: () => Credentials;
};

const API_ERROR_CODES = ["CONFIGURATION", "AUTH_FAILED", "INVALID_RESPONSE", "NETWORK", "TIMEOUT", "INVALID_PATH", "DISPOSED"] as const;
type ApiErrorCode = typeof API_ERROR_CODES[number];
export class OpenCreditApiError extends Error {
  constructor(readonly code: ApiErrorCode, readonly status?: number) {
    super(`OPENCREDIT_API_${code}`);
  }
}

/** Closed error contract across module loads. Never inspect raw exception data. */
export function readOpenCreditApiErrorCode(error: unknown): ApiErrorCode | null {
  try {
    if (!(error instanceof Error)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    const message = Object.getOwnPropertyDescriptor(error, "message");
    if (!descriptor || !("value" in descriptor) || !message || !("value" in message)) return null;
    const code = API_ERROR_CODES.find(candidate => candidate === descriptor.value);
    if (!code || message.value !== "OPENCREDIT_API_" + code) return null;
    const status = Object.getOwnPropertyDescriptor(error, "status");
    if (status) {
      if (!("value" in status) || status.value !== undefined && (typeof status.value !== "number"
        || !Number.isInteger(status.value) || status.value < 100 || status.value > 599)) return null;
    } else if ("status" in error) return null;
    return code;
  } catch { return null; }
}

function assertServer() {
  if (typeof window !== "undefined") throw new OpenCreditApiError("CONFIGURATION");
}

function envCredentials(): Credentials {
  return { email: process.env.OPENCREDIT_API_EMAIL ?? "", password: process.env.OPENCREDIT_API_PASSWORD ?? "" };
}

function validatedPath(path: string): void {
  try {
    // Configured IDs are restricted ASCII. Reject encoded/ambiguous paths rather
    // than allowing a provider/router to decode an auth alias or traversal later.
    if (typeof path !== "string" || /[%\\\u0000-\u0020\u007f]/.test(path)) throw Error();
    const url = new URL(path, ORIGIN);
    if (!path.startsWith("/api/") || url.origin !== ORIGIN
      || url.pathname !== path.split("?")[0] || url.hash || url.username || url.password
      || url.pathname.startsWith("/api/auth/")) throw Error();
  } catch { throw new OpenCreditApiError("INVALID_PATH"); }
}

/** Server-only partner account client. No Prisma, webhook binding, browser or logging. */
export function createOpenCreditApiClient(options: Options = {}) {
  assertServer();
  const transport = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const credentials = options.credentials ?? envCredentials;
  let tokens: Tokens | undefined;
  let fingerprint: string | undefined;
  let pending: Promise<Tokens> | undefined;
  let generation = 0;
  let disposed = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  function clear() {
    tokens = undefined;
    pending = undefined;
    generation++;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = undefined;
  }

  function touch() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(clear, IDLE_MS);
    idleTimer.unref();
  }

  function configuration() {
    assertServer();
    if (disposed) throw new OpenCreditApiError("DISPOSED");
    const value = credentials();
    if (!value.email.trim() || !value.password.trim()) {
      clear();
      throw new OpenCreditApiError("CONFIGURATION");
    }
    // Detect credential rotation without retaining another plaintext password.
    const key = createHash("sha256").update(JSON.stringify([value.email, value.password])).digest("hex");
    if (fingerprint !== key) { clear(); fingerprint = key; }
    touch();
    return value;
  }

  async function call(path: string, init: RequestInit, readAuth = false): Promise<Response | unknown> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 10_000);
    const cancel = () => abort.abort();
    if (init.signal?.aborted) abort.abort();
    init.signal?.addEventListener("abort", cancel, { once: true });
    try {
      const response = await transport(ORIGIN + path, { ...init, signal: abort.signal, redirect: "error", cache: "no-store", credentials: "omit" });
      if (!readAuth) return response;
      if (!response.ok) {
        await response.body?.cancel();
        throw new OpenCreditApiError("AUTH_FAILED", response.status);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new OpenCreditApiError("INVALID_RESPONSE");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > AUTH_BYTES) {
            await reader.cancel();
            throw new OpenCreditApiError("INVALID_RESPONSE");
          }
          chunks.push(value);
        }
        try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { throw new OpenCreditApiError("INVALID_RESPONSE"); }
      } finally { reader.releaseLock(); }
    } catch (error) {
      if (error instanceof OpenCreditApiError) throw error;
      // Never propagate provider payloads, URLs, headers or raw network exceptions.
      throw new OpenCreditApiError(abort.signal.aborted ? "TIMEOUT" : "NETWORK");
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener("abort", cancel);
    }
  }

  async function exchange(path: string, body: Credentials | { refreshToken: string }): Promise<Tokens> {
    const result = await call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, true);
    const data = (result as { data?: Partial<{ accessToken: unknown; refreshToken: unknown; expiresIn: unknown }> } | null)?.data;
    if (!data || typeof data.accessToken !== "string" || !/^[\x21-\x7e]+$/.test(data.accessToken)
      || typeof data.refreshToken !== "string" || !/^[\x21-\x7e]+$/.test(data.refreshToken)
      || typeof data.expiresIn !== "number" || !Number.isFinite(data.expiresIn) || data.expiresIn <= 0) {
      throw new OpenCreditApiError("INVALID_RESPONSE");
    }
    const ttl = Math.min(data.expiresIn * 1000, 8 * 60 * 60 * 1000);
    return { access: data.accessToken, refresh: data.refreshToken,
      expiresAt: now() + ttl - Math.min(60_000, ttl / 2), refreshUntil: now() + REFRESH_MS };
  }

  async function authenticate(rejected?: Tokens): Promise<Tokens> {
    const creds = configuration();
    // A concurrent 401 for an older generation must not rotate the new pair again.
    if (tokens && tokens !== rejected && tokens.expiresAt > now()) return tokens;
    if (pending) return pending;
    const version = generation;
    const previous = tokens;
    const operation = (async () => {
      let next: Tokens;
      if (previous && previous.refreshUntil > now()) {
        try { next = await exchange("/api/auth/refresh", { refreshToken: previous.refresh }); }
        catch (error) {
          // Only explicit authentication rejection warrants sending the password again.
          if (!(error instanceof OpenCreditApiError) || error.code !== "AUTH_FAILED" || ![401, 403].includes(error.status ?? 0)) throw error;
          next = await exchange("/api/auth/login", creds);
        }
      } else next = await exchange("/api/auth/login", creds);
      if (generation !== version || disposed) throw new OpenCreditApiError("DISPOSED");
      tokens = next;
      touch();
      return next;
    })();
    pending = operation;
    try { return await operation; }
    finally { if (pending === operation) pending = undefined; }
  }

  return {
    /** Auth and headers are ready before the callback. Resolving it is a committed
     * one-shot barrier: no auth, serialization, retry or response-body read follows. */
    async postJsonAfterCommit<T>(path: string, commit: () => Promise<{ body: string; committed: T }>): Promise<{ response: Response; committed: T }> {
      validatedPath(path);
      const pair = await authenticate();
      if (disposed) throw new OpenCreditApiError("DISPOSED");
      const headers = new Headers({ "Content-Type": "application/json", Authorization: `Bearer ${pair.access}` });
      const execution = await commit();
      const response = await call(path, { method: "POST", headers, body: execution.body }) as Response;
      if (response.status === 401 && tokens === pair) tokens.expiresAt = 0;
      return { response, committed: execution.committed };
    },
    async diagnoseAccess(tenant: string, partner: string) {
      assertServer();
      if (disposed) throw new OpenCreditApiError("DISPOSED");
      // Do not touch the normal cache, fingerprint, pending auth or idle timer.
      const creds = credentials();
      if (!configuredOpenCreditId(tenant) || !configuredOpenCreditId(partner)
        || !creds.email.trim() || !creds.password.trim()) throw new OpenCreditApiError("CONFIGURATION");
      const pair = await exchange("/api/auth/login", creds);
      const base = `/api/tenants/${encodeURIComponent(tenant)}/banks?`;
      const probe = async (query: URLSearchParams) => {
        if (disposed) throw new OpenCreditApiError("DISPOSED");
        try {
          const response = await call(base + query, {
            method: "GET", headers: { Authorization: `Bearer ${pair.access}` }
          }) as Response;
          // Never read or parse any probe body, even on success. Cancellation
          // must not delay the diagnostic if a provider stream stalls.
          void response.body?.cancel().catch(() => {});
          return { status: response.status,
            ...openCreditCorrelationIds(response.headers, [pair.access, pair.refresh, creds.email, creds.password]) };
        } catch (error) {
          return { error: error instanceof OpenCreditApiError && error.code === "TIMEOUT" ? "TIMEOUT" as const : "NETWORK" as const };
        }
      };
      const configured = await probe(new URLSearchParams({ product: "clt", partnerId: partner }));
      const missingPartnerId = await probe(new URLSearchParams({ product: "clt" }));
      const missingProduct = await probe(new URLSearchParams({ partnerId: partner }));
      if (disposed) throw new OpenCreditApiError("DISPOSED");
      return { ok: true as const, authentication: { ok: true as const },
        ...summarizeOpenCreditAccessToken(pair.access, tenant, partner, [pair.access, pair.refresh, creds.email, creds.password]),
        probes: { configured, missingPartnerId, missingProduct }
      };
    },
    async verifyCredentials(): Promise<void> {
      const creds = configuration();
      const version = generation;
      // Always test the current password, never cached access or refresh tokens.
      // Reuse bounded parsing/timeout protections and discard the returned pair.
      await exchange("/api/auth/login", creds);
      if (generation !== version || disposed) throw new OpenCreditApiError("DISPOSED");
    },
    async request(path: string, init: RequestInit = {}): Promise<Response> {
      // No external URL, auth-route bypass, cross-origin redirect or caller-controlled bearer.
      let url: URL;
      try { url = new URL(path, ORIGIN); }
      catch { throw new OpenCreditApiError("INVALID_PATH"); }
      if (!path.startsWith("/api/") || url.origin !== ORIGIN || url.pathname !== path.split("?")[0]
        || url.hash || url.username || url.password || url.pathname.startsWith("/api/auth/")) {
        throw new OpenCreditApiError("INVALID_PATH");
      }
      const method = (init.method ?? "GET").toUpperCase();
      const send = (pair: Tokens) => {
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${pair.access}`);
        return call(path, { ...init, method, headers }) as Promise<Response>;
      };
      const pair = await authenticate();
      const response = await send(pair);
      if (response.status !== 401) return response;
      if (tokens === pair) tokens.expiresAt = 0;
      const renewed = await authenticate(pair);
      // Never replay a potentially financial/non-idempotent operation automatically.
      if (method !== "GET" && method !== "HEAD") return response;
      await response.body?.cancel();
      const retry = await send(renewed);
      if (retry.status === 401 && tokens === renewed) clear();
      return retry;
    },
    dispose() { disposed = true; clear(); fingerprint = undefined; }
  };
}

// Lazy: importing this module does not log in, write data or make network calls.
export const openCreditApiClient = createOpenCreditApiClient();
