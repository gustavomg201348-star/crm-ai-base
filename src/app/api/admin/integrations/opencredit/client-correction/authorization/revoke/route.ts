import { getSessionFromRequest } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/permissions";
import { enforceRateLimits } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { createOpenCreditConsumerAuthorizationAdminHandler } from "@/lib/opencredit-consumer-authorization-admin-handler";
import { grantOpenCreditCorrectionAuthorization, revokeOpenCreditCorrectionAuthorization } from "@/lib/opencredit-consumer-authorization.service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createOpenCreditConsumerAuthorizationAdminHandler("revoke", { getSession: getSessionFromRequest, requirePlatformAdmin, enforceLimits: enforceRateLimits, db: prisma, grant: grantOpenCreditCorrectionAuthorization, revoke: revokeOpenCreditCorrectionAuthorization });
