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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const { id } = await params;
    const current = await prisma.user.findFirst({
      where: { id, companyId: session.companyId }
    });

    if (!current) {
      return publicErrorResponse({ code: "USER_NOT_FOUND", status: 404 });
    }

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

    if (body?.name !== undefined && !name) {
      return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
    }

    if (body?.email !== undefined && !email) {
      return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
    }

    if (body?.password !== undefined && body.password && body.password.length < 6) {
      return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
    }

    if (body?.role !== undefined && !isRole(body.role)) {
      return publicErrorResponse({ code: "USER_INVALID_ROLE", status: 400 });
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(body?.role !== undefined ? { role: body.role } : {}),
        ...(body?.password ? { passwordHash: hashPassword(body.password) } : {})
      },
      select: { id: true, name: true, email: true, role: true }
    });

    return NextResponse.json({ user });
  } catch (error) {
    const session = getSessionFromRequest(request);
    const { id } = await params;

    if (isPrismaKnownRequestError(error, "P2002")) {
      return publicErrorResponse({ code: "USER_DUPLICATE", status: 409 });
    }

    if (isPrismaKnownRequestError(error, "P2025")) {
      return publicErrorResponse({ code: "USER_NOT_FOUND", status: 404 });
    }

    safeLogError("http-api", error, {
      route: "/api/settings/users/[id]",
      method: "PATCH",
      companyId: session?.companyId,
      currentUserId: session?.id,
      targetUserId: id,
      publicErrorCode: "USER_UPDATE_FAILED",
      status: 500
    });

    return publicErrorResponse({ code: "USER_UPDATE_FAILED", status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const { id } = await params;

    if (id === session.id) {
      return publicErrorResponse({ code: "USER_PERMISSION_DENIED", status: 403 });
    }

    const current = await prisma.user.findFirst({
      where: { id, companyId: session.companyId }
    });

    if (!current) {
      return publicErrorResponse({ code: "USER_NOT_FOUND", status: 404 });
    }

    await prisma.user.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const session = getSessionFromRequest(request);
    const { id } = await params;

    if (isPrismaKnownRequestError(error, "P2025")) {
      return publicErrorResponse({ code: "USER_NOT_FOUND", status: 404 });
    }

    safeLogError("http-api", error, {
      route: "/api/settings/users/[id]",
      method: "DELETE",
      companyId: session?.companyId,
      currentUserId: session?.id,
      targetUserId: id,
      publicErrorCode: "USER_DELETE_FAILED",
      status: 500
    });

    return publicErrorResponse({ code: "USER_DELETE_FAILED", status: 500 });
  }
}
