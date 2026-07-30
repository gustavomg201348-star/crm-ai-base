import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { requireCompanyAdmin } from "@/lib/permissions";
import { isPrismaKnownRequestError } from "@/lib/prisma-errors";
import { safeLogError } from "@/lib/safe-logger";

const roles = ["ADMIN", "SUPERVISOR", "AGENT"] as const;

function isRole(value: unknown): value is (typeof roles)[number] {
  return typeof value === "string" && roles.includes(value as (typeof roles)[number]);
}

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
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
      return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
    }

    if (body.password.length < 6) {
      return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
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
  } catch (error) {
    const session = getSessionFromRequest(request);

    if (isPrismaKnownRequestError(error, "P2002")) {
      return publicErrorResponse({ code: "USER_DUPLICATE", status: 409 });
    }

    safeLogError("http-api", error, {
      route: "/api/settings/users",
      method: "POST",
      companyId: session?.companyId,
      currentUserId: session?.id,
      publicErrorCode: "USER_CREATE_FAILED",
      status: 500
    });

    return publicErrorResponse({ code: "USER_CREATE_FAILED", status: 500 });
  }
}
