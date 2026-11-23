import * as XLSX from "xlsx";
import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/permissions";
import { neutralizeSpreadsheetFormula } from "@/lib/csv-export";
import { publicErrorResponse } from "@/lib/http-error-response";
import { safeLogError } from "@/lib/safe-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function clean(value: string | null | undefined) {
  return neutralizeSpreadsheetFormula(value ?? "");
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const from = parseDate(request.nextUrl.searchParams.get("from"));
    const to = parseDate(request.nextUrl.searchParams.get("to"));
    const reason = request.nextUrl.searchParams.get("reason")?.trim() ?? "";
    const assigneeId = request.nextUrl.searchParams.get("assigneeId")?.trim() ?? "";

    if (!from || !to || from >= to) {
      return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
    }

    if (assigneeId) {
      const assignee = await prisma.user.findFirst({
        where: { id: assigneeId, companyId: session.companyId },
        select: { id: true }
      });
      if (!assignee) return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
    }

    const title = reason ? `Retorno: ${reason}` : undefined;
    const tasks = await prisma.task.findMany({
      where: {
        companyId: session.companyId,
        dueAt: { gte: from, lt: to },
        ...(title ? { title } : {}),
        ...(assigneeId ? { assigneeId } : {})
      },
      include: {
        contact: { select: { id: true, name: true, cpf: true, phone: true } },
        assignee: { select: { name: true } }
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      take: 5000
    });

    const uniqueContacts = new Map<string, (typeof tasks)[number]>();
    for (const task of tasks) {
      if (!uniqueContacts.has(task.contact.id)) {
        uniqueContacts.set(task.contact.id, task);
      }
    }

    const rows = Array.from(uniqueContacts.values()).map((task) => ({
      Nome: clean(task.contact.name),
      CPF: clean(task.contact.cpf),
      Telefone: clean(task.contact.phone),
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet["!cols"] = [
      { wch: 34 },
      { wch: 16 },
      { wch: 18 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Virada de folha");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
    const bytes = Uint8Array.from(buffer).buffer;
    const date = new Date().toISOString().slice(0, 10);

    return new NextResponse(bytes, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="retornos-virada-folha-${date}.xlsx"`,
        "X-Content-Type-Options": "nosniff",
      }
    });
  } catch (error) {
    safeLogError("http-api", error, {
      route: "/api/tasks/export",
      method: "GET",
      publicErrorCode: "CONTACT_EXPORT_FAILED",
      status: 500
    });
    return publicErrorResponse({
      code: "CONTACT_EXPORT_FAILED",
      status: 500,
      message: "Nao foi possivel exportar os retornos."
    });
  }
}
