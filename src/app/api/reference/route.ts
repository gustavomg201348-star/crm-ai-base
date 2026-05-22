import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const [origins, stages, tags, users] = await Promise.all([
      prisma.origin.findMany({
        where: { companyId: session.companyId },
        orderBy: { name: "asc" }
      }),
      prisma.pipelineStage.findMany({
        where: { companyId: session.companyId },
        orderBy: { position: "asc" }
      }),
      prisma.tag.findMany({
        where: { companyId: session.companyId, isActive: true },
        orderBy: { name: "asc" }
      }),
      prisma.user.findMany({
        where: { companyId: session.companyId },
        orderBy: { name: "asc" },
        select: { id: true, name: true, email: true, role: true }
      })
    ]);

    return NextResponse.json({ origins, stages, tags, users });
  } catch {
    return NextResponse.json(
      { error: "Banco nao configurado. Confira DATABASE_URL." },
      { status: 500 }
    );
  }
}
