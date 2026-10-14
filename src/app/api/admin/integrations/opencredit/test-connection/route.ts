import { getSessionFromRequest } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/permissions";
import { enforceRateLimits } from "@/lib/rate-limit";
import { createOpenCreditConnectionHandler, createOpenCreditConnectionService } from "@/lib/opencredit-connection.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createOpenCreditConnectionHandler({
  getSession: getSessionFromRequest, requirePlatformAdmin,
  enforceLimits: enforceRateLimits, testConnection: createOpenCreditConnectionService()
});
