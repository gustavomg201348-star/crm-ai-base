import { Prisma } from "@prisma/client";
import type { ReplyProvider } from "./meta-reply-storage";
import type { CampaignAnalyticsFilters } from "./campaign-analytics-policy";

export function analyticsCte(
  companyId: string,
  f: CampaignAnalyticsFilters,
  provider: ReplyProvider,
) {
  const pg = provider === "postgresql";
  const safe = pg
    ? Prisma.sql`CASE WHEN pg_input_is_valid(i."metaReplySnapshot",'jsonb') THEN i."metaReplySnapshot"::jsonb ELSE '{}'::jsonb END`
    : Prisma.sql`CASE WHEN json_valid(i."metaReplySnapshot") THEN i."metaReplySnapshot" ELSE '{}' END`;
  const j = (...path: string[]) =>
    pg
      ? Prisma.sql`(${safe} #>> ${"{" + path.join(",") + "}"}::text[])`
      : Prisma.sql`CAST(json_extract(${safe}, ${"$." + path.join(".")}) AS TEXT)`;
  const catalog = pg
    ? Prisma.sql`CASE WHEN pg_input_is_valid(sm."templateVariables",'jsonb') THEN sm."templateVariables"::jsonb ELSE '{}'::jsonb END`
    : Prisma.sql`CASE WHEN json_valid(sm."templateVariables") THEN sm."templateVariables" ELSE '{}' END`;
  const buttonProof = pg
    ? Prisma.sql`(COALESCE(jsonb_typeof(${catalog}->'buttons'),'missing')<>'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${catalog}->'buttons')='array' THEN ${catalog}->'buttons' ELSE '[]'::jsonb END) btn WHERE btn->>'type'='QUICK_REPLY' AND btn->>'text'=COALESCE(${j("metadata", "optionTitle")},${j("metadata", "optionId")})))`
    : Prisma.sql`(COALESCE(json_type(${catalog},'$.buttons'),'missing')<>'array' OR EXISTS(SELECT 1 FROM json_each(${catalog},'$.buttons') btn WHERE CASE WHEN btn.type='object' THEN json_extract(btn.value,'$.type') END='QUICK_REPLY' AND CASE WHEN btn.type='object' THEN json_extract(btn.value,'$.text') END=COALESCE(${j("metadata", "optionTitle")},${j("metadata", "optionId")})))`;
  const date = (value: Date) => (pg ? value : value.getTime());
  const search = pg
    ? Prisma.sql`AND strpos(LOWER(p.name), ${f.search.toLowerCase()})>0`
    : Prisma.sql`AND instr(LOWER(p.name), ${f.search.toLowerCase()})>0`;
  const day = pg
    ? Prisma.sql`to_char((f."cohortAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD')`
    : Prisma.sql`strftime('%Y-%m-%d',f."cohortAt"/1000,'unixepoch','-3 hours')`;
  const status: Record<string, Prisma.Sql> = {
    ALL: Prisma.sql`1=1`,
    SENT: Prisma.sql`f.sent=1`,
    DELIVERED: Prisma.sql`f.delivered=1`,
    READ: Prisma.sql`f."officialRead"=1`,
    PENDING: Prisma.sql`f.status='PENDING'`,
    FAILED: Prisma.sql`f.status='FAILED'`,
    CANCELED: Prisma.sql`f.status='CANCELED'`,
    NO_RECEIPT: Prisma.sql`f.delivered=0 AND f."clickEvents"=0 AND f."textEvents"=0`,
  };
  const interaction: Record<string, Prisma.Sql> = {
    ALL: Prisma.sql`1=1`,
    CLICKED: Prisma.sql`f."clickEvents">0`,
    TEXT_REPLY: Prisma.sql`f."textEvents">0`,
    INTERACTED: Prisma.sql`f."clickEvents">0 OR f."textEvents">0`,
    NO_INTERACTION: Prisma.sql`f."clickEvents"=0 AND f."textEvents"=0`,
    IDENTIFIED: Prisma.sql`f."officialRead"=1 OR f."clickEvents">0 OR f."textEvents">0`,
    ADDITIONAL_READ: Prisma.sql`f."officialRead"=0 AND (f."clickEvents">0 OR f."textEvents">0)`,
  };
  return {
    day,
    sql: Prisma.sql`WITH base AS (
 SELECT r.id,r."campaignId",r."contactId",r."conversationId",r."providerMessageId",r.status,r."sentAt",r."deliveredAt",r."failedAt",
 COALESCE(r."sentAt",r."createdAt") AS "cohortAt",c.name AS "campaignName",c."channelId",ch.name AS "channelName",c."templateName",p.name AS "contactName",p.phone,
 m.id AS "sourceMessageId",m."readAt",m.status AS "messageStatus"
 FROM "CampaignRecipient" r JOIN "Campaign" c ON c.id=r."campaignId"
 JOIN "Contact" p ON p.id=r."contactId" AND p."companyId"=c."companyId"
 JOIN "Channel" ch ON ch.id=c."channelId" AND ch."companyId"=c."companyId"
 LEFT JOIN "Conversation" v ON v.id=r."conversationId" AND v."contactId"=r."contactId" AND v."channelId"=c."channelId"
 LEFT JOIN "Message" m ON m."conversationId"=v.id AND m.direction='outbound' AND m.type='template' AND m."providerMessageId"=r."providerMessageId"
 AND (m."templateName"=c."templateName" OR m."templateName" IS NULL)
 AND (SELECT COUNT(*) FROM "Message" mx JOIN "Conversation" vx ON vx.id=mx."conversationId" JOIN "Contact" px ON px.id=vx."contactId"
      WHERE mx."providerMessageId"=r."providerMessageId" AND mx.direction='outbound' AND px."companyId"=c."companyId" AND vx."channelId"=c."channelId")=1
 AND (SELECT COUNT(*) FROM "CampaignRecipient" rx JOIN "Campaign" cx ON cx.id=rx."campaignId"
      WHERE rx."providerMessageId"=r."providerMessageId" AND cx."companyId"=c."companyId" AND cx."channelId"=c."channelId")=1
 WHERE c."companyId"=${companyId} AND c."messageType"='TEMPLATE'
 AND COALESCE(r."sentAt",r."createdAt")>=${date(f.from)} AND COALESCE(r."sentAt",r."createdAt")<=${date(f.to)}
 ${f.campaignId ? Prisma.sql`AND c.id=${f.campaignId}` : Prisma.empty}
 ${f.channelId ? Prisma.sql`AND c."channelId"=${f.channelId}` : Prisma.empty}
 ${f.templateName ? Prisma.sql`AND c."templateName"=${f.templateName}` : Prisma.empty}
 ${f.search ? search : Prisma.empty}
 ), candidates AS (
 SELECT b.id AS "recipientId",b."campaignId",b."contactId",b."channelId",i.id AS "inboundId",i."providerMessageId" AS "inboundProviderId",i."createdAt",
 ${j("metadata", "interactionType")} AS kind,${j("metadata", "optionId")} AS "optionId",${j("metadata", "optionTitle")} AS "optionTitle",${j("contentDigest")} AS digest,
 ROW_NUMBER() OVER(PARTITION BY b."channelId",i."providerMessageId" ORDER BY i.id) AS rn
 FROM base b JOIN "Message" sm ON sm.id=b."sourceMessageId" JOIN "Message" i ON i."conversationId"=b."conversationId" AND i."replyToProviderMessageId"=b."providerMessageId"
 JOIN "ConversationInboundEvent" e ON e."messageId"=i.id AND e."companyId"=${companyId} AND e."channelId"=b."channelId" AND e."contactId"=b."contactId" AND e."conversationId"=b."conversationId"
 WHERE b."sourceMessageId" IS NOT NULL AND i.direction='inbound' AND i."senderType"='customer' AND i."providerMessageId" IS NOT NULL
 AND i."metaReplyConflictSnapshot" IS NULL AND i."metaReplySnapshot" IS NOT NULL
 AND e."provenanceKind"='META_WEBHOOK_HMAC_SHA256_VERIFIED' AND e."provenanceVersion"=1
 AND ${j("version")}='1' AND ${j("companyId")}=${companyId} AND ${j("channelId")}=b."channelId"
 AND ${j("conversationId")}=b."conversationId" AND ${j("contactId")}=b."contactId"
 AND ${j("providerMessageId")}=i."providerMessageId" AND ${j("contextProviderMessageId")}=b."providerMessageId"
 AND ((${j("metadata", "interactionType")}='TEMPLATE_BUTTON' AND i.type='button') OR (${j("metadata", "interactionType")}='TEXT' AND i.type='text'))
 AND (${j("metadata", "interactionType")}='TEXT' OR ${buttonProof})
 AND NOT EXISTS(SELECT 1 FROM "ChatbotReplyCorrelation" q WHERE q."inboundMessageId"=i.id AND q.status IN ('CONFLICT','AMBIGUOUS'))
 ), consistent AS (SELECT "channelId","inboundProviderId" FROM candidates GROUP BY "channelId","inboundProviderId" HAVING COUNT(DISTINCT "recipientId")=1 AND COUNT(DISTINCT kind)=1 AND COUNT(DISTINCT COALESCE("optionId",''))=1 AND COUNT(DISTINCT COALESCE("optionTitle",''))=1 AND COUNT(DISTINCT digest)=1),
 events AS (SELECT c.* FROM candidates c JOIN consistent k ON k."channelId"=c."channelId" AND k."inboundProviderId"=c."inboundProviderId" WHERE c.rn=1), activity AS (
 SELECT "recipientId",SUM(CASE WHEN kind='TEMPLATE_BUTTON' THEN 1 ELSE 0 END) AS "clickEvents",SUM(CASE WHEN kind='TEXT' THEN 1 ELSE 0 END) AS "textEvents",MAX("createdAt") AS "lastInteractionAt" FROM events GROUP BY "recipientId"
 ), facts AS (
 SELECT b.*,COALESCE(a."clickEvents",0) AS "clickEvents",COALESCE(a."textEvents",0) AS "textEvents",a."lastInteractionAt",
 CASE WHEN b."sentAt" IS NOT NULL OR b."sourceMessageId" IS NOT NULL OR b."deliveredAt" IS NOT NULL THEN 1 ELSE 0 END AS sent,
 CASE WHEN b."deliveredAt" IS NOT NULL OR b."readAt" IS NOT NULL OR b."messageStatus"='delivered' THEN 1 ELSE 0 END AS delivered,
 CASE WHEN b."readAt" IS NOT NULL THEN 1 ELSE 0 END AS "officialRead"
 FROM base b LEFT JOIN activity a ON a."recipientId"=b.id
 ), filtered AS (SELECT f.* FROM facts f WHERE (${status[f.status]}) AND (${interaction[f.interaction]}))`,
  };
}
