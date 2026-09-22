import { NextResponse, type NextRequest } from "next/server";
import {
  getAuthenticatedSessionFromRequest,
  type SessionUser
} from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const authenticated = await getAuthenticatedSessionFromRequest(request);
    const session = authenticated?.user;

    if (!session) {
      return NextResponse.json({ user: null }, { status: 401 });
    }

    const sessionUser: SessionUser = session;
    const company = await prisma.company.findUnique({
      where: { id: sessionUser.companyId },
      select: { id: true, name: true, segment: true }
    });

    if (!company) {
      return NextResponse.json({ user: null }, { status: 401 });
    }

    const response = NextResponse.json({
      user: {
        id: sessionUser.id,
        companyId: sessionUser.companyId,
        name: sessionUser.name,
        email: sessionUser.email,
        role: sessionUser.role
      },
      company: {
        id: company.id,
        name: company.name,
        segment: company.segment
      }
    });

    return response;
  } catch {
    return NextResponse.json({ user: null }, { status: 401 });
  }
}
