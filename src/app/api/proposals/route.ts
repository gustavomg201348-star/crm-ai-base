import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { getSessionFromRequest } from "@/lib/auth";
import { createActivity } from "@/lib/activities";
import { getContactNormalizedPhone } from "@/lib/contacts";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { requireCompanyAdmin } from "@/lib/permissions";
import {
  isPrismaUniqueViolation,
  isPrismaUniqueViolationForTarget
} from "@/lib/prisma-errors";
import { safeLogError } from "@/lib/safe-logger";
import {
  isProposalStatus,
  mapProposal,
  proposalInclude,
  type ProposalStatus
} from "@/lib/proposals";

function toMoney(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
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

function normalizePhone(value?: string | null) {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (!digits) return null;
  if (digits.startsWith("55")) return digits;
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;
  return digits;
}

function parsePeriodRange(period?: string | null, from?: string | null, to?: string | null) {
  const now = new Date();
  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const endOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

  if (period === "today") {
    return { gte: startOfDay(now), lte: endOfDay(now) };
  }

  if (period === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    return { gte: startOfDay(yesterday), lte: endOfDay(yesterday) };
  }

  if (period === "7d" || period === "30d") {
    const start = startOfDay(now);
    start.setDate(now.getDate() - (period === "7d" ? 6 : 29));
    return { gte: start, lte: endOfDay(now) };
  }

  if (period === "custom") {
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    return {
      ...(fromDate && !Number.isNaN(fromDate.getTime()) ? { gte: startOfDay(fromDate) } : {}),
      ...(toDate && !Number.isNaN(toDate.getTime()) ? { lte: endOfDay(toDate) } : {})
    };
  }

  return undefined;
}

function buildOrderBy(
  searchParams: NextRequest["nextUrl"]["searchParams"]
): Prisma.ProposalOrderByWithRelationInput {
  const sort = searchParams.get("sort") ?? "date";
  const direction = searchParams.get("direction") === "asc" ? "asc" : "desc";

  if (sort === "value") return { releasedAmount: direction };
  if (sort === "bank") return { bank: direction };
  if (sort === "product") return { product: direction };
  if (sort === "status") return { status: direction };
  return { createdAt: direction };
}

function buildProposalWhere(
  companyId: string,
  searchParams: NextRequest["nextUrl"]["searchParams"]
): Prisma.ProposalWhereInput {
  const search = searchParams.get("search")?.trim();
  const status = searchParams.get("status")?.trim();
  const product = searchParams.get("product")?.trim();
  const bank = searchParams.get("bank")?.trim();
  const assignedUserId = searchParams.get("assignedUserId")?.trim();
  const createdAt = parsePeriodRange(
    searchParams.get("period"),
    searchParams.get("from"),
    searchParams.get("to")
  );

  return {
    companyId,
    ...(status && isProposalStatus(status) ? { status } : {}),
    ...(product ? { product: { contains: product } } : {}),
    ...(bank ? { bank: { contains: bank } } : {}),
    ...(assignedUserId ? { assignedUserId } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(search
      ? {
          OR: [
            { bank: { contains: search } },
            { agreement: { contains: search } },
            { product: { contains: search } },
            {
              multicredClient: {
                OR: [
                  { name: { contains: search } },
                  { cpf: { contains: search } },
                  { phone: { contains: search } },
                  { whatsapp: { contains: search } }
                ]
              }
            },
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

function buildMetrics(
  proposals: Array<{
    amount: Prisma.Decimal;
    releasedAmount: Prisma.Decimal | null;
    commission: Prisma.Decimal;
    commissionReceived: Prisma.Decimal | null;
    status: string;
    bank: string;
    product: string;
    assignedUserId: string | null;
  }>
) {
  const activeProposals = proposals.filter((proposal) => proposal.status !== "CANCELED");
  const paidProposals = proposals.filter((proposal) => proposal.status === "PAID");
  const analysisProposals = proposals.filter((proposal) =>
    ["ANALYSIS", "FORMALIZING"].includes(proposal.status)
  );
  const pendingProposals = proposals.filter((proposal) =>
    ["PENDING", "REWORK"].includes(proposal.status)
  );
  const approvedProposals = proposals.filter((proposal) => proposal.status === "APPROVED");
  const totalAmount = activeProposals.reduce(
    (sum, proposal) =>
      sum + (proposal.releasedAmount ?? proposal.amount).toNumber(),
    0
  );
  const commissionForecast = activeProposals.reduce(
    (sum, proposal) => sum + proposal.commission.toNumber(),
    0
  );
  const commissionReceived = proposals.reduce(
    (sum, proposal) => sum + (proposal.commissionReceived?.toNumber() ?? 0),
    0
  );
  const conversionByProduct = new Map<string, { total: number; paid: number }>();
  const conversionByBank = new Map<string, { total: number; paid: number }>();
  const productionByOperator = new Map<string, { total: number; paid: number }>();

  proposals.forEach((proposal) => {
    const product = conversionByProduct.get(proposal.product) ?? { total: 0, paid: 0 };
    product.total += 1;
    if (proposal.status === "PAID") product.paid += 1;
    conversionByProduct.set(proposal.product, product);

    const bank = conversionByBank.get(proposal.bank) ?? { total: 0, paid: 0 };
    bank.total += 1;
    if (proposal.status === "PAID") bank.paid += 1;
    conversionByBank.set(proposal.bank, bank);

    const operatorKey = proposal.assignedUserId ?? "unassigned";
    const operator = productionByOperator.get(operatorKey) ?? { total: 0, paid: 0 };
    operator.total += 1;
    if (proposal.status === "PAID") operator.paid += 1;
    productionByOperator.set(operatorKey, operator);
  });

  return {
    count: activeProposals.length,
    totalAmount,
    paidAmount: paidProposals.reduce(
      (sum, proposal) => sum + (proposal.releasedAmount ?? proposal.amount).toNumber(),
      0
    ),
    formalizingAmount: analysisProposals.reduce(
      (sum, proposal) => sum + (proposal.releasedAmount ?? proposal.amount).toNumber(),
      0
    ),
    totalProposals: proposals.length,
    analysisCount: analysisProposals.length,
    pendingCount: pendingProposals.length,
    approvedCount: approvedProposals.length,
    paidCount: paidProposals.length,
    commissionForecast,
    commissionReceived,
    ticketAverage: activeProposals.length ? totalAmount / activeProposals.length : 0,
    commissionAverage: activeProposals.length ? commissionForecast / activeProposals.length : 0,
    conversionByProduct: Array.from(conversionByProduct.entries()).map(([name, data]) => ({
      name,
      total: data.total,
      paid: data.paid,
      rate: data.total ? Math.round((data.paid / data.total) * 100) : 0
    })),
    conversionByBank: Array.from(conversionByBank.entries()).map(([name, data]) => ({
      name,
      total: data.total,
      paid: data.paid,
      rate: data.total ? Math.round((data.paid / data.total) * 100) : 0
    })),
    productionByOperator: Array.from(productionByOperator.entries()).map(([userId, data]) => ({
      userId,
      total: data.total,
      paid: data.paid
    }))
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const where = buildProposalWhere(session.companyId, request.nextUrl.searchParams);
    const orderBy = buildOrderBy(request.nextUrl.searchParams);
    const proposals = await prisma.proposal.findMany({
      where,
      include: proposalInclude,
      orderBy,
      take: 100
    });

    const metricRows = await prisma.proposal.findMany({
      where,
      select: {
        amount: true,
        releasedAmount: true,
        commission: true,
        commissionReceived: true,
        status: true,
        bank: true,
        product: true,
        assignedUserId: true
      }
    });

    return NextResponse.json({
      proposals: proposals.map(mapProposal),
      metrics: buildMetrics(metricRows)
    });
  } catch (error) {
    const session = getSessionFromRequest(request);

    safeLogError("http-api", error, {
      route: "/api/proposals",
      method: "GET",
      companyId: session?.companyId,
      currentUserId: session?.id,
      publicErrorCode: "INTERNAL_ERROR",
      status: 500
    });

    return publicErrorResponse({ code: "INTERNAL_ERROR", status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as
        | {
          contactId?: string;
          multicredClientId?: string;
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
          status?: ProposalStatus;
        }
      | null;

    if (!body) {
      return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
    }

    const amount = toMoney(body?.amount);
    const financedAmount = toMoney(body?.financedAmount);
    const releasedAmount = toMoney(body?.releasedAmount);
    const installmentAmount = toMoney(body?.installmentAmount);
    const commission = toMoney(body?.commission);
    const commissionReceived = toMoney(body?.commissionReceived);
    const term = toPositiveInt(body?.term);
    const bank = body?.bank?.trim();
    const agreement = body?.agreement?.trim();
    const product = body?.product?.trim();
    const multicredClientId = body?.multicredClientId?.trim();
    const assignedUserId =
      typeof body?.assignedUserId === "string" ? body.assignedUserId.trim() : "";

    if ((!body?.contactId && !multicredClientId) || !bank || !agreement || !product) {
      return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
    }

    if (
      amount === null ||
      financedAmount === null ||
      releasedAmount === null ||
      installmentAmount === null ||
      commission === null ||
      commissionReceived === null ||
      term === null
    ) {
      return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
    }

    const multicredClient = multicredClientId
      ? await prisma.multicredClient.findFirst({
          where: { id: multicredClientId, companyId: session.companyId }
        })
      : null;

    if (multicredClientId && !multicredClient) {
      return publicErrorResponse({ code: "NOT_FOUND", status: 404 });
    }

    const assignedUser = assignedUserId
      ? await prisma.user.findFirst({
          where: { id: assignedUserId, companyId: session.companyId }
        })
      : null;

    if (assignedUserId && !assignedUser) {
      return publicErrorResponse({ code: "USER_NOT_FOUND", status: 404 });
    }

    let contact = body?.contactId
      ? await prisma.contact.findFirst({
          where: { id: body.contactId, companyId: session.companyId }
        })
      : null;

    if (body?.contactId && !contact) {
      return publicErrorResponse({ code: "CONTACT_NOT_FOUND", status: 404 });
    }

    if (!contact && multicredClient) {
      const phone = normalizePhone(multicredClient.whatsapp ?? multicredClient.phone);
      if (!phone) {
        return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
      }
      const contactNormalizedPhone = getContactNormalizedPhone(phone);

      if (multicredClient.cpf) {
        contact = await prisma.contact.findFirst({
          where: { companyId: session.companyId, cpf: multicredClient.cpf }
        });
      }

      if (!contact && contactNormalizedPhone) {
        contact = await prisma.contact.findFirst({
          where: { companyId: session.companyId, normalizedPhone: contactNormalizedPhone }
        });
      }

      if (!contact) {
        contact = await prisma.contact.findFirst({
          where: { companyId: session.companyId, phone }
        });
      }

      if (!contact) {
        try {
          contact = await prisma.contact.create({
            data: {
              companyId: session.companyId,
              name: multicredClient.name,
              phone,
              normalizedPhone: contactNormalizedPhone,
              cpf: multicredClient.cpf || null,
              email: multicredClient.email ?? null
            }
          });
        } catch (error) {
          if (
            isPrismaUniqueViolation(error) &&
            (isPrismaUniqueViolationForTarget(error, "normalizedPhone") ||
              isPrismaUniqueViolationForTarget(error, [
                "companyId",
                "normalizedPhone"
              ]))
          ) {
            if (multicredClient.cpf) {
              contact = await prisma.contact.findFirst({
                where: { companyId: session.companyId, cpf: multicredClient.cpf }
              });
            }

            if (!contact && contactNormalizedPhone) {
              contact = await prisma.contact.findFirst({
                where: {
                  companyId: session.companyId,
                  normalizedPhone: contactNormalizedPhone
                }
              });
            }

            if (!contact) {
              contact = await prisma.contact.findFirst({
                where: { companyId: session.companyId, phone }
              });
            }
          }

          if (!contact) {
            throw error;
          }
        }
      }
    }

    if (!contact) {
      return publicErrorResponse({ code: "CONTACT_NOT_FOUND", status: 404 });
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
          multicredClientId: multicredClient?.id ?? null,
          assignedUserId: assignedUser?.id ?? null,
          bank,
          agreement,
          product,
          operation: readOptionalString(body.operation),
          proposalNumber: readOptionalString(body.proposalNumber),
          contractNumber: readOptionalString(body.contractNumber),
          amount: amount ?? releasedAmount ?? financedAmount ?? 0,
          financedAmount,
          releasedAmount: releasedAmount ?? amount,
          installmentAmount,
          term,
          commission: commission ?? 0,
          commissionReceived,
          notes: readOptionalString(body.notes),
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

      await tx.proposalHistory.create({
        data: {
          companyId: session.companyId,
          proposalId: created.id,
          userId: session.id,
          action: "CREATED",
          title: "Proposta criada",
          detail: `${created.product} no ${created.bank}`
        }
      });

      if (assignedUser) {
        await tx.proposalHistory.create({
          data: {
            companyId: session.companyId,
            proposalId: created.id,
            userId: session.id,
            action: "ASSIGNED",
            title: "Responsavel atribuido",
            detail: assignedUser.name
          }
        });
      }

      return tx.proposal.findUniqueOrThrow({
        where: { id: created.id },
        include: proposalInclude
      });
    });

    return NextResponse.json({ proposal: mapProposal(proposal) }, { status: 201 });
  } catch (error) {
    const session = getSessionFromRequest(request);

    safeLogError("http-api", error, {
      route: "/api/proposals",
      method: "POST",
      companyId: session?.companyId,
      currentUserId: session?.id,
      publicErrorCode: "PROPOSAL_CREATE_FAILED",
      status: 500
    });

    return publicErrorResponse({ code: "PROPOSAL_CREATE_FAILED", status: 500 });
  }
}
