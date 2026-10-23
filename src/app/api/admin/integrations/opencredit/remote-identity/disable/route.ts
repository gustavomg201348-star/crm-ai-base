import { getSessionFromRequest } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/permissions";
import { enforceRateLimits } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { createOpenCreditRemoteIdentityAdminHandler } from "@/lib/opencredit-remote-identity-admin-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createOpenCreditRemoteIdentityAdminHandler("disable", {
  getSession: getSessionFromRequest, requirePlatformAdmin, enforceLimits: enforceRateLimits, db: prisma,
});
