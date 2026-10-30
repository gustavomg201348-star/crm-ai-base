import "server-only";
import { authenticatePassiveInbound, validatePassiveBinding, PassiveInboundError, type PassiveBinding, type PassiveReceipt } from "./opencredit-passive-inbound-contract";
import { OpenCreditDeadline, OpenCreditInputError, OPENCREDIT_MAX_BODY_BYTES } from "./opencredit-webhook-contract";
type Dependencies = {
  lookup(publicId: string): Promise<PassiveBinding | null>;
  secret(encrypted: string): string;
  limit(binding?: PassiveBinding): Promise<Response | null>;
  persist(receipt: PassiveReceipt, deadline: OpenCreditDeadline): Promise<{ duplicate: boolean }>;
  deadline?(): OpenCreditDeadline;
};
const reply = (status: number, code: string) => Response.json(status === 200 ? { ok: true } : { code }, { status, headers: { "Cache-Control": "no-store" } });
export function createPassiveInboundHandler(deps: Dependencies) {
  return async (request: Request, context: { params: Promise<{ publicWebhookId: string }> }) => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let complete = false;
    try {
      if (request.method !== "POST") return reply(405, "METHOD_NOT_ALLOWED");
      const deadline = deps.deadline?.() ?? new OpenCreditDeadline(3000);
      const { publicWebhookId } = await deadline.wait(() => context.params);
      if (!/^[a-f0-9]{48}(?![\s\S])/.test(publicWebhookId) || new URL(request.url).search) return reply(403, "INTEGRATION_UNAVAILABLE");
      const publicLimit = await deadline.wait(() => deps.limit());
      if (publicLimit) return reply(publicLimit.status === 429 ? 429 : 503, publicLimit.status === 429 ? "RATE_LIMITED" : "INGESTION_UNAVAILABLE");
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
      if (authenticatedLimit) return reply(authenticatedLimit.status === 429 ? 429 : 503, authenticatedLimit.status === 429 ? "RATE_LIMITED" : "INGESTION_UNAVAILABLE");
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
