import type {
  OpportunityCommercialState,
  OpportunityEvidence,
  OpportunityLastRelevantInteraction,
  OpportunityPendingReturn,
  OpportunityPrimaryAction,
  OpportunityPriority,
  OpportunityProductType,
  OpportunityActiveProposal
} from "@/lib/opportunity-summary-types";

export type OpportunityQueueProduct = {
  type: OpportunityProductType;
  label: string;
  reason: string;
};

export type OpportunityQueueContact = {
  id: string;
  name: string;
  phone: string | null;
};

export type OpportunityQueueOwner = {
  id: string;
  name: string;
} | null;

export type OpportunityQueueItem = {
  id: string;
  companyId: string;
  conversationId: string;
  contact: OpportunityQueueContact;
  owner: OpportunityQueueOwner;
  priority: OpportunityPriority;
  product: OpportunityQueueProduct;
  commercialState: {
    type: OpportunityCommercialState;
    label: string;
  };
  queueReason: string;
  situationTitle: string;
  situationExplanation: string;
  primaryAction: OpportunityPrimaryAction;
  displayEvidences: OpportunityEvidence[];
  lastRelevantInteraction: OpportunityLastRelevantInteraction;
  pendingReturn: OpportunityPendingReturn | null;
  activeProposal: OpportunityActiveProposal | null;
  updatedAt: string;
};

export type OpportunityQueueResponse = {
  items: OpportunityQueueItem[];
  nextCursor: string | null;
  total: number;
  scanned: number;
};

export type OpportunityGroupKey =
  | "respond-now"
  | "returns"
  | "negotiation"
  | "waiting-customer"
  | "follow-up"
  | "other";

export type OpportunityGroup = {
  key: OpportunityGroupKey;
  title: string;
  description: string;
  items: OpportunityQueueItem[];
};
