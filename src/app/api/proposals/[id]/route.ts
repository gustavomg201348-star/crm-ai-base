import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isProposalStatus, mapProposal, proposalInclude } from "@/lib/proposals";

function toMoney(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;

  const normalized = value.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const { id } = await params;
    const current = await prisma.proposal.findFirst({
      where: { id, companyId: session.companyId }
    });

    if (!current) {
      return NextResponse.json({ error: "Proposta nao encontrada." }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as
      | {
          bank?: string;
          agreement?: string;
          product?: string;
          amount?: string | number;
          commission?: string | number;
          status?: string;
        }
      | null;

    const amount = toMoney(body?.amount);
    const commission = toMoney(body?.commission);

    if (amount === null || commission === null) {
      return NextResponse.json(
        { error: "Valor e comissao precisam ser numeros validos." },
        { status: 400 }
      );
    }

    if (body?.status !== undefined && !isProposalStatus(body.status)) {
      return NextResponse.json({ error: "Status invalido." }, { status: 400 });
    }

    const bank = body?.bank?.trim();
    const agreement = body?.agreement?.trim();
    const product = body?.product?.trim();

    if (
      (body?.bank !== undefined && !bank) ||
      (body?.agreement !== undefined && !agreement) ||
      (body?.product !== undefined && !product)
    ) {
      return NextResponse.json(
        { error: "Banco, convenio e produto nao podem ficar vazios." },
        { status: 400 }
      );
    }

    const proposal = await prisma.proposal.update({
      where: { id },
      data: {
        ...(bank !== undefined ? { bank } : {}),
        ...(agreement !== undefined ? { agreement } : {}),
        ...(product !== undefined ? { product } : {}),
        ...(amount !== undefined ? { amount } : {}),
        ...(commission !== undefined ? { commission } : {}),
        ...(body?.status !== undefined ? { status: body.status } : {})
      },
      include: proposalInclude
    });

    return NextResponse.json({ proposal: mapProposal(proposal) });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel atualizar proposta." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const { id } = await params;
    const current = await prisma.proposal.findFirst({
      where: { id, companyId: session.companyId }
    });

    if (!current) {
      return NextResponse.json({ error: "Proposta nao encontrada." }, { status: 404 });
    }

    await prisma.proposal.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel remover proposta." },
      { status: 500 }
    );
  }
}
