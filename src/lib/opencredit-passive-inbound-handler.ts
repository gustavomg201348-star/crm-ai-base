import "server-only";
import { authenticatePassiveInbound, validatePassiveBinding, PassiveInboundError, type PassiveBinding, type PassiveReceipt } from "./opencredit-passive-inbound-contract";
import { OpenCreditDeadline, OpenCreditInputError, OPENCREDIT_MAX_BODY_BYTES } from "./opencredit-webhook-contract";
import type { RateLimitDecision } from "./rate-limit";

type LimitedDecision = Extract<RateLimitDecision, { status: "limited" }>;
type RateLimitEvent = Omit<LimitedDecision, "status" | "windowStart" | "expiresAt"> & {
  event: "opencredit_passive_rate_limited";
  stage: "public/global-ip" | "authenticated";
  windowStart: string;
  expiresAt: string;
};

type Dependencies = {
  lookup(publicId: string): Promise<PassiveBinding | null>;
  secret(encrypted: string): string;
  limit(binding?: PassiveBinding): Promise<RateLimitDecision>;
  logRateLimit?(event: RateLimitEvent): void;
  persist(receipt: PassiveReceipt, deadline: OpenCreditDeadline): Promise<{ duplicate: boolean }>;
  deadline?(): OpenCreditDeadline;
};
const reply = (status: number, code: string, retryAfterSeconds?: number) => {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (retryAfterSeconds !== undefined) headers.set("Retry-After", String(retryAfterSeconds));
  return Response.json(status === 200 ? { ok: true } : { code }, { status, headers });
};

export function createPassiveInboundHandler(deps: Dependencies) {
  function rateLimitReply(decision: Exclude<RateLimitDecision, { status: "allowed" }>, stage: RateLimitEvent["stage"]) {
    if (decision.status === "unavailable") return reply(503, "INGESTION_UNAVAILABLE");
    const log = deps.logRateLimit;
    if (log) {
      setImmediate(() => {
        try {
          log({
            event: "opencredit_passive_rate_limited",
            category: decision.category,
            stage,
            limit: decision.limit,
            count: decision.count,
            windowStart: decision.windowStart.toISOString(),
            expiresAt: decision.expiresAt.toISOString(),
            retryAfterSeconds: decision.retryAfterSeconds,
            bucketRef: decision.bucketRef,
          });
        } catch {
          // Telemetry must not change the HTTP decision.
        }
      });
    }
    return reply(429, "RATE_LIMITED", decision.retryAfterSeconds);
  }

  return async (request: Request, context: { params: Promise<{ publicWebhookId: string }> }) => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let complete = false;
    try {
      if (request.method !== "POST") return reply(405, "METHOD_NOT_ALLOWED");
      const deadline = deps.deadline?.() ?? new OpenCreditDeadline(3000);
      const { publicWebhookId } = await deadline.wait(() => context.params);
      if (!/^[a-f0-9]{48}(?![\s\S])/.test(publicWebhookId) || new URL(request.url).search) return reply(403, "INTEGRATION_UNAVAILABLE");
      const publicLimit = await deadline.wait(() => deps.limit());
      if (publicLimit.status !== "allowed") return rateLimitReply(publicLimit, "public/global-ip");
      const binding = await deadline.wait(() => deps.lookup(publicWebhookId));
      if (!binding) return reply(403, "INTEGRATION_UNAVAILABLE");
      validatePassiveBinding(binding);
      let secret: string; try { secret = deps.secret(binding.webhookSecret); } catch { return reply(403, "INTEGRATION_UNAVAILABLE"); }
      if (!secret.trim()) return reply(403, "INTEGRATION_UNAVAILABLE");
      if (!/^application\/json(?:;\s*charset=utf-8)?(?![\s\S])/i.test(request.headers.get("content-type") ?? "") || ![null, "identity"].includes(request.headers.get("content-encoding"))) return reply(415, "UNSUPPORTED_CONTENT_TYPE");
      const length = request.headers.get("content-length");
      if (length !== null && (!/^\d+(?![\s\S])/.test(length) || Number(length) > OPENCREDIT_MAX_BODY_BYTES)) return reply(413, "PAYLOAD_TOO_LARGE");
      reader = request.body?.getReader(); if (!reader) return reply(400, "INVALID_JSON");
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const { value, done } = await deadline.wait(() => reader!.read());
        if (done) { complete = true; break; }
        size += value.byteLength; if (size > OPENCREDIT_MAX_BODY_BYTES) return reply(413, "PAYLOAD_TOO_LARGE");
        if (value.byteLength) chunks.push(value);
      }
      const receipt = authenticatePassiveInbound(Buffer.concat(chunks, size), request.headers.get("x-creditcore-sig"), secret, binding);
      const authenticatedLimit = await deadline.wait(() => deps.limit(binding));
      if (authenticatedLimit.status !== "allowed") return rateLimitReply(authenticatedLimit, "authenticated");
      await deadline.wait(() => deps.persist(receipt, deadline));
      return reply(200, "OK");
    } catch (error) {
      if (error instanceof PassiveInboundError) return reply(error.status, error.status === 403 ? "INTEGRATION_UNAVAILABLE" : error.code);
      if (error instanceof OpenCreditInputError) return reply(503, "INGESTION_UNAVAILABLE");
      return reply(503, "INGESTION_UNAVAILABLE");
    } finally {
      if (reader) { if (!complete) void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch { /* Pending cancel cannot delay response. */ } }
    }
  };
}
