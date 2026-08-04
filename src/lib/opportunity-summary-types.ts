export type OpportunityProductType =
  | "UNKNOWN"
  | "FGTS"
  | "CLT"
  | "INSS"
  | "MULTICRED"
  | "PORTABILITY"
  | "INSURANCE"
  | "OTHER";

export type OpportunityCommercialState =
  | "ACTION_REQUIRED"
  | "WAITING_CUSTOMER"
  | "FOLLOW_UP"
  | "PROPOSAL"
  | "NURTURING"
  | "NO_CLEAR_OPPORTUNITY";

export type OpportunityContextLevel = "LOW" | "MEDIUM" | "HIGH";

export type OpportunityEvidenceType =
  | "CUSTOMER_REPLIED_RECENTLY"
  | "RETURN_OVERDUE"
  | "RETURN_SCHEDULED"
  | "ACTIVE_PROPOSAL"
  | "HOT_CONTACT"
  | "UNREAD_MESSAGES"
  | "RECENT_CAMPAIGN"
  | "HIGH_RETIREMENT_SCORE"
  | "RECENT_CLT_SIMULATION";

export type OpportunityEvidenceSourceType =
  | "conversation"
  | "message"
  | "task"
  | "proposal"
  | "contact"
  | "campaign"
  | "retirementLead"
  | "cltSimulation";

export type OpportunityRecommendedActionType =
  | "RESPOND_CUSTOMER"
  | "FOLLOW_UP"
  | "REVIEW_PROPOSAL"
  | "SIMULATE_CLT"
  | "SEND_TEMPLATE"
  | "WAIT"
  | "NO_ACTION";

export type OpportunityReference = {
  id: string;
  label: string;
};

export type OpportunityLastRelevantInteraction = {
  type: "CUSTOMER_MESSAGE" | "OPERATOR_MESSAGE" | "CAMPAIGN" | "PROPOSAL" | "RETURN" | "NONE";
  label: string;
  occurredAt: Date | null;
};

export type OpportunityPendingReturn = {
  id: string;
  title: string;
  dueAt: Date;
  overdue: boolean;
  assignee: OpportunityReference | null;
};

export type OpportunityActiveProposal = {
  id: string;
  product: string;
  status: string;
  amount: string | null;
  assignedUser: OpportunityReference | null;
  updatedAt: Date;
};

export type OpportunityRecentCampaign = {
  id: string;
  name: string;
  status: string;
  templateName: string | null;
  channel: string | null;
  occurredAt: Date;
};

export type OpportunityEvidence = {
  type: OpportunityEvidenceType;
  label: string;
  occurredAt: Date | null;
  sourceType: OpportunityEvidenceSourceType;
  sourceId: string | null;
};

export type OpportunityRecommendedAction = {
  type: OpportunityRecommendedActionType;
  label: string;
  reason: string;
  evidenceTypes: OpportunityEvidenceType[];
};

export type OpportunitySummary = {
  contactId: string;
  conversationId: string;
  probableProduct: {
    type: OpportunityProductType;
    label: string;
    reason: string;
  };
  commercialState: {
    type: OpportunityCommercialState;
    label: string;
  };
  lastRelevantInteraction: OpportunityLastRelevantInteraction;
  pendingReturn: OpportunityPendingReturn | null;
  activeProposal: OpportunityActiveProposal | null;
  recentCampaign: OpportunityRecentCampaign | null;
  evidences: OpportunityEvidence[];
  recommendedAction: OpportunityRecommendedAction;
  recommendedActionReason: string;
  contextLevel: OpportunityContextLevel;
};

export type OpportunitySummaryConversationInput = {
  id: string;
  contactId: string;
  agentId?: string | null;
  unreadCount?: number | null;
  lastMessageAt?: Date | null;
  lastInboundMessageAt?: Date | null;
  lastReadAt?: Date | null;
  updatedAt: Date;
  status: string;
  contact: {
    id: string;
    temperature?: string | null;
    stage?: { name: string } | null;
    tags?: Array<{ tag: { id: string; name: string } }>;
  };
  messages: Array<{
    id: string;
    direction: string;
    body: string;
    createdAt: Date;
  }>;
};

export type OpportunitySummaryProposalInput = {
  id: string;
  product: string;
  status: string;
  amount?: { toString(): string } | string | number | null;
  updatedAt: Date;
  assignedUser?: { id: string; name: string } | null;
};

export type OpportunitySummaryTaskInput = {
  id: string;
  title: string;
  dueAt: Date;
  status: string;
  assignee?: { id: string; name: string } | null;
};

export type OpportunitySummaryCampaignInput = {
  id: string;
  status: string;
  sentAt?: Date | null;
  deliveredAt?: Date | null;
  createdAt: Date;
  campaign: {
    id: string;
    name: string;
    templateName?: string | null;
    updatedAt: Date;
    channel?: { name: string } | null;
  };
};

export type OpportunitySummaryRetirementLeadInput = {
  id: string;
  score: number;
  journeyStatus: string;
  interestLevel: string;
  updatedAt: Date;
};

export type OpportunitySummaryCltSimulationInput = {
  id: string;
  status: string;
  createdAt: Date;
};

export type BuildOpportunitySummaryInput = {
  now?: Date;
  conversation: OpportunitySummaryConversationInput;
  pendingTasks: OpportunitySummaryTaskInput[];
  proposals: OpportunitySummaryProposalInput[];
  campaignRecipients: OpportunitySummaryCampaignInput[];
  retirementLead: OpportunitySummaryRetirementLeadInput | null;
  recentCltSimulation: OpportunitySummaryCltSimulationInput | null;
};
