import { NextResponse, type NextRequest } from "next/server";
import {
  createSessionToken,
  getSessionFromRequest,
  sessionCookie,
  type SessionUser
} from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ user: null }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.id },
      include: { company: true }
    });

    if (!user) {
      return NextResponse.json({ user: null }, { status: 401 });
    }

    const sessionUser: SessionUser = {
      id: user.id,
      companyId: user.companyId,
      name: user.name,
      email: user.email,
      role: user.role as "ADMIN" | "SUPERVISOR" | "AGENT"
    };

    const response = NextResponse.json({
      user: {
        id: sessionUser.id,
        companyId: sessionUser.companyId,
        name: sessionUser.name,
        email: sessionUser.email,
        role: sessionUser.role
      },
      company: {
        id: user.company.id,
        name: user.company.name,
        segment: user.company.segment
      }
    });

    if (
      session.companyId !== sessionUser.companyId ||
      session.role !== sessionUser.role ||
      session.name !== sessionUser.name
    ) {
      response.cookies.set(
        sessionCookie.name,
        createSessionToken(sessionUser),
        sessionCookie.options
      );
    }

    return response;
  } catch {
    return NextResponse.json({ user: null }, { status: 401 });
  }
}
