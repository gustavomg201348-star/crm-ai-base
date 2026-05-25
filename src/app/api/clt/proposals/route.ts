import { NextResponse, type NextRequest } from "next/server";
import { createActivity } from "@/lib/activities";
import { getSessionFromRequest } from "@/lib/auth";
import { createCltLog } from "@/lib/clt-logs";
import { onlyDigits, type CltCustomerData, type CltSimulationOffer } from "@/lib/clt-integration";
import { prisma } from "@/lib/db";
import { mapProposal, proposalInclude } from "@/lib/proposals";

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | {
          contactId?: string;
          customer?: CltCustomerData;
          offer?: CltSimulationOffer;
        }
      | null;

    if (!body?.customer || !body.offer) {
      return NextResponse.json(
        { error: "Dados do cliente e oferta sao obrigatorios." },
        { status: 400 }
      );
    }

    const customer = body.customer;
    const offer = body.offer;
    const phone = customer.phone?.trim();
    const cpf = onlyDigits(customer.cpf);

    if (!phone || !cpf) {
      return NextResponse.json(
        { error: "CPF e telefone sao obrigatorios para salvar proposta." },
        { status: 400 }
      );
    }

    const proposalStage = await prisma.pipelineStage.findFirst({
      where: { companyId: session.companyId, name: { contains: "Proposta" } },
      orderBy: { position: "asc" }
    });

    const proposal = await prisma.$transaction(async (tx) => {
      const existing =
        body.contactId
          ? await tx.contact.findFirst({
              where: { id: body.contactId, companyId: session.companyId }
            })
          : await tx.contact.findFirst({
              where: {
                companyId: session.companyId,
                OR: [{ cpf }, { phone }]
              }
            });

      const contact = existing
        ? await tx.contact.update({
            where: { id: existing.id },
            data: {
              name: customer.name,
              phone,
              cpf,
              stageId: proposalStage?.id ?? existing.stageId,
              lastMessage: `Simulacao CLT ${offer.bankName}: R$ ${offer.releasedAmount.toFixed(2)} liberado.`
            }
          })
        : await tx.contact.create({
            data: {
              companyId: session.companyId,
              ownerId: session.id,
              name: customer.name,
              phone,
              cpf,
              stageId: proposalStage?.id ?? null,
              temperature: "HOT",
              lastMessage: `Simulacao CLT ${offer.bankName}: R$ ${offer.releasedAmount.toFixed(2)} liberado.`
            }
          });

      const created = await tx.proposal.create({
        data: {
          companyId: session.companyId,
          contactId: contact.id,
          bank: offer.bankName,
          agreement: "CLT - Credito do Trabalhador",
          product: `${offer.product} - ${offer.tableName}`,
          amount: offer.releasedAmount,
          commission: 0,
          status: "DRAFT"
        },
        include: proposalInclude
      });

      await createActivity(tx, {
        contactId: contact.id,
        userId: session.id,
        type: "CLT_SIMULATION_PROPOSAL",
        title: "Proposta CLT criada",
        detail: `${offer.bankName} - ${offer.installments}x de R$ ${offer.installmentAmount.toFixed(2)} - liberado R$ ${offer.releasedAmount.toFixed(2)}.`
      });

      return created;
    });

    await createCltLog({
      companyId: session.companyId,
      userId: session.id,
      contactId: proposal.contactId,
      bankId: offer.bankId,
      bankName: offer.bankName,
      action: "PROPOSAL_CREATED",
      cpf,
      phone,
      message: `Proposta CLT criada no ${offer.bankName}.`,
      input: { customer, offer },
      output: { proposalId: proposal.id, amount: offer.releasedAmount }
    });

    return NextResponse.json({ proposal: mapProposal(proposal) }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel salvar proposta CLT." },
      { status: 500 }
    );
  }
}
