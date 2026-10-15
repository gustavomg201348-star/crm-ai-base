import { getSessionFromRequest } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/permissions";
import { enforceRateLimits } from "@/lib/rate-limit";
import { createOpenCreditAuthenticationHandler, createOpenCreditAuthenticationService } from "@/lib/opencredit-authentication.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createOpenCreditAuthenticationHandler({
  getSession: getSessionFromRequest, requirePlatformAdmin,
  enforceLimits: enforceRateLimits, testAuthentication: createOpenCreditAuthenticationService()
});
