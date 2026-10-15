import { getSessionFromRequest } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/permissions";
import { enforceRateLimits } from "@/lib/rate-limit";
import { createOpenCreditBankCapabilitiesHandler, createOpenCreditBankCapabilitiesService } from "@/lib/opencredit-bank-capabilities.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createOpenCreditBankCapabilitiesHandler({
  getSession: getSessionFromRequest, requirePlatformAdmin,
  enforceLimits: enforceRateLimits, bankCapabilities: createOpenCreditBankCapabilitiesService()
});
