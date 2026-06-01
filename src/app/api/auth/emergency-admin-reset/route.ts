import { NextResponse, type NextRequest } from "next/server";
import { hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";

const TEMP_RESET_TOKEN = "reset-admin-2026-06-01-7f31d1b9";

export async function POST(request: NextRequest) {
  const token = request.headers.get("x-reset-token");

  if (token !== TEMP_RESET_TOKEN) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const user = await prisma.user.update({
    where: { email: "admin@crm.local" },
    data: { passwordHash: hashPassword("123456") },
    select: { id: true, email: true }
  });

  return NextResponse.json({ ok: true, user });
}
