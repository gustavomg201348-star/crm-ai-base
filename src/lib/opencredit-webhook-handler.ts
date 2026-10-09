import { NextResponse } from "next/server";
import { OpenCreditDeadline, OpenCreditInputError, OPENCREDIT_MAX_BODY_BYTES, parseOpenCreditAssignedLead, verifyOpenCreditSignature } from "@/lib/opencredit-webhook-contract";
import type { OpenCreditAssignedLead } from "@/lib/opencredit-webhook-contract";
import type { OpenCreditBinding } from "@/lib/opencredit-lead.service";

type Integration = OpenCreditBinding & { enabled: boolean; webhookSecret: string };
type Dependencies = {
  resolveIntegration(publicWebhookId: string): Promise<Integration | null>;
  resolveSecret(encrypted: string): string;
  ingest(binding: OpenCreditBinding, payload: OpenCreditAssignedLead, deadline: OpenCreditDeadline): Promise<{ duplicate: boolean }>;
  createDeadline?(): OpenCreditDeadline;
};

async function readBoundedBody(request: Request, deadline: OpenCreditDeadline) {
  const header = request.headers.get("content-length");
  if (header && (!/^\d+$/.test(header) || Number(header) > OPENCREDIT_MAX_BODY_BYTES)) {
    throw new OpenCreditInputError("PAYLOAD_TOO_LARGE", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new OpenCreditInputError("INVALID_PAYLOAD", 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await deadline.wait(() => reader.read());
      if (done) break;
      length += value.byteLength;
      if (length > OPENCREDIT_MAX_BODY_BYTES) {
        throw new OpenCreditInputError("PAYLOAD_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, length);
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
}

export function createOpenCreditWebhookHandler(deps: Dependencies) {
  return async (request: Request, context: { params: Promise<{ publicWebhookId: string }> }) => {
    try {
      const deadline = deps.createDeadline?.() ?? new OpenCreditDeadline();
      const { publicWebhookId } = await deadline.wait(() => context.params);
      if (!/^[a-f0-9]{48}$/.test(publicWebhookId)) {
        return NextResponse.json({ code: "INTEGRATION_UNAVAILABLE" }, { status: 403 });
      }
      const integration = await deadline.wait(() => deps.resolveIntegration(publicWebhookId));
      if (!integration?.enabled) {
        return NextResponse.json({ code: "INTEGRATION_UNAVAILABLE" }, { status: 403 });
      }
      let secret: string;
      try { secret = deps.resolveSecret(integration.webhookSecret); }
      catch { return NextResponse.json({ code: "INTEGRATION_UNAVAILABLE" }, { status: 403 }); }
      if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" ||
          !["identity", null].includes(request.headers.get("content-encoding"))) {
        throw new OpenCreditInputError("UNSUPPORTED_CONTENT_TYPE", 415);
      }
      const raw = await readBoundedBody(request, deadline);
      if (!verifyOpenCreditSignature(raw, request.headers.get("x-creditcore-sig"), secret)) {
        return NextResponse.json({ code: "INVALID_SIGNATURE" }, { status: 403 });
      }
      let json: unknown;
      try { json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
      catch { throw new OpenCreditInputError("INVALID_JSON", 400); }
      const payload = parseOpenCreditAssignedLead(json);
      deadline.assertRemaining();
      const result = await deps.ingest({ id: integration.id, companyId: integration.companyId }, payload, deadline);
      deadline.assertRemaining();
      return NextResponse.json({ ok: true, duplicate: result.duplicate });
    } catch (error) {
      if (error instanceof OpenCreditInputError) {
        return NextResponse.json({ code: error.code }, { status: error.status });
      }
      // Do not serialize/log Prisma messages, payloads, headers or credentials.
      return NextResponse.json({ code: "INGESTION_UNAVAILABLE" }, { status: 503 });
    }
  };
}
