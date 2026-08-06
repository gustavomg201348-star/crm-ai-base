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
import {
  parseCampaignRecipientTemplateVariables,
  serializeCampaignRecipientResolvedVariables,
  validateCampaignRecipientTemplateVariables
} from "@/lib/campaign-template-recipient-variables";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { requireCompanyAdmin } from "@/lib/permissions";
import { digitsOnlyPhone } from "@/lib/phone-normalization.service";
import { safeLogError } from "@/lib/safe-logger";
import {
  deserializeTemplateVariableMappingV1,
  extractTemplateBodyVariableIndexes,
  serializeTemplateVariableMappingV1,
  TemplateParameterError
} from "@/lib/template-parameters";
import { findReadyLocalMetaTemplate } from "@/lib/whatsapp-template.service";

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

function getTemplateBodyText(template: { components?: Array<{ type?: string; text?: unknown }> }) {
  const body = template.components?.find((component) => component.type === "BODY");
  return typeof body?.text === "string" ? body.text : "";
}

function templateParameterResponse(error: TemplateParameterError) {
  return NextResponse.json({ error: error.message }, { status: 400 });
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
  } catch (error) {
    safeLogError("http-api", error, {
      operation: "campaigns-list",
      route: "/api/campaigns",
      publicErrorCode: "INTERNAL_ERROR",
      status: 500
    });

    return publicErrorResponse({
      code: "INTERNAL_ERROR",
      status: 500,
      message: "Nao foi possivel carregar disparos."
    });
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
    const templateVariableMappingRaw = String(
      formData.get("templateVariableMapping") ?? ""
    ).trim();
    const recipientTemplateVariablesRaw = String(
      formData.get("recipientTemplateVariables") ?? ""
    ).trim();

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

    let templateVariableMapping: ReturnType<
      typeof deserializeTemplateVariableMappingV1
    > = null;
    let recipientTemplateVariables = parseCampaignRecipientTemplateVariables();

    if (templateVariableMappingRaw || recipientTemplateVariablesRaw) {
      if (messageType !== "TEMPLATE") {
        return NextResponse.json(
          { error: "Variaveis por coluna exigem campanha com template." },
          { status: 400 }
        );
      }
      if (!templateVariableMappingRaw) {
        return NextResponse.json(
          { error: "Mapeamento de variaveis obrigatorio." },
          { status: 400 }
        );
      }
      if (!recipientTemplateVariablesRaw) {
        return NextResponse.json(
          { error: "Variaveis por destinatario obrigatorias." },
          { status: 400 }
        );
      }
      if (!channel.wabaId) {
        return NextResponse.json(
          { error: "Canal Meta sem WABA ID." },
          { status: 400 }
        );
      }

      try {
        templateVariableMapping =
          deserializeTemplateVariableMappingV1(templateVariableMappingRaw);
      } catch (error) {
        if (error instanceof TemplateParameterError) {
          return templateParameterResponse(error);
        }
        throw error;
      }

      const localTemplateContext = await findReadyLocalMetaTemplate({
        companyId: session.companyId,
        wabaId: channel.wabaId,
        templateName,
        language: templateLanguage
      });

      if (!localTemplateContext) {
        return NextResponse.json(
          { error: "Template aprovado nao encontrado para o disparo." },
          { status: 400 }
        );
      }

      let expectedBodyLength = 0;
      try {
        expectedBodyLength = extractTemplateBodyVariableIndexes(
          getTemplateBodyText(localTemplateContext.template)
        ).length;
        recipientTemplateVariables = parseCampaignRecipientTemplateVariables(
          recipientTemplateVariablesRaw,
          expectedBodyLength
        );
      } catch (error) {
        if (error instanceof TemplateParameterError) {
          return templateParameterResponse(error);
        }
        throw error;
      }

      const mappedVariables = Object.keys(templateVariableMapping?.body ?? {}).length;
      if (mappedVariables !== expectedBodyLength) {
        return NextResponse.json(
          { error: "Mapeamento nao corresponde ao template selecionado." },
          { status: 400 }
        );
      }
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

    let validatedRecipientTemplateVariables: ReturnType<
      typeof validateCampaignRecipientTemplateVariables
    > | null = null;
    if (recipientTemplateVariables.length) {
      try {
        validatedRecipientTemplateVariables =
          validateCampaignRecipientTemplateVariables({
            recipients: recipientTemplateVariables,
            allowedContactIds: contacts.map((contact) => contact.id),
            expectedBodyLength: recipientTemplateVariables[0]?.resolved.body.length ?? 0
          });
      } catch (error) {
        if (error instanceof TemplateParameterError) {
          return templateParameterResponse(error);
        }
        throw error;
      }

      if (contacts.length !== recipientTemplateVariables.length) {
        return NextResponse.json(
          { error: "Destinatarios nao correspondem as variaveis resolvidas." },
          { status: 400 }
        );
      }
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
        templateVariableMapping: templateVariableMapping
          ? serializeTemplateVariableMappingV1(templateVariableMapping)
          : null,
        imageName,
        imageMime,
        imageSize,
        total: contacts.length,
        recipients: {
          create: contacts.map((contact) => {
            const resolved =
              validatedRecipientTemplateVariables?.byContactId.get(contact.id)?.resolved;

            return {
              contactId: contact.id,
              phone: digitsOnlyPhone(contact.phone),
              resolvedTemplateVariables: resolved
                ? serializeCampaignRecipientResolvedVariables(resolved)
                : null
            };
          })
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
    safeLogError("http-api", error, {
      operation: "campaign-create",
      route: "/api/campaigns",
      publicErrorCode: "CAMPAIGN_CREATE_FAILED",
      status: 500
    });

    return publicErrorResponse({
      code: "CAMPAIGN_CREATE_FAILED",
      status: 500,
      message: "Nao foi possivel criar o disparo."
    });
  }
}
