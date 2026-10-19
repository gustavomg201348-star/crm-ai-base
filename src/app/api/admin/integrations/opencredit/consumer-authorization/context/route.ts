import { getSessionFromRequest } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/permissions";
import { enforceRateLimits } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { createOpenCreditConsumerAuthorizationContextHandler } from "@/lib/opencredit-consumer-authorization-context-admin-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createOpenCreditConsumerAuthorizationContextHandler({
  getSession: getSessionFromRequest, requirePlatformAdmin, enforceLimits: enforceRateLimits, db: prisma,
});
