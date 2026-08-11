import { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { requireAdmin } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutesFromTime(value: string) {
  const match = TIME_PATTERN.exec(value);
  if (!match) return null;

  return Number(match[1]) * 60 + Number(match[2]);
}

function readMoney(value: unknown) {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value) || value <= 0) return null;

  return new Prisma.Decimal(value.toFixed(2));
}

function mapSettings(company: {
  dailyRevenueGoal: Prisma.Decimal | null;
  businessDayStart: string | null;
  businessDayEnd: string | null;
}) {
  return {
    dailyRevenueGoal: company.dailyRevenueGoal?.toNumber() ?? null,
    businessDayStart: company.businessDayStart,
    businessDayEnd: company.businessDayEnd
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }

    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const company = await prisma.company.findUnique({
      where: { id: session.companyId },
      select: {
        dailyRevenueGoal: true,
        businessDayStart: true,
        businessDayEnd: true
      }
    });

    return NextResponse.json({
      settings: mapSettings({
        dailyRevenueGoal: company?.dailyRevenueGoal ?? null,
        businessDayStart: company?.businessDayStart ?? null,
        businessDayEnd: company?.businessDayEnd ?? null
      })
    });
  } catch (error) {
    const session = getSessionFromRequest(request);

    safeLogError("http-api", error, {
      route: "/api/settings/commercial-control",
      method: "GET",
      companyId: session?.companyId,
      currentUserId: session?.id,
      publicErrorCode: "INTERNAL_ERROR",
      status: 500
    });

    return publicErrorResponse({ code: "INTERNAL_ERROR", status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }

    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as
      | {
          dailyRevenueGoal?: unknown;
          businessDayStart?: unknown;
          businessDayEnd?: unknown;
        }
      | null;

    const dailyRevenueGoal = readMoney(body?.dailyRevenueGoal);
    const businessDayStart =
      typeof body?.businessDayStart === "string" ? body.businessDayStart.trim() : "";
    const businessDayEnd =
      typeof body?.businessDayEnd === "string" ? body.businessDayEnd.trim() : "";
    const startMinutes = minutesFromTime(businessDayStart);
    const endMinutes = minutesFromTime(businessDayEnd);

    if (!dailyRevenueGoal) {
      return publicErrorResponse({
        code: "INVALID_REQUEST",
        status: 400,
        message: "Informe uma meta diaria maior que zero."
      });
    }

    if (startMinutes === null || endMinutes === null) {
      return publicErrorResponse({
        code: "INVALID_REQUEST",
        status: 400,
        message: "Informe horarios validos no formato HH:mm."
      });
    }

    if (endMinutes <= startMinutes) {
      return publicErrorResponse({
        code: "INVALID_REQUEST",
        status: 400,
        message: "O fim do expediente precisa ser maior que o inicio."
      });
    }

    const company = await prisma.company.update({
      where: { id: session.companyId },
      data: {
        dailyRevenueGoal,
        businessDayStart,
        businessDayEnd
      },
      select: {
        dailyRevenueGoal: true,
        businessDayStart: true,
        businessDayEnd: true
      }
    });

    return NextResponse.json({ settings: mapSettings(company) });
  } catch (error) {
    const session = getSessionFromRequest(request);

    safeLogError("http-api", error, {
      route: "/api/settings/commercial-control",
      method: "PATCH",
      companyId: session?.companyId,
      currentUserId: session?.id,
      publicErrorCode: "INTERNAL_ERROR",
      status: 500
    });

    return publicErrorResponse({
      code: "INTERNAL_ERROR",
      status: 500
    });
  }
}
