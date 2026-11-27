import { Prisma, type PrismaClient } from "@prisma/client";
import { analyticsCte } from "./campaign-analytics-query";
import {
  analyticsRatio,
  type CampaignAnalyticsFilters,
} from "./campaign-analytics-policy";
import { replyProvider, type ReplyProvider } from "./meta-reply-storage";
type Row = Record<string, string | number | bigint | Date | null>;
const metricsSql = Prisma.sql`COUNT(*) AS selected,COUNT(DISTINCT f."contactId") AS recipients,
 COALESCE(SUM(f.sent),0) AS sent,COALESCE(SUM(f.delivered),0) AS delivered,COALESCE(SUM(f."officialRead"),0) AS read,
 COALESCE(SUM(CASE WHEN f.status='FAILED' THEN 1 ELSE 0 END),0) AS failed,COALESCE(SUM(CASE WHEN f.status='PENDING' THEN 1 ELSE 0 END),0) AS pending,
 COALESCE(SUM(CASE WHEN f.status='CANCELED' THEN 1 ELSE 0 END),0) AS canceled,
 COALESCE(SUM(CASE WHEN f."officialRead"=0 AND (f."clickEvents">0 OR f."textEvents">0) THEN 1 ELSE 0 END),0) AS "additionalReads",
 COALESCE(SUM(CASE WHEN f."officialRead"=1 OR f."clickEvents">0 OR f."textEvents">0 THEN 1 ELSE 0 END),0) AS "identifiedReads",
 COALESCE(SUM(f."clickEvents"),0) AS "clickEvents",COALESCE(SUM(f."textEvents"),0) AS "textEvents",
 COUNT(DISTINCT CASE WHEN f.sent=1 THEN f."contactId" END) AS "eligibleRecipients",
 COUNT(DISTINCT CASE WHEN f."clickEvents">0 THEN f."contactId" END) AS clicks,
 COUNT(DISTINCT CASE WHEN f."textEvents">0 THEN f."contactId" END) AS "textRespondents",
 COUNT(DISTINCT CASE WHEN f."clickEvents">0 OR f."textEvents">0 THEN f."contactId" END) AS "interactedRecipients",
 COALESCE(SUM(CASE WHEN f.delivered=0 AND (f."clickEvents">0 OR f."textEvents">0) THEN 1 ELSE 0 END),0) AS "interactionWithoutDelivery",
 COALESCE(SUM(CASE WHEN f.sent=1 AND f."sourceMessageId" IS NULL THEN 1 ELSE 0 END),0) AS "missingSource"`;
export function campaignMetrics(row: Row) {
  const n = (key: string) => Number(row[key] ?? 0);
  return {
    selected: n("selected"),
    recipients: n("recipients"),
    sent: n("sent"),
    delivered: n("delivered"),
    read: n("read"),
    failed: n("failed"),
    pending: n("pending"),
    canceled: n("canceled"),
    clicks: n("clicks"),
    clickEvents: n("clickEvents"),
    textEvents: n("textEvents"),
    textRespondents: n("textRespondents"),
    interactedRecipients: n("interactedRecipients"),
    eligibleRecipients: n("eligibleRecipients"),
    additionalReads: n("additionalReads"),
    identifiedReads: n("identifiedReads"),
    interactionWithoutDelivery: n("interactionWithoutDelivery"),
    missingSource: n("missingSource"),
    deliveryRate: analyticsRatio(n("delivered"), n("sent")),
    readRate: analyticsRatio(n("read"), n("sent")),
    identifiedReadRate: analyticsRatio(n("identifiedReads"), n("sent")),
    clickRate: analyticsRatio(n("clicks"), n("eligibleRecipients")),
    clickRateFromRead: analyticsRatio(n("clicks"), n("eligibleRecipients")),
    interactionRate: analyticsRatio(
      n("interactedRecipients"),
      n("eligibleRecipients"),
    ),
  };
}
function clean(row: Row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === "bigint" ? Number(value) : value,
    ]),
  );
}
function timestamp(value: Row[string]) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(
    typeof value === "bigint" ? Number(value) : value,
  ).toISOString();
}
function logRow(
  row: Row,
): Record<string, string | number | boolean | Date | null> {
  return {
    ...clean(row),
    cohortAt: timestamp(row.cohortAt),
    sentAt: timestamp(row.sentAt),
    deliveredAt: timestamp(row.deliveredAt),
    readAt: timestamp(row.readAt),
    lastInteractionAt: timestamp(row.lastInteractionAt),
    officialRead: Number(row.officialRead) === 1,
    identifiedRead:
      Number(row.officialRead) === 1 ||
      Number(row.clickEvents) > 0 ||
      Number(row.textEvents) > 0,
  };
}
export class AnalyticsScopeError extends Error {}
export async function campaignAnalytics(
  db: PrismaClient,
  companyId: string,
  f: CampaignAnalyticsFilters,
  mode: "dashboard" | "export" = "dashboard",
  provider: ReplyProvider = replyProvider(),
) {
  const cte = analyticsCte(companyId, f, provider);
  return db.$transaction(
    async (tx) => {
      if (provider === "postgresql") {
        await tx.$executeRaw`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout='10000ms'`;
      }
      const selectedCampaign = f.campaignId
        ? await tx.campaign.findFirst({
            where: { id: f.campaignId, companyId, messageType: "TEMPLATE" },
            select: { id: true, name: true },
          })
        : null;
      const selectedChannel = f.channelId
        ? await tx.channel.findFirst({
            where: { id: f.channelId, companyId },
            select: { id: true, name: true },
          })
        : null;
      if (
        (f.campaignId && !selectedCampaign) ||
        (f.channelId && !selectedChannel)
      )
        throw new AnalyticsScopeError();
      const logQuery = Prisma.sql`${cte.sql} SELECT f.*, (SELECT e."optionTitle" FROM events e WHERE e."recipientId"=f.id AND e.kind='TEMPLATE_BUTTON' ORDER BY e."createdAt" DESC,e."inboundId" DESC LIMIT 1) AS "lastButton"
   FROM filtered f ORDER BY f."cohortAt" DESC,f.id DESC LIMIT ${mode === "export" ? 10001 : 51} OFFSET ${mode === "export" ? 0 : f.page * 50}`;
      if (mode === "export") {
        const rows = await tx.$queryRaw<Row[]>(logQuery);
        if (rows.length > 10000) throw Error("EXPORT_LIMIT");
        return { rows: rows.map(logRow) };
      }
      const [
        total,
        groups,
        daily,
        buttons,
        logs,
        interactions,
        options,
        channels,
        templates,
        unquoted,
      ] = await Promise.all([
        tx.$queryRaw<Row[]>(
          Prisma.sql`${cte.sql} SELECT ${metricsSql} FROM filtered f`,
        ),
        tx.$queryRaw<Row[]>(
          Prisma.sql`${cte.sql} SELECT f."campaignId",f."campaignName",f."templateName",f."channelId",f."channelName",MIN(f."cohortAt") AS "createdAt",${metricsSql} FROM filtered f GROUP BY f."campaignId",f."campaignName",f."templateName",f."channelId",f."channelName" ORDER BY MIN(f."cohortAt") DESC,f."campaignId" LIMIT 51 OFFSET ${f.groupPage * 50}`,
        ),
        tx.$queryRaw<Row[]>(
          Prisma.sql`${cte.sql} SELECT ${cte.day} AS key,${metricsSql} FROM filtered f GROUP BY ${cte.day} ORDER BY key`,
        ),
        tx.$queryRaw<Row[]>(
          Prisma.sql`${cte.sql} SELECT f."campaignId",f."campaignName",f."channelId",f."channelName",f."templateName",e."optionId",e."optionTitle",COUNT(*) AS events,COUNT(DISTINCT e."contactId") AS recipients FROM events e JOIN filtered f ON f.id=e."recipientId" WHERE e.kind='TEMPLATE_BUTTON' GROUP BY f."campaignId",f."campaignName",f."channelId",f."channelName",f."templateName",e."optionId",e."optionTitle" ORDER BY COUNT(*) DESC,f."campaignId",e."optionId",e."optionTitle" LIMIT 51 OFFSET ${f.groupPage * 50}`,
        ),
        tx.$queryRaw<Row[]>(logQuery),
        tx.$queryRaw<Row[]>(
          Prisma.sql`${cte.sql} SELECT e."inboundId" AS id,e.kind,e."optionTitle",e."createdAt",f."campaignId",f."campaignName",f."contactName",f."channelName",f."templateName" FROM events e JOIN filtered f ON f.id=e."recipientId" ORDER BY e."createdAt" DESC,e."inboundId" DESC LIMIT 20`,
        ),
        tx.campaign.findMany({
          where: { companyId, messageType: "TEMPLATE" },
          select: { id: true, name: true },
          orderBy: { createdAt: "desc" },
          take: 101,
        }),
        tx.channel.findMany({
          where: { companyId },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
          take: 101,
        }),
        tx.campaign.groupBy({
          by: ["templateName"],
          where: { companyId, messageType: "TEMPLATE" },
          orderBy: { templateName: "asc" },
          take: 101,
        }),
        f.campaignId || f.templateName
          ? Promise.resolve(null)
          : tx.message.count({
              where: {
                direction: "inbound",
                type: "text",
                senderType: "customer",
                createdAt: { gte: f.from, lte: f.to },
                replyToProviderMessageId: null,
                inboundEvent: {
                  is: {
                    companyId,
                    ...(f.channelId ? { channelId: f.channelId } : {}),
                    provenanceKind: "META_WEBHOOK_HMAC_SHA256_VERIFIED",
                    provenanceVersion: 1,
                  },
                },
                conversation: {
                  contact: { companyId },
                  ...(f.channelId ? { channelId: f.channelId } : {}),
                },
              },
            }),
      ]);
      const dailyMap = new Map(
        daily.map((row) => [String(row.key), campaignMetrics(row)]),
      );
      const days = [];
      const cursor = new Date(f.from);
      while (cursor <= f.to && days.length < 31) {
        const key = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Sao_Paulo",
        }).format(cursor);
        const metrics = dailyMap.get(key) ?? campaignMetrics({});
        days.push({
          key,
          label: key.slice(8) + "/" + key.slice(5, 7),
          ...metrics,
        });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      return {
        period: f.period,
        from: f.from.toISOString(),
        to: f.to.toISOString(),
        metrics: campaignMetrics(total[0] ?? {}),
        daily: days,
        campaigns: groups.slice(0, 50).map((row) => ({
          id: String(row.campaignId),
          name: String(row.campaignName),
          templateName: row.templateName,
          channelName: row.channelName,
          channelId: row.channelId,
          createdAt: timestamp(row.createdAt),
          ...campaignMetrics(row),
        })),
        buttons: buttons.slice(0, 50).map(clean),
        logs: logs.slice(0, 50).map(logRow),
        interactions: interactions.map((row) => ({
          ...clean(row),
          createdAt: timestamp(row.createdAt),
        })),
        pagination: {
          page: f.page,
          hasMore: logs.length > 50,
          groupPage: f.groupPage,
          groupsHaveMore: groups.length > 50,
          buttonsHaveMore: buttons.length > 50,
        },
        options: {
          campaigns: selectedCampaign
            ? [
                selectedCampaign,
                ...options
                  .filter((o) => o.id !== selectedCampaign.id)
                  .slice(0, 99),
              ]
            : options.slice(0, 100),
          channels: selectedChannel
            ? [
                selectedChannel,
                ...channels
                  .filter((o) => o.id !== selectedChannel.id)
                  .slice(0, 99),
              ]
            : channels.slice(0, 100),
          templates: Array.from(
            new Set([
              ...(f.templateName ? [f.templateName] : []),
              ...templates
                .map((t) => t.templateName)
                .filter((t): t is string => Boolean(t)),
            ]),
          ).slice(0, 100),
          truncated:
            options.length > 100 ||
            channels.length > 100 ||
            templates.length > 100,
        },
        unattributed: { unquotedText: unquoted },
        scope: f.campaignId ? "CAMPAIGN" : "CONSOLIDATED",
        unit: "CURRENT_RECIPIENT_SEND_COHORT_V1",
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 2000,
      timeout: 20000,
    },
  );
}
