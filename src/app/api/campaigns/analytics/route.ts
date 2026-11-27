import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { requireCompanyAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { analyticsFilters } from "@/lib/campaign-analytics-policy";
import {
  campaignAnalytics,
  AnalyticsScopeError,
} from "@/lib/campaign-analytics.service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const actor = await getSessionFromRequest(request);
    if (!actor)
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    const denied = requireCompanyAdmin(actor);
    if (denied) return denied;
    let filters;
    try {
      filters = analyticsFilters(request.nextUrl.searchParams);
    } catch {
      return NextResponse.json({ error: "INVALID_FILTER" }, { status: 400 });
    }
    return NextResponse.json(
      await campaignAnalytics(prisma, actor.companyId, filters),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof AnalyticsScopeError
            ? "NOT_FOUND"
            : "ANALYTICS_UNAVAILABLE",
      },
      {
        status: error instanceof AnalyticsScopeError ? 404 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
