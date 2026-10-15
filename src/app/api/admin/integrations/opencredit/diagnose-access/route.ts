import { getSessionFromRequest } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/permissions";
import { enforceRateLimits } from "@/lib/rate-limit";
import { createOpenCreditAccessDiagnosticHandler, createOpenCreditAccessDiagnosticService } from "@/lib/opencredit-access-diagnostic.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createOpenCreditAccessDiagnosticHandler({
  getSession: getSessionFromRequest, requirePlatformAdmin,
  enforceLimits: enforceRateLimits, diagnoseAccess: createOpenCreditAccessDiagnosticService()
});
