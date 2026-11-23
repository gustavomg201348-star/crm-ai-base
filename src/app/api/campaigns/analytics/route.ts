import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireCompanyAdmin } from "@/lib/permissions";
import { readReplySnapshot } from "@/lib/meta-reply-snapshot";
import { safeLogError } from "@/lib/safe-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Period = "today" | "7d" | "30d";

function saoPauloDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day)
  };
}

function startOfSaoPauloDay(date = new Date()) {
  const local = saoPauloDateParts(date);
  return new Date(
    `${String(local.year).padStart(4, "0")}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}T00:00:00-03:00`
  );
}

function startForPeriod(period: Period) {
  const start = startOfSaoPauloDay();
  const daysBack = period === "today" ? 0 : period === "7d" ? 6 : 29;
  start.setUTCDate(start.getUTCDate() - daysBack);
  return start;
}

function dateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function shortLabel(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "short"
  }).format(date).replace(".", "");
}

function ratio(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function chunked<T>(items: T[], size = 1000) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const rawPeriod = request.nextUrl.searchParams.get("period") ?? "7d";
    const period: Period = rawPeriod === "today" || rawPeriod === "30d" ? rawPeriod : "7d";
    const from = startForPeriod(period);

    const recentRecipients = await prisma.campaignRecipient.findMany({
      where: {
        campaign: {
          companyId: session.companyId,
          messageType: "TEMPLATE"
        },
        OR: [
          { createdAt: { gte: from } },
          { sentAt: { gte: from } },
          { deliveredAt: { gte: from } },
          { failedAt: { gte: from } }
        ]
      },
      select: { campaignId: true }
    });

    const periodMessageRefs = await prisma.message.findMany({
      where: {
        conversation: { contact: { companyId: session.companyId } },
        OR: [
          {
            direction: "outbound",
            readAt: { gte: from },
            providerMessageId: { not: null }
          },
          {
            direction: "inbound",
            createdAt: { gte: from },
            replyToProviderMessageId: { not: null },
            metaReplySnapshot: { not: null }
          }
        ]
      },
      select: {
        providerMessageId: true,
        replyToProviderMessageId: true
      }
    });

    const eventProviderIds = Array.from(new Set(
      periodMessageRefs.flatMap((message) =>
        [message.providerMessageId, message.replyToProviderMessageId]
          .filter((value): value is string => Boolean(value))
      )
    ));

    const eventRecipientGroups = eventProviderIds.length
      ? await Promise.all(
          chunked(eventProviderIds).map((providerIds) =>
            prisma.campaignRecipient.findMany({
              where: {
                providerMessageId: { in: providerIds },
                campaign: {
                  companyId: session.companyId,
                  messageType: "TEMPLATE"
                }
              },
              select: { campaignId: true }
            })
          )
        )
      : [];

    const campaignIds = Array.from(new Set([
      ...recentRecipients.map((recipient) => recipient.campaignId),
      ...eventRecipientGroups.flat().map((recipient) => recipient.campaignId)
    ]));

    const campaigns = campaignIds.length
      ? await prisma.campaign.findMany({
          where: {
            id: { in: campaignIds },
            companyId: session.companyId,
            messageType: "TEMPLATE"
          },
          select: {
            id: true,
            name: true,
            templateName: true,
            createdAt: true,
            total: true,
            recipients: {
              select: {
                id: true,
                contactId: true,
                providerMessageId: true,
                status: true,
                sentAt: true,
                deliveredAt: true,
                failedAt: true,
                createdAt: true,
                conversationId: true,
                contact: { select: { name: true } }
              }
            }
          },
          orderBy: { createdAt: "desc" }
        })
      : [];

    const providerIds = Array.from(new Set(
      campaigns.flatMap((campaign) =>
        campaign.recipients
          .map((recipient) => recipient.providerMessageId)
          .filter((value): value is string => Boolean(value))
      )
    ));

    const outboundGroups = providerIds.length
      ? await Promise.all(
          chunked(providerIds).map((providerIdChunk) =>
            prisma.message.findMany({
              where: {
                providerMessageId: { in: providerIdChunk },
                direction: "outbound",
                readAt: { gte: from },
                conversation: { contact: { companyId: session.companyId } }
              },
              select: { providerMessageId: true, readAt: true }
            })
          )
        )
      : [];
    const outboundMessages = outboundGroups.flat();

    const inboundGroups = providerIds.length
      ? await Promise.all(
          chunked(providerIds).map((providerIdChunk) =>
            prisma.message.findMany({
              where: {
                direction: "inbound",
                createdAt: { gte: from },
                replyToProviderMessageId: { in: providerIdChunk },
                metaReplySnapshot: { not: null },
                conversation: { contact: { companyId: session.companyId } }
              },
              select: {
                id: true,
                body: true,
                createdAt: true,
                replyToProviderMessageId: true,
                metaReplySnapshot: true,
                conversation: {
                  select: {
                    contactId: true,
                    contact: { select: { name: true } }
                  }
                }
              }
            })
          )
        )
      : [];
    const inboundReplies = inboundGroups.flat().sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );

    const readAtByProvider = new Map<string, Date>();
    for (const message of outboundMessages) {
      if (!message.providerMessageId || !message.readAt) continue;
      readAtByProvider.set(message.providerMessageId, message.readAt);
    }
    const readProviderIds = new Set(readAtByProvider.keys());

    const recipientByProvider = new Map<string, {
      campaignId: string;
      recipientId: string;
      contactId: string;
      contactName: string;
    }>();
    for (const campaign of campaigns) {
      for (const recipient of campaign.recipients) {
        if (!recipient.providerMessageId) continue;
        recipientByProvider.set(recipient.providerMessageId, {
          campaignId: campaign.id,
          recipientId: recipient.id,
          contactId: recipient.contactId,
          contactName: recipient.contact.name
        });
      }
    }

    const buttonInteractions: Array<{
      messageId: string;
      campaignId: string;
      recipientId: string;
      contactId: string;
      contactName: string;
      optionTitle: string;
      createdAt: Date;
    }> = [];

    for (const reply of inboundReplies) {
      if (!reply.metaReplySnapshot || !reply.replyToProviderMessageId) continue;
      const recipient = recipientByProvider.get(reply.replyToProviderMessageId);
      if (!recipient) continue;
      try {
        const snapshot = readReplySnapshot(reply.metaReplySnapshot);
        if (snapshot.metadata.interactionType !== "TEMPLATE_BUTTON") continue;
        buttonInteractions.push({
          messageId: reply.id,
          campaignId: recipient.campaignId,
          recipientId: recipient.recipientId,
          contactId: recipient.contactId,
          contactName: reply.conversation.contact.name || recipient.contactName,
          optionTitle: snapshot.metadata.optionTitle ?? reply.body,
          createdAt: reply.createdAt
        });
      } catch {
        continue;
      }
    }

    const clickedRecipientIds = new Set(buttonInteractions.map((item) => item.recipientId));
    const readRecipientIds = new Set<string>();
    for (const campaign of campaigns) {
      for (const recipient of campaign.recipients) {
        if (recipient.providerMessageId && readProviderIds.has(recipient.providerMessageId)) {
          readRecipientIds.add(recipient.id);
        }
      }
    }

    let sent = 0;
    let delivered = 0;
    let failed = 0;
    let pending = 0;
    for (const campaign of campaigns) {
      for (const recipient of campaign.recipients) {
        if (recipient.sentAt && recipient.sentAt >= from) sent += 1;
        if (recipient.deliveredAt && recipient.deliveredAt >= from) delivered += 1;
        if (recipient.failedAt && recipient.failedAt >= from) failed += 1;
        if (recipient.status === "PENDING" && recipient.createdAt >= from) pending += 1;
      }
    }

    const clicks = clickedRecipientIds.size;
    const read = readRecipientIds.size;

    const campaignRows = campaigns.map((campaign) => {
      const campaignClicked = new Set(
        buttonInteractions
          .filter((item) => item.campaignId === campaign.id)
          .map((item) => item.recipientId)
      ).size;
      const campaignRead = campaign.recipients.filter((recipient) =>
        readRecipientIds.has(recipient.id)
      ).length;
      const campaignSent = campaign.recipients.filter(
        (recipient) => recipient.sentAt && recipient.sentAt >= from
      ).length;
      const campaignDelivered = campaign.recipients.filter(
        (recipient) => recipient.deliveredAt && recipient.deliveredAt >= from
      ).length;
      const campaignFailed = campaign.recipients.filter(
        (recipient) => recipient.failedAt && recipient.failedAt >= from
      ).length;
      const campaignPending = campaign.recipients.filter(
        (recipient) => recipient.status === "PENDING" && recipient.createdAt >= from
      ).length;

      return {
        id: campaign.id,
        name: campaign.name,
        templateName: campaign.templateName,
        createdAt: campaign.createdAt,
        sent: campaignSent,
        delivered: campaignDelivered,
        read: campaignRead,
        clicks: campaignClicked,
        failed: campaignFailed,
        pending: campaignPending,
        interactionRate: ratio(campaignClicked, campaignDelivered)
      };
    });

    const days = period === "today" ? 1 : period === "7d" ? 7 : 30;
    const daily = new Map<string, {
      key: string;
      label: string;
      sent: number;
      delivered: number;
      read: number;
      clicks: number;
    }>();
    const cursor = new Date(from);
    for (let index = 0; index < days; index += 1) {
      const key = dateKey(cursor);
      daily.set(key, { key, label: shortLabel(key), sent: 0, delivered: 0, read: 0, clicks: 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    for (const campaign of campaigns) {
      for (const recipient of campaign.recipients) {
        if (recipient.sentAt) {
          const key = dateKey(recipient.sentAt);
          const item = daily.get(key);
          if (item) item.sent += 1;
        }
        if (recipient.deliveredAt) {
          const key = dateKey(recipient.deliveredAt);
          const item = daily.get(key);
          if (item) item.delivered += 1;
        }
        if (recipient.providerMessageId) {
          const readAt = readAtByProvider.get(recipient.providerMessageId);
          if (readAt) {
            const key = dateKey(readAt);
            const item = daily.get(key);
            if (item) item.read += 1;
          }
        }
      }
    }
    for (const click of buttonInteractions) {
      const key = dateKey(click.createdAt);
      const item = daily.get(key);
      if (item) item.clicks += 1;
    }

    return NextResponse.json({
      period,
      from: from.toISOString(),
      metrics: {
        sent,
        delivered,
        read,
        failed,
        pending,
        clicks,
        deliveryRate: ratio(delivered, sent),
        readRate: ratio(read, delivered),
        clickRateFromRead: ratio(clicks, read),
        interactionRate: ratio(clicks, delivered)
      },
      daily: Array.from(daily.values()),
      campaigns: campaignRows.slice(0, 12),
      interactions: buttonInteractions.slice(0, 20).map((item) => ({
        id: item.messageId,
        campaignId: item.campaignId,
        contactName: item.contactName,
        optionTitle: item.optionTitle,
        createdAt: item.createdAt
      }))
    });
  } catch (error) {
    safeLogError("http-api", error, {
      route: "/api/campaigns/analytics",
      method: "GET",
      publicErrorCode: "CAMPAIGN_ANALYTICS_FAILED",
      status: 500
    });
    return NextResponse.json(
      { error: "Nao foi possivel carregar o painel de disparos." },
      { status: 500 }
    );
  }
}
