import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireCompanyAdmin } from "@/lib/permissions";
import { isProposalStatus, mapProposal, proposalInclude } from "@/lib/proposals";

function toMoney(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;

  const normalized = value.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalString(value: unknown) {
  const text = readString(value);
  return text || null;
}

function toPositiveInt(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/\D/g, ""));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
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
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const { id } = await params;
    const current = await prisma.proposal.findFirst({
      where: { id, companyId: session.companyId }
    });

    if (!current) {
      return NextResponse.json({ error: "Proposta nao encontrada." }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as
        | {
          multicredClientId?: string | null;
          assignedUserId?: string | null;
          bank?: string;
          agreement?: string;
          product?: string;
          operation?: string;
          proposalNumber?: string;
          contractNumber?: string;
          amount?: string | number;
          financedAmount?: string | number;
          releasedAmount?: string | number;
          installmentAmount?: string | number;
          term?: string | number;
          commission?: string | number;
          commissionReceived?: string | number;
          notes?: string;
          status?: string;
        }
      | null;

    const amount = toMoney(body?.amount);
    const financedAmount = toMoney(body?.financedAmount);
    const releasedAmount = toMoney(body?.releasedAmount);
    const installmentAmount = toMoney(body?.installmentAmount);
    const commission = toMoney(body?.commission);
    const commissionReceived = toMoney(body?.commissionReceived);
    const term = toPositiveInt(body?.term);

    if (
      amount === null ||
      financedAmount === null ||
      releasedAmount === null ||
      installmentAmount === null ||
      commission === null ||
      commissionReceived === null ||
      term === null
    ) {
      return NextResponse.json(
        { error: "Valores, prazo e comissao precisam ser validos." },
        { status: 400 }
      );
    }

    if (body?.status !== undefined && !isProposalStatus(body.status)) {
      return NextResponse.json({ error: "Status invalido." }, { status: 400 });
    }

    const bank = body?.bank?.trim();
    const agreement = body?.agreement?.trim();
    const product = body?.product?.trim();
    const shouldUpdateMulticredClient = body && "multicredClientId" in body;
    const multicredClientId =
      typeof body?.multicredClientId === "string" ? body.multicredClientId.trim() : "";
    const shouldUpdateAssignedUser = body && "assignedUserId" in body;
    const assignedUserId =
      typeof body?.assignedUserId === "string" ? body.assignedUserId.trim() : "";

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

    const multicredClient = multicredClientId
      ? await prisma.multicredClient.findFirst({
          where: { id: multicredClientId, companyId: session.companyId }
        })
      : null;

    if (multicredClientId && !multicredClient) {
      return NextResponse.json(
        { error: "Cliente Multicred nao encontrado para esta empresa." },
        { status: 404 }
      );
    }

    const assignedUser = assignedUserId
      ? await prisma.user.findFirst({
          where: { id: assignedUserId, companyId: session.companyId }
        })
      : null;

    if (assignedUserId && !assignedUser) {
      return NextResponse.json(
        { error: "Responsavel nao encontrado para esta empresa." },
        { status: 404 }
      );
    }

    const proposal = await prisma.$transaction(async (tx) => {
      const updated = await tx.proposal.update({
        where: { id },
        data: {
          ...(shouldUpdateMulticredClient
            ? { multicredClientId: multicredClient?.id ?? null }
            : {}),
          ...(shouldUpdateAssignedUser
            ? { assignedUserId: assignedUser?.id ?? null }
            : {}),
          ...(bank !== undefined ? { bank } : {}),
          ...(agreement !== undefined ? { agreement } : {}),
          ...(product !== undefined ? { product } : {}),
          ...(body?.operation !== undefined
            ? { operation: readOptionalString(body.operation) }
            : {}),
          ...(body?.proposalNumber !== undefined
            ? { proposalNumber: readOptionalString(body.proposalNumber) }
            : {}),
          ...(body?.contractNumber !== undefined
            ? { contractNumber: readOptionalString(body.contractNumber) }
            : {}),
          ...(amount !== undefined ? { amount } : {}),
          ...(financedAmount !== undefined ? { financedAmount } : {}),
          ...(releasedAmount !== undefined ? { releasedAmount } : {}),
          ...(installmentAmount !== undefined ? { installmentAmount } : {}),
          ...(term !== undefined ? { term } : {}),
          ...(commission !== undefined ? { commission } : {}),
          ...(commissionReceived !== undefined ? { commissionReceived } : {}),
          ...(body?.notes !== undefined ? { notes: readOptionalString(body.notes) } : {}),
          ...(body?.status !== undefined ? { status: body.status } : {})
        },
        include: proposalInclude
      });

      const historyEvents = [];

      if (body?.status !== undefined && body.status !== current.status) {
        historyEvents.push({
          companyId: session.companyId,
          proposalId: id,
          userId: session.id,
          action: "STATUS_CHANGED",
          title: "Status alterado",
          detail: `${current.status} -> ${body.status}`
        });
      }

      if (shouldUpdateAssignedUser && assignedUser?.id !== current.assignedUserId) {
        historyEvents.push({
          companyId: session.companyId,
          proposalId: id,
          userId: session.id,
          action: "ASSIGNED",
          title: assignedUser ? "Responsavel atribuido" : "Responsavel removido",
          detail: assignedUser?.name ?? "Sem responsavel"
        });
      }

      if (bank !== undefined && bank !== current.bank) {
        historyEvents.push({
          companyId: session.companyId,
          proposalId: id,
          userId: session.id,
          action: "BANK_CHANGED",
          title: "Banco alterado",
          detail: `${current.bank} -> ${bank}`
        });
      }

      if (product !== undefined && product !== current.product) {
        historyEvents.push({
          companyId: session.companyId,
          proposalId: id,
          userId: session.id,
          action: "PRODUCT_CHANGED",
          title: "Produto alterado",
          detail: `${current.product} -> ${product}`
        });
      }

      if (historyEvents.length > 0) {
        await tx.proposalHistory.createMany({ data: historyEvents });
      }

      return updated;
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
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

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
