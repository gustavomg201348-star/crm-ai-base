import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import {
  CAMPAIGN_IMAGE_MAX_BYTES,
  CAMPAIGN_IMAGE_TYPES,
  campaignInclude,
  mapCampaign,
  processCampaign
} from "@/lib/campaigns";
import { prisma } from "@/lib/db";
import { requireCompanyAdmin } from "@/lib/permissions";
import { digitsOnlyPhone } from "@/lib/phone-normalization.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeFileName(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  const stem = path
    .basename(fileName, ext)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `${stem || "imagem"}${ext}`;
}

function parseContactIds(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return [];
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const campaigns = await prisma.campaign.findMany({
      where: { companyId: session.companyId },
      include: campaignInclude,
      orderBy: { createdAt: "desc" },
      take: 20
    });

    return NextResponse.json({ campaigns: campaigns.map(mapCampaign) });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel carregar disparos." },
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

    const formData = await request.formData();
    const channelId = String(formData.get("channelId") ?? "").trim();
    const message = String(formData.get("message") ?? "").trim();
    const contactIds = parseContactIds(formData.get("contactIds"));
    const image = formData.get("image");
    const messageType = String(formData.get("messageType") ?? "TEXT").trim();
    const templateName = String(formData.get("templateName") ?? "").trim();
    const templateLanguage = String(formData.get("templateLanguage") ?? "").trim();
    const templateVariables = String(formData.get("templateVariables") ?? "").trim();

    if (!channelId) {
      return NextResponse.json({ error: "Canal obrigatorio." }, { status: 400 });
    }
    if (messageType === "TEMPLATE" && (!templateName || !templateLanguage)) {
      return NextResponse.json(
        { error: "Selecione um template aprovado da Meta." },
        { status: 400 }
      );
    }
    if (!message && messageType !== "TEMPLATE") {
      return NextResponse.json({ error: "Mensagem obrigatoria." }, { status: 400 });
    }
    if (!contactIds.length) {
      return NextResponse.json(
        { error: "Selecione pelo menos um contato." },
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

    if (!channel) {
      return NextResponse.json(
        { error: "Canal WhatsApp Meta ativo nao encontrado." },
        { status: 404 }
      );
    }
    if (!channel.phoneNumberId || !channel.accessToken) {
      return NextResponse.json(
        { error: "Canal Meta sem Phone Number ID ou token." },
        { status: 400 }
      );
    }

    const contacts = await prisma.contact.findMany({
      where: {
        id: { in: contactIds },
        companyId: session.companyId,
        archivedAt: null
      },
      orderBy: { name: "asc" }
    });

    if (!contacts.length) {
      return NextResponse.json(
        { error: "Nenhum contato valido encontrado para este tenant." },
        { status: 400 }
      );
    }

    let imageBuffer: Buffer | null = null;
    let imageName: string | null = null;
    let imageMime: string | null = null;
    let imageSize: number | null = null;

    if (image instanceof File && image.size > 0) {
      if (!CAMPAIGN_IMAGE_TYPES.includes(image.type)) {
        return NextResponse.json(
          { error: "Imagem deve ser JPG, JPEG ou PNG." },
          { status: 400 }
        );
      }
      if (image.size > CAMPAIGN_IMAGE_MAX_BYTES) {
        return NextResponse.json(
          { error: "Imagem deve ter no maximo 5MB." },
          { status: 400 }
        );
      }

      imageBuffer = Buffer.from(await image.arrayBuffer());
      imageName = safeFileName(image.name);
      imageMime = image.type;
      imageSize = image.size;
    }

    const campaign = await prisma.campaign.create({
      data: {
        companyId: session.companyId,
        channelId: channel.id,
        createdById: session.id,
        name: `Disparo ${new Date().toLocaleString("pt-BR")}`,
        message: message || `[Template: ${templateName}]`,
        messageType: messageType === "TEMPLATE" ? "TEMPLATE" : "TEXT",
        templateName: messageType === "TEMPLATE" ? templateName : null,
        templateLanguage: messageType === "TEMPLATE" ? templateLanguage : null,
        templateVariables: messageType === "TEMPLATE" ? templateVariables || "[]" : null,
        imageName,
        imageMime,
        imageSize,
        total: contacts.length,
        recipients: {
          create: contacts.map((contact) => ({
            contactId: contact.id,
            phone: digitsOnlyPhone(contact.phone)
          }))
        }
      }
    });

    if (imageBuffer && imageName) {
      const uploadDir = path.join(process.cwd(), "public", "uploads", "campaigns");
      await mkdir(uploadDir, { recursive: true });
      const imagePath = path.join(uploadDir, `${campaign.id}-${imageName}`);
      await writeFile(imagePath, imageBuffer);

      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { imagePath }
      });
    }

    const processed = await processCampaign(campaign.id);

    return NextResponse.json({ campaign: mapCampaign(processed) }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel criar o disparo."
      },
      { status: 500 }
    );
  }
}
