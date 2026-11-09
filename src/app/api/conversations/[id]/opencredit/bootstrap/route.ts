import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth";
import { enforceRateLimits } from "@/lib/rate-limit";
import { openCreditWhatsappBootstrap } from "@/lib/opencredit-whatsapp-runtime";
import { createOpenCreditWhatsappCanary } from "@/lib/opencredit-whatsapp-canary-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const canary = createOpenCreditWhatsappCanary({ db: prisma, getSession: getSessionFromRequest,
  bootstrap: openCreditWhatsappBootstrap, enforceLimits: enforceRateLimits });

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return canary(request, { params: context.params.then(({ id }) => ({ conversationId: id })) });
}
