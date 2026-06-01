import { NextResponse, type NextRequest } from "next/server";
import { createSessionToken, hashPassword, sessionCookie, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";

function isSeedPasswordResetAllowed(email: string, password: string) {
  const allowedEmails = (process.env.PLATFORM_ADMIN_EMAILS || "admin@crm.local")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  return (
    Boolean(process.env.SEED_ADMIN_PASSWORD) &&
    process.env.SEED_ADMIN_PASSWORD === password &&
    allowedEmails.includes(email.toLowerCase())
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { email?: string; password?: string }
      | null;

    if (!body?.email || !body?.password) {
      return NextResponse.json({ error: "Informe email e senha." }, { status: 400 });
    }

    let user = await prisma.user.findUnique({
      where: { email: body.email.toLowerCase().trim() },
      include: { company: true }
    });

    if (
      user &&
      user.role === "ADMIN" &&
      !verifyPassword(body.password, user.passwordHash) &&
      isSeedPasswordResetAllowed(user.email, body.password)
    ) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: hashPassword(body.password) },
        include: { company: true }
      });
    }

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
