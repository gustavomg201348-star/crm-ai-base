import { getSessionFromRequest } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/permissions";
import { enforceRateLimits } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { createOpenCreditClientValidationHandler } from "@/lib/opencredit-client-validation-admin-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createOpenCreditClientValidationHandler({
  getSession: getSessionFromRequest, requirePlatformAdmin, enforceLimits: enforceRateLimits, db: prisma,
});
