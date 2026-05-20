import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json({
      ok: true,
      database: "ok",
      service: "crm-ai-base",
      timestamp: new Date().toISOString()
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        database: "error",
        service: "crm-ai-base",
        timestamp: new Date().toISOString()
      },
      { status: 503 }
    );
  }
}
