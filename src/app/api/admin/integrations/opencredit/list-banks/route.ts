import { getSessionFromRequest } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/permissions";
import { enforceRateLimits } from "@/lib/rate-limit";
import { createOpenCreditListBanksHandler, createOpenCreditListBanksService } from "@/lib/opencredit-list-banks.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createOpenCreditListBanksHandler({
  getSession: getSessionFromRequest, requirePlatformAdmin,
  enforceLimits: enforceRateLimits, listBanks: createOpenCreditListBanksService()
});
