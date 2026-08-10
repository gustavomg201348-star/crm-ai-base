import type { OpportunityPriorityLevel } from "@/lib/opportunity-summary-types";

export type CommercialControlMetric = {
  label: string;
  value: number;
  description: string;
};

export type CommercialControlTaskItem = {
  id: string;
  title: string;
  dueAt: string;
  contact: {
    id: string;
    name: string;
    phone: string | null;
  };
  assignee: {
    id: string;
    name: string;
  } | null;
};

export type CommercialControlAgendaBucket = {
  total: number;
  items: CommercialControlTaskItem[];
};

export type CommercialControlOpportunityItem = {
  id: string;
  conversationId: string;
  contactName: string;
  ownerName: string;
  priority: OpportunityPriorityLevel;
  productLabel: string;
  reason: string;
  actionLabel: string;
};

export type CommercialControlStatusCount = {
  status: string;
  count: number;
};

export type CommercialControlCampaignItem = {
  id: string;
  name: string;
  status: string;
  total: number;
  sent: number;
  failed: number;
  updatedAt: string;
};

export type CommercialControlPipelineStage = {
  id: string | null;
  name: string;
  color: string | null;
  position: number;
  count: number;
};

export type CommercialControlOverview = {
  generatedAt: string;
  period: {
    timeZone: string;
    todayStart: string;
    todayEnd: string;
    tomorrowStart: string;
    tomorrowEnd: string;
  };
  today: {
    activeOrMovedConversations: number;
    pendingConversations: number;
    proposalsCreated: number;
    contractsClosed: number;
    priorityOpportunities: number;
  };
  attention: {
    overdueTasks: number;
    todayTasks: number;
    priorityOpportunities: number;
    activeProposals: number;
  };
  agenda: {
    overdue: CommercialControlAgendaBucket;
    today: CommercialControlAgendaBucket;
    tomorrow: CommercialControlAgendaBucket;
  };
  opportunities: {
    total: number;
    scanned: number;
    byPriority: Array<{
      priority: OpportunityPriorityLevel;
      count: number;
    }>;
    items: CommercialControlOpportunityItem[];
  };
  proposals: {
    createdToday: number;
    contractsToday: number;
    activeTotal: number;
    byStatus: CommercialControlStatusCount[];
  };
  campaigns: {
    todayTotal: number;
    activeTotal: number;
    sentToday: number;
    items: CommercialControlCampaignItem[];
  };
  pipeline: {
    totalContacts: number;
    stages: CommercialControlPipelineStage[];
  };
};
