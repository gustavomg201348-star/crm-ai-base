import {
  getMetaApprovedTemplates,
  readMetaMessageId,
  sendMetaTemplateMessage,
  type MetaTemplate
} from "@/lib/meta-whatsapp";
import {
  getConversationIntegration,
  saveOutboundMessage
} from "@/lib/conversation-message.service";
import { prisma } from "@/lib/db";
import {
  extractMetaTemplateVariables,
  normalizeMetaTemplate
} from "@/lib/meta-template-normalizer";
import { digitsOnlyPhone } from "@/lib/phone-normalization.service";

export function extractBodyText(template: MetaTemplate) {
  return normalizeMetaTemplate(template).body.text;
}

export function extractTemplateButtons(template: MetaTemplate) {
  return (
    template.components
      ?.find((component) => component.type === "BUTTONS")
      ?.buttons?.map((button) => ({
        type: button.type ?? "BUTTON",
        text: button.text ?? "",
        url: button.url ?? null,
        phoneNumber: button.phone_number ?? null
      }))
      .filter((button) => button.text) ?? []
  );
}

export function templateHasHeaderImage(template: MetaTemplate) {
  return normalizeMetaTemplate(template).header.format === "IMAGE";
}

function normalizeTemplateEnvName(templateName: string) {
  return templateName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getPublicBaseUrl() {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.PUBLIC_APP_URL?.trim();

  if (configured) return configured.replace(/\/+$/g, "");

  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railwayDomain) return `https://${railwayDomain.replace(/^https?:\/\//i, "").replace(/\/+$/g, "")}`;

  if (process.env.NODE_ENV === "production") {
    return "https://crm-ai-base-production.up.railway.app";
  }

  return null;
}

function getBundledTemplateHeaderImageUrl(templateName: string) {
  const bundledImages: Record<string, string> = {
    INSS_UTILIDADE_01: "inss_utilidade_01.jpg",
    FGTS_UTILIDADE: "fgts_utilidade.jpg",
    CLTCOMIMAGEM: "cltcomimagem.jpg"
  };
  const fileName = bundledImages[normalizeTemplateEnvName(templateName)];
  if (!fileName) return null;

  const baseUrl = getPublicBaseUrl();
  if (!baseUrl?.startsWith("https://")) return null;

  return `${baseUrl}/templates/${fileName}`;
}

export function resolveTemplateHeaderImageUrl(template: MetaTemplate) {
  if (!templateHasHeaderImage(template)) return null;

  const specificKey = `WHATSAPP_TEMPLATE_HEADER_IMAGE_URL_${normalizeTemplateEnvName(
    template.name
  )}`;
  const url =
    process.env[specificKey]?.trim() ??
    process.env.WHATSAPP_TEMPLATE_HEADER_IMAGE_URL?.trim() ??
    getBundledTemplateHeaderImageUrl(template.name) ??
    "";

  if (!url) {
    throw new Error(
      `O template ${template.name} possui imagem no cabecalho. Configure ${specificKey} com uma URL publica HTTPS da imagem.`
    );
  }

  if (!/^https:\/\//i.test(url)) {
    throw new Error(`A variavel ${specificKey} precisa conter uma URL publica HTTPS.`);
  }

  return url;
}

export function extractVariableCount(text: string) {
  return extractMetaTemplateVariables(text).length;
}

export function renderTemplateBody(template: MetaTemplate, variables: string[]) {
  return extractBodyText(template).replace(/\{\{(\d+)\}\}/g, (_, index) => {
    return variables[Number(index) - 1] ?? "";
  });
}

export function renderTemplateHistoryBody({
  template,
  variables
}: {
  template: MetaTemplate;
  variables: string[];
}) {
  const body = renderTemplateBody(template, variables).trim();
  const buttons = extractTemplateButtons(template);
  const buttonLines = buttons.map((button) => `Botao: ${button.text}`);
  const headerLine = templateHasHeaderImage(template) ? "[Imagem no cabecalho]" : "";

  return [
    "[Template enviado]",
    headerLine,
    body || `[Template: ${template.name}]`,
    buttonLines.length ? buttonLines.join("\n") : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function mapApprovedTemplate(template: MetaTemplate) {
  const normalized = normalizeMetaTemplate(template);

  return {
    id: normalized.metaId ?? normalized.name,
    name: normalized.name,
    category: normalized.category,
    language: normalized.language,
    status: normalized.status,
    preview: normalized.body.text,
    variableCount: normalized.bodyVariableCount
  };
}

export async function getApprovedTemplatesForConversation({
  conversationId,
  companyId
}: {
  conversationId: string;
  companyId: string;
}) {
  const { channel } = await getConversationIntegration({ conversationId, companyId });
  if (!channel.wabaId) throw new Error("Canal Meta sem WABA ID.");

  const templates = await getMetaApprovedTemplates({
    wabaId: channel.wabaId,
    accessToken: channel.accessToken!
  });

  return templates.map(mapApprovedTemplate);
}

export async function getApprovedTemplatesForChannel({
  channelId,
  companyId
}: {
  channelId: string;
  companyId: string;
}) {
  const channel = await prisma.channel.findFirst({
    where: {
      id: channelId,
      companyId,
      type: "whatsapp",
      provider: "meta",
      status: { in: ["ACTIVE", "CONNECTED"] }
    }
  });

  if (!channel) throw new Error("Canal Meta nao encontrado.");
  if (!channel.wabaId) throw new Error("Canal Meta sem WABA ID.");
  if (!channel.accessToken) throw new Error("Canal Meta sem token.");

  const templates = await getMetaApprovedTemplates({
    wabaId: channel.wabaId,
    accessToken: channel.accessToken
  });

  return templates.map(mapApprovedTemplate);
}

export async function sendConversationTemplate({
  conversationId,
  companyId,
  userId,
  templateName,
  language,
  variables
}: {
  conversationId: string;
  companyId: string;
  userId: string;
  templateName: string;
  language: string;
  variables: string[];
}) {
  const { conversation, channel } = await getConversationIntegration({
    conversationId,
    companyId
  });
  if (!channel.wabaId) throw new Error("Canal Meta sem WABA ID.");

  const templates = await getMetaApprovedTemplates({
    wabaId: channel.wabaId,
    accessToken: channel.accessToken!
  });
  const template = templates.find(
    (item) => item.name === templateName && item.language === language
  );

  if (!template) throw new Error("Template aprovado nao encontrado.");

  const requiredVariables = extractVariableCount(extractBodyText(template));
  const cleanVariables = variables.map((value) => value.trim());

  if (cleanVariables.length < requiredVariables || cleanVariables.some((value) => !value)) {
    throw new Error("Preencha todas as variaveis obrigatorias do template.");
  }

  const headerImageUrl = resolveTemplateHeaderImageUrl(template);
  const metaResponse = await sendMetaTemplateMessage({
    phoneNumberId: channel.phoneNumberId!,
    accessToken: channel.accessToken!,
    to: digitsOnlyPhone(conversation.contact.phone),
    name: templateName,
    language,
    variables: cleanVariables,
    template,
    headerImageUrl
  });
  const historyBody = renderTemplateHistoryBody({
    template,
    variables: cleanVariables
  });
  const buttons = extractTemplateButtons(template);

  return saveOutboundMessage({
    conversationId,
    userId,
    body: historyBody,
    type: "template",
    mediaUrl: headerImageUrl,
    mimeType: headerImageUrl ? "image/jpeg" : null,
    templateName,
    templateLanguage: language,
    templateVariables: JSON.stringify({
      variables: cleanVariables,
      buttons
    }),
    providerMessageId: readMetaMessageId(metaResponse)
  });
}
