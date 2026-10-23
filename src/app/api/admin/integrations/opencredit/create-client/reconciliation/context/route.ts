import { getSessionFromRequest } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/permissions";
import { enforceRateLimits } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { createOpenCreditCreateClientReconciliationContextHandler } from "@/lib/opencredit-create-client-reconciliation-context-admin-handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createOpenCreditCreateClientReconciliationContextHandler({
  getSession: getSessionFromRequest, requirePlatformAdmin, enforceLimits: enforceRateLimits, db: prisma,
});
