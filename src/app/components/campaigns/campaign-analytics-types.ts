export type AnalyticsMetrics = {
  selected: number;
  recipients: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  pending: number;
  canceled: number;
  clicks: number;
  clickEvents: number;
  textEvents: number;
  textRespondents: number;
  interactedRecipients: number;
  eligibleRecipients: number;
  additionalReads: number;
  identifiedReads: number;
  interactionWithoutDelivery: number;
  missingSource: number;
  deliveryRate: number;
  readRate: number;
  identifiedReadRate: number;
  clickRate: number;
  clickRateFromRead: number;
  interactionRate: number;
};
export type AnalyticsLog = {
  id: string;
  campaignId: string;
  campaignName: string;
  contactName: string;
  channelName: string;
  templateName: string | null;
  status: string;
  messageStatus: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  identifiedRead: boolean;
  officialRead: boolean;
  clickEvents: number;
  textEvents: number;
  lastButton: string | null;
  lastInteractionAt: string | null;
};
export type CampaignAnalytics = {
  period: "today" | "7d" | "30d";
  from: string;
  to: string;
  metrics: AnalyticsMetrics;
  daily: Array<AnalyticsMetrics & { key: string; label: string }>;
  campaigns: Array<
    AnalyticsMetrics & {
      id: string;
      name: string;
      templateName: string | null;
      channelName: string;
      channelId: string;
      createdAt: string;
    }
  >;
  interactions: Array<{
    id: string;
    campaignId: string;
    campaignName: string;
    contactName: string;
    channelName: string;
    templateName: string | null;
    optionTitle: string | null;
    kind: "TEMPLATE_BUTTON" | "TEXT";
    createdAt: string;
  }>;
  buttons: Array<{
    campaignId: string;
    campaignName: string;
    channelId: string;
    channelName: string;
    templateName: string | null;
    optionId: string | null;
    optionTitle: string | null;
    events: number;
    recipients: number;
  }>;
  logs: AnalyticsLog[];
  pagination: {
    page: number;
    hasMore: boolean;
    groupPage: number;
    groupsHaveMore: boolean;
    buttonsHaveMore: boolean;
  };
  options: {
    campaigns: { id: string; name: string }[];
    channels: { id: string; name: string }[];
    templates: string[];
    truncated: boolean;
  };
  unattributed: { unquotedText: number | null };
  scope: "CAMPAIGN" | "CONSOLIDATED";
  unit: string;
};
export type AnalyticsSelection = {
  campaignId: string;
  channelId: string;
  templateName: string;
  status: string;
  interaction: string;
  search: string;
  page: number;
  groupPage: number;
};
export const emptyAnalyticsSelection: AnalyticsSelection = {
  campaignId: "",
  channelId: "",
  templateName: "",
  status: "ALL",
  interaction: "ALL",
  search: "",
  page: 0,
  groupPage: 0,
};
