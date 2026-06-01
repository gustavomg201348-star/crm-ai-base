import { NextResponse, type NextRequest } from "next/server";
import { normalizeAiMode } from "@/lib/ai-attendant.service";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/permissions";

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const company = await prisma.company.findUnique({
      where: { id: session.companyId },
      select: { aiMode: true, aiInstructions: true }
    });

    return NextResponse.json({
      settings: {
        mode: normalizeAiMode(company?.aiMode),
        instructions: company?.aiInstructions ?? ""
      }
    });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel carregar configuracoes da IA." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const denied = requireAdmin(session);
    if (denied) return denied;

    const body = (await request.json().catch(() => null)) as
      | { mode?: string; instructions?: string }
      | null;

    const company = await prisma.company.update({
      where: { id: session.companyId },
      data: {
        aiMode: normalizeAiMode(body?.mode),
        aiInstructions: body?.instructions?.trim() || null
      },
      select: { aiMode: true, aiInstructions: true }
    });

    return NextResponse.json({
      settings: {
        mode: normalizeAiMode(company.aiMode),
        instructions: company.aiInstructions ?? ""
      }
    });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel salvar configuracoes da IA." },
      { status: 500 }
    );
  }
}
