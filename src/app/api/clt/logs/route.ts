import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { mapCltLog } from "@/lib/clt-logs";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { safeLogError } from "@/lib/safe-logger";

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }

    const bankId = request.nextUrl.searchParams.get("bankId")?.trim();
    const status = request.nextUrl.searchParams.get("status")?.trim();
    const action = request.nextUrl.searchParams.get("action")?.trim();
    const take = Math.min(
      100,
      Math.max(10, Number(request.nextUrl.searchParams.get("take") ?? 50))
    );

    const logs = await prisma.cltSimulationLog.findMany({
      where: {
        companyId: session.companyId,
        ...(bankId ? { bankId } : {}),
        ...(status && status !== "ALL" ? { status } : {}),
        ...(action && action !== "ALL" ? { action } : {})
      },
      include: {
        contact: { select: { id: true } }
      },
      orderBy: { createdAt: "desc" },
      take
    });

    return NextResponse.json({ logs: logs.map(mapCltLog) });
  } catch (error) {
    const session = getSessionFromRequest(request);

    safeLogError("http-api", error, {
      route: "/api/clt/logs",
      method: "GET",
      companyId: session?.companyId,
      currentUserId: session?.id,
      publicErrorCode: "INTERNAL_ERROR",
      status: 200,
      fallback: true
    });

    return NextResponse.json({ logs: [], fallback: true });
  }
}
