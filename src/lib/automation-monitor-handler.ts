import { NextResponse, type NextRequest } from "next/server";
import { getSessionOrUnauthorized, requireCompanyAdmin } from "./permissions";
import { prisma } from "./db";
import {
  readAutomationMonitor,
  readDistributionMonitor,
  readOpenCreditMonitor,
} from "./automation-monitor.service";
export function monitorHandler(
  kind: "overview" | "distribution" | "opencredit",
) {
  return async (request: NextRequest) => {
    const { session, response } = await getSessionOrUnauthorized(request);
    if (response) return response;
    const denied = requireCompanyAdmin(session);
    if (denied) return denied;
    try {
      const data =
        kind === "overview"
          ? await readAutomationMonitor(prisma, session.companyId)
          : kind === "distribution"
            ? await readDistributionMonitor(prisma, session.companyId)
            : await readOpenCreditMonitor(
                prisma,
                session.companyId,
                request.nextUrl.searchParams,
              );
      return NextResponse.json(data, {
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (error) {
      const code =
        error instanceof Error &&
        ["INVALID_FILTER", "NOT_FOUND"].includes(error.message)
          ? error.message
          : "MONITOR_UNAVAILABLE";
      return NextResponse.json(
        { error: code },
        {
          status:
            code === "INVALID_FILTER" ? 400 : code === "NOT_FOUND" ? 404 : 503,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
  };
}
