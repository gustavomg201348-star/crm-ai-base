import { NextResponse, type NextRequest } from "next/server";
import { campaignInclude, mapCampaign } from "@/lib/campaigns";
import { prisma } from "@/lib/db";
import { getSessionOrUnauthorized, requireAdmin } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { session, response } = getSessionOrUnauthorized(request);
    if (response) return response;

    const blocked = requireAdmin(session);
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
      select: { id: true, phone: true, name: true }
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
            phone: contact.phone.replace(/\D/g, "")
          }))
        }
      },
      include: campaignInclude
    });

    return NextResponse.json({ campaign: mapCampaign(campaign) }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel criar campanha da importacao."
      },
      { status: 500 }
    );
  }
}
