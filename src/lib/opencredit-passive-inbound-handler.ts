import "server-only";
import { Prisma } from "@prisma/client";
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

type IngestionStage = "public_rate_limit" | "lookup" | "body" | "authenticated_rate_limit" | "persistence" | "internal";
type IngestionErrorClass = "limiter_unavailable" | "lookup_failed" | "body_read_failed"
  | "persistence_before_transaction" | "persistence_after_transaction_entry" | "deadline_exceeded" | "unexpected";
const ingestionPrismaCodes = ["P2002", "P2024", "P2028", "P2034"] as const;
type IngestionUnavailableEvent = {
  event: "opencredit_passive_ingestion_unavailable";
  stage: IngestionStage | "deadline";
  elapsedMs: number;
  remainingDeadlineMs: number;
  errorClass: IngestionErrorClass;
  prismaCode?: typeof ingestionPrismaCodes[number];
  waitingStage?: Exclude<IngestionStage, "internal">;
};

type Dependencies = {
  lookup(publicId: string): Promise<PassiveBinding | null>;
  secret(encrypted: string): string;
  limit(binding?: PassiveBinding): Promise<RateLimitDecision>;
  logRateLimit?(event: RateLimitEvent): void;
  logIngestionUnavailable?(event: IngestionUnavailableEvent): void | Promise<void>;
  persist(receipt: PassiveReceipt, deadline: OpenCreditDeadline, onTransactionEntry: (entered: boolean) => void): Promise<{ duplicate: boolean }>;
  deadline?(): OpenCreditDeadline;
};
const reply = (status: number, code: string, retryAfterSeconds?: number) => {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (retryAfterSeconds !== undefined) headers.set("Retry-After", String(retryAfterSeconds));
  return Response.json(status === 200 ? { ok: true } : { code }, { status, headers });
};

export function createPassiveInboundHandler(deps: Dependencies) {
  function rateLimitReply(decision: LimitedDecision, stage: RateLimitEvent["stage"]) {
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
    const startedAt = performance.now();
    let deadline: OpenCreditDeadline | undefined;
    let stage: IngestionStage = "internal";
    let enteredTransaction = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let complete = false;
    function unavailable(errorClass: IngestionErrorClass, error?: unknown) {
      const log = deps.logIngestionUnavailable;
      if (log) {
        const timedOut = errorClass === "deadline_exceeded";
        const prismaCode = error instanceof Prisma.PrismaClientKnownRequestError
          ? ingestionPrismaCodes.find(code => code === error.code)
          : undefined;
        const event: IngestionUnavailableEvent = {
          event: "opencredit_passive_ingestion_unavailable",
          stage: timedOut ? "deadline" : stage,
          elapsedMs: Math.floor(performance.now() - startedAt),
          remainingDeadlineMs: timedOut ? 0 : deadline?.remainingMs() ?? 0,
          errorClass,
          ...(prismaCode === undefined ? {} : { prismaCode }),
          ...(timedOut && stage !== "internal" ? { waitingStage: stage } : {}),
        };
        setImmediate(() => {
          void Promise.resolve().then(() => log(event)).catch(() => {});
        });
      }
      return reply(503, "INGESTION_UNAVAILABLE");
    }

    try {
      if (request.method !== "POST") return reply(405, "METHOD_NOT_ALLOWED");
      const budget = deps.deadline?.() ?? new OpenCreditDeadline(3000);
      deadline = budget;
      const { publicWebhookId } = await budget.wait(() => context.params);
      if (!/^[a-f0-9]{48}(?![\s\S])/.test(publicWebhookId) || new URL(request.url).search) return reply(403, "INTEGRATION_UNAVAILABLE");
      stage = "public_rate_limit";
      const publicLimit = await budget.wait(() => deps.limit());
      if (publicLimit.status === "unavailable") return unavailable("limiter_unavailable");
      if (publicLimit.status === "limited") return rateLimitReply(publicLimit, "public/global-ip");
      stage = "lookup";
      const binding = await budget.wait(() => deps.lookup(publicWebhookId));
      if (!binding) return reply(403, "INTEGRATION_UNAVAILABLE");
      stage = "internal";
      validatePassiveBinding(binding);
      let secret: string; try { secret = deps.secret(binding.webhookSecret); } catch { return reply(403, "INTEGRATION_UNAVAILABLE"); }
      if (!secret.trim()) return reply(403, "INTEGRATION_UNAVAILABLE");
      if (!/^application\/json(?:;\s*charset=utf-8)?(?![\s\S])/i.test(request.headers.get("content-type") ?? "") || ![null, "identity"].includes(request.headers.get("content-encoding"))) return reply(415, "UNSUPPORTED_CONTENT_TYPE");
      const length = request.headers.get("content-length");
      if (length !== null && (!/^\d+(?![\s\S])/.test(length) || Number(length) > OPENCREDIT_MAX_BODY_BYTES)) return reply(413, "PAYLOAD_TOO_LARGE");
      stage = "body";
      reader = request.body?.getReader(); if (!reader) return reply(400, "INVALID_JSON");
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const { value, done } = await budget.wait(() => reader!.read());
        if (done) { complete = true; break; }
        size += value.byteLength; if (size > OPENCREDIT_MAX_BODY_BYTES) return reply(413, "PAYLOAD_TOO_LARGE");
        if (value.byteLength) chunks.push(value);
      }
      stage = "internal";
      const receipt = authenticatePassiveInbound(Buffer.concat(chunks, size), request.headers.get("x-creditcore-sig"), secret, binding);
      stage = "authenticated_rate_limit";
      const authenticatedLimit = await budget.wait(() => deps.limit(binding));
      if (authenticatedLimit.status === "unavailable") return unavailable("limiter_unavailable");
      if (authenticatedLimit.status === "limited") return rateLimitReply(authenticatedLimit, "authenticated");
      stage = "persistence";
      await budget.wait(() => deps.persist(receipt, budget, entered => { enteredTransaction = entered; }));
      return reply(200, "OK");
    } catch (error) {
      if (error instanceof PassiveInboundError && error.status !== 503) {
        return reply(error.status, error.status === 403 ? "INTEGRATION_UNAVAILABLE" : error.code);
      }
      if (error instanceof OpenCreditInputError && error.code === "REQUEST_DEADLINE_EXCEEDED") {
        return unavailable("deadline_exceeded");
      }
      if (stage === "persistence") {
        return unavailable(enteredTransaction ? "persistence_after_transaction_entry" : "persistence_before_transaction", error);
      }
      if (stage === "lookup") return unavailable("lookup_failed", error);
      if (stage === "body") return unavailable("body_read_failed", error);
      return unavailable("unexpected", error);
    } finally {
      if (reader) { if (!complete) void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch { /* Pending cancel cannot delay response. */ } }
    }
  };
}
