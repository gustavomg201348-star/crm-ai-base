import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { getSessionFromRequest } from "@/lib/auth";
import { contactInclude, mapContact } from "@/lib/contacts";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { requireAdmin } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";

function buildContactWhere(
  companyId: string,
  searchParams: NextRequest["nextUrl"]["searchParams"]
): Prisma.ContactWhereInput {
  const search = searchParams.get("search")?.trim();
  const status = searchParams.get("status") ?? "active";
  const originId = searchParams.get("originId") ?? "";
  const stageId = searchParams.get("stageId") ?? "";
  const ownerId = searchParams.get("ownerId") ?? "";
  const tagId = searchParams.get("tagId") ?? "";
  const temperature = searchParams.get("temperature") ?? "";

  return {
    companyId,
    archivedAt: status === "archived" ? { not: null } : null,
    ...(originId ? { originId } : {}),
    ...(stageId ? { stageId } : {}),
    ...(ownerId ? { ownerId } : {}),
    ...(tagId ? { tags: { some: { tagId } } } : {}),
    ...(temperature ? { temperature } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search } },
            { phone: { contains: search } },
            { email: { contains: search } },
            { cpf: { contains: search } }
          ]
        }
      : {})
  };
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }
    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const contacts = await prisma.contact.findMany({
      where: buildContactWhere(session.companyId, request.nextUrl.searchParams),
      include: contactInclude,
      orderBy: { updatedAt: "desc" },
      take: 5000
    });
    const rows = contacts.map(mapContact);
    const header = [
      "nome",
      "telefone",
      "cpf",
      "email",
      "origem",
      "etapa",
      "responsavel",
      "temperatura",
      "tags",
      "atualizado"
    ];
    const csv = [
      header.join(","),
      ...rows.map((contact) =>
        [
          contact.name,
          contact.phone,
          contact.cpf,
          contact.email,
          contact.origin,
          contact.stage,
          contact.owner,
          contact.temperature,
          contact.tags.map((tag) => tag.name).join("|"),
          contact.updatedAt
        ]
          .map(csvCell)
          .join(",")
      )
    ].join("\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="contatos-${new Date().toISOString().slice(0, 10)}.csv"`
      }
    });
  } catch (error) {
    safeLogError("http-api", error, {
      operation: "contacts-export",
      route: "/api/contacts/export",
      publicErrorCode: "CONTACT_EXPORT_FAILED",
      status: 500
    });

    return publicErrorResponse({
      code: "CONTACT_EXPORT_FAILED",
      status: 500,
      message: "Nao foi possivel exportar contatos."
    });
  }
}
