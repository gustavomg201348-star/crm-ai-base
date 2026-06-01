import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { getSessionFromRequest } from "@/lib/auth";
import { createActivity } from "@/lib/activities";
import { prisma } from "@/lib/db";
import { requireCompanyAdmin } from "@/lib/permissions";
import {
  isProposalStatus,
  mapProposal,
  proposalInclude,
  type ProposalStatus
} from "@/lib/proposals";

function toMoney(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const normalized = value.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function buildProposalWhere(
  companyId: string,
  searchParams: NextRequest["nextUrl"]["searchParams"]
): Prisma.ProposalWhereInput {
  const search = searchParams.get("search")?.trim();
  const status = searchParams.get("status")?.trim();

  return {
    companyId,
    ...(status && isProposalStatus(status) ? { status } : {}),
    ...(search
      ? {
          OR: [
            { bank: { contains: search } },
            { agreement: { contains: search } },
            { product: { contains: search } },
            {
              contact: {
                OR: [
                  { name: { contains: search } },
                  { phone: { contains: search } },
                  { cpf: { contains: search } }
                ]
              }
            }
          ]
        }
      : {})
  };
}

function buildMetrics(proposals: Array<{ amount: Prisma.Decimal; commission: Prisma.Decimal; status: string }>) {
  const activeProposals = proposals.filter((proposal) => proposal.status !== "CANCELED");
  const paidProposals = proposals.filter((proposal) => proposal.status === "PAID");
  const formalizingProposals = proposals.filter((proposal) => proposal.status === "FORMALIZING");
  const totalAmount = activeProposals.reduce(
    (sum, proposal) => sum + proposal.amount.toNumber(),
    0
  );
  const commissionForecast = activeProposals.reduce(
    (sum, proposal) => sum + proposal.commission.toNumber(),
    0
  );

  return {
    count: activeProposals.length,
    totalAmount,
    paidAmount: paidProposals.reduce((sum, proposal) => sum + proposal.amount.toNumber(), 0),
    formalizingAmount: formalizingProposals.reduce(
      (sum, proposal) => sum + proposal.amount.toNumber(),
      0
    ),
    commissionForecast,
    ticketAverage: activeProposals.length ? totalAmount / activeProposals.length : 0
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const where = buildProposalWhere(session.companyId, request.nextUrl.searchParams);
    const proposals = await prisma.proposal.findMany({
      where,
      include: proposalInclude,
      orderBy: { createdAt: "desc" },
      take: 100
    });

    const metricRows = await prisma.proposal.findMany({
      where: { companyId: session.companyId },
      select: { amount: true, commission: true, status: true }
    });

    return NextResponse.json({
      proposals: proposals.map(mapProposal),
      metrics: buildMetrics(metricRows)
    });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel carregar propostas." },
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
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as
      | {
          contactId?: string;
          bank?: string;
          agreement?: string;
          product?: string;
          amount?: string | number;
          commission?: string | number;
          status?: ProposalStatus;
        }
      | null;

    const amount = toMoney(body?.amount);
    const commission = toMoney(body?.commission);
    const bank = body?.bank?.trim();
    const agreement = body?.agreement?.trim();
    const product = body?.product?.trim();

    if (!body?.contactId || !bank || !agreement || !product) {
      return NextResponse.json(
        { error: "Contato, banco, convenio e produto sao obrigatorios." },
        { status: 400 }
      );
    }

    if (amount === null || commission === null) {
      return NextResponse.json(
        { error: "Valor e comissao precisam ser numeros validos." },
        { status: 400 }
      );
    }

    const contact = await prisma.contact.findFirst({
      where: { id: body.contactId, companyId: session.companyId }
    });

    if (!contact) {
      return NextResponse.json({ error: "Contato nao encontrado." }, { status: 404 });
    }

    const proposalStage = await prisma.pipelineStage.findFirst({
      where: { companyId: session.companyId, name: { contains: "Proposta" } },
      orderBy: { position: "asc" }
    });

    const proposal = await prisma.$transaction(async (tx) => {
      const created = await tx.proposal.create({
        data: {
          companyId: session.companyId,
          contactId: contact.id,
          bank,
          agreement,
          product,
          amount,
          commission,
          status: isProposalStatus(body.status) ? body.status : "DRAFT"
        },
        include: proposalInclude
      });

      await tx.contact.update({
        where: { id: contact.id },
        data: {
          stageId: proposalStage?.id ?? contact.stageId,
          lastMessage: `Proposta ${created.product} criada no ${created.bank}.`
        }
      });

      await createActivity(tx, {
        contactId: contact.id,
        userId: session.id,
        type: "PROPOSAL_CREATED",
        title: "Proposta criada",
        detail: `${created.product} no ${created.bank} - ${created.amount.toString()}.`
      });

      return tx.proposal.findUniqueOrThrow({
        where: { id: created.id },
        include: proposalInclude
      });
    });

    return NextResponse.json({ proposal: mapProposal(proposal) }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel criar proposta." },
      { status: 500 }
    );
  }
}
