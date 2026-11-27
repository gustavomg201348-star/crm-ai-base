import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { requireCompanyAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { analyticsFilters } from "@/lib/campaign-analytics-policy";
import {
  campaignAnalytics,
  AnalyticsScopeError,
} from "@/lib/campaign-analytics.service";
import { serializeCsvCell } from "@/lib/csv-export";
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
    const data = await campaignAnalytics(
      prisma,
      actor.companyId,
      filters,
      "export",
    );
    const exportRows = data.rows;
    if (!exportRows) throw Error("INVALID_RESULT");
    const fields = [
      "campaignName",
      "contactName",
      "phone",
      "channelName",
      "templateName",
      "status",
      "sentAt",
      "deliveredAt",
      "readAt",
      "officialRead",
      "identifiedRead",
      "clickEvents",
      "textEvents",
      "lastButton",
      "lastInteractionAt",
    ];
    const rows = [
      fields,
      ...exportRows.map((raw) => {
        const row = raw as Record<string, unknown>;
        return fields.map((field) => String(row[field] ?? ""));
      }),
    ];
    const csv =
      "\uFEFF" +
      rows
        .map((row) =>
          row
            .map((value) => serializeCsvCell(value, { delimiter: ";" }))
            .join(";"),
        )
        .join("\r\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="campaign-analytics-v1.csv"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const code =
      error instanceof AnalyticsScopeError
        ? "NOT_FOUND"
        : error instanceof Error && error.message === "EXPORT_LIMIT"
          ? "EXPORT_LIMIT"
          : "ANALYTICS_UNAVAILABLE";
    return NextResponse.json(
      { error: code },
      {
        status:
          code === "NOT_FOUND" ? 404 : code === "EXPORT_LIMIT" ? 409 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
