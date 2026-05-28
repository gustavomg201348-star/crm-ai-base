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

export function extractVariableCount(text: string) {
  const matches = text.match(/\{\{\d+\}\}/g) ?? [];
  return new Set(matches).size;
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
    variables: cleanVariables
  });
  const preview = extractBodyText(template).replace(/\{\{(\d+)\}\}/g, (_, index) => {
    return cleanVariables[Number(index) - 1] ?? "";
  });

  return saveOutboundMessage({
    conversationId,
    userId,
    body: preview || `[Template: ${templateName}]`,
    type: "template",
    templateName,
    templateLanguage: language,
    templateVariables: JSON.stringify(cleanVariables),
    providerMessageId: readMetaMessageId(metaResponse)
  });
}
