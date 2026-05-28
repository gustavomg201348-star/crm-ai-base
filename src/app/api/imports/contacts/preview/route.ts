import { NextResponse, type NextRequest } from "next/server";
import { buildContactImportPreview } from "@/lib/contact-import.service";
import { getSessionOrUnauthorized, requireAdmin } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { session, response } = getSessionOrUnauthorized(request);
    if (response) return response;

    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: "Envie uma planilha CSV ou Excel .xlsx." },
        { status: 400 }
      );
    }

    const preview = await buildContactImportPreview({
      companyId: session.companyId,
      file
    });

    return NextResponse.json(preview);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel validar a planilha."
      },
      { status: 400 }
    );
  }
}
