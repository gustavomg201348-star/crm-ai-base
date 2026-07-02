import type { Prisma, PrismaClient } from "@prisma/client";
import { createActivity } from "@/lib/activities";
import { findOrCreateConversationForChannel } from "@/lib/conversation-lifecycle.service";
import { renderCampaignMessage } from "@/lib/contact-import.service";
import { prisma } from "@/lib/db";
import {
  getMetaApprovedTemplates,
  readMetaMessageId,
  sendMetaImageMessage,
  sendMetaTemplateMessage,
  sendMetaTextMessage,
  uploadMetaMedia,
  type MetaTemplate
} from "@/lib/meta-whatsapp";
import {
  extractTemplateButtons,
  renderTemplateHistoryBody,
  resolveTemplateHeaderImageUrl
} from "@/lib/whatsapp-template.service";

type DbClient = PrismaClient | Prisma.TransactionClient;

export const CAMPAIGN_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const CAMPAIGN_IMAGE_TYPES = ["image/jpeg", "image/png"];

export const campaignInclude = {
  channel: true,
  recipients: {
    include: {
      contact: {
        select: {
          id: true,
          name: true,
          phone: true
        }
      }
    },
    orderBy: { createdAt: "asc" }
  }
} satisfies Prisma.CampaignInclude;

export type CampaignWithRelations = Prisma.CampaignGetPayload<{
  include: typeof campaignInclude;
}>;

export function mapCampaign(campaign: CampaignWithRelations) {
  return {
    id: campaign.id,
    name: campaign.name,
    message: campaign.message,
    messageType: campaign.messageType,
    templateName: campaign.templateName,
    templateLanguage: campaign.templateLanguage,
    templateVariables: campaign.templateVariables,
    status: campaign.status,
    total: campaign.total,
    sent: campaign.sent,
    delivered: campaign.delivered,
    failed: campaign.failed,
    imageName: campaign.imageName,
    imageMime: campaign.imageMime,
    imageSize: campaign.imageSize,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
    startedAt: campaign.startedAt,
    finishedAt: campaign.finishedAt,
    channel: {
      id: campaign.channel.id,
      name: campaign.channel.name,
      provider: campaign.channel.provider,
      displayPhone: campaign.channel.displayPhone
    },
    recipients: campaign.recipients.map((recipient) => ({
      id: recipient.id,
      contactId: recipient.contactId,
      contactName: recipient.contact.name,
      phone: recipient.phone,
      status: recipient.status,
      errorCode: recipient.errorCode,
      errorMessage: recipient.errorMessage,
      sentAt: recipient.sentAt,
      deliveredAt: recipient.deliveredAt,
      failedAt: recipient.failedAt
    }))
  };
}

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readTemplateVariables(value?: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

async function findOrCreateCampaignConversation({
  db,
  companyId,
  userId,
  channelId,
  contactId
}: {
  db: DbClient;
  companyId: string;
  userId: string;
  channelId: string;
  contactId: string;
}) {
  return findOrCreateConversationForChannel({
    db,
    companyId,
    contactId,
    channelId,
    agentId: userId,
    status: "OPEN"
  });
}

async function refreshCampaignCounters(campaignId: string) {
  const [sent, delivered, failed, total] = await Promise.all([
    prisma.campaignRecipient.count({
      where: { campaignId, status: { in: ["SENT", "DELIVERED"] } }
    }),
    prisma.campaignRecipient.count({ where: { campaignId, status: "DELIVERED" } }),
    prisma.campaignRecipient.count({ where: { campaignId, status: "FAILED" } }),
    prisma.campaignRecipient.count({ where: { campaignId } })
  ]);

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { status: true }
  });
  if (campaign?.status === "PAUSED" || campaign?.status === "CANCELED") return;

  const completed = sent + failed >= total;
  const status = completed
    ? failed === total
      ? "FAILED"
      : failed
        ? "PARTIAL"
        : "COMPLETED"
    : "SENDING";

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      sent,
      delivered,
      failed,
      total,
      status,
      ...(completed ? { finishedAt: new Date() } : {})
    }
  });
}

export async function processCampaign(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      channel: true,
      recipients: {
        where: { status: "PENDING" },
        include: { contact: true },
        orderBy: { createdAt: "asc" }
      }
    }
  });

  if (!campaign) throw new Error("Disparo nao encontrado.");
  if (campaign.channel.provider !== "meta") {
    throw new Error("Disparo real exige canal WhatsApp Meta.");
  }
  if (!campaign.channel.phoneNumberId || !campaign.channel.accessToken) {
    throw new Error("Canal Meta sem Phone Number ID ou token.");
  }

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: "SENDING", startedAt: campaign.startedAt ?? new Date() }
  });

  let mediaId: string | null = null;
  let campaignTemplate: MetaTemplate | null = null;
  if (campaign.imagePath && campaign.imageMime && campaign.imageName) {
    const { readFile } = await import("node:fs/promises");
    const bytes = await readFile(campaign.imagePath);
    const uploaded = await uploadMetaMedia({
      phoneNumberId: campaign.channel.phoneNumberId,
      accessToken: campaign.channel.accessToken,
      fileName: campaign.imageName,
      mimeType: campaign.imageMime,
      bytes
    });
    mediaId = uploaded.id;
  }

  if (
    campaign.messageType === "TEMPLATE" &&
    campaign.templateName &&
    campaign.templateLanguage
  ) {
    if (!campaign.channel.wabaId) throw new Error("Canal Meta sem WABA ID.");

    const templates = await getMetaApprovedTemplates({
      wabaId: campaign.channel.wabaId,
      accessToken: campaign.channel.accessToken
    });
    campaignTemplate =
      templates.find(
        (template) =>
          template.name === campaign.templateName &&
          template.language === campaign.templateLanguage
      ) ?? null;

    if (!campaignTemplate) {
      throw new Error("Template aprovado nao encontrado para o disparo.");
    }
  }

  for (const recipient of campaign.recipients) {
    const currentCampaign = await prisma.campaign.findUnique({
      where: { id: campaign.id },
      select: { status: true }
    });
    if (currentCampaign?.status === "PAUSED") break;
    if (currentCampaign?.status === "CANCELED") {
      await prisma.campaignRecipient.updateMany({
        where: { campaignId: campaign.id, status: "PENDING" },
        data: {
          status: "CANCELED",
          failedAt: new Date(),
          errorMessage: "Campanha cancelada antes do envio."
        }
      });
      break;
    }

    try {
      const to = normalizePhone(recipient.phone);
      const personalizedMessage = renderCampaignMessage(campaign.message, {
        name: recipient.contact.name,
        cpf: recipient.contact.cpf,
        phone: recipient.contact.phone
      });
      const templateVariables = readTemplateVariables(
        campaign.templateVariables
      ).map((value) =>
        renderCampaignMessage(value, {
          name: recipient.contact.name,
          cpf: recipient.contact.cpf,
          phone: recipient.contact.phone
        })
      );
      const templateHeaderImageUrl = campaignTemplate
        ? resolveTemplateHeaderImageUrl(campaignTemplate)
        : null;
      const metaResponse =
        campaign.messageType === "TEMPLATE" &&
        campaign.templateName &&
        campaign.templateLanguage
          ? await sendMetaTemplateMessage({
              phoneNumberId: campaign.channel.phoneNumberId,
              accessToken: campaign.channel.accessToken,
              to,
              name: campaign.templateName,
              language: campaign.templateLanguage,
              variables: templateVariables,
              template: campaignTemplate,
              headerImageUrl: templateHeaderImageUrl
            })
          : mediaId
            ? await sendMetaImageMessage({
                phoneNumberId: campaign.channel.phoneNumberId,
                accessToken: campaign.channel.accessToken,
                to,
                mediaId,
                caption: personalizedMessage
              })
            : await sendMetaTextMessage({
                phoneNumberId: campaign.channel.phoneNumberId,
                accessToken: campaign.channel.accessToken,
                to,
                body: personalizedMessage
              });
      const providerMessageId = readMetaMessageId(metaResponse);
      const historyBody = campaignTemplate
        ? renderTemplateHistoryBody({
            template: campaignTemplate,
            variables: templateVariables
          })
        : campaign.imageName
          ? `[Imagem: ${campaign.imageName}] ${personalizedMessage}`.trim()
          : personalizedMessage;

      await prisma.$transaction(async (tx) => {
        const sentAt = new Date();
        const conversation = await findOrCreateCampaignConversation({
          db: tx,
          companyId: campaign.companyId,
          userId: campaign.createdById ?? "",
          channelId: campaign.channelId,
          contactId: recipient.contactId
        });

        await tx.message.create({
          data: {
            conversationId: conversation.id,
            direction: "outbound",
            body: historyBody,
            type: campaign.messageType === "TEMPLATE" ? "template" : "text",
            mediaUrl: templateHeaderImageUrl,
            mimeType: templateHeaderImageUrl ? "image/jpeg" : null,
            templateName: campaign.templateName,
            templateLanguage: campaign.templateLanguage,
            templateVariables: campaignTemplate
              ? JSON.stringify({
                  variables: templateVariables,
                  buttons: extractTemplateButtons(campaignTemplate)
                })
              : campaign.templateVariables,
            providerMessageId
          }
        });

        await tx.contact.update({
          where: { id: recipient.contactId },
          data: { lastMessage: historyBody }
        });

        await tx.conversation.update({
          where: { id: conversation.id },
          data: {
            status: conversation.status === "PENDING" ? "OPEN" : conversation.status,
            unreadCount: 0,
            lastReadAt: sentAt,
            lastMessageAt: sentAt,
            lastMessagePreview: historyBody,
            updatedAt: sentAt
          }
        });

        await createActivity(tx, {
          contactId: recipient.contactId,
          userId: campaign.createdById,
          type: "CAMPAIGN_SENT",
          title: "Disparo enviado",
          detail: campaign.name
        });

        await tx.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            conversationId: conversation.id,
            status: "SENT",
            providerMessageId,
            sentAt,
            errorCode: null,
            errorMessage: null
          }
        });
      });
    } catch (error) {
      await prisma.$transaction(async (tx) => {
        await tx.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            status: "FAILED",
            failedAt: new Date(),
            errorMessage:
              error instanceof Error ? error.message : "Falha desconhecida no envio."
          }
        });

        await createActivity(tx, {
          contactId: recipient.contactId,
          userId: campaign.createdById,
          type: "CAMPAIGN_FAILED",
          title: "Falha no disparo",
          detail: error instanceof Error ? error.message : campaign.name
        });
      });
    }

    const delaySeconds = Number(process.env.CAMPAIGN_DISPATCH_INTERVAL_SECONDS ?? "1");
    if (delaySeconds > 0) {
      await sleep(Math.min(delaySeconds, 30) * 1000);
    }
  }

  await refreshCampaignCounters(campaign.id);

  return prisma.campaign.findUniqueOrThrow({
    where: { id: campaign.id },
    include: campaignInclude
  });
}

export async function updateCampaignDeliveryStatus({
  providerMessageId,
  status,
  errorCode,
  errorMessage
}: {
  providerMessageId: string;
  status: string;
  errorCode?: string | null;
  errorMessage?: string | null;
}) {
  const mappedStatus =
    status === "delivered" || status === "read"
      ? "DELIVERED"
      : status === "failed"
        ? "FAILED"
        : status === "sent"
          ? "SENT"
          : null;

  if (!mappedStatus) return null;

  const recipient = await prisma.campaignRecipient.findFirst({
    where: { providerMessageId }
  });

  if (!recipient) return null;

  const updated = await prisma.campaignRecipient.update({
    where: { id: recipient.id },
    data: {
      status: mappedStatus,
      errorCode,
      errorMessage,
      ...(mappedStatus === "DELIVERED" ? { deliveredAt: new Date() } : {}),
      ...(mappedStatus === "FAILED" ? { failedAt: new Date() } : {})
    }
  });

  await refreshCampaignCounters(updated.campaignId);
  return updated;
}
