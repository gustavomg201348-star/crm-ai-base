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

export function extractBodyText(template: MetaTemplate) {
  return template.components?.find((component) => component.type === "BODY")?.text ?? "";
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
  return template.components?.some(
    (component) => component.type === "HEADER" && component.format === "IMAGE"
  ) ?? false;
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
  if (normalizeTemplateEnvName(templateName) !== "INSS_UTILIDADE_01") return null;

  const baseUrl = getPublicBaseUrl();
  if (!baseUrl?.startsWith("https://")) return null;

  return `${baseUrl}/templates/inss_utilidade_01.jpg`;
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
  const matches = text.match(/\{\{\d+\}\}/g) ?? [];
  return new Set(matches).size;
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
  const body = extractBodyText(template);

  return {
    id: template.id ?? template.name,
    name: template.name,
    category: template.category ?? "UTILITY",
    language: template.language,
    status: template.status,
    preview: body,
    variableCount: extractVariableCount(body)
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

  const metaResponse = await sendMetaTemplateMessage({
    phoneNumberId: channel.phoneNumberId!,
    accessToken: channel.accessToken!,
    to: conversation.contact.phone.replace(/\D/g, ""),
    name: templateName,
    language,
    variables: cleanVariables,
    template,
    headerImageUrl: resolveTemplateHeaderImageUrl(template)
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
    templateName,
    templateLanguage: language,
    templateVariables: JSON.stringify({
      variables: cleanVariables,
      buttons
    }),
    providerMessageId: readMetaMessageId(metaResponse)
  });
}
