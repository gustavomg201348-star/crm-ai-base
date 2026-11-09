import { NextResponse, type NextRequest } from "next/server";
import type { PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import { sameOrigin } from "./opencredit-admin-request";
import { readOpenCreditWhatsappBody } from "./opencredit-whatsapp-management-handler";
import type { createOpenCreditWhatsappBootstrap } from "./opencredit-whatsapp-bootstrap.service";
import type { RateLimitRule } from "./rate-limit";

const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export function createOpenCreditWhatsappCanary(deps: {
  db: Pick<PrismaClient, "user" | "conversation" | "openCreditLeadMaterialization">;
  getSession(request: NextRequest): Promise<SessionUser | null>;
  bootstrap: ReturnType<typeof createOpenCreditWhatsappBootstrap>;
  enforceLimits(rules: readonly RateLimitRule[]): Promise<Response | null>;
}) {
  return async (request: NextRequest, context: { params: Promise<{ conversationId: string }> }) => {
    try {
      const actor = await deps.getSession(request);
      if (!actor) return reply({ error: "UNAUTHENTICATED" }, 401);
      if (actor.role !== "ADMIN" || !await deps.db.user.findFirst({ where: {
        id: actor.id, companyId: actor.companyId, role: "ADMIN" }, select: { id: true } })) return reply({ error: "FORBIDDEN" }, 403);
      if (!sameOrigin(request)) return reply({ error: "INVALID_ORIGIN" }, 403);
      const { conversationId } = await context.params;
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(conversationId) || request.nextUrl.search || request.headers.has("authorization")) return reply({ error: "INVALID_REQUEST" }, 400);
      const body = await readOpenCreditWhatsappBody(request);
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) return reply({ error: "INVALID_REQUEST" }, 400);
      const limited = await deps.enforceLimits([{ category: "opencredit-whatsapp-admin", identifiers: [actor.companyId, actor.id], limit: 10, windowMs: 60000 }]);
      if (limited) {
        const r = reply({ error: limited.status === 429 ? "RATE_LIMITED" : "UNAVAILABLE" }, limited.status === 429 ? 429 : 503);
        const retry = limited.headers.get("retry-after");
        if (limited.status === 429 && retry && /^\d+$/.test(retry)) r.headers.set("Retry-After", retry);
        return r;
      }
      const source = await deps.db.conversation.findFirst({ where: { id: conversationId, contact: { companyId: actor.companyId },
        channel: "OPEN_CREDIT", channelRef: { companyId: actor.companyId, type: "OPEN_CREDIT", provider: "internal" } },
        select: { id: true, contactId: true, channelId: true } });
      if (!source) return reply({ error: "NOT_FOUND" }, 404);
      const jobs = await deps.db.openCreditLeadMaterialization.findMany({ where: { companyId: actor.companyId,
        conversationId: source.id, state: "COMPLETED" }, take: 2,
        select: { id: true, integrationId: true, contactId: true, channelId: true } });
      if (jobs.length !== 1 || jobs[0].contactId !== source.contactId || jobs[0].channelId !== source.channelId) return reply({ error: "IDENTITY_UNAVAILABLE" }, 409);
      return reply(await deps.bootstrap.bootstrap({ companyId: actor.companyId, integrationId: jobs[0].integrationId,
        jobId: jobs[0].id, trigger: "ADMIN_CANARY", adminUserId: actor.id, sourceConversationId: source.id }));
    } catch { return reply({ error: "UNAVAILABLE" }, 503); }
  };
}
