import { getSessionFromRequest } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/permissions";
import { enforceRateLimits } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { createOpenCreditCommercialAccessAdminHandler } from "@/lib/opencredit-commercial-access-admin-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createOpenCreditCommercialAccessAdminHandler("grant", {
  getSession: getSessionFromRequest, requirePlatformAdmin, enforceLimits: enforceRateLimits, db: prisma,
});
