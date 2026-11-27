export const analyticsStatuses = [
  "ALL",
  "SENT",
  "DELIVERED",
  "READ",
  "PENDING",
  "FAILED",
  "CANCELED",
  "NO_RECEIPT",
] as const;
export const analyticsInteractions = [
  "ALL",
  "CLICKED",
  "TEXT_REPLY",
  "INTERACTED",
  "NO_INTERACTION",
  "IDENTIFIED",
  "ADDITIONAL_READ",
] as const;
export type CampaignAnalyticsFilters = {
  period: "today" | "7d" | "30d";
  from: Date;
  to: Date;
  campaignId: string;
  channelId: string;
  templateName: string;
  status: (typeof analyticsStatuses)[number];
  interaction: (typeof analyticsInteractions)[number];
  search: string;
  page: number;
  groupPage: number;
};
export function analyticsRatio(numerator: number, denominator: number) {
  return denominator > 0
    ? Math.round(Math.min(1, Math.max(0, numerator / denominator)) * 1000) / 10
    : 0;
}
export function analyticsFilters(
  params: URLSearchParams,
  now = new Date(),
): CampaignAnalyticsFilters {
  const period = params.get("period") ?? "7d";
  if (!["today", "7d", "30d"].includes(period)) throw Error("INVALID_FILTER");
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(now);
  const from = new Date(day + "T00:00:00-03:00");
  from.setUTCDate(
    from.getUTCDate() - (period === "today" ? 0 : period === "7d" ? 6 : 29),
  );
  const status = params.get("status") ?? "ALL",
    interaction = params.get("interaction") ?? "ALL";
  if (
    !(analyticsStatuses as readonly string[]).includes(status) ||
    !(analyticsInteractions as readonly string[]).includes(interaction)
  )
    throw Error("INVALID_FILTER");
  const page = Number(params.get("page") ?? 0),
    groupPage = Number(params.get("groupPage") ?? 0);
  if (
    !Number.isInteger(page) ||
    page < 0 ||
    page > 10000 ||
    !Number.isInteger(groupPage) ||
    groupPage < 0 ||
    groupPage > 10000
  )
    throw Error("INVALID_PAGE");
  const field = (key: string, max: number) => {
    const value = (params.get(key) ?? "").trim();
    if (value.length > max) throw Error("INVALID_FILTER");
    return value;
  };
  return {
    period: period as CampaignAnalyticsFilters["period"],
    from,
    to: now,
    campaignId: field("campaignId", 150),
    channelId: field("channelId", 150),
    templateName: field("templateName", 250),
    status: status as CampaignAnalyticsFilters["status"],
    interaction: interaction as CampaignAnalyticsFilters["interaction"],
    search: field("search", 100),
    page,
    groupPage,
  };
}
