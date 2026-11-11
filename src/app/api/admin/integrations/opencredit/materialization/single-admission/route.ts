import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/permissions";
import { enforceRateLimits } from "@/lib/rate-limit";
import { createMaterializationConfigurationHandler } from "@/lib/opencredit-materialization-configuration-handler";
import { runOpenCreditSingleAdmission } from "@/lib/opencredit-materialization-single-admission.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createMaterializationConfigurationHandler({
  getSession: getSessionFromRequest,
  requirePlatformAdmin,
  enforceLimits: enforceRateLimits,
  db: prisma,
  pilot: input => runOpenCreditSingleAdmission(prisma, input, {
    async bootstrap(jobId) {
      const { bootstrapNewlyCompletedOpenCreditJob } = await import("@/lib/opencredit-whatsapp-runtime");
      return bootstrapNewlyCompletedOpenCreditJob(jobId);
    },
  }),
});
