import type { Prisma, PrismaClient } from "@prisma/client";
import { createActivity } from "@/lib/activities";
import { prisma } from "@/lib/db";
import {
  readMetaMessageId,
  sendMetaImageMessage,
  sendMetaTextMessage,
  uploadMetaMedia
} from "@/lib/meta-whatsapp";

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
  const existing = await db.conversation.findFirst({
    where: {
      contactId,
      contact: { companyId },
      channel: `whatsapp:${channelId}`,
      status: { in: ["OPEN", "PENDING", "BOT"] }
    }
  });

  if (existing) return existing;

  return db.conversation.create({
    data: {
      contactId,
      agentId: userId,
      status: "OPEN",
      channel: `whatsapp:${channelId}`
    }
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

  const completed = sent + failed >= total;
  const status = completed ? (failed === total ? "FAILED" : failed ? "PARTIAL" : "COMPLETED") : "SENDING";

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

  for (const recipient of campaign.recipients) {
    try {
      const to = normalizePhone(recipient.phone);
      const metaResponse = mediaId
        ? await sendMetaImageMessage({
            phoneNumberId: campaign.channel.phoneNumberId,
            accessToken: campaign.channel.accessToken,
            to,
            mediaId,
            caption: campaign.message
          })
        : await sendMetaTextMessage({
            phoneNumberId: campaign.channel.phoneNumberId,
            accessToken: campaign.channel.accessToken,
            to,
            body: campaign.message
          });
      const providerMessageId = readMetaMessageId(metaResponse);
      const historyBody = campaign.imageName
        ? `[Imagem: ${campaign.imageName}] ${campaign.message}`.trim()
        : campaign.message;

      await prisma.$transaction(async (tx) => {
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
            body: historyBody
          }
        });

        await tx.contact.update({
          where: { id: recipient.contactId },
          data: { lastMessage: historyBody }
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
            sentAt: new Date(),
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
