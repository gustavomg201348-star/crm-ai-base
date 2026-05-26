import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/permissions";

const roles = ["ADMIN", "SUPERVISOR", "AGENT"] as const;

function isRole(value: unknown): value is (typeof roles)[number] {
  return typeof value === "string" && roles.includes(value as (typeof roles)[number]);
}

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }
    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as
      | {
          name?: string;
          email?: string;
          password?: string;
          role?: string;
        }
      | null;
    const name = body?.name?.trim();
    const email = body?.email?.trim().toLowerCase();

    if (!name || !email || !body?.password) {
      return NextResponse.json(
        { error: "Nome, email e senha sao obrigatorios." },
        { status: 400 }
      );
    }

    if (body.password.length < 6) {
      return NextResponse.json(
        { error: "A senha precisa ter pelo menos 6 caracteres." },
        { status: 400 }
      );
    }

    const user = await prisma.user.create({
      data: {
        companyId: session.companyId,
        name,
        email,
        passwordHash: hashPassword(body.password),
        role: isRole(body.role) ? body.role : "AGENT"
      },
      select: { id: true, name: true, email: true, role: true }
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel criar usuario. Confira se o email ja existe." },
      { status: 500 }
    );
  }
}
