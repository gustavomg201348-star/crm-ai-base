import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { mapCltLog } from "@/lib/clt-logs";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
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
        user: { select: { name: true } },
        contact: { select: { id: true, name: true, phone: true } }
      },
      orderBy: { createdAt: "desc" },
      take
    });

    return NextResponse.json({ logs: logs.map(mapCltLog) });
  } catch {
    return NextResponse.json({ logs: [], fallback: true });
  }
}
