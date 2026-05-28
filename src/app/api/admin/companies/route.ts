import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import {
  createTenantWithAdmin,
  listTenants
} from "@/lib/company-tenant.service";
import { requirePlatformAdmin } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }
    const blocked = requirePlatformAdmin(session);
    if (blocked) return blocked;

    return NextResponse.json({ companies: await listTenants() });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel carregar empresas." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }
    const blocked = requirePlatformAdmin(session);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as
      | {
          companyName?: string;
          companyEmail?: string;
          companyPhone?: string;
          segment?: string;
          adminName?: string;
          adminEmail?: string;
          adminPassword?: string;
        }
      | null;

    const companyName = body?.companyName?.trim();
    const adminName = body?.adminName?.trim();
    const adminEmail = body?.adminEmail?.trim().toLowerCase();
    const adminPassword = body?.adminPassword ?? "";

    if (!companyName || !adminName || !adminEmail || !adminPassword) {
      return NextResponse.json(
        { error: "Empresa, nome do admin, email e senha sao obrigatorios." },
        { status: 400 }
      );
    }

    if (adminPassword.length < 6) {
      return NextResponse.json(
        { error: "A senha precisa ter pelo menos 6 caracteres." },
        { status: 400 }
      );
    }

    const company = await createTenantWithAdmin({
      companyName,
      companyEmail: body?.companyEmail,
      companyPhone: body?.companyPhone,
      segment: body?.segment,
      adminName,
      adminEmail,
      adminPassword
    });

    return NextResponse.json({ company }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel criar empresa."
      },
      { status: 500 }
    );
  }
}
