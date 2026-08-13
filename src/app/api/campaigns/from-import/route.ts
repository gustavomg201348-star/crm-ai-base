import { NextResponse, type NextRequest } from "next/server";
import { campaignInclude, mapCampaign } from "@/lib/campaigns";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { getSessionOrUnauthorized, requireCompanyAdmin } from "@/lib/permissions";
import {
  digitsOnlyPhone,
  normalizeBrazilianPhoneForIdentity
} from "@/lib/phone-normalization.service";
import { safeLogError } from "@/lib/safe-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveCampaignRecipientPhone(contact: {
  phone: string;
  normalizedPhone?: string | null;
}) {
  return (
    contact.normalizedPhone ??
    normalizeBrazilianPhoneForIdentity(contact.phone).normalizedPhone ??
    digitsOnlyPhone(contact.phone)
  );
}

export async function POST(request: NextRequest) {
  try {
    const { session, response } = getSessionOrUnauthorized(request);
    if (response) return response;

    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as
      | {
          channelId?: string;
          contactIds?: string[];
          message?: string;
          name?: string;
          messageType?: string;
          templateName?: string;
          templateLanguage?: string;
          templateVariables?: string[];
        }
      | null;

    const channelId = body?.channelId?.trim() ?? "";
    const message = body?.message?.trim() ?? "";
    const contactIds = Array.isArray(body?.contactIds)
      ? Array.from(new Set(body.contactIds.filter(Boolean)))
      : [];

    if (!channelId) {
      return NextResponse.json({ error: "Canal obrigatorio." }, { status: 400 });
    }
    if (!message) {
      return NextResponse.json({ error: "Mensagem obrigatoria." }, { status: 400 });
    }
    if (
      body?.messageType === "TEMPLATE" &&
      (!body.templateName?.trim() || !body.templateLanguage?.trim())
    ) {
      return NextResponse.json(
        { error: "Selecione um template aprovado da Meta." },
        { status: 400 }
      );
    }
    if (!contactIds.length) {
      return NextResponse.json(
        { error: "Importe ou selecione contatos antes de criar a campanha." },
        { status: 400 }
      );
    }

    const channel = await prisma.channel.findFirst({
      where: {
        id: channelId,
        companyId: session.companyId,
        type: "whatsapp",
        provider: "meta",
        status: { in: ["ACTIVE", "CONNECTED"] }
      }
    });

    if (!channel?.phoneNumberId || !channel.accessToken) {
      return NextResponse.json(
        { error: "Canal WhatsApp Meta ativo nao encontrado ou incompleto." },
        { status: 400 }
      );
    }

    const contacts = await prisma.contact.findMany({
      where: {
        id: { in: contactIds },
        companyId: session.companyId,
        archivedAt: null
      },
      select: { id: true, phone: true, normalizedPhone: true, name: true }
    });

    if (!contacts.length) {
      return NextResponse.json(
        { error: "Nenhum contato valido encontrado para este tenant." },
        { status: 400 }
      );
    }

    const campaign = await prisma.campaign.create({
      data: {
        companyId: session.companyId,
        channelId: channel.id,
        createdById: session.id,
        name: body?.name?.trim() || `Disparo planilha ${new Date().toLocaleString("pt-BR")}`,
        message,
        messageType: body?.messageType === "TEMPLATE" ? "TEMPLATE" : "TEXT",
        templateName: body?.messageType === "TEMPLATE" ? body.templateName?.trim() : null,
        templateLanguage:
          body?.messageType === "TEMPLATE" ? body.templateLanguage?.trim() : null,
        templateVariables:
          body?.messageType === "TEMPLATE"
            ? JSON.stringify(body.templateVariables ?? [])
            : null,
        status: "DRAFT",
        total: contacts.length,
        recipients: {
          create: contacts.map((contact) => ({
            contactId: contact.id,
            phone: resolveCampaignRecipientPhone(contact)
          }))
        }
      },
      include: campaignInclude
    });

    return NextResponse.json({ campaign: mapCampaign(campaign) }, { status: 201 });
  } catch (error) {
    safeLogError("http-api", error, {
      operation: "campaign-create-from-import",
      route: "/api/campaigns/from-import",
      publicErrorCode: "CAMPAIGN_CREATE_FAILED",
      status: 500
    });

    return publicErrorResponse({
      code: "CAMPAIGN_CREATE_FAILED",
      status: 500,
      message: "Nao foi possivel criar campanha da importacao."
    });
  }
}
