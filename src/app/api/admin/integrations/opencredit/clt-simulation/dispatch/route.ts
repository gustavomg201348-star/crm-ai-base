import { getSessionFromRequest } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/permissions";
import { enforceRateLimits } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { createCltSimulationHandler } from "@/lib/opencredit-clt-simulation-admin-handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createCltSimulationHandler("dispatch", { getSession: getSessionFromRequest, requirePlatformAdmin, enforceLimits: enforceRateLimits, db: prisma });
