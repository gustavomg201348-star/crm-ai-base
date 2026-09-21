import { NextResponse, type NextRequest } from "next/server";
import {
  getAuthenticatedSessionFromRequest,
  type SessionUser
} from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const authenticated = await getAuthenticatedSessionFromRequest(request);
    const session = authenticated?.user;

    if (!session) {
      return NextResponse.json({ user: null }, { status: 401 });
    }

    const sessionUser: SessionUser = session;

    const response = NextResponse.json({
      user: {
        id: sessionUser.id,
        companyId: sessionUser.companyId,
        name: sessionUser.name,
        email: sessionUser.email,
        role: sessionUser.role
      },
      company: {
        id: authenticated.company.id,
        name: authenticated.company.name,
        segment: authenticated.company.segment
      }
    });

    return response;
  } catch {
    return NextResponse.json({ user: null }, { status: 401 });
  }
}
