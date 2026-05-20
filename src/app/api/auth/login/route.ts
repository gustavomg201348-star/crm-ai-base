import { NextResponse, type NextRequest } from "next/server";
import { createSessionToken, sessionCookie, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { email?: string; password?: string }
      | null;

    if (!body?.email || !body?.password) {
      return NextResponse.json({ error: "Informe email e senha." }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email: body.email.toLowerCase().trim() },
      include: { company: true }
    });

    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      return NextResponse.json({ error: "Credenciais invalidas." }, { status: 401 });
    }

    const sessionUser = {
      id: user.id,
      companyId: user.companyId,
      name: user.name,
      email: user.email,
      role: user.role as "ADMIN" | "SUPERVISOR" | "AGENT"
    };

    const response = NextResponse.json({
      user: sessionUser,
      company: {
        id: user.company.id,
        name: user.company.name,
        segment: user.company.segment
      }
    });

    response.cookies.set(
      sessionCookie.name,
      createSessionToken(sessionUser),
      sessionCookie.options
    );

    return response;
  } catch {
    return NextResponse.json(
      { error: "Banco nao configurado. Confira DATABASE_URL e rode prisma:push." },
      { status: 500 }
    );
  }
}
