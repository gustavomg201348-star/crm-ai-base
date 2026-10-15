import { getSessionFromRequest } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/permissions";
import { enforceRateLimits } from "@/lib/rate-limit";
import { createOpenCreditStatusCatalogHandler, createOpenCreditStatusCatalogService } from "@/lib/opencredit-proposal-status.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createOpenCreditStatusCatalogHandler({
  getSession: getSessionFromRequest, requirePlatformAdmin, enforceLimits: enforceRateLimits,
  catalog: createOpenCreditStatusCatalogService()
});
