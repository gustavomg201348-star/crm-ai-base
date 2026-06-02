import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { requireCompanyAdmin } from "@/lib/permissions";
import { validateMetaWhatsAppCredentials } from "@/lib/meta-whatsapp-diagnostics";

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as
      | {
          accessToken?: string;
          wabaId?: string;
          phoneNumberId?: string;
        }
      | null;

    const diagnostics = await validateMetaWhatsAppCredentials({
      accessToken: body?.accessToken,
      wabaId: body?.wabaId,
      phoneNumberId: body?.phoneNumberId
    });

    return NextResponse.json({ diagnostics });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel validar a integracao Meta." },
      { status: 500 }
    );
  }
}
