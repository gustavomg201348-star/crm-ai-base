import * as XLSX from "xlsx";
import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/permissions";
import { enforceRateLimits } from "@/lib/rate-limit";
import { sameOrigin, readOpenCreditAdminJson } from "@/lib/opencredit-admin-request";
import { resolveConfiguredOpenCreditProviderScope } from "@/lib/opencredit-provider-scope-resolver";
import { readOpenCreditMaterializationExport } from "@/lib/opencredit-materialization-export.service";
import { neutralizeSpreadsheetFormula } from "@/lib/csv-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: string) {
  return neutralizeSpreadsheetFormula(value);
}

export async function POST(request: NextRequest) {
  const actor = await getSessionFromRequest(request);
  if (!actor) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (requirePlatformAdmin(actor)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (!sameOrigin(request)) return NextResponse.json({ error: "INVALID_ORIGIN" }, { status: 403 });
  if (request.nextUrl.search || request.url.includes("?") || request.headers.has("authorization")
      || !/^application\/json(?:;\s*charset=utf-8)?(?![\s\S])/i.test(request.headers.get("content-type") ?? "")) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }

  let body: unknown;
  try { body = await readOpenCreditAdminJson(request); }
  catch { return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const value = body as Record<string, unknown>;
  const companyId = typeof value.companyId === "string" ? value.companyId : "";
  const integrationId = typeof value.integrationId === "string" ? value.integrationId : "";
  const days = value.days === 1 || value.days === 7 || value.days === 30 ? value.days : 7;
  if (!companyId || !integrationId) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

  const limited = await enforceRateLimits([
    { category: "opencredit-materialization-export-actor", identifiers: [actor.companyId, actor.id], limit: 5, windowMs: 60000 },
    { category: "opencredit-materialization-export-binding", identifiers: [companyId, integrationId], limit: 5, windowMs: 60000 },
  ]);
  if (limited) return NextResponse.json({ error: limited.status === 429 ? "RATE_LIMITED" : "UNAVAILABLE" }, { status: limited.status === 429 ? 429 : 503 });

  const providerScope = resolveConfiguredOpenCreditProviderScope();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await readOpenCreditMaterializationExport(prisma, { companyId, integrationId, providerScope, since });

  const worksheet = XLSX.utils.json_to_sheet(rows.map(row => ({
    "Recebido em": row.receivedAt,
    "Materializado em": row.createdAt,
    "Nome": text(row.name),
    "CPF": text(row.cpf),
    "Telefone": text(row.phone),
    "E-mail": text(row.email),
    "Status": text(row.state),
    "Revisao": text(row.reviewCode),
    "Ultimo erro": text(row.lastErrorCode),
    "Tentativas": row.attempts,
    "Contato criado": row.contactCreated,
    "Template": text(row.templateState),
    "Meta aceitou": row.providerAccepted,
  })));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "OpenCredit");
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="opencredit-materializados-${date}.xlsx"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
