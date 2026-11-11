import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/permissions";
import { enforceRateLimits } from "@/lib/rate-limit";
import { createMaterializationConfigurationHandler } from "@/lib/opencredit-materialization-configuration-handler";
import { finalizeOpenCreditSingleAdmission } from "@/lib/opencredit-materialization-single-admission.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createMaterializationConfigurationHandler({
  getSession: getSessionFromRequest,
  requirePlatformAdmin,
  enforceLimits: enforceRateLimits,
  db: prisma,
  finalizer: input => finalizeOpenCreditSingleAdmission(prisma, input),
});
