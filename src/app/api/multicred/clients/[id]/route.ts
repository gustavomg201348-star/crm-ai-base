import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import {
  buildMulticredClientPatchData,
  isValidCpf,
  mapMulticredClientDetail,
  multicredClientDetailInclude,
  readString
} from "@/lib/multicred-clients";
import { requireCompanyAdmin } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const { id } = await context.params;
    const client = await prisma.multicredClient.findFirst({
      where: { id, companyId: session.companyId },
      include: multicredClientDetailInclude
    });

    if (!client) {
      return publicErrorResponse({ code: "MULTICRED_CLIENT_NOT_FOUND", status: 404 });
    }

    return NextResponse.json({ client: mapMulticredClientDetail(client) });
  } catch (error) {
    safeLogError("http-api", error, {
      route: "/api/multicred/clients/[id]",
      method: "GET",
      publicErrorCode: "MULTICRED_CLIENT_FETCH_FAILED",
      status: 500
    });

    return publicErrorResponse({ code: "MULTICRED_CLIENT_FETCH_FAILED", status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const { id } = await context.params;
    const current = await prisma.multicredClient.findFirst({
      where: { id, companyId: session.companyId }
    });

    if (!current) {
      return publicErrorResponse({ code: "MULTICRED_CLIENT_NOT_FOUND", status: 404 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
    }

    const data = buildMulticredClientPatchData(body);
    const contactId = "contactId" in body ? readString(body.contactId) : undefined;

    if ("name" in data && !data.name) {
      return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
    }

    if ("cpf" in data) {
      if (!isValidCpf(String(data.cpf ?? ""))) {
        return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
      }

      const duplicated = await prisma.multicredClient.findFirst({
        where: {
          companyId: session.companyId,
          cpf: String(data.cpf),
          NOT: { id }
        }
      });

      if (duplicated) {
        return publicErrorResponse({ code: "CONFLICT", status: 409 });
      }
    }

    if (contactId !== undefined) {
      if (contactId) {
        const contact = await prisma.contact.findFirst({
          where: { id: contactId, companyId: session.companyId }
        });

        if (!contact) {
          return publicErrorResponse({ code: "CONTACT_NOT_FOUND", status: 404 });
        }
      }

      data.contactId = contactId || null;
    }

    const client = await prisma.multicredClient.update({
      where: { id: current.id },
      data,
      include: multicredClientDetailInclude
    });

    return NextResponse.json({ client: mapMulticredClientDetail(client) });
  } catch (error) {
    safeLogError("http-api", error, {
      route: "/api/multicred/clients/[id]",
      method: "PATCH",
      publicErrorCode: "MULTICRED_CLIENT_UPDATE_FAILED",
      status: 500
    });

    return publicErrorResponse({ code: "MULTICRED_CLIENT_UPDATE_FAILED", status: 500 });
  }
}
