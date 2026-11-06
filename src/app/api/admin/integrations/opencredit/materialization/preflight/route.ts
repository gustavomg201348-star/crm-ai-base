import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createOpenCreditMaterializationPreflightHandler } from "@/lib/opencredit-materialization-preflight-admin-handler";
import { requirePlatformAdmin } from "@/lib/permissions";
import { enforceRateLimits } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createOpenCreditMaterializationPreflightHandler({
  getSession: getSessionFromRequest,
  requirePlatformAdmin,
  enforceLimits: enforceRateLimits,
  db: prisma,
});
