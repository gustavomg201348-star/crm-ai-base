import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/permissions";
import { enforceRateLimits } from "@/lib/rate-limit";
import { createOpenCreditMaterializationRolloutAdminHandler } from "@/lib/opencredit-materialization-rollout-admin-handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createOpenCreditMaterializationRolloutAdminHandler({
  getSession: getSessionFromRequest, requirePlatformAdmin, enforceLimits: enforceRateLimits, db: prisma,
});
