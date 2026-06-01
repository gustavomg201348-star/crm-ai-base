import { NextResponse, type NextRequest } from "next/server";
import {
  confirmContactImport,
  type ImportPreviewRow
} from "@/lib/contact-import.service";
import { getSessionOrUnauthorized, requireCompanyAdmin } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { session, response } = getSessionOrUnauthorized(request);
    if (response) return response;

    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as
      | { rows?: ImportPreviewRow[] }
      | null;

    if (!Array.isArray(body?.rows) || !body.rows.length) {
      return NextResponse.json(
        { error: "Nenhuma linha valida para confirmar." },
        { status: 400 }
      );
    }

    const result = await confirmContactImport({
      companyId: session.companyId,
      userId: session.id,
      rows: body.rows
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel importar os contatos."
      },
      { status: 500 }
    );
  }
}
